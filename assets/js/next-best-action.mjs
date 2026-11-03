export const NEXT_BEST_ACTION_VERSION = 1;
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const terminal=new Set(["completed","skipped","cancelled"]);
const validHref=value=>typeof value==="string"&&value.startsWith("./")&&!value.startsWith("../")&&!value.includes("://");

const riskBonus={low:0,moderate:9,high:19,critical:26};
const reviewBonus={new:0,learning:0,scheduled:0,stable:0,due:16,overdue:22,relearning:24};

function actionBase(input){
  const state=input.state||{},risk=input.risk||{},schedule=input.schedule||{};
  const goals=input.goals||[];
  const nowMs=input.now instanceof Date?input.now.getTime():Date.parse(input.now||new Date().toISOString());
  const activeGoal=goals.filter(goal=>goal.status==="active"&&
    ((goal.competencyIds||[]).includes(input.competencyId)||(goal.topicIds||[]).includes(input.topicId)))
    .sort((a,b)=>(Number(b.priority)||3)-(Number(a.priority)||3))[0];
  const gap=(state.activeGaps||[])[0];
  const downstream=Number(risk.downstreamCount)||0;
  let score=20+(riskBonus[risk.level]||0)+(reviewBonus[schedule.status]||0);
  const reasons=[];
  if(schedule.status==="relearning")reasons.push("最近验证失败或存在未解决薄弱点，需要重新学习");
  else if(schedule.status==="overdue")reasons.push("已超过一个完整复习间隔 "+Math.floor(schedule.overdueDays||0)+" 天");
  else if(schedule.status==="due")reasons.push("已经达到下一次复习时间");
  if(risk.level&&risk.level!=="low")reasons.push("遗忘风险："+risk.level+"（"+(risk.reasons||[]).join("；")+"）");
  if(gap){score+=16+Math.min(8,(gap.count||1)*2);reasons.push("需要针对性纠正："+gap.label);}
  if(activeGoal){
    score+=(Number(activeGoal.priority)||3)*3;
    reasons.push("关联当前目标「"+activeGoal.title+"」");
    const targetAt=Date.parse(activeGoal.targetAt||"");
    if(Number.isFinite(targetAt)){
      const daysLeft=Math.ceil((targetAt-nowMs)/86_400_000);
      if(daysLeft<0){score+=12;reasons.push("目标日期已过，需要重新评估计划");}
      else if(daysLeft<=7){score+=10;reasons.push("目标日期临近，剩余 "+daysLeft+" 天");}
      else if(daysLeft<=21){score+=5;reasons.push("目标日期在三周内");}
    }
  }
  if(downstream){score+=Math.min(10,downstream*2);reasons.push("会影响 "+downstream+" 个下游知识点");}
  return {score,reasons,activeGoal,gap};
}

export function rankNextBestActions({
  learningMap, insights, schedules=[], risks=[], trends=[], goals=[], tasks=[], preferences={}, now=new Date(),
}={}){
  const current=now instanceof Date?now:new Date(now);
  const competencies=(learningMap?.topics||[]).flatMap(topic=>
    (topic.competencies||[]).map(item=>({...item,topicId:topic.id,topicTitle:topic.title})));
  const states=new Map((insights?.competencyInsights||[]).map(item=>[item.id,item]));
  const scheduleMap=new Map(schedules.map(item=>[item.competencyId,item]));
  const riskMap=new Map(risks.map(item=>[item.competencyId,item]));
  const activeTasks=tasks.filter(task=>!terminal.has(task.status)&&["ready","in_progress","paused","failed"].includes(task.status));
  const activeCompetencies=new Set(activeTasks.map(task=>task.competencyId).filter(Boolean));
  const actions=[];
  for(const task of activeTasks){
    const competency=competencies.find(item=>item.id===task.competencyId);
    const ongoing=task.status==="in_progress";
    const minutes=Math.max(5,Number(task.estimatedMinutes)||10);
    const state=states.get(task.competencyId)||{};
    const schedule=scheduleMap.get(task.competencyId)||{};
    const risk=riskMap.get(task.competencyId)||{};
    const priority=actionBase({
      competencyId:task.competencyId,topicId:task.topicId||competency?.topicId,
      state,schedule,risk,goals,now:current,
    });
    const statusBonus=ongoing?22:["paused","failed"].includes(task.status)?15:10;
    const score=Math.round(clamp(priority.score+statusBonus,0,100));
    actions.push({
      id:"task:"+task.taskId,type:"continue-task",title:ongoing?"继续正在进行的任务":task.status==="failed"?"重试未完成任务":"继续待执行任务",
      competencyId:task.competencyId||null,topicId:task.topicId||competency?.topicId||null,
      topicTitle:task.topicTitle||competency?.topicTitle||"学习任务",taskId:task.taskId,
      href:validHref(task.href)?task.href:null,estimatedMinutes:minutes,
      score,
      reasons:[...new Set(["该任务已进入现有任务编排","当前状态："+task.status,...priority.reasons])].slice(0,8),
      evidenceRefs:[task.taskId,...(task.evidenceEventIds||[]),...(schedule.evidenceRefs||[])].slice(0,20),
      expectedOutcome:"推进当前任务并保留执行时间/完成证据",
      deferImpact:"任务将继续处于未完成状态，并可能挤占后续学习时间",
      confidence:schedule.confidence||"high",dueAt:task.dueAt||schedule.dueAt||null,
    });
  }

  const downstreamById=new Map();
  for(const item of competencies)downstreamById.set(item.id,0);
  for(const item of competencies)for(const parent of item.prerequisites||[])
    if(downstreamById.has(parent))downstreamById.set(parent,downstreamById.get(parent)+1);

  for(const item of competencies){
    if(activeCompetencies.has(item.id))continue;
    const state=states.get(item.id)||{},schedule=scheduleMap.get(item.id)||{},risk=riskMap.get(item.id)||{};
    const {score:base,reasons,activeGoal,gap}=actionBase({
      competencyId:item.id,topicId:item.topicId,state,schedule,risk,goals,now:current,
    });
    const prereqMissing=(item.prerequisites||[]).map(id=>states.get(id)).filter(parent=>
      !parent||parent.status!=="stable"||(parent.activeGaps||[]).length);
    let type,title,href,estimatedMinutes,expectedOutcome,deferImpact;
    if(gap||schedule.status==="relearning"){
      type="targeted-review";title="纠正薄弱点："+(gap?.label||item.title);
      href="./review/?competencyId="+encodeURIComponent(item.id)+(gap?"&gapId="+encodeURIComponent(gap.id):"");
      estimatedMinutes=12;expectedOutcome="纠正错误概念并完成不同变体、无提示的独立验证";
      deferImpact="未解决的错误将继续阻塞该能力及相关下游知识";
    }else if(["due","overdue"].includes(schedule.status)){
      type="spaced-review";title="复习："+item.title;
      href="./review/?competencyId="+encodeURIComponent(item.id);
      estimatedMinutes=8;expectedOutcome="重新验证长期保持情况并更新下一复习间隔";
      deferImpact=schedule.status==="overdue"?"继续延后将超过一个完整复习间隔":"该知识已到复习时间，延后会推迟保持性验证";
    }else if((downstreamById.get(item.id)||0)>0&&state.status!=="stable"){
      type="prerequisite-repair";title="补齐先修能力："+item.title;
      href=item.challengeHref||item.lessonHref||item.topicHref||null;
      estimatedMinutes=18;expectedOutcome="补齐上游能力，解除后续知识学习阻塞";
      deferImpact="当前先修能力继续阻塞 "+downstreamById.get(item.id)+" 个下游知识点";
    }else if(prereqMissing.length===0&&["weak","building"].includes(state.status)){
      type="focused-practice";title="专项巩固："+item.title;
      href=item.challengeHref||item.labHref||item.lessonHref||item.topicHref||null;
      estimatedMinutes=18;expectedOutcome="增加新的独立练习证据并补强薄弱能力";
      deferImpact=downstreamById.get(item.id)?"下游知识将继续依赖当前薄弱能力":"该能力的掌握证据不会得到更新";
    }else if(state.status==="unverified"&&prereqMissing.length===0){
      type="new-learning";title="开始学习："+item.title;
      href=item.lessonHref||item.topicHref||null;
      estimatedMinutes=25;expectedOutcome="建立知识基础并进入后续独立验证";
      deferImpact="该节点尚无有效掌握证据";
    }else continue;
    if(!validHref(href))continue;
    const budget=Number(preferences.dailyMinutes)||25;
    const score=Math.round(clamp(base+(type==="prerequisite-repair"?10:0)-
      (estimatedMinutes>budget?12:0),0,100));
    actions.push({
      id:type+":"+item.id+":"+(gap?.id||schedule.dueAt||"current"),
      type,title,competencyId:item.id,topicId:item.topicId,topicTitle:item.topicTitle,
      taskId:null,href,estimatedMinutes,score,
      reasons:[...new Set(reasons.length?reasons:["根据现有知识图谱与学习证据推荐下一步"])].slice(0,6),
      evidenceRefs:[...(schedule.evidenceRefs||[]),...(gap?.evidenceRefs||[])].slice(0,20),
      expectedOutcome,deferImpact,
      confidence:schedule.confidence||"low",dueAt:schedule.dueAt||null,
      goalId:activeGoal?.goalId||null,
    });
  }
  const seen=new Set();
  return actions.filter(item=>{
    const key=item.type==="continue-task"?item.taskId:item.competencyId+":"+item.type;
    if(seen.has(key))return false;seen.add(key);return true;
  }).sort((a,b)=>b.score-a.score||
    (Date.parse(a.dueAt||"9999-12-31")-Date.parse(b.dueAt||"9999-12-31"))||
    a.estimatedMinutes-b.estimatedMinutes||
    String(a.competencyId||a.taskId).localeCompare(String(b.competencyId||b.taskId)))
    .slice(0,20).map((item,index)=>({...item,rank:index+1,scoreReason:"综合复习状态、风险、目标优先级、先修影响与时间预算排序"}));
}
