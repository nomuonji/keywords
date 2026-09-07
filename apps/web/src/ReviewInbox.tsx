import { useEffect, useState } from 'react';
import { api } from './api';
import './review.css';

type ReviewRequest = {
  id: string;
  workSessionId: string | null;
  targetType: string;
  targetId: string | null;
  title: string;
  question: string | null;
  options: string[];
  status: string;
  requestedBy: string;
  createdAt: string;
};

const when = (value: string) => new Date(value).toLocaleString();

export function ReviewInbox({ projectId }: { projectId: string }) {
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [error, setError] = useState('');
  const load = async () => {
    if (!projectId) return;
    try {
      setRequests(await api<ReviewRequest[]>(`/projects/${projectId}/review-requests?status=open&limit=20`));
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const poll = async () => {
      try {
        const rows = await api<ReviewRequest[]>(`/projects/${projectId}/review-requests?status=open&limit=20`);
        if (alive) { setRequests(rows); setError(''); }
      } catch (e) {
        if (alive) setError(String(e));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 4000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [projectId]);

  async function resolve(request: ReviewRequest, resolution: string) {
    try {
      let reason: string | undefined;
      if (resolution === 'rejected' || resolution === 'needs_edit') {
        reason = window.prompt(resolution === 'rejected' ? 'Why reject this request?' : 'What should be edited?') ?? undefined;
        if (!reason) return;
      }
      await api(`/projects/${projectId}/review-requests/${request.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolution, reason })
      });
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  return <section className="panel reviewInbox">
    <div className="panelHead"><div><p className="eyebrow">HUMAN REVIEW INBOX</p><h2>Agent needs a decision</h2></div><span>{requests.length} open</span></div>
    {error&&<div className="hint">{error}</div>}
    <div className="reviewList">{requests.map(request=><div className="reviewCard" key={request.id}>
      <div><span className="sourceType">{request.targetType}</span><b>{request.title}</b>{request.question&&<p>{request.question}</p>}<small>{request.requestedBy} · {when(request.createdAt)}</small></div>
      <div className="reviewActions">{request.options.map(option=><button className={option==='approved'||option==='active'?'primaryReview':''} key={option} onClick={()=>void resolve(request,option)}>{option.replace('_',' ')}</button>)}</div>
    </div>)}{!requests.length&&!error&&<div className="hint">No explicit review requests. Agents can pause a work session with review_request when a human decision is required.</div>}</div>
  </section>;
}
