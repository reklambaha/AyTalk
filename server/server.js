require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({limit: "1mb"}));

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY bulunamadı.");
  process.exit(1);
}

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY});

app.get("/", (req, res) => {
  res.send("AyTalk Server Çalışıyor");
});

app.post("/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const from = String(req.body?.from || "Turkish").trim();
    const to = String(req.body?.to || "English").trim();

    if (!message) {
      return res.status(400).json({error: "Mesaj boş."});
    }

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      instructions:
        "You are AyTalk, an accurate natural-language translator. " +
        "Return only the translated text. Do not explain, label, quote, " +
        "summarize, or add commentary. Preserve names, numbers, meaning, " +
        "tone, punctuation, and question/statement form.",
      input:
        `Source language: ${from}\n` +
        `Target language: ${to}\n\n` +
        `Text:\n${message}`,
    });

    const reply = String(response.output_text || "").trim();
    if (!reply) throw new Error("OpenAI boş yanıt döndürdü.");

    return res.json({reply});
  } catch (error) {
    console.error("AyTalk server error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Bilinmeyen sunucu hatası.",
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("================================");
  console.log("AyTalk Server Başladı");
  console.log(`Port: ${PORT}`);
  console.log("================================");
});
