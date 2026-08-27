import { config } from '../config/env.js';
import { processAllEligibleTuitions } from '../services/teacherAutomationService.js';

let running = false;
let timer = null;

export function startTuitionAutomationJob() {
  if (!config.schedulerEnabled) {
    console.log('[AUTOMATION] Scheduler disabled. Set AUTO_APPLY_SCHEDULER_ENABLED=true to enable it.');
    return null;
  }

  const run = async () => {
    if (running) {
      console.warn('[AUTOMATION] Previous scheduler run is still active; skipping overlap.');
      return;
    }
    running = true;
    try {
      await processAllEligibleTuitions({ source: 'scheduler' });
    } catch (error) {
      console.error(`[ERROR] Scheduler failed: ${error.message}`);
    } finally {
      running = false;
    }
  };
  const intervalMs = config.intervalMinutes * 60 * 1000;
  console.log(`[AUTOMATION] Scheduler enabled: every ${config.intervalMinutes} minute(s), live auto-apply only.`);
  timer = setInterval(run, intervalMs);
  return timer;
}
