import { useMemo } from 'react';
import {
  MdAdd,
  MdEdit,
  MdOutlineInsights,
  MdOutlinePlayArrow,
  MdOutlineWarningAmber
} from 'react-icons/md';
import type { ProjectSummary } from '../../types';

interface ProjectSelectorProps {
  projects: ProjectSummary[];
  selectedProjectId?: string;
  runningProjectIds?: Set<string>;
  onSelect: (projectId: string) => void;
  onRunProject: (projectId: string) => void;
  onCreateProject: () => void;
  onEditProject: (project: ProjectSummary) => void;
}

export function ProjectSelector({
  projects,
  selectedProjectId,
  runningProjectIds,
  onSelect,
  onRunProject,
  onCreateProject,
  onEditProject
}: ProjectSelectorProps) {
  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) =>
        (b.lastJob?.finishedAt ?? '').localeCompare(a.lastJob?.finishedAt ?? '')
      ),
    [projects]
  );

  return (
    <section className="space-y-2">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            プロジェクト切り替え
          </h2>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-primary px-3 py-1 text-xs text-primary transition hover:bg-primary/10"
            onClick={onCreateProject}
          >
            <MdAdd />
            追加
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sortedProjects.map((project) => {
            const isSelected = project.id === selectedProjectId;
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => onSelect(project.id)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
                  isSelected
                    ? 'border-primary bg-primary text-white shadow'
                    : 'border-slate-300 bg-white text-slate-600 hover:border-primary hover:text-primary'
                }`}
              >
                <span className="font-medium">{project.name}</span>
                {project.halt ? (
                  <MdOutlineWarningAmber
                    className={isSelected ? 'text-white' : 'text-danger'}
                    title="自動処理停止中"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </header>
      {selectedProjectId ? (
        <ProjectStatusBar
          project={projects.find((project) => project.id === selectedProjectId)}
          onRunProject={onRunProject}
          onEditProject={onEditProject}
          isRunning={runningProjectIds?.has(selectedProjectId) ?? false}
        />
      ) : null}
    </section>
  );
}

function ProjectStatusBar({
  project,
  onRunProject,
  onEditProject,
  isRunning
}: {
  project?: ProjectSummary;
  onRunProject: (projectId: string) => void;
  onEditProject: (project: ProjectSummary) => void;
  isRunning: boolean;
}) {
  if (!project) return null;
  const lastExecuted = project.lastJob
    ? new Date(project.lastJob.finishedAt).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo'
      })
    : '未取得';
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-primary">
        <MdOutlineInsights />
        最終実行: {lastExecuted}
      </span>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-full border border-primary bg-white px-3 py-1 text-primary transition hover:bg-primary/10 disabled:opacity-50"
        onClick={() => onRunProject(project.id)}
        disabled={project.halt || isRunning}
      >
        <MdOutlinePlayArrow />
        {isRunning ? '実行中…' : '今すぐ実行'}
      </button>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-600 transition hover:border-primary hover:text-primary"
        onClick={() => onEditProject(project)}
      >
        <MdEdit size={14} />
        編集
      </button>
    </div>
  );
}
