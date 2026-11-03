import { getLearningRepository } from "./backend/learning-repository.mjs";

const DOCUMENT_TYPE = "learner_profile";
const KEY_PREFIX = "learning-reflection:";
const FIELDS = Object.freeze(["initialThinking", "insightChanged", "remainingQuestions", "transferPlan"]);
const LIMITS = Object.freeze({
  initialThinking: 2000,
  insightChanged: 2000,
  remainingQuestions: 2000,
  transferPlan: 2000,
});
const clean = (value, limit) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const unique = values => [...new Set((Array.isArray(values) ? values : [])
  .filter(value => typeof value === "string" && value.trim())
  .map(value => value.trim().slice(0, 100)))].slice(0, 10);
const randomId = () => globalThis.crypto?.randomUUID?.()
  || Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);

function normalizeContext(value = {}) {
  return {
    pageTitle: clean(value.pageTitle, 180),
    pagePath: clean(value.pagePath, 300),
    topicId: clean(value.topicId, 100) || null,
    competencyIds: unique(value.competencyIds),
    taskId: clean(value.taskId, 160) || null,
    taskTitle: clean(value.taskTitle, 180) || null,
  };
}

export function normalizeLearningReflection(value = {}) {
  const reflection = Object.fromEntries(FIELDS.map(key => [key, clean(value[key], LIMITS[key])]));
  if (!FIELDS.some(key => reflection[key])) {
    throw new TypeError("至少填写一项反思内容后再保存。");
  }
  return reflection;
}

export function createLearningReflectionStore(options = {}) {
  const repositoryPromise = options.repository
    ? Promise.resolve(options.repository)
    : getLearningRepository();
  const clock = typeof options.clock === "function" ? options.clock : () => new Date();

  async function list(options = {}) {
    const repository = await repositoryPromise;
    const rows = await repository.documents.list(1000);
    const competencyFilter = new Set(unique(options.competencyIds));
    const topicFilter = clean(options.topicId, 100);
    return rows
      .filter(row => row.type === DOCUMENT_TYPE && row.key.startsWith(KEY_PREFIX) &&
        !row.payload?._deleted && row.payload?.purpose === "learning_reflection" &&
        row.payload?.schemaVersion === 1)
      .map(row => ({
        ...row.payload,
        localRevision: Number(row.localRevision) || 0,
      }))
      .filter(item => !options.taskId || item.context?.taskId === options.taskId)
      .filter(item => !topicFilter || item.context?.topicId === topicFilter)
      .filter(item => !competencyFilter.size || (item.context?.competencyIds || [])
        .some(id => competencyFilter.has(id)))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, Math.max(1, Math.min(50, Number(options.limit) || 10)));
  }

  async function save(input = {}) {
    const repository = await repositoryPromise;
    const reflectionId = clean(input.reflectionId, 120) || randomId();
    if (!/^[a-zA-Z0-9_-]{8,120}$/.test(reflectionId)) {
      throw new TypeError("反思记录标识无效。");
    }
    const key = KEY_PREFIX + reflectionId;
    const previous = await repository.documents.get(DOCUMENT_TYPE, key);
    if (input.reflectionId && (!previous || previous.payload?._deleted ||
        previous.payload?.purpose !== "learning_reflection")) {
      throw new Error("要修改的反思记录不存在。");
    }
    const at = clock().toISOString();
    const payload = {
      schemaVersion: 1,
      purpose: "learning_reflection",
      reflectionId,
      createdAt: previous?.payload?.createdAt || at,
      updatedAt: at,
      context: normalizeContext(input.context),
      ...normalizeLearningReflection(input),
    };
    await repository.commit({
      documents: [{
        type: DOCUMENT_TYPE,
        key,
        payload,
        expectedLocalRevision: Number(previous?.localRevision) || 0,
      }],
    });
    return { ...payload, localRevision: (Number(previous?.localRevision) || 0) + 1 };
  }

  async function remove(reflectionId) {
    const id = clean(reflectionId, 120);
    if (!/^[a-zA-Z0-9_-]{8,120}$/.test(id)) throw new TypeError("反思记录标识无效。");
    const repository = await repositoryPromise;
    const key = KEY_PREFIX + id;
    const previous = await repository.documents.get(DOCUMENT_TYPE, key);
    if (!previous || previous.payload?._deleted || previous.payload?.purpose !== "learning_reflection") {
      return false;
    }
    await repository.commit({
      documents: [{
        type: DOCUMENT_TYPE,
        key,
        payload: { _deleted: true, deletedAt: clock().toISOString(), purpose: "learning_reflection" },
        expectedLocalRevision: Number(previous.localRevision) || 0,
      }],
    });
    return true;
  }

  return { list, save, remove };
}
