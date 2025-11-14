import { useEffect, useState } from 'react';
import { MdExpandLess, MdExpandMore } from 'react-icons/md';
import type { ProjectSettings, NodeDocWithId } from '../../types';
import { SuggestionModal } from '../common/SuggestionModal';
import { suggestNodes, suggestNodesGrok } from '../../lib/api';
import { firestore } from '../../lib/firebase';
import { writeBatch, doc, collection } from 'firebase/firestore';

interface ThemeSettingsPanelProps {
  projectId: string;
  projectDescription: string;
  themeId: string;
  nodes: NodeDocWithId[];
  projectDefaults: ProjectSettings;
  themeSettings?: Partial<ProjectSettings>;
  onSave: (settings: Partial<ProjectSettings>) => void;
  themeName?: string;
}

export function ThemeSettingsPanel({
  projectId,
  projectDescription,
  themeId,
  nodes,
  projectDefaults,
  themeSettings,
  onSave,
  themeName
}: ThemeSettingsPanelProps) {
  const [draft, setDraft] = useState<Partial<ProjectSettings>>(themeSettings ?? {});
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    setDraft(themeSettings ?? {});
  }, [themeSettings]);

  const handleSuggestNodes = (suggester: typeof suggestNodes | typeof suggestNodesGrok) => async () => {
    if (!themeName) return;
    setModalOpen(true);
    setLoading(true);
    try {
      const existingNodes = nodes.map((n) => n.title);
      const result = await suggester(
        projectId,
        themeId,
        themeName,
        existingNodes,
        projectDescription
      );
      setSuggestions(result);
    } catch (error) {
      console.error('Failed to suggest nodes', error);
      // TODO: Show toast
    } finally {
      setLoading(false);
    }
  };

  const handleAddNodes = async (selected: string[]) => {
    const batch = writeBatch(firestore);
    const nodesRef = collection(firestore, `projects/${projectId}/themes/${themeId}/nodes`);
    selected.forEach((nodeTitle) => {
      const newNodeRef = doc(nodesRef);
      batch.set(newNodeRef, {
        title: nodeTitle,
        status: 'ready',
        intent: 'info', // Or derive from somewhere?
        depth: 0,
        updatedAt: new Date().toISOString(),
      });
    });
    await batch.commit();
    setModalOpen(false);
  };

  const handlePartialChange =
    (path: string[]) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      setDraft((prev) => updatePartial(prev, path, value));
    };

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            テーマ設定 {themeName ? `（${themeName}）` : ''}
          </h3>
          <p className="text-xs text-slate-500">
            空欄の項目はプロジェクト共通設定が適用されます。必要に応じて上書きしてください。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSuggestNodes(suggestNodes)}
            disabled={!themeName}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 shadow-sm transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Geminiにtopic案を提案させる
          </button>
          <button
            type="button"
            onClick={handleSuggestNodes(suggestNodesGrok)}
            disabled={!themeName}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 shadow-sm transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Grokにtopic案を提案させる
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-300 p-2 text-slate-500 transition hover:bg-slate-100"
            onClick={() => setOpen((prev) => !prev)}
            aria-label="テーマ設定パネルの開閉"
          >
            {open ? <MdExpandLess size={18} /> : <MdExpandMore size={18} />}
          </button>
        </div>
      </header>
      {open ? (
        <>
          <div className="grid gap-4 border-t border-slate-200 px-5 py-5 md:grid-cols-2">
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-slate-700">パイプライン</legend>
              <NumberInputWithFallback
                label="staleDays"
                value={draft.pipeline?.staleDays}
                fallback={projectDefaults.pipeline.staleDays}
                min={1}
                onChange={handlePartialChange(['pipeline', 'staleDays'])}
              />
              <NumberInputWithFallback
                label="nodesPerRun"
                value={draft.pipeline?.limits?.nodesPerRun}
                fallback={projectDefaults.pipeline.limits.nodesPerRun}
                min={1}
                onChange={handlePartialChange(['pipeline', 'limits', 'nodesPerRun'])}
              />
              <NumberInputWithFallback
                label="ideasPerNode"
                value={draft.pipeline?.limits?.ideasPerNode}
                fallback={projectDefaults.pipeline.limits.ideasPerNode}
                min={10}
                step={10}
                onChange={handlePartialChange(['pipeline', 'limits', 'ideasPerNode'])}
              />
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-slate-700">しきい値・リンク</legend>
              <NumberInputWithFallback
                label="minVolume"
                value={draft.thresholds?.minVolume}
                fallback={projectDefaults.thresholds.minVolume}
                min={0}
                onChange={handlePartialChange(['thresholds', 'minVolume'])}
              />
              <NumberInputWithFallback
                label="maxCompetition"
                value={draft.thresholds?.maxCompetition}
                fallback={projectDefaults.thresholds.maxCompetition}
                min={0}
                max={1}
                step={0.05}
                onChange={handlePartialChange(['thresholds', 'maxCompetition'])}
              />
              <NumberInputWithFallback
                label="links.maxPerGroup"
                value={draft.links?.maxPerGroup}
                fallback={projectDefaults.links.maxPerGroup}
                min={1}
                onChange={handlePartialChange(['links', 'maxPerGroup'])}
              />
            </fieldset>
          </div>
          <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
            <button
              type="button"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-100"
              onClick={() => setDraft({})}
            >
              上書きをリセット
            </button>
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow hover:bg-primary/90"
              onClick={() => onSave(draft)}
            >
              保存
            </button>
          </footer>
        </>
      ) : null}
      <SuggestionModal
        open={modalOpen}
        title="AIによるTopic提案"
        suggestions={suggestions}
        loading={loading}
        onClose={() => setModalOpen(false)}
        onAdd={handleAddNodes}
      />
    </section>
  );
}

function NumberInputWithFallback({
  label,
  value,
  fallback,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  value?: number;
  fallback: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      <span>
        {label}
        <span className="ml-2 rounded bg-slate-100 px-1 text-[10px] text-slate-500">
          既定値: {fallback}
        </span>
      </span>
      <input
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        placeholder={fallback.toString()}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}

function updatePartial(
  source: Partial<ProjectSettings>,
  path: string[],
  value: number
): Partial<ProjectSettings> {
  const updated = structuredClone(source) as Partial<ProjectSettings>;
  let current: any = updated;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (!current[key]) current[key] = {};
    current = current[key];
  }
  current[path[path.length - 1]] = Number.isNaN(value) ? undefined : value;
  return updated;
}
