require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const {Pool} = require("pg");
const OpenAI = require("openai");
const {toFile} = require("openai");
const {AccessToken, AgentDispatchClient} = require("livekit-server-sdk");

const app = express();
const PORT = process.env.PORT || 3000;

// Kalıcı veritabanı (Postgres, örn. Supabase/Neon ücretsiz katman).
// DATABASE_URL tanımlı değilse sunucu yine çalışır ama LiveBridge verisi
// yeniden başlatmada silinir (sadece geliştirme/test için uygundur).
const dbPool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {rejectUnauthorized: false},
    })
  : null;

if (!dbPool) {
  console.warn(
    "UYARI: DATABASE_URL tanımlı değil. LiveBridge verisi kalıcı olmayacak (RAM'de tutulacak).",
  );
}

async function initDb() {
  if (!dbPool) return;
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS livebridge_users (
      phone TEXT PRIMARY KEY,
      phone_keys TEXT[] NOT NULL DEFAULT '{}',
      name TEXT NOT NULL,
      language TEXT DEFAULT '',
      last_seen BIGINT NOT NULL
    );
  `);
  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS idx_livebridge_users_phone_keys
      ON livebridge_users USING GIN (phone_keys);
  `);
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS livebridge_calls (
      id TEXT PRIMARY KEY,
      room_name TEXT NOT NULL,
      caller_phone TEXT NOT NULL,
      caller_name TEXT NOT NULL,
      callee_phone TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
  `);
  console.log("Veritabanı tabloları hazır.");
}

// Uygulama içi çağrıları tanımlamak için paylaşımlı anahtar.
// NOT: Mobil uygulamaya gömülen her sabit çıkarılabilir; bu tam bir
// kullanıcı kimlik doğrulaması değil, sadece rastgele bot/scraper
// trafiğini engelleyen bir ilk savunma katmanıdır.
const APP_SHARED_KEY = process.env.APP_SHARED_KEY || "";
if (!APP_SHARED_KEY) {
  console.warn(
    "UYARI: APP_SHARED_KEY tanımlı değil. Uç noktalar korumasız çalışıyor.",
  );
}

function requireAppKey(req, res, next) {
  if (!APP_SHARED_KEY) return next(); // env tanımlı değilse geliştirme modunda izin ver
  const provided = req.get("x-app-key");
  if (provided !== APP_SHARED_KEY) {
    return res.status(401).json({error: "Yetkisiz istek."});
  }
  next();
}

// İzin verilen origin'ler (virgülle ayrılmış env değişkeni).
// Örn: ALLOWED_ORIGINS="https://aytalk.app,https://admin.aytalk.app"
// Mobil uygulamalar (RN fetch) tarayıcı origin'i göndermez, bu yüzden
// origin'siz istekler (native app) her zaman kabul edilir; sadece
// tarayıcıdan gelen bilinmeyen origin'ler engellenir.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS: izin verilmeyen origin."));
  },
};

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // dakikada IP başına 60 istek
  standardHeaders: true,
  legacyHeaders: false,
  message: {error: "Çok fazla istek gönderildi. Lütfen biraz bekleyin."},
});

// Uzun süre beklemeyi ve gereksiz tekrarları azaltır.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 20000,
  maxRetries: 1,
});

const translatorDispatchClient =
  process.env.LIVEKIT_URL &&
  process.env.LIVEKIT_API_KEY &&
  process.env.LIVEKIT_API_SECRET
    ? new AgentDispatchClient(
        process.env.LIVEKIT_URL.replace(/^wss:/, "https:"),
        process.env.LIVEKIT_API_KEY,
        process.env.LIVEKIT_API_SECRET,
      )
    : null;

app.disable("x-powered-by");
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({limit: "12mb"}));
app.use(generalLimiter);

// Sağlık kontrolü hariç tüm uçlar paylaşımlı anahtar ister.
app.use((req, res, next) => {
  if (req.path === "/" || req.path === "/health") return next();
  return requireAppKey(req, res, next);
});

// LiveBridge Contacts Cloud — DATABASE_URL varsa Postgres, yoksa RAM (yedek).
const liveBridgeUsersMem = new Map();
const liveBridgeCallsMem = new Map();
const normalizeLiveBridgePhone = value =>
  String(value || "").replace(/[^0-9]/g, "").slice(0, 18);

function liveBridgePhoneKeys(value, suppliedKeys = []) {
  const digits = normalizeLiveBridgePhone(value);
  const keys = new Set(
    Array.isArray(suppliedKeys)
      ? suppliedKeys
          .map(item => normalizeLiveBridgePhone(item))
          .filter(item => item.length >= 8)
      : [],
  );

  if (!digits) return Array.from(keys);

  keys.add(digits);

  const noInternationalPrefix = digits.startsWith("00")
    ? digits.slice(2)
    : digits;
  if (noInternationalPrefix) keys.add(noInternationalPrefix);

  const noLeadingZero = digits.replace(/^0+/, "");
  if (noLeadingZero) keys.add(noLeadingZero);

  for (const size of [10, 9, 8]) {
    if (digits.length >= size) keys.add(digits.slice(-size));
    if (noInternationalPrefix.length >= size) {
      keys.add(noInternationalPrefix.slice(-size));
    }
  }

  return Array.from(keys).filter(key => key.length >= 8);
}

function rowToUser(row) {
  if (!row) return null;
  return {
    phone: row.phone,
    phoneKeys: row.phone_keys || [],
    name: row.name,
    language: row.language || "",
    lastSeen: Number(row.last_seen || 0),
  };
}

function rowToCall(row) {
  if (!row) return null;
  return {
    id: row.id,
    roomName: row.room_name,
    callerPhone: row.caller_phone,
    callerName: row.caller_name,
    calleePhone: row.callee_phone,
    mode: row.mode,
    status: row.status,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

const liveBridgeStore = {
  async getUser(phone) {
    if (dbPool) {
      const {rows} = await dbPool.query(
        "SELECT * FROM livebridge_users WHERE phone = $1",
        [phone],
      );
      return rowToUser(rows[0]);
    }
    return liveBridgeUsersMem.get(phone) || null;
  },

  async saveUser(user) {
    if (dbPool) {
      await dbPool.query(
        `INSERT INTO livebridge_users (phone, phone_keys, name, language, last_seen)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (phone) DO UPDATE SET
           phone_keys = EXCLUDED.phone_keys,
           name = EXCLUDED.name,
           language = EXCLUDED.language,
           last_seen = EXCLUDED.last_seen`,
        [user.phone, user.phoneKeys, user.name, user.language, user.lastSeen],
      );
      return user;
    }
    liveBridgeUsersMem.set(user.phone, user);
    return user;
  },

  async findUserByPhoneKeys(requestedKeys) {
    if (dbPool) {
      const {rows} = await dbPool.query(
        "SELECT * FROM livebridge_users WHERE phone_keys && $1::text[] LIMIT 1",
        [requestedKeys],
      );
      return rowToUser(rows[0]);
    }
    for (const user of liveBridgeUsersMem.values()) {
      const userKeys = liveBridgePhoneKeys(user.phone, user.phoneKeys || []);
      if (userKeys.some(key => requestedKeys.includes(key))) return user;
    }
    return null;
  },

  async saveCall(call) {
    if (dbPool) {
      await dbPool.query(
        `INSERT INTO livebridge_calls
           (id, room_name, caller_phone, caller_name, callee_phone, mode, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           updated_at = EXCLUDED.updated_at`,
        [
          call.id, call.roomName, call.callerPhone, call.callerName,
          call.calleePhone, call.mode, call.status, call.createdAt, call.updatedAt,
        ],
      );
      return call;
    }
    liveBridgeCallsMem.set(call.id, call);
    return call;
  },

  async getCall(id) {
    if (dbPool) {
      const {rows} = await dbPool.query(
        "SELECT * FROM livebridge_calls WHERE id = $1",
        [id],
      );
      return rowToCall(rows[0]);
    }
    return liveBridgeCallsMem.get(id) || null;
  },

  async getRingingCallForCallee(phone) {
    if (dbPool) {
      const {rows} = await dbPool.query(
        `SELECT * FROM livebridge_calls
         WHERE callee_phone = $1 AND status = 'ringing'
         ORDER BY created_at DESC LIMIT 1`,
        [phone],
      );
      return rowToCall(rows[0]);
    }
    return (
      Array.from(liveBridgeCallsMem.values())
        .filter(c => c.calleePhone === phone && c.status === "ringing")
        .sort((a, b) => b.createdAt - a.createdAt)[0] || null
    );
  },

  async cleanExpiredCalls() {
    const now = Date.now();
    if (dbPool) {
      await dbPool.query(
        `UPDATE livebridge_calls SET status = 'expired', updated_at = $1
         WHERE status = 'ringing' AND $1 - created_at > 60000`,
        [now],
      );
      await dbPool.query(
        `DELETE FROM livebridge_calls WHERE $1 - created_at > 600000`,
        [now],
      );
      return;
    }
    for (const [id, call] of liveBridgeCallsMem.entries()) {
      if (call.status === "ringing" && now - call.createdAt > 60000) {
        liveBridgeCallsMem.set(id, {...call, status: "expired", updatedAt: now});
      }
      if (now - call.createdAt > 600000) liveBridgeCallsMem.delete(id);
    }
  },
};

const liveBridgeNow = () => Date.now();
const liveBridgeUserOnline = user =>
  Boolean(user && liveBridgeNow() - Number(user.lastSeen || 0) < 45000);
app.post("/livebridge/profile/register", async (req, res) => {
  try {
    const phone = normalizeLiveBridgePhone(req.body?.phone);
    const name = String(req.body?.name || "").trim().slice(0, 80);
    const language = String(req.body?.language || "").trim().slice(0, 80);
    if (phone.length < 7 || !name) return res.status(400).json({error: "Telefon ve isim gerekli."});
    const existing = await liveBridgeStore.getUser(phone);
    const user = {
      ...(existing || {}),
      phone,
      phoneKeys: liveBridgePhoneKeys(phone, req.body?.phoneKeys),
      name,
      language,
      lastSeen: liveBridgeNow(),
    };
    await liveBridgeStore.saveUser(user);
    res.json({ok: true, user: {...user, online: true}});
  } catch (error) {
    console.error("profile/register hatası:", error);
    res.status(500).json({error: "Profil kaydedilemedi."});
  }
});

app.post("/livebridge/presence", async (req, res) => {
  try {
    const phone = normalizeLiveBridgePhone(req.body?.phone);
    if (phone.length < 7) return res.status(400).json({error: "Telefon gerekli."});
    const old = (await liveBridgeStore.getUser(phone)) || {};
    const user = {
      ...old,
      phone,
      phoneKeys: liveBridgePhoneKeys(phone, req.body?.phoneKeys || old.phoneKeys),
      name: String(req.body?.name || old.name || "LiveBridge Kullanıcısı").slice(0, 80),
      language: String(req.body?.language || old.language || "").slice(0, 80),
      lastSeen: liveBridgeNow(),
    };
    await liveBridgeStore.saveUser(user);
    res.json({ok: true, lastSeen: user.lastSeen});
  } catch (error) {
    console.error("presence hatası:", error);
    res.status(500).json({error: "Durum güncellenemedi."});
  }
});

app.post("/livebridge/contacts/match", async (req, res) => {
  try {
    const ownerPhone = normalizeLiveBridgePhone(req.body?.ownerPhone);
    const contacts = Array.isArray(req.body?.contacts) ? req.body.contacts.slice(0, 3000) : [];
    const users = [];
    const seen = new Set();
    for (const c of contacts) {
      const phone = normalizeLiveBridgePhone(c?.phone);
      if (!phone || phone === ownerPhone || seen.has(phone)) continue;
      const requestedKeys = liveBridgePhoneKeys(phone, c?.keys);
      const r = await liveBridgeStore.findUserByPhoneKeys(requestedKeys);
      if (!r) continue;
      const matchedIdentity = normalizeLiveBridgePhone(r.phone);
      if (seen.has(matchedIdentity)) continue;
      seen.add(matchedIdentity);
      users.push({
        phone: r.phone,
        name: String(c?.name || r.name || "LiveBridge Kullanıcısı").slice(0, 100),
        language: r.language || "",
        online: liveBridgeUserOnline(r),
        lastSeen: r.lastSeen || 0,
      });
    }
    users.sort((a, b) => a.online === b.online ? String(a.name).localeCompare(String(b.name), "tr") : (a.online ? -1 : 1));
    res.json({ok: true, users});
  } catch (error) {
    console.error("contacts/match hatası:", error);
    res.status(500).json({error: "Kişiler eşleştirilemedi."});
  }
});

app.post("/livebridge/call/start", async (req, res) => {
  try {
    await liveBridgeStore.cleanExpiredCalls();
    const callerPhone = normalizeLiveBridgePhone(req.body?.callerPhone);
    const calleePhone = normalizeLiveBridgePhone(req.body?.calleePhone);
    if (callerPhone.length < 7 || calleePhone.length < 7 || callerPhone === calleePhone) {
      return res.status(400).json({error: "Geçersiz arama bilgisi."});
    }
    const calleeUser = await liveBridgeStore.findUserByPhoneKeys(liveBridgePhoneKeys(calleePhone));
    if (!calleeUser) return res.status(404).json({error: "Kişi LiveBridge'de bulunamadı."});
    const resolvedCalleePhone = calleeUser.phone;
    const id = `LBC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const roomName = `LB-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const call = {
      id, roomName, callerPhone,
      callerName: String(req.body?.callerName || "LiveBridge Kullanıcısı").slice(0, 80),
      calleePhone: resolvedCalleePhone,
      mode: req.body?.mode === "chat" ? "chat" : req.body?.mode === "audio" ? "audio" : "video",
      status: "ringing", createdAt: liveBridgeNow(), updatedAt: liveBridgeNow(),
    };
    await liveBridgeStore.saveCall(call);
    res.json({ok: true, call});
  } catch (error) {
    console.error("call/start hatası:", error);
    res.status(500).json({error: "Arama başlatılamadı."});
  }
});

app.get("/livebridge/call/incoming", async (req, res) => {
  try {
    await liveBridgeStore.cleanExpiredCalls();
    const phone = normalizeLiveBridgePhone(req.query?.phone);
    const call = await liveBridgeStore.getRingingCallForCallee(phone);
    res.json({ok: true, call: call || null});
  } catch (error) {
    console.error("call/incoming hatası:", error);
    res.status(500).json({error: "Gelen arama sorgulanamadı."});
  }
});

app.post("/livebridge/call/respond", async (req, res) => {
  try {
    await liveBridgeStore.cleanExpiredCalls();
    const id = String(req.body?.callId || "");
    const phone = normalizeLiveBridgePhone(req.body?.calleePhone);
    const call = await liveBridgeStore.getCall(id);
    if (!call || call.calleePhone !== phone) return res.status(404).json({error: "Arama bulunamadı."});
    const updated = {...call, status: req.body?.accepted ? "accepted" : "rejected", updatedAt: liveBridgeNow()};
    await liveBridgeStore.saveCall(updated);
    res.json({ok: true, call: updated});
  } catch (error) {
    console.error("call/respond hatası:", error);
    res.status(500).json({error: "Arama yanıtlanamadı."});
  }
});

app.get("/livebridge/call/status/:id", async (req, res) => {
  try {
    await liveBridgeStore.cleanExpiredCalls();
    const call = await liveBridgeStore.getCall(String(req.params?.id || ""));
    if (!call) return res.status(404).json({error: "Arama bulunamadı."});
    res.json({ok: true, call});
  } catch (error) {
    console.error("call/status hatası:", error);
    res.status(500).json({error: "Arama durumu sorgulanamadı."});
  }
});


function prepareStreamResponse(res) {
  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

function writeStreamEvent(res, payload) {
  if (!res.writableEnded) {
    res.write(`${JSON.stringify(payload)}\n`);
  }
}

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY bulunamadı.");
  process.exit(1);
}

app.get("/", (_req, res) => {
  res.send("AyTalk Server Çalışıyor");
});



// AYTalk native audio -> OpenAI transcription.
// Android SpeechRecognizer / Google Speech is not used.
app.post("/audio/transcribe", async (req, res) => {
  try {
    const audioBase64 = String(
      req.body?.audioBase64 || "",
    ).trim();

    const requestedLanguage = String(
      req.body?.language || "",
    )
      .trim()
      .toLowerCase();

    if (!audioBase64) {
      return res.status(400).json({
        error: "Ses verisi gerekli.",
      });
    }

    // 16 kHz mono WAV from the native AyTalk recorder.
    const audioBuffer = Buffer.from(
      audioBase64,
      "base64",
    );

    if (
      audioBuffer.length < 1000 ||
      audioBuffer.length > 3 * 1024 * 1024
    ) {
      return res.status(400).json({
        error: "Geçersiz ses kaydı.",
      });
    }

    // OpenAI language guidance expects ISO-639-1.
    const language =
      /^[a-z]{2}$/.test(requestedLanguage)
        ? requestedLanguage
        : undefined;

    const transcription =
      await openai.audio.transcriptions.create({
        file: await toFile(
          audioBuffer,
          "aytalk-livebridge.wav",
          {type: "audio/wav"},
        ),
        model: "gpt-4o-mini-transcribe",
        ...(language ? {language} : {}),
        prompt:
          "Transcribe the speaker exactly. Preserve names, numbers, " +
          "kinship terms, honorifics and ordinary words as spoken. " +
          "Do not reinterpret normal words as acronyms.",
      });

    const text = String(
      transcription?.text || "",
    ).trim();

    if (!text) {
      return res.status(422).json({
        error: "Konuşma algılanmadı.",
      });
    }

    return res.json({
      ok: true,
      text,
    });
  } catch (error) {
    console.error(
      "AyTalk transcription error:",
      error,
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Ses yazıya çevrilemedi.",
    });
  }
});



function parseTranslatorMetadata(dispatch) {
  try {
    return JSON.parse(dispatch?.metadata || "{}");
  } catch {
    return {};
  }
}

async function deleteTranslatorDispatches(roomName, sourceIdentity) {
  if (!translatorDispatchClient) return;
  const list = await translatorDispatchClient.listDispatch(roomName);

  for (const dispatch of list) {
    if (dispatch.agentName !== "aytalk-translator") continue;
    const metadata = parseTranslatorMetadata(dispatch);
    if (metadata.sourceIdentity === sourceIdentity) {
      await translatorDispatchClient.deleteDispatch(
        dispatch.id,
        roomName,
      );
    }
  }
}

app.post("/livebridge/translator/sync", async (req, res) => {
  try {
    if (!translatorDispatchClient) {
      return res.status(503).json({
        error: "LiveKit translator worker ayarlı değil.",
      });
    }

    const roomName = String(req.body?.roomName || "").trim();
    const sourceIdentity = String(req.body?.sourceIdentity || "").trim();
    const sourceLanguage = String(req.body?.sourceLanguage || "").trim();
    const sourceLocale = String(req.body?.sourceLocale || "").trim();
    const targetLanguage = String(req.body?.targetLanguage || "").trim();
    const targetLocale = String(req.body?.targetLocale || "").trim();
    const voiceId = String(req.body?.voiceId || "").trim();

    if (!roomName || !sourceIdentity || !sourceLanguage || !targetLanguage) {
      return res.status(400).json({
        error: "Oda, katılımcı ve dil bilgileri gerekli.",
      });
    }

    await deleteTranslatorDispatches(roomName, sourceIdentity);

    const metadata = JSON.stringify({
      sourceIdentity,
      sourceLanguage,
      sourceLocale,
      targetLanguage,
      targetLocale,
      voiceId,
    });

    const created = await translatorDispatchClient.createDispatch(
      roomName,
      "aytalk-translator",
      {metadata},
    );

    return res.json({
      ok: true,
      dispatchId: created.id,
      mode: "continuous",
    });
  } catch (error) {
    console.error("translator sync:", error);
    return res.status(500).json({
      error: error?.message || "Canlı çeviri ajanı başlatılamadı.",
    });
  }
});

app.post("/livebridge/translator/stop", async (req, res) => {
  try {
    const roomName = String(req.body?.roomName || "").trim();
    const sourceIdentity = String(req.body?.sourceIdentity || "").trim();
    if (roomName && sourceIdentity) {
      await deleteTranslatorDispatches(roomName, sourceIdentity);
    }
    return res.json({ok: true});
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Çeviri ajanı durdurulamadı.",
    });
  }
});


// LIVEKIT UZAK GÖRÜŞME TOKEN ENDPOINT
app.post("/livekit/token", async (req, res) => {
  try {
    const livekitUrl = String(process.env.LIVEKIT_URL || "").trim();
    const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
    const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();

    if (!livekitUrl || !apiKey || !apiSecret) {
      return res.status(503).json({
        error:
          "LiveKit henüz yapılandırılmadı. LIVEKIT_URL, LIVEKIT_API_KEY ve LIVEKIT_API_SECRET eklenmeli.",
      });
    }

    const roomName = String(req.body?.roomName || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 64);

    const participantIdentity = String(
      req.body?.participantIdentity || "",
    )
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 64);

    const participantName = String(req.body?.participantName || "")
      .trim()
      .slice(0, 64);

    if (roomName.length < 4) {
      return res.status(400).json({error: "Geçerli bir oda kodu gerekli."});
    }

    if (!participantIdentity || !participantName) {
      return res.status(400).json({
        error: "Katılımcı kimliği ve adı gerekli.",
      });
    }

    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
      name: participantName,
      ttl: "2h",
    });

    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const participantToken = await accessToken.toJwt();

    return res.status(201).json({
      serverUrl: livekitUrl,
      participantToken,
    });
  } catch (error) {
    console.error("LiveKit token error:", error);

    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "LiveKit token üretilemedi.",
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({ok: true, service: "LiveBridge", version: "11.0-realtime-bridge"});
});

app.get("/livebridge/voice/capabilities", (_req, res) => {
  const customVoiceEnabled =
    String(process.env.LIVEBRIDGE_CUSTOM_VOICE_ENABLED || "")
      .trim()
      .toLowerCase() === "true";

  res.json({
    customVoiceEnabled,
    requiresExplicitConsent: true,
    mode: customVoiceEnabled ? "custom-voice" : "device-tts",
    note: customVoiceEnabled
      ? "Custom voice can be used only after explicit consent."
      : "Demo uses device TTS until eligible custom-voice access is configured.",
  });
});

// GÖRÜŞME İÇİN BAĞLAMLI VE SIKI ÇEVİRİ
app.post("/call/translate", async (req, res) => {
  const startedAt = Date.now();

  try {
    const message = String(req.body?.message || "").trim();
    const from = String(req.body?.from || "Auto").trim();
    const to = String(req.body?.to || "English").trim();
    const rawContext = Array.isArray(req.body?.context) ? req.body.context : [];
    const context = rawContext
      .slice(-8)
      .map(item => ({
        role: String(item?.role || "speaker").trim().slice(0, 20),
        source: String(item?.source || "").trim().slice(0, 1200),
        translation: String(item?.translation || "").trim().slice(0, 1200),
      }))
      .filter(item => item.source || item.translation);

    if (!message) {
      return res.status(400).json({error: "Mesaj boş."});
    }

    if (message.length > 4000) {
      return res.status(400).json({error: "Konuşma bölümü çok uzun."});
    }

    const contextText = context.length
      ? context
          .map((item, index) =>
            `${index + 1}. ROLE: ${item.role}\nSOURCE: ${item.source}\nTRANSLATION: ${item.translation}`,
          )
          .join("\n\n")
      : "No previous context.";

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      store: false,
      max_output_tokens: Math.min(1200, Math.max(80, Math.ceil(message.length * 1.6))),
      instructions:
        "You are LiveBridge, a professional real-time human interpreter. " +
        `Translate ONLY the CURRENT utterance from ${from} to ${to}. ` +
        "The dialogue history may contain both speakers. Use it only to resolve pronouns, references, names, terminology, register and implied subjects. " +
        "Do not translate previous turns again. Do not answer either speaker. " +
        "Never add facts, explanations, summaries, politeness, completions, diagnoses, advice or guesses. " +
        "Preserve names, numbers, units, dates, negation, uncertainty, question form and professional terminology exactly in meaning. " +
        "For medical, legal or technical terms, prefer the standard target-language term and do not simplify unless the speaker simplified it. " +
        "If CURRENT_UTTERANCE is incomplete, translate it as an incomplete fragment rather than inventing the ending. " +
        "Keep the speaker's tone and level of formality. " +
        "Translate culturally meaningful kinship terms, honorifics, forms of address, idioms and discourse markers by their FUNCTION and meaning in the current context, not by superficial spelling. " +
        "A normal spoken word that happens to look like a Latin-letter abbreviation must remain a word; do not reinterpret it as an acronym unless context clearly shows an acronym, company name or initialism. " +
        "When an address term has a natural target-language equivalent, use that equivalent while preserving relationship, respect and register. " +
        "Do not transliterate ordinary vocabulary when an established target-language translation exists. Preserve proper names and genuine acronyms. " +
        "Return ONLY the translation of CURRENT_UTTERANCE.",
      input:
        `PREVIOUS_CONTEXT:\n${contextText}\n\n` +
        `CURRENT_UTTERANCE:\n${message}`,
    });

    const reply = String(response.output_text || "").trim();
    if (!reply) {
      throw new Error("OpenAI boş çeviri döndürdü.");
    }

    return res.json({reply, elapsedMs: Date.now() - startedAt});
  } catch (error) {
    console.error("Call translation error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Görüşme çevirisi başarısız.",
    });
  }
});

// HIZLI ÇEVİRİ
app.post("/chat", async (req, res) => {
  const startedAt = Date.now();

  try {
    const message = String(req.body?.message || "").trim();
    const from = String(req.body?.from || "Turkish").trim();
    const to = String(req.body?.to || "English").trim();

    if (!message) {
      return res.status(400).json({error: "Mesaj boş."});
    }

    if (message.length > 12000) {
      return res.status(400).json({
        error: "Metin çok uzun. En fazla 12.000 karakter gönder.",
      });
    }

    const response = await openai.responses.create({
      // Çeviri için mini yerine daha hızlı nano model.
      model: "gpt-4.1-nano",
      store: false,

      // Gereksiz uzun yanıt üretimini engeller.
      max_output_tokens: Math.min(
        3000,
        Math.max(120, Math.ceil(message.length * 1.35))
      ),

      // Kısa ve doğrudan talimat daha hızlıdır.
      instructions:
        `Translate from ${from} to ${to}. ` +
        "Return only the translation. Preserve meaning exactly. Never answer the speaker and never add information. " +
        "Translate kinship terms, honorifics, forms of address, idioms and discourse markers by their function in context. " +
        "A normal word must never be reinterpreted as an acronym only because its Latin spelling resembles one. " +
        "Preserve genuine acronyms, brands, proper names, numbers, punctuation, paragraphs, tone and question form. " +
        "Use the natural target-language equivalent for ordinary vocabulary and address terms.",

      input: message,
    });

    const reply = String(response.output_text || "").trim();

    if (!reply) {
      throw new Error("OpenAI boş yanıt döndürdü.");
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(`Translation completed in ${elapsedMs} ms`);

    return res.json({reply, elapsedMs});
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    console.error(`Translation error after ${elapsedMs} ms:`, error);

    const isTimeout =
      error?.name === "APIConnectionTimeoutError" ||
      String(error?.message || "").toLowerCase().includes("timeout");

    return res.status(isTimeout ? 504 : 500).json({
      error: isTimeout
        ? "Çeviri sunucusu zaman aşımına uğradı. Tekrar dene."
        : error instanceof Error
        ? error.message
        : "Bilinmeyen sunucu hatası.",
    });
  }
});


// STREAMING ÇEVİRİ
app.post("/chat-stream", async (req, res) => {
  const startedAt = Date.now();
  let clientClosed = false;

  res.on("close", () => {
    if (!res.writableEnded) {
      clientClosed = true;
    }
  });

  try {
    const message = String(req.body?.message || "").trim();
    const from = String(req.body?.from || "Turkish").trim();
    const to = String(req.body?.to || "English").trim();

    if (!message) {
      return res.status(400).json({error: "Mesaj boş."});
    }

    if (message.length > 12000) {
      return res.status(400).json({
        error: "Metin çok uzun. En fazla 12.000 karakter gönder.",
      });
    }

    prepareStreamResponse(res);
    writeStreamEvent(res, {type: "start"});

    const stream = await openai.responses.create({
      model: "gpt-4.1-nano",
      store: false,
      stream: true,
      max_output_tokens: Math.min(
        3000,
        Math.max(120, Math.ceil(message.length * 1.35))
      ),
      instructions:
        `Translate from ${from} to ${to}. ` +
        "Return only the translation. Preserve meaning exactly. Never answer the speaker and never add information. " +
        "Translate kinship terms, honorifics, forms of address, idioms and discourse markers by their function in context. " +
        "A normal word must never be reinterpreted as an acronym only because its Latin spelling resembles one. " +
        "Preserve genuine acronyms, brands, proper names, numbers, punctuation, paragraphs, tone and question form. " +
        "Use the natural target-language equivalent for ordinary vocabulary and address terms.",
      input: message,
    });

    let fullText = "";

    for await (const event of stream) {
      if (clientClosed || res.destroyed || res.writableEnded) break;

      if (event.type === "response.output_text.delta") {
        const delta = String(event.delta || "");
        if (delta) {
          fullText += delta;
          writeStreamEvent(res, {type: "delta", delta});
        }
      }

      if (event.type === "response.failed") {
        throw new Error(
          event.response?.error?.message || "OpenAI streaming başarısız oldu."
        );
      }
    }

    if (!clientClosed && !res.writableEnded) {
      const reply = fullText.trim();

      if (!reply) {
        throw new Error("OpenAI boş yanıt döndürdü.");
      }

      writeStreamEvent(res, {
        type: "done",
        reply,
        elapsedMs: Date.now() - startedAt,
      });
      res.end();
    }

    console.log(`Streaming translation completed in ${Date.now() - startedAt} ms`);
  } catch (error) {
    console.error(
      `Streaming translation error after ${Date.now() - startedAt} ms:`,
      error
    );

    if (!res.headersSent) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Bilinmeyen sunucu hatası.",
      });
    }

    writeStreamEvent(res, {
      type: "error",
      error: error instanceof Error ? error.message : "Bilinmeyen sunucu hatası.",
    });
    res.end();
  }
});

// YAPAY ZEKÂ ASİSTANI
app.post("/assistant", async (req, res) => {
  const startedAt = Date.now();

  try {
    const message = String(req.body?.message || "").trim();
    const language = String(req.body?.language || "Turkish").trim();
    const history = Array.isArray(req.body?.history)
      ? req.body.history.slice(-8)
      : [];

    if (!message) {
      return res.status(400).json({error: "Mesaj boş."});
    }

    if (message.length > 8000) {
      return res.status(400).json({
        error: "Mesaj çok uzun. En fazla 8.000 karakter gönder.",
      });
    }

    const safeHistory = history
      .filter(
        item =>
          item &&
          (item.role === "user" || item.role === "assistant")
      )
      .map(item => ({
        role: item.role,
        content: String(item.content || "").slice(0, 2500),
      }));

    const response = await openai.responses.create({
      // Asistan kalitesini korumak için mini model.
      model: "gpt-4.1-mini",
      store: false,
      max_output_tokens: 900,
      instructions:
        `You are AyTalk AI, a helpful and practical assistant. ` +
        `Answer in ${language} unless another language is requested. ` +
        "Be clear and concise. Do not claim actions you did not perform.",
      input: [...safeHistory, {role: "user", content: message}],
    });

    const reply = String(response.output_text || "").trim();

    if (!reply) {
      throw new Error("OpenAI boş yanıt döndürdü.");
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(`Assistant completed in ${elapsedMs} ms`);

    return res.json({reply, elapsedMs});
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    console.error(`Assistant error after ${elapsedMs} ms:`, error);

    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Bilinmeyen sunucu hatası.",
    });
  }
});


// STREAMING YAPAY ZEKÂ ASİSTANI
app.post("/assistant-stream", async (req, res) => {
  const startedAt = Date.now();
  let clientClosed = false;

  res.on("close", () => {
    if (!res.writableEnded) {
      clientClosed = true;
    }
  });

  try {
    const message = String(req.body?.message || "").trim();
    const language = String(req.body?.language || "Turkish").trim();
    const history = Array.isArray(req.body?.history)
      ? req.body.history.slice(-8)
      : [];

    if (!message) {
      return res.status(400).json({error: "Mesaj boş."});
    }

    if (message.length > 8000) {
      return res.status(400).json({
        error: "Mesaj çok uzun. En fazla 8.000 karakter gönder.",
      });
    }

    const safeHistory = history
      .filter(
        item =>
          item &&
          (item.role === "user" || item.role === "assistant")
      )
      .map(item => ({
        role: item.role,
        content: String(item.content || "").slice(0, 2500),
      }));

    prepareStreamResponse(res);
    writeStreamEvent(res, {type: "start"});

    const stream = await openai.responses.create({
      model: "gpt-4.1-mini",
      store: false,
      stream: true,
      max_output_tokens: 900,
      instructions:
        `You are AyTalk AI, a helpful and practical assistant. ` +
        `Answer in ${language} unless another language is requested. ` +
        "Be clear and concise. Do not claim actions you did not perform.",
      input: [...safeHistory, {role: "user", content: message}],
    });

    let fullText = "";

    for await (const event of stream) {
      if (clientClosed || res.destroyed || res.writableEnded) break;

      if (event.type === "response.output_text.delta") {
        const delta = String(event.delta || "");
        if (delta) {
          fullText += delta;
          writeStreamEvent(res, {type: "delta", delta});
        }
      }

      if (event.type === "response.failed") {
        throw new Error(
          event.response?.error?.message || "OpenAI streaming başarısız oldu."
        );
      }
    }

    if (!clientClosed && !res.writableEnded) {
      const reply = fullText.trim();

      if (!reply) {
        throw new Error("OpenAI boş yanıt döndürdü.");
      }

      writeStreamEvent(res, {
        type: "done",
        reply,
        elapsedMs: Date.now() - startedAt,
      });
      res.end();
    }

    console.log(`Streaming assistant completed in ${Date.now() - startedAt} ms`);
  } catch (error) {
    console.error(
      `Streaming assistant error after ${Date.now() - startedAt} ms:`,
      error
    );

    if (!res.headersSent) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Bilinmeyen sunucu hatası.",
      });
    }

    writeStreamEvent(res, {
      type: "error",
      error: error instanceof Error ? error.message : "Bilinmeyen sunucu hatası.",
    });
    res.end();
  }
});


// BULUT GÖRSEL OKUMA (ÇOK DİLLİ OCR)
app.post("/vision-ocr", async (req, res) => {
  const startedAt = Date.now();

  try {
    const imageBase64 = String(req.body?.imageBase64 || "").trim();
    const mimeType = String(req.body?.mimeType || "image/jpeg").trim();
    const language = String(req.body?.language || "Unknown").trim();

    if (!imageBase64) {
      return res.status(400).json({error: "Görsel verisi boş."});
    }

    if (imageBase64.length > 10_000_000) {
      return res.status(400).json({
        error: "Görsel çok büyük. Daha düşük çözünürlüklü bir fotoğraf seç.",
      });
    }

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      store: false,
      max_output_tokens: 2200,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                `Read and transcribe every visible text from this image. ` +
                `The expected language is ${language}. ` +
                "Return only the extracted text, preserving line breaks and reading order. " +
                "Do not translate, explain, summarize, or add labels. " +
                "If there is no readable text, return exactly: NO_TEXT",
            },
            {
              type: "input_image",
              image_url: `data:${mimeType};base64,${imageBase64}`,
              detail: "high",
            },
          ],
        },
      ],
    });

    const text = String(response.output_text || "").trim();

    if (!text || text === "NO_TEXT") {
      return res.status(422).json({
        error: "Fotoğrafta okunabilir metin bulunamadı.",
      });
    }

    res.json({
      text,
      provider: "openai-vision",
      elapsedMs: Date.now() - startedAt,
    });

    console.log(`Vision OCR completed in ${Date.now() - startedAt} ms`);
  } catch (error) {
    console.error(
      `Vision OCR error after ${Date.now() - startedAt} ms:`,
      error,
    );

    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Bulut görsel okuma sırasında bilinmeyen hata oluştu.",
    });
  }
});

// BULUT SESLENDİRME
app.post("/tts", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    const language = String(req.body?.language || "").trim();

    if (!text) {
      return res.status(400).json({
        error: "Seslendirilecek metin boş.",
      });
    }

    if (text.length > 4096) {
      return res.status(400).json({
        error: "Seslendirme metni en fazla 4.096 karakter olabilir.",
      });
    }

    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "coral",
      input: text,
      response_format: "mp3",
      instructions: language
        ? `Speak naturally and clearly in ${language}. Pronounce ordinary words as words, not as letter-by-letter acronyms, unless clearly intended as an acronym.`
        : "Speak naturally and clearly. Pronounce ordinary words as words.",
    });

    const buffer = Buffer.from(await speech.arrayBuffer());

    return res.json({
      audioBase64: buffer.toString("base64"),
    });
  } catch (error) {
    console.error("TTS error:", error);

    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Bilinmeyen seslendirme hatası.",
    });
  }
});

// Tanımsız uç noktalar için 404.
app.use((req, res) => {
  res.status(404).json({error: "Uç nokta bulunamadı."});
});

// Express hata yakalayıcı (4 parametreli imza şart).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Beklenmeyen sunucu hatası:", err);
  if (res.headersSent) return;
  res.status(err.message?.startsWith("CORS") ? 403 : 500).json({
    error: err.message?.startsWith("CORS")
      ? "İzin verilmeyen kaynak."
      : "Sunucu hatası.",
  });
});

// Beklenmeyen hatalarda sunucunun sessizce çökmesini önler, en azından loglar.
process.on("uncaughtException", err => {
  console.error("YAKALANMAMIŞ İSTİSNA:", err);
});

process.on("unhandledRejection", reason => {
  console.error("İŞLENMEMİŞ PROMISE REDDİ:", reason);
});

initDb()
  .catch(err => {
    console.error("Veritabanı başlatma hatası:", err);
  })
  .finally(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log("================================");
      console.log("AyTalk Fast Server Başladı");
      console.log(`Port: ${PORT}`);
      console.log(`Veritabanı: ${dbPool ? "Postgres (kalıcı)" : "RAM (kalıcı DEĞİL)"}`);
      console.log("Model: gpt-4.1-nano (translation)");
      console.log("================================");
    });
  });
