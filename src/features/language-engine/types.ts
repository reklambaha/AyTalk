export type SpeechReplacement = {pattern: RegExp; replacement: string;};
export type LanguageRulePack = {locale: string; voiceFallbacks: string[]; speechReplacements?: SpeechReplacement[];};
export type VoiceLike = {id?: string; language?: string; notInstalled?: boolean;};
export type SpeechOptimizationResult = {
  displayText: string;
  speechText: string;
  requestedLocale: string;
  selectedLocale: string;
  selectedVoiceId?: string;
  hasCompatibleLocalVoice: boolean;
};
