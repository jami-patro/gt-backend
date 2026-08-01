import mongoose from 'mongoose';
import { config } from './config.js';

// Cache the connection across serverless invocations so we don't open a new
// connection (and exhaust Mongo) on every request. On Vercel the module scope
// is reused between warm invocations, so `cached` persists.
let cached = global.__gtMongoose;
if (!cached) {
  cached = global.__gtMongoose = { conn: null, promise: null };
}

export async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    mongoose.set('strictQuery', true);
    mongoose.set('bufferCommands', false); // fail fast instead of queuing when not connected
    cached.promise = mongoose
      .connect(config.mongoUrl, {
        serverSelectionTimeoutMS: 6000,
        connectTimeoutMS: 6000,
        socketTimeoutMS: 8000,
        maxPoolSize: 5,
      })
      .then((m) => m)
      .catch((err) => {
        // Reset so the next request can retry a fresh connection.
        cached.promise = null;
        throw err;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

export default connectDB;
