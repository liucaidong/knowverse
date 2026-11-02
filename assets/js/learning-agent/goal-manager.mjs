import { getLearningRepository } from "../backend/learning-repository.mjs";

const TYPE = "learning_goal";
const clone = value => JSON.parse(JSON.stringify(value));
const id = () => globalThis.crypto?.randomUUID?.() || "goal-" + Date.now().toString(36) + Math.random().toString(36).slice(2);
const validText = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const statuses = new Set(["active", "paused", "completed", "cancelled"]);

function validateGoal(input, learningMap, previous = null) {
  const title = validText(input.title ?? previous?.title, 120);
  if (!title) throw new TypeError("学习目标需要填写名称。");
  const knownTopics = new Set((learningMap?.topics || []).map(topic => topic.id));
  const knownCompetencies = new Set((learningMap?.topics || []).flatMap(topic => (topic.competencies || []).map(item => item.id)));
  const topicIds = [...new Set((input.topicIds ?? previous?.topicIds ?? []).filter(value => knownTopics.has(value)))];
  const competencyIds = [...new Set((input.competencyIds ?? previous?.competencyIds ?? []).filter(value => knownCompetencies.has(value)))];
  if (!topicIds.length && !competencyIds.length) throw new TypeError("至少关联一个现有知识专题或 Concept 能力点。");
  const targetAt = input.targetAt === undefined ? previous?.targetAt || null :
    input.targetAt && Number.isFinite(Date.parse(input.targetAt)) ? new Date(input.targetAt).toISOString() : null;
  if (input.targetAt && !targetAt) throw new TypeError("目标日期无效。");
  const priority = Number(input.priority ?? previous?.priority ?? 3);
  const dailyMinutes = Number(input.dailyMinutes ?? previous?.dailyMinutes ?? 25);
  return {
    goalId: previous?.goalId || input.goalId || id(),
    title,
    description: validText(input.description ?? previous?.description ?? "", 2000),
    topicIds,
    competencyIds,
    targetAt,
    dailyMinutes: Number.isInteger(dailyMinutes) ? Math.max(5, Math.min(240, dailyMinutes)) : 25,
    priority: Number.isInteger(priority) ? Math.max(1, Math.min(5, priority)) : 3,
    acceptanceCriteria: validText(input.acceptanceCriteria ?? previous?.acceptanceCriteria ??
      "关联知识点达到稳定掌握，且不存在未解决的关键薄弱点。", 1000),
    status: previous?.status || "active",
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: (Number(previous?.revision) || 0) + 1,
    source: "learner",
  };
}

function goalEvent(goal, type, extra = {}, at = new Date().toISOString()) {
  return {
    id: "goal:" + goal.goalId + ":" + type + ":" + (goal.revision || 1),
    type,
    at,
    topicId: goal.topicIds[0] || "unclassified",
    challengeId: "learning-agent",
    challengeTitle: "学习目标管理",
    stepId: goal.goalId,
    stepTitle: goal.title,
    competencyIds: goal.competencyIds || [],
    sessionId: "goal:" + goal.goalId,
    sessionType: "goal",
    goalId: goal.goalId,
    goalRevision: goal.revision,
    goalStatus: goal.status,
    ...extra,
  };
}

export function createLearningGoalManager(options = {}) {
  const repositoryPromise = options.repository ? Promise.resolve(options.repository) : getLearningRepository();
  const learningMap = options.learningMap;
  async function get(goalId) {
    const repository = await repositoryPromise;
    const row = await repository.documents.get(TYPE, goalId);
    return row && !row.payload?._deleted ? { ...row.payload, localRevision: row.localRevision } : null;
  }
  async function list() {
    const repository = await repositoryPromise;
    const rows = await repository.documents.list(1000);
    return rows.filter(row => row.type === TYPE && !row.payload?._deleted)
      .map(row => ({ ...row.payload, localRevision: row.localRevision }))
      .sort((a, b) => b.priority - a.priority || String(a.targetAt || "9999").localeCompare(String(b.targetAt || "9999")));
  }
  async function create(input) {
    const repository = await repositoryPromise;
    const goal = validateGoal(input, learningMap);
    const existing = await repository.documents.get(TYPE, goal.goalId);
    if (existing) throw new Error("目标 ID 已存在。");
    await repository.commit({
      events: [goalEvent(goal, "learning_goal_created", { actor: "learner" })],
      documents: [{ type: TYPE, key: goal.goalId, payload: goal, expectedLocalRevision: 0 }],
    });
    return get(goal.goalId);
  }
  async function update(goalId, patch, options = {}) {
    const repository = await repositoryPromise;
    const row = await repository.documents.get(TYPE, goalId);
    if (!row || row.payload?._deleted) throw new Error("学习目标不存在。");
    const previous = row.payload;
    if (!statuses.has(previous.status)) throw new Error("目标状态无效，拒绝修改。");
    const goal = validateGoal({ ...patch, goalId }, learningMap, previous);
    goal.status = patch.status || previous.status;
    if (patch.status && patch.status !== previous.status) {
      const allowed = {
        active: ["paused", "completed", "cancelled"],
        paused: ["active", "cancelled"],
        completed: [],
        cancelled: [],
      };
      if (!allowed[previous.status]?.includes(patch.status)) throw new Error("不允许的学习目标状态转换。");
      if (patch.status === "completed") {
        const profile = options.profile;
        const progress = profile?.goals?.find(item => item.goalId === goalId);
        if (!progress || progress.status !== "ready-to-complete") {
          throw new Error("关联知识点尚未全部达到稳定掌握，不能完成该目标。");
        }
      }
    }
    const eventType = patch.status
      ? patch.status === "paused" ? "learning_goal_paused" :
        patch.status === "active" ? "learning_goal_resumed" :
          patch.status === "completed" ? "learning_goal_completed" : "learning_goal_cancelled"
      : "learning_goal_updated";
    await repository.commit({
      events: [goalEvent(goal, eventType, { actor: "learner", previousRevision: previous.revision })],
      documents: [{
        type: TYPE, key: goalId, payload: goal,
        expectedLocalRevision: Number(row.localRevision) || 0,
      }],
    });
    return get(goalId);
  }
  async function remove(goalId) {
    const repository = await repositoryPromise;
    const row = await repository.documents.get(TYPE, goalId);
    if (!row || row.payload?._deleted) return false;
    const goal = row.payload;
    const at = new Date().toISOString();
    const event = goalEvent({ ...goal, revision: (goal.revision || 0) + 1 }, "learning_goal_deleted", { actor: "learner" }, at);
    await repository.commit({
      events: [event],
      documents: [{
        type: TYPE,
        key: goalId,
        payload: { _deleted: true, deletedAt: at, goalId, lastKnownTitle: goal.title },
        expectedLocalRevision: Number(row.localRevision) || 0,
      }],
    });
    return true;
  }
  return { get, list, create, update, pause: (goalId) => update(goalId, { status: "paused" }),
    resume: goalId => update(goalId, { status: "active" }),
    complete: (goalId, profile) => update(goalId, { status: "completed" }, { profile }),
    cancel: goalId => update(goalId, { status: "cancelled" }),
    remove };
}
