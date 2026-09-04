export {default as PhoneAuthScreen} from "./screens/PhoneAuthScreen";

export {
  clearPendingPhoneVerification,
  confirmPhoneVerification,
  getCurrentAuthSession,
  getCurrentIdToken,
  hasPendingPhoneVerification,
  requestPhoneVerification,
  signOutCurrentUser,
} from "./services/authService";

export type {
  AuthSession,
  AuthenticatedUser,
  PhoneVerificationRequest,
} from "./types/auth.types";
