import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import './autopilot.css';

type ProjectRow = {
  id: string; name: string; domain?: string | null;
  control: { enabled: boolean; autoPublish: boolean; cadenceMinutes: number };
  state: { status: string; stage: string; summary?: string | null; lastTickAt?: string | null; nextTickAt?: string | null; lastError?: string | null };
  activeOperation: { id: string; status: string; objective: string; operatorKind?: string | null; taskTitle?: string | null; workSummary?: string | null; blocker?: string | null; nextAction?: string | null; updatedAt: string } | null;
  executor: { id: string; status: string; connected: boolean; lastSeenAt: string } | null;
  openReviews: number; qualityQueue: number;
  lastEvent: { kind: string; severity: string; createdAt: string } | null;
};
type PortfolioStatus = {
  generatedAt: string;
  scheduler: { enabled: boolean; intervalMinutes: number; runOnStart: boolean };
  totals: { projects: number; enabled: number; running: number; executing: number; queued: number; attention: number; activeOperations: number; connectedAgents: number };
  projects: ProjectRow[];
};

const time = (value?: string | null) => value ? new Date(value).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '未実行';
const stage: Record<string, string> = { idle: '待機', planning: '選定中', queued_for_agent: 'Agent待ち', executing: '実行中', quality_gate: '品質判定', delivery_ready: '搬送待ち', observing: '成果観測', decision_wait: '判断待ち', manual_boundary: '人間境界', throttled: '上限待ち', attention: '要対応', blocked: '停止', error: 'エラー' };
const phases = [
  { id: 'planning', label: '選定', description: '次の仕事を決める' },
  { id: 'queued_for_agent', label: 'Agent待ち', description: '実行枠を待つ' },
  { id: 'executing', label: '実行中', description: '調査・計測を進める' },
  { id: 'quality_gate', label: '品質判定', description: '安全性と根拠を確認' },
  { id: 'delivery_ready', label: '搬送待ち', description: 'Blog境界で待機' },
  { id: 'observing', label: '成果観測', description: '公開後の変化を見る' },
];
const tone = (status: string, enabled: boolean) => !enabled ? 'off' : status === 'running' ? 'live' : ['attention', 'blocked', 'error'].includes(status) ? 'alert' : 'idle';
const phaseIndex = (value: string) => phases.findIndex(phase => phase.id === value);
const effectiveStage = (project: ProjectRow) => project.activeOperation?.status === 'blocked' ? 'blocked' : project.activeOperation?.status === 'awaiting_review' ? 'decision_wait' : project.state.stage;
const effectiveStatus = (project: ProjectRow) => project.activeOperation?.status === 'blocked' ? 'blocked' : project.activeOperation?.status === 'awaiting_review' ? 'attention' : project.state.status;
const blocker = (project: ProjectRow) => project.activeOperation?.blocker || (effectiveStatus(project) === 'blocked' ? '外部依存関係の復旧待ち' : '');
const taskKind = (project: ProjectRow) => {
  const raw = project.activeOperation?.operatorKind || project.activeOperation?.objective || '';
  if (/Search Console metrics/i.test(raw)) return 'capture_metrics';
  if (/live site URL inventory/i.test(raw)) return 'sync_site';
  if (/Keyword discovery is due/i.test(raw)) return 'discovery_due';
  if (/Investigate search decline/i.test(raw)) return 'investigate_query_drop';
  if (/Resolve unclustered demand/i.test(raw)) return 'structure_demand';
  if (/Evaluate a due operation outcome/i.test(raw)) return 'observe_outcome';
  return project.activeOperation?.operatorKind || '';
};
const taskDetails: Record<string, { label: string; description: string; next: string }> = {
  capture_metrics: { label: 'Search Consoleの実績を取得', description: '直近の検索クエリ別・ページ別データ（クリック、表示、CTR、平均掲載順位）を取得して履歴に保存', next: '取得完了後、前回の観測値と比較' },
  sync_site: { label: '公開URLの棚卸しを更新', description: 'サイトマップを読み込み、公開中URLの追加・更新・最終確認日を同期', next: 'URLの鮮度を更新して次の改善候補を再判定' },
  discovery_due: { label: '検索需要の候補を調査', description: '実測できる検索需要と既存ページを確認し、候補テーマを整理', next: '根拠と重複を確認して候補を選別' },
  investigate_query_drop: { label: '検索流入の下落を調査', description: 'クリック数・表示順位が下がった検索クエリを前回観測と比較', next: '原因候補と必要な改善を整理' },
  structure_demand: { label: '未整理の検索需要を構造化', description: 'クラスタ未所属の需要を既存テーマと照合し、企画への組み込み方を判断', next: '重複を避けたページ企画の候補を作成' },
  observe_outcome: { label: '実施済み施策の成果を確認', description: '施策前後のSearch Console観測値を同じ条件で比較', next: '改善・横ばい・未計測のいずれかを記録' },
};
const taskLabel = (project: ProjectRow) => {
  const known = taskDetails[taskKind(project)];
  if (known) return `${known.label}：${known.description}`;
  const raw = project.activeOperation?.objective || project.state.summary || '次の仕事を選定中';
  return raw.replace(/^Autonomous SEO operation:\s*/i, '').replace(/^Operation active:\s*/i, '').split(/[。.!?]\s|。/)[0].trim();
};
const taskDescription = (project: ProjectRow) => {
  const known = taskDetails[taskKind(project)];
  if (known) return known.description;
  if (project.activeOperation?.workSummary) return project.activeOperation.workSummary;
  const raw = project.activeOperation?.objective || '';
  const reason = raw.replace(/^Autonomous SEO operation:\s*/i, '').replace(/^Operation active:\s*/i, '').replace(/^[^.。]+[.。]\s*/, '').split(/\sBuild or refresh evidence/i)[0].trim();
  return reason || 'Agentが次の作業に必要な証拠を確認中';
};
const taskNext = (project: ProjectRow) => taskDetails[taskKind(project)]?.next || project.activeOperation?.nextAction || '作業結果を共有DBに記録';

export function AutopilotOverview() {
  const [data, setData] = useState<PortfolioStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyProject, setBusyProject] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const load = async (signal?: AbortSignal) => {
    try { setData(await api<PortfolioStatus>('/autopilot/portfolio', { signal })); setError(''); }
    catch (e) { if (!signal?.aborted) setError(String(e)); }
  };
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); const timer = setInterval(() => void load(), 5000); return () => { controller.abort(); clearInterval(timer); }; }, []);
  const visible = useMemo(() => data?.projects.filter(project => `${project.name} ${project.domain ?? ''} ${effectiveStatus(project)} ${effectiveStage(project)}`.toLowerCase().includes(filter.toLowerCase())) ?? [], [data, filter]);
  const phaseCounts = useMemo(() => Object.fromEntries(phases.map(phase => [phase.id, data?.projects.filter(project => project.control.enabled && phaseIndex(effectiveStage(project)) === phaseIndex(phase.id)).length ?? 0])), [data]);
  const executingProject = useMemo(() => data?.projects.find(project => project.activeOperation && project.executor?.connected) ?? null, [data]);
  const activeProjects = useMemo(() => data?.projects.filter(project => project.control.enabled && (project.activeOperation || project.state.status === 'running')).sort((a, b) => {
    const aRank = a.executor?.connected ? 0 : a.activeOperation ? 1 : 2;
    const bRank = b.executor?.connected ? 0 : b.activeOperation ? 1 : 2;
    return aRank - bRank || (Date.parse(b.activeOperation?.updatedAt || b.state.lastTickAt || '') - Date.parse(a.activeOperation?.updatedAt || a.state.lastTickAt || ''));
  }).slice(0, 8) ?? [], [data]);
  const allEnabled = Boolean(data?.totals.projects && data.totals.enabled === data.totals.projects);
  async function configureAll(enabled: boolean) {
    setBusy(true);
    try { await api('/autopilot/portfolio/configure', { method: 'POST', body: JSON.stringify({ enabled }) }); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  async function configureProject(projectId: string, enabled: boolean) {
    setBusyProject(projectId);
    try { await api(`/projects/${projectId}/autopilot/configure`, { method: 'POST', body: JSON.stringify({ enabled }) }); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusyProject(null); }
  }
  return <div className="controlRoom">
    <header className="controlRoomHeader"><div><p className="eyebrow">AUTOPILOT CONTROL ROOM</p><h1>全サイトの自動操縦</h1><p>サイトごとの状態を横断して確認し、運転モードを一括で切り替えます。</p></div><div className="controlRoomActions"><span className="liveReadout"><span className="liveDot"/>5秒ごとに更新</span><button className="globalToggle" disabled={busy || !data} onClick={() => void configureAll(!allEnabled)}>{busy ? '切り替え中…' : allEnabled ? '全サイトを OFF' : '全サイトを ON'}</button></div></header>
    {error && <div className="error" role="alert">{error}</div>}
    {!data && !error && <div className="controlRoomLoading" role="status"><div className="loadingBar"/><div className="loadingBar short"/><div className="loadingBar"/></div>}
    {data && <>
      <section className="controlRoomSummary"><div><span>対象サイト</span><strong>{data.totals.projects}</strong><small>{data.totals.enabled}サイトがON</small></div><div><span>Agent実行中</span><strong className="accentNumber">{data.totals.executing}</strong><small>{data.totals.queued}件がキュー待ち</small></div><div><span>Agent接続</span><strong>{data.totals.connectedAgents}</strong><small>接続済みexecutor</small></div><div><span>要対応</span><strong className={data.totals.attention ? 'warningNumber' : ''}>{data.totals.attention}</strong><small>停止・エラー・境界</small></div><div className="schedulerSummary"><span>CONTROL PLANE</span><strong>{data.scheduler.enabled ? 'ONLINE' : 'OFFLINE'}</strong><small>{data.scheduler.intervalMinutes}分間隔で判定</small></div></section>
      <section className="controlRoomPanel flowPanel"><div className="controlRoomPanelHead"><div><p className="eyebrow">RUNWAY / LIVE</p><h2>いま全体で進んでいるフェーズ</h2><p className="panelLead">各サイトの現在地を同じ進行レールに並べています。数字はONのサイト数です。</p></div><span className="flowLiveMark"><span className="liveDot"/>自動更新中</span></div><div className="phaseRail" aria-label="Autopilotのフェーズ進行"><div className="phaseRailLine"/>{phases.map((phase, index) => <div className="phaseStep" key={phase.id}><div className={`phaseNode ${phaseCounts[phase.id] ? 'hasWork' : ''}`}><span>{String(index + 1).padStart(2, '0')}</span></div><b>{phase.label}</b><small>{phaseCounts[phase.id]}サイト · {phase.description}</small></div>)}</div><div className="phaseFoot"><span><i className="phaseLegend active"/>いま作業があるフェーズ</span><span><i className="phaseLegend quiet"/>まだ該当なし</span><span>対象 {data.totals.enabled} / {data.totals.projects}サイト</span></div><div className={`currentRun ${executingProject ? 'currentRunLive' : 'currentRunIdle'}`}>{executingProject ? <><span className="currentRunKicker">NOW EXECUTING</span><div><b>{executingProject.name}</b><strong>{taskLabel(executingProject)}</strong></div><span className="currentRunAgent">Agent {executingProject.executor?.id || 'executor'}</span></> : <><span className="currentRunKicker">NOW EXECUTING</span><div><b>現在、実行中のサイトはありません</b><strong>キューから順番にAgentが取得します</strong></div></>}</div></section>
      <section className="controlRoomPanel activeWorkPanel"><div className="controlRoomPanelHead"><div><p className="eyebrow">NOW / WORK QUEUE</p><h2>いま何をしているか</h2></div><span className="panelCount">{data.totals.activeOperations}件のOperation</span></div><div className="activeWorkGrid">{activeProjects.map(project => { const current = phaseIndex(effectiveStage(project)); const status = effectiveStatus(project); const currentBlocker = blocker(project); return <article className={`workCard ${project.executor?.connected ? 'workCardLive' : ''} ${status === 'blocked' ? 'workCardBlocked' : ''}`} key={project.id}><div className="workCardHeader"><div className="siteIdentity"><span className={`siteSignal ${tone(status, project.control.enabled)}`}/><div><b>{project.name}</b><small>{project.domain || 'テーマ起点'}</small></div></div><span className={`roomStatus ${tone(status, project.control.enabled)}`}>{stage[effectiveStage(project)] || effectiveStage(project)}</span></div><p className="workCardTask">{taskLabel(project)}</p>{currentBlocker && <p className="workCardBlocker"><b>停止理由</b>{currentBlocker}</p>}<div className="miniRail" aria-label={`${project.name}の進行状況`}>{phases.map((phase, index) => <span className={index < current ? 'done' : index === current ? 'current' : ''} key={phase.id}/>)}</div><div className="workCardMeta"><span>{project.executor?.connected ? `Agent ${project.executor.id} · このサイトを実行中` : status === 'blocked' ? '停止中 · 外部依存の復旧待ち' : project.activeOperation ? 'キュー待ち · Agent未割当' : effectiveStage(project) === 'queued_for_agent' ? 'Agent割当待ち' : '実行待機中'}</span><span>{time(project.activeOperation?.updatedAt || project.state.lastTickAt)}</span></div></article>; })}{!activeProjects.length && <div className="roomEmpty">現在進行中のOperationはありません。</div>}</div>{data.totals.activeOperations > activeProjects.length && <p className="workQueueNote">{data.totals.activeOperations - activeProjects.length}件はサイト別一覧で確認できます。</p>}</section>
      <section className="controlRoomPanel"><div className="controlRoomPanelHead"><div><p className="eyebrow">LIVE MAP</p><h2>サイト別の運転状況</h2></div><label>絞り込み<input aria-label="サイトを絞り込む" value={filter} onChange={e => setFilter(e.target.value)} placeholder="サイト名 / 状態" /></label></div><div className="siteMatrix" role="table" aria-label="サイト別Autopilot状況"><div className="siteMatrixRow siteMatrixHead" role="row"><span>サイト</span><span>運転</span><span>いま実行中</span><span>Agent</span><span>最終判定</span></div>{visible.map(project => { const status = effectiveStatus(project); const current = effectiveStage(project); const currentBlocker = blocker(project); return <div className="siteMatrixRow" role="row" key={project.id}><div className="siteIdentity"><span className={`siteSignal ${tone(status, project.control.enabled)}`}/><div><b>{project.name}</b><small>{project.domain || 'テーマ起点'}</small></div></div><div className="siteControlCell"><button className={`roomStatus siteToggle ${tone(status, project.control.enabled)}`} aria-label={`${project.name}の自動操縦を${project.control.enabled ? 'OFF' : 'ON'}にする`} disabled={busy || busyProject !== null} onClick={() => void configureProject(project.id, !project.control.enabled)}>{busyProject === project.id ? '更新中…' : project.control.enabled ? (stage[current] || current) : 'OFF'}</button><small>{project.control.enabled ? `次回 ${time(project.state.nextTickAt)}` : '自動操縦停止中'}</small></div><div className="operationCell">{project.activeOperation ? <><b>{taskLabel(project)}</b><small>{project.activeOperation.status} · {time(project.activeOperation.updatedAt)}</small>{currentBlocker && <em className="operationBlocker">停止理由：{currentBlocker}</em>}</> : <small>Operationなし</small>}</div><div>{project.executor?.connected ? <><span className="agentState online">ONLINE</span><small>{project.executor.id}</small></> : <><span className="agentState">OFFLINE</span><small>executor未接続</small></>}</div><div><b>{time(project.state.lastTickAt)}</b><small>{project.openReviews ? `${project.openReviews}件のレビュー待ち` : project.qualityQueue ? `${project.qualityQueue}件の品質判定` : project.lastEvent?.kind || 'イベントなし'}</small></div></div>; })}{!visible.length && <div className="roomEmpty">該当するサイトはありません。</div>}</div><p className="roomFootnote">各サイトの「運転」ボタンから個別に切り替えできます。最終更新 {time(data.generatedAt)} · Autopilot は品質ゲートと安全境界を守って動作します。</p></section>
      <section className="controlRoomLower"><div className="controlRoomPanel focusPanel"><div className="controlRoomPanelHead"><div><p className="eyebrow">FOCUS</p><h2>いま見るべきサイト</h2></div><span className="panelCount">{data.totals.attention} 要対応</span></div>{data.projects.filter(project => ['running', 'attention', 'blocked', 'error'].includes(effectiveStatus(project))).slice(0, 6).map(project => { const status = effectiveStatus(project); const current = effectiveStage(project); return <div className="focusRow" key={project.id}><span className={`siteSignal ${tone(status, project.control.enabled)}`}/><div><b>{project.name}</b><small>{taskLabel(project)}{blocker(project) ? ` · ${blocker(project)}` : ''}</small></div><span className={`roomStatus ${tone(status, project.control.enabled)}`}>{stage[current] || current}</span></div>; })}{!data.projects.some(project => ['running', 'attention', 'blocked', 'error'].includes(effectiveStatus(project))) && <p className="roomEmpty">全サイトが待機中です。必要条件が揃うと自動操縦が次の仕事を選びます。</p>}</div><div className="controlRoomPanel boundaryPanel"><div className="controlRoomPanelHead"><div><p className="eyebrow">BOUNDARY</p><h2>自動化の境界</h2></div></div><p>通常の調査・計画・品質判定・Blog搬送はexecutorが自動で進めます。</p><div className="boundaryList"><span><b>自動</b>証拠収集と計測</span><span><b>自動</b>ページ企画と品質ゲート</span><span><b>停止</b>削除・DNS・policy有効化</span><span><b>通知</b>具体的な人間判断が必要な時</span></div></div></section>
    </>}
  </div>;
}
