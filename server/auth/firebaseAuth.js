"use strict";

const {getApps} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");

function readBearerToken(req) {
  const header = String(req.get("authorization") || "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : "";
}

async function verifyFirebaseIdToken(req) {
  if (getApps().length === 0) {
    const error = new Error("Firebase kimlik doğrulaması hazır değil.");
    error.statusCode = 503;
    throw error;
  }

  const token = readBearerToken(req);
  if (!token) {
    const error = new Error("Oturum doğrulaması gerekli.");
    error.statusCode = 401;
    throw error;
  }

  try {
    return await getAuth().verifyIdToken(token, true);
  } catch {
    const error = new Error("Oturum geçersiz veya süresi dolmuş.");
    error.statusCode = 401;
    throw error;
  }
}

async function requireFirebaseAuth(req, res, next) {
  try {
    req.firebaseUser = await verifyFirebaseIdToken(req);
    next();
  } catch (error) {
    res.status(error?.statusCode || 401).json({
      error: error?.message || "Yetkisiz istek.",
    });
  }
}

module.exports = {
  readBearerToken,
  verifyFirebaseIdToken,
  requireFirebaseAuth,
};
