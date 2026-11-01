const details={
 hermes:{title:"Hermes · Build",description:"Release 构建会把 JavaScript 编译为 Hermes Bytecode。它是 JavaScript Runtime，不是 Fabric renderer，也不是 Native Module registry。"},
 codegen:{title:"Codegen · Build",description:"Codegen 读取 TypeScript / Flow spec，生成 C++ glue 和 Android / iOS 接口脚手架。原生业务行为仍由平台代码实现。"},
 jsi:{title:"JSI Runtime · Startup",description:"JSI 为 JavaScript Runtime 与 C++ 之间提供接口能力。它不保证所有调用同步，也不保证所有数据零拷贝。"},
 turbo:{title:"TurboModules · Startup / Runtime",description:"类型化接口与生成代码连接平台模块；Registry 负责访问模块，模块实例可以按需创建。"},
 fabric:{title:"Fabric · Runtime",description:"Render 创建 Element / Shadow Tree；Commit 做布局和树提升；Mount 计算 diff 并更新 Host Views。"},
 threads:{title:"Thread model · Runtime",description:"JavaScript Thread 执行常见 React render；UI Thread 负责平台 Host Views。高优先级交互会影响 Render 调度。"}
};
function selectNode(id){
 const info=details[id];if(!info)return;
 document.querySelectorAll("[data-node]").forEach(node=>node.setAttribute("aria-pressed",String(node.dataset.node===id)));
 document.getElementById("rn-node-title").textContent=info.title;
 document.getElementById("rn-node-description").textContent=info.description;
}
function setStage(next){
 document.querySelectorAll("[data-space-stage]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.spaceStage===next)));
 document.querySelectorAll("[data-node]").forEach(node=>{node.hidden=node.dataset.stage!==next;});
 const first=document.querySelector('[data-node][data-stage="'+next+'"]');if(first)selectNode(first.dataset.node);
}
document.querySelectorAll("[data-space-stage]").forEach(button=>button.addEventListener("click",()=>setStage(button.dataset.spaceStage)));
document.querySelectorAll("[data-node]").forEach(button=>button.addEventListener("click",()=>selectNode(button.dataset.node)));
setStage("build");