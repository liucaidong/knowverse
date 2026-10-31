(()=> {
  'use strict';
  const grid=document.querySelector('[data-catalog]');
  if(!grid)return;
  const siteRoot=new URL(document.body.dataset.root||'./',document.baseURI);
  const fixedPillar=grid.dataset.pillar||'';
  const params=new URLSearchParams(window.location.search);
  const requestedPillar=params.get('pillar')||'all';
  const filter=document.querySelector('[data-filter]');
  const search=document.querySelector('[data-work-search]');
  const count=document.querySelector('[data-count]');
  const kindLabels={experiment:'交互实验',exhibition:'沉浸展览',puzzle:'机制解谜',game:'3D 游戏'};
  let manifest=null;
  let activePillar=fixedPillar||requestedPillar;

  function message(text){
    const node=document.createElement('p');
    node.className='catalog-message';
    node.textContent=text;
    grid.replaceChildren(node);
  }
  function safeHref(href){
    if(typeof href!=='string'||!href.startsWith('./'))return null;
    const url=new URL(href.slice(2),siteRoot);
    return url.origin===siteRoot.origin&&url.pathname.startsWith(siteRoot.pathname)?url.href:null;
  }
  function makeCard(work,pillar){
    const href=safeHref(work.href);
    if(!href)return null;
    const card=document.createElement('a');
    card.className='work-card';
    card.href=href;
    const meta=document.createElement('div');
    meta.className='work-card-meta';
    const kind=document.createElement('span');
    kind.className='work-kind';
    kind.textContent=kindLabels[work.kind]||work.kind||'互动作品';
    const level=document.createElement('span');
    level.className='work-level';
    level.textContent=work.level||'未标注难度';
    const title=document.createElement('h3');
    title.textContent=work.title||'未命名作品';
    const summary=document.createElement('p');
    summary.textContent=work.summary||'';
    const footer=document.createElement('div');
    footer.className='work-card-footer';
    const subject=document.createElement('span');
    subject.textContent=[work.subject,pillar&&pillar.title].filter(Boolean).join(' · ');
    const enter=document.createElement('strong');
    enter.textContent='进入体验 ↗';
    meta.append(kind,level);
    footer.append(subject,enter);
    card.append(meta,title,summary,footer);
    return card;
  }
  function syncFilters(){
    if(!filter)return;
    filter.querySelectorAll('[data-pillar]').forEach(button=>{
      button.setAttribute('aria-pressed',String(button.dataset.pillar===activePillar));
    });
    filter.hidden=Boolean(fixedPillar);
  }
  function render(){
    if(!manifest)return;
    const query=(search?.value||'').trim().toLocaleLowerCase();
    const pillarMap=new Map(manifest.pillars.map(p=>[p.id,p]));
    const available=manifest.works.filter(work=>
      (activePillar==='all'||work.pillar===activePillar)&&
      (work.status==='live'||work.status==='planned')
    );
    const visible=available.filter(work=>{
      if(!query)return true;
      const haystack=[work.title,work.summary,work.subject,work.level,work.kind,pillarMap.get(work.pillar)?.title]
        .filter(Boolean).join(' ').toLocaleLowerCase();
      return haystack.includes(query);
    });
    grid.replaceChildren();
    if(!visible.length)message('没有找到符合条件的作品。试试更短的关键词，或切换产品主线。');
    else{
      visible.forEach(work=>{
        const card=makeCard(work,pillarMap.get(work.pillar));
        if(card)grid.append(card);
      });
      if(!grid.children.length)message('作品链接暂不可用，请检查内容清单。');
    }
    if(count)count.textContent=query?'找到 '+visible.length+' / '+available.length+' 件作品':'共 '+available.length+' 件作品';
    grid.setAttribute('aria-busy','false');
  }
  filter?.addEventListener('click',event=>{
    const button=event.target.closest('[data-pillar]');
    if(!button||!filter.contains(button))return;
    activePillar=button.dataset.pillar;
    syncFilters();
    render();
  });
  search?.addEventListener('input',render);
  fetch(new URL('content/works.json',siteRoot),{headers:{Accept:'application/json'}})
    .then(response=>{if(!response.ok)throw new Error('HTTP '+response.status);return response.json();})
    .then(data=>{
      if(!Array.isArray(data.pillars)||!Array.isArray(data.works))throw new Error('作品清单格式不正确');
      manifest=data;
      if(fixedPillar&&!manifest.pillars.some(p=>p.id===fixedPillar))throw new Error('未知的产品主线');
      if(!fixedPillar&&activePillar!=='all'&&!manifest.pillars.some(p=>p.id===activePillar))activePillar='all';
      syncFilters();
      render();
    })
    .catch(error=>{
      grid.setAttribute('aria-busy','false');
      message('作品目录加载失败（'+error.message+'）。请刷新页面，或从知识库导航继续浏览。');
      if(count)count.textContent='目录暂不可用';
    });
})();