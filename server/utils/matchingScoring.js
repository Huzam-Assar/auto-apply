// This is deliberately a gate, not a subject/qualification scoring system.
// Gemini receives only subject evidence (teacher skills) and grade information.
// Mode, on-site location, and language are handled here; education, experience,
// and availability are ignored.
export function calculateRuleMatch(teacher, tuition) {
  const matchedRequirements = [];
  const missingRequirements = [];
  const concerns = [];
  const hardFailures = [];

  if (tuition.preferredMode === 'online' || tuition.preferredMode === 'both') {
    matchedRequirements.push('Online tuition: physical location is not required');
  } else if (tuition.preferredMode === 'physical') {
    if (!teacher.country || !tuition.country) {
      hardFailures.push('On-site tuition requires a country for both teacher and tuition');
      missingRequirements.push('Country');
    } else if (teacher.country !== tuition.country) {
      hardFailures.push('On-site tuition country does not match the teacher country');
    }

    if (!teacher.city || !tuition.city) {
      hardFailures.push('On-site tuition requires a city for both teacher and tuition');
      missingRequirements.push('City');
    } else if (teacher.city !== tuition.city) {
      hardFailures.push('On-site tuition city does not match the teacher city');
    }

    if (hardFailures.length === 0) matchedRequirements.push('On-site city and country match');
  } else {
    hardFailures.push('Tuition mode must be online, physical, or both');
    concerns.push('Tuition mode is missing or unsupported');
  }

  if (tuition.preferredLanguage) {
    if (teacher.languages.includes(tuition.preferredLanguage)) {
      matchedRequirements.push('Preferred language match');
    } else if (teacher.languages.length === 0) {
      hardFailures.push('Teacher language is missing for a tuition with a language requirement');
      missingRequirements.push('Preferred language');
    } else {
      hardFailures.push('Teacher language does not match the tuition preferred language');
    }
  }

  const candidate = hardFailures.length === 0;
  return {
    // Preserved for result display compatibility. It is a pass/fail gate, not a quality score.
    score: candidate ? 100 : 0,
    candidate,
    hardFailures,
    matchedRequirements,
    missingRequirements,
    concerns,
    reason: candidate
      ? 'Passed the backend mode/location/language gate; Gemini will evaluate subject and grade.'
      : hardFailures.join('. '),
  };
}
