export type AuthGoal =
  | "account_session"
  | "phone_ownership"
  | "account_recovery";

export type AuthMethod =
  | "existing_session"
  | "passkey"
  | "google"
  | "apple"
  | "silent_network"
  | "phone_sms";

export type AuthCostClass =
  | "free"
  | "low"
  | "variable"
  | "paid";

export type AuthMethodAvailability = {
  method: AuthMethod;
  available: boolean;
  costClass: AuthCostClass;
  provider?: string;
  reason?: string;
};

export type AuthRouterCapabilities = {
  hasExistingSession: boolean;
  passkeyAvailable: boolean;
  googleAvailable: boolean;
  appleAvailable: boolean;
  silentNetworkAvailable: boolean;
  silentNetworkProvider?: string;
  smsFallbackAllowed: boolean;
};

export type AuthRouteRequest = {
  goal: AuthGoal;
  platform: "android" | "ios";
  countryIso2?: string;
  capabilities: AuthRouterCapabilities;
};

export type AuthRoutePlan = {
  goal: AuthGoal;
  countryIso2?: string;
  orderedMethods: AuthMethodAvailability[];
  requiresPhoneOwnership: boolean;
};
