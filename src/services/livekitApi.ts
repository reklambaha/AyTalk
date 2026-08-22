import {
  SERVER_URL,
  assertApiConfiguration,
  getApiJsonHeaders,
} from "./api";

export type LiveKitCredentials = {
  serverUrl: string;
  participantToken: string;
};

type LiveKitCredentialRequest = {
  roomName: string;
  participantIdentity: string;
  participantName: string;
};

export async function getLiveKitCredentials(
  input: LiveKitCredentialRequest,
): Promise<LiveKitCredentials> {
  assertApiConfiguration();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(`${SERVER_URL}/livekit/token`, {
      method: "POST",
      headers: getApiJsonHeaders(),
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    let data: any = {};
    try {
      data = await response.json();
    } catch {}

    if (!response.ok) {
      throw new Error(
        String(data?.error || `LiveKit token alınamadı (${response.status}).`),
      );
    }

    const serverUrl = String(data?.serverUrl || "").trim();
    const participantToken = String(data?.participantToken || "").trim();

    if (!serverUrl || !participantToken) {
      throw new Error("LiveKit sunucusu eksik bağlantı bilgisi döndürdü.");
    }

    return {serverUrl, participantToken};
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("LiveKit token isteği zaman aşımına uğradı.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
