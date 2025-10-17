import {
  MdBolt,
  MdEdit,
  MdHourglassEmpty,
  MdOutlineAutoFixHigh,
  MdOutlineAddCircle,
  MdOutlineCalendarToday,
  MdOutlinePlayArrow
} from 'react-icons/md';
import type { ThemeSummary } from '../../types';

interface ThemeTableProps {
  themes: ThemeSummary[];
  selectedThemeId?: string;
  onSelect: (themeId: string) => void;
  onExpandCategory: (themeId: string) => void;
  onRunTheme: (themeId: string) => void;
  onRunOutline: (themeId: string) => void;
  onEditTheme: (theme: ThemeSummary) => void;
  runningThemeIds?: Set<string>;
  runningOutlineIds?: Set<string>;
  activeNodesCount?: number;
}

export function ThemeTable({
  themes,
  selectedThemeId,
  onSelect,
  onExpandCategory,
  onRunTheme,
  onRunOutline,
  onEditTheme,
  runningThemeIds,
  runningOutlineIds,
  activeNodesCount
}: ThemeTableProps) {
  if (!themes.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        自動対象のテーマがありません。プロジェクト設定で autoUpdate を有効化してください。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {themes.map((theme) => {
        const isSelected = theme.id === selectedThemeId;
        const isRunning = runningThemeIds?.has(theme.id) ?? false;
        const isOutlineRunning = runningOutlineIds?.has(theme.id) ?? false;
        const pending =
          isSelected && activeNodesCount !== undefined ? activeNodesCount : theme.pendingNodes;
        return (
          <div
            key={theme.id}
            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
              isSelected
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-slate-200 bg-white text-slate-700 hover:border-primary/50'
            }`}
          >
            <button
              type="button"
              className="flex flex-1 items-center gap-3 text-left"
              onClick={() => onSelect(theme.id)}
            >
              <div>
                <p className="font-semibold">{theme.name}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <MdOutlineCalendarToday />
                    {theme.lastUpdatedAt
                      ? new Date(theme.lastUpdatedAt).toLocaleDateString('ja-JP', {
                          timeZone: 'Asia/Tokyo'
                        })
                      : '更新情報なし'}
                  </span>
                  {theme.autoUpdate ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-success">
                      <MdBolt size={14} />
                      自動更新
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-slate-600">
                      停止中
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                      pending > 0
                        ? 'bg-warning/10 text-warning'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    <MdHourglassEmpty size={14} />
                    {pending} 件待ち
                  </span>
                </div>
              </div>
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 transition hover:border-primary hover:text-primary"
                onClick={() => onExpandCategory(theme.id)}
              >
                <MdOutlineAddCircle />
                拡張
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-white shadow hover:bg-primary/90 disabled:opacity-50"
                onClick={() => onRunTheme(theme.id)}
                disabled={isRunning}
              >
                <MdOutlinePlayArrow size={16} />
                {isRunning ? '実行中…' : '更新'}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 transition hover:border-primary hover:text-primary disabled:opacity-50"
                onClick={() => onRunOutline(theme.id)}
                disabled={isOutlineRunning}
              >
                <MdOutlineAutoFixHigh size={16} />
                {isOutlineRunning ? '生成中…' : 'アウトライン'}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 transition hover:border-primary hover:text-primary"
                onClick={() => onEditTheme(theme)}
              >
                <MdEdit size={14} />
                編集
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
