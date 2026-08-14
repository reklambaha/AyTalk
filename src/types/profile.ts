export type UserProfile = {
  name: string;
  email: string;
  preferredLanguage: string;
  country: string;
  notificationsEnabled: boolean;
  localHistoryEnabled: boolean;
  premium: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProfileUsage = {
  translations: number;
  conferences: number;
  aiMessages: number;
  favorites: number;
};
