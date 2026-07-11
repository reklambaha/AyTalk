require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get("/", (req, res) => {
  res.send("🚀 AyTalk Server is Running!");
});

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Gönderilecek mesaj bulunamadı.",
      });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You are AyTalk, a helpful AI translator. Translate accurately and naturally.",
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    const reply = response.choices[0]?.message?.content;

    if (!reply) {
      throw new Error("OpenAI geçerli bir cevap göndermedi.");
    }

    res.json({
      reply,
    });
  } catch (error) {
    console.error("AyTalk server hatası:", error);

    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Bilinmeyen bir sunucu hatası oluştu.",
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});