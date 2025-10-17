import { useMemo } from 'react';
import type { NodeDocWithId } from '../../types';

interface NodeListProps {
  nodes: NodeDocWithId[];
  onAddNode: () => void;
  onDeleteNode?: (nodeId: string) => void;
  onUpdateNodeStatus?: (nodeId: string, status: NodeDocWithId['status']) => void;
}

const NODE_STATUSES: NodeDocWithId['status'][] = ['ready', 'ideas-pending', 'ideas-done'];

export function NodeList({
  nodes,
  onAddNode,
  onDeleteNode,
  onUpdateNodeStatus
}: NodeListProps) {
  const statusOptions = useMemo(
    () =>
      NODE_STATUSES.map((status) => ({
        value: status,
        label:
          status === 'ready'
            ? 'Ready'
            : status === 'ideas-pending'
            ? 'Ideas Pending'
            : 'Ideas Done'
      })),
    []
  );

  if (!nodes.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
        No nodes yet. Use the expand button to seed keywords.
        <div className="mt-4">
          <button
            type="button"
            className="rounded-md border border-primary px-4 py-2 text-sm text-primary transition hover:bg-primary/10"
            onClick={onAddNode}
          >
            Add Node
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Node List</h3>
          <p className="text-xs text-slate-500">
            Seed topics that drive keyword discovery for this theme.
          </p>
        </div>
        <button
          type="button"
          className="rounded-md border border-primary px-3 py-1 text-xs text-primary transition hover:bg-primary/10"
          onClick={onAddNode}
        >
          Add Node
        </button>
      </header>
      <ul className="divide-y divide-slate-200">
        {nodes.map((node) => (
          <li
            key={node.id}
            className="flex flex-col gap-2 px-4 py-3 text-sm text-slate-700 md:flex-row md:items-center md:justify-between"
          >
            <div>
              <p className="font-medium text-slate-900">{node.title}</p>
              <p className="text-xs text-slate-500">Intent: {node.intent}</p>
            </div>
            <div className="flex flex-col items-start gap-2 text-xs text-slate-500 md:flex-row md:items-center md:gap-4">
              <label className="flex items-center gap-2">
                <span className="text-slate-600">Status:</span>
                <select
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-primary focus:outline-none"
                  value={node.status}
                  onChange={(event) =>
                    onUpdateNodeStatus?.(node.id, event.target.value as NodeDocWithId['status'])
                  }
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <span>
                Updated:{' '}
                {node.updatedAt
                  ? new Date(node.updatedAt).toLocaleString('ja-JP', {
                      timeZone: 'Asia/Tokyo'
                    })
                  : 'N/A'}
              </span>
              {onDeleteNode && (
                <button
                  type="button"
                  className="rounded-md border border-danger/40 px-3 py-1 text-xs text-danger transition hover:bg-danger/10"
                  onClick={() => onDeleteNode(node.id)}
                >
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
