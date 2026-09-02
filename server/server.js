require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const {Pool} = require("pg");
const OpenAI = require("openai");
const {toFile} = require("openai");
const {AccessToken, AgentDispatchClient} = require("livekit-server-sdk");
const {cert, getApps, initializeApp} = require("firebase-admin/app");
const {getMessaging} = require("firebase-admin/messaging");
const {getStorage} = require("firebase-admin/storage");

// Hata takip sistemi (Sentry). SENTRY_DSN tanımlı değilse sessizce devre dışı kalır,
// hiçbir şeyi bozmaz — sadece hataları uzaktan görme imkanın olmaz.
if (process.env.SENTRY_DSN) {
console.log("Sentry hata takibi aktif.");
} else {
  console.warn("UYARI: SENTRY_DSN tanımlı değil. Sunucu hataları uzaktan izlenmiyor.");
}

const app = express();
const PORT = process.env.PORT || 3000;

// Firebase Admin yalnız kapalı/arka plandaki telefona gelen arama push'u göndermek
// için kullanılır. Ayar yoksa sunucu ve açık-app polling aynen çalışmaya devam eder.
let firebaseMessaging = null;
let firebaseStorageBucket = null;
try {
  const rawServiceAccount = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  const base64ServiceAccount = String(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "").trim();
  let serviceAccount = null;
  if (rawServiceAccount) {
    serviceAccount = JSON.parse(rawServiceAccount);
  } else if (base64ServiceAccount) {
    serviceAccount = JSON.parse(Buffer.from(base64ServiceAccount, "base64").toString("utf8"));
  }
  if (serviceAccount?.private_key) {
    serviceAccount.private_key = String(serviceAccount.private_key).replace(/\\n/g, "\n");
  }
  if (serviceAccount && getApps().length === 0) {
    initializeApp({credential:cert(serviceAccount)});
  }
  if (getApps().length > 0) {
    firebaseMessaging = getMessaging();

    // Firebase projelerinde Storage bucket adı proje yaşına göre
    // project.appspot.com veya project.firebasestorage.app olabilir.
    // Eski kod ikinci biçimi zorladığı için var olmayan bucket'a yazabiliyordu.
    const explicitBucket = String(process.env.FIREBASE_STORAGE_BUCKET || "")
      .trim()
      .replace(/^gs:\/\//, "");
    const projectId = String(serviceAccount?.project_id || "").trim();
    const candidates = Array.from(
      new Set(
        [
          explicitBucket,
          projectId ? `${projectId}.appspot.com` : "",
          projectId ? `${projectId}.firebasestorage.app` : "",
        ].filter(Boolean),
      ),
    );

    for (const bucketName of candidates) {
      try {
        const candidate = getStorage().bucket(bucketName);
        // getMetadata kontrolü aşağıdaki hazır olma Promise'ında yapılır; burada aday seçilir.
        firebaseStorageBucket = candidate;
        console.log(`Firebase Storage bucket adayı: ${bucketName}`);
        break;
      } catch (bucketError) {
        console.warn(
          `Firebase Storage bucket bulunamadı/erişilemiyor: ${bucketName}`,
          bucketError?.message || bucketError,
        );
      }
    }
    if (!firebaseStorageBucket) {
      console.warn(
        "Firebase Storage bucket bulunamadı. Dosyalar Postgres BYTEA yedeğine kaydedilecek.",
      );
    }
  } else {
    console.warn("UYARI: Firebase service account yok. Kapalı uygulama arama push'u devre dışı.");
  }
} catch (error) {
  console.error("Firebase Admin başlatılamadı:", error?.message || error);
}

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
      gender TEXT NOT NULL DEFAULT 'female',
      last_seen BIGINT NOT NULL
    );
  `);
  await dbPool.query(`
    ALTER TABLE livebridge_users ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT 'female';
  `);
  await dbPool.query(`
    ALTER TABLE livebridge_users ADD COLUMN IF NOT EXISTS fcm_token TEXT NOT NULL DEFAULT '';
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
      caller_gender TEXT NOT NULL DEFAULT 'female',
      callee_phone TEXT NOT NULL,
      callee_gender TEXT NOT NULL DEFAULT 'female',
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
  `);
  await dbPool.query(`
    ALTER TABLE livebridge_calls ADD COLUMN IF NOT EXISTS caller_gender TEXT NOT NULL DEFAULT 'female';
  `);
  await dbPool.query(`
    ALTER TABLE livebridge_calls ADD COLUMN IF NOT EXISTS callee_gender TEXT NOT NULL DEFAULT 'female';
  `);
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS livebridge_messages (
      id TEXT PRIMARY KEY,sender_phone TEXT NOT NULL,recipient_phone TEXT NOT NULL,
      sender_name TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL,
      original_text TEXT NOT NULL DEFAULT '',translated_text TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',mime_type TEXT NOT NULL DEFAULT '',
      storage_path TEXT NOT NULL DEFAULT '',file_size BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );
  `);
  await dbPool.query(`CREATE INDEX IF NOT EXISTS idx_livebridge_messages_pair ON livebridge_messages(sender_phone,recipient_phone,created_at DESC);`);
  await dbPool.query(`ALTER TABLE livebridge_messages ADD COLUMN IF NOT EXISTS file_data BYTEA;`);
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS livebridge_contacts (
      owner_phone TEXT NOT NULL,
      peer_phone TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(owner_phone, peer_phone)
    );
  `);
  await dbPool.query(`CREATE INDEX IF NOT EXISTS idx_livebridge_contacts_owner ON livebridge_contacts(owner_phone,updated_at DESC);`);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS translation_feedback (
      id SERIAL PRIMARY KEY,
      from_language TEXT NOT NULL,
      to_language TEXT NOT NULL,
      source_text TEXT NOT NULL,
      translated_text TEXT NOT NULL,
      rating TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    );
  `);
  await dbPool.query(`CREATE INDEX IF NOT EXISTS idx_translation_feedback_langs ON translation_feedback(from_language, to_language, created_at DESC);`);

  console.log("Veritabanı tabloları hazır.");
}

// Uygulama içi çağrıları tanımlamak için paylaşımlı anahtar.
// NOT: Mobil uygulamaya gömülen her sabit çıkarılabilir; bu tam bir
// kullanıcı kimlik doğrulaması değil, sadece rastgele bot/scraper
// trafiğini engelleyen bir ilk savunma katmanıdır.
const APP_SHARED_KEY = String(process.env.APP_SHARED_KEY || "").trim();
if (!APP_SHARED_KEY) {
  console.warn(
    "UYARI: APP_SHARED_KEY tanımlı değil. Uç noktalar korumasız çalışıyor.",
  );
}

function requireAppKey(req, res, next) {
  if (!APP_SHARED_KEY) return next(); // env tanımlı değilse geliştirme modunda izin ver
  const provided = String(req.get("x-app-key") || "").trim();
  if (!provided || provided !== APP_SHARED_KEY) {
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
  max: 300, // iki telefon + LiveBridge polling için güvenli üst sınır
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
  if (
    req.path === "/" ||
    req.path === "/health" ||
    req.path.startsWith("/livebridge/chat/file/content/")
  ) {
    return next();
  }
  return requireAppKey(req, res, next);
});

// LiveBridge Contacts Cloud — DATABASE_URL varsa Postgres, yoksa RAM (yedek).
const liveBridgeUsersMem = new Map();
const liveBridgeCallsMem = new Map();
const liveBridgeMessagesMem=[];
const liveBridgeContactsMem=new Map();
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
    gender: row.gender === "male" ? "male" : "female",
    fcmToken: String(row.fcm_token || ""),
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
    callerGender: row.caller_gender === "male" ? "male" : "female",
    calleePhone: row.callee_phone,
    calleeGender: row.callee_gender === "male" ? "male" : "female",
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
        `INSERT INTO livebridge_users (phone, phone_keys, name, language, gender, fcm_token, last_seen)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (phone) DO UPDATE SET
           phone_keys = EXCLUDED.phone_keys,
           name = EXCLUDED.name,
           language = EXCLUDED.language,
           gender = EXCLUDED.gender,
           fcm_token = CASE WHEN EXCLUDED.fcm_token <> '' THEN EXCLUDED.fcm_token ELSE livebridge_users.fcm_token END,
           last_seen = EXCLUDED.last_seen`,
        [user.phone, user.phoneKeys, user.name, user.language, user.gender === "male" ? "male" : "female", String(user.fcmToken || ""), user.lastSeen],
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

  async findUsersByPhoneKeys(requestedKeys) {
    const uniqueKeys = Array.from(new Set(requestedKeys || []))
      .map(normalizeLiveBridgePhone)
      .filter(key => key.length >= 8)
      .slice(0, 12000);
    if (uniqueKeys.length === 0) return [];

    if (dbPool) {
      const {rows} = await dbPool.query(
        "SELECT * FROM livebridge_users WHERE phone_keys && $1::text[]",
        [uniqueKeys],
      );
      return rows.map(rowToUser).filter(Boolean);
    }

    return Array.from(liveBridgeUsersMem.values()).filter(user => {
      const userKeys = liveBridgePhoneKeys(user.phone, user.phoneKeys || []);
      return userKeys.some(key => uniqueKeys.includes(key));
    });
  },

  async saveCall(call) {
    if (dbPool) {
      await dbPool.query(
        `INSERT INTO livebridge_calls
           (id, room_name, caller_phone, caller_name, caller_gender, callee_phone, callee_gender, mode, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           updated_at = EXCLUDED.updated_at`,
        [
          call.id, call.roomName, call.callerPhone, call.callerName,
          call.callerGender === "male" ? "male" : "female",
          call.calleePhone,
          call.calleeGender === "male" ? "male" : "female",
          call.mode, call.status, call.createdAt, call.updatedAt,
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

async function saveLiveBridgeContact(ownerPhone, peerPhone, displayName) {
  const owner = normalizeLiveBridgePhone(ownerPhone);
  const peer = normalizeLiveBridgePhone(peerPhone);
  if (owner.length < 7 || peer.length < 7 || owner === peer) return false;
  const now = liveBridgeNow();
  if (dbPool) {
    await dbPool.query(
      `INSERT INTO livebridge_contacts(owner_phone,peer_phone,display_name,created_at,updated_at)
       VALUES($1,$2,$3,$4,$4)
       ON CONFLICT(owner_phone,peer_phone) DO UPDATE
       SET display_name=EXCLUDED.display_name,updated_at=EXCLUDED.updated_at`,
      [owner, peer, String(displayName || "").slice(0, 100), now],
    );
  } else {
    const key = `${owner}:${peer}`;
    liveBridgeContactsMem.set(key, {
      ownerPhone: owner,
      peerPhone: peer,
      displayName: String(displayName || "").slice(0, 100),
      createdAt: liveBridgeContactsMem.get(key)?.createdAt || now,
      updatedAt: now,
    });
  }
  return true;
}

async function hasLiveBridgeContact(ownerPhone, peerPhone) {
  const owner = normalizeLiveBridgePhone(ownerPhone);
  const peer = normalizeLiveBridgePhone(peerPhone);
  if (owner.length < 7 || peer.length < 7 || owner === peer) return false;
  if (dbPool) {
    const {rows} = await dbPool.query(
      `SELECT 1 FROM livebridge_contacts WHERE owner_phone=$1 AND peer_phone=$2 LIMIT 1`,
      [owner, peer],
    );
    return rows.length > 0;
  }
  return liveBridgeContactsMem.has(`${owner}:${peer}`);
}

async function getSavedLiveBridgeContacts(ownerPhone) {
  const owner = normalizeLiveBridgePhone(ownerPhone);
  if (owner.length < 7) return [];
  let rows = [];
  if (dbPool) {
    const result = await dbPool.query(
      `SELECT peer_phone,display_name,updated_at FROM livebridge_contacts
       WHERE owner_phone=$1 ORDER BY updated_at DESC LIMIT 500`,
      [owner],
    );
    rows = result.rows.map(row => ({
      peerPhone: row.peer_phone,
      displayName: row.display_name,
      updatedAt: Number(row.updated_at || 0),
    }));
  } else {
    rows = Array.from(liveBridgeContactsMem.values())
      .filter(item => item.ownerPhone === owner)
      .sort((a,b) => b.updatedAt - a.updatedAt);
  }

  const users = [];
  for (const row of rows) {
    const user = await liveBridgeStore.findUserByPhoneKeys(
      liveBridgePhoneKeys(row.peerPhone),
    );

    // Kişi satırı Postgres'te kayıtlıysa, kullanıcı profili geçici olarak
    // bulunamasa bile listeyi silme. Rehber kalıcılığı kişi tablosuna dayanır.
    users.push({
      phone: user?.phone || row.peerPhone,
      name: String(row.displayName || user?.name || row.peerPhone).slice(0,100),
      language: user?.language || "",
      gender: user?.gender === "male" ? "male" : "female",
      online: liveBridgeUserOnline(user),
      lastSeen: user?.lastSeen || row.updatedAt || 0,
    });
  }
  return users;
}

async function assertLiveBridgeContact(ownerPhone, peerPhone) {
  const allowed = await hasLiveBridgeContact(ownerPhone, peerPhone);
  if (!allowed) {
    const error = new Error(
      "Bu numara kayıtlı LiveBridge kişilerinizde değil. Önce Kişiler sekmesinden eşleştirin.",
    );
    error.statusCode = 403;
    throw error;
  }
}

app.post("/livebridge/profile/register", async (req, res) => {
  try {
    const phone = normalizeLiveBridgePhone(req.body?.phone);
    const name = String(req.body?.name || "").trim().slice(0, 80);
    const language = String(req.body?.language || "").trim().slice(0, 80);
    const gender = req.body?.gender === "male" ? "male" : "female";
    const incomingFcmToken = String(req.body?.fcmToken || "").trim().slice(0, 4096);
    if (phone.length < 7 || !name) return res.status(400).json({error: "Telefon ve isim gerekli."});
    if (!incomingFcmToken) {
      return res.status(400).json({error: "Bu cihaz doğrulanamadı. Bildirim/Firebase bağlantısını kontrol edin."});
    }

    // Aynı cihaz tokenının her açılışta başka bir telefon numarasına yazılmasını engelle.
    if (dbPool) {
      const {rows: boundRows} = await dbPool.query(
        `SELECT phone FROM livebridge_users WHERE fcm_token=$1 AND phone<>$2 LIMIT 1`,
        [incomingFcmToken, phone],
      );
      if (boundRows.length) {
        return res.status(409).json({
          error: "Bu cihaz başka bir LiveBridge numarasına bağlı. Numara değişikliği için hesap doğrulaması gerekir.",
        });
      }
    } else {
      const bound = Array.from(liveBridgeUsersMem.values()).find(
        user => user.fcmToken === incomingFcmToken && user.phone !== phone,
      );
      if (bound) {
        return res.status(409).json({error: "Bu cihaz başka bir LiveBridge numarasına bağlı."});
      }
    }

    const existing = await liveBridgeStore.getUser(phone);
    if (
      existing?.fcmToken &&
      existing.fcmToken !== incomingFcmToken &&
      liveBridgeUserOnline(existing)
    ) {
      return res.status(409).json({
        error: "Bu LiveBridge numarası başka bir aktif cihazda kullanılıyor.",
      });
    }
    const user = {
      ...(existing || {}),
      phone,
      phoneKeys: liveBridgePhoneKeys(phone, req.body?.phoneKeys),
      name,
      language,
      gender,
      fcmToken: incomingFcmToken,
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
      gender: req.body?.gender === "male" || req.body?.gender === "female" ? req.body.gender : (old.gender || "female"),
      fcmToken: String(req.body?.fcmToken || old.fcmToken || "").trim().slice(0, 4096),
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
    if (ownerPhone.length < 7) {
      return res.status(400).json({error: "LiveBridge sahibi telefon numarası gerekli."});
    }

    const contacts = Array.isArray(req.body?.contacts)
      ? req.body.contacts.slice(0, 3000)
      : [];

    const prepared = contacts
      .map(contact => {
        const phone = normalizeLiveBridgePhone(contact?.phone);
        return {
          contact,
          phone,
          keys: liveBridgePhoneKeys(phone, contact?.keys),
        };
      })
      .filter(item => item.phone && item.phone !== ownerPhone && item.keys.length > 0);

    const allKeys = prepared.flatMap(item => item.keys);
    const registeredUsers = await liveBridgeStore.findUsersByPhoneKeys(allKeys);
    const userByKey = new Map();

    for (const user of registeredUsers) {
      for (const key of liveBridgePhoneKeys(user.phone, user.phoneKeys || [])) {
        if (!userByKey.has(key)) userByKey.set(key, user);
      }
    }

    const users = [];
    const seen = new Set();
    for (const item of prepared) {
      const matched = item.keys.map(key => userByKey.get(key)).find(Boolean);
      if (!matched) continue;
      const identity = normalizeLiveBridgePhone(matched.phone);
      if (!identity || identity === ownerPhone || seen.has(identity)) continue;
      seen.add(identity);
      users.push({
        phone: matched.phone,
        name: String(item.contact?.name || matched.name || "LiveBridge Kullanıcısı").slice(0, 100),
        language: matched.language || "",
        gender: matched.gender === "male" ? "male" : "female",
        online: liveBridgeUserOnline(matched),
        lastSeen: matched.lastSeen || 0,
      });
    }

    users.sort((a, b) =>
      a.online === b.online
        ? String(a.name).localeCompare(String(b.name), "tr")
        : a.online ? -1 : 1,
    );

    for (const user of users) {
      await saveLiveBridgeContact(ownerPhone, user.phone, user.name);
    }

    // Her taramada sadece o an bulunanları dönmek yerine kalıcı AyTalk kişi
    // listesini döndür. Uygulama yeniden açılınca kişilerin kaybolmasını önler.
    const savedUsers = await getSavedLiveBridgeContacts(ownerPhone);
    res.json({ok: true, users: savedUsers});
  } catch (error) {
    console.error("contacts/match hatası:", error);
    res.status(500).json({error: "Kişiler eşleştirilemedi."});
  }
});


app.get("/livebridge/contacts/saved", async (req, res) => {
  try {
    const ownerPhone = normalizeLiveBridgePhone(req.query?.ownerPhone);
    if (ownerPhone.length < 7) {
      return res.status(400).json({error: "Telefon gerekli."});
    }
    const users = await getSavedLiveBridgeContacts(ownerPhone);
    res.json({ok: true, users});
  } catch (error) {
    console.error("contacts/saved hatası:", error);
    res.status(500).json({error: "Kaydedilmiş kişiler alınamadı."});
  }
});

async function lbSaveMessage(m){
  if(dbPool){
    await dbPool.query(`INSERT INTO livebridge_messages
      (id,sender_phone,recipient_phone,sender_name,kind,original_text,translated_text,file_name,mime_type,storage_path,file_size,created_at,file_data)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING`,
      [m.id,m.senderPhone,m.recipientPhone,m.senderName||"",m.kind,m.originalText||"",m.translatedText||"",
       m.fileName||"",m.mimeType||"",m.storagePath||"",Number(m.fileSize||0),Number(m.createdAt||Date.now()),m.fileData||null]);
  } else { liveBridgeMessagesMem.push(m); if(liveBridgeMessagesMem.length>1000)liveBridgeMessagesMem.shift(); }
}
async function lbSigned(path){
  if(!firebaseStorageBucket||!path)return"";
  try{const [u]=await firebaseStorageBucket.file(path).getSignedUrl({action:"read",expires:Date.now()+7*86400000});return u;}catch{return"";}
}
function lbRow(r){return{id:r.id,senderPhone:r.sender_phone??r.senderPhone,recipientPhone:r.recipient_phone??r.recipientPhone,
 senderName:r.sender_name??r.senderName??"",kind:r.kind,originalText:r.original_text??r.originalText??"",
 translatedText:r.translated_text??r.translatedText??"",fileName:r.file_name??r.fileName??"",mimeType:r.mime_type??r.mimeType??"",
 storagePath:r.storage_path??r.storagePath??"",fileSize:Number(r.file_size??r.fileSize??0),createdAt:Number(r.created_at??r.createdAt??0)}}

const LIVEBRIDGE_FILE_SECRET = String(
  process.env.LIVEBRIDGE_FILE_SECRET ||
  APP_SHARED_KEY ||
  process.env.LIVEKIT_API_SECRET ||
  "aytalk-file-fallback",
);
function liveBridgeFileSignature(id, expires) {
  return crypto
    .createHmac("sha256", LIVEBRIDGE_FILE_SECRET)
    .update(`${id}:${expires}`)
    .digest("hex");
}
function liveBridgeDbFileUrl(req, id) {
  const expires = Date.now() + 7 * 86400000;
  const sig = liveBridgeFileSignature(id, expires);
  const forwardedProto = String(req.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim();
  const protocol = forwardedProto || req.protocol || "https";
  return `${protocol}://${req.get("host")}/livebridge/chat/file/content/${encodeURIComponent(id)}?expires=${expires}&sig=${sig}`;
}

app.get("/livebridge/chat/file/content/:id", async (req, res) => {
  try {
    const id = String(req.params?.id || "").slice(0, 180);
    const expires = Number(req.query?.expires || 0);
    const sig = String(req.query?.sig || "");
    const expected = liveBridgeFileSignature(id, expires);
    if (
      !id ||
      !expires ||
      expires < Date.now() ||
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return res.status(403).send("Dosya bağlantısı geçersiz veya süresi dolmuş.");
    }

    let file = null;
    if (dbPool) {
      const {rows} = await dbPool.query(
        `SELECT file_name,mime_type,file_data FROM livebridge_messages WHERE id=$1 AND kind='file' LIMIT 1`,
        [id],
      );
      file = rows[0] || null;
    } else {
      const memory = liveBridgeMessagesMem.find(m => m.id === id && m.kind === "file");
      if (memory) {
        file = {
          file_name: memory.fileName,
          mime_type: memory.mimeType,
          file_data: memory.fileData,
        };
      }
    }
    if (!file?.file_data) return res.status(404).send("Dosya bulunamadı.");
    const safeName = String(file.file_name || "aytalk-dosya").replace(/[\r\n"]/g, "_");
    res.setHeader("Content-Type", file.mime_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(file.file_data);
  } catch (error) {
    console.error("chat/file/content", error);
    res.status(500).send("Dosya açılamadı.");
  }
});

async function sendLiveBridgeIncomingCallPush(call, calleeUser) {
  const token = String(calleeUser?.fcmToken || "").trim();
  if (!firebaseMessaging || !token) return false;
  try {
    await firebaseMessaging.send({
      token,
      data: {
        type: "livebridge_incoming_call",
        callId: String(call.id),
        roomName: String(call.roomName),
        callerPhone: String(call.callerPhone),
        callerName: String(call.callerName),
        callerGender: String(call.callerGender || "female"),
        calleePhone: String(call.calleePhone),
        mode: String(call.mode),
        video: call.mode === "video" ? "true" : "false",
      },
      android: {
        priority: "high",
        ttl: 60 * 1000,
      },
    });
    return true;
  } catch (error) {
    console.error("LiveBridge FCM gönderilemedi:", error?.message || error);
    return false;
  }
}



async function sendLiveBridgeChatPush(recipientPhone, payload) {
  if (!firebaseMessaging) return false;
  try {
    const user = await liveBridgeStore.findUserByPhoneKeys(
      liveBridgePhoneKeys(recipientPhone),
    );
    const token = String(user?.fcmToken || "").trim();
    if (!token) return false;
    await firebaseMessaging.send({
      token,
      data: {
        type: "livebridge_chat",
        senderPhone: String(payload.senderPhone || ""),
        senderName: String(payload.senderName || "LiveBridge"),
        kind: String(payload.kind || "text"),
        preview: String(payload.preview || "").slice(0, 180),
      },
      android: {priority: "high"},
    });
    return true;
  } catch (error) {
    console.error("LiveBridge mesaj push:", error?.message || error);
    return false;
  }
}

app.post("/livebridge/chat/text",async(req,res)=>{
 try{const s=normalizeLiveBridgePhone(req.body?.senderPhone),r=normalizeLiveBridgePhone(req.body?.recipientPhone);
 if(s.length<7||r.length<7)return res.status(400).json({error:"Telefon gerekli."});
 await assertLiveBridgeContact(s,r);
 const m={id:`LBM-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,senderPhone:s,recipientPhone:r,
 senderName:String(req.body?.senderName||"").slice(0,80),kind:"text",originalText:String(req.body?.originalText||"").slice(0,5000),
 translatedText:String(req.body?.translatedText||"").slice(0,5000),createdAt:Date.now()};
 await lbSaveMessage(m);
 void sendLiveBridgeChatPush(r,{senderPhone:s,senderName:m.senderName,kind:"text",preview:m.translatedText||m.originalText});
 res.json({ok:true,message:m});
 }catch(e){console.error("chat/text",e);res.status(e?.statusCode||500).json({error:e?.message||"Mesaj kaydedilemedi."});}
});
app.post("/livebridge/chat/file",async(req,res)=>{
 try{
   const s=normalizeLiveBridgePhone(req.body?.senderPhone),r=normalizeLiveBridgePhone(req.body?.recipientPhone);
   await assertLiveBridgeContact(s,r);
   const name=String(req.body?.fileName||`dosya-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,180);
   const mime=String(req.body?.mimeType||"application/octet-stream").slice(0,120),b64=String(req.body?.dataBase64||"");
   const buf=Buffer.from(b64,"base64");
   if(s.length<7||r.length<7||!b64)return res.status(400).json({error:"Dosya bilgisi eksik."});
   if(buf.length<=0||buf.length>6*1024*1024)return res.status(400).json({error:"Dosya en fazla 6 MB olabilir."});

   const id=`LBF-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
   let storagePath="";
   let fileData=null;
   let url="";

   // Önce Firebase Storage denenir. Bucket yanlış/kapalıysa mesajı çöpe atmak
   // yerine Postgres BYTEA'ya düşer; bu screenshot'taki bucket hatasını keser.
   if(firebaseStorageBucket){
     try{
       const path=`livebridge/${s}/${r}/${id}-${name}`;
       await firebaseStorageBucket.file(path).save(buf,{resumable:false,contentType:mime,metadata:{cacheControl:"private,max-age=3600"}});
       storagePath=path;
       url=await lbSigned(path);
     }catch(storageError){
       console.error("Firebase Storage upload başarısız; Postgres yedeği kullanılacak:",storageError?.message||storageError);
       firebaseStorageBucket=null;
     }
   }

   if(!storagePath){
     if(!dbPool){
       return res.status(503).json({
         error:"Dosya depolama hazır değil. Firebase Storage bucket bulunamadı ve Postgres yedeği yok.",
       });
     }
     storagePath=`db:${id}`;
     fileData=buf;
   }

   const m={id,senderPhone:s,recipientPhone:r,senderName:String(req.body?.senderName||"").slice(0,80),kind:"file",
     fileName:name,mimeType:mime,storagePath,fileSize:buf.length,fileData,createdAt:Date.now()};
   await lbSaveMessage(m);
   if(storagePath.startsWith("db:"))url=liveBridgeDbFileUrl(req,id);
   void sendLiveBridgeChatPush(r,{senderPhone:s,senderName:m.senderName,kind:"file",preview:`📎 ${name}`});
   res.json({ok:true,message:{...m,fileData:undefined,url},storage:storagePath.startsWith("db:")?"postgres":"firebase"});
 }catch(e){
   console.error("chat/file",e);
   res.status(e?.statusCode||500).json({error:e?.message||"Dosya gönderilemedi."});
 }
});

app.get("/livebridge/chat/history",async(req,res)=>{
 try{
  const p=normalizeLiveBridgePhone(req.query?.phone),peer=normalizeLiveBridgePhone(req.query?.peerPhone);
  if(p.length<7||peer.length<7)return res.status(400).json({error:"Telefon gerekli."});
  let list=[];
  if(dbPool){
    const {rows}=await dbPool.query(`SELECT * FROM livebridge_messages
      WHERE (sender_phone=$1 AND recipient_phone=$2) OR (sender_phone=$2 AND recipient_phone=$1)
      ORDER BY created_at ASC LIMIT 160`,[p,peer]);
    list=rows.map(lbRow);
  }else{
    list=liveBridgeMessagesMem.filter(m=>(m.senderPhone===p&&m.recipientPhone===peer)||(m.senderPhone===peer&&m.recipientPhone===p))
      .sort((a,b)=>a.createdAt-b.createdAt).slice(-160);
  }
  const messages=await Promise.all(list.map(async m=>({
    ...m,
    url:m.kind!=="file"
      ?""
      :String(m.storagePath||"").startsWith("db:")
        ?liveBridgeDbFileUrl(req,m.id)
        :await lbSigned(m.storagePath),
  })));
  res.json({ok:true,messages});
 }catch(e){console.error("chat/history",e);res.status(500).json({error:"Sohbet geçmişi alınamadı."});}
});

app.get("/livebridge/chat/recent",async(req,res)=>{
 try{const p=normalizeLiveBridgePhone(req.query?.phone);if(p.length<7)return res.status(400).json({error:"Telefon gerekli."});
 let list=[];if(dbPool){const {rows}=await dbPool.query(`SELECT * FROM livebridge_messages WHERE sender_phone=$1 OR recipient_phone=$1 ORDER BY created_at DESC LIMIT 250`,[p]);list=rows.map(lbRow)}
 else list=liveBridgeMessagesMem.filter(m=>m.senderPhone===p||m.recipientPhone===p).sort((a,b)=>b.createdAt-a.createdAt).slice(0,250);
 const seen=new Set(),recents=[];for(const m of list){const peer=m.senderPhone===p?m.recipientPhone:m.senderPhone;if(!peer||seen.has(peer))continue;seen.add(peer);
 const u=await liveBridgeStore.findUserByPhoneKeys(liveBridgePhoneKeys(peer));recents.push({peerPhone:peer,peerName:u?.name||peer,peerOnline:liveBridgeUserOnline(u),
 lastKind:m.kind,lastText:m.kind==="file"?`📎 ${m.fileName}`:(m.translatedText||m.originalText||"Mesaj"),updatedAt:m.createdAt});if(recents.length>=20)break}
 res.json({ok:true,recents});}catch(e){console.error("chat/recent",e);res.status(500).json({error:"Son görüşmeler alınamadı."});}
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
    const callerUser = await liveBridgeStore.findUserByPhoneKeys(
      liveBridgePhoneKeys(callerPhone),
    );
    if (!callerUser) {
      return res.status(403).json({
        error: "Arama yapan LiveBridge profili doğrulanamadı.",
      });
    }
    if (!(await hasLiveBridgeContact(callerUser.phone, resolvedCalleePhone))) {
      return res.status(403).json({
        error: "Bu numara LiveBridge kişilerinizde kayıtlı değil. Rastgele numaraya doğrudan bağlantı engellendi.",
      });
    }
    callerUser.name = String(
      req.body?.callerName || callerUser.name || "LiveBridge Kullanıcısı",
    ).slice(0, 80);
    callerUser.lastSeen = liveBridgeNow();
    await liveBridgeStore.saveUser(callerUser);

    const id = `LBC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const roomName = `LB-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const call = {
      id, roomName, callerPhone,
      callerName: String(req.body?.callerName || "LiveBridge Kullanıcısı").slice(0, 80),
      callerGender: callerUser?.gender === "male" ? "male" : "female",
      callerLanguage: String(callerUser?.language || "").slice(0, 80),
      calleePhone: resolvedCalleePhone,
      calleeGender: calleeUser.gender === "male" ? "male" : "female",
      calleeLanguage: String(calleeUser?.language || "").slice(0, 80),
      mode: req.body?.mode === "chat" ? "chat" : req.body?.mode === "audio" ? "audio" : "video",
      status: "ringing", createdAt: liveBridgeNow(), updatedAt: liveBridgeNow(),
    };
    await liveBridgeStore.saveCall(call);
    // Push sonucu loglanır; başarısız olsa bile açık-app polling devam eder.
    const pushSent = await sendLiveBridgeIncomingCallPush(call, calleeUser);
    console.log(
      `LiveBridge arama ${call.id}: ${callerPhone} -> ${resolvedCalleePhone}; push=${pushSent ? "OK" : "YOK"}`,
    );
    res.json({ok: true, call, pushSent});
  } catch (error) {
    console.error("call/start hatası:", error);
    res.status(error?.statusCode || 500).json({error: error?.message || "Arama başlatılamadı."});
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
    if (req.body?.accepted) {
      await saveLiveBridgeContact(call.calleePhone, call.callerPhone, call.callerName);
      const calleeUser = await liveBridgeStore.findUserByPhoneKeys(liveBridgePhoneKeys(call.calleePhone));
      await saveLiveBridgeContact(call.callerPhone, call.calleePhone, calleeUser?.name || call.calleePhone);
    }
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
  res.json({authConfigured: Boolean(APP_SHARED_KEY), ok: true, service: "LiveBridge", version: "11.0-realtime-bridge"});
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
      .slice(-18)
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

    const liveBridgeTranslationModel =
      String(process.env.LIVEBRIDGE_TRANSLATION_MODEL || "gpt-4.1").trim();

    const response = await openai.responses.create({
      model: liveBridgeTranslationModel,
      store: false,
      max_output_tokens: Math.min(1200, Math.max(80, Math.ceil(message.length * 1.6))),
      instructions:
        "You are LiveBridge, a professional real-time human interpreter. " +
        `Translate ONLY the CURRENT utterance from ${from} to ${to}. ` +
        "The dialogue history may contain both speakers. Use it to resolve pronouns, references, names, terminology, register and implied subjects. Keep names and terminology consistent across turns unless the speaker clearly changes them. " +
        "Do not translate previous turns again. Do not answer either speaker. " +
        "Before translating, silently repair only obvious speech-to-text slips when the intended wording is unambiguous from the current sentence and dialogue context; never invent missing meaning. " +
        "Resolve omitted subjects, pronouns and short colloquial fragments from the conversation only when the context makes them clear. " +
        "Never add facts, explanations, summaries, politeness, completions, diagnoses, advice or guesses. " +
        "Preserve names, numbers, units, dates, negation, uncertainty, question form and professional terminology exactly in meaning. " +
        "For medical, legal or technical terms, prefer the standard target-language term and do not simplify unless the speaker simplified it. " +
        "If CURRENT_UTTERANCE is incomplete, translate it as an incomplete fragment rather than inventing the ending. " +
        "Keep the speaker's tone and level of formality. " +
        "Translate culturally meaningful kinship terms, honorifics, forms of address, idioms and discourse markers by their FUNCTION and meaning in the current context, not by superficial spelling. " +
        "A normal spoken word that happens to look like a Latin-letter abbreviation must remain a word; do not reinterpret it as an acronym unless context clearly shows an acronym, company name or initialism. " +
        "When an address term has a natural target-language equivalent, use that equivalent while preserving relationship, respect and register. " +
        "Do not transliterate ordinary vocabulary when an established target-language translation exists. Preserve proper names and genuine acronyms. " +
        "CRITICAL — register matching: the speaker may use informal, rural, regional, dialectal, or uneducated everyday speech, " +
        "non-standard grammar, slang, or spoken-language shortcuts. Understand and correctly interpret ANY regional dialect, " +
        "country-specific accent-influenced spelling, or local slang on the input side, no matter which country or region it " +
        "comes from. Render the MEANING in equally informal, everyday spoken language in the target language, but always in the " +
        "most widely understood, standard/neutral form of that target language — not a narrow dialect or slang specific to a " +
        "single country or region — so that a speaker of that language from ANY country or region can understand it. " +
        "NEVER upgrade informal speech into formal, literary, official, or textbook-correct language, and never narrow it down " +
        "into a hyper-local regional dialect either. Match the register (formal/informal) down, not up — but keep the dialect " +
        "choice as the broadest, most globally intelligible standard variety of the target language. " +
        "If source language is Auto, infer it silently from the utterance and context. Never mix languages except proper names, genuine acronyms or unavoidable quoted terms. " + "Return ONLY the translation of CURRENT_UTTERANCE.",
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
      // Kalite için mini model (nano yerine) — konuşma dili/lehçe çevirisinde
      // gözle görülür fark yaratıyor.
      model: "gpt-4.1-mini",
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
        "Use the natural target-language equivalent for ordinary vocabulary and address terms. " +
        "CRITICAL — register matching: the speaker may use informal, rural, regional, dialectal, or uneducated everyday speech, " +
        "non-standard grammar, slang, or spoken-language shortcuts. Understand and correctly interpret ANY regional dialect, " +
        "country-specific accent-influenced spelling, or local slang on the input side, no matter which country or region it " +
        "comes from. Render the MEANING in equally informal, everyday spoken language in the target language, but always in the " +
        "most widely understood, standard/neutral form of that target language — not a narrow dialect or slang specific to a " +
        "single country or region — so that a speaker of that language from ANY country or region can understand it. " +
        "NEVER upgrade informal speech into formal, literary, official, or textbook-correct language, and never narrow it down " +
        "into a hyper-local regional dialect either. Match the register (formal/informal) down, not up — but keep the dialect " +
        "choice as the broadest, most globally intelligible standard variety of the target language. If the input is broken or " +
        "ungrammatical because that is how the speaker naturally talks, the translation should sound just as plain and natural " +
        "— not more polished than the original — while still using vocabulary and phrasing any native speaker of that language, " +
        "anywhere in the world, would immediately recognize.",

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
      model: "gpt-4.1-mini",
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
        "Use the natural target-language equivalent for ordinary vocabulary and address terms. " +
        "CRITICAL — register matching: the speaker may use informal, rural, regional, dialectal, or uneducated everyday speech, " +
        "non-standard grammar, slang, or spoken-language shortcuts. Understand and correctly interpret ANY regional dialect, " +
        "country-specific accent-influenced spelling, or local slang on the input side, no matter which country or region it " +
        "comes from. Render the MEANING in equally informal, everyday spoken language in the target language, but always in the " +
        "most widely understood, standard/neutral form of that target language — not a narrow dialect or slang specific to a " +
        "single country or region — so that a speaker of that language from ANY country or region can understand it. " +
        "NEVER upgrade informal speech into formal, literary, official, or textbook-correct language, and never narrow it down " +
        "into a hyper-local regional dialect either. Match the register (formal/informal) down, not up — but keep the dialect " +
        "choice as the broadest, most globally intelligible standard variety of the target language.",
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

    // Cinsiyete göre OpenAI ses modeli seçimi.
    // "male": onyx (derin/erkeksi) — "female": coral (varsayılan, kadınsı)
    const requestedGender =
      String(req.body?.gender || req.body?.voiceStyle?.voice || "")
        .trim()
        .toLowerCase();
    const voice = requestedGender === "male" ? "onyx" : "coral";

    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      response_format: "mp3",
      instructions: language
        ? `You are a native ${language} speaker recording a warm, natural voice message for a friend. ` +
          `Speak with the authentic accent, rhythm, and intonation a real native speaker of ${language} would use — not a flat or robotic reading. ` +
          "Use natural pacing with brief, human-like pauses at commas and sentence breaks. Vary pitch naturally as a person would in casual conversation. " +
          `Read every numeral, numbered-list marker, date and quantity in ${language}; never switch to another language just because the input contains digits such as 1, 2 or 3. ` +
          "Pronounce ordinary words as words, not as letter-by-letter acronyms, unless clearly intended as an acronym."
        : "Speak naturally and clearly, like a real person in casual conversation, with natural rhythm and pauses. Pronounce ordinary words as words.",
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

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "destek@aytalk.app";

app.post("/feedback/translation", async (req, res) => {
  try {
    const fromLanguage = String(req.body?.from || "").trim().slice(0, 80);
    const toLanguage = String(req.body?.to || "").trim().slice(0, 80);
    const sourceText = String(req.body?.sourceText || "").trim().slice(0, 2000);
    const translatedText = String(req.body?.translatedText || "").trim().slice(0, 2000);
    const rating = req.body?.rating === "good" ? "good" : "bad";
    const note = String(req.body?.note || "").trim().slice(0, 500);

    if (!fromLanguage || !toLanguage || !translatedText) {
      return res.status(400).json({error: "Eksik bilgi."});
    }

    if (dbPool) {
      await dbPool.query(
        `INSERT INTO translation_feedback
           (from_language, to_language, source_text, translated_text, rating, note, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [fromLanguage, toLanguage, sourceText, translatedText, rating, note, Date.now()],
      );
    } else {
      console.log("[geri bildirim - RAM modu, kalıcı değil]", {fromLanguage, toLanguage, rating, note});
    }

    res.json({ok: true});
  } catch (error) {
    console.error("feedback/translation hatası:", error);
    if (process.env.SENTRY_DSN) Sentry.captureException(error);
    res.status(500).json({error: "Geri bildirim kaydedilemedi."});
  }
});

app.get("/privacy", (_req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AyTalk — Gizlilik Politikası</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:0 auto;padding:32px 20px;line-height:1.6;color:#1a1a1a;background:#fff}
  h1{font-size:26px} h2{font-size:19px;margin-top:32px}
  p,li{font-size:15px;color:#333}
  .updated{color:#777;font-size:13px;margin-bottom:24px}
</style>
</head>
<body>
<h1>AyTalk — Gizlilik Politikası</h1>
<p class="updated">Son güncelleme: ${new Date().toLocaleDateString("tr-TR", {year:"numeric",month:"long",day:"numeric"})}</p>

<p>AyTalk ("uygulama", "biz"), kullanıcılarının ("siz") gizliliğine önem verir. Bu belge, uygulamayı kullanırken hangi verilerin toplandığını, nasıl kullanıldığını ve haklarınızı açıklar.</p>

<h2>1. Topladığımız Veriler</h2>
<ul>
  <li><b>Hesap bilgileri:</b> telefon numarası, görünen ad, tercih edilen dil, ses cinsiyeti tercihi (LiveBridge özelliği için)</li>
  <li><b>Çeviri verileri:</b> yazılı/sesli çeviri istekleriniz, konuşma tanıma için gönderilen ses kayıtları (kalıcı olarak saklanmaz, sadece işlenip silinir)</li>
  <li><b>Rehber eşleştirme:</b> LiveBridge özelliğini kullanırken, rehberinizdeki kişilerin telefon numaraları uygulamamızın kullanıcısı olup olmadığını kontrol etmek için sunucumuza gönderilir (isimleriyle birlikte saklanmaz, sadece eşleştirme için kullanılır)</li>
  <li><b>Görüşme meta verileri:</b> kimin kimi aradığı, görüşme süresi ve durumu (görüşmenin ses/görüntü içeriği kaydedilmez)</li>
  <li><b>Cihaz izinleri:</b> mikrofon, kamera, kişiler — sadece ilgili özellik kullanılırken erişilir</li>
</ul>

<h2>2. Verileri Nasıl Kullanıyoruz</h2>
<ul>
  <li>Çeviri, konuşma tanıma ve metinden sese dönüştürme hizmetlerini sağlamak için üçüncü taraf yapay zeka servisine (OpenAI) iletilir</li>
  <li>Sesli/görüntülü görüşmeleri bağlamak için üçüncü taraf altyapı servisine (LiveKit) iletilir</li>
  <li>LiveBridge kişi eşleştirmesi ve arama geçmişi için veritabanımızda saklanır</li>
</ul>

<h2>3. Üçüncü Taraflar</h2>
<p>Verileriniz aşağıdaki hizmet sağlayıcılarla, yalnızca hizmeti sunmak amacıyla paylaşılır: OpenAI (çeviri/ses işleme), LiveKit (görüşme altyapısı), Render (sunucu barındırma), Supabase (veritabanı barındırma). Bu üçüncü taraflara veri satışı yapılmaz.</p>

<h2>4. Veri Saklama</h2>
<p>Ses kayıtları işlendikten hemen sonra silinir. LiveBridge profil bilgileri ve arama geçmişi, hesabınızı silene kadar saklanır.</p>

<h2>5. Haklarınız</h2>
<p>Verilerinizin silinmesini istediğinizde bizimle iletişime geçebilirsiniz. Uygulamayı kaldırmak, cihazınızdaki yerel verileri siler; sunucudaki hesap verilerinizin silinmesi için ayrıca talep etmeniz gerekir.</p>

<h2>6. İletişim</h2>
<p>Sorularınız için: <b>${SUPPORT_EMAIL}</b></p>

</body>
</html>`);
});

app.get("/terms", (_req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AyTalk — Kullanım Şartları</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:0 auto;padding:32px 20px;line-height:1.6;color:#1a1a1a;background:#fff}
  h1{font-size:26px} h2{font-size:19px;margin-top:32px}
  p,li{font-size:15px;color:#333}
  .updated{color:#777;font-size:13px;margin-bottom:24px}
</style>
</head>
<body>
<h1>AyTalk — Kullanım Şartları</h1>
<p class="updated">Son güncelleme: ${new Date().toLocaleDateString("tr-TR", {year:"numeric",month:"long",day:"numeric"})}</p>

<h2>1. Kabul</h2>
<p>AyTalk'ı kullanarak bu şartları kabul etmiş olursunuz.</p>

<h2>2. Hizmetin Tanımı</h2>
<p>AyTalk, yapay zeka destekli yazılı/sesli/görüntülü çeviri ve LiveBridge adlı çevirili görüşme özelliği sunar.</p>

<h2>3. Kullanıcı Sorumlulukları</h2>
<ul>
  <li>Uygulamayı yasa dışı amaçlarla kullanamazsınız</li>
  <li>Başka kullanıcıları taciz, tehdit veya dolandırma amacıyla kullanamazsınız</li>
  <li>Hesap bilgilerinizin güvenliğinden siz sorumlusunuz</li>
</ul>

<h2>4. Sorumluluk Sınırlaması</h2>
<p>Çeviriler yapay zeka tarafından üretilir ve %100 doğruluk garanti edilmez. Tıbbi, hukuki veya acil durumlarda profesyonel/resmi çeviri hizmetlerine başvurulması önerilir.</p>

<h2>5. İletişim</h2>
<p>Sorularınız için: <b>${SUPPORT_EMAIL}</b></p>

</body>
</html>`);
});

// Tanımsız uç noktalar için 404.
app.use((req, res) => {
  res.status(404).json({error: "Uç nokta bulunamadı."});
});

// Express hata yakalayıcı (4 parametreli imza şart).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Beklenmeyen sunucu hatası:", err);
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
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
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
});

process.on("unhandledRejection", reason => {
  console.error("İŞLENMEMİŞ PROMISE REDDİ:", reason);
  if (process.env.SENTRY_DSN) Sentry.captureException(reason);
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
      console.log(
        `LiveBridge çeviri modeli: ${
          process.env.LIVEBRIDGE_TRANSLATION_MODEL || "gpt-4.1"
        }`,
      );
      console.log("================================");
    });
  });
