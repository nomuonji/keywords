import { FormEvent, useEffect, useState } from 'react';
import { api } from './api';

type OperatorState = { next: { kind: string; title?: string; reason?: string }; candidates: Array<{ kind: string; title?: string; reason?: string }> };
type LivePage = { id: string; title: string; url: string | null; status: string; lastSeenAt: string | null };
type MetricContext = {
  positionDrops: Array<{ query: string; positionDelta: number; impressionDelta: number; latest: { position: number; clicks: number; endDate: string }; previous: { position: number; clicks: number; endDate: string } }>;
  clickDrops: Array<{ query: string; clickDelta: number; latest: { clicks: number; endDate: string }; previous: { clicks: number; endDate: string } }>;
  pageClickDrops: Array<{ url: string; clickDelta: number; latest: { clicks: number; endDate: string }; previous: { clicks: number; endDate: string } }>;
  querySnapshots: number;
  pageSnapshots: number;
};

type Props = { projectId: string; onChanged?: () => void | Promise<void> };

export function SeoOperations({ projectId, onChanged }: Props) {
  const [operator, setOperator] = useState<OperatorState | null>(null);
  const [pages, setPages] = useState<LivePage[]>([]);
  const [metrics, setMetrics] = useState<MetricContext | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = async () => {
    if (!projectId) return;
    try {
      const [o, p, m] = await Promise.all([
        api<OperatorState>(`/projects/${projectId}/operator`),
        api<LivePage[]>(`/projects/${projectId}/site`),
        api<MetricContext>(`/projects/${projectId}/metrics/context?limit=8`)
      ]);
      setOperator(o); setPages(p); setMetrics(m); setError('');
    } catch (e) { setError(String(e)); }
  };

  useEffect(() => { void load(); }, [projectId]);

  async function refreshAfterChange() {
    await Promise.all([load(), Promise.resolve(onChanged?.())]);
  }

  async function tick() {
    try { setBusy('operator'); await api(`/projects/${projectId}/operator/tick`, { method: 'POST', body: '{}' }); await refreshAfterChange(); }
    catch (e) { setError(String(e)); } finally { setBusy(''); }
  }

  async function syncSite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      setBusy('site');
      await api(`/projects/${projectId}/site/sync`, { method: 'POST', body: JSON.stringify({ sitemapUrl: f.get('sitemap') || undefined }) });
      await refreshAfterChange();
    } catch (e) { setError(String(e)); } finally { setBusy(''); }
  }

  async function capture(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      setBusy('metrics');
      await api(`/projects/${projectId}/metrics/capture`, { method: 'POST', body: JSON.stringify({ startDate: f.get('startDate'), endDate: f.get('endDate'), siteUrl: f.get('siteUrl') || undefined }) });
      await refreshAfterChange();
    } catch (e) { setError(String(e)); } finally { setBusy(''); }
  }

  return <section className="panel policyPanel">
    <div className="panelHead"><div><p className="eyebrow">SEO OPERATIONS</p><h2>Operator · site · trends</h2></div><span>{pages.length} live URLs</span></div>
    {error&&<div className="error">{error}</div>}
    <div className="policyList">
      <div className="policyRule activePolicy"><div><span className="sourceType">operator</span><b>{operator?.next.title ?? operator?.next.kind ?? 'No action'}</b><small>{operator?.next.reason ?? 'No prioritized operator action.'}</small></div><div className="pageActions"><button disabled={busy==='operator'} onClick={()=>void tick()}>{busy==='operator'?'Running…':'Choose next task'}</button></div></div>
      <div className="policyRule"><div><span className="sourceType">live site</span><b>{pages.length} imported URLs</b><small>{pages[0]?.lastSeenAt ? `Last seen ${new Date(pages[0].lastSeenAt).toLocaleString()}` : 'Sync sitemap to import the real site.'}</small></div><form className="pageActions" onSubmit={syncSite}><input name="sitemap" placeholder="sitemap URL (optional)"/><button disabled={busy==='site'}>{busy==='site'?'Syncing…':'Sync'}</button></form></div>
      <div className="policyRule"><div><span className="sourceType">gsc history</span><b>{metrics?.querySnapshots ?? 0} query · {metrics?.pageSnapshots ?? 0} page snapshots</b><small>{metrics?.positionDrops.length ?? 0} position drops · {metrics?.clickDrops.length ?? 0} query click drops · {metrics?.pageClickDrops.length ?? 0} page click drops</small></div><form className="pageActions" onSubmit={capture}><input name="startDate" type="date" required/><input name="endDate" type="date" required/><input name="siteUrl" placeholder="GSC site (optional)"/><button disabled={busy==='metrics'}>{busy==='metrics'?'Capturing…':'Capture'}</button></form></div>
    </div>
    <div className="sourceList" style={{marginTop:12}}>{metrics?.positionDrops.slice(0,4).map(row=><div className="source" key={row.query}><span className="sourceType">position ↓</span><div><b>{row.query}</b><small>{row.previous.position.toFixed(1)} → {row.latest.position.toFixed(1)} · clicks {row.previous.clicks} → {row.latest.clicks}</small></div></div>)}{!metrics?.positionDrops.length&&<div className="hint">No material query position decline detected across the latest two captured periods.</div>}</div>
  </section>;
}
