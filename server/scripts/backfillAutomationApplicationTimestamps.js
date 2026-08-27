import { connectDatabase, disconnectDatabase } from '../config/db.js';
import TeacherApplication from '../models/TeacherApplication.js';

try {
  await connectDatabase();
  const now = new Date();
  // Use the raw collection because Mongoose treats createdAt as immutable once timestamps are enabled.
  const result = await TeacherApplication.collection.updateMany(
    {
      autoApplied: true,
      automationMatch: { $exists: true },
      $or: [{ createdAt: { $exists: false } }, { updatedAt: { $exists: false } }],
    },
    { $set: { createdAt: now, updatedAt: now } },
  );
  console.log(`[DATABASE] Backfilled timestamps for ${result.modifiedCount} automation application(s).`);
} catch (error) {
  console.error(`[ERROR] Timestamp backfill failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
