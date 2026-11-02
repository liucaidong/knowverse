import { deriveLearningInsights } from "../learning-progress.mjs";
import { deriveLearnerProfile } from "./learner-profile.mjs";

const normalize = value => String(value || "").trim().toLowerCase();
const containsAny = (value, words) => words.some(word => value.includes(word));

export async function answerWithLocalRules(message, context) {
  const text = normalize(message);
  const { repository, goalManager, planManager, learningMap, challengeRegistry, profileStore } = context;
  const events = await repository.events.list();
  const goals = await goalManager.list();
  const preferences = await profileStore.loadPreferences();
  const snapshot = { events };
  const insights = deriveLearningInsights(learningMap, challengeRegistry, snapshot, context.now || new Date());
  const profile = deriveLearnerProfile({ learningMap, challengeRegistry, snapshot, preferences, goals, now: context.now || new Date() });
  const current = await planManager.current();

  if (containsAny(text, ["重新规划", "重新安排", "规划今天", "生成计划", "制定计划", "plan"])) {
    const horizonDays = containsAny(text, ["两周", "2周", "14天", "接下来两星期"]) ? 14 : 1;
    const plan = await planManager.generate(context, "学习者在 Agent 工作区请求：" + message.trim().slice(0, 300), { horizonDays });
    return {
      mode: "rules",
      reply: "我已使用现有学习事件、知识先修关系、薄弱点、复习时间和当前学习目标生成一份新的规则计划提案。它尚未生效，也没有覆盖当前已接受计划。请先检查任务、预计时间与推荐原因，再选择接受或拒绝。",
      proposal: { kind: "plan", planId: plan.planId },
    };
  }
  if (containsAny(text, ["为什么", "为何", "原因", "why"])) {
    const matched = insights.gaps.find(gap =>
      text.includes(normalize(gap.label)) || text.includes(normalize(gap.id)) ||
      (gap.competencyTitle && text.includes(normalize(gap.competencyTitle))));
    if (matched) {
      return {
        mode: "rules",
        reply: "当前建议优先处理「" + matched.label + "」。它关联知识点「" + matched.competencyTitle +
          "」，状态为「" + matched.lifecycleLabel + "」，观察到 " + matched.count +
          " 次错误线索。系统仍在等待符合要求的独立验证；只有后续真实评估事件才能关闭这个薄弱点。",
      };
    }
    if (current.proposal) {
      return {
        mode: "rules",
        reply: "当前提案的首要任务是「" + (current.proposal.actions[0]?.title || current.proposal.headline) +
          "」。推荐原因：" + (current.proposal.actions[0]?.priorityReasons || []).join("；") +
          "。前置知识限制和掌握状态由规则引擎计算，模型不会自行改变这些结果。",
      };
    }
    return { mode: "rules", reply: "目前没有匹配到你提到的具体薄弱点。可以在下方掌握画像和薄弱点区域查看系统当前记录的证据与诊断。" };
  }
  if (containsAny(text, ["下一步", "接下来学什么", "next action", "下一项"])) {
    const task = await context.taskOrchestrator.list(current.active?.planId);
    const next = task.find(item => item.status === "in_progress") || task.find(item => item.status === "ready");
    if (next) return {
      mode: "rules",
      reply: "当前下一步是「" + next.title + "」，预计 " + next.estimatedMinutes +
        " 分钟。状态：" + next.status + "。推荐理由：" + (next.priorityReasons || []).join("；"),
    };
    return { mode: "rules", reply: "当前没有可继续执行的已接受任务。你可以生成一份新的计划提案，或先完善学习目标。" };
  }
  if (containsAny(text, ["目标", "goal"])) {
    const topic = learningMap.topics.find(item =>
      text.includes(normalize(item.title)) || text.includes(normalize(item.id)) ||
      (item.id === "promise" && text.includes("promise")) ||
      (item.id === "monorepo" && text.includes("monorepo")) ||
      (item.id === "react-native" && (text.includes("react native") || text.includes("react-native"))));
    return {
      mode: "rules",
      reply: topic
        ? "我识别到你可能想围绕「" + topic.title + "」建立学习目标。请使用目标面板填写验收标准、截止日期和优先级；保存前可以再次检查目标范围。"
        : "我可以基于现有知识专题建立目标，但规则模式不会擅自猜测目标范围。请在目标面板选择专题或 Concept 能力点并确认创建。",
    };
  }
  if (containsAny(text, ["掌握", "进度", "画像", "progress"])) {
    const summary = profile.mastery.summary;
    return {
      mode: "rules",
      reply: "当前追踪 " + summary.totalCount + " 个知识点，其中 " + summary.testedCount +
        " 个已有真实验证证据、" + summary.stableCount + " 个达到稳定掌握，" +
        summary.weakCount + " 个需要补强，" + summary.activeGapCount +
        " 个薄弱点尚未关闭。最近 7 天记录到 " + profile.growth.evidenceLast7Days +
        " 条有效评估证据。页面中的每个掌握结论均可追溯到原始事件。",
    };
  }
  return {
    mode: "rules",
    reply: "当前运行在确定性规则模式（AI 服务尚未配置或本轮未启用云端 AI）。我可以读取真实掌握画像、说明薄弱点、查看下一步任务，并根据你的指令生成待确认计划。自然语言的复杂讲解需要配置服务端 AI Provider；不会伪造模型回复。",
  };
}
