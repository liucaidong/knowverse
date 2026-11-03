export const PRACTICE_QUALITY_VALIDATOR_VERSION = "phase-m-deterministic-v1";

const TASK_TYPES = new Set(["predict", "trace", "diagnose", "transfer", "explain"]);
const DIFFICULTIES = new Set(["foundation", "intermediate", "stretch"]);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" ? value.trim() : "";
const normalize = value => text(value).toLocaleLowerCase("zh-CN")
  .replace(/[\s\p{P}\p{S}]+/gu, "");
const unique = values => [...new Set((Array.isArray(values) ? values : [])
  .filter(value => typeof value === "string" && value.trim()).map(value => value.trim()))];

function ngrams(value, size = 3) {
  const normalized = normalize(value);
  if (normalized.length <= size) return new Set(normalized ? [normalized] : []);
  const result = new Set();
  for (let index = 0; index <= normalized.length - size; index += 1) {
    result.add(normalized.slice(index, index + size));
  }
  return result;
}

export function practiceTextSimilarity(left, right) {
  const a = ngrams(left);
  const b = ngrams(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return 2 * intersection / (a.size + b.size);
}

function inspectCandidate(candidate) {
  if (!isObject(candidate) || !isObject(candidate.context) || !isObject(candidate.exercise)) {
    return { context: {}, exercise: {}, candidateId: "" };
  }
  return {
    context: candidate.context,
    exercise: candidate.exercise,
    candidateId: text(candidate.candidateId),
  };
}

function safetyFindings(exercise) {
  const content = [
    exercise.title, exercise.prompt, exercise.stimulus, exercise.expectedReasoning,
    exercise.exemplarAnswer, exercise.commonTrap,
    ...(Array.isArray(exercise.hints) ? exercise.hints : []),
    ...(Array.isArray(exercise.rubric) ? exercise.rubric.flatMap(item => [item?.criterion, item?.expectedSignal]) : []),
  ].filter(value => typeof value === "string").join("\n");
  const findings = [];
  if (/(?:告诉我|提供|发送|上传|泄露|公开|分享).{0,30}(?:密码|口令|api[_ -]?key|密钥|token|私钥|身份证号|银行卡号)/i.test(content) ||
      /(?:password|secret|api[_ -]?key|private[_ -]?key).{0,40}(?:send|upload|reveal|exfiltrate|publish)/i.test(content)) {
    findings.push("候选题可能要求泄露凭证或敏感个人信息。");
  }
  if (/\brm\s+-rf\s+\/(?:\s|$)|\bmkfs(?:\.\w+)?\b|\bdd\s+if=\/dev\//i.test(content)) {
    findings.push("候选题包含可能破坏文件系统或磁盘的命令。");
  }
  if (/\b(?:curl|wget)\b[^\n]{0,160}\|\s*(?:sudo\s+)?(?:bash|sh|zsh)\b/i.test(content)) {
    findings.push("候选题包含下载远程内容后直接交给 Shell 执行的指令。");
  }
  return findings;
}

function duplicateCandidates(prompt, stimulus, registry, existingCandidates) {
  const matches = [];
  const compare = (item, source, type) => {
    const sourcePrompt = text(item?.prompt || item?.exercise?.prompt);
    const sourceStimulus = text(item?.code || item?.exercise?.stimulus);
    const promptScore = practiceTextSimilarity(prompt, sourcePrompt);
    const codeScore = stimulus && sourceStimulus ? practiceTextSimilarity(stimulus, sourceStimulus) : 0;
    const exactPrompt = Boolean(prompt && sourcePrompt && normalize(prompt) === normalize(sourcePrompt));
    const exactStimulus = Boolean(stimulus && sourceStimulus && normalize(stimulus) === normalize(sourceStimulus));
    const score = Math.max(promptScore, codeScore);
    if (exactPrompt || exactStimulus || score >= 0.68) {
      matches.push({
        id: text(item?.id || item?.candidateId),
        title: text(item?.title || item?.exercise?.title),
        source: type,
        similarity: Number(score.toFixed(3)),
        exact: exactPrompt || exactStimulus,
      });
    }
  };
  for (const item of registry?.assessments || []) compare(item, item, "official");
  for (const item of Array.isArray(existingCandidates) ? existingCandidates : []) compare(item, item, "candidate");
  return matches.sort((a, b) => Number(b.exact) - Number(a.exact) || b.similarity - a.similarity);
}

export function validateLearningPracticeQualityCandidate(candidate, options = {}) {
  const { context, exercise, candidateId } = inspectCandidate(candidate);
  const competencyId = text(context.competencyId);
  const topicId = text(context.topicId);
  const gapId = text(context.gapId);
  const registry = options.registry || { assessments: [] };
  const learningMap = options.learningMap || { topics: [], gaps: [] };
  const checks = [];
  const errors = [];
  const warnings = [];
  const add = (id, label, valid, detail, severity = "error", applicable = true) => {
    const status = !applicable ? "not_applicable" : valid ? "passed" : severity === "warning" ? "warning" : "failed";
    checks.push({ id, label, status, detail });
    if (!valid && applicable) {
      const issue = { code: id, field: id.split(".")[0], message: detail };
      if (severity === "warning") warnings.push(issue);
      else errors.push(issue);
    }
  };

  const topics = Array.isArray(learningMap.topics) ? learningMap.topics : [];
  const gaps = Array.isArray(learningMap.gaps) ? learningMap.gaps : [];
  const topic = topics.find(item => item.id === topicId);
  const competency = topic?.competencies?.find(item => item.id === competencyId);
  const gap = gaps.find(item => item.id === gapId);
  const gapMatches = Boolean(gap?.competencyIds?.includes(competencyId));
  add("source.competency", "Competency 来源", Boolean(competency),
    competency ? "Competency 存在于官方 learning map，且属于候选题声明的 topic。" : "未找到对应 topic 下的官方 competency。");
  add("source.gap", "Learning Gap 来源", Boolean(gap && gapMatches),
    gap && gapMatches ? "Gap 存在，且官方映射包含当前 competency。" : "Gap 不存在，或没有映射到当前 competency。");

  const sourceIds = unique(exercise.sourceVariantIds);
  const canonicalSources = (registry.assessments || []).filter(item => sourceIds.includes(item.id));
  const sourceValid = sourceIds.length === 2 &&
    canonicalSources.length === 2 &&
    canonicalSources.every(item => item.competencyId === competencyId &&
      item.topicId === topicId && Array.isArray(item.gapIds) && item.gapIds.includes(gapId));
  add("source.variants", "两个官方来源变体", sourceValid,
    sourceValid ? "恰好两个不同的来源 ID 均存在于官方题库，并映射到相同 competency / gap。" :
      "必须恰好引用两个不同的官方变体 ID，且都属于当前 competency、topic 和 gap。");
  if (Array.isArray(context.allowedSourceVariantIds) && context.allowedSourceVariantIds.length) {
    const allowed = unique(context.allowedSourceVariantIds);
    add("source.original-anchors", "Phase L 原始来源锚点",
      allowed.length === 2 && sourceIds.length === 2 && allowed.every(id => sourceIds.includes(id)) &&
      sourceIds.every(id => allowed.includes(id)),
      "来源 ID 必须与本轮 Phase L 生成上下文提供的两个官方锚点完全一致。");
  } else {
    checks.push({
      id: "source.original-anchors", label: "Phase L 原始来源锚点",
      status: "warning", detail: "当前候选快照没有独立保存 allowedSourceVariantIds；已核对候选内两个 ID 与 canonical registry 的归属关系。",
    });
    warnings.push({
      code: "source.original-anchors", field: "sourceVariantIds",
      message: "缺少独立持久化的 Phase L allowedSourceVariantIds 快照；只能验证候选中的两个 ID 当前属于正确的官方来源集合。",
    });
  }

  const title = text(exercise.title);
  const prompt = text(exercise.prompt);
  const stimulus = text(exercise.stimulus);
  const reasoning = text(exercise.expectedReasoning);
  const answer = text(exercise.exemplarAnswer);
  const trap = text(exercise.commonTrap);
  add("content.title", "题目标题", title.length >= 4 && title.length <= 120, "标题必须为 4–120 个字符。");
  add("content.prompt", "题目要求完整性", prompt.length >= 16 && prompt.length <= 900 &&
    /[？?]|请|预测|解释|说明|分析|判断|诊断|比较|推导|计算|指出|给出|完成|回答|追踪|列出/.test(prompt),
    "题目要求必须完整、明确，并包含可执行的提问或指令。");
  add("content.stimulus", "上下文与输入材料", stimulus.length <= 2400,
    stimulus.length > 2400 ? "上下文或输入材料超过 2400 个字符。" : "输入材料长度在限制内。");
  add("content.expected-reasoning", "预期推理", reasoning.length >= 8 && reasoning.length <= 1600,
    "预期推理必须为 8–1600 个字符。");
  add("content.exemplar-answer", "参考答案", answer.length >= 8 && answer.length <= 1600,
    "参考答案必须为 8–1600 个字符。");
  add("content.common-trap", "常见误区", trap.length >= 8 && trap.length <= 700,
    "常见误区必须为 8–700 个字符。");
  add("content.task-type", "题型合法性", TASK_TYPES.has(exercise.taskType),
    "taskType 必须属于 predict、trace、diagnose、transfer、explain。");
  add("content.difficulty", "难度合法性", DIFFICULTIES.has(exercise.difficulty),
    "difficulty 必须属于 foundation、intermediate、stretch。");

  const hints = Array.isArray(exercise.hints) ? exercise.hints : [];
  const hintsValid = hints.length === 2 && hints.every(item =>
    typeof item === "string" && item.trim().length >= 4 && item.trim().length <= 320
  );
  add("content.hints", "递进提示", hintsValid,
    "必须提供两个有效提示，每条 4–320 个字符；递进质量仍需 Reviewer 判断。");
  if (hintsValid && normalize(hints[0]) === normalize(hints[1])) {
    add("content.hints-distinct", "提示差异", false, "两级提示内容相同，不能形成递进。");
  } else {
    add("content.hints-distinct", "提示差异", true, "未发现两级提示完全重复。");
  }
  const rubric = Array.isArray(exercise.rubric) ? exercise.rubric : [];
  const rubricValid = rubric.length >= 2 && rubric.length <= 4 &&
    rubric.every(item => isObject(item) && /^[a-z0-9_-]{2,32}$/i.test(text(item.id)) &&
      text(item.criterion).length >= 8 && text(item.criterion).length <= 180 &&
      text(item.expectedSignal).length >= 8 && text(item.expectedSignal).length <= 280) &&
    new Set(rubric.map(item => text(item.id))).size === rubric.length;
  add("content.rubric", "评分参考结构", rubricValid,
    "rubric 必须包含 2–4 个不重复的 id、criterion 和 expectedSignal。");
  if (hintsValid && answer && hints.some(item => normalize(item).length >= 12 &&
      (normalize(answer).includes(normalize(item)) || normalize(item).includes(normalize(answer))))) {
    add("content.hint-leakage", "提示答案泄露", false, "提示与完整参考答案高度重合，可能直接泄露答案。", "warning");
  } else {
    add("content.hint-leakage", "提示答案泄露", true, "未发现提示与完整参考答案的直接文本重合。", "warning");
  }

  const duplicateMatches = duplicateCandidates(prompt, stimulus, registry, options.existingCandidates);
  const exactDuplicates = duplicateMatches.filter(item => item.exact);
  const nearDuplicates = duplicateMatches.filter(item => !item.exact && item.similarity >= 0.84);
  add("content.duplicate", "重复与轻微改写", !exactDuplicates.length && !nearDuplicates.length,
    exactDuplicates.length ? "发现与官方题目或历史候选完全重复的内容。" :
      nearDuplicates.length ? "发现与官方题目或历史候选高度相似，疑似仅作轻微文字改写。" :
        duplicateMatches.length ? "发现相似内容，需 Reviewer 判断是否构成复制。" : "未发现明显重复内容。",
    duplicateMatches.length && !exactDuplicates.length && !nearDuplicates.length ? "warning" : "error");
  if (duplicateMatches.length && !exactDuplicates.length && !nearDuplicates.length) {
    warnings.push({
      code: "content.duplicate-similarity", field: "prompt",
      message: "存在相似题目匹配，是否构成复制需要结合语义由 Reviewer 判断。",
    });
  }

  const safety = safetyFindings(exercise);
  add("safety.content", "内容安全", safety.length === 0,
    safety.length ? safety.join(" ") : "未匹配到凭证泄露、破坏性命令或下载后直接执行等高风险模式。");
  const codeLike = /\b(?:Promise|thenable|queueMicrotask|setTimeout|console\.|async\s+function|await\s|=>)\b/.test(stimulus);
  add("code.runtime-execution", "代码执行验证", false,
    "本阶段没有在隔离沙箱中执行候选代码；输出顺序、运行时行为和引擎差异不会被标记为已执行验证。",
    "warning", codeLike);
  if (!codeLike) {
    checks.push({
      id: "code.runtime-execution", label: "代码执行验证",
      status: "not_applicable", detail: "未检测到代码型输入，不需要代码执行验证。",
    });
  }

  const officialSourceSummaries = canonicalSources.map(item => ({
    id: item.id, title: text(item.title), competencyId: item.competencyId,
    topicId: item.topicId, gapIds: Array.isArray(item.gapIds) ? item.gapIds : [],
  }));
  const evaluatedAt = new Date().toISOString();
  return {
    validationStatus: errors.length ? "failed" : "passed",
    checks,
    errors,
    warnings,
    duplicateMatches,
    sourceValidation: {
      status: sourceValid && Boolean(competency && gapMatches) ? "passed" : "failed",
      competencyId, topicId, gapId,
      sourceVariantIds: sourceIds,
      officialSources: officialSourceSummaries,
    },
    contentValidation: {
      status: errors.some(item => item.code.startsWith("content.") || item.code.startsWith("safety."))
        ? "failed" : "passed",
      titleLength: title.length,
      promptLength: prompt.length,
      stimulusLength: stimulus.length,
      hintsCount: hints.length,
      rubricCount: rubric.length,
      codeRuntimeExecution: codeLike ? "not_run" : "not_applicable",
    },
    evaluatedAt,
    validatorVersion: PRACTICE_QUALITY_VALIDATOR_VERSION,
    candidateId,
    candidateHash: null,
  };
}
