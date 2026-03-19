import { Timestamp } from 'firebase/firestore';

export interface UserProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  streakCount: number;
  lastActiveDate: Timestamp | null;
  dailyGoalMet: boolean;
  xp: number;
  dailyGoal?: number;
  avatar?: string;
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
