import { useEffect, useState } from 'react';
import { MdExpandLess, MdExpandMore } from 'react-icons/md';
import type { ProjectSettings } from '../../types';

interface ThemeSettingsPanelProps {
  projectDefaults: ProjectSettings;
  themeSettings?: Partial<ProjectSettings>;
  onSave: (settings: Partial<ProjectSettings>) => void;
  themeName?: string;
}

export function ThemeSettingsPanel({
  projectDefaults,
  themeSettings,
  onSave,
  themeName
}: ThemeSettingsPanelProps) {
  const [draft, setDraft] = useState<Partial<ProjectSettings>>(themeSettings ?? {});
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setDraft(themeSettings ?? {});
  }, [themeSettings]);

  const merged = mergeSettings(projectDefaults, draft);

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
        <button
          type="button"
          className="rounded-full border border-slate-300 p-2 text-slate-500 transition hover:bg-slate-100"
          onClick={() => setOpen((prev) => !prev)}
          aria-label="テーマ設定パネルの開閉"
        >
          {open ? <MdExpandLess size={18} /> : <MdExpandMore size={18} />}
        </button>
      </header>
      {open ? (
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
      ) : null}
      {open ? (
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
      ) : null}
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

function mergeSettings(base: ProjectSettings, overrides: Partial<ProjectSettings>): ProjectSettings {
  return {
    pipeline: {
      staleDays: overrides.pipeline?.staleDays ?? base.pipeline.staleDays,
      limits: {
        nodesPerRun: overrides.pipeline?.limits?.nodesPerRun ?? base.pipeline.limits.nodesPerRun,
        ideasPerNode: overrides.pipeline?.limits?.ideasPerNode ?? base.pipeline.limits.ideasPerNode,
        groupsOutlinePerRun:
          overrides.pipeline?.limits?.groupsOutlinePerRun ?? base.pipeline.limits.groupsOutlinePerRun
      }
    },
    thresholds: {
      minVolume: overrides.thresholds?.minVolume ?? base.thresholds.minVolume,
      maxCompetition: overrides.thresholds?.maxCompetition ?? base.thresholds.maxCompetition
    },
    weights: {
      volume: overrides.weights?.volume ?? base.weights.volume,
      competition: overrides.weights?.competition ?? base.weights.competition,
      intent: overrides.weights?.intent ?? base.weights.intent,
      novelty: overrides.weights?.novelty ?? base.weights.novelty
    },
    links: {
      maxPerGroup: overrides.links?.maxPerGroup ?? base.links.maxPerGroup
    }
  };
}
