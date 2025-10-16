import { useEffect, useMemo, useState } from 'react';
import { AppShell } from './components/layout/AppShell';
import { ProjectSelector } from './components/projects/ProjectSelector';
import { ProjectSettingsPanel } from './components/projects/ProjectSettingsPanel';
import { ThemeTable } from './components/themes/ThemeTable';
import { ThemeSettingsPanel } from './components/themes/ThemeSettingsPanel';
import { GroupPanel } from './components/groups/GroupPanel';
import { JobHistoryDialog } from './components/jobs/JobHistoryDialog';
import { NodeCreateModal } from './components/common/NodeCreateModal';
import { Toast } from './components/common/Toast';
import {
  jobHistory,
  groups as mockGroups,
  projects as mockProjects,
  themes as mockThemes
} from './mockData';
import type { GroupSummary, ProjectSettings, ProjectSummary, ThemeSummary } from './types';

export default function App() {
  const [projectList, setProjectList] = useState<ProjectSummary[]>(mockProjects);
  const [themeMap, setThemeMap] = useState<Record<string, ThemeSummary[]>>(
    cloneThemes(mockThemes)
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(
    mockProjects[0]?.id
  );
  const [selectedThemeId, setSelectedThemeId] = useState<string | undefined>(undefined);
  const [showNodeModal, setShowNodeModal] = useState(false);
  const [showJobHistory, setShowJobHistory] = useState(false);
  const [toast, setToast] =
    useState<{ message: string; type?: 'info' | 'success' | 'error' }>();

  const selectedProject = projectList.find((project) => project.id === selectedProjectId);
  const themes = selectedProjectId ? themeMap[selectedProjectId] ?? [] : [];
  const selectedTheme = themes.find((theme) => theme.id === selectedThemeId);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedThemeId(undefined);
      return;
    }
    const projectThemes = themeMap[selectedProjectId] ?? [];
    if (projectThemes.length && (!selectedThemeId || !projectThemes.some(
      (theme) => theme.id === selectedThemeId
    ))) {
      setSelectedThemeId(projectThemes[0].id);
    }
  }, [selectedProjectId, selectedThemeId, themeMap]);

  const groupList: GroupSummary[] = useMemo(() => {
    if (!selectedThemeId) return [];
    return mockGroups[selectedThemeId] ?? [];
  }, [selectedThemeId]);

  const handleRunProject = (projectId: string) => {
    setToast({ message: `プロジェクト「${projectId}」でパイプラインを起動します`, type: 'info' });
  };

  const handleRunTheme = (themeId: string) => {
    setToast({ message: `テーマ「${themeId}」の更新ジョブを送信しました`, type: 'success' });
  };

  const handleAddNode = (payload: { title: string; intent: string; depth: number }) => {
    setShowNodeModal(false);
    setToast({
      message: `ノード「${payload.title}」を登録しました（意図: ${payload.intent}）`,
      type: 'success'
    });
  };

  const handleSaveProjectSettings = (settings: ProjectSettings) => {
    if (!selectedProjectId) return;
    setProjectList((prev) =>
      prev.map((project) =>
        project.id === selectedProjectId ? { ...project, settings } : project
      )
    );
    setToast({ message: 'プロジェクト設定を更新しました', type: 'success' });
  };

  const handleSaveThemeSettings = (settings: Partial<ProjectSettings>) => {
    if (!selectedProjectId || !selectedThemeId) return;
    setThemeMap((prev) => {
      const projectThemes = prev[selectedProjectId] ?? [];
      const updatedThemes = projectThemes.map((theme) =>
        theme.id === selectedThemeId ? { ...theme, settings } : theme
      );
      return { ...prev, [selectedProjectId]: updatedThemes };
    });
    setToast({ message: 'テーマ設定を更新しました', type: 'success' });
  };

  return (
    <AppShell title="Keywords 管理UI（デモ）">
      <div className="flex flex-col gap-6">
        <ProjectSelector
          projects={projectList}
          selectedProjectId={selectedProjectId}
          onSelect={(projectId) => {
            setSelectedProjectId(projectId);
            setSelectedThemeId(undefined);
          }}
          onRunProject={handleRunProject}
        />

        {selectedProject ? (
          <ProjectSettingsPanel
            settings={selectedProject.settings}
            onSave={handleSaveProjectSettings}
          />
        ) : null}

        <section className="space-y-4">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">テーマ一覧</h2>
              <p className="text-sm text-slate-500">
                自動更新対象のテーマについて、アイデア取得状況と管理アクションを確認できます。
              </p>
            </div>
            <button
              type="button"
              className="rounded-md border border-primary px-3 py-2 text-sm text-primary shadow-sm transition hover:bg-primary/10"
              onClick={() => setShowJobHistory(true)}
            >
              ジョブ履歴を見る
            </button>
          </header>

          <ThemeTable
            themes={themes}
            selectedThemeId={selectedThemeId}
            onSelect={(themeId) => setSelectedThemeId(themeId)}
            onExpandCategory={() => setShowNodeModal(true)}
            onRunTheme={handleRunTheme}
          />
        </section>

        {selectedProject ? (
          <ThemeSettingsPanel
            projectDefaults={selectedProject.settings}
            themeSettings={selectedTheme?.settings}
            onSave={handleSaveThemeSettings}
            themeName={selectedTheme?.name}
          />
        ) : null}

        <GroupPanel groups={groupList} />
      </div>

      <NodeCreateModal
        open={showNodeModal}
        onClose={() => setShowNodeModal(false)}
        onSave={handleAddNode}
      />
      <JobHistoryDialog
        open={showJobHistory}
        jobs={jobHistory}
        onClose={() => setShowJobHistory(false)}
      />

      <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
        {toast ? <Toast message={toast.message} type={toast.type} /> : null}
      </div>
    </AppShell>
  );
}

function cloneThemes(
  source: Record<string, ThemeSummary[]>
): Record<string, ThemeSummary[]> {
  return JSON.parse(JSON.stringify(source));
}
