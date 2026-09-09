import { PortfolioWorkspace } from './PortfolioWorkspace';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { DiscoveryWorkspace } from './DiscoveryWorkspace';
import { KeywordWorkspace } from './KeywordWorkspace';
import { PlanningWorkspace } from './PlanningWorkspace';
import { SettingsWorkspace } from './SettingsWorkspace';
import { GovernanceWorkspace } from './GovernanceWorkspace';
import { SeoOperations } from './SeoOperations';
import { BlogWorkspace } from './BlogWorkspace';
import { OperationsHome } from './OperationsHome';
import { AutopilotOverview } from './AutopilotOverview';
import type { Project, Snapshot } from './product-types';

type View='portfolio'|'autopilot'|'home'|'discovery'|'keywords'|'planning'|'performance'|'work'|'settings';
const nav:Array<{id:View;label:string;hint:string}>=[
 {id:'home',label:'今日の運用',hint:'依頼・判断・進行'},
 {id:'discovery',label:'キーワード探索',hint:'新しい候補'},
 {id:'keywords',label:'キーワード',hint:'全件一覧'},
 {id:'planning',label:'コンテンツ計画',hint:'クラスタ・企画'},
 {id:'performance',label:'検索実績',hint:'サイト・GSC'},
 {id:'work',label:'作業・レビュー',hint:'Agent・人間判断'},
 {id:'settings',label:'設定',hint:'対象・接続・データ'}
];

export function App(){
 const [projects,setProjects]=useState<Project[]>([]),[projectId,setProjectId]=useState(''),[view,setView]=useState<View>('portfolio'),[snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[loading,setLoading]=useState(false),[refreshKey,setRefreshKey]=useState(0);
 const abortRef=useRef<AbortController|null>(null),projectIdRef=useRef(projectId),nextProjectViewRef=useRef<View|null>(null);projectIdRef.current=projectId;
 const loadProjects=async()=>{const rows=await api<Project[]>('/projects');setProjects(rows);setProjectId(current=>current||rows[0]?.id||'')};
 const loadHome=async(target=projectIdRef.current)=>{if(!target)return;abortRef.current?.abort();const controller=new AbortController();abortRef.current=controller;try{setLoading(true);const s=await api<Snapshot>(`/projects/${target}/snapshot`,{signal:controller.signal});if(controller.signal.aborted||projectIdRef.current!==target)return;setSnapshot(s);setError('')}catch(e){if(!controller.signal.aborted)setError(String(e))}finally{if(abortRef.current===controller){abortRef.current=null;setLoading(false)}}};
 useEffect(()=>{loadProjects().catch(e=>setError(String(e)))},[]);
 useEffect(()=>{abortRef.current?.abort();setSnapshot(null);if(projectId){const nextView=nextProjectViewRef.current;nextProjectViewRef.current=null;setView(current=>nextView??(current==='portfolio'?'portfolio':'home'));void loadHome(projectId)}return()=>abortRef.current?.abort()},[projectId]);
 const refresh=()=>{setRefreshKey(k=>k+1);void loadHome(projectIdRef.current)};
 async function createProject(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget,f=new FormData(form);try{setBusy('project');const p=await api<Project>('/projects',{method:'POST',body:JSON.stringify({name:f.get('name'),domain:f.get('domain')})});form.reset();nextProjectViewRef.current='settings';await loadProjects();setProjectId(p.id)}catch(e){setError(String(e))}finally{setBusy('')}}
 return <div className="app productApp"><aside><div className="brand"><span className="dot"/>KEYWORDS</div><button className={view==='portfolio'?'project active':'project'} onClick={()=>setView('portfolio')}>サイト群の実績</button><button className={view==='autopilot'?'project active':'project'} onClick={()=>setView('autopilot')}><b>自動操縦</b><small>全サイト俯瞰・監視</small></button><div className="sideSection"><h4>Projects</h4><div className="projectList">{projects.map(p=><button className={p.id===projectId?'project active':'project'} onClick={()=>{if(p.id===projectId)setView('home');else{nextProjectViewRef.current='home';setProjectId(p.id)}}} key={p.id}><b>{p.name}</b><small>{p.domain||'topic only'}</small></button>)}</div><form className="stack createProject" onSubmit={createProject}><input name="name" placeholder="新しいプロジェクト" required/><input name="domain" placeholder="domain（任意）"/><button disabled={busy==='project'}>{busy==='project'?'作成中…':'作成'}</button></form></div>{projectId&&<nav className="productNav">{nav.map(item=><button key={item.id} className={view===item.id?'active':''} onClick={()=>setView(item.id)}><b>{item.label}</b><small>{item.hint}</small></button>)}</nav>}<div className="sideFooter"><small>Agent-native · Human-governed</small><small>Publishing requires separate authorization</small></div></aside>
 <main className={view==='portfolio'||view==='autopilot'?'portfolioMain':undefined}>{error&&view!=='portfolio'&&view!=='autopilot'&&<div className="error globalError" role="alert">{error}<button aria-label="エラーを閉じる" onClick={()=>setError('')}>×</button></div>}{view==='portfolio'?<PortfolioWorkspace onOpen={(id,targetView)=>{if(id===projectId)setView(targetView);else{nextProjectViewRef.current=targetView;setProjectId(id)}}}/>:view==='autopilot'?<AutopilotOverview/>:!projectId?<section className="empty"><h1>プロジェクトを作成</h1><p>サイトがなくてもテーマだけで探索を開始できます。</p></section>:loading&&!snapshot?<section className="empty"><h1>ワークスペースを読み込み中…</h1></section>:snapshot?<><header className="productHeader"><div><p className="eyebrow">SEO OPERATIONS</p><h1>{snapshot.project.name}</h1><p>{snapshot.project.domain||'テーマ起点のプロジェクト'}</p></div><div className="agent"><span className="pulse"/>共有状態 接続中</div></header>
  {view==='home'&&<OperationsHome key={`op-${projectId}-${refreshKey}`} projectId={projectId} onChanged={refresh}/>} 
  {view==='discovery'&&<DiscoveryWorkspace key={`d-${projectId}-${refreshKey}`} projectId={projectId} onChanged={refresh}/>} 
  {view==='keywords'&&<KeywordWorkspace key={`k-${projectId}-${refreshKey}`} projectId={projectId}/>} 
  {view==='planning'&&<PlanningWorkspace key={`p-${projectId}-${refreshKey}`} projectId={projectId} onChanged={refresh}/>} 
  {view==='performance'&&<div className="productStack"><BlogWorkspace key={`blog-${projectId}`} projectId={projectId}/><SeoOperations key={`s-${projectId}-${refreshKey}`} projectId={projectId} onChanged={refresh}/></div>}
  {view==='work'&&<GovernanceWorkspace key={`w-${projectId}-${refreshKey}`} projectId={projectId} onChanged={refresh}/>} 
  {view==='settings'&&<SettingsWorkspace key={`set-${projectId}-${refreshKey}`} projectId={projectId} onChanged={refresh}/>} 
 </>:<section className="empty"><h1>プロジェクトを読み込めません</h1><button onClick={()=>void loadHome(projectId)}>再試行</button></section>}</main></div>;
}
