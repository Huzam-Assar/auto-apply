import mongoose from 'mongoose';
import TeacherProfile from '../models/TeacherProfile.js';
import TeacherAutomationSettings from '../models/TeacherAutomationSettings.js';
import Tuition from '../models/Tuition.js';
import TeacherApplication from '../models/TeacherApplication.js';
import TuitionAutomationEvaluation from '../models/TuitionAutomationEvaluation.js';
import { normalizeTeacherForMatching, normalizeTuitionForMatching } from '../utils/normalizeMatchingData.js';
import { calculateRuleMatch } from '../utils/matchingScoring.js';
import { availableStatusFilter, isTuitionAvailable } from '../utils/tuitionAvailability.js';
import { matchWithGemini } from './geminiMatcher.js';

// Kept in backend code only: teachers cannot lower this quality requirement.
export const GEMINI_AUTO_APPLY_MINIMUM = 70;

function baseMatch(rule, gemini = null, fallbackDecision = 'REJECT', fallbackReason = rule.reason) {
  return {
    ruleScore: rule.score,
    geminiScore: gemini?.score ?? null,
    confidence: gemini?.confidence ?? null,
    decision: gemini?.decision || fallbackDecision,
    matchedRequirements: [...new Set([...(rule.matchedRequirements || []), ...(gemini?.matchedRequirements || [])])],
    missingRequirements: [...new Set([...(rule.missingRequirements || []), ...(gemini?.missingRequirements || [])])],
    concerns: [...new Set([...(rule.concerns || []), ...(gemini?.concerns || [])])],
    reason: gemini?.reason || fallbackReason,
  };
}

async function persistEvaluation({ teacherId, tuitionId, source, outcome, wouldApply = false, errorCode = null, match }) {
  return TuitionAutomationEvaluation.create({
    teacherId,
    tuitionId,
    source,
    // New runs are live-only. This field remains for displaying historic dry runs.
    dryRun: false,
    outcome,
    wouldApply,
    errorCode,
    match,
  });
}

function settingForTeacher(settings) {
  return {
    autoApply: Boolean(settings?.autoApply),
  };
}

function timeValue(value) {
  const valueAsTime = new Date(value || 0).getTime();
  return Number.isFinite(valueAsTime) ? valueAsTime : 0;
}

// A completed evaluation remains valid until one of the facts it used changes.
// AI/processing failures are intentionally not cached, so a temporary provider failure can recover.
export function evaluationIsCurrent({ evaluation, teacher, tuition, settings }) {
  if (!evaluation?.createdAt || ['AI_FAILED', 'ERROR'].includes(evaluation.outcome)) return false;
  // Historic dry runs must be evaluated once in the new live-only workflow.
  if (evaluation.dryRun) return false;

  const lastInputChange = Math.max(
    timeValue(teacher?.updatedAt),
    timeValue(tuition?.updatedAt),
    timeValue(settings?.updatedAt),
  );
  return timeValue(evaluation.createdAt) >= lastInputChange;
}

function matchFromMainApplication(application) {
  return {
    ruleScore: application.automationMatch?.ruleScore ?? null,
    geminiScore: application.matchScore ?? application.automationMatch?.geminiScore ?? null,
    confidence: application.automationMatch?.confidence ?? null,
    decision: application.automationMatch?.decision || 'AUTO_APPLY',
    matchedRequirements: application.automationMatch?.matchedRequirements || [],
    missingRequirements: application.automationMatch?.missingRequirements || [],
    concerns: application.automationMatch?.concerns || [],
    reason: application.automationMatch?.reason || 'ALREADY_APPLIED: this teacher already has an application for this tuition.',
  };
}

function alreadyAppliedResult(application) {
  return {
    outcome: 'ALREADY_APPLIED',
    wouldApply: false,
    applicationId: application._id,
    match: {
      ...matchFromMainApplication(application),
      reason: 'ALREADY_APPLIED: this teacher already has an application for this tuition.',
    },
  };
}

function unchangedEvaluationResult(evaluation) {
  return {
    outcome: 'SKIPPED_UNCHANGED',
    wouldApply: false,
    reusedEvaluationId: evaluation._id,
    previousOutcome: evaluation.outcome,
    match: evaluation.match,
  };
}

async function getPairCache({ teacher, tuition, settings }) {
  const [application, evaluation] = await Promise.all([
    teacher.userId
      ? TeacherApplication.findOne({ jobId: String(tuition._id), userId: String(teacher.userId) }).lean()
      : null,
    TuitionAutomationEvaluation.findOne({ teacherId: teacher._id, tuitionId: tuition._id }).sort({ createdAt: -1 }).lean(),
  ]);

  if (application) return alreadyAppliedResult(application);
  if (evaluationIsCurrent({ evaluation, teacher, tuition, settings })) return unchangedEvaluationResult(evaluation);
  return null;
}

// Gemini decides qualification compatibility after the backend mode/location gate passes.
export function passesAutoApplyPolicy(geminiResult) {
  return Boolean(
    geminiResult?.match === true
    && Number.isFinite(geminiResult.score)
    && geminiResult.score >= GEMINI_AUTO_APPLY_MINIMUM
    && geminiResult.decision === 'AUTO_APPLY',
  );
}

export function buildMainTeacherApplication({ teacher, tuition, match }) {
  if (!teacher?.userId) throw new Error('Teacher profile is missing userId required by teacherapplications');

  return {
    // These names and value types match existing teacherapplications records.
    userId: String(teacher.userId),
    jobId: String(tuition._id),
    job: tuition,
    resume: {
      type: 'profile',
      profileData: teacher,
    },
    coverLetter: `Automatic application: ${match.reason}`,
    additionalInfo: `AI match score: ${match.geminiScore}/100.`,
    status: 'Submitted',
    agreementAccepted: Boolean(teacher.agreementAccepted),
    autoApplied: true,
    matchScore: match.geminiScore,
    automationMatch: {
      ruleScore: match.ruleScore,
      geminiScore: match.geminiScore,
      confidence: match.confidence,
      decision: match.decision,
      reason: match.reason,
      matchedRequirements: match.matchedRequirements,
      missingRequirements: match.missingRequirements,
      concerns: match.concerns,
    },
  };
}

async function createMainApplicationAndUpdateTuition({ teacher, tuition, match }) {
  const session = await mongoose.startSession();
  let mainApplication;
  try {
    await session.withTransaction(async () => {
      [mainApplication] = await TeacherApplication.create(
        [buildMainTeacherApplication({ teacher, tuition, match })],
        { session },
      );
      const counterUpdate = await Tuition.updateOne(
        { _id: tuition._id },
        { $inc: { applications: 1 } },
        { session },
      );
      if (counterUpdate.matchedCount !== 1) {
        throw new Error('Tuition was not found while updating its application counter.');
      }
    });
    return mainApplication;
  } finally {
    await session.endSession();
  }
}

export async function getTeachersWithAutomation({ limit = 100 } = {}) {
  const teachers = await TeacherProfile.find({}, {
    firstName: 1,
    lastName: 1,
    skills: 1,
    country: 1,
    city: 1,
    languages: 1,
    updatedAt: 1,
  }).sort({ updatedAt: -1, _id: 1 }).limit(limit).lean();
  const settings = await TeacherAutomationSettings.find({ teacherId: { $in: teachers.map((teacher) => teacher._id) } }).lean();
  const settingsByTeacherId = new Map(settings.map((setting) => [String(setting.teacherId), setting]));
  return teachers.map((teacher) => ({
    ...teacher,
    automation: settingForTeacher(settingsByTeacherId.get(String(teacher._id))),
  }));
}

export async function updateTeacherAutomation(teacherId, updates) {
  if (!mongoose.isValidObjectId(teacherId)) {
    const error = new Error('Invalid teacher ID');
    error.statusCode = 400;
    throw error;
  }
  const teacher = await TeacherProfile.findById(teacherId, { _id: 1 }).lean();
  if (!teacher) {
    const error = new Error('Teacher not found');
    error.statusCode = 404;
    throw error;
  }

  const allowed = {};
  if (typeof updates.autoApply === 'boolean') allowed.autoApply = updates.autoApply;
  if (Object.keys(allowed).length === 0) {
    const error = new Error('Provide autoApply');
    error.statusCode = 400;
    throw error;
  }

  return TeacherAutomationSettings.findOneAndUpdate(
    { teacherId },
    { $set: allowed, $setOnInsert: { teacherId } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean();
}

export async function listAvailableTuitions({ limit = 100 } = {}) {
  return Tuition.find({ status: availableStatusFilter() }, {
    tuitionDetails: 1,
    subject: 1,
    classGrade: 1,
    mode: 1,
    preferredLanguage: 1,
    country: 1,
    city: 1,
    sector: 1,
    status: 1,
    createdAt: 1,
  }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
}

async function loadTuition(tuitionId) {
  if (!mongoose.isValidObjectId(tuitionId)) {
    const error = new Error('Invalid tuition ID');
    error.statusCode = 400;
    throw error;
  }
  const tuition = await Tuition.findById(tuitionId).lean();
  if (!tuition) {
    const error = new Error('Tuition not found');
    error.statusCode = 404;
    throw error;
  }
  return tuition;
}

async function evaluateCandidate({ teacher, settings, tuition, normalizedTuition, rule, source, persist = true }) {
  const normalizedTeacher = normalizeTeacherForMatching(teacher);
  const effectiveSettings = settingForTeacher(settings);
  const teacherId = teacher._id;
  const tuitionId = tuition._id;
  const record = async (payload) => {
    if (!persist) return null;
    return persistEvaluation({ teacherId, tuitionId, source, ...payload });
  };

  if (!rule.candidate) {
    const result = {
      outcome: 'SKIPPED_RULE',
      wouldApply: false,
      match: baseMatch(rule, null, 'REJECT', `Mode/location gate rejected this pair: ${rule.reason}`),
    };
    await record(result);
    return result;
  }

  console.log(`[MATCH] Teacher ${teacherId} -> Tuition ${tuitionId}`);
  console.log('[GATE] Mode/location check passed.');
  const gemini = await matchWithGemini(normalizedTeacher, normalizedTuition);
  if (!gemini.ok) {
    const result = {
      outcome: 'AI_FAILED',
      wouldApply: false,
      errorCode: gemini.errorCode,
      match: baseMatch(rule, null, 'AI_FAILED', `Gemini evaluation failed: ${gemini.error}`),
    };
    await record(result);
    return result;
  }

  console.log(`[GEMINI] Score ${gemini.result.score}/100`);
  const validAiMatch = passesAutoApplyPolicy(gemini.result);
  const commonMatch = baseMatch(rule, gemini.result, validAiMatch ? 'AUTO_APPLY' : gemini.result.decision);
  if (!validAiMatch) {
    const result = {
      outcome: 'REVIEW_ONLY',
      wouldApply: false,
      match: {
        ...commonMatch,
        reason: `Gemini must return match=true, AUTO_APPLY, and a score of at least ${GEMINI_AUTO_APPLY_MINIMUM}/100. ${gemini.result.reason}`,
      },
    };
    await record(result);
    return result;
  }

  if (!effectiveSettings.autoApply) {
    const result = {
      outcome: 'REVIEW_ONLY',
      wouldApply: false,
      match: { ...commonMatch, reason: 'Match is eligible, but automatic application is disabled for this teacher.' },
    };
    await record(result);
    return result;
  }

  const existingMainApplication = teacher.userId
    ? await TeacherApplication.exists({ jobId: String(tuitionId), userId: String(teacher.userId) })
    : null;
  if (existingMainApplication) {
    const result = {
      outcome: 'ALREADY_APPLIED',
      wouldApply: false,
      match: { ...commonMatch, reason: 'ALREADY_APPLIED: this teacher already has an application for this tuition.' },
    };
    await record(result);
    return result;
  }

  try {
    const mainApplication = await createMainApplicationAndUpdateTuition({ teacher, tuition, match: commonMatch });
    console.log('[AUTO-APPLY] Application created in teacherapplications and the tuition application counter was updated.');
    return { outcome: 'AUTO_APPLIED', wouldApply: true, application: mainApplication, mainApplicationId: mainApplication._id, match: commonMatch };
  } catch (error) {
    if (error?.code === 11000) {
      const result = {
        outcome: 'ALREADY_APPLIED',
        wouldApply: false,
        match: { ...commonMatch, reason: 'ALREADY_APPLIED: duplicate application prevented by database index.' },
      };
      await record(result);
      return result;
    }
    throw error;
  }
}

export async function processTeacherForTuition({ teacherId, tuitionId, source = 'manual-process' }) {
  if (!mongoose.isValidObjectId(teacherId)) {
    const error = new Error('Invalid teacher ID');
    error.statusCode = 400;
    throw error;
  }
  const [teacher, tuition, settings] = await Promise.all([
    TeacherProfile.findById(teacherId).lean(),
    loadTuition(tuitionId),
    TeacherAutomationSettings.findOne({ teacherId }).lean(),
  ]);
  if (!teacher) {
    const error = new Error('Teacher not found');
    error.statusCode = 404;
    throw error;
  }
  if (!isTuitionAvailable(tuition)) {
    const error = new Error(`Tuition is not available (status: ${tuition.status || 'missing'}).`);
    error.statusCode = 409;
    throw error;
  }
  const normalizedTeacher = normalizeTeacherForMatching(teacher);
  const normalizedTuition = normalizeTuitionForMatching(tuition);
  const cachedResult = await getPairCache({ teacher, tuition, settings });
  if (cachedResult) {
    console.log(`[SKIP] Teacher ${teacher._id} -> Tuition ${tuition._id}: ${cachedResult.outcome}.`);
    return { teacher: normalizedTeacher, tuition: normalizedTuition, ...cachedResult };
  }
  const rule = calculateRuleMatch(normalizedTeacher, normalizedTuition);
  const result = await evaluateCandidate({
    teacher,
    settings,
    tuition,
    normalizedTuition,
    rule,
    source,
  });
  return { teacher: normalizedTeacher, tuition: normalizedTuition, ...result };
}

export async function processTuition(tuitionId, { source = 'manual-process' } = {}) {
  const tuition = await loadTuition(tuitionId);
  console.log(`[AUTOMATION] Processing tuition ${tuition._id}.`);
  if (!isTuitionAvailable(tuition)) {
    const error = new Error(`Tuition is not available (status: ${tuition.status || 'missing'}).`);
    error.statusCode = 409;
    throw error;
  }

  const settingsRows = await TeacherAutomationSettings.find({ autoApply: true }).lean();
  const teachers = await TeacherProfile.find({ _id: { $in: settingsRows.map((row) => row.teacherId) } }).lean();
  const settingsByTeacherId = new Map(settingsRows.map((row) => [String(row.teacherId), row]));
  const normalizedTuition = normalizeTuitionForMatching(tuition);
  console.log(`[AUTOMATION] Found ${teachers.length} auto-apply teachers.`);

  const teacherIds = teachers.map((teacher) => teacher._id);
  const teacherUserIds = [...new Set(teachers
    .filter((teacher) => teacher.userId)
    .map((teacher) => String(teacher.userId)))];
  const [mainApplications, evaluations] = await Promise.all([
    teacherUserIds.length
      ? TeacherApplication.find({ jobId: String(tuition._id), userId: { $in: teacherUserIds } }).lean()
      : [],
    teacherIds.length
      ? TuitionAutomationEvaluation.find({ teacherId: { $in: teacherIds }, tuitionId: tuition._id }).sort({ createdAt: -1 }).lean()
      : [],
  ]);
  const applicationsByTeacherUserId = new Map(mainApplications.map((application) => [String(application.userId), application]));
  const latestEvaluationsByTeacherId = new Map();
  for (const evaluation of evaluations) {
    const teacherId = String(evaluation.teacherId);
    if (!latestEvaluationsByTeacherId.has(teacherId)) latestEvaluationsByTeacherId.set(teacherId, evaluation);
  }

  const scored = teachers.map((teacher) => {
    const settings = settingsByTeacherId.get(String(teacher._id));
    const application = teacher.userId ? applicationsByTeacherUserId.get(String(teacher.userId)) : null;
    if (application) return { teacher, settings, cachedResult: alreadyAppliedResult(application) };

    const evaluation = latestEvaluationsByTeacherId.get(String(teacher._id));
    if (evaluationIsCurrent({ evaluation, teacher, tuition, settings })) {
      return { teacher, settings, cachedResult: unchangedEvaluationResult(evaluation) };
    }

    const normalizedTeacher = normalizeTeacherForMatching(teacher);
    return { teacher, settings, rule: calculateRuleMatch(normalizedTeacher, normalizedTuition) };
  });
  const candidates = scored.filter((entry) => !entry.cachedResult && entry.rule.candidate);
  const chosen = new Set(candidates.map((entry) => String(entry.teacher._id)));
  const outcomes = [];

  for (const entry of scored) {
    try {
      if (entry.cachedResult) {
        console.log(`[SKIP] Teacher ${entry.teacher._id} -> Tuition ${tuition._id}: ${entry.cachedResult.outcome}.`);
        outcomes.push(entry.cachedResult);
      } else if (!entry.rule.candidate) {
        outcomes.push(await evaluateCandidate({ ...entry, tuition, normalizedTuition, source }));
      } else {
        outcomes.push(await evaluateCandidate({ ...entry, tuition, normalizedTuition, source }));
      }
    } catch (error) {
      console.error(`[ERROR] Teacher ${entry.teacher._id} failed: ${error.message}`);
      const result = {
        outcome: 'ERROR',
        wouldApply: false,
        errorCode: 'PROCESSING_ERROR',
        match: baseMatch(entry.rule, null, 'AI_FAILED', 'Candidate processing failed safely.'),
      };
      await persistEvaluation({ teacherId: entry.teacher._id, tuitionId: tuition._id, source, ...result });
      outcomes.push(result);
    }
  }

  return {
    tuition: normalizedTuition,
    eligibleTeachers: teachers.length,
    candidatesSentToGemini: chosen.size,
    outcomes,
  };
}

export async function processAllEligibleTuitions({ source = 'scheduler', limit = 50 } = {}) {
  const tuitions = await Tuition.find({ status: availableStatusFilter() }, { _id: 1 }).sort({ createdAt: -1 }).limit(limit).lean();
  const results = [];
  for (const tuition of tuitions) {
    try {
      results.push(await processTuition(tuition._id, { source }));
    } catch (error) {
      console.error(`[ERROR] Tuition ${tuition._id} failed: ${error.message}`);
      results.push({ tuitionId: String(tuition._id), error: error.message });
    }
  }
  return results;
}

export async function listAutomationResults({ limit = 100 } = {}) {
  const [mainApplications, evaluations] = await Promise.all([
    TeacherApplication.find({ autoApplied: true }).sort({ createdAt: -1 }).limit(limit).lean(),
    TuitionAutomationEvaluation.find({}).sort({ createdAt: -1 }).limit(limit).lean(),
  ]);
  const teacherUserIds = [...new Set(mainApplications.map((item) => String(item.userId)))];
  const evaluationTeacherIds = [...new Set(evaluations.map((item) => String(item.teacherId)))];
  const tuitionIds = [...new Set([
    ...mainApplications.map((item) => String(item.jobId)),
    ...evaluations.map((item) => String(item.tuitionId)),
  ])];
  const [teachers, tuitions] = await Promise.all([
    TeacherProfile.find({
      $or: [{ userId: { $in: teacherUserIds } }, { _id: { $in: evaluationTeacherIds } }],
    }, { firstName: 1, lastName: 1, skills: 1, userId: 1 }).lean(),
    Tuition.find({ _id: { $in: tuitionIds } }, { tuitionDetails: 1, subject: 1, classGrade: 1, city: 1 }).lean(),
  ]);
  const teachersById = new Map(teachers.map((teacher) => [String(teacher._id), teacher]));
  const teachersByUserId = new Map(teachers.map((teacher) => [String(teacher.userId), teacher]));
  const tuitionsById = new Map(tuitions.map((tuition) => [String(tuition._id), tuition]));
  const applications = mainApplications.map((item) => ({
    ...item,
    teacherId: teachersByUserId.get(String(item.userId))?._id || null,
    tuitionId: item.jobId,
    applicationType: 'AUTO',
    resultType: 'APPLICATION',
    teacher: teachersByUserId.get(String(item.userId)) || null,
    tuition: tuitionsById.get(String(item.jobId)) || null,
    match: {
      ruleScore: item.automationMatch?.ruleScore ?? null,
      geminiScore: item.matchScore ?? item.automationMatch?.geminiScore ?? null,
      confidence: item.automationMatch?.confidence ?? null,
      decision: item.automationMatch?.decision || 'AUTO_APPLY',
      matchedRequirements: item.automationMatch?.matchedRequirements || [],
      missingRequirements: item.automationMatch?.missingRequirements || [],
      concerns: item.automationMatch?.concerns || [],
      reason: item.automationMatch?.reason || item.coverLetter || 'Automatic application submitted.',
    },
  }));
  const enrichedEvaluations = evaluations.map((item) => ({
    ...item,
    resultType: 'EVALUATION',
    teacher: teachersById.get(String(item.teacherId)) || null,
    tuition: tuitionsById.get(String(item.tuitionId)) || null,
  }));
  return [...applications, ...enrichedEvaluations]
    // Live main-site applications stay visible even when historic evaluation logs are numerous.
    .sort((a, b) => {
      const applicationRank = (item) => item.resultType === 'APPLICATION' ? 0 : 1;
      return applicationRank(a) - applicationRank(b) || new Date(b.createdAt) - new Date(a.createdAt);
    })
    .slice(0, limit);
}

export async function listTuitionAutomationOverview({ limit = 100 } = {}) {
  const tuitions = await Tuition.find({ status: availableStatusFilter() }, {
    tuitionDetails: 1,
    subject: 1,
    classGrade: 1,
    classTiming: 1,
    preferredDays: 1,
    preferredTimeSlots: 1,
    classesPerWeek: 1,
    mode: 1,
    preferredLanguage: 1,
    country: 1,
    city: 1,
    sector: 1,
    priceMin: 1,
    priceMax: 1,
    currency: 1,
    rateType: 1,
    negotiationType: 1,
    additionalInfo: 1,
    status: 1,
    createdAt: 1,
  }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();

  const tuitionIds = tuitions.map((tuition) => tuition._id);
  const [mainApplications, evaluations] = await Promise.all([
    TeacherApplication.find({ autoApplied: true, jobId: { $in: tuitionIds.map(String) } }).sort({ createdAt: -1 }).lean(),
    TuitionAutomationEvaluation.find({ tuitionId: { $in: tuitionIds } }).sort({ createdAt: -1 }).lean(),
  ]);

  // A live application takes priority. Otherwise show only the newest evaluation for each teacher/tuition pair.
  const recordsByPair = new Map();
  for (const application of mainApplications) {
    recordsByPair.set(`${application.userId}:${application.jobId}`, {
      ...application,
      resultType: 'APPLICATION',
      teacherLookup: String(application.userId),
      tuitionId: application.jobId,
      match: {
        ruleScore: application.automationMatch?.ruleScore ?? null,
        geminiScore: application.matchScore ?? application.automationMatch?.geminiScore ?? null,
        confidence: application.automationMatch?.confidence ?? null,
        decision: application.automationMatch?.decision || 'AUTO_APPLY',
        matchedRequirements: application.automationMatch?.matchedRequirements || [],
        missingRequirements: application.automationMatch?.missingRequirements || [],
        concerns: application.automationMatch?.concerns || [],
        reason: application.automationMatch?.reason || application.coverLetter || 'Automatic application submitted.',
      },
    });
  }
  for (const evaluation of evaluations) {
    const key = `${evaluation.teacherId}:${evaluation.tuitionId}`;
    if (!recordsByPair.has(key)) recordsByPair.set(key, { ...evaluation, resultType: 'EVALUATION' });
  }

  const records = [...recordsByPair.values()];
  const teacherIds = [...new Set(records.filter((record) => record.teacherId).map((record) => String(record.teacherId)))];
  const teacherUserIds = [...new Set(records.filter((record) => record.teacherLookup).map((record) => record.teacherLookup))];
  const teachers = await TeacherProfile.find({ _id: { $in: teacherIds } }, {
    firstName: 1,
    lastName: 1,
    skills: 1,
    preferredMode: 1,
    userId: 1,
  }).lean();
  if (teacherUserIds.length) {
    const applicationTeachers = await TeacherProfile.find({ userId: { $in: teacherUserIds } }, {
      firstName: 1,
      lastName: 1,
      skills: 1,
      preferredMode: 1,
      userId: 1,
    }).lean();
    teachers.push(...applicationTeachers);
  }
  const teachersById = new Map(teachers.map((teacher) => [String(teacher._id), teacher]));
  const teachersByUserId = new Map(teachers.map((teacher) => [String(teacher.userId), teacher]));
  const recordsByTuition = new Map();
  for (const record of records) {
    const key = String(record.tuitionId);
    const withTeacher = {
      ...record,
      teacher: record.teacherLookup
        ? teachersByUserId.get(record.teacherLookup) || null
        : teachersById.get(String(record.teacherId)) || null,
    };
    recordsByTuition.set(key, [...(recordsByTuition.get(key) || []), withTeacher]);
  }

  return tuitions.map((tuition) => ({
    tuition,
    teacherResults: (recordsByTuition.get(String(tuition._id)) || [])
      .sort((left, right) => (right.match?.geminiScore ?? right.match?.ruleScore ?? 0) - (left.match?.geminiScore ?? left.match?.ruleScore ?? 0)),
  }));
}
