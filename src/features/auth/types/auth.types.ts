export type AuthenticatedUser = {
  uid: string;
  phoneNumber: string;
};

export type AuthSession = {
  user: AuthenticatedUser;
  idToken: string;
};

export type PhoneVerificationRequest = {
  phoneNumber: string;
  requestedAt: string;
};