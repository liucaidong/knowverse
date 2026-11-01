import {completeStep,createChallengeProgressStore,getStepProgress,recordAttempt,revealNextHint,setStepData,summarizeChallenge} from "./challenge-engine.mjs";
const root=new URL("../../",import.meta.url);
const $=id=>document.getElementById(id);
let challenge,progress,store,activeStep,selected=null;
async function load(){
 const response=await fetch(new URL("content/challenges.json",root),{cache:"no-store"});
 if(!response.ok)throw new Error("无法载入挑战注册表："+response.status);
 const registry=await response.json();
 challenge=registry.challenges.find(x=>x.id==="rn-architecture-quest");
 if(!challenge)throw new Error("挑战尚未注册。");
 store=createChallengeProgressStore();
 progress=store.load(challenge);
 $("quest-save-status").textContent=store.available?"进度已保存在本设备":"浏览器禁用了本地存储";
 render();
}
function save(){
 const ok=store.save(progress);
 $("quest-save-status").textContent=ok?"进度已保存在本设备":"保存失败；请先导出学习档案并检查浏览器存储。";
}
function render(){
 const summary=summarizeChallenge(challenge,progress);
 $("quest-count").textContent=summary.completedSteps+" / "+summary.totalSteps;
 $("quest-progress-bar").style.width=(summary.completionRate*100)+"%";
 const index=progress.steps.findIndex(x=>x.status==="active");
 if(index<0){
  $("quest-active").classList.add("rn-hidden");
  $("quest-success").classList.remove("rn-hidden");
  $("quest-summary").textContent="六道关卡完成 · 得分 "+summary.earnedPoints+" / "+summary.maxPoints+" · 作答 "+summary.attempts+" 次 · 使用提示 "+summary.hintsUsed+" 条。学习证据已写入本地档案。";
  return;
 }
 $("quest-active").classList.remove("rn-hidden");
 $("quest-success").classList.add("rn-hidden");
 activeStep=challenge.steps[index];
 const state=getStepProgress(progress,activeStep.id);
 selected=null;
 $("quest-stage-label").textContent="GATE "+String(index+1).padStart(2,"0")+" / "+activeStep.title;
 $("quest-zone").textContent=["BUILD","JSI / RUNTIME","TURBOMODULES","FABRIC","THREADING","INTEGRATED MODEL"][index];
 $("quest-title").textContent=activeStep.title;
 $("quest-prompt").textContent=activeStep.prompt;
 if(activeStep.code){$("quest-code").hidden=false;$("quest-code").textContent=activeStep.code;}else $("quest-code").hidden=true;
 const host=$("quest-options");host.replaceChildren();
 activeStep.options.forEach(option=>{
  const button=document.createElement("button");
  button.type="button";button.className="rn-quest-option";button.setAttribute("aria-pressed","false");button.textContent=option.label;
  button.addEventListener("click",()=>{
   selected=option.id;
   host.querySelectorAll("button").forEach(n=>n.setAttribute("aria-pressed",String(n===button)));
   $("quest-submit").disabled=false;
  });
  host.append(button);
 });
 const total=activeStep.hints?.length||0;
 $("quest-hint").textContent=state.hintsUsed>=total?"提示已全部展开":"获取下一条提示 ("+state.hintsUsed+"/"+total+")";
 $("quest-hint").disabled=state.hintsUsed>=total;
 $("quest-hint-output").textContent=state.hintsUsed?activeStep.hints.slice(0,state.hintsUsed).map((h,i)=>"提示 "+(i+1)+"："+h).join("\n"):"先独立推演；需要帮助时再展开提示。";
 $("quest-feedback").className="rn-quest-feedback";
 $("quest-feedback").textContent=state.attempts?"本关已有 "+state.attempts+" 次作答记录。重新推演后可以再次提交。":"判断机制边界，再提交答案。";
 $("quest-submit").disabled=true;
}
$("quest-hint").addEventListener("click",()=>{
 const result=revealNextHint(progress,challenge,activeStep.id);
 if(result.exhausted)return;
 progress=result.progress;save();render();
});
$("quest-submit").addEventListener("click",()=>{
 if(!activeStep||!selected)return;
 const step=activeStep,correct=selected===step.answer;
 progress=recordAttempt(progress,step.id);
 progress=setStepData(progress,step.id,{lastOptionId:selected,correctOptionId:step.answer});
 if(correct)progress=completeStep(progress,challenge,step.id);
 save();
 if(correct){
  $("quest-feedback").className="rn-quest-feedback good";
  $("quest-feedback").textContent="推理正确。"+(step.explanation||"该能力点验证通过。");
  window.setTimeout(render,500);
 }else{
  const option=step.options.find(x=>x.id===selected);
  $("quest-feedback").className="rn-quest-feedback bad";
  $("quest-feedback").textContent="这条推理还不成立。"+(option?.gapId?" 已定位概念误区："+option.gapId+"。":"")+"重新检查阶段边界。";
  $("quest-submit").disabled=true;
 }
});
load().catch(error=>{
 $("quest-title").textContent="挑战加载失败";
 $("quest-prompt").textContent=error.message;
});