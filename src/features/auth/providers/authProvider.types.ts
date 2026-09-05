import type {AuthMethod} from "../router/authRouter.types";

export type AuthProviderContext = {
  countryIso2?: string;
  phoneNumber?: string;
};

export type AuthProviderResult = {
  success: boolean;
  method: AuthMethod;
  provider?: string;
  externalSessionId?: string;
  errorCode?: string;
};

export interface AuthProvider {
  readonly method: AuthMethod;
  readonly providerName: string;

  isAvailable(
    context: AuthProviderContext,
  ): Promise<boolean>;

  begin(
    context: AuthProviderContext,
  ): Promise<AuthProviderResult>;
}
