import {fetchJson} from "./api";

export type LiveKitCredentials = {
  serverUrl: string;
  participantToken: string;
};

export async function getLiveKitCredentials(params: {
  roomName: string;
  participantIdentity: string;
  participantName: string;
}): Promise<LiveKitCredentials> {
  const data = await fetchJson<{
    serverUrl?: string;
    participantToken?: string;
    error?: string;
  }>(
    "/livekit/token",
    {
      method: "POST",
      body: JSON.stringify({
        roomName: params.roomName,
        participantIdentity: params.participantIdentity,
        participantName: params.participantName,
      }),
    },
    15000,
  );

  if (!data.serverUrl || !data.participantToken) {
    throw new Error("LiveKit bağlantı bilgileri eksik.");
  }

  return {
    serverUrl: data.serverUrl,
    participantToken: data.participantToken,
  };
}
