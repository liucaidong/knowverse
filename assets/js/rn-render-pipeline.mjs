const phases=[{id:"build",steps:[0,1]},{id:"startup",steps:[2,3]},{id:"runtime",steps:[4,5,6,7]}];
const steps=[
{phase:"build",title:"Hermes 生成字节码",label:"BUILD / 01",description:"Metro 输出的 JavaScript bundle 进入 Hermes 编译流程，Release 构建生成 Hermes Bytecode（常见产物为 .hbc）。",thread:"构建机 / Build Toolchain",io:"JS bundle → Hermes Bytecode",boundary:"这是构建期工作，不是在设备每次启动时重新编译源码。"},
{phase:"build",title:"Codegen 生成接口脚手架",label:"BUILD / 02",description:"Codegen 扫描 TypeScript / Flow spec，生成 C++ glue 与 Android / iOS 平台接口；原生业务实现仍由工程代码提供。",thread:"构建机 / Codegen",io:"Typed spec → C++ glue + platform interfaces",boundary:"Hermes 和 Codegen 是两条不同的构建产物路径。"},
{phase:"startup",title:"创建 JavaScript Runtime",label:"STARTUP / 03",description:"应用启动时创建 JavaScript Runtime，并加载应用 bundle / bytecode，准备执行 JavaScript。",thread:"Native app startup + JS Runtime",io:"Native app + compiled bundle → JS Runtime",boundary:"Runtime 已建立，不等于所有模块实例已经创建或首帧已经 Mount。"},
{phase:"startup",title:"安装 JSI 绑定与模块访问能力",label:"STARTUP / 04",description:"将框架和 Native 能力绑定到 JavaScript Runtime；TurboModule 的注册、查找与按需实例化需要区分。",thread:"Runtime setup / C++ bindings",io:"JS Runtime + generated interfaces → accessible APIs",boundary:"JSI 是接口能力；不要推导成所有调用同步或数据零拷贝。"},
{phase:"runtime",title:"Render：构建 React / Shadow Tree",label:"RUNTIME / 05",description:"React 执行组件逻辑，产生 React Element Tree；Host Components 对应 C++ Shadow Nodes，组成新的不可变 Shadow Tree。",thread:"通常在 JavaScript Thread；场景可能变化",io:"React state / props → Element Tree + Shadow Tree",boundary:"Shadow Tree 是 C++ 渲染模型，不是平台 UIView 或 Android View。"},
{phase:"runtime",title:"Commit：Yoga 布局与树提升",label:"RUNTIME / 06",description:"Commit 阶段计算 Shadow Nodes 的布局信息（Yoga），然后把新树提升为下一棵待 Mount 的树。",thread:"常见布局工作在 JS Thread；提交调度可跨线程",io:"Shadow Tree + constraints → layout metrics + next tree",boundary:"Yoga 负责布局计算；Commit 不等于屏幕已经出现新像素。"},
{phase:"runtime",title:"Mount：tree diff 与 Host View 更新",label:"RUNTIME / 07",description:"比较已渲染树与 next tree，生成创建、更新、删除等原子 mutation，并在平台 UI Thread 应用到 Host Views。",thread:"UI Thread / Main Thread",io:"Tree diff → native mutations → Host Views",boundary:"只有 UI Thread 能操作平台 Host Views；Mount 不应与 Yoga 布局混淆。"},
{phase:"runtime",title:"事件反馈与下一次更新",label:"RUNTIME / 08",description:"Native 输入、手势或系统事件进入事件系统，再触发 JavaScript 逻辑和下一轮状态更新。高优先级离散事件可以影响 Render 调度。",thread:"Native event source → event dispatch → JS / UI scheduling",io:"Platform event → JS handler → new state → next render",boundary:"不是所有事件都在同一个 FIFO 队列；优先级和线程场景会影响调度。"}];
let index=4;const $=id=>document.getElementById(id);
function render(){
 const step=steps[index];
 for(const [id,value] of [["rn-step-label",step.label],["rn-step-title",step.title],["rn-step-description",step.description],["rn-step-thread",step.thread],["rn-step-io",step.io],["rn-step-boundary",step.boundary]])$(id).textContent=value;
 document.querySelectorAll("[data-phase]").forEach(b=>b.setAttribute("aria-pressed",String(phases.find(p=>p.id===b.dataset.phase).steps.includes(index))));
 const host=$("rn-flow-track");host.replaceChildren();
 steps.forEach((item,i)=>{
  const button=document.createElement("button");button.type="button";button.className="rn-flow-node"+(i===index?" active":"");
  const strong=document.createElement("strong"),small=document.createElement("small");
  strong.textContent=(i+1)+". "+item.title;small.textContent=item.phase.toUpperCase();
  button.append(strong,small);button.addEventListener("click",()=>{index=i;render();});host.append(button);
 });
 $("rn-prev").disabled=index===0;$("rn-next").disabled=index===steps.length-1;
}
$("rn-prev").addEventListener("click",()=>{index=Math.max(0,index-1);render();});
$("rn-next").addEventListener("click",()=>{index=Math.min(steps.length-1,index+1);render();});
$("rn-reset").addEventListener("click",()=>{index=0;render();});
document.querySelectorAll("[data-phase]").forEach(b=>b.addEventListener("click",()=>{index=phases.find(p=>p.id===b.dataset.phase).steps[0];render();}));
render();