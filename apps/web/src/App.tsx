import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { WorkSessions } from './WorkSessions';
import { SeoOperations } from './SeoOperations';

type Project={id:string;name:string;domain:string|null};
type Snapshot={project:Project;counts:Record<string,number>;recentRuns:Array<{id:string;actor:string;command:string;status:string;createdAt:string;durationMs:number|null}>};
type KeywordRow={keyword:{id:string;text:string;source:string;status:string;avgMonthly:number|null};clusterId:string|null};
type ClusterRow={cluster:{id:string;title:string;intent:string};keywordCount:number};
type Task={id:string;title:string;status:string;assigneeType:string;priority:number};
type Decision={id:string;verdict:string;action:string;targetType:string;reason:string|null};
type Source={id:string;type:string;label:string;url:string|null;createdAt:string};
type Insight={id:string;type:string;text:string;confidence:number|null;status:string;sourceId:string|null;createdAt:string};
type Page={id:string;title:string;slug:string;status:string;kind:string;clusterId:string|null;rationale:string|null;createdAt:string;updatedAt:string};
type Cannibalization={exactTargetConflicts:Array<{keywordId:string;keyword:string;severity:string;pages:Array<{id:string;title:string;status:string;role:string}>}>;sameClusterConflicts:Array<{clusterId:string;clusterTitle:string|null;severity:string;pages:Array<{id:string;title:string;status:string}>}>;checkedPages:number;checkedTargets:number};
type PolicyRule={id:string;scope:string;rule:string;rationale:string|null;status:string;sourceDecisionIds:string[];proposedBy:string;reviewedBy:string|null;createdAt:string;updatedAt:string};
type PolicyContext={active:PolicyRule[];candidates:PolicyRule[];retired:PolicyRule[];recentDecisions:Array<{id:string;action:string;targetType:string;targetId:string|null;verdict:string;reason:string|null;createdAt:string}>};

const when=(value:string)=>new Date(value).toLocaleString();
const sourceHost=(value:string|null)=>{if(!value)return '';try{return new URL(value).hostname}catch{return value}};

export function App(){
 const [projects,setProjects]=useState<Project[]>([]),[projectId,setProjectId]=useState(''),[snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [keywords,setKeywords]=useState<KeywordRow[]>([]),[clusters,setClusters]=useState<ClusterRow[]>([]),[tasks,setTasks]=useState<Task[]>([]),[decisions,setDecisions]=useState<Decision[]>([]),[sources,setSources]=useState<Source[]>([]),[insights,setInsights]=useState<Insight[]>([]),[pages,setPages]=useState<Page[]>([]),[cannibalization,setCannibalization]=useState<Cannibalization|null>(null),[policies,setPolicies]=useState<PolicyContext|null>(null),[error,setError]=useState('');
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState('');
 const loadAbortRef=useRef<AbortController|null>(null);
 const projectIdRef=useRef(projectId);
 projectIdRef.current=projectId;

 const loadProjects=async()=>{
   const p=await api<Project[]>('/projects');
   setProjects(p);
   setProjectId(current=>current||p[0]?.id||'');
 };

 const load=async(targetProjectId=projectIdRef.current)=>{
   if(!targetProjectId)return;
   loadAbortRef.current?.abort();
   const controller=new AbortController();
   loadAbortRef.current=controller;
   setLoading(true);
   try{
     setError('');
     const [s,k,c,t,d,so,i,p,ca,po]=await Promise.all([
       api<Snapshot>(`/projects/${targetProjectId}/snapshot`,{signal:controller.signal}),
       api<KeywordRow[]>(`/projects/${targetProjectId}/keywords`,{signal:controller.signal}),
       api<ClusterRow[]>(`/projects/${targetProjectId}/clusters`,{signal:controller.signal}),
       api<Task[]>(`/projects/${targetProjectId}/tasks`,{signal:controller.signal}),
       api<Decision[]>(`/projects/${targetProjectId}/decisions`,{signal:controller.signal}),
       api<Source[]>(`/projects/${targetProjectId}/sources`,{signal:controller.signal}),
       api<Insight[]>(`/projects/${targetProjectId}/insights`,{signal:controller.signal}),
       api<Page[]>(`/projects/${targetProjectId}/pages`,{signal:controller.signal}),
       api<Cannibalization>(`/projects/${targetProjectId}/pages/cannibalization?limit=20`,{signal:controller.signal}),
       api<PolicyContext>(`/projects/${targetProjectId}/policies/context?decisions=20`,{signal:controller.signal})
     ]);
     if(controller.signal.aborted||projectIdRef.current!==targetProjectId)return;
     setSnapshot(s);setKeywords(k);setClusters(c);setTasks(t);setDecisions(d);setSources(so);setInsights(i);setPages(p);setCannibalization(ca);setPolicies(po);
   }catch(e){
     if(!controller.signal.aborted&&projectIdRef.current===targetProjectId)setError(String(e));
   }finally{
     if(loadAbortRef.current===controller){loadAbortRef.current=null;if(projectIdRef.current===targetProjectId)setLoading(false)}
   }
 };

 useEffect(()=>{loadProjects().catch(e=>setError(String(e)))},[]);
 useEffect(()=>{
   loadAbortRef.current?.abort();
   if(!projectId){setSnapshot(null);setLoading(false);return}
   setSnapshot(null);
   void load(projectId);
   return()=>loadAbortRef.current?.abort();
 },[projectId]);

 const unclustered=useMemo(()=>keywords.filter(x=>!x.clusterId&&x.keyword.status!=='rejected'),[keywords]);
 const conflictCount=(cannibalization?.exactTargetConflicts.length??0)+(cannibalization?.sameClusterConflicts.length??0);
 const refreshWorkspace=()=>load(projectIdRef.current);

 async function createProject(e:FormEvent<HTMLFormElement>){
   e.preventDefault();const form=e.currentTarget;const f=new FormData(form);
   try{setBusy('project');setError('');const p=await api<Project>('/projects',{method:'POST',body:JSON.stringify({name:f.get('name'),domain:f.get('domain')})});form.reset();await loadProjects();setProjectId(p.id)}catch(e){setError(String(e))}finally{setBusy('')}
 }
 async function addKeyword(e:FormEvent<HTMLFormElement>){
   e.preventDefault();const form=e.currentTarget;const f=new FormData(form);const targetProjectId=projectIdRef.current;
   try{setBusy('keyword');setError('');await api(`/projects/${targetProjectId}/keywords`,{method:'POST',body:JSON.stringify({text:f.get('keyword')})});form.reset();if(projectIdRef.current===targetProjectId)await load(targetProjectId)}catch(e){setError(String(e))}finally{setBusy('')}
 }
 async function addTask(e:FormEvent<HTMLFormElement>){
   e.preventDefault();const form=e.currentTarget;const f=new FormData(form);const targetProjectId=projectIdRef.current;
   try{setBusy('task');setError('');await api(`/projects/${targetProjectId}/tasks`,{method:'POST',body:JSON.stringify({title:f.get('task')})});form.reset();if(projectIdRef.current===targetProjectId)await load(targetProjectId)}catch(e){setError(String(e))}finally{setBusy('')}
 }
 async function fetchEvidence(e:FormEvent<HTMLFormElement>){
   e.preventDefault();const form=e.currentTarget;const f=new FormData(form);const targetProjectId=projectIdRef.current;
   try{setBusy('evidence');setError('');await api(`/projects/${targetProjectId}/research/web`,{method:'POST',body:JSON.stringify({url:f.get('url')})});form.reset();if(projectIdRef.current===targetProjectId)await load(targetProjectId)}catch(e){setError(String(e))}finally{setBusy('')}
 }
 async function reviewPage(pageId:string,verdict:'approved'|'rejected'|'needs_edit'){
   try{
     setError('');let reason:string|undefined;
     if(verdict!=='approved'){
       const input=window.prompt(verdict==='rejected'?'Why reject this page plan?':'What should be edited?');
       if(input===null)return;
       reason=input.trim();
       if(!reason){setError('A reason is required for this review action.');return}
     }
     const targetProjectId=projectIdRef.current;
     await api(`/projects/${targetProjectId}/pages/${pageId}/review`,{method:'POST',body:JSON.stringify({verdict,reason})});
     if(projectIdRef.current===targetProjectId)await load(targetProjectId);
   }catch(e){setError(String(e))}
 }
 async function reviewPolicy(policyId:string,verdict:'active'|'rejected'){
   try{
     setError('');let reason:string|undefined;
     if(verdict==='rejected'){
       const input=window.prompt('Why reject this policy candidate?');
       if(input===null)return;
       reason=input.trim();
       if(!reason){setError('A reason is required to reject a policy candidate.');return}
     }
     const targetProjectId=projectIdRef.current;
     await api(`/projects/${targetProjectId}/policies/${policyId}/review`,{method:'POST',body:JSON.stringify({verdict,reason})});
     if(projectIdRef.current===targetProjectId)await load(targetProjectId);
   }catch(e){setError(String(e))}
 }
 async function retirePolicy(policyId:string){
   try{const input=window.prompt('Why should this active policy be retired?');if(input===null)return;const reason=input.trim();if(!reason){setError('A reason is required to retire a policy.');return}setError('');const targetProjectId=projectIdRef.current;await api(`/projects/${targetProjectId}/policies/${policyId}/retire`,{method:'POST',body:JSON.stringify({reason})});if(projectIdRef.current===targetProjectId)await load(targetProjectId)}catch(e){setError(String(e))}
 }

 return <div className="app"><aside><div className="brand"><span className="dot"/>KEYWORDS</div><h4>Projects</h4>{projects.map(p=><button className={p.id===projectId?'project active':'project'} onClick={()=>setProjectId(p.id)} key={p.id}><b>{p.name}</b><small>{p.domain||'no domain'}</small></button>)}<form className="stack" onSubmit={createProject}><input name="name" placeholder="New project" required/><input name="domain" placeholder="domain (optional)"/><button disabled={busy==='project'}>{busy==='project'?'Creating…':'Create project'}</button></form></aside>
 <main>{error&&<div className="error">{error}</div>}{!projectId?<section className="empty"><h1>Create a project</h1><p>The workspace state will be shared by the UI, CLI, and MCP agents.</p></section>:loading&&!snapshot?<section className="empty"><h1>Loading project…</h1><p>Refreshing the shared workspace state.</p></section>:!snapshot?<section className="empty"><h1>Project unavailable</h1><p>Check the error above and retry the project.</p></section>:<>
 <header><div><p className="eyebrow">SEO WORKSPACE</p><h1>{snapshot.project.name}</h1><p>{snapshot.project.domain||'No domain configured'}</p></div><div className="agent"><span className="pulse"/>Agent-ready</div></header>
 <section className="metrics">{Object.entries(snapshot.counts).map(([k,v])=><div className="metric" key={k}><strong>{v}</strong><span>{k.replace(/([A-Z])/g,' $1')}</span></div>)}</section>
 <div className="grid"><WorkSessions projectId={projectId} onChanged={refreshWorkspace}/><SeoOperations projectId={projectId} onChanged={refreshWorkspace}/><section className="panel policyPanel"><div className="panelHead"><div><p className="eyebrow">PROJECT POLICY MEMORY</p><h2>How this project works</h2></div><span>{policies?.active.length??0} active · {policies?.candidates.length??0} pending</span></div><div className="policyList">{policies?.active.map(p=><div className="policyRule activePolicy" key={p.id}><div><span className="sourceType">{p.scope}</span><b>{p.rule}</b>{p.rationale&&<small>{p.rationale}</small>}<small>{p.sourceDecisionIds.length} decision source{p.sourceDecisionIds.length===1?'':'s'} · active</small></div><div className="pageActions"><button onClick={()=>void retirePolicy(p.id)}>Retire</button></div></div>)}{policies?.candidates.map(p=><div className="policyRule candidatePolicy" key={p.id}><div><span className="sourceType">candidate · {p.scope}</span><b>{p.rule}</b>{p.rationale&&<small>{p.rationale}</small>}<small>{p.sourceDecisionIds.length} decision source{p.sourceDecisionIds.length===1?'':'s'} · proposed by {p.proposedBy}</small></div><div className="pageActions"><button onClick={()=>void reviewPolicy(p.id,'active')}>Activate</button><button onClick={()=>void reviewPolicy(p.id,'rejected')}>Reject</button></div></div>)}{!policies?.active.length&&!policies?.candidates.length&&<div className="hint">No durable project rules yet. Agents can propose policy candidates from repeated human decisions; only a human can activate them.</div>}</div></section>
 <section className="panel map"><div className="panelHead"><div><p className="eyebrow">CONTENT MAP</p><h2>Clusters</h2></div><span>{clusters.length} nodes</span></div><div className="clusterCanvas">{clusters.length?clusters.map((c,i)=><div className="cluster" style={{transform:`translate(${(i%3)*26}px, ${(i%2)*14}px)`}} key={c.cluster.id}><b>{c.cluster.title}</b><span>{c.keywordCount} keywords · {c.cluster.intent}</span></div>):<div className="hint">No clusters yet. An agent can create these through MCP.</div>}</div></section>
 <section className="panel"><div className="panelHead"><div><p className="eyebrow">BACKLOG</p><h2>Unclustered queries</h2></div><span>{unclustered.length}</span></div><form className="inline" onSubmit={addKeyword}><input name="keyword" placeholder="Add keyword" required/><button disabled={busy==='keyword'}>{busy==='keyword'?'…':'+'}</button></form><div className="list">{unclustered.slice(0,12).map(x=><div className="row" key={x.keyword.id}><div><b>{x.keyword.text}</b><small>{x.keyword.source}</small></div><span>{x.keyword.avgMonthly??'—'}</span></div>)}</div></section>
 <section className="panel"><div className="panelHead"><div><p className="eyebrow">CONTENT PLAN</p><h2>Page proposals</h2></div><span>{pages.filter(p=>p.status!=='archived').length} active</span></div><div className="list">{pages.slice(0,10).map(p=><div className="task" key={p.id}><span className={`status ${p.status}`}>{p.status}</span><div><b>{p.title}</b><small>/{p.slug} · {p.kind}</small>{p.rationale&&<small>{p.rationale}</small>}</div>{p.status==='proposed'&&<div className="pageActions"><button onClick={()=>void reviewPage(p.id,'approved')}>Approve</button><button onClick={()=>void reviewPage(p.id,'needs_edit')}>Edit</button><button onClick={()=>void reviewPage(p.id,'rejected')}>Reject</button></div>}</div>)}{!pages.length&&<div className="hint">No page plans yet. Agents should use page_plan after checking opportunity context and SERP intent.</div>}</div></section>
 <section className="panel decisions"><div className="panelHead"><div><p className="eyebrow">CANNIBALIZATION REVIEW</p><h2>Overlap signals</h2></div><span>{conflictCount}</span></div>{cannibalization?.exactTargetConflicts.slice(0,5).map(c=><div className="decision" key={`kw-${c.keywordId}`}><b>{c.severity} · exact target</b><span>{c.keyword}</span><p>{c.pages.map(p=>`${p.title} (${p.role})`).join(' ↔ ')}</p></div>)}{cannibalization?.sameClusterConflicts.slice(0,5).map(c=><div className="decision" key={`cluster-${c.clusterId}`}><b>{c.severity} · same cluster</b><span>{c.clusterTitle||c.clusterId}</span><p>{c.pages.map(p=>p.title).join(' ↔ ')}</p></div>)}{!conflictCount&&<div className="hint">No overlapping active page targets detected.</div>}</section>
 <section className="panel evidence"><div className="panelHead"><div><p className="eyebrow">RESEARCH EVIDENCE</p><h2>Sources</h2></div><span>{sources.length}</span></div><form className="inline wideAction" onSubmit={fetchEvidence}><input name="url" type="url" placeholder="Fetch a public URL" required/><button disabled={busy==='evidence'}>{busy==='evidence'?'Fetching…':'Fetch'}</button></form><div className="sourceList">{sources.slice(0,10).map(s=><div className="source" key={s.id}><span className="sourceType">{s.type.replaceAll('_',' ')}</span><div><b>{s.label}</b><small>{sourceHost(s.url)||'stored evidence'} · {when(s.createdAt)}</small></div></div>)}{!sources.length&&<div className="hint">No evidence yet. MCP research tools and this URL fetch will store sources here.</div>}</div></section>
 <section className="panel"><div className="panelHead"><div><p className="eyebrow">RESEARCH INTERPRETATION</p><h2>Insights</h2></div><span>{insights.filter(i=>i.status==='open').length} open</span></div><div className="insightList">{insights.slice(0,9).map(i=><div className="insight" key={i.id}><div className="insightTop"><b>{i.type}</b><span>{i.confidence===null?'—':`${Math.round(i.confidence*100)}%`}</span></div><p>{i.text}</p><small>{i.sourceId?'source-linked':'no source link'} · {when(i.createdAt)}</small></div>)}{!insights.length&&<div className="hint">Research is evidence; insights are the agent or human interpretation of that evidence.</div>}</div></section>
 <section className="panel"><div className="panelHead"><div><p className="eyebrow">SHARED QUEUE</p><h2>Tasks</h2></div><span>{tasks.filter(t=>t.status!=='done').length} open</span></div><form className="inline" onSubmit={addTask}><input name="task" placeholder="Create a task" required/><button disabled={busy==='task'}>{busy==='task'?'…':'+'}</button></form><div className="list">{tasks.slice(0,10).map(t=><div className="task" key={t.id}><span className={`status ${t.status}`}>{t.status}</span><div><b>{t.title}</b><small>{t.assigneeType} · p{t.priority}</small></div></div>)}</div></section>
 <section className="panel activity"><div className="panelHead"><div><p className="eyebrow">AGENT ACTIVITY</p><h2>Command log</h2></div></div><div className="timeline">{snapshot.recentRuns.map(r=><div className="event" key={r.id}><span className={r.status==='succeeded'?'ok':'bad'}/><div><b>{r.command}</b><small>{r.actor} · {when(r.createdAt)} · {r.durationMs??0}ms</small></div></div>)}</div></section>
 <section className="panel decisions"><div className="panelHead"><div><p className="eyebrow">FEEDBACK MEMORY</p><h2>Decisions</h2></div><span>{decisions.length}</span></div>{decisions.slice(0,8).map(d=><div className="decision" key={d.id}><b>{d.verdict}</b><span>{d.action} · {d.targetType}</span><p>{d.reason||'No reason recorded'}</p></div>)}</section></div></>}</main></div>
}
