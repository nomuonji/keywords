import { useEffect, useState } from 'react';
import type { ProjectSettings, ProjectSummary } from '../../types';
import { DEFAULT_PROJECT_SETTINGS } from '../../constants/settings';

export interface ProjectFormData {
  id: string;
  name: string;
  domain?: string;
  halt?: boolean;
}

interface ProjectFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialProject?: ProjectSummary;
  onClose: () => void;
  onSubmit: (data: ProjectFormData & { settings?: ProjectSettings }) => Promise<void>;
}

export function ProjectFormModal({
  open,
  mode,
  initialProject,
  onClose,
  onSubmit
}: ProjectFormModalProps) {
  const [form, setForm] = useState<ProjectFormData>({
    id: '',
    name: '',
    domain: '',
    halt: false
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setForm({
        id: '',
        name: '',
        domain: '',
        halt: false
      });
      setSaving(false);
      setError(null);
      return;
    }
    if (mode === 'edit' && initialProject) {
      setForm({
        id: initialProject.id,
        name: initialProject.name,
        domain: initialProject.domain ?? '',
        halt: initialProject.halt ?? false
      });
    } else {
      setForm({
        id: '',
        name: '',
        domain: '',
        halt: false
      });
    }
  }, [open, mode, initialProject]);

  if (!open) return null;

  const handleChange =
    (field: keyof ProjectFormData) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value =
        field === 'halt' ? (event.target as HTMLInputElement).checked : event.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
    };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.id.trim()) {
      setError('プロジェクトIDを入力してください');
      return;
    }
    if (!form.name.trim()) {
      setError('プロジェクト名を入力してください');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: ProjectFormData & { settings?: ProjectSettings } = {
        ...form,
        id: form.id.trim(),
        name: form.name.trim(),
        domain: form.domain?.trim() || undefined
      };
      if (mode === 'create') {
        payload.settings = DEFAULT_PROJECT_SETTINGS;
      }
      await onSubmit(payload);
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
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-6">
          <header>
            <h3 className="text-lg font-semibold text-slate-900">
              {mode === 'create' ? 'プロジェクト作成' : 'プロジェクト編集'}
            </h3>
            <p className="text-xs text-slate-500">
              Firestore に保存されるプロジェクト情報を入力してください。
            </p>
          </header>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="project-id">
              プロジェクトID
            </label>
            <input
              id="project-id"
              type="text"
              value={form.id}
              onChange={handleChange('id')}
              disabled={mode === 'edit'}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-slate-100"
              placeholder="例: english-blog"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="project-name">
              プロジェクト名
            </label>
            <input
              id="project-name"
              type="text"
              value={form.name}
              onChange={handleChange('name')}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="例: 英語学習ブログ"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700" htmlFor="project-domain">
              ドメイン（任意）
            </label>
            <input
              id="project-domain"
              type="text"
              value={form.domain ?? ''}
              onChange={handleChange('domain')}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="example.com"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.halt ?? false}
              onChange={handleChange('halt')}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/40"
            />
            自動処理を停止する（halt）
          </label>
          {mode === 'create' ? (
            <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-500">
              作成時は既定のパイプライン設定（staleDays など）が自動で登録されます。作成後に詳細を編集できます。
            </p>
          ) : null}
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
