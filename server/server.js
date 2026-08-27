import './config/env.js';
import cors from 'cors';
import express from 'express';
import { config } from './config/env.js';
import { connectDatabase } from './config/db.js';
import { startTuitionAutomationJob } from './jobs/tuitionAutomationJob.js';
import TeacherAutomationSettings from './models/TeacherAutomationSettings.js';
import TeacherApplication from './models/TeacherApplication.js';
import TuitionAutomationEvaluation from './models/TuitionAutomationEvaluation.js';
import automationRoutes from './routes/automationRoutes.js';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: config.clientOrigin }));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'teacher-automation-test' }));
app.use('/api', automationRoutes);

app.use((error, _req, res, _next) => {
  const status = error.statusCode || 500;
  if (status >= 500) console.error(`[ERROR] ${error.message}`);
  res.status(status).json({ error: error.message || 'Unexpected server error' });
});

async function start() {
  try {
    await connectDatabase();
    await Promise.all([
      TeacherAutomationSettings.init(),
      TuitionAutomationEvaluation.init(),
      TeacherApplication.init(),
    ]);
    console.log('[DATABASE] Automation indexes are ready.');
    startTuitionAutomationJob();
    app.listen(config.port, () => console.log(`[SERVER] Listening on port ${config.port}.`));
  } catch (error) {
    console.error(`[ERROR] Startup failed: ${error.message}`);
    process.exit(1);
  }
}

start();
