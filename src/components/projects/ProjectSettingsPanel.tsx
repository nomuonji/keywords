import { useEffect, useState } from 'react';
import { MdExpandLess, MdExpandMore } from 'react-icons/md';
import type { BlogPlatform, ProjectSettings } from '../../types';
import { SuggestionModal } from '../common/SuggestionModal';
import { suggestThemes, suggestThemesGrok } from '../../lib/api';
import { firestore } from '../../lib/firebase';
import { collection, doc, writeBatch } from 'firebase/firestore';

interface ProjectSettingsPanelProps {
  projectId: string;
  name: string;
  description: string;
  settings: ProjectSettings;
  onSave: (data: { name: string; description: string; settings: ProjectSettings }) => void;
}

export function ProjectSettingsPanel({
  projectId,
  name,
  description,
  settings,
  onSave
}: ProjectSettingsPanelProps) {
  const [draftName, setDraftName] = useState(name);
  const [draftDescription, setDraftDescription] = useState(description);
  const [draft, setDraft] = useState<ProjectSettings>(settings);
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    setDraftName(name);
    setDraftDescription(description);
    setDraft(settings);
  }, [name, description, settings]);

  const handleSuggestThemes = (suggester: typeof suggestThemes | typeof suggestThemesGrok) => async () => {
    setModalOpen(true);
    setLoading(true);
    try {
      const result = await suggester(projectId, description);
      setSuggestions(result);
    } catch (error) {
      console.error('Failed to suggest themes', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddThemes = async (selected: string[]) => {
    const batch = writeBatch(firestore);
    const themesRef = collection(firestore, `projects/${projectId}/themes`);
    selected.forEach((themeName) => {
      const themeId = themeName.toLowerCase().replace(/\s+/g, '-');
      batch.set(doc(themesRef, themeId), {
        name: themeName,
        autoUpdate: false,
        pendingNodes: 0,
        updatedAt: new Date().toISOString()
      });
    });
    await batch.commit();
    setModalOpen(false);
  };

  const handleNumberChange =
    (path: string[]) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      setDraft((prev) => updateNestedNumber(prev, path, value));
    };

  const handleBlogPlatformChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const platform = event.target.value as BlogPlatform | 'none';
    setDraft((prev) => {
      const next = structuredClone(prev);
      if (platform === 'none') {
        delete next.blog;
        return next;
      }
      if (platform === 'wordpress') {
        const prevBlog = prev.blog?.platform === 'wordpress' ? prev.blog : undefined;
        next.blog = {
          platform: 'wordpress',
          url: prevBlog?.url ?? '',
          username: prevBlog?.username ?? '',
          password: prevBlog?.password ?? ''
        };
      } else {
        const prevBlog = prev.blog?.platform === 'hatena' ? prev.blog : undefined;
        next.blog = {
          platform: 'hatena',
          apiKey: prevBlog?.apiKey ?? '',
          blogId: prevBlog?.blogId ?? '',
          hatenaId: prevBlog?.hatenaId ?? ''
        };
      }
      return next;
    });
  };

  const handleBlogValueChange =
    (field: 'url' | 'username' | 'password' | 'apiKey' | 'blogId' | 'hatenaId') =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setDraft((prev) => {
        if (!prev.blog) {
          return prev;
        }
        const next = structuredClone(prev);
        if (!next.blog) {
          return next;
        }
        if (next.blog.platform === 'wordpress') {
          if (field === 'url') next.blog.url = value;
          if (field === 'username') next.blog.username = value;
          if (field === 'password') next.blog.password = value;
        } else if (next.blog.platform === 'hatena') {
          if (field === 'apiKey') next.blog.apiKey = value;
          if (field === 'blogId') next.blog.blogId = value;
          if (field === 'hatenaId') next.blog.hatenaId = value;
        }
        return next;
      });
    };

  const blogPlatform: BlogPlatform | 'none' = draft.blog?.platform ?? 'none';
  const blogLanguage = draft.blogLanguage ?? 'ja';

  const blogLanguageOptions = [
    { value: 'ja', label: '日本語 (Japanese)' },
    { value: 'en', label: '英語 (English)' },
    { value: 'zh', label: '中国語 (Chinese)' },
    { value: 'ko', label: '韓国語 (Korean)' },
    { value: 'fr', label: 'フランス語 (French)' },
    { value: 'es', label: 'スペイン語 (Spanish)' }
  ];

  const handleBlogLanguageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setDraft((prev) => ({
      ...prev,
      blogLanguage: value
    }));
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">プロジェクト設定</h3>
          <p className="text-xs text-slate-500">
            探索パイプラインやブログ連携の上限をまとめて管理できます。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSuggestThemes(suggestThemes)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 shadow-sm transition hover:border-primary hover:text-primary"
          >
            Geminiにテーマ案を提案させる
          </button>
          <button
            type="button"
            onClick={handleSuggestThemes(suggestThemesGrok)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 shadow-sm transition hover:border-primary hover:text-primary"
          >
            Grokにテーマ案を提案させる
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-300 p-2 text-slate-500 transition hover:bg-slate-100"
            onClick={() => setOpen((prev) => !prev)}
            aria-label="設定パネルの開閉"
          >
            {open ? <MdExpandLess size={18} /> : <MdExpandMore size={18} />}
          </button>
        </div>
      </header>

      {open ? (
        <>
          <div className="border-t border-slate-200 px-5 py-5 space-y-4">
            <TextInput label="プロジェクト名" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            <label className="flex flex-col gap-1 text-xs text-slate-600">
              <span>プロジェクトコンセプト</span>
              <textarea
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                rows={3}
              />
            </label>
          </div>
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
                label="ads.maxResults"
                value={draft.ads.maxResults}
                min={10}
                step={10}
                onChange={handleNumberChange(['ads', 'maxResults'])}
              />
              <NumberInput
                label="groupsOutlinePerRun"
                value={draft.pipeline.limits.groupsOutlinePerRun}
                min={1}
                onChange={handleNumberChange(['pipeline', 'limits', 'groupsOutlinePerRun'])}
              />
              <NumberInput
                label="groupsBlogPerRun"
                value={draft.pipeline.limits.groupsBlogPerRun}
                min={1}
                onChange={handleNumberChange(['pipeline', 'limits', 'groupsBlogPerRun'])}
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

            <fieldset className="md:col-span-2 space-y-3">
              <legend className="text-sm font-semibold text-slate-700">ブログ連携</legend>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs text-slate-600">
                  <span>投稿先プラットフォーム</span>
                  <select
                    value={blogPlatform}
                    onChange={handleBlogPlatformChange}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="none">未設定</option>
                    <option value="wordpress">WordPress</option>
                    <option value="hatena">はてなブログ</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-600">
                  <span>記事出力言語</span>
                  <select
                    value={blogLanguage}
                    onChange={handleBlogLanguageChange}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {blogLanguageOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs text-slate-500">
                  Gemini + Tavily の生成結果をどのブログと言語で公開するか設定します。
                </p>
              </div>
              {blogPlatform === 'wordpress' ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <TextInput
                    label="WordPress URL"
                    value={draft.blog?.platform === 'wordpress' ? draft.blog.url : ''}
                    onChange={handleBlogValueChange('url')}
                    placeholder="https://example.com"
                  />
                  <TextInput
                    label="WordPress ユーザー"
                    value={draft.blog?.platform === 'wordpress' ? draft.blog.username : ''}
                    onChange={handleBlogValueChange('username')}
                    placeholder="editor"
                  />
                  <TextInput
                    label="アプリパスワード"
                    value={draft.blog?.platform === 'wordpress' ? draft.blog.password : ''}
                    onChange={handleBlogValueChange('password')}
                    placeholder="••••"
                    type="password"
                  />
                </div>
              ) : null}
              {blogPlatform === 'hatena' ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <TextInput
                    label="はてなID"
                    value={draft.blog?.platform === 'hatena' ? draft.blog.hatenaId : ''}
                    onChange={handleBlogValueChange('hatenaId')}
                    placeholder="example-user"
                  />
                  <TextInput
                    label="ブログID"
                    value={draft.blog?.platform === 'hatena' ? draft.blog.blogId : ''}
                    onChange={handleBlogValueChange('blogId')}
                    placeholder="example.hatenablog.com"
                  />
                  <TextInput
                    label="APIキー / パスワード"
                    value={draft.blog?.platform === 'hatena' ? draft.blog.apiKey : ''}
                    onChange={handleBlogValueChange('apiKey')}
                    placeholder="••••"
                    type="password"
                  />
                </div>
              ) : null}
              {blogPlatform === 'none' ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  ブログ先を設定するとクラスタ詳細の「記事作成」から自動投稿まで行えるようになります。
                </p>
              ) : null}
            </fieldset>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
            <button
              type="button"
              onClick={() => onSave({ name: draftName, description: draftDescription, settings: draft })}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow hover:bg-primary/90"
            >
              保存
            </button>
          </div>
        </>
      ) : null}

      <SuggestionModal
        open={modalOpen}
        title="AIにテーマ案を提案してもらう"
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

function TextInput({
  label,
  value,
  placeholder,
  type = 'text',
  onChange
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}

function updateNestedNumber(settings: ProjectSettings, path: string[], value: number): ProjectSettings {
  const updated = structuredClone(settings);
  let current: any = updated;
  for (let i = 0; i < path.length - 1; i += 1) {
    current = current[path[i]];
  }
  current[path[path.length - 1]] = value;
  return updated;
}
