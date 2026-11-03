import { getLearningRepository } from "./backend/learning-repository.mjs";

const DOCUMENT_TYPE = "learner_profile";
const KEY_PREFIX = "practice-candidate:";
const TASK_TYPES = new Set(["predict", "trace", "diagnose", "transfer", "explain"]);
const DIFFICULTIES = new Set(["foundation", "intermediate", "stretch"]);
const ownKeys = (value, allowed) => Object.keys(value).every(key => allowed.has(key));
const clean = (value, limit) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const requiredText = (value, limit, label, min = 8) => {
  const result = clean(value, limit);
  if (result.length < min) throw new TypeError(label + "内容过短或缺失。");
  return result;
};
const normalizeText = value => clean(value, 2000).toLocaleLowerCase("zh-CN")
  .replace(/[\s\p{P}\p{S}]+/gu, "");
const unique = values => [...new Set((Array.isArray(values) ? values : [])
  .filter(value => typeof value === "string" && value.trim())
  .map(value => value.trim()))];
const makeId = () => globalThis.crypto?.randomUUID?.()
  || Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);

function exactSourceVariants(registry, competencyId, gapId) {
  return (registry?.assessments || []).filter(item =>
    item.competencyId === competencyId &&
    Array.isArray(item.gapIds) && item.gapIds.includes(gapId)
  );
}

export function validateLearningPracticeCandidate(value, context = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("练习候选必须是 JSON 对象。");
  }
  const allowed = new Set([
    "title", "taskType", "prompt", "stimulus", "expectedReasoning",
    "exemplarAnswer", "commonTrap", "hints", "rubric", "difficulty",
    "sourceVariantIds",
  ]);
  if (!ownKeys(value, allowed) || [...allowed].some(key => !(key in value))) {
    throw new TypeError("练习候选字段不完整或包含未允许字段。");
  }
  const competencyId = clean(context.competencyId, 120);
  const gapId = clean(context.gapId, 120);
  const topicId = clean(context.topicId, 120);
  if (!competencyId || !gapId || !topicId) throw new TypeError("练习候选缺少有效的知识目标。");

  const title = requiredText(value.title, 120, "练习标题", 4);
  const prompt = requiredText(value.prompt, 900, "练习任务", 16);
  const stimulus = clean(value.stimulus, 2400);
  const expectedReasoning = requiredText(value.expectedReasoning, 1600, "预期推理");
  const exemplarAnswer = requiredText(value.exemplarAnswer, 1600, "参考答案");
  const commonTrap = requiredText(value.commonTrap, 700, "常见误区");
  const taskType = clean(value.taskType, 40);
  const difficulty = clean(value.difficulty, 40);
  if (!TASK_TYPES.has(taskType)) throw new TypeError("练习类型无效。");
  if (!DIFFICULTIES.has(difficulty)) throw new TypeError("练习难度无效。");

  const sourceVariantIds = unique(value.sourceVariantIds);
  if (sourceVariantIds.length !== 2) {
    throw new TypeError("练习必须引用同一薄弱点下的两个不同正式题目变体。");
  }
  const canonicalSources = exactSourceVariants(context.registry, competencyId, gapId);
  const sourceById = new Map(canonicalSources.map(item => [item.id, item]));
  if (sourceVariantIds.some(id => !sourceById.has(id))) {
    throw new TypeError("练习引用了不属于当前能力点 / 薄弱点的题目变体。");
  }
  const allowedSourceIds = unique(context.allowedSourceVariantIds);
  if (allowedSourceIds.length &&
      (allowedSourceIds.length !== 2 ||
        allowedSourceIds.some(id => !sourceById.has(id)) ||
        sourceVariantIds.some(id => !allowedSourceIds.includes(id)))) {
    throw new TypeError("练习引用的来源必须严格匹配本轮提供的两个正式题目锚点。");
  }

  const recentlyUsed = new Set(unique(context.recentlyUsedVariantIds));
  const unusedSourceIds = canonicalSources.map(item => item.id).filter(id => !recentlyUsed.has(id));
  if (unusedSourceIds.length && !sourceVariantIds.some(id => !recentlyUsed.has(id))) {
    throw new TypeError("练习只引用了近期已用变体；至少应包含一个未近期使用的正式题目锚点。");
  }

  const normalizedPrompt = normalizeText(prompt);
  const normalizedStimulus = normalizeText(stimulus);
  for (const source of sourceVariantIds.map(id => sourceById.get(id))) {
    if (normalizedPrompt === normalizeText(source.prompt) ||
        (normalizedStimulus && normalizedStimulus === normalizeText(source.code || ""))) {
      throw new TypeError("练习内容与引用的正式题目重复，不能作为新变体候选。");
    }
  }

  const hints = Array.isArray(value.hints) ? value.hints : [];
  if (hints.length !== 2 || hints.some(item => typeof item !== "string" || item.trim().length < 4 || item.length > 320)) {
    throw new TypeError("练习必须提供两级有效提示。");
  }
  const rubricInput = Array.isArray(value.rubric) ? value.rubric : [];
  if (rubricInput.length < 2 || rubricInput.length > 4) {
    throw new TypeError("练习评分参考必须包含 2–4 个检查要点。");
  }
  const rubricIds = new Set();
  const rubric = rubricInput.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        !ownKeys(item, new Set(["id", "criterion", "expectedSignal"])) ||
        !["id", "criterion", "expectedSignal"].every(key => key in item)) {
      throw new TypeError("第 " + (index + 1) + " 个推理检查点格式无效。");
    }
    const id = clean(item.id, 32);
    if (!/^[a-z0-9_-]{2,32}$/i.test(id) || rubricIds.has(id)) {
      throw new TypeError("推理检查点标识无效或重复。");
    }
    rubricIds.add(id);
    return {
      id,
      criterion: requiredText(item.criterion, 180, "推理检查点"),
      expectedSignal: requiredText(item.expectedSignal, 280, "预期推理信号"),
    };
  });

  const existingCandidates = Array.isArray(context.existingCandidates) ? context.existingCandidates : [];
  if (existingCandidates.some(item =>
    item?.context?.competencyId === competencyId &&
    item?.context?.gapId === gapId &&
    normalizeText(item.exercise?.prompt) === normalizedPrompt
  )) {
    throw new TypeError("这道候选练习与已有草案重复。");
  }

  return {
    schemaVersion: 1,
    title,
    taskType,
    prompt,
    stimulus,
    expectedReasoning,
    exemplarAnswer,
    commonTrap,
    hints: hints.map(item => item.trim()),
    rubric,
    difficulty,
    sourceVariantIds,
  };
}

export function parseLearningPracticeCandidateReply(reply, context = {}) {
  if (typeof reply !== "string" || reply.length > 7000) {
    throw new TypeError("AI 未返回有效的练习候选 JSON。");
  }
  let decoded;
  try {
    decoded = JSON.parse(reply);
  } catch {
    throw new TypeError("AI 练习候选不是纯 JSON；未保存任何内容。");
  }
  return validateLearningPracticeCandidate(decoded, context);
}

export function createLearningPracticeCandidateStore(options = {}) {
  const repositoryPromise = options.repository
    ? Promise.resolve(options.repository)
    : getLearningRepository();
  const registry = options.registry || { assessments: [] };
  const clock = typeof options.clock === "function" ? options.clock : () => new Date();

  async function list(filters = {}) {
    const repository = await repositoryPromise;
    const rows = await repository.documents.list(2000);
    return rows
      .filter(row => row.type === DOCUMENT_TYPE && row.key.startsWith(KEY_PREFIX) &&
        !row.payload?._deleted && row.payload?.purpose === "learning_practice_candidate" &&
        row.payload?.schemaVersion === 1)
      .map(row => ({ ...row.payload, localRevision: Number(row.localRevision) || 0 }))
      .filter(item => !filters.competencyId || item.context?.competencyId === filters.competencyId)
      .filter(item => !filters.gapId || item.context?.gapId === filters.gapId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, Math.max(1, Math.min(30, Number(filters.limit) || 10)));
  }

  async function saveDraft(input = {}) {
    const normalizedExercise = { ...(input.exercise || {}) };
    delete normalizedExercise.schemaVersion;
    const exercise = validateLearningPracticeCandidate(normalizedExercise, {
      ...input.context,
      registry,
      recentlyUsedVariantIds: input.recentlyUsedVariantIds,
      existingCandidates: await list({
        competencyId: input.context?.competencyId,
        gapId: input.context?.gapId,
        limit: 30,
      }),
    });
    const repository = await repositoryPromise;
    const candidateId = makeId();
    const key = KEY_PREFIX + candidateId;
    const at = clock().toISOString();
    const payload = {
      schemaVersion: 1,
      purpose: "learning_practice_candidate",
      candidateId,
      status: "draft",
      createdAt: at,
      updatedAt: at,
      context: {
        competencyId: clean(input.context?.competencyId, 120),
        gapId: clean(input.context?.gapId, 120),
        topicId: clean(input.context?.topicId, 120),
        topicTitle: clean(input.context?.topicTitle, 180),
        competencyTitle: clean(input.context?.competencyTitle, 180),
        gapLabel: clean(input.context?.gapLabel, 180),
        allowedSourceVariantIds: [...exercise.sourceVariantIds],
      },
      exercise,
      learnerResponse: null,
      attemptedAt: null,
    };
    await repository.commit({
      documents: [{
        type: DOCUMENT_TYPE,
        key,
        payload,
        expectedLocalRevision: 0,
      }],
    });
    return { ...payload, localRevision: 1 };
  }

  async function updateExercise(candidateId, inputExercise) {
    const id = clean(candidateId, 120);
    if (!/^[a-zA-Z0-9_-]{8,120}$/.test(id)) throw new TypeError("练习候选标识无效。");
    const repository = await repositoryPromise;
    const key = KEY_PREFIX + id;
    const previous = await repository.documents.get(DOCUMENT_TYPE, key);
    if (!previous || previous.payload?._deleted ||
        previous.payload?.purpose !== "learning_practice_candidate") {
      throw new Error("练习候选不存在或已删除。");
    }
    const current = previous.payload;
    if (!["draft", "attempted"].includes(current.status)) {
      throw new Error("当前候选状态不允许修改题目内容。");
    }
    const candidates = (await list({
      competencyId: current.context?.competencyId,
      gapId: current.context?.gapId,
      limit: 30,
    })).filter(item => item.candidateId !== id);
    const allowedSourceVariantIds = unique(
      current.context?.allowedSourceVariantIds || current.exercise?.sourceVariantIds
    );
    const normalizedExercise = { ...(inputExercise || {}) };
    delete normalizedExercise.schemaVersion;
    const exercise = validateLearningPracticeCandidate(normalizedExercise, {
      ...current.context,
      allowedSourceVariantIds,
      registry,
      existingCandidates: candidates,
    });
    const at = clock().toISOString();
    const payload = {
      ...current,
      context: { ...current.context, allowedSourceVariantIds },
      exercise,
      updatedAt: at,
      revisionNote: "Candidate content edited for deterministic revalidation.",
    };
    await repository.commit({
      documents: [{
        type: DOCUMENT_TYPE,
        key,
        payload,
        expectedLocalRevision: Number(previous.localRevision) || 0,
      }],
    });
    return { ...payload, localRevision: (Number(previous.localRevision) || 0) + 1 };
  }

  async function markAttempted(candidateId, learnerResponse) {
    const id = clean(candidateId, 120);
    if (!/^[a-zA-Z0-9_-]{8,120}$/.test(id)) throw new TypeError("练习候选标识无效。");
    const response = clean(learnerResponse, 4000);
    if (response.length < 2) throw new TypeError("请先写下你的推理，再查看参考思路。");
    const repository = await repositoryPromise;
    const key = KEY_PREFIX + id;
    const previous = await repository.documents.get(DOCUMENT_TYPE, key);
    if (!previous || previous.payload?._deleted ||
        previous.payload?.purpose !== "learning_practice_candidate") {
      throw new Error("练习候选不存在或已删除。");
    }
    if (previous.payload.status !== "draft") {
      throw new Error("这份练习已经提交过作答；不会覆盖第一次作答记录。");
    }
    const at = clock().toISOString();
    const payload = {
      ...previous.payload,
      status: "attempted",
      learnerResponse: response,
      attemptedAt: at,
      updatedAt: at,
    };
    await repository.commit({
      documents: [{
        type: DOCUMENT_TYPE,
        key,
        payload,
        expectedLocalRevision: Number(previous.localRevision) || 0,
      }],
    });
    return { ...payload, localRevision: (Number(previous.localRevision) || 0) + 1 };
  }

  async function remove(candidateId) {
    const id = clean(candidateId, 120);
    if (!/^[a-zA-Z0-9_-]{8,120}$/.test(id)) throw new TypeError("练习候选标识无效。");
    const repository = await repositoryPromise;
    const key = KEY_PREFIX + id;
    const previous = await repository.documents.get(DOCUMENT_TYPE, key);
    if (!previous || previous.payload?._deleted ||
        previous.payload?.purpose !== "learning_practice_candidate") return false;
    await repository.commit({
      documents: [{
        type: DOCUMENT_TYPE,
        key,
        payload: {
          _deleted: true,
          purpose: "learning_practice_candidate",
          deletedAt: clock().toISOString(),
        },
        expectedLocalRevision: Number(previous.localRevision) || 0,
      }],
    });
    return true;
  }

  return { list, saveDraft, updateExercise, markAttempted, remove };
}
