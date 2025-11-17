import { useState, useEffect } from 'react';

interface SuggestionModalProps {
  open: boolean;
  title: string;
  suggestions: string[];
  loading: boolean;
  onClose: () => void;
  onAdd: (selected: string[]) => void;
  onRegenerate?: () => void;
}

export function SuggestionModal({
  open,
  title,
  suggestions,
  loading,
  onClose,
  onAdd,
  onRegenerate
}: SuggestionModalProps) {
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    setSelected([]);
  }, [suggestions]);

  const handleToggle = (suggestion: string) => {
    setSelected((prev) =>
      prev.includes(suggestion) ? prev.filter((s) => s !== suggestion) : [...prev, suggestion]
    );
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <header className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
        </header>
        <div className="px-6 py-5">
          {loading ? (
            <div className="flex h-48 items-center justify-center">
              <p className="text-slate-500">Geminiが提案を生成中です...</p>
            </div>
          ) : (
            <ul className="h-96 space-y-2 overflow-y-auto">
              {suggestions.map((suggestion) => (
                <li key={suggestion}>
                  <label className="flex items-center gap-3 rounded-md p-3 transition hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/50"
                      checked={selected.includes(suggestion)}
                      onChange={() => handleToggle(suggestion)}
                    />
                    <span className="text-sm text-slate-700">{suggestion}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          {onRegenerate ? (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={loading}
              className="mr-auto rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              再生成
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => onAdd(selected)}
            disabled={selected.length === 0 || loading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {`選択中の ${selected.length} 件を追加`}
          </button>
        </footer>
      </div>
    </div>
  );
}
