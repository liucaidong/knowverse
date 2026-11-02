import { deriveLearningInsights } from "../learning-progress.mjs";
import { deriveLearnerProfile } from "./learner-profile.mjs";

export const AGENT_TOOL_SCHEMAS = Object.freeze({
  get_learner_profile: {
    description: "读取学习者画像；掌握结论只来自现有 Learning Intelligence。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    mutating: false,
  },
  get_learning_goals: {
    description: "读取未删除的学习目标及其真实知识掌握进度。",
    inputSchema: { type: "object", properties: { status: { type: "string", enum: ["active", "paused", "completed", "cancelled", "all"] } }, additionalProperties: false },
    mutating: false,
  },
  get_mastery_snapshot: {
    description: "读取从追加式学习事件推导的掌握度和置信度，不接受模型写入。",
    inputSchema: { type: "object", properties: { topicId: { type: "string", maxLength: 120 } }, additionalProperties: false },
    mutating: false,
  },
  get_active_gaps: {
    description: "读取尚未通过独立验证关闭的薄弱点。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    mutating: false,
  },
  get_learning_graph: {
    description: "读取知识专题、Concept 能力点及前置依赖关系。",
    inputSchema: { type: "object", properties: { topicId: { type: "string", maxLength: 120 } }, additionalProperties: false },
    mutating: false,
  },
  get_learning_history: {
    description: "读取追加式学习事件历史。",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 200 } }, additionalProperties: false },
    mutating: false,
  },
  create_learning_goal: {
    description: "创建用户明确要求的学习目标。",
    inputSchema: {
      type: "object", required: ["title"],
      properties: {
        title: { type: "string", minLength: 1, maxLength: 120 },
        description: { type: "string", maxLength: 2000 },
        topicIds: { type: "array", items: { type: "string" }, maxItems: 12 },
        competencyIds: { type: "array", items: { type: "string" }, maxItems: 100 },
        targetAt: { type: ["string", "null"] },
        dailyMinutes: { type: "integer", minimum: 5, maximum: 240 },
        priority: { type: "integer", minimum: 1, maximum: 5 },
        acceptanceCriteria: { type: "string", maxLength: 1000 },
      },
      additionalProperties: false,
    },
    mutating: true,
  },
  update_learning_goal: {
    description: "修改目标属性或通过合法状态机暂停、恢复、完成和取消目标。",
    inputSchema: {
      type: "object", required: ["goalId"],
      properties: {
        goalId: { type: "string", minLength: 1, maxLength: 240 },
        title: { type: "string", maxLength: 120 },
        description: { type: "string", maxLength: 2000 },
        topicIds: { type: "array", items: { type: "string" }, maxItems: 12 },
        competencyIds: { type: "array", items: { type: "string" }, maxItems: 100 },
        targetAt: { type: ["string", "null"] },
        dailyMinutes: { type: "integer", minimum: 5, maximum: 240 },
        priority: { type: "integer", minimum: 1, maximum: 5 },
        acceptanceCriteria: { type: "string", maxLength: 1000 },
        status: { type: "string", enum: ["active", "paused", "completed", "cancelled"] },
      },
      additionalProperties: false,
    },
    mutating: true,
  },
  generate_learning_plan: {
    description: "用确定性规则引擎生成一个待学习者确认的计划提案。",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string", maxLength: 1000 },
        horizonDays: { type: "integer", minimum: 1, maximum: 14 },
      },
      additionalProperties: false,
    },
    mutating: true,
  },
  explain_plan: {
    description: "解释指定计划的推荐原因、先修条件、预计时间和完成标准。",
    inputSchema: { type: "object", required: ["planId"], properties: { planId: { type: "string", minLength: 1, maxLength: 240 } }, additionalProperties: false },
    mutating: false,
  },
  replan_learning: {
    description: "基于新的目标、掌握证据、预算或执行偏差生成一个新版本提案，不覆盖旧计划。",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string", maxLength: 1000 },
        horizonDays: { type: "integer", minimum: 1, maximum: 14 },
      },
      additionalProperties: false,
    },
    mutating: true,
  },
  start_learning_task: {
    description: "在用户明确点击开始后启动 ready 任务。",
    inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string", minLength: 1, maxLength: 320 } }, additionalProperties: false },
    mutating: true,
  },
  complete_learning_task: {
    description: "完成正在执行的任务；验证类任务必须提供符合要求的真实学习证据。",
    inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string", minLength: 1, maxLength: 320 }, evidenceEventIds: { type: "array", items: { type: "string" }, maxItems: 20 } }, additionalProperties: false },
    mutating: true,
  },
  pause_learning_task: {
    description: "暂停正在执行的任务并保留可恢复现场。",
    inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string", minLength: 1, maxLength: 320 }, reason: { type: "string", maxLength: 500 } }, additionalProperties: false },
    mutating: true,
  },
  get_next_learning_action: {
    description: "获取当前已接受计划中的继续执行任务。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    mutating: false,
  },
  get_review_recommendations: {
    description: "读取基于当前薄弱点和间隔复习时间的推荐。",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
    mutating: false,
  },
  accept_learning_plan: {
    description: "只有学习者明确接受后才激活提案并创建正式任务。",
    inputSchema: { type: "object", required: ["planId"], properties: { planId: { type: "string", minLength: 1, maxLength: 240 } }, additionalProperties: false },
    mutating: true,
  },
  reject_learning_plan: {
    description: "拒绝待确认提案，同时保留该提案的历史版本。",
    inputSchema: { type: "object", required: ["planId"], properties: { planId: { type: "string", minLength: 1, maxLength: 240 }, reason: { type: "string", maxLength: 1000 } }, additionalProperties: false },
    mutating: true,
  },
});

const isObject = value => value && typeof value === "object" && !Array.isArray(value);
function validateValue(value, schema, path) {
  if (schema.type === "object") {
    if (!isObject(value)) throw new TypeError(path + " 必须是对象。");
    const allowed = Object.keys(schema.properties || {});
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key) && schema.additionalProperties === false) {
        throw new TypeError(path + "." + key + " 不是允许的字段。");
      }
    }
    for (const key of schema.required || []) {
      if (!(key in value)) throw new TypeError(path + "." + key + " 是必填字段。");
    }
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties[key]) validateValue(item, schema.properties[key], path + "." + key);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) throw new TypeError(path + " 必须是数组。");
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new RangeError(path + " 超过最大数组长度。");
    value.forEach((item, index) => validateValue(item, schema.items, path + "[" + index + "]"));
    return;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? "null" : Number.isInteger(value) ? "integer" :
    typeof value === "number" ? "number" : typeof value;
  if (!types.includes(actual) && !(types.includes("number") && actual === "integer")) {
    throw new TypeError(path + " 类型无效，期望 " + types.join("|") + "。");
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new TypeError(path + " 不能为空。");
    if (schema.maxLength !== undefined && value.length > schema.maxLength) throw new RangeError(path + " 过长。");
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) throw new RangeError(path + " 小于允许范围。");
    if (schema.maximum !== undefined && value > schema.maximum) throw new RangeError(path + " 超出允许范围。");
  }
  if (schema.enum && !schema.enum.includes(value)) throw new TypeError(path + " 不是允许的选项。");
}

export function validateAgentToolInput(name, input = {}) {
  const schema = AGENT_TOOL_SCHEMAS[name];
  if (!schema) throw new TypeError("未知 Agent 工具：" + name);
  validateValue(input, schema.inputSchema, name + ".input");
  return input;
}

export async function executeAgentTool(name, rawInput = {}, context = {}, options = {}) {
  const definition = AGENT_TOOL_SCHEMAS[name];
  const input = validateAgentToolInput(name, rawInput);
  if (!definition) throw new TypeError("未知 Agent 工具：" + name);
  if (definition.mutating && (options.origin === "model" || options.confirmed !== true)) {
    throw new Error("Agent 模型只能提出建议；修改目标、接受计划或操作任务必须由学习者明确确认。");
  }
  const repository = context.repository;
  const goals = context.goalManager;
  const plans = context.planManager;
  const tasks = context.taskOrchestrator || plans?.tasks;
  if (!repository || !goals || !plans || !tasks) throw new Error("学习 Agent 业务服务尚未初始化。");

  const load = async () => {
    const [events, preferences, allGoals] = await Promise.all([
      repository.events.list(),
      context.profileStore.loadPreferences(),
      goals.list(),
    ]);
    const snapshot = { events };
    const insights = deriveLearningInsights(context.learningMap, context.challengeRegistry, snapshot, context.now || new Date());
    const profile = deriveLearnerProfile({
      learningMap: context.learningMap,
      challengeRegistry: context.challengeRegistry,
      snapshot,
      preferences,
      goals: allGoals,
      now: context.now || new Date(),
    });
    return { events, snapshot, insights, profile, allGoals };
  };

  switch (name) {
    case "get_learner_profile": return (await load()).profile;
    case "get_learning_goals": {
      const all = await goals.list();
      return input.status && input.status !== "all" ? all.filter(goal => goal.status === input.status) : all;
    }
    case "get_mastery_snapshot": {
      const { insights } = await load();
      return input.topicId
        ? insights.competencyInsights.filter(item => item.topicId === input.topicId)
        : insights.competencyInsights;
    }
    case "get_active_gaps": return (await load()).insights.gaps;
    case "get_learning_graph": {
      const topics = context.learningMap?.topics || [];
      return input.topicId ? topics.filter(topic => topic.id === input.topicId) : context.learningMap;
    }
    case "get_learning_history": return (await load()).events
      .slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, input.limit || 50);
    case "create_learning_goal": return goals.create(input);
    case "update_learning_goal": {
      const { profile } = await load();
      return goals.update(input.goalId, input, { profile });
    }
    case "generate_learning_plan":
    case "replan_learning": return plans.generate(context, input.reason || "学习者请求重新规划", {
      horizonDays: input.horizonDays || 1,
    });
    case "explain_plan": {
      const plan = await plans.get(input.planId);
      if (!plan) throw new Error("计划不存在。");
      return {
        planId: plan.planId, version: plan.version, status: plan.status,
        headline: plan.headline, reason: plan.reason,
        dailyMinutes: plan.dailyMinutes, totalBudgetMinutes: plan.totalBudgetMinutes,
        plannedMinutes: plan.plannedMinutes, horizonDays: plan.horizonDays,
        activeStudyDays: plan.activeStudyDays, goalAllocations: plan.goalAllocations,
        actions: plan.actions.map(action => ({
          title: action.title, topicTitle: action.topicTitle,
          competencyId: action.competencyId, why: action.priorityReasons,
          estimatedMinutes: action.estimatedMinutes, href: action.href,
          completionRule: action.type === "learn"
            ? "完成课程阅读并由学习者确认阅读现场；这不会生成掌握证据。"
            : "完成对应挑战/检查点/无提示独立验证；实际证据由 Learning Intelligence 评估。",
        })),
        blockedCompetencies: plan.blockedCompetencies,
      };
    }
    case "start_learning_task": return tasks.start(input.taskId, { actor: "learner" });
    case "complete_learning_task": return tasks.complete(input.taskId, {
      actor: "learner", evidenceEventIds: input.evidenceEventIds || [],
    });
    case "pause_learning_task": return tasks.pause(input.taskId, { actor: "learner", reason: input.reason });
    case "get_next_learning_action": {
      const current = await plans.current();
      if (!current.active) return { status: "no-active-plan", proposal: current.proposal };
      await tasks.refreshUnlocks(current.active.planId);
      const rows = await tasks.list(current.active.planId);
      return rows.find(task => task.status === "in_progress") ||
        rows.find(task => task.status === "ready") ||
        rows.find(task => task.status === "locked") || null;
    }
    case "get_review_recommendations": return (await load()).insights.reviewQueue.slice(0, input.limit || 10);
    case "accept_learning_plan": return plans.accept(input.planId);
    case "reject_learning_plan": return plans.reject(input.planId, input.reason);
    default: throw new Error("Agent 工具尚未实现：" + name);
  }
}
