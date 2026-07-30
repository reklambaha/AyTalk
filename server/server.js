require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({limit: "2mb"}));

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY bulunamadı.");
  process.exit(1);
}

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY});

app.get("/", (_req, res) => {
  res.send("AyTalk Server Çalışıyor");
});

app.get("/health", (_req, res) => {
  res.json({ok: true, service: "AyTalk"});
});

app.post("/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const from = String(req.body?.from || "Turkish").trim();
    const to = String(req.body?.to || "English").trim();

    if (!message) return res.status(400).json({error: "Mesaj boş."});
    if (message.length > 12000) {
      return res.status(400).json({error: "Metin çok uzun. En fazla 12.000 karakter gönder."});
    }

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      store: false,
      max_output_tokens: Math.min(4000, Math.max(300, Math.ceil(message.length * 1.8))),
      instructions:
        "You are AyTalk, a fast and accurate natural-language translator. " +
        "Return only the translated text. Never explain, label, quote, summarize, " +
        "or add commentary. Preserve names, numbers, meaning, tone, punctuation, " +
        "paragraphs, and question/statement form.",
      input:
        `Source language: ${from}\n` +
        `Target language: ${to}\n\n` +
        `Text:\n${message}`,
    });

    const reply = String(response.output_text || "").trim();
    if (!reply) throw new Error("OpenAI boş yanıt döndürdü.");

    return res.json({reply});
  } catch (error) {
    console.error("Translation error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Bilinmeyen sunucu hatası.",
    });
  }
});

app.post("/assistant", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const language = String(req.body?.language || "Turkish").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];

    if (!message) return res.status(400).json({error: "Mesaj boş."});
    if (message.length > 8000) {
      return res.status(400).json({error: "Mesaj çok uzun. En fazla 8.000 karakter gönder."});
    }

    const safeHistory = history
      .filter(item => item && (item.role === "user" || item.role === "assistant"))
      .map(item => ({
        role: item.role,
        content: String(item.content || "").slice(0, 4000),
      }));

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      store: false,
      max_output_tokens: 1200,
      instructions:
        `You are AyTalk AI, a helpful, practical, friendly assistant. ` +
        `Always answer in ${language}, unless the user explicitly requests another language. ` +
        "Give clear answers. Ask a brief clarification only when truly necessary. " +
        "Do not claim to have performed actions you cannot perform.",
      input: [...safeHistory, {role: "user", content: message}],
    });

    const reply = String(response.output_text || "").trim();
    if (!reply) throw new Error("OpenAI boş yanıt döndürdü.");

    return res.json({reply});
  } catch (error) {
    console.error("Assistant error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Bilinmeyen sunucu hatası.",
    });
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
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Bilinmeyen seslendirme hatası.",
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("================================");
  console.log("AyTalk Server Başladı");
  console.log(`Port: ${PORT}`);
  console.log("================================");
});
