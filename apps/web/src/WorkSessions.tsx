import { useEffect, useState } from 'react';
import { api } from './api';

type WorkSession = {
  id: string;
  status: string;
  objective: string;
  maxActions: number;
  remainingActions: number;
  usage: { actions: number; succeeded: number; failed: number };
  summary: string | null;
  lastNextAction: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  completionCriteria: string[];
  checkpoints: Array<{ id: string; state: string; summary: string; nextAction: string | null; createdAt: string }>;
};

const when = (value: string) => new Date(value).toLocaleString();

export function WorkSessions({ projectId }: { projectId: string }) {
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const load = async () => {
      try {
        const rows = await api<WorkSession[]>(`/projects/${projectId}/work/sessions?limit=8`);
        if (alive) { setSessions(rows); setError(''); }
      } catch (e) {
        if (alive) setError(String(e));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [projectId]);

  return <section className="panel workPanel">
    <div className="panelHead"><div><p className="eyebrow">AGENT WORK LOOP</p><h2>Work sessions</h2></div><span>{sessions.filter(s=>!['completed','cancelled'].includes(s.status)).length} open</span></div>
    {error&&<div className="hint">{error}</div>}
    <div className="workSessionList">{sessions.map(session=>{
      const checkpoint=session.checkpoints[0];
      const pct=Math.round((session.usage.actions/Math.max(1,session.maxActions))*100);
      return <div className="workSession" key={session.id}>
        <div className="workSessionTop"><span className={`status ${session.status}`}>{session.status.replace('_',' ')}</span><small>{session.usage.actions}/{session.maxActions} actions · {session.remainingActions} left</small></div>
        <b>{session.objective}</b>
        <div className="workMeter"><span style={{width:`${Math.min(100,pct)}%`}}/></div>
        {checkpoint&&<p>{checkpoint.summary}</p>}
        {checkpoint?.nextAction&&<small>Next: {checkpoint.nextAction}</small>}
        {!checkpoint&&session.summary&&<p>{session.summary}</p>}
        <small>{when(session.updatedAt)} · {session.usage.failed?`${session.usage.failed} failed commands`:'no command failures'}</small>
      </div>;
    })}{!sessions.length&&!error&&<div className="hint">No work sessions yet. An MCP agent can start one with work_start.</div>}</div>
  </section>;
}
