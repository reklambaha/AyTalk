import {SERVER_URL, APP_SHARED_KEY} from "./api";

export type LiveKitCredentials = {
  serverUrl: string;
  participantToken: string;
};

export async function getLiveKitCredentials(params: {
  roomName: string;
  participantIdentity: string;
  participantName: string;
}): Promise<LiveKitCredentials> {
  const response = await fetch(`${SERVER_URL}/livekit/token`, {
    method: "POST",
    headers: {"Content-Type": "application/json", "x-app-key": APP_SHARED_KEY},
    body: JSON.stringify({
      roomName: params.roomName,
      participantIdentity: params.participantIdentity,
      participantName: params.participantName,
    }),
  });

  const data = (await response.json()) as {
    serverUrl?: string;
    participantToken?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error || `Token sunucusu hatası (${response.status}).`);
  }

  if (!data.serverUrl || !data.participantToken) {
    throw new Error("LiveKit bağlantı bilgileri eksik.");
  }

  return {
    serverUrl: data.serverUrl,
    participantToken: data.participantToken,
  };
}
