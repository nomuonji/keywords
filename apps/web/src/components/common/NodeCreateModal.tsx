import { useState } from 'react';
import { MdClose, MdSave } from 'react-icons/md';
import type { Intent } from '../../types';

interface NodeCreateModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (payload: { title: string; intent: Intent; depth: number }) => void;
}

export function NodeCreateModal({ open, onClose, onSave }: NodeCreateModalProps) {
  const [title, setTitle] = useState('');
  const [intent, setIntent] = useState<Intent>('info');
  const [depth, setDepth] = useState(0);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-900">カテゴリ拡張（ノード追加）</h3>
          <button
            type="button"
            className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            aria-label="閉じる"
          >
            <MdClose size={20} />
          </button>
        </header>
        <form
          className="space-y-4 px-6 py-5"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({ title, intent, depth });
            setTitle('');
            setIntent('info');
            setDepth(0);
          }}
        >
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="node-title">
              ノードタイトル
            </label>
            <input
              id="node-title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="例：英会話　電話対応"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-slate-700" htmlFor="node-intent">
                想定検索意図
              </label>
              <select
                id="node-intent"
                value={intent}
                onChange={(event) => setIntent(event.target.value as Intent)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="info">情報（Info）</option>
                <option value="trans">取引（Transactional）</option>
                <option value="local">ローカル（Local）</option>
                <option value="mixed">複合（Mixed）</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-slate-700" htmlFor="node-depth">
                階層深度
              </label>
              <input
                id="node-depth"
                type="number"
                min={0}
                max={5}
                value={depth}
                onChange={(event) => setDepth(Number(event.target.value))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
          <footer className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-100"
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow hover:bg-primary/90"
            >
              <MdSave />
              追加
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
