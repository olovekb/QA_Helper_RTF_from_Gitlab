const MIN_PROGRESS_PERCENT = 3;
const MIN_ELAPSED_MS = 15000;
const MAX_ESTIMATED_TOTAL_MS = 24 * 60 * 60 * 1000;

const toTimestampMs = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getEstimatedRemainingMs = ({ status, progress, startedAt, now = Date.now() }) => {
  const startedAtMs = toTimestampMs(startedAt);
  const normalizedProgress = Number(progress);

  if (status !== 'processing' || !startedAtMs || !Number.isFinite(normalizedProgress)) {
    return null;
  }

  if (normalizedProgress < MIN_PROGRESS_PERCENT || normalizedProgress >= 100) {
    return null;
  }

  const elapsedMs = Math.max(0, now - startedAtMs);
  if (elapsedMs < MIN_ELAPSED_MS) {
    return null;
  }

  const estimatedTotalMs = elapsedMs / (normalizedProgress / 100);
  if (!Number.isFinite(estimatedTotalMs) || estimatedTotalMs > MAX_ESTIMATED_TOTAL_MS) {
    return null;
  }

  const remainingMs = estimatedTotalMs - elapsedMs;
  return remainingMs > 0 ? remainingMs : null;
};

export const formatApproxDuration = (durationMs) => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '';
  }

  const totalMinutes = Math.ceil(durationMs / 60000);
  if (totalMinutes <= 1) {
    return '~1 мин';
  }

  if (totalMinutes < 60) {
    return `~${totalMinutes} мин`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) {
    return `~${hours} ч`;
  }

  return `~${hours} ч ${minutes} мин`;
};

export const getProgressEtaLabel = (params) => {
  const remainingMs = getEstimatedRemainingMs(params);
  if (!remainingMs) {
    return '';
  }

  return formatApproxDuration(remainingMs);
};

export const formatProgressWithEta = (progress, etaLabel) => (
  etaLabel ? `${progress}% • ${etaLabel}` : `${progress}%`
);
