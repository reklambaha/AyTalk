export const SERVER_URL = "https://aytalk.onrender.com";

// NOT: Bu anahtar uygulama paketinin içine gömülür, isteyen biri APK'yı
// açıp çıkarabilir. Bu yüzden gerçek kullanıcı kimlik doğrulaması yerine
// geçmez — amacı sadece rastgele bot/scraper trafiğini süzmektir.
// Render'daki APP_SHARED_KEY environment variable'ı ile AYNI değer olmalı.
export const APP_SHARED_KEY = "BURAYA_RENDER_DAKI_ILE_AYNI_DEGERI_YAZ";

export async function fetchJson<T>(
  path: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${SERVER_URL}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        "x-app-key": APP_SHARED_KEY,
      },
      signal: controller.signal,
    });

    const data = (await response.json()) as T & {error?: string};

    if (!response.ok) {
      throw new Error(data?.error || `Sunucu hatası (${response.status}).`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}
