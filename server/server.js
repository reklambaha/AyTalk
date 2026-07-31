require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ITEMS = 500;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 20000,
  maxRetries: 1,
});

const translationCache = new Map();

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({limit: "2mb"}));

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY bulunamadı.");
  process.exit(1);
}

function normalize(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function cacheKey(message, from, to) {
  return `${from.toLowerCase()}|${to.toLowerCase()}|${normalize(message).toLowerCase()}`;
}

function getCachedTranslation(key) {
  const item = translationCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    translationCache.delete(key);
    return null;
  }
  translationCache.delete(key);
  translationCache.set(key, item);
  return item.reply;
}

function setCachedTranslation(key, reply) {
  translationCache.set(key, {reply, expiresAt: Date.now() + CACHE_TTL_MS});
  while (translationCache.size > CACHE_MAX_ITEMS) {
    const oldest = translationCache.keys().next().value;
    if (!oldest) break;
    translationCache.delete(oldest);
  }
}

function writePacket(res, packet) {
  res.write(`${JSON.stringify(packet)}\n`);
}

function startStream(res) {
  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

function isTimeoutError(error) {
  return (
    error?.name === "APIConnectionTimeoutError" ||
    String(error?.message || "").toLowerCase().includes("timeout")
  );
}

function publicError(error, fallback) {
  if (isTimeoutError(error)) return "Sunucu zaman aşımına uğradı. Tekrar dene.";
  return error instanceof Error && error.message ? error.message : fallback;
}

function validateTranslationBody(body) {
  const message = String(body?.message || "").trim();
  const from = String(body?.from || "Turkish").trim();
  const to = String(body?.to || "English").trim();

  if (!message) return {error: "Mesaj boş."};
  if (message.length > 12000) {
    return {error: "Metin çok uzun. En fazla 12.000 karakter gönder."};
  }
  return {message, from, to};
}

function buildAssistantInput(body) {
  const message = String(body?.message || "").trim();
  const language = String(body?.language || "Turkish").trim();
  const history = Array.isArray(body?.history) ? body.history.slice(-8) : [];

  if (!message) return {error: "Mesaj boş."};
  if (message.length > 8000) {
    return {error: "Mesaj çok uzun. En fazla 8.000 karakter gönder."};
  }

  const safeHistory = history
    .filter(item => item && (item.role === "user" || item.role === "assistant"))
    .map(item => ({
      role: item.role,
      content: String(item.content || "").slice(0, 2500),
    }));

  return {message, language, safeHistory};
}

app.get("/", (_req, res) => {
  res.send("AyTalk Server Çalışıyor");
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "AyTalk",
    version: "2.2-streaming",
    cacheItems: translationCache.size,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.post("/chat", async (req, res) => {
  const startedAt = Date.now();
  try {
    const parsed = validateTranslationBody(req.body);
    if (parsed.error) return res.status(400).json({error: parsed.error});

    const {message, from, to} = parsed;
    const key = cacheKey(message, from, to);
    const cached = getCachedTranslation(key);
    if (cached) {
      return res.json({reply: cached, elapsedMs: Date.now() - startedAt, cached: true});
    }

    const response = await openai.responses.create({
      model: "gpt-4.1-nano",
      store: false,
      max_output_tokens: Math.min(3000, Math.max(120, Math.ceil(message.length * 1.35))),
      instructions:
        `Translate from ${from} to ${to}. ` +
        "Return only the translation. Preserve meaning, names, numbers, punctuation, paragraphs, tone, and question form.",
      input: message,
    });

    const reply = String(response.output_text || "").trim();
    if (!reply) throw new Error("OpenAI boş yanıt döndürdü.");

    setCachedTranslation(key, reply);
    return res.json({reply, elapsedMs: Date.now() - startedAt, cached: false});
  } catch (error) {
    const status = isTimeoutError(error) ? 504 : 500;
    console.error(`Translation error after ${Date.now() - startedAt} ms:`, error);
    return res.status(status).json({error: publicError(error, "Bilinmeyen sunucu hatası.")});
  }
});

app.post("/chat/stream", async (req, res) => {
  const startedAt = Date.now();
  const parsed = validateTranslationBody(req.body);
  if (parsed.error) return res.status(400).json({error: parsed.error});

  const {message, from, to} = parsed;
  const key = cacheKey(message, from, to);
  const cached = getCachedTranslation(key);
  startStream(res);

  if (cached) {
    writePacket(res, {type: "delta", text: cached});
    writePacket(res, {type: "done", text: cached, cached: true, elapsedMs: Date.now() - startedAt});
    return res.end();
  }

  let fullText = "";
  try {
    const stream = await openai.responses.create({
      model: "gpt-4.1-nano",
      store: false,
      stream: true,
      max_output_tokens: Math.min(3000, Math.max(120, Math.ceil(message.length * 1.35))),
      instructions:
        `Translate from ${from} to ${to}. ` +
        "Return only the translation. Preserve meaning, names, numbers, punctuation, paragraphs, tone, and question form.",
      input: message,
    });

    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && event.delta) {
        fullText += event.delta;
        writePacket(res, {type: "delta", text: event.delta});
      }
    }

    fullText = fullText.trim();
    if (!fullText) throw new Error("OpenAI boş yanıt döndürdü.");
    setCachedTranslation(key, fullText);
    writePacket(res, {type: "done", text: fullText, cached: false, elapsedMs: Date.now() - startedAt});
    res.end();
  } catch (error) {
    console.error(`Streaming translation error after ${Date.now() - startedAt} ms:`, error);
    writePacket(res, {type: "error", message: publicError(error, "Çeviri akışı başarısız oldu.")});
    res.end();
  }
});

app.post("/assistant", async (req, res) => {
  const startedAt = Date.now();
  try {
    const parsed = buildAssistantInput(req.body);
    if (parsed.error) return res.status(400).json({error: parsed.error});

    const {message, language, safeHistory} = parsed;
    const response = await openai.responses.create({
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
    if (!reply) throw new Error("OpenAI boş yanıt döndürdü.");
    return res.json({reply, elapsedMs: Date.now() - startedAt});
  } catch (error) {
    console.error(`Assistant error after ${Date.now() - startedAt} ms:`, error);
    return res.status(isTimeoutError(error) ? 504 : 500).json({
      error: publicError(error, "Bilinmeyen sunucu hatası."),
    });
  }
});

app.post("/assistant/stream", async (req, res) => {
  const startedAt = Date.now();
  const parsed = buildAssistantInput(req.body);
  if (parsed.error) return res.status(400).json({error: parsed.error});

  const {message, language, safeHistory} = parsed;
  startStream(res);
  let fullText = "";

  try {
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

    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && event.delta) {
        fullText += event.delta;
        writePacket(res, {type: "delta", text: event.delta});
      }
    }

    fullText = fullText.trim();
    if (!fullText) throw new Error("OpenAI boş yanıt döndürdü.");
    writePacket(res, {type: "done", text: fullText, elapsedMs: Date.now() - startedAt});
    res.end();
  } catch (error) {
    console.error(`Streaming assistant error after ${Date.now() - startedAt} ms:`, error);
    writePacket(res, {type: "error", message: publicError(error, "Asistan akışı başarısız oldu.")});
    res.end();
  }
});

app.post("/tts", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    const language = String(req.body?.language || "").trim();

    if (!text) return res.status(400).json({error: "Seslendirilecek metin boş."});
    if (text.length > 4096) {
      return res.status(400).json({error: "Seslendirme metni en fazla 4.096 karakter olabilir."});
    }

    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "coral",
      input: text,
      response_format: "mp3",
      instructions: language
        ? `Speak naturally and clearly in ${language}.`
        : "Speak naturally and clearly.",
    });

    const buffer = Buffer.from(await speech.arrayBuffer());
    return res.json({audioBase64: buffer.toString("base64")});
  } catch (error) {
    console.error("TTS error:", error);
    return res.status(500).json({error: publicError(error, "Bilinmeyen seslendirme hatası.")});
  }
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled server error:", error);
  res.status(500).json({error: "Sunucuda beklenmeyen bir hata oluştu."});
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("================================");
  console.log("AyTalk v2.2 Streaming Server Başladı");
  console.log(`Port: ${PORT}`);
  console.log("Translation: gpt-4.1-nano + streaming + cache");
  console.log("Assistant: gpt-4.1-mini + streaming");
  console.log("================================");
});
