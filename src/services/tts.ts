import {
  SERVER_URL,
  assertApiConfiguration,
  getApiJsonHeaders,
} from "./api";

type TtsRequest = {
  text: string;
  language: string;
  followVoiceTone?: boolean;
  voicePace?: "slow" | "normal" | "fast";
  gender?: "male" | "female";
};

export async function requestTtsAudioBase64({
  text,
  language,
  followVoiceTone,
  voicePace,
  gender,
}: TtsRequest): Promise<string> {
  const cleanText = String(text || "").trim();
  if (!cleanText) {
    throw new Error("Seslendirilecek metin boş.");
  }

  assertApiConfiguration();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch(`${SERVER_URL}/tts`, {
      method: "POST",
      headers: getApiJsonHeaders(),
      body: JSON.stringify({
        text: cleanText,
        language,
        followVoiceTone: Boolean(followVoiceTone),
        voicePace: voicePace || "normal",
        gender: gender || "female",
      }),
      signal: controller.signal,
    });

    let data: any = {};
    try {
      data = await response.json();
    } catch {}

    if (!response.ok) {
      throw new Error(String(data?.error || `TTS isteği başarısız (${response.status}).`));
    }

    const audioBase64 = String(data?.audioBase64 || "").trim();
    if (!audioBase64) {
      throw new Error("TTS sunucusu boş ses verisi döndürdü.");
    }

    return audioBase64;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("TTS isteği zaman aşımına uğradı.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
