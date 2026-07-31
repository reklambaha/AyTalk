require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

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

app.get("/health", (_req, res) => {
  res.json({ok: true, service: "AyTalk", version: "vision-1.3"});
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
        "Return only the translation. Preserve meaning, names, numbers, " +
        "punctuation, paragraphs, tone, and question form.",

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
        "Return only the translation. Preserve meaning, names, numbers, " +
        "punctuation, paragraphs, tone, and question form.",
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
        ? `Speak naturally and clearly in ${language}.`
        : "Speak naturally and clearly.",
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
