import mongoose, { type Connection } from 'mongoose';
import { env } from '../env.js';

// The databases this API serves are owned by other apps, which create and drop
// their own indexes and collections. Mongoose must never do either, or the two
// will fight over index definitions on every deploy.
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(env.mongoUri);
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

/**
 * One connection pool, one handle per database. `useCache` returns the same
 * handle on every call, so models registered on it are registered once.
 */
export function photosDb(): Connection {
  return mongoose.connection.useDb(env.photosDbName, { useCache: true });
}

export function loraDb(): Connection {
  return mongoose.connection.useDb(env.loraDbName, { useCache: true });
}
