import {
  FirebaseAuthTypes,
  getAuth,
  signInWithCustomToken,
  signInWithPhoneNumber,
  signOut as firebaseSignOut,
} from "@react-native-firebase/auth";

import type {
  AuthSession,
  AuthenticatedUser,
  PhoneVerificationRequest,
} from "../types/auth.types";

let pendingConfirmation: FirebaseAuthTypes.ConfirmationResult | null = null;

const normalizePhoneNumber = (value: string) =>
  value.replace(/[\s()-]/g, "").trim();

const assertE164PhoneNumber = (phoneNumber: string) => {
  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
    throw new Error(
      "Telefon numarası ülke koduyla birlikte yazılmalıdır. Örnek: +905xxxxxxxxx",
    );
  }
};

const resolveAuthenticatedPhone = async (
  user: FirebaseAuthTypes.User,
): Promise<string> => {
  const nativePhone = String(user.phoneNumber || "").trim();
  if (nativePhone) {
    return nativePhone;
  }

  // Silent Network doğrulamasında Firebase Phone provider kullanılmaz.
  // Backend, doğrulanmış E.164 numarayı Custom Token claim'i olarak taşır.
  const tokenResult = await user.getIdTokenResult();
  const claimedPhone = String(
    (tokenResult.claims as Record<string, unknown>)?.aytalkPhoneE164 || "",
  ).trim();

  if (!claimedPhone) {
    throw new Error("Doğrulanmış AyTalk telefon numarası Firebase oturumunda bulunamadı.");
  }

  assertE164PhoneNumber(claimedPhone);
  return claimedPhone;
};

const toAuthenticatedUser = async (
  user: FirebaseAuthTypes.User,
): Promise<AuthenticatedUser> => ({
  uid: user.uid,
  phoneNumber: await resolveAuthenticatedPhone(user),
});

const createSession = async (
  user: FirebaseAuthTypes.User,
  forceRefresh = false,
): Promise<AuthSession> => {
  const idToken = await user.getIdToken(forceRefresh);

  if (!idToken) {
    throw new Error("Firebase kimlik belirteci alınamadı.");
  }

  return {
    user: await toAuthenticatedUser(user),
    idToken,
  };
};

export const requestPhoneVerification = async (
  rawPhoneNumber: string,
): Promise<PhoneVerificationRequest> => {
  const phoneNumber = normalizePhoneNumber(rawPhoneNumber);

  assertE164PhoneNumber(phoneNumber);

  pendingConfirmation = await signInWithPhoneNumber(
    getAuth(),
    phoneNumber,
  );

  return {
    phoneNumber,
    requestedAt: new Date().toISOString(),
  };
};

export const confirmPhoneVerification = async (
  rawCode: string,
): Promise<AuthSession> => {
  const code = rawCode.replace(/\s/g, "").trim();

  if (!/^\d{6}$/.test(code)) {
    throw new Error("SMS doğrulama kodu 6 haneli olmalıdır.");
  }

  if (!pendingConfirmation) {
    throw new Error(
      "Aktif bir SMS doğrulama isteği bulunmuyor. Lütfen yeniden kod isteyin.",
    );
  }

  const confirmation = pendingConfirmation;
  const credential = await confirmation.confirm(code);

  if (!credential?.user) {
    throw new Error("Telefon doğrulaması tamamlanamadı.");
  }

  pendingConfirmation = null;

  return createSession(credential.user, true);
};

export const signInWithAyTalkCustomToken = async (
  customToken: string,
): Promise<AuthSession> => {
  const cleanToken = String(customToken || "").trim();
  if (!cleanToken) {
    throw new Error("AyTalk oturum anahtarı alınamadı.");
  }

  const credential = await signInWithCustomToken(getAuth(), cleanToken);
  if (!credential?.user) {
    throw new Error("AyTalk Firebase oturumu açılamadı.");
  }

  return createSession(credential.user, true);
};

export const getCurrentAuthSession = async (
  forceRefresh = false,
): Promise<AuthSession | null> => {
  const user = getAuth().currentUser;

  if (!user) {
    return null;
  }

  return createSession(user, forceRefresh);
};

export const getCurrentIdToken = async (
  forceRefresh = false,
): Promise<string | null> => {
  const user = getAuth().currentUser;

  if (!user) {
    return null;
  }

  return user.getIdToken(forceRefresh);
};

export const hasPendingPhoneVerification = () =>
  pendingConfirmation !== null;

export const clearPendingPhoneVerification = () => {
  pendingConfirmation = null;
};

export const signOutCurrentUser = async () => {
  pendingConfirmation = null;
  await firebaseSignOut(getAuth());
};
