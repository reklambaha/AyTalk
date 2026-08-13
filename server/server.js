require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const {toFile} = require("openai");
const {AccessToken} = require("livekit-server-sdk");

const app = express();
const PORT = process.env.PORT || 3000;

// Uzun süre beklemeyi ve gereksiz tekrarları azaltır.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 20000,
  maxRetries: 1,
});

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({limit: "12mb"}));

// LiveBridge Contacts Demo Cloud — in-memory demo signaling.
const liveBridgeUsers = new Map();
const liveBridgeCalls = new Map();
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

function findLiveBridgeUserByPhone(value, suppliedKeys = []) {
  const requestedKeys = new Set(liveBridgePhoneKeys(value, suppliedKeys));

  for (const user of liveBridgeUsers.values()) {
    const userKeys = liveBridgePhoneKeys(user.phone, user.phoneKeys || []);
    if (userKeys.some(key => requestedKeys.has(key))) {
      return user;
    }
  }

  return null;
}
const liveBridgeNow = () => Date.now();
const liveBridgeUserOnline = user => Boolean(user && liveBridgeNow() - Number(user.lastSeen || 0) < 45000);
function cleanExpiredLiveBridgeCalls() {
  const now = liveBridgeNow();
  for (const [id, call] of liveBridgeCalls.entries()) {
    if (call.status === "ringing" && now - call.createdAt > 60000) liveBridgeCalls.set(id,{...call,status:"expired",updatedAt:now});
    if (now - call.createdAt > 600000) liveBridgeCalls.delete(id);
  }
}
app.post("/livebridge/profile/register",(req,res)=>{
  const phone=normalizeLiveBridgePhone(req.body?.phone);
  const name=String(req.body?.name||"").trim().slice(0,80);
  const language=String(req.body?.language||"").trim().slice(0,80);
  if(phone.length<7||!name) return res.status(400).json({error:"Telefon ve isim gerekli."});
  const user={
    ...(liveBridgeUsers.get(phone)||{}),
    phone,
    phoneKeys: liveBridgePhoneKeys(phone, req.body?.phoneKeys),
    name,
    language,
    lastSeen:liveBridgeNow()
  };
  liveBridgeUsers.set(phone,user);
  res.json({ok:true,user:{...user,online:true}});
});
app.post("/livebridge/presence",(req,res)=>{
  const phone=normalizeLiveBridgePhone(req.body?.phone);
  if(phone.length<7) return res.status(400).json({error:"Telefon gerekli."});
  const old=liveBridgeUsers.get(phone)||{};
  const user={
    ...old,
    phone,
    phoneKeys: liveBridgePhoneKeys(phone, req.body?.phoneKeys || old.phoneKeys),
    name:String(req.body?.name||old.name||"LiveBridge Kullanıcısı").slice(0,80),
    language:String(req.body?.language||old.language||"").slice(0,80),
    lastSeen:liveBridgeNow()
  };
  liveBridgeUsers.set(phone,user); res.json({ok:true,lastSeen:user.lastSeen});
});
app.post("/livebridge/contacts/match",(req,res)=>{
  const ownerPhone=normalizeLiveBridgePhone(req.body?.ownerPhone);
  const contacts=Array.isArray(req.body?.contacts)?req.body.contacts.slice(0,3000):[];
  const users=[]; const seen=new Set();
  for(const c of contacts){
    const phone=normalizeLiveBridgePhone(c?.phone);
    if(!phone||phone===ownerPhone||seen.has(phone)) continue;
    const r=findLiveBridgeUserByPhone(phone,c?.keys); if(!r) continue;
    const matchedIdentity = normalizeLiveBridgePhone(r.phone);
    if (seen.has(matchedIdentity)) continue;
    seen.add(matchedIdentity);
    users.push({phone:r.phone,name:String(c?.name||r.name||"LiveBridge Kullanıcısı").slice(0,100),
      language:r.language||"",online:liveBridgeUserOnline(r),lastSeen:r.lastSeen||0});
  }
  users.sort((a,b)=>a.online===b.online?String(a.name).localeCompare(String(b.name),"tr"):(a.online?-1:1));
  res.json({ok:true,users});
});
app.post("/livebridge/call/start",(req,res)=>{
  cleanExpiredLiveBridgeCalls();
  const callerPhone=normalizeLiveBridgePhone(req.body?.callerPhone);
  const calleePhone=normalizeLiveBridgePhone(req.body?.calleePhone);
  if(callerPhone.length<7||calleePhone.length<7||callerPhone===calleePhone) return res.status(400).json({error:"Geçersiz arama bilgisi."});
  const calleeUser = findLiveBridgeUserByPhone(calleePhone);
  if(!calleeUser) return res.status(404).json({error:"Kişi LiveBridge'de bulunamadı."});
  const resolvedCalleePhone = calleeUser.phone;
  const id=`LBC-${Math.random().toString(36).slice(2,10).toUpperCase()}`;
  const roomName=`LB-${Math.random().toString(36).slice(2,10).toUpperCase()}`;
  const call={id,roomName,callerPhone,callerName:String(req.body?.callerName||"LiveBridge Kullanıcısı").slice(0,80),
    calleePhone:resolvedCalleePhone,mode:req.body?.mode==="chat"?"chat":req.body?.mode==="audio"?"audio":"video",status:"ringing",createdAt:liveBridgeNow(),updatedAt:liveBridgeNow()};
  liveBridgeCalls.set(id,call); res.json({ok:true,call});
});
app.get("/livebridge/call/incoming",(req,res)=>{
  cleanExpiredLiveBridgeCalls(); const phone=normalizeLiveBridgePhone(req.query?.phone);
  const call=Array.from(liveBridgeCalls.values()).filter(c=>c.calleePhone===phone&&c.status==="ringing").sort((a,b)=>b.createdAt-a.createdAt)[0];
  res.json({ok:true,call:call||null});
});
app.post("/livebridge/call/respond",(req,res)=>{
  cleanExpiredLiveBridgeCalls(); const id=String(req.body?.callId||""); const phone=normalizeLiveBridgePhone(req.body?.calleePhone);
  const call=liveBridgeCalls.get(id); if(!call||call.calleePhone!==phone) return res.status(404).json({error:"Arama bulunamadı."});
  const updated={...call,status:req.body?.accepted?"accepted":"rejected",updatedAt:liveBridgeNow()}; liveBridgeCalls.set(id,updated);
  res.json({ok:true,call:updated});
});
app.get("/livebridge/call/status/:id",(req,res)=>{
  cleanExpiredLiveBridgeCalls(); const call=liveBridgeCalls.get(String(req.params?.id||""));
  if(!call) return res.status(404).json({error:"Arama bulunamadı."}); res.json({ok:true,call});
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
  res.json({ok: true, service: "LiveBridge", version: "10.1-native-stt"});
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

app.listen(PORT, "0.0.0.0", () => {
  console.log("================================");
  console.log("AyTalk Fast Server Başladı");
  console.log(`Port: ${PORT}`);
  console.log("Model: gpt-4.1-nano (translation)");
  console.log("================================");
});
