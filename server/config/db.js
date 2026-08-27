import mongoose from 'mongoose';
import { config } from './env.js';

export async function connectDatabase() {
  if (!config.mongoUri) {
    throw new Error('MONGODB_URI is required. Copy .env.example to .env and configure it.');
  }

  // Existing source collections are intentionally schema-less, so legitimate dynamic fields
  // such as `status` must not be stripped from their read-only query filters.
  mongoose.set('strictQuery', false);
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 15000,
  });
  console.log('[DATABASE] Connected to MongoDB.');
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
