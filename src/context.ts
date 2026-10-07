import { initContextCache } from '@pothos/core';
import DataLoader from 'dataloader';
import mongoose from 'mongoose';

export interface UserShape {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'USER';
}

export interface ContextType {
  currentUser: UserShape | null;
  isAuthenticated: boolean;
  loadUsersById: (ids: string[]) => Promise<(UserShape | Error)[]>;
  userLoader: DataLoader<string, UserShape>;
  db: typeof mongoose;
}

export function createContext(currentUser: UserShape | null): ContextType {
  const getUserFromDb = async (ids: string[]): Promise<(UserShape | Error)[]> => {
    try {
      const users = await mongoose
        .model('User')
        .find({ _id: { $in: ids } })
        .lean()
        .exec();

      const userMap = new Map(users.map((u: any) => [u._id.toString(), u]));
      return ids.map((id) => {
        const user = userMap.get(id);
        return user ? formatUser(user) : new Error(`User not found: ${id}`);
      });
    } catch (e) {
      return ids.map(() => e as Error);
    }
  };

  return {
    currentUser,
    isAuthenticated: currentUser !== null,
    loadUsersById: getUserFromDb,
    get userLoader() {
      return new DataLoader<string, UserShape>(async (ids) => {
        const results = await getUserFromDb(ids as string[]);
        return results.map((r) => (r instanceof Error ? null : r) as UserShape);
      });
    },
    db: mongoose,
    ...initContextCache(),
  };
}

function formatUser(doc: any): UserShape {
  return {
    id: doc._id.toString(),
    email: doc.email,
    name: doc.name,
    role: doc.role || 'USER',
  };
}
