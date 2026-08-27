import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import TeacherApplication from '../models/TeacherApplication.js';
import Tuition from '../models/Tuition.js';

try {
  await connectDatabase();
  const jobIds = await TeacherApplication.distinct('jobId', {
    autoApplied: true,
    automationMatch: { $exists: true },
  });
  let synced = 0;

  for (const jobId of jobIds) {
    if (!mongoose.isValidObjectId(jobId)) {
      console.warn(`[SKIP] Invalid tuition ID on automatic application: ${jobId}`);
      continue;
    }
    const totalApplications = await TeacherApplication.countDocuments({ jobId: String(jobId) });
    const update = await Tuition.updateOne(
      { _id: jobId },
      { $set: { applications: totalApplications } },
    );
    if (update.matchedCount) synced += 1;
    else console.warn(`[SKIP] Tuition ${jobId} no longer exists.`);
  }

  console.log(`[DATABASE] Synchronized application counters for ${synced} tuition(s).`);
} catch (error) {
  console.error(`[ERROR] Application counter synchronization failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
