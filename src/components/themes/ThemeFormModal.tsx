import { useEffect, useState } from 'react';
import type { ThemeSummary } from '../../types';

export interface ThemeFormData {
  id: string;
  name: string;
  autoUpdate: boolean;
}

interface ThemeFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialTheme?: ThemeSummary;
  onClose: () => void;
  onSubmit: (data: ThemeFormData) => Promise<void>;
}

export function ThemeFormModal({
  open,
  mode,
  initialTheme,
  onClose,
  onSubmit
}: ThemeFormModalProps) {
  const [form, setForm] = useState<ThemeFormData>({
    id: '',
    name: '',
    autoUpdate: true
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setForm({
        id: '',
        name: '',
        autoUpdate: true
      });
      setSaving(false);
      setError(null);
      return;
    }
    if (mode === 'edit' && initialTheme) {
      setForm({
        id: initialTheme.id,
        name: initialTheme.name,
        autoUpdate: initialTheme.autoUpdate
      });
    } else {
      setForm({
        id: '',
        name: '',
        autoUpdate: true
      });
    }
  }, [open, mode, initialTheme]);

  if (!open) return null;

  const handleChange =
    (field: keyof ThemeFormData) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value =
        field === 'autoUpdate' ? (event.target as HTMLInputElement).checked : event.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
    };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.id.trim()) {
      setError('テーマIDを入力してください');
      return;
    }
    if (!form.name.trim()) {
      setError('テーマ名を入力してください');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        id: form.id.trim(),
        name: form.name.trim(),
        autoUpdate: form.autoUpdate
      });
      onClose();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error && err.message ? err.message : '保存中にエラーが発生しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-6">
          <header>
            <h3 className="text-lg font-semibold text-slate-900">
              {mode === 'create' ? 'テーマ作成' : 'テーマ編集'}
            </h3>
            <p className="text-xs text-slate-500">
              テーマ名と更新設定を入力してください。作成するとプロジェクト配下にテーマが追加されます。
            </p>
          </header>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="theme-id">
              テーマID
            </label>
            <input
              id="theme-id"
              type="text"
              value={form.id}
              onChange={handleChange('id')}
              disabled={mode === 'edit'}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-slate-100"
              placeholder="例: conversation"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="theme-name">
              テーマ名
            </label>
            <input
              id="theme-name"
              type="text"
              value={form.name}
              onChange={handleChange('name')}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="例: 英会話"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.autoUpdate}
              onChange={handleChange('autoUpdate')}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/40"
            />
            自動更新対象に含める
          </label>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
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
              disabled={saving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
