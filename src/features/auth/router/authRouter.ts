import type {
  AuthMethodAvailability,
  AuthRoutePlan,
  AuthRouteRequest,
} from "./authRouter.types";

const freeMethod = (
  method: AuthMethodAvailability["method"],
  available: boolean,
  reason: string,
): AuthMethodAvailability => ({
  method,
  available,
  costClass: "free",
  reason,
});

export const buildAuthRoutePlan = (
  request: AuthRouteRequest,
): AuthRoutePlan => {
  const {
    goal,
    countryIso2,
    platform,
    capabilities,
  } = request;

  if (goal === "phone_ownership") {
    return {
      goal,
      countryIso2,
      requiresPhoneOwnership: true,
      orderedMethods: [
        {
          method: "silent_network",
          available: capabilities.silentNetworkAvailable,
          costClass: "variable",
          provider: capabilities.silentNetworkProvider,
          reason: capabilities.silentNetworkAvailable
            ? "Telefon sahipliği SMS olmadan SIM/mobil ağ üzerinden doğrulanabilir."
            : "Bu ülke veya operatörde sessiz doğrulama hazır değil.",
        },
        {
          method: "phone_sms",
          available: capabilities.smsFallbackAllowed,
          costClass: "paid",
          reason: capabilities.smsFallbackAllowed
            ? "Yalnız sessiz doğrulama mümkün değilse son çare."
            : "SMS maliyet kontrolü nedeniyle kapalı.",
        },
      ],
    };
  }

  const methods: AuthMethodAvailability[] = [
    freeMethod(
      "existing_session",
      capabilities.hasExistingSession,
      "Mevcut güvenli oturum.",
    ),
    freeMethod(
      "passkey",
      capabilities.passkeyAvailable,
      "Passkey ile telekom maliyeti olmadan giriş.",
    ),
    freeMethod(
      "google",
      platform === "android" && capabilities.googleAvailable,
      "Android için Google hesabı.",
    ),
    freeMethod(
      "apple",
      platform === "ios" && capabilities.appleAvailable,
      "iOS için Apple hesabı.",
    ),
  ];

  if (goal === "account_recovery") {
    methods.push(
      {
        method: "silent_network",
        available: capabilities.silentNetworkAvailable,
        costClass: "variable",
        provider: capabilities.silentNetworkProvider,
        reason: "Telefon sahipliği gerekiyorsa SMS'ten önce denenir.",
      },
      {
        method: "phone_sms",
        available: capabilities.smsFallbackAllowed,
        costClass: "paid",
        reason: "Yalnız diğer güvenli yöntemler başarısızsa.",
      },
    );
  }

  return {
    goal,
    countryIso2,
    orderedMethods: methods,
    requiresPhoneOwnership: false,
  };
};

export const firstAvailableAuthMethod = (
  plan: AuthRoutePlan,
): AuthMethodAvailability | null =>
  plan.orderedMethods.find(method => method.available) || null;
