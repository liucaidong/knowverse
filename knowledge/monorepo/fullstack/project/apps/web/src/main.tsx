import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getLessons, totalMinutes } from '@kv/domain';
import { parseLessonsResponse, type LessonSummary } from '@kv/contracts';
import './style.css';
const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
function App() {
  const [lessons, setLessons] = useState<readonly LessonSummary[]>(getLessons().lessons);
  const [status, setStatus] = useState('本地共享领域数据');
  useEffect(() => {
    const abort = new AbortController();
    fetch(`${API}/api/lessons`, { signal: abort.signal })
      .then(async response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() as Promise<unknown>; })
      .then(json => { const data = parseLessonsResponse(json); setLessons(data.lessons); setStatus('NestJS API 已连通，契约验证成功'); })
      .catch(err => { if (!abort.signal.aborted) setStatus(`API 尚未连接：${String(err)}。展示共享领域数据。`); });
    return () => abort.abort();
  }, []);
  return <main className="shell"><div className="eyebrow">KNOWVERSE / MULTI-APP SYSTEM</div>
    <h1>一个知识模型，<em>三个运行时</em></h1>
    <p className="sub">React Web 真实组件；NestJS REST 接口；React Native 共享相同的类型契约与纯领域逻辑。</p>
    <div className="status">{status}</div><div className="stats"><div><strong>{lessons.length}</strong><small>共同课程</small></div><div><strong>{totalMinutes(lessons)}</strong><small>学习分钟</small></div></div>
    <section className="cards">{lessons.map((x, i) => <article key={x.id}><span>LESSON {String(i+1).padStart(2,'0')} / {x.level}</span><h2>{x.title}</h2><p>预计 {x.minutes} 分钟</p></article>)}</section>
    <footer>源数据 → @kv/domain · JSON 类型边界 → @kv/contracts · API → NestJS 12</footer></main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
