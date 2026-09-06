"use strict";

const AUTHORIZE_URL =
  "https://api.orange.com/openidconnect/playground/v1.0/authorize";
const TOKEN_URL =
  "https://api.orange.com/openidconnect/playground/v1.0/token";
const VERIFY_URL =
  "https://api.orange.com/camara/playground/api/number-verification/v1/verify";

function readConfig() {
  const enabled =
    String(process.env.ORANGE_PLAYGROUND_ENABLED || "")
      .trim()
      .toLowerCase() === "true";
  const clientId = String(process.env.ORANGE_PLAYGROUND_CLIENT_ID || "").trim();
  const authorizationHeader = String(
    process.env.ORANGE_PLAYGROUND_AUTH_HEADER || "",
  ).trim();
  const redirectUri = String(
    process.env.ORANGE_PLAYGROUND_REDIRECT_URI || "",
  ).trim();

  if (!enabled) {
    const error = new Error("Orange Number Verification Playground kapalı.");
    error.statusCode = 503;
    throw error;
  }
  if (!clientId || !authorizationHeader || !redirectUri) {
    const error = new Error(
      "Orange Playground kimlik bilgileri veya callback adresi eksik.",
    );
    error.statusCode = 503;
    throw error;
  }
  if (!/^Basic\s+\S+/i.test(authorizationHeader)) {
    const error = new Error("Orange Authorization header biçimi geçersiz.");
    error.statusCode = 503;
    throw error;
  }

  return {clientId, authorizationHeader, redirectUri};
}

function normalizeE164(value) {
  const phone = String(value || "").replace(/[\s()-]/g, "").trim();
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    const error = new Error("Telefon numarası E.164 biçiminde olmalıdır.");
    error.statusCode = 400;
    throw error;
  }
  return phone;
}

function buildAuthorizationUrl({phoneNumber, state}) {
  const {clientId, redirectUri} = readConfig();
  const phone = normalizeE164(phoneNumber);

  // Orange Playground mock akışında login_hint zorunludur.
  // Production Number Verification'da mobil ağ numarayı belirler ve bu alan kullanılmaz.
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid dpv:FraudPreventionAndDetection number-verification:verify",
    state: String(state || ""),
    login_hint: `tel:${phone}`,
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function parseJsonResponse(response, fallbackMessage) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(
      String(data?.message || data?.error_description || data?.error || fallbackMessage),
    );
    error.statusCode = response.status >= 400 ? response.status : 502;
    error.providerStatus = response.status;
    throw error;
  }

  return data || {};
}

async function exchangeAuthorizationCode(code) {
  const {authorizationHeader, redirectUri} = readConfig();
  const cleanCode = String(code || "").trim();
  if (!cleanCode) {
    const error = new Error("Orange authorization code eksik.");
    error.statusCode = 400;
    throw error;
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code: cleanCode,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: authorizationHeader,
    },
    body: body.toString(),
  });

  const data = await parseJsonResponse(
    response,
    "Orange access token alınamadı.",
  );
  const accessToken = String(data?.access_token || "").trim();
  if (!accessToken) {
    const error = new Error("Orange access token yanıtı eksik.");
    error.statusCode = 502;
    throw error;
  }

  return accessToken;
}

async function verifyPhoneNumber({accessToken, phoneNumber}) {
  const phone = normalizeE164(phoneNumber);
  const token = String(accessToken || "").trim();
  if (!token) {
    const error = new Error("Orange access token eksik.");
    error.statusCode = 400;
    throw error;
  }

  const response = await fetch(VERIFY_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({phoneNumber: phone}),
  });

  const data = await parseJsonResponse(
    response,
    "Orange Number Verification başarısız.",
  );

  return Boolean(data?.devicePhoneNumberVerified);
}

module.exports = {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  normalizeE164,
  verifyPhoneNumber,
};
