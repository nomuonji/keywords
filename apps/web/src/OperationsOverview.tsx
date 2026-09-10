import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { ReviewPanel } from './ReviewPanel';

type AutoProject={
  id:string;name:string;domain?:string|null;mode?:string;environment?:'production'|'planning'|'test';
  control:{enabled:boolean;autoPublish:boolean};
  state:{status:string;stage:string;summary?:string|null;lastTickAt?:string|null;lastError?:string|null};
  activeOperation:{id:string;status:string;objective:string;taskTitle?:string|null;operatorKind?:string|null;workSummary?:string|null;blocker?:string|null;nextAction?:string|null;updatedAt:string}|null;
  executor:{id:string;status:string;connected:boolean}|null;
  recovery?:{state:string;newContentAllowed:boolean;nextObservationAt?:string|null};
  openReviews:number;qualityQueue?:number;
};
type AutoPortfolio={totals:{projects:number;enabled:number;executing:number;queued:number;attention:number;activeOperations:number;connectedAgents:number};projects:AutoProject[]};
type KeywordChoice={id:string;projectId:string;projectName:string;keyword:string;verdict:string;reason?:string|null;demand?:number|null;createdAt:string};
type Article={id:string;projectId:string;projectName:string;title:string;verifiedAt?:string|null;updatedAt:string};
type Portfolio={generatedAt?:string;stale?:boolean;keywordChoices?:KeywordChoice[];articles?:{complete?:Article[];inProgress?:Article[]}};
type Outcome={id:string;projectId:string;status:string;targetUrl?:string|null;hypothesis?:string|null;nextAction?:string|null;updatedAt:string};
type Operations={outcomes?:Outcome[]};
type Dashboard={generatedAt:string;errors:Array<{section:string;message:string}>;autopilot:AutoPortfolio|null;portfolio:Portfolio|null;operations:Operations|null};
type QueueItem={project:AutoProject;priority:number;kind:string;reason:string;nextAction:string;objective:string};
type RunTodayResponse={instruction:string;scope:string;startedAt:string;projects:Array<{projectId:string;name:string;domain?:string|null;result?:{status?:string;stage?:string;summary?:string|null}|null;error?:string}>};

const when=(value?:string|null)=>value?new Date(value).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const verdictLabel:Record<string,string>={shortlisted:'採用',rejected:'見送り',hold:'保留',research_more:'追加調査'};
const outcomeLabel:Record<string,string>={pending:'評価待ち',improved:'改善',regressed:'悪化',inconclusive:'未判定',unmeasurable:'計測不能'};
const brief=(value:string,limit=180)=>value.length<=limit?value:`${value.slice(0,limit).trim()}…`;
const isOperationalSite=(project:AutoProject)=>project.environment?project.environment==='production':project.mode==='existing_site'&&Boolean(project.domain)&&!/(^|\.)example\.(com|org|net)$/i.test(project.domain??'');
const objectiveLabel=(operation:AutoProject['activeOperation'],fallback?:string|null)=>{
  const text=(operation?.taskTitle||operation?.objective||fallback||'次のSEO作業を選定する').replace(/^Autonomous SEO operation:\s*/i,'').trim();
  if(/^Work session is awaiting_review/i.test(text))return '保留中の判断を完了する';
  if(/^Refresh live site URL inventory\.?/i.test(text))return '公開URL一覧を更新する';
  const improvement=text.match(/^Investigate and improve the existing page:\s*(.+)$/i);
  if(improvement){const title=improvement[1].match(/^.*?[。.!?](?=\s|$)/)?.[0]||improvement[1];return brief(`既存記事を調査・改善する：${title.replace(/[。.]+$/,'')}`,150)}
  const first=text.match(/^.*?[。.!?](?:\s|$)/)?.[0]?.trim()||text;
  return brief(first,150);
};

function queueItem(project:AutoProject,agentDisconnected:boolean):QueueItem|null{
  const operation=project.activeOperation;
  const objective=objectiveLabel(operation,project.state.summary);
  if(project.openReviews>0)return{project,priority:100,kind:'人の判断',reason:`${project.openReviews}件のレビューが未解決です`,nextAction:'レビュー内容を確認し、承認または見送りを決める',objective:`${project.name}の判断を完了する`};
  if(operation?.blocker||['blocked','attention'].includes(project.state.status))return{project,priority:90,kind:'停止中',reason:brief(operation?.blocker||project.state.lastError||project.state.summary||'処理が停止しています'),nextAction:brief(operation?.nextAction||'停止理由を解消して同じ作業を再開する'),objective};
  if(project.executor?.connected||project.state.stage==='executing')return{project,priority:80,kind:'実行中',reason:`${project.executor?.id||'Agent'}が処理しています`,nextAction:operation?.nextAction||'完了または判断待ちになるまで監視する',objective};
  if(operation||project.state.stage==='queued_for_agent')return{project,priority:70,kind:'Agent待ち',reason:agentDisconnected?'常駐Agentが接続されていないため開始できません':'実行キューで順番を待っています',nextAction:agentDisconnected?'常駐Agentを起動し、この作業を引き受けさせる':operation?.nextAction||'Agentが作業を引き受けるまで待つ',objective};
  if((project.qualityQueue??0)>0)return{project,priority:60,kind:'検証待ち',reason:`${project.qualityQueue}件のページ計画が品質確認待ちです`,nextAction:'根拠と重複リスクを確認する',objective};
  if(project.recovery&&project.recovery.state!=='not_connected'&&!project.recovery.newContentAllowed)return{project,priority:50,kind:'観測待ち',reason:'回復確認まで新規記事の拡張が保留されています',nextAction:project.recovery.nextObservationAt?`${new Date(project.recovery.nextObservationAt).toLocaleDateString('ja-JP')}以降に再計測する`:'回復条件の観測データを取得する',objective};
  if(project.control.enabled)return{project,priority:30,kind:'監視中',reason:'Autopilotは有効ですが、今すぐ行う作業はありません',nextAction:'次回の定期判定を待つ',objective};
  return null;
}

export function OperationsOverview({focusedProjectId,onFocusProject,onOpenArticles,onOpenSites}:{focusedProjectId:string;onFocusProject:(id:string)=>void;onOpenArticles:(id?:string)=>void;onOpenSites:(id?:string)=>void}){
  const [auto,setAuto]=useState<AutoPortfolio|null>(null),[portfolio,setPortfolio]=useState<Portfolio|null>(null),[ops,setOps]=useState<Operations|null>(null),[query,setQuery]=useState(''),[instruction,setInstruction]=useState('今日のSEO作業を進めて'),[errors,setErrors]=useState<Array<{section:string;message:string}>>([]),[loading,setLoading]=useState(true),[loaded,setLoaded]=useState(false),[updatedAt,setUpdatedAt]=useState(''),[reviewProject,setReviewProject]=useState<AutoProject|null>(null),[queueExpanded,setQueueExpanded]=useState(false),[showPlanning,setShowPlanning]=useState(false),[commandBusy,setCommandBusy]=useState(false),[commandNotice,setCommandNotice]=useState('');
  const load=async()=>{try{setLoading(true);const dashboard=await api<Dashboard>('/dashboard');if(dashboard.autopilot)setAuto(dashboard.autopilot);if(dashboard.portfolio)setPortfolio(dashboard.portfolio);if(dashboard.operations)setOps(dashboard.operations);setErrors(dashboard.errors);setUpdatedAt(dashboard.generatedAt)}catch(e){setErrors([{section:'dashboard',message:String(e)}])}finally{setLoading(false);setLoaded(true)}};
  const runToday=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();if(commandBusy)return;setCommandBusy(true);setCommandNotice('');try{const result=await api<RunTodayResponse>('/autopilot/run-today',{method:'POST',body:JSON.stringify({instruction,projectId:focusedProjectId||undefined})});const failed=result.projects.filter(project=>project.error).length;const target=result.scope==='project'?'対象サイト':'有効なサイト';setCommandNotice(!result.projects.length?'起動対象がありません。サイト設定でAutopilotをONにしてください。':failed?`${target}の起動を試みましたが、${failed}件でエラーが発生しました。`:`${target}の今日のSEO作業を起動しました。キューと停止理由を更新しています。`);await load()}catch(error){setErrors([{section:'command',message:String(error)}])}finally{setCommandBusy(false)}};
  useEffect(()=>{void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load()},30000);return()=>clearInterval(timer)},[]);
  const selected=focusedProjectId?auto?.projects.find(p=>p.id===focusedProjectId):null;
  const includePlanning=showPlanning||Boolean(selected&&!isOperationalSite(selected));
  const scopedProjects=useMemo(()=>(auto?.projects??[]).filter(project=>includePlanning||isOperationalSite(project)),[auto,includePlanning]);
  const visibleProjects=useMemo(()=>scopedProjects.filter(project=>!focusedProjectId||project.id===focusedProjectId),[scopedProjects,focusedProjectId]);
  const connectedAgents=visibleProjects.filter(project=>project.executor?.connected).length;
  const disconnected=Boolean(visibleProjects.some(project=>project.activeOperation||project.state.stage==='queued_for_agent')&&connectedAgents===0);
  const baseQueue=useMemo(()=>visibleProjects.map(p=>queueItem(p,disconnected)).filter((item):item is QueueItem=>Boolean(item)).sort((a,b)=>b.priority-a.priority||Date.parse(b.project.activeOperation?.updatedAt||b.project.state.lastTickAt||'')-Date.parse(a.project.activeOperation?.updatedAt||a.project.state.lastTickAt||'')),[visibleProjects,disconnected]);
  const queue=useMemo(()=>baseQueue.filter(item=>`${item.project.name} ${item.project.domain??''} ${item.objective} ${item.reason}`.toLowerCase().includes(query.toLowerCase())),[baseQueue,query]);
  const waitingCount=baseQueue.filter(item=>item.kind==='Agent待ち').length;
  const executingCount=visibleProjects.filter(project=>project.executor?.connected||project.state.stage==='executing').length;
  const recentArticles=useMemo(()=>[...(portfolio?.articles?.inProgress??[]),...(portfolio?.articles?.complete??[])].filter(a=>!focusedProjectId||a.projectId===focusedProjectId).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,5),[portfolio,focusedProjectId]);
  const choices=useMemo(()=>(portfolio?.keywordChoices??[]).filter(x=>!focusedProjectId||x.projectId===focusedProjectId).slice(0,5),[portfolio,focusedProjectId]);
  const outcomes=useMemo(()=>(ops?.outcomes??[]).filter(x=>!focusedProjectId||x.projectId===focusedProjectId).slice(0,5),[ops,focusedProjectId]);
  const primary=queue[0];
  return <div className="corePage">
    <div className="coreTitleRow"><div><p className="coreEyebrow">DAILY CONTROL</p><h1>{selected?selected.name:'今日のSEO運用'}</h1><p>止まっている理由と次の一手を、優先度順に確認します。</p></div><div className="coreLive"><span/>{loading?'更新中':updatedAt?`${when(updatedAt)} 更新`:'30秒更新'}</div></div>
    <section className="dailyCommand" aria-labelledby="daily-command-title"><div><p className="coreEyebrow">COMMAND</p><h2 id="daily-command-title">今日の作業を指示</h2><p>「今日のSEO作業を進めて」を送ると、Autopilotが有効なサイトの次の作業をキューに入れます。</p></div><form onSubmit={runToday}><label htmlFor="daily-instruction">指示文</label><div className="dailyCommandRow"><input id="daily-instruction" value={instruction} onChange={event=>setInstruction(event.target.value)} aria-describedby="daily-command-help"/><button className="primaryCommand" disabled={commandBusy}>{commandBusy?'起動中…':'指示を実行'}</button></div><small id="daily-command-help">対象サイトを絞り込んでいる場合は、そのサイトだけを対象にします。</small></form>{commandNotice&&<div className="commandNotice" role="status">{commandNotice}</div>}</section>
    {errors.length>0&&<div className="partialErrors" role="status"><div><strong>一部の情報を更新できませんでした</strong>{errors.map(item=><p key={item.section}>{item.section}: {item.message}</p>)}</div><button onClick={()=>void load()}>再試行</button></div>}
    {portfolio?.stale&&<aside className="staleNotice" role="status"><strong>分析データが古くなっています</strong><span>{when(portfolio.generatedAt)} 時点のスナップショットです。順位・流入の判断前に指標を更新してください。</span></aside>}
    {!loaded&&loading?<div className="dashboardSkeleton" aria-label="運用データを読み込み中"><span/><span/><span/><span/></div>:<>
    {disconnected&&<aside className="systemNotice" role="status"><div><strong>Agentが接続されていません</strong><p>{waitingCount}件が待機中です。APIや画面を開くだけではSEO作業は進みません。</p></div><code>npm run autopilot</code></aside>}
    <div className="focusBar"><label htmlFor="project-focus">対象サイト</label><select id="project-focus" value={focusedProjectId} onChange={e=>onFocusProject(e.target.value)}><option value="">実サイトすべて</option>{scopedProjects.map(p=><option key={p.id} value={p.id}>{p.name}{p.domain?` — ${p.domain}`:''}</option>)}</select>{focusedProjectId&&<button className="textButton" onClick={()=>onFocusProject('')}>絞り込み解除</button>}<button className="scopeToggle" aria-pressed={includePlanning} onClick={()=>{if(includePlanning){setShowPlanning(false);if(selected&&!isOperationalSite(selected))onFocusProject('')}else setShowPlanning(true)}}>{includePlanning?'実サイトだけ表示':'企画・テストも表示'}</button><span>{scopedProjects.length} projects</span></div>
    <div className="coreStats operationalStats">
      <div className={primary?.priority===100?'attentionStat':''}><span>人の判断</span><strong>{visibleProjects.reduce((n,p)=>n+p.openReviews,0)}</strong><small>ここで停止中</small></div>
      <div><span>実行中</span><strong>{executingCount}</strong><small>Agentが処理中</small></div>
      <div><span>Agent待ち</span><strong>{waitingCount}</strong><small>保存済みOperation</small></div>
      <div><span>接続Agent</span><strong>{connectedAgents}</strong><small>稼働Agent</small></div>
    </div>
    <div className="coreToolbar"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="サイト・目的・停止理由を検索" aria-label="運用キューを検索"/><span>{queue.length}件</span></div>

    {reviewProject&&<ReviewPanel projectId={reviewProject.id} projectName={reviewProject.name} onClose={()=>setReviewProject(null)} onResolved={()=>void load()}/>}

    <section className="commandSection"><div className="coreSectionHead"><div><p className="coreEyebrow">NEXT ACTIONS</p><h2>次にやること</h2></div><small>判断 → 停止 → 実行 → 待機の順</small></div>
      <div className="actionQueue">{queue.length?queue.slice(0,queueExpanded?queue.length:8).map((item,index)=><article className={`actionItem priority-${item.priority}`} key={item.project.id}>
        <span className="actionRank">{String(index+1).padStart(2,'0')}</span><div className="actionBody"><div className="actionMeta"><b>{item.project.name}</b><span>{item.kind}</span></div><h3 title={item.project.activeOperation?.objective}>{item.objective}</h3><p><strong>理由</strong>{item.reason}</p><p><strong>次</strong>{item.nextAction}</p></div><div className="rowActions">{item.priority===100&&<button className="primaryRowAction" onClick={()=>setReviewProject(item.project)}>判断する</button>}<button onClick={()=>onOpenSites(item.project.id)}>サイトを見る</button><button onClick={()=>onOpenArticles(item.project.id)}>記事を見る</button></div>
      </article>):auto?<div className="composedEmpty"><strong>{query?'検索条件に一致する作業はありません':'今すぐ行う作業はありません'}</strong><p>{query?'検索語を変えてください。':focusedProjectId?'このサイトには未解決の作業がありません。':'有効なサイトを選ぶか、Autopilotの次回判定を待ちます。'}</p></div>:<div className="sectionUnavailable">運用キューを取得できません。</div>}{queue.length>8&&<div className="queueDisclosure"><span>{queueExpanded?`${queue.length}件をすべて表示中`:`上位8件を表示中・残り${queue.length-8}件`}</span><button onClick={()=>setQueueExpanded(value=>!value)}>{queueExpanded?'上位8件に戻す':'残りも表示'}</button></div>}</div>
    </section>

    <div className="evidenceStrip">
      <section><div className="coreSectionHead"><div><p className="coreEyebrow">RECENT OUTPUT</p><h2>管理中の記事</h2></div><button className="textButton" onClick={()=>onOpenArticles(focusedProjectId)}>一覧</button></div>{portfolio?recentArticles.length?recentArticles.map(a=><div className="compactRow" key={a.id}><div><b>{a.title}</b><small>{a.projectName} · {when(a.updatedAt)}</small></div><span className={a.verifiedAt?'goodPill':'workPill'}>{a.verifiedAt?'検証済み':'検証待ち'}</span></div>):<p className="coreEmpty">管理中の記事はありません。</p>:<p className="sectionUnavailable">記事情報を取得できません。</p>}</section>
      <section><div className="coreSectionHead"><div><p className="coreEyebrow">DECISIONS</p><h2>選定・評価の証跡</h2></div><small>最新5件</small></div>{choices.map(x=><div className="decisionRow" key={x.id}><div><b>{x.keyword}</b><small>{x.projectName}{x.demand!=null?` · 月間 ${x.demand}`:''}</small></div><span className={`decision ${x.verdict}`}>{verdictLabel[x.verdict]||x.verdict}</span><p>{x.reason||'理由の記録なし'}</p></div>)}{outcomes.map(o=><div className="compactRow" key={o.id}><div><b>{o.targetUrl||o.hypothesis||'公開施策'}</b><small>{o.nextAction||when(o.updatedAt)}</small></div><span className={`statusPill ${o.status}`}>{outcomeLabel[o.status]||o.status}</span></div>)}{portfolio&&ops&&!choices.length&&!outcomes.length&&<p className="coreEmpty">選定・公開後評価の記録はありません。</p>}{(!portfolio||!ops)&&<p className="sectionUnavailable">一部の証跡を取得できません。</p>}</section>
    </div>
    </>}
  </div>;
}
