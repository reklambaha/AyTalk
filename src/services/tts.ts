import {fetchJson} from "./api";

type VoicePace = "slow" | "normal" | "fast";

type RequestTtsOptions = {
  text: string;
  language: string;
  followVoiceTone: boolean;
  voicePace: VoicePace;
};

type TtsResponse = {
  audioBase64?: string;
  error?: string;
};

export async function requestTtsAudioBase64({
  text,
  language,
  followVoiceTone,
  voicePace,
}: RequestTtsOptions): Promise<string> {
  const data = await fetchJson<TtsResponse>(
    "/tts",
    {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        text: text.slice(0, 4096),
        language,
        voiceStyle: followVoiceTone
          ? {
              followSpeaker: true,
              pace: voicePace,
              tone: "warm-natural",
              voice: "male",
            }
          : {
              followSpeaker: false,
              pace: "normal",
              tone: "clear-neutral",
              voice: "female",
            },
      }),
    },
    60000,
  );

  const audioBase64 = String(data?.audioBase64 || "");
  if (!audioBase64) {
    throw new Error("Sunucudan ses dosyası alınamadı.");
  }

  return audioBase64;
}
