export type AppMode = "translate" | "assistant" | "image" | "conference";

export type Language = {
  name: string;
  nativeName: string;
  flag: string;
  speech: string;
  tts: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type TranslationHistoryItem = {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  createdAt: string;
  favorite: boolean;
};



export type ConferenceParticipant = {
  id: string;
  name: string;
  language: Language;
};

export type ConferenceMessage = {
  id: string;
  participantId: string;
  participantName: string;
  sourceLanguage: Language;
  sourceText: string;
  translatedText: string;
  targetLanguage: Language;
  createdAt: string;
};

export type ConferenceSession = {
  id: string;
  title: string;
  participants: ConferenceParticipant[];
  messages: ConferenceMessage[];
  targetLanguage: Language;
  activeParticipantId: string;
  listenerParticipantId?: string;
  createdAt: string;
  updatedAt: string;
};

export type SpeechResultEvent = {text?: string; isFinal?: boolean};
export type SpeechErrorEvent = {code?: number; message?: string};

export type VoicePace = "slow" | "normal" | "fast";

export type TtsQueueItem = {
  text: string;
  language: Language;
  sessionId: number;
};

export type StreamEvent =
  | {type: "start"}
  | {type: "delta"; delta: string}
  | {type: "done"; reply: string; elapsedMs?: number}
  | {type: "error"; error: string};
