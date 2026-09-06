"use strict";

const crypto = require("crypto");

const TTL_MS = 10 * 60 * 1000;
const recordsById = new Map();
const idByState = new Map();

function cleanup() {
  const now = Date.now();
  for (const [verificationId, record] of recordsById.entries()) {
    if (record.expiresAt <= now) {
      recordsById.delete(verificationId);
      idByState.delete(record.state);
    }
  }
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("hex");
}

function createVerification(phoneNumber) {
  cleanup();
  const verificationId = randomToken(20);
  const state = randomToken(24);
  const now = Date.now();
  const record = {
    verificationId,
    state,
    phoneNumber,
    status: "pending",
    verified: false,
    provider: "orange_playground",
    createdAt: now,
    expiresAt: now + TTL_MS,
    error: "",
  };

  recordsById.set(verificationId, record);
  idByState.set(state, verificationId);
  return {...record};
}

function getByState(state) {
  cleanup();
  const verificationId = idByState.get(String(state || ""));
  if (!verificationId) return null;
  const record = recordsById.get(verificationId);
  return record ? {...record} : null;
}

function getById(verificationId) {
  cleanup();
  const record = recordsById.get(String(verificationId || ""));
  return record ? {...record} : null;
}

function updateByState(state, patch) {
  cleanup();
  const verificationId = idByState.get(String(state || ""));
  if (!verificationId) return null;
  const current = recordsById.get(verificationId);
  if (!current) return null;
  const next = {...current, ...patch};
  recordsById.set(verificationId, next);
  return {...next};
}

module.exports = {
  createVerification,
  getById,
  getByState,
  updateByState,
};
