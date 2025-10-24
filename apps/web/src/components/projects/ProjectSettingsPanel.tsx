import { useState } from 'react';
import { MdExpandLess, MdExpandMore } from 'react-icons/md';
import type { ProjectSettings } from '../../types';
import { SuggestionModal } from '../common/SuggestionModal';
import { suggestThemes } from '../../lib/api';
import { firestore } from '../../lib/firebase';
import { writeBatch, doc, collection } from 'firebase/firestore';

interface ProjectSettingsPanelProps {
  projectId: string;
  description: string;
  settings: ProjectSettings;
  onSave: (settings: ProjectSettings) => void;
}

export function ProjectSettingsPanel({ projectId, description, settings, onSave }: ProjectSettingsPanelProps) {
  const [draft, setDraft] = useState<ProjectSettings>(settings);
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const handleSuggestThemes = async () => {
    setModalOpen(true);
    setLoading(true);
    try {
      const result = await suggestThemes(projectId, description);
      setSuggestions(result);
    } catch (error) {
      console.error('Failed to suggest themes', error);
      // TODO: Show toast
    } finally {
      setLoading(false);
    }
  };

  const handleAddThemes = async (selected: string[]) => {
    const batch = writeBatch(firestore);
    const themesRef = collection(firestore, `projects/${projectId}/themes`);
    selected.forEach((themeName) => {
      const themeId = themeName.toLowerCase().replace(/\s+/g, '-');
      const newThemeRef = doc(themesRef, themeId);
      batch.set(newThemeRef, {
        name: themeName,
        autoUpdate: false,
        pendingNodes: 0,
        updatedAt: new Date().toISOString(),
      });
    });
    await batch.commit();
    setModalOpen(false);
  };



  const handleNumberChange =
    (path: string[]) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      setDraft((prev) => updateNestedNumber(prev, path, value));
    };

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">プロジェクト設定</h3>
          <p className="text-xs text-slate-500">
            パイプラインの上限やスコア重みをここで調整できます。保存すると即座に反映されます。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSuggestThemes}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 shadow-sm transition hover:border-primary hover:text-primary"
          >
            Geminiにテーマ案を提案させる
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-300 p-2 text-slate-500 transition hover:bg-slate-100"
            onClick={() => setOpen((prev) => !prev)}
            aria-label="プロジェクト設定パネルの開閉"
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
              <NumberInput
                label="staleDays"
                value={draft.pipeline.staleDays}
                min={1}
                onChange={handleNumberChange(['pipeline', 'staleDays'])}
              />
              <NumberInput
                label="nodesPerRun"
                value={draft.pipeline.limits.nodesPerRun}
                min={1}
                onChange={handleNumberChange(['pipeline', 'limits', 'nodesPerRun'])}
              />
              <NumberInput
                label="ideasPerNode"
                value={draft.pipeline.limits.ideasPerNode}
                min={10}
                step={10}
                onChange={handleNumberChange(['pipeline', 'limits', 'ideasPerNode'])}
              />
              <NumberInput
                label="groupsOutlinePerRun"
                value={draft.pipeline.limits.groupsOutlinePerRun}
                min={1}
                onChange={handleNumberChange(['pipeline', 'limits', 'groupsOutlinePerRun'])}
              />
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-slate-700">しきい値 / リンク</legend>
              <NumberInput
                label="minVolume"
                value={draft.thresholds.minVolume}
                min={0}
                onChange={handleNumberChange(['thresholds', 'minVolume'])}
              />
              <NumberInput
                label="maxCompetition"
                value={draft.thresholds.maxCompetition}
                min={0}
                max={1}
                step={0.05}
                onChange={handleNumberChange(['thresholds', 'maxCompetition'])}
              />
              <NumberInput
                label="links.maxPerGroup"
                value={draft.links.maxPerGroup}
                min={1}
                onChange={handleNumberChange(['links', 'maxPerGroup'])}
              />
            </fieldset>
            <fieldset className="md:col-span-2">
              <legend className="text-sm font-semibold text-slate-700">スコア重み</legend>
              <div className="grid gap-3 md:grid-cols-4">
                <NumberInput
                  label="volume"
                  value={draft.weights.volume}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={handleNumberChange(['weights', 'volume'])}
                />
                <NumberInput
                  label="competition"
                  value={draft.weights.competition}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={handleNumberChange(['weights', 'competition'])}
                />
                <NumberInput
                  label="intent"
                  value={draft.weights.intent}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={handleNumberChange(['weights', 'intent'])}
                />
                <NumberInput
                  label="novelty"
                  value={draft.weights.novelty}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={handleNumberChange(['weights', 'novelty'])}
                />
              </div>
            </fieldset>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
            <button
              type="button"
              onClick={() => onSave(draft)}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow hover:bg-primary/90"
            >
              保存
            </button>
          </div>
        </>
      ) : null}
      <SuggestionModal
        open={modalOpen}
        title="Geminiによるテーマ提案"
        suggestions={suggestions}
        loading={loading}
        onClose={() => setModalOpen(false)}
        onAdd={handleAddThemes}
      />
    </section>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}

function updateNestedNumber(
  settings: ProjectSettings,
  path: string[],
  value: number
): ProjectSettings {
  const updated = structuredClone(settings);
  let current: any = updated;
  for (let i = 0; i < path.length - 1; i += 1) {
    current = current[path[i]];
  }
  current[path[path.length - 1]] = value;
  return updated;
}
