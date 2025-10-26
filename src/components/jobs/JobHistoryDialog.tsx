import { MdClose, MdSchedule } from 'react-icons/md';
import type { JobHistoryItem } from '../../types';

interface JobHistoryDialogProps {
  open: boolean;
  jobs: JobHistoryItem[];
  onClose: () => void;
}

export function JobHistoryDialog({ open, jobs, onClose }: JobHistoryDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <MdSchedule className="text-primary" />
            <h3 className="text-lg font-semibold text-slate-900">ジョブ履歴</h3>
          </div>
          <button
            type="button"
            className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            aria-label="閉じる"
          >
            <MdClose size={20} />
          </button>
        </header>
        <section className="max-h-[70vh] overflow-y-auto px-6 py-4">
          <ul className="space-y-4">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="rounded-lg border border-slate-200 p-4 shadow-sm transition hover:border-primary hover:shadow-md"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {job.type === 'daily' ? '定期実行' : '手動実行'}（{job.id}）
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(job.startedAt).toLocaleString('ja-JP', {
                        timeZone: 'Asia/Tokyo'
                      })}
                      {' 〜 '}
                      {new Date(job.finishedAt).toLocaleString('ja-JP', {
                        timeZone: 'Asia/Tokyo'
                      })}
                    </p>
                  </div>
                  <StatusBadge status={job.status} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-600 md:grid-cols-3">
                  <Metric label="ノード" value={job.summary.nodesProcessed} />
                  <Metric label="新規KW" value={job.summary.newKeywords} />
                  <Metric label="グループ作成" value={job.summary.groupsCreated} />
                  <Metric label="グループ更新" value={job.summary.groupsUpdated} />
                  <Metric label="アウトライン" value={job.summary.outlinesCreated} />
                  <Metric label="リンク更新" value={job.summary.linksUpdated} />
                </dl>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: JobHistoryItem['status'] }) {
  const { label, className } = (() => {
    switch (status) {
      case 'succeeded':
        return { label: '成功', className: 'bg-success/10 text-success' };
      case 'failed':
        return { label: '失敗', className: 'bg-danger/10 text-danger' };
      case 'running':
        return { label: '実行中', className: 'bg-warning/10 text-warning' };
      case 'skipped':
        return { label: 'スキップ', className: 'bg-slate-200 text-slate-500' };
      default:
        return { label: status, className: 'bg-slate-200 text-slate-500' };
    }
  })();
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs ${className}`}>
      {label}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-base font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
