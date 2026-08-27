const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export const api = {
  getTeachers: () => request('/teachers?limit=100'),
  getTuitions: () => request('/tuitions?limit=100'),
  getConfig: () => request('/automation/config'),
  updateTeacher: (teacherId, values) => request(`/automation/teachers/${teacherId}`, { method: 'PUT', body: JSON.stringify(values) }),
  processOne: (tuitionId) => request(`/automation/process/${tuitionId}`, { method: 'POST' }),
  processAll: () => request('/automation/process-all', { method: 'POST' }),
  getApplications: () => request('/applications?limit=100'),
  getTuitionAutomationOverview: () => request('/tuition-automation-overview?limit=100'),
};
