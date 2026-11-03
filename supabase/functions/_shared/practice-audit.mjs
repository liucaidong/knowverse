export function comparePracticeAuditRecords(left, right) {
  const leftTime = Date.parse(left?.created_at || "") || 0;
  const rightTime = Date.parse(right?.created_at || "") || 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left?.id || left?.record_id || "").localeCompare(
    String(right?.id || right?.record_id || ""),
  );
}

function stateRevision(record) {
  const revision = Number(record?.payload?.revision);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 0;
}

export function currentPracticeStatus(records) {
  const states = (Array.isArray(records) ? records : [])
    .filter(record => record?.record_type === "state")
    .slice()
    .sort((left, right) =>
      stateRevision(left) - stateRevision(right) ||
      comparePracticeAuditRecords(left, right)
    );
  if (!states.length) return "draft";
  const status = states.at(-1)?.payload?.to;
  return typeof status === "string" && status.trim() ? status.trim() : "draft";
}

export function latestPracticeRecord(records, type, candidateHash) {
  const matches = (Array.isArray(records) ? records : [])
    .filter(record => record?.record_type === type &&
      (!candidateHash || record.candidate_hash === candidateHash))
    .slice()
    .sort(comparePracticeAuditRecords);
  return matches.at(-1) || null;
}

export async function collectAllPracticePages(loadPage, pageSize = 500) {
  if (typeof loadPage !== "function" || !Number.isInteger(pageSize) || pageSize < 1) {
    throw new TypeError("A page loader and positive integer page size are required.");
  }
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await loadPage(offset, pageSize);
    if (!Array.isArray(page)) throw new TypeError("Paged audit query did not return an array.");
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

// The caller paginates the complete private archive before this list is used.
// Keep every candidate in the duplicate-check set; a fixed slice creates a
// silent blind spot once a learner has generated enough practice drafts.
export function allPracticeCandidateHistory(records) {
  if (!Array.isArray(records)) throw new TypeError("Practice candidate history must be an array.");
  return records.slice();
}
