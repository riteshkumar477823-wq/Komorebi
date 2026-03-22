import { Timestamp } from 'firebase/firestore';

export interface UserProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  streakCount: number;
  lastActiveDate: Timestamp | null;
  dailyGoalMet: boolean;
  xp: number;
  rank: string; // E5, E4, ..., SSS1
  title?: string; // e.g., "Novice Learner", "Kanji Slayer"
  dailyGoal?: number;
  avatar?: string;
  ownedAvatars?: string[];
  preferredTTS?: 'native' | 'gemini';
  notificationsEnabled?: boolean;
  achievements?: string[]; // IDs of unlocked achievements
  pinnedAchievements?: string[]; // IDs of pinned achievements (max 10)
  apiKeys?: string[]; // Multiple Gemini API keys
  quoteCache?: { text: string; translation: string }[];
  quoteStats?: { lastDate: string; count: number };
}

export interface Note {
  id?: string;
  title: string;
  content: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  color?: string;
  isPinned?: boolean;
}

export interface Vocabulary {
  id?: string;
  uid: string;
  japanese: string;
  meaning: string;
  romaji?: string;
  createdAt: Timestamp;
  mastery: number;
  parentId?: string;
  type?: 'main' | 'sub';
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}
