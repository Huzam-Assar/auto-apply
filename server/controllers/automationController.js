import { config } from '../config/env.js';
import {
  getTeachersWithAutomation,
  GEMINI_AUTO_APPLY_MINIMUM,
  listAutomationResults,
  listAvailableTuitions,
  listTuitionAutomationOverview,
  processAllEligibleTuitions,
  processTuition,
  updateTeacherAutomation,
} from '../services/teacherAutomationService.js';

function positiveLimit(value, fallback = 100, maximum = 250) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(parsed)));
}

export async function getTeachers(req, res, next) {
  try {
    const teachers = await getTeachersWithAutomation({ limit: positiveLimit(req.query.limit) });
    res.json({ teachers });
  } catch (error) { next(error); }
}

export async function putTeacherAutomation(req, res, next) {
  try {
    const settings = await updateTeacherAutomation(req.params.teacherId, req.body || {});
    res.json({ settings });
  } catch (error) { next(error); }
}

export async function getTuitions(req, res, next) {
  try {
    const tuitions = await listAvailableTuitions({ limit: positiveLimit(req.query.limit) });
    res.json({ tuitions });
  } catch (error) { next(error); }
}

export function getAutomationConfig(_req, res) {
  res.json({
    liveOnly: true,
    schedulerEnabled: config.schedulerEnabled,
    intervalMinutes: config.intervalMinutes,
    geminiAutoApplyMinimum: GEMINI_AUTO_APPLY_MINIMUM,
    geminiConfigured: Boolean(config.geminiApiKey),
  });
}

export async function processOneTuition(req, res, next) {
  try {
    const result = await processTuition(req.params.tuitionId, {
      source: 'manual-process',
    });
    res.json({ result });
  } catch (error) { next(error); }
}

export async function processAll(req, res, next) {
  try {
    const results = await processAllEligibleTuitions({
      source: 'manual-process',
      limit: positiveLimit(req.body?.limit, 50),
    });
    res.json({ results });
  } catch (error) { next(error); }
}

export async function getApplications(req, res, next) {
  try {
    const results = await listAutomationResults({ limit: positiveLimit(req.query.limit) });
    res.json({ results });
  } catch (error) { next(error); }
}

export async function getTuitionAutomationOverview(req, res, next) {
  try {
    const overview = await listTuitionAutomationOverview({ limit: positiveLimit(req.query.limit) });
    res.json({ overview });
  } catch (error) { next(error); }
}
