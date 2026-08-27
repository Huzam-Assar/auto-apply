import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { processTeacherForTuition, processTuition } from '../services/teacherAutomationService.js';

function valueFor(name) {
  const match = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : null;
}

const teacherId = valueFor('teacher');
const tuitionId = valueFor('tuition');
if (!tuitionId) {
  console.error('Usage: npm.cmd run process-automation -- --tuition=TUITION_ID [--teacher=TEACHER_ID]');
  process.exit(1);
}

try {
  await connectDatabase();
  const result = teacherId
    ? await processTeacherForTuition({ teacherId, tuitionId, source: 'manual-process' })
    : await processTuition(tuitionId, { source: 'manual-process' });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`[ERROR] Automation processing failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
