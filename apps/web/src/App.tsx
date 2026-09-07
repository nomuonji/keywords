import { FormEvent, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { DiscoveryWorkspace } from './DiscoveryWorkspace';
import { KeywordWorkspace } from './KeywordWorkspace';
import { PlanningWorkspace } from './PlanningWorkspace';
import { SettingsWorkspace } from './SettingsWorkspace';
import { GovernanceWorkspace } from './GovernanceWorkspace';
import { SeoOperations } from './SeoOperations';
import type { Project, Snapshot, Task } from './product-types';

type View='home'|'discovery'|'keywords'|'planning'|'performance'|'work'|'settings';
const nav:Array<{id:View;label:string;hint:string}>=[
 {id:'home',label:'ホーム',hint:'次の作業'},
 {id:'discovery',label:'キーワード探索',hint:'新しい候補'},
 {id:'keywords',label:'キーワード',hint:'全件一覧'},
 {id:'planning',label:'コンテンツ計画',hint:'クラスタ・企画'},
 {id:'performance',label:'検索実績',hint:'サイト・GSC'},
 {id:'work',label:'作業・レビュー',hint:'Agent・人間判断'},
 {id:'settings',label:'設定',hint:'対象・接続・データ'}
];
const when=(value:string)=>new Date(value).toLocaleString();
const metricLabel=(value:string)=>({topics:'トピック',keywords:'キーワード',unclusteredKeywords:'未クラスタ',clusters:'クラスタ',proposedPages:'企画確認待ち',openTasks:'未完了タスク',openInsights:'未解決Insight'}[value]||value.replace(/([A-Z])/g,' $1'));

export function App(){
 const [projects,setProjects]=useState<Project[]>([]),[projectId,setProjectId]=useState(''),[view,setView]=useState<View>('home'),[snapshot,setSnapshot]=useState<Snapshot|null>(null),[tasks,setTasks]=useState<Task[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(''),[loading,setLoading]=useState(false),[refreshKey,setRefreshKey]=useState(0);
 const abortRef=useRef<AbortController|null>(null),projectIdRef=useRef(projectId);projectIdRef.current=projectId;
 const loadProjects=async()=>{const rows=await api<Project[]>('/projects');setProjects(rows);setProjectId(current=>current||rows[0]?.id||'')};
 const loadHome=async(target=projectIdRef.current)=>{if(!target)return;abortRef.current?.abort();const controller=new AbortController();abortRef.current=controller;try{setLoading(true);const [s,t]=await Promise.all([api<Snapshot>(`/projects/${target}/snapshot`,{signal:controller.signal}),api<Task[]>(`/projects/${target}/tasks`,{signal:controller.signal})]);if(controller.signal.aborted||projectIdRef.current!==target)return;setSnapshot(s);setTasks(t);setError('')}catch(e){if(!controller.signal.aborted)setError(String(e))}finally{if(abortRef.current===controller){abortRef.current=null;setLoading(false)}}};
 useEffect(()=>{loadProjects().catch(e=>setError(String(e)))},[]);
 useEffect(()=>{abortRef.current?.abort();setSnapshot(null);if(projectId){setView('home');void loadHome(projectId)}return()=>abortRef.current?.abort()},[projectId]);
 const refresh=()=>{setRefreshKey(k=>k+1);void loadHome(projectIdRef.current)};
 async function createProject(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget,f=new FormData(form);try{setBusy('project');const p=await api<Project>('/projects',{method:'POST',body:JSON.stringify({name:f.get('name'),domain:f.get('domain')})});form.reset();await loadProjects();setProjectId(p.id);setView('settings')}catch(e){setError(String(e))}finally{setBusy('')}}
 const openTasks=tasks.filter(t=>t.status!=='done');
 return <div className="app productApp"><aside><div className="brand"><span className="dot"/>KEYWORDS</div><div className="sideSection"><h4>Projects</h4>{projects.map(p=><button className={p.id===projectId?'project active':'project'} onClick={()=>setProjectId(p.id)} key={p.id}><b>{p.name}</b><small>{p.domain||'topic only'}</small></button>)}<form className="stack createProject" onSubmit={createProject}><input name="name" placeholder="新しいプロジェクト" required/><input name="domain" placeholder="domain（任意）"/><button disabled={busy==='project'}>{busy==='project'?'作成中…':'作成'}</button></form></div>{projectId&&<nav className="productNav">{nav.map(item=><button key={item.id} className={view===item.id?'active':''} onClick={()=>setView(item.id)}><b>{item.label}</b><small>{item.hint}</small></button>)}</nav>}<div className="sideFooter"><small>Agent-native · Human-governed</small><small>Publishing is out of scope</small></div></aside>
 <main>{error&&<div className="error globalError">{error}<button onClick={()=>setError('')}>×</button></div>}{!projectId?<section className="empty"><h1>プロジェクトを作成</h1><p>サイトがなくてもテーマだけで探索を開始できます。</p></section>:loading&&!snapshot?<section className="empty"><h1>ワークスペースを読み込み中…</h1></section>:snapshot?<><header className="productHeader"><div><p className="eyebrow">SEO WORKSPACE</p><h1>{snapshot.project.name}</h1><p>{snapshot.project.domain||'テーマ起点のプロジェクト'}</p></div><div className="agent"><span className="pulse"/>共有状態 接続中</div></header>
  {view==='home'&&<Home snapshot={snapshot} tasks={openTasks} onNavigate={setView}/>} 
  {view==='discovery'&&<DiscoveryWorkspace key={`d-${projectId}-${refreshKey}`} projectId={projectId} onChanged={refresh}/>} 
  {view==='keywords'&&<KeywordWorkspace key={`k-${projectId}-${refreshKey}`} projectId={projectId}/>} 
  {view==='planning'&&<PlanningWorkspace key={`p-${projectId}-${refreshKey}`} projectId={projectId} onChanged={refresh}/>} 
  {view==='performance'&&<div className="productStack"><SeoOperations key={`s-${projectId}-${refreshKey}`} projectId={projectId} onChanged={refresh}/></div>} 
  {view==='work'&&<GovernanceWorkspace key={`w-${projectId}-${refreshKey}`} projectId={projectId} onChanged={refresh}/>} 
  {view==='settings'&&<SettingsWorkspace key={`set-${projectId}-${refreshKey}`} projectId={projectId} onChanged={refresh}/>} 
 </>:<section className="empty"><h1>プロジェクトを読み込めません</h1><button onClick={()=>void loadHome(projectId)}>再試行</button></section>}</main></div>;
}

function Home({snapshot,tasks,onNavigate}:{snapshot:Snapshot;tasks:Task[];onNavigate:(view:View)=>void}){
 return <div className="productStack"><section className="homeHero"><div><p className="eyebrow">TODAY</p><h2>次に狙うテーマを、根拠付きで決める</h2><p>目的を渡すとAgentが調査し、候補の採否と企画承認だけを人間が判断します。</p></div><button className="primaryAction heroAction" onClick={()=>onNavigate('discovery')}>新しいキーワードを探す</button></section>
  <section className="metrics productMetrics">{Object.entries(snapshot.counts).map(([k,v])=><button className="metric" key={k} onClick={()=>onNavigate(k.includes('keyword')||k==='keywords'?'keywords':k.includes('Page')?'planning':k.includes('Task')?'work':'home')}><strong>{v}</strong><span>{metricLabel(k)}</span></button>)}</section>
  <div className="twoColumn"><section className="panel"><div className="panelHead"><div><p className="eyebrow">NEXT / ACTIVE</p><h2>未完了タスク</h2></div><span>{tasks.length}</span></div><div className="list">{tasks.slice(0,8).map(t=><div className="task" key={t.id}><span className={`status ${t.status}`}>{t.status}</span><div><b>{t.title}</b><small>{t.assigneeType} · priority {t.priority}{t.relatedType?` · ${t.relatedType}`:''}</small></div></div>)}{!tasks.length&&<div className="hint">未完了タスクはありません。新しい探索を始められます。</div>}</div></section>
  <section className="panel"><div className="panelHead"><div><p className="eyebrow">RECENT RESULTS</p><h2>最近の変更</h2></div></div><div className="timeline">{snapshot.recentRuns.filter(r=>!['project.snapshot','work.list','review.list'].includes(r.command)).slice(0,10).map(r=><div className="event" key={r.id}><span className={r.status==='succeeded'?'ok':'bad'}/><div><b>{r.command}</b><small>{r.actor} · {when(r.createdAt)}</small></div></div>)}{!snapshot.recentRuns.length&&<div className="hint">まだ操作履歴はありません。</div>}</div></section></div>
  <section className="flowStrip"><span>1 Project brief</span><b>→</b><span>2 Agent discovery</span><b>→</b><span>3 Candidate review</span><b>→</b><span>4 Content plan</span><b>→</b><span>5 Human review</span></section>
 </div>;
}
