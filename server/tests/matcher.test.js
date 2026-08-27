import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTeacherForMatching, normalizeTuitionForMatching, subjectSimilarity } from '../utils/normalizeMatchingData.js';
import { calculateRuleMatch } from '../utils/matchingScoring.js';
import { buildGeminiPayload, geminiRateLimitDelayMs, isGeminiRateLimit, SYSTEM_INSTRUCTION, validateGeminiMatch } from '../services/geminiMatcher.js';
import { buildMainTeacherApplication, evaluationIsCurrent, passesAutoApplyPolicy } from '../services/teacherAutomationService.js';
import { isTuitionAvailable } from '../utils/tuitionAvailability.js';

test('normalizes safe language, mode, and subject aliases', () => {
  const teacher = normalizeTeacherForMatching({ _id: '1', languages: ['eng'], preferredMode: 'ONLINE', skills: ['Mathematics'] });
  const tuition = normalizeTuitionForMatching({ _id: '2', subject: 'maths', mode: 'Online', preferredLanguage: 'EN' });
  assert.deepEqual(teacher.languages, ['english']);
  assert.equal(teacher.preferredMode, 'online');
  assert.equal(tuition.subject, 'mathematics');
  assert.equal(tuition.preferredLanguage, 'english');
  assert.equal(normalizeTuitionForMatching({ _id: '3', country: 'Pak', city: 'Isl' }).country, 'pakistan');
  assert.equal(normalizeTuitionForMatching({ _id: '3', country: 'Pak', city: 'Isl' }).city, 'islamabad');
});

test('recognizes limited, defensible related subjects', () => {
  assert.ok(subjectSimilarity('Data Science', 'Machine Learning') >= 0.8);
  assert.ok(subjectSimilarity('Mathematics', 'Algebra') >= 0.9);
  assert.equal(subjectSimilarity('English Literature', 'Physics'), 0);
});

test('preserves any teacher skill wording for marketplace-wide Gemini subject reasoning', () => {
  const teacher = normalizeTeacherForMatching({ _id: '1', skills: ['Computer Science', 'HTML & CSS', 'Organic Chemistry'] });
  assert.deepEqual(teacher.skills, ['computer science', 'html css', 'organic chemistry']);
});

test('passes online tuition to Gemini without a location gate', () => {
  const teacher = normalizeTeacherForMatching({ _id: '1', skills: ['Unrelated subject'], country: 'Pakistan', city: 'Karachi' });
  const tuition = normalizeTuitionForMatching({ _id: '2', subject: 'Physics', mode: 'online', country: 'USA', city: 'New York' });
  const result = calculateRuleMatch(teacher, tuition);
  assert.equal(result.candidate, true);
  assert.equal(result.score, 100);
});

test('requires exact city and country before Gemini for on-site tuition', () => {
  const teacher = normalizeTeacherForMatching({ _id: '1', country: 'Pakistan', city: 'Islamabad' });
  const samePlace = normalizeTuitionForMatching({ _id: '2', mode: 'physical', country: 'Pak', city: 'Isl' });
  const differentCity = normalizeTuitionForMatching({ _id: '3', mode: 'physical', country: 'Pakistan', city: 'Lahore' });
  assert.equal(calculateRuleMatch(teacher, samePlace).candidate, true);
  assert.equal(calculateRuleMatch(teacher, differentCity).candidate, false);
  assert.match(calculateRuleMatch(teacher, differentCity).hardFailures.join(' '), /city does not match/);
});

test('requires the preferred language before sending a pair to Gemini', () => {
  const teacher = normalizeTeacherForMatching({ _id: '1', languages: ['English'] });
  const englishTuition = normalizeTuitionForMatching({ _id: '2', mode: 'online', preferredLanguage: 'eng' });
  const urduTuition = normalizeTuitionForMatching({ _id: '3', mode: 'online', preferredLanguage: 'urdu' });
  assert.equal(calculateRuleMatch(teacher, englishTuition).candidate, true);
  assert.equal(calculateRuleMatch(teacher, urduTuition).candidate, false);
  assert.match(calculateRuleMatch(teacher, urduTuition).hardFailures.join(' '), /language does not match/);
});

test('does not consider completed or inactive tuitions available', () => {
  assert.equal(isTuitionAvailable({ status: 'completed' }), false);
  assert.equal(isTuitionAvailable({ status: 'inactive' }), false);
  assert.equal(isTuitionAvailable({ status: 'open' }), true);
});

test('rejects malformed Gemini results', () => {
  assert.equal(validateGeminiMatch({ match: true, score: 120 }).valid, false);
  assert.equal(validateGeminiMatch({
    match: true,
    score: 91,
    confidence: 0.9,
    decision: 'AUTO_APPLY',
    matchedRequirements: [],
    missingRequirements: [],
    concerns: [],
    reason: 'Valid',
  }).valid, true);
});

test('recognizes Gemini quota errors and uses the requested reset delay', () => {
  const quotaError = new Error('429 RESOURCE_EXHAUSTED: retryDelay":"15s');
  assert.equal(isGeminiRateLimit(quotaError), true);
  assert.equal(geminiRateLimitDelayMs(quotaError), 16_000);
  assert.equal(geminiRateLimitDelayMs(new Error('429 RESOURCE_EXHAUSTED: retryDelay":"125s')), 126_000);
  assert.equal(geminiRateLimitDelayMs(new Error('429 quota exceeded')), 61_000);
});

test('sends Gemini only skill, grade, subject, and requested grade data', () => {
  const payload = buildGeminiPayload(
    { skills: ['Physics'], grades: ['Grade 9'], education: [{ degree: 'MSc' }], experience: [{ role: 'Tutor' }], availableDays: ['Monday'] },
    { subject: 'physics', classGrade: 'grade 9', preferredLanguage: 'english', preferredDays: ['monday'] },
  );
  assert.deepEqual(payload, {
    teacher: { skills: ['Physics'], grades: ['Grade 9'] },
    tuition: { subject: 'physics', classGrade: 'grade 9' },
  });
});

test('requires direct teachable subject evidence instead of an indirect academic foundation', () => {
  assert.match(SYSTEM_INSTRUCTION, /Data Science alone is not evidence that the teacher can teach Mathematics/);
  assert.match(SYSTEM_INSTRUCTION, /computer science can support Python programming/);
  assert.doesNotMatch(SYSTEM_INSTRUCTION, /foundational discipline/);
});

test('uses the fixed backend Gemini quality requirement for automatic applications', () => {
  assert.equal(passesAutoApplyPolicy({ match: true, score: 70, decision: 'AUTO_APPLY' }), true);
  assert.equal(passesAutoApplyPolicy({ match: true, score: 90, decision: 'RECOMMEND' }), false);
  assert.equal(passesAutoApplyPolicy({ match: true, score: 69, decision: 'AUTO_APPLY' }), false);
  assert.equal(passesAutoApplyPolicy({ match: false, score: 99, decision: 'REJECT' }), false);
});

test('builds a main-website-compatible teacherapplications record', () => {
  const record = buildMainTeacherApplication({
    teacher: { _id: 'teacher-profile-id', userId: 'teacher-user-id', agreementAccepted: true, skills: ['Data Science'] },
    tuition: { _id: 'tuition-id', userId: 'student-user-id', tuitionDetails: 'Data Science' },
    match: { ruleScore: 60, geminiScore: 75, confidence: 0.9, decision: 'AUTO_APPLY', reason: 'Strong match', matchedRequirements: [], missingRequirements: [], concerns: [] },
  });
  assert.equal(record.userId, 'teacher-user-id');
  assert.equal(record.jobId, 'tuition-id');
  assert.equal(record.status, 'Submitted');
  assert.equal(record.autoApplied, true);
  assert.equal(record.matchScore, 75);
  assert.equal(record.resume.profileData.skills[0], 'Data Science');
});

test('reuses a completed pair evaluation until its inputs change', () => {
  const evaluation = { outcome: 'REVIEW_ONLY', dryRun: false, createdAt: new Date('2026-08-24T01:00:00Z') };
  const inputs = {
    teacher: { updatedAt: new Date('2026-08-24T00:00:00Z') },
    tuition: { updatedAt: new Date('2026-08-24T00:30:00Z') },
    settings: { updatedAt: new Date('2026-08-24T00:45:00Z') },
  };
  assert.equal(evaluationIsCurrent({ evaluation, ...inputs }), true);
  assert.equal(evaluationIsCurrent({ evaluation: { ...evaluation, dryRun: true }, ...inputs }), false);
  assert.equal(evaluationIsCurrent({ evaluation, ...inputs, teacher: { updatedAt: new Date('2026-08-24T02:00:00Z') } }), false);
  assert.equal(evaluationIsCurrent({ evaluation: { ...evaluation, outcome: 'AI_FAILED' }, ...inputs }), false);
});
