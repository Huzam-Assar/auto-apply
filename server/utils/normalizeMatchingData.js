const LANGUAGE_ALIASES = new Map([
  ['en', 'english'], ['eng', 'english'], ['english', 'english'],
  ['ur', 'urdu'], ['urd', 'urdu'], ['urdu', 'urdu'],
]);

const MODE_ALIASES = new Map([
  ['online', 'online'], ['remote', 'online'], ['virtual', 'online'],
  ['physical', 'physical'], ['in person', 'physical'], ['inperson', 'physical'], ['home', 'physical'], ['offline', 'physical'],
  ['both', 'both'], ['hybrid', 'both'], ['any', 'both'],
]);

const COUNTRY_ALIASES = new Map([
  ['pak', 'pakistan'], ['pk', 'pakistan'], ['pakistan', 'pakistan'],
]);

const CITY_ALIASES = new Map([
  ['isl', 'islamabad'], ['islamabad', 'islamabad'],
  ['raw', 'rawalpindi'], ['rawalpindi', 'rawalpindi'],
]);

const SUBJECT_ALIASES = new Map([
  ['math', 'mathematics'], ['maths', 'mathematics'], ['mathematics', 'mathematics'],
  ['computer science', 'computer science'], ['cs', 'computer science'],
  ['programming', 'programming'], ['python programming', 'programming'], ['python', 'programming'],
  ['machine learning', 'machine learning'], ['ml', 'machine learning'],
  ['data science', 'data science'], ['data analytics', 'data science'],
  ['english', 'english'], ['english literature', 'english literature'],
  ['physics', 'physics'], ['chemistry', 'chemistry'], ['biology', 'biology'], ['algebra', 'algebra'],
]);

const SUBJECT_FAMILIES = [
  new Set(['mathematics', 'algebra']),
  new Set(['data science', 'machine learning', 'programming', 'computer science']),
  new Set(['english', 'english literature']),
];

export function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizedStringArray(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map(normalizeText).filter(Boolean);
}

export function normalizeLanguage(value) {
  const normalized = normalizeText(value);
  return LANGUAGE_ALIASES.get(normalized) || normalized;
}

export function normalizeMode(value) {
  const normalized = normalizeText(value);
  return MODE_ALIASES.get(normalized) || normalized;
}

export function normalizeCountry(value) {
  const normalized = normalizeText(value);
  return COUNTRY_ALIASES.get(normalized) || normalized;
}

export function normalizeCity(value) {
  const normalized = normalizeText(value);
  return CITY_ALIASES.get(normalized) || normalized;
}

export function normalizeSubject(value) {
  const normalized = normalizeText(value);
  return SUBJECT_ALIASES.get(normalized) || normalized;
}

function subjectCandidates(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const candidates = new Set([normalizeSubject(normalized)]);
  const padded = ` ${normalized} `;
  for (const [alias, canonical] of SUBJECT_ALIASES.entries()) {
    if (padded.includes(` ${alias} `)) candidates.add(canonical);
  }
  return [...candidates].filter(Boolean);
}

function oneSubjectSimilarity(a, b) {
  if (a === b) return 1;
  const sameFamily = SUBJECT_FAMILIES.some((family) => family.has(a) && family.has(b));
  if (sameFamily) {
    if (new Set(['mathematics', 'algebra']).has(a) && new Set(['mathematics', 'algebra']).has(b)) return 0.9;
    if (new Set(['data science', 'machine learning']).has(a) && new Set(['data science', 'machine learning']).has(b)) return 0.8;
    return 0.7;
  }
  const aTokens = new Set(a.split(' ').filter((token) => token.length > 2));
  const bTokens = new Set(b.split(' ').filter((token) => token.length > 2));
  const shared = [...aTokens].filter((token) => bTokens.has(token)).length;
  return shared ? Math.min(0.6, shared / Math.max(aTokens.size, bTokens.size)) : 0;
}

export function subjectSimilarity(left, right) {
  const leftCandidates = subjectCandidates(left);
  const rightCandidates = subjectCandidates(right);
  if (!leftCandidates.length || !rightCandidates.length) return 0;
  return Math.max(0, ...leftCandidates.flatMap((a) => rightCandidates.map((b) => oneSubjectSimilarity(a, b))));
}

function meaningfulEntries(entries, keys) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => entry && keys.some((key) => normalizeText(entry[key])));
}

export function normalizeTeacherForMatching(teacher) {
  const education = meaningfulEntries(teacher.education, ['school', 'degree', 'field', 'description']);
  const experience = meaningfulEntries(teacher.experience, ['company', 'role', 'description']);
  const certificates = meaningfulEntries(teacher.certificates, ['name', 'description']);
  // Keep the teacher's real skill wording for Gemini's open-ended subject reasoning.
  const skills = normalizedStringArray(teacher.skills);
  const educationText = education.map((item) => [item.degree, item.field, item.description].filter(Boolean).join(' '));
  const experienceText = experience.map((item) => [item.role, item.description].filter(Boolean).join(' '));
  const certificateText = certificates.map((item) => [item.name, item.description].filter(Boolean).join(' '));
  const availableDays = normalizedStringArray(teacher.availableDays || teacher.preferredDays || teacher.availability?.days);
  const availableTimeSlots = normalizedStringArray(teacher.availableTimeSlots || teacher.preferredTimeSlots || teacher.availability?.timeSlots);
  const grades = normalizedStringArray(teacher.grades || teacher.classGrades || teacher.preferredGrades || teacher.levels);

  return {
    id: String(teacher._id),
    name: [teacher.firstName, teacher.lastName].filter(Boolean).join(' ').trim() || 'Unnamed teacher',
    skills,
    languages: normalizedStringArray(teacher.languages).map(normalizeLanguage).filter(Boolean),
    preferredMode: normalizeMode(teacher.preferredMode || teacher.mode),
    country: normalizeCountry(teacher.country),
    city: normalizeCity(teacher.city),
    summary: String(teacher.summary || '').trim(),
    education,
    experience,
    certificates,
    educationText,
    experienceText,
    certificateText,
    availableDays,
    availableTimeSlots,
    grades,
  };
}

export function normalizeTuitionForMatching(tuition) {
  return {
    id: String(tuition._id),
    title: String(tuition.tuitionDetails || tuition.subject || 'Untitled tuition').trim(),
    subject: normalizeSubject(tuition.subject || tuition.tuitionDetails),
    classGrade: normalizeText(tuition.classGrade || tuition.grade || tuition.level),
    preferredMode: normalizeMode(tuition.mode || tuition.preferredMode),
    preferredLanguage: normalizeLanguage(tuition.preferredLanguage || tuition.language),
    country: normalizeCountry(tuition.country),
    city: normalizeCity(tuition.city),
    sector: normalizeText(tuition.sector),
    preferredDays: normalizedStringArray(tuition.preferredDays),
    preferredTimeSlots: normalizedStringArray(tuition.preferredTimeSlots),
    classTiming: String(tuition.classTiming || '').trim(),
    classesPerWeek: String(tuition.classesPerWeek || '').trim(),
    priceMin: Number.isFinite(Number(tuition.priceMin)) ? Number(tuition.priceMin) : null,
    priceMax: Number.isFinite(Number(tuition.priceMax)) ? Number(tuition.priceMax) : null,
    currency: String(tuition.currency || '').trim(),
    rateType: String(tuition.rateType || '').trim(),
    negotiationType: String(tuition.negotiationType || '').trim(),
    additionalInfo: String(tuition.additionalInfo || '').trim(),
    status: String(tuition.status || '').trim(),
  };
}
