require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY bulunamadı.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get("/", (req, res) => res.send("AyTalk Server Çalışıyor"));

app.post("/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const from = String(req.body?.from || "Turkish").trim();
    const to = String(req.body?.to || "English").trim();
    if (!message) return res.status(400).json({ error: "Mesaj boş." });
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      instructions: "You are AyTalk, an accurate natural-language translator. Return only the translated text. Do not explain, label, quote, summarize, censor, or add commentary. Preserve names, numbers, meaning, tone, punctuation, and question/statement form.",
      input: `Source language: ${from}\nTarget language: ${to}\n\nText:\n${message}`,
    });
    const reply = String(response.output_text || "").trim();
    if (!reply) throw new Error("OpenAI boş yanıt döndürdü.");
    res.json({ reply });
  } catch (error) {
    console.error("AyTalk translation error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Bilinmeyen çeviri hatası." });
  }
});

app.post("/tts", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    const language = String(req.body?.language || "English").trim();
    if (!text) return res.status(400).json({ error: "Seslendirilecek metin boş." });
    if (text.length > 4000) return res.status(400).json({ error: "Seslendirilecek metin çok uzun." });
    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: text,
      instructions: `Speak naturally and clearly in ${language}. Use a warm, calm conversational tone. Do not translate, explain, or add any words.`,
      response_format: "mp3",
    });
    const audioBuffer = Buffer.from(await speech.arrayBuffer());
    res.json({ audioBase64: audioBuffer.toString("base64"), mimeType: "audio/mpeg" });
  } catch (error) {
    console.error("AyTalk TTS error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Bilinmeyen seslendirme hatası." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("================================");
  console.log("AyTalk Server Başladı");
  console.log(`Port: ${PORT}`);
  console.log("================================");
});
