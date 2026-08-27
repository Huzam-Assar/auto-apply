const AVAILABLE_STATUSES = new Set(['active', 'available', 'open', 'live', 'published']);
const UNAVAILABLE_STATUSES = new Set(['completed', 'cancelled', 'canceled', 'closed', 'deleted', 'inactive', 'archived', 'expired']);

export function normalizedStatus(value) {
  return String(value || '').trim().toLowerCase();
}

export function isTuitionAvailable(tuition) {
  const status = normalizedStatus(tuition?.status);
  return AVAILABLE_STATUSES.has(status) && !UNAVAILABLE_STATUSES.has(status);
}

export function availableStatusValues() {
  return [...AVAILABLE_STATUSES];
}

export function availableStatusFilter() {
  return { $in: [...AVAILABLE_STATUSES].map((status) => new RegExp(`^${status}$`, 'i')) };
}
