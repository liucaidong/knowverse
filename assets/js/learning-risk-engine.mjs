import { SPACED_REPETITION_VERSION } from "./spaced-repetition-engine.mjs";

export const RISK_ENGINE_VERSION = 1;
const DAY_MS = 86_400_000;
const dateMs = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function downstreamIndex(learningMap) {
  const nodes = (learningMap?.topics || []).flatMap(topic => topic.competencies || []);
  const children = new Map(nodes.map(node => [node.id, new Set()]));
  for (const node of nodes) for (const parent of node.prerequisites || []) {
    if (children.has(parent)) children.get(parent).add(node.id);
  }
  const result = new Map();
  for (const node of nodes) {
    const seen = new Set(), pending = [...(children.get(node.id) || [])];
    while (pending.length) {
      const id = pending.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const child of children.get(id) || []) pending.push(child);
    }
    result.set(node.id, seen.size);
  }
  return { nodes, children, result, definitions: new Map(nodes.map(node => [node.id, node])) };
}

export function deriveForgettingRisks({ schedules = [], insights, learningMap, now = new Date() } = {}) {
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  const states = new Map((insights?.competencyInsights || []).map(item => [item.id, item]));
  const { result: downstream, definitions } = downstreamIndex(learningMap);
  const scheduleMap = new Map(schedules.map(item => [item.competencyId, item]));
  return schedules.map(schedule => {
    const state = states.get(schedule.competencyId) || {};
    const ratio = schedule.intervalDays > 0 && schedule.elapsedDays !== null
      ? schedule.elapsedDays / schedule.intervalDays : schedule.isDue ? 2 : 0;
    const activeGaps = schedule.activeGapIds?.length || 0;
    const weak = ["weak", "building"].includes(state.status);
    const prereqIds = definitions.get(schedule.competencyId)?.prerequisites ||
      state.prerequisites || state.prerequisiteIds || [];
    const riskyPrerequisites = prereqIds.map(id => {
      const parentSchedule = scheduleMap.get(id);
      const parentState = states.get(id);
      return {
        competencyId: id,
        risky: Boolean(parentSchedule && (
          ["overdue", "relearning"].includes(parentSchedule.status) ||
          (parentSchedule.status === "due" && parentSchedule.overdueDays > 0) ||
          (parentState?.activeGaps || []).length ||
          ["weak", "building"].includes(parentState?.status)
        )),
      };
    }).filter(item => item.risky);
    let score = 0;
    const reasons = [];
    if (activeGaps) { score += 35 + Math.min(15, activeGaps * 5); reasons.push("存在 " + activeGaps + " 个尚未解决的薄弱点"); }
    if (schedule.consecutiveFailures) { score += Math.min(20, schedule.consecutiveFailures * 8); reasons.push("连续失败 " + schedule.consecutiveFailures + " 轮"); }
    if (ratio >= 2) { score += 35; reasons.push("已超过一个完整复习间隔"); }
    else if (ratio >= 1) { score += 24; reasons.push("已达到复习时间"); }
    else if (ratio >= 0.75) { score += 12; reasons.push("接近下一次复习时间"); }
    if (weak) { score += 12; reasons.push("Learning Intelligence 当前判定为 " + state.statusLabel); }
    if (Number.isFinite(state.masteryScore) && state.masteryScore < 60) { score += 12; reasons.push("最近掌握度低于 60"); }
    if (riskyPrerequisites.length) { score += Math.min(10, riskyPrerequisites.length * 5); reasons.push("存在高风险先修知识"); }
    if (schedule.confidence === "low" && schedule.successfulReviewCount) reasons.push("调度证据较少，风险估算需谨慎");
    score = clamp(score, 0, 100);
    const level = score >= 75 ? "critical" : score >= 52 ? "high" : score >= 28 ? "moderate" : "low";
    return {
      competencyId: schedule.competencyId,
      level, score,
      riskRatio: Number(ratio.toFixed(2)),
      overdueDays: schedule.overdueDays || 0,
      downstreamCount: downstream.get(schedule.competencyId) || 0,
      prerequisiteRiskIds: riskyPrerequisites.map(item => item.competencyId),
      reasons: reasons.length ? reasons : ["近期有效验证与复习间隔均未显示明显风险"],
      evidenceRefs: schedule.evidenceRefs || [],
      algorithmVersion: RISK_ENGINE_VERSION,
      sourceAlgorithmVersion: SPACED_REPETITION_VERSION,
    };
  }).map(row => ({ ...row, riskLevel: row.level }));
}

export function analyzeWeaknessTrends({ events = [], insights, learningMap, now = new Date() } = {}) {
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  const competencies = (learningMap?.topics || []).flatMap(topic =>
    (topic.competencies || []).map(item => ({ ...item, topicId: topic.id, topicTitle: topic.title })));
  const eventByCompetency = new Map(competencies.map(item => [item.id, []]));
  for (const event of events) {
    const at = dateMs(event.at);
    if (at === null || at > current) continue;
    for (const id of event.competencyIds || []) {
      if (!eventByCompetency.has(id)) continue;
      eventByCompetency.get(id).push(event);
    }
  }
  const states = new Map((insights?.competencyInsights || []).map(item => [item.id, item]));
  return competencies.map(definition => {
    const rows = (eventByCompetency.get(definition.id) || []).slice()
      .sort((a, b) => dateMs(a.at) - dateMs(b.at));
    const passes = rows.filter(item => ["assessment_passed", "completed"].includes(item.type) &&
      Number.isFinite(Number(item.scorePct)));
    const earlier = passes.slice(-6, -3).map(item => Number(item.scorePct));
    const recent = passes.slice(-3).map(item => Number(item.scorePct));
    const avg = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
    const previousAvg = avg(earlier), recentAvg = avg(recent);
    const gaps = rows.filter(item => item.type === "attempt" && item.correct === false && item.gapId);
    const activeGapIds = new Set((states.get(definition.id)?.activeGaps || []).map(item => item.id));
    const newGap = gaps.filter(item => activeGapIds.has(item.gapId)).at(-1);
    const lastGap = gaps.at(-1);
    let direction = "insufficient-data";
    if (previousAvg !== null && recentAvg !== null) {
      const delta = recentAvg - previousAvg;
      direction = delta >= 8 ? "improving" : delta <= -8 ? "declining" : "stable";
    } else if (recentAvg !== null) direction = "emerging";
    const state = states.get(definition.id);
    if (!passes.length && !gaps.length) direction = "insufficient-data";
    return {
      competencyId: definition.id, competencyTitle: definition.title,
      topicId: definition.topicId, topicTitle: definition.topicTitle,
      direction, previousAverage: previousAvg === null ? null : Number(previousAvg.toFixed(1)),
      recentAverage: recentAvg === null ? null : Number(recentAvg.toFixed(1)),
      delta: previousAvg !== null && recentAvg !== null ? Number((recentAvg - previousAvg).toFixed(1)) : null,
      activeGapIds: [...activeGapIds],
      newGapEventId: newGap?.id || null,
      lastFailureAt: lastGap?.at || null,
      status: state?.status || "unverified",
      evidenceRefs: rows.filter(item => ["attempt","assessment_passed","completed"].includes(item.type))
        .slice(-12).map(item => item.id),
    };
  }).filter(item => item.direction !== "insufficient-data" || item.activeGapIds.length);
}

export function diagnoseLearningState({ events = [], goals = [], tasks = [], schedules = [], risks = [], trends = [], goalForecasts = [], insights, preferences = {}, now = new Date() } = {}) {
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  const output = [];
  const activeGoals = goals.filter(goal => goal.status === "active");
  const lastEvidence = events.filter(item => ["assessment_passed","completed","attempt"].includes(item.type) &&
    dateMs(item.at) !== null && dateMs(item.at) <= current).sort((a,b)=>dateMs(b.at)-dateMs(a.at))[0];
  const inactiveDays = lastEvidence ? (current - dateMs(lastEvidence.at))/DAY_MS : Infinity;
  if (activeGoals.length && inactiveDays >= 7) output.push({
    id:"learning-stagnation",severity:inactiveDays>=14?"high":"moderate",
    title:"有效学习出现停滞",reason:lastEvidence
      ? "最近一次挑战/评估证据距今 " + Math.floor(inactiveDays) + " 天"
      : "当前目标尚无有效挑战或评估证据",
    impact:"目标推进和复习验证缺少新的学习证据",
    recommendation:"从当前目标范围内选择一个可执行行动，优先处理到期复习或阻塞先修",
    evidenceRefs:lastEvidence?[lastEvidence.id]:activeGoals.map(goal=>goal.goalId),
  });

  const activeGapKeys = new Set((insights?.competencyInsights || []).flatMap(state =>
    (state.activeGaps || []).map(gap => state.id + "::" + gap.id)));
  const byGap = new Map();
  for (const event of events.filter(item=>item.type==="attempt"&&item.correct===false&&item.gapId &&
    (item.competencyIds || []).some(id => activeGapKeys.has(id + "::" + item.gapId)))) {
    const key=(event.competencyIds||[])[0]+"::"+event.gapId;
    if(!byGap.has(key))byGap.set(key,[]);
    byGap.get(key).push(event);
  }
  for(const rows of byGap.values()){
    const recent=rows.filter(item=>current-dateMs(item.at)<=7*DAY_MS);
    if(recent.length>=2) output.push({
      id:"repeated-failure:"+recent[0].id,severity:recent.length>=3?"high":"moderate",
      title:"同一知识误区反复出现",
      reason:"最近 7 天内出现 "+recent.length+" 次相同 gap 错误",
      impact:"继续重复普通练习可能无法解决根因",
      recommendation:"进入针对性复习，先纠正概念并完成不同变体无提示验证",
      evidenceRefs:recent.slice(-10).map(item=>item.id),
    });
  }

  const dueRows=schedules.filter(item=>["due","overdue","relearning"].includes(item.status));
  const dueMinutes=dueRows.reduce((sum,item)=>sum+(item.status==="relearning"?12:8),0);
  if(dueRows.length>=4)output.push({
    id:"review-backlog",severity:dueRows.length>=8?"high":"moderate",
    title:"到期复习开始积压",
    reason:"当前有 "+dueRows.length+" 个节点需要处理，估计约 "+dueMinutes+" 分钟",
    impact:"新知识学习可能持续挤占保持性复习",
    recommendation:"今天优先选择风险最高的 1–2 个复习任务",
    evidenceRefs:dueRows.flatMap(item=>item.evidenceRefs||[]).slice(0,20),
  });

  const openTasks=tasks.filter(item=>["ready","in_progress","paused","failed"].includes(item.status));
  const dailyBudget=Math.max(10,Number(preferences.dailyMinutes)||25);
  const scheduledMinutes=openTasks.filter(item=>!item.planDate||item.planDate===new Date(current).toISOString().slice(0,10))
    .reduce((sum,item)=>sum+(Number(item.estimatedMinutes)||0),0)+dueMinutes;
  if(scheduledMinutes>dailyBudget*1.5)output.push({
    id:"learning-overload",severity:scheduledMinutes>dailyBudget*2?"high":"moderate",
    title:"当日学习负载超过时间预算",
    reason:"待执行任务和到期复习约 "+scheduledMinutes+" 分钟，可用时间为 "+dailyBudget+" 分钟",
    impact:"计划持续超载会增加中断和复习延迟",
    recommendation:"先做高风险复习，将低优先级新知识推迟到后续计划 proposal",
    evidenceRefs:openTasks.map(item=>item.taskId).slice(0,20),
  });

  const attempts=events.filter(item=>item.type==="attempt" &&
    Number.isFinite(dateMs(item.at)) && current-dateMs(item.at)<=30*DAY_MS);
  const hinted=attempts.filter(item=>Number(item.hintsUsed)>0);
  if(attempts.length>=5&&hinted.length/attempts.length>=0.5)output.push({
    id:"hint-dependency",severity:"moderate",title:"提示依赖较高",
    reason:"最近累计尝试中 "+Math.round(hinted.length/attempts.length*100)+"% 使用提示",
    impact:"当前通过证据的独立性有限",
    recommendation:"降低提示使用，安排无提示不同变体验证",
    evidenceRefs:hinted.slice(-10).map(item=>item.id),
  });

  for(const goal of activeGoals){
    const progress=insights?.goalProgress?.find(item=>item.goalId===goal.goalId);
    const remaining=schedules.filter(item=>(goal.competencyIds||[]).includes(item.competencyId)||
      (goal.topicIds||[]).includes(item.topicId));
    const blockers=remaining.filter(item=>item.activeGapIds?.length||item.status==="relearning");
    const overdue=remaining.filter(item=>item.status==="overdue");
    const forecast=goalForecasts.find(item=>item.goalId===goal.goalId);
    const targetAt=Date.parse(goal.targetAt||"");
    const targetPassed=Number.isFinite(targetAt)&&targetAt<current&&
      (forecast?.progress ?? progress?.progress ?? 0)<100;
    const forecastBehind=forecast?.onTrack===false;
    if(targetPassed){
      output.push({id:"goal-overdue:"+goal.goalId,severity:"high",
        title:"学习目标已落后于截止日期",
        reason:"目标「"+goal.title+"」已过截止时间，尚未达到稳定掌握标准",
        impact:"原目标时间预期需要调整",
        recommendation:"检查先修阻碍和可用时间，再生成新的计划 proposal",
        evidenceRefs:[goal.goalId,...blockers.flatMap(item=>item.evidenceRefs||[])].slice(0,20)});
    }else if(blockers.length||overdue.length||forecastBehind){
      output.push({id:"goal-deviation:"+goal.goalId,severity:
        blockers.length>=3||Number(forecast?.daysBeyondTarget)>=14?"high":"moderate",
        title:forecastBehind?"预计进度可能无法赶上目标日期":"目标推进存在知识阻碍",
        reason:"目标范围内 "+blockers.length+" 个节点有未解决薄弱点/重新学习，"+overdue.length+
          " 个逾期"+(forecastBehind?"；预计完成区间晚于目标日期约 "+forecast.daysBeyondTarget+" 天":""),
        impact:"后续知识点或当前投入节奏可能使目标时间预期偏离",
        recommendation:"先解决上游薄弱点，结合实际学习时间重新评估目标时间范围",
        evidenceRefs:[goal.goalId,...blockers.flatMap(item=>item.evidenceRefs||[])].slice(0,20)});
    }
  }
  return output.slice(0,30);
}

function buildGoalMilestones(rows, states, schedules) {
  const byId = new Map(rows.map(item => [item.id, item]));
  const depthMemo = new Map();
  function depth(id, visiting = new Set()) {
    if (depthMemo.has(id)) return depthMemo.get(id);
    const node = byId.get(id);
    if (!node || visiting.has(id)) return 0;
    const nextVisiting = new Set(visiting).add(id);
    const parentDepth = (node.prerequisites || [])
      .filter(parent => byId.has(parent))
      .map(parent => depth(parent, nextVisiting));
    const value = parentDepth.length ? Math.max(...parentDepth) + 1 : 0;
    depthMemo.set(id, value);
    return value;
  }
  const groups = new Map();
  for (const item of rows) {
    const key = item.topicId || "unclassified";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].map(([topicId, items]) => {
    const stable = items.filter(item =>
      states.get(item.id)?.status === "stable" && !(states.get(item.id)?.activeGaps || []).length);
    const blocked = items.filter(item =>
      (states.get(item.id)?.activeGaps || []).length ||
      schedules.get(item.id)?.status === "relearning" ||
      (item.prerequisites || []).some(id => {
        const parent = states.get(id);
        return !parent || parent.status !== "stable" || (parent.activeGaps || []).length > 0;
      }));
    const stage = Math.min(...items.map(item => depth(item.id))) + 1;
    const progress = items.length ? Math.round(stable.length / items.length * 100) : 0;
    return {
      id: "milestone:" + topicId,
      topicId,
      title: items[0].topicTitle,
      stage,
      competencyCount: items.length,
      stableCount: stable.length,
      progress,
      status: progress === 100 ? "completed" : blocked.length ? "blocked" :
        stable.length ? "in-progress" : "upcoming",
      blockers: blocked.slice(0, 5).map(item => ({ competencyId: item.id, title: item.title })),
    };
  }).sort((a, b) => a.stage - b.stage || a.title.localeCompare(b.title));
}

export function forecastLearningGoals({ goals = [], learningMap, schedules = [], insights, events = [], tasks = [], preferences = {}, now = new Date() } = {}) {
  const current = now instanceof Date ? new Date(now) : new Date(now);
  const all = (learningMap?.topics||[]).flatMap(topic=>(topic.competencies||[]).map(item=>({...item,topicId:topic.id,topicTitle:topic.title})));
  const states=new Map((insights?.competencyInsights||[]).map(item=>[item.id,item]));
  const scheduleMap=new Map(schedules.map(item=>[item.competencyId,item]));
  const active=goals.filter(goal=>goal.status==="active");
  const days=Math.max(1,Math.min(7,Number(preferences.weeklyDays)||5));
  return active.map(goal=>{
    const ids=new Set(goal.competencyIds||[]);
    all.filter(item=>(goal.topicIds||[]).includes(item.topicId)).forEach(item=>ids.add(item.id));
    const rows=all.filter(item=>ids.has(item.id));
    const stable=rows.filter(item=>states.get(item.id)?.status==="stable"&&!(states.get(item.id)?.activeGaps||[]).length);
    const remaining=rows.filter(item=>!stable.includes(item));
    const blockers=remaining.filter(item=>(states.get(item.id)?.activeGaps||[]).length||
      states.get(item.id)?.status==="weak"|| (item.prerequisites||[]).some(id=>states.get(id)?.status!=="stable"));
    const minutes=remaining.reduce((sum,item)=>{
      const state=states.get(item.id), schedule=scheduleMap.get(item.id);
      const gapCount=state?.activeGaps?.length||0;
      return sum+(gapCount?Math.max(12,gapCount*12):
        state?.status==="unverified"?28:
        ["weak","building"].includes(state?.status)?22:
        state?.status==="initial"?15:
        schedule?.status==="overdue"||schedule?.status==="due"?10:12);
    },0);
    const daily=Math.max(5,Math.min(240,Number(goal.dailyMinutes)||Number(preferences.dailyMinutes)||25));
    const goalNodeIds=new Set(rows.map(item=>item.id));
    const goalTasks=tasks.filter(task=>goalNodeIds.has(task.competencyId) &&
      task.status==="completed" && Number(task.timeSpentSeconds)>0 && Number(task.estimatedMinutes)>0);
    const ratios=goalTasks.map(task=>Number(task.timeSpentSeconds)/(Number(task.estimatedMinutes)*60))
      .filter(value=>Number.isFinite(value)&&value>0).sort((a,b)=>a-b);
    const historicalEfficiency=ratios.length
      ? clamp(ratios[Math.floor(ratios.length/2)],0.6,2.5) : 1;
    const adjustedMinutes=Math.round(minutes*historicalEfficiency);
    const weeklyMinutes=daily*days;
    const calendarDays=adjustedMinutes/weeklyMinutes*7;
    const confidence=remaining.length===0?"high":
      goalTasks.length>=3 || (rows.length>=5&&events.length>=12)?"medium":"low";
    const buffer=confidence==="high"?0.08:confidence==="medium"?0.2:0.35;
    const earliest=new Date(current.getTime()+calendarDays*DAY_MS);
    const latest=new Date(current.getTime()+calendarDays*(1+buffer)*DAY_MS);
    const targetAt=Number.isFinite(Date.parse(goal.targetAt||""))?Date.parse(goal.targetAt):null;
    const onTrack=targetAt===null?null:latest.getTime()<=targetAt;
    const daysBeyondTarget=targetAt===null?0:Math.max(0,Math.ceil((latest.getTime()-targetAt)/DAY_MS));
    const progress=rows.length?Math.round(stable.length/rows.length*100):0;
    const milestones = buildGoalMilestones(rows, states, scheduleMap);
    return {
      goalId:goal.goalId,title:goal.title,progress,stableCount:stable.length,targetCount:rows.length,
      milestones,
      remainingMinutesEstimate:adjustedMinutes,earliestDate:earliest.toISOString(),
      latestDate:latest.toISOString(),confidence,onTrack,daysBeyondTarget,
      historicalEfficiencyRatio:Number(historicalEfficiency.toFixed(2)),
      historicalCompletedTaskCount:goalTasks.length,
      blockers:blockers.slice(0,8).map(item=>({competencyId:item.id,title:item.title,topicId:item.topicId})),
      variables:[
        "按每天 "+daily+" 分钟、每周 "+days+" 天可用时间推算",
        goalTasks.length ? "根据 "+goalTasks.length+" 项已完成任务的实际耗时/估计耗时修正工作量" : "历史完成任务的实际耗时样本不足，暂用规则估算",
        "未完成节点使用规则估算，实际耗时会随验证结果调整",
        "先修缺口和待复习积压可能延长完成时间",
      ],
      evidenceRefs:remaining.flatMap(item=>scheduleMap.get(item.id)?.evidenceRefs||[]).slice(0,20),
    };
  });
}
