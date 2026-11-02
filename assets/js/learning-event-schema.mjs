const EVENT_SCHEMA_VERSION = 3;
const MAX_CAUSAL_REFERENCES = 20;
const asObject = value => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const clone = value => JSON.parse(JSON.stringify(value));

function normalizeEventReferences(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(id =>
    typeof id === "string" && id.trim().length > 0 && id.length <= 240
  ))].slice(0, MAX_CAUSAL_REFERENCES);
}

/** Normalize event envelopes without inventing historical causal relationships. */
export function normalizeLearningEvent(event) {
  if (!asObject(event) || typeof event.id !== "string" ||
      !event.id.trim() || event.id.length > 240 ||
      typeof event.type !== "string" || !event.type.trim() ||
      typeof event.at !== "string" || !Number.isFinite(Date.parse(event.at))) return null;
  const normalized = {
    ...clone(event),
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    causationEventIds: normalizeEventReferences(event.causationEventIds),
    targetGapEventIds: normalizeEventReferences(event.targetGapEventIds),
    gapObservationId: typeof event.gapObservationId === "string" && event.gapObservationId.trim()
      ? event.gapObservationId
      : null,
  };
  if (normalized.type === "attempt" && normalized.correct === false && normalized.gapId &&
      !normalized.gapObservationId) {
    normalized.gapObservationId = normalized.id;
  }
  if ((event.causationEventIds?.length || 0) > MAX_CAUSAL_REFERENCES ||
      (event.targetGapEventIds?.length || 0) > MAX_CAUSAL_REFERENCES) return null;
  return normalized;
}

/** Canonical JSON fingerprint: property order is transport detail, not event meaning. */
export function fingerprintLearningEvent(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(fingerprintLearningEvent).join(",") + "]";
  }
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ":" + fingerprintLearningEvent(value[key])
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}
