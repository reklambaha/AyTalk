import AsyncStorage from "@react-native-async-storage/async-storage";
import type {UserProfile} from "../types/profile";

const PROFILE_KEY = "aytalk_user_profile_v1";

export const DEFAULT_USER_PROFILE: UserProfile = {
  name: "AyTalk Kullanıcısı",
  email: "",
  preferredLanguage: "Türkçe",
  country: "Türkiye",
  notificationsEnabled: true,
  localHistoryEnabled: true,
  premium: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export async function loadUserProfile(): Promise<UserProfile> {
  const raw = await AsyncStorage.getItem(PROFILE_KEY);
  if (!raw) return DEFAULT_USER_PROFILE;
  try {
    return {...DEFAULT_USER_PROFILE, ...JSON.parse(raw)};
  } catch {
    return DEFAULT_USER_PROFILE;
  }
}

export async function saveUserProfile(profile: UserProfile): Promise<UserProfile> {
  const next = {...profile, updatedAt: new Date().toISOString()};
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(next));
  return next;
}

export async function deleteUserProfile(): Promise<void> {
  await AsyncStorage.removeItem(PROFILE_KEY);
}
