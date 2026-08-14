const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const MULTISPACE_PATTERN = /[ \t]{2,}/g;

export function normalizeForSpeech(text: string): string {
  const protectedParts: string[] = [];

  const protect = (value: string) => {
    const index = protectedParts.push(value) - 1;
    return ` AYPROTECTED${index} `;
  };

  let result = String(text || "")
    .replace(URL_PATTERN, protect)
    .replace(EMAIL_PATTERN, protect)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(MULTISPACE_PATTERN, " ")
    .trim();

  result = result.replace(/AYPROTECTED(\d+)/g, (_, rawIndex) => {
    const index = Number(rawIndex);
    return protectedParts[index] || "";
  });

  return result;
}

export function localePrefix(locale: string): string {
  return String(locale || "").toLowerCase().split("-")[0];
}
