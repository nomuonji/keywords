import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { AppShell } from './components/layout/AppShell';
import { ProjectSelector } from './components/projects/ProjectSelector';
import { ProjectSettingsPanel } from './components/projects/ProjectSettingsPanel';
import { ProjectFormModal, type ProjectFormData } from './components/projects/ProjectFormModal';
import { ThemeTable } from './components/themes/ThemeTable';
import { ThemeSettingsPanel } from './components/themes/ThemeSettingsPanel';
import { ThemeFormModal, type ThemeFormData } from './components/themes/ThemeFormModal';
import { NodeList } from './components/themes/NodeList';
import { GroupPanel } from './components/groups/GroupPanel';
import { JobHistoryDialog } from './components/jobs/JobHistoryDialog';
import { NodeCreateModal } from './components/common/NodeCreateModal';
import { Toast } from './components/common/Toast';
import { firestore } from './lib/firebase';
import { postJson } from './lib/api';
import { DEFAULT_PROJECT_SETTINGS } from './constants/settings';
import type {
  GroupSummary,
  JobHistoryItem,
  ProjectSettings,
  ProjectSummary,
  ThemeSummary,
  NodeDocWithId,
  BlogMediaConfig
} from './types';

type OutlineRunResponse = {
  status: 'completed';
  outlinesCreated: number;
  outlinedGroupIds: string[];
  linksCreated?: number;
  linkSourceGroupIds?: string[];
};

type LinkRunResponse = {
  status: 'completed';
  linksCreated: number;
  linkSourceGroupIds: string[];
};

type ClearOutlineResponse = {
  cleared: number;
};

type BlogRunResponse = {
  status: 'completed';
  postsCreated: number;
  postedGroupIds: string[];
};

type ThemeRefreshResponse = {
  nodesProcessed: number;
  newKeywords: number;
  groupsCreated: number;
  groupsUpdated: number;
};

type ProjectSettingsPayload = Partial<
  Omit<ProjectSettings, 'pipeline'>
> & {
  pipeline?: Partial<ProjectSettings['pipeline']> & {
    limits?: Partial<ProjectSettings['pipeline']['limits']>;
  };
};

function normalizeProjectSettings(raw?: ProjectSettingsPayload): ProjectSettings {
  const base = DEFAULT_PROJECT_SETTINGS;
  return {
    pipeline: {
      staleDays: raw?.pipeline?.staleDays ?? base.pipeline.staleDays,
      limits: {
        nodesPerRun: raw?.pipeline?.limits?.nodesPerRun ?? base.pipeline.limits.nodesPerRun,
        ideasPerNode: raw?.pipeline?.limits?.ideasPerNode ?? base.pipeline.limits.ideasPerNode,
        groupsOutlinePerRun:
          raw?.pipeline?.limits?.groupsOutlinePerRun ?? base.pipeline.limits.groupsOutlinePerRun,
        groupsBlogPerRun:
          raw?.pipeline?.limits?.groupsBlogPerRun ?? base.pipeline.limits.groupsBlogPerRun
      }
    },
    thresholds: {
      minVolume: raw?.thresholds?.minVolume ?? base.thresholds.minVolume,
      maxCompetition: raw?.thresholds?.maxCompetition ?? base.thresholds.maxCompetition
    },
    weights: {
      volume: raw?.weights?.volume ?? base.weights.volume,
      competition: raw?.weights?.competition ?? base.weights.competition,
      intent: raw?.weights?.intent ?? base.weights.intent,
      novelty: raw?.weights?.novelty ?? base.weights.novelty
    },
    links: {
      maxPerGroup: raw?.links?.maxPerGroup ?? base.links.maxPerGroup
    },
    blog: raw?.blog,
    blogLanguage: raw?.blogLanguage ?? base.blogLanguage ?? 'ja'
  };
}

function validateBlogConfig(config?: BlogMediaConfig): string | null {
  if (!config) {
    return 'ブログ連携が未設定です。「プロジェクト設定 > ブログ連携」を入力してください。';
  }
  if (config.platform === 'wordpress') {
    if (!config.url || !config.username || !config.password) {
      return 'WordPress の URL / ユーザー / アプリパスワードをすべて設定してください。';
    }
  } else if (config.platform === 'hatena') {
    if (!config.hatenaId || !config.blogId || !config.apiKey) {
      return 'はてなブログの ID / ブログID / APIキー をすべて設定してください。';
    }
  }
  return null;
}

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [jobs, setJobs] = useState<JobHistoryItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [selectedThemeId, setSelectedThemeId] = useState<string>();
  const [showNodeModal, setShowNodeModal] = useState(false);
  const [showJobHistory, setShowJobHistory] = useState(false);
  const [toast, setToast] =
    useState<{ message: string; type?: 'info' | 'success' | 'error' }>();
  const [projectModal, setProjectModal] = useState<{
    mode: 'create' | 'edit';
    project?: ProjectSummary;
  } | null>(null);
  const [themeModal, setThemeModal] = useState<{
    mode: 'create' | 'edit';
    theme?: ThemeSummary;
  } | null>(null);
  const [runningProjects, setRunningProjects] = useState<Set<string>>(new Set());
  const [runningThemes, setRunningThemes] = useState<Set<string>>(new Set());
  const [runningOutlineThemes, setRunningOutlineThemes] = useState<Set<string>>(new Set());
  const [runningLinkThemes, setRunningLinkThemes] = useState<Set<string>>(new Set());
  const [postingGroupIds, setPostingGroupIds] = useState<Set<string>>(new Set());
  const [nodes, setNodes] = useState<NodeDocWithId[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [deletingGroups, setDeletingGroups] = useState(false);
  const [clearingOutlines, setClearingOutlines] = useState(false);

  useEffect(() => {
    const projectsRef = collection(firestore, 'projects');
    const unsubscribe = onSnapshot(
      projectsRef,
      (snapshot) => {
        const data: ProjectSummary[] = snapshot.docs.map((docSnap) => {
          const docData = docSnap.data();
          const normalizedSettings = normalizeProjectSettings(
            (docData.settings ?? undefined) as ProjectSettingsPayload | undefined
          );
          return {
            id: docSnap.id,
            name: docData.name ?? docSnap.id,
            description: docData.description ?? '',
            domain: docData.domain,
            halt: docData.halt ?? false,
            settings: normalizedSettings,
            lastJob: undefined
          };
        });
        setProjects(data);
        if (!selectedProjectId && data.length) {
          setSelectedProjectId(data[0].id);
        }
      },
      (error) => {
        console.error('Failed to load projects', error);
        setToast({ message: 'Failed to load projects', type: 'error' });
      }
    );
    return () => unsubscribe();
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setThemes([]);
      return;
    }
    const themesRef = collection(firestore, `projects/${selectedProjectId}/themes`);
    const unsubscribe = onSnapshot(
      themesRef,
      (snapshot) => {
        const data: ThemeSummary[] = snapshot.docs.map((docSnap) => {
          const docData = docSnap.data();
          return {
            id: docSnap.id,
            name: docData.name ?? docSnap.id,
            autoUpdate: docData.autoUpdate ?? false,
            pendingNodes: docData.pendingNodes ?? 0,
            lastUpdatedAt: docData.updatedAt ?? '',
            settings: docData.settings
          };
        });
        setThemes(data);
      },
      (error) => {
        console.error('Failed to load themes', error);
        setToast({ message: 'Failed to load themes', type: 'error' });
      }
    );
    return () => unsubscribe();
  }, [selectedProjectId]);

  useEffect(() => {
    if (!themes.length) {
      setSelectedThemeId(undefined);
      return;
    }
    if (!selectedThemeId || !themes.some((theme) => theme.id === selectedThemeId)) {
      setSelectedThemeId(themes[0].id);
    }
  }, [themes, selectedThemeId]);

  useEffect(() => {
    if (!selectedProjectId || !selectedThemeId) {
      setNodes([]);
      return;
    }
    const nodesRef = collection(
      firestore,
      `projects/${selectedProjectId}/themes/${selectedThemeId}/nodes`
    );
    const unsubscribe = onSnapshot(
      nodesRef,
      (snapshot) => {
        const data: NodeDocWithId[] = snapshot.docs
          .map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<NodeDocWithId, 'id'>)
          }))
          .sort((a, b) => {
            const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return bTime - aTime;
          });
        setNodes(data);
        setThemes((prev) =>
          prev.map((theme) =>
            theme.id === selectedThemeId
              ? { ...theme, nodes: data, pendingNodes: data.length }
              : theme
          )
        );
      },
      (error) => {
        console.error('Failed to load nodes', error);
        setToast({ message: 'Failed to load nodes', type: 'error' });
      }
    );
    return () => unsubscribe();
  }, [selectedProjectId, selectedThemeId]);

  useEffect(() => {
    if (!selectedProjectId || !selectedThemeId) {
      setGroups([]);
      return;
    }
    const groupsRef = collection(
      firestore,
      `projects/${selectedProjectId}/themes/${selectedThemeId}/groups`
    );
    const unsubscribe = onSnapshot(
      groupsRef,
      async (snapshot) => {
        const groupData: GroupSummary[] = await Promise.all(
          snapshot.docs.map(async (docSnap) => {
            const data = docSnap.data();
            const keywordsSnap = await getDocs(
              query(
                collection(
                  firestore,
                  `projects/${selectedProjectId}/themes/${selectedThemeId}/keywords`
                ),
                where('groupId', '==', docSnap.id)
              )
            );
            const keywords = keywordsSnap.docs.map((kw) => ({
              id: kw.id,
              text: kw.data().text,
              metrics: kw.data().metrics ?? {}
            }));
            const linksSnap = await getDocs(
              query(
                collection(
                  firestore,
                  `projects/${selectedProjectId}/themes/${selectedThemeId}/links`
                ),
                where('fromGroupId', '==', docSnap.id)
              )
            );
            const links = linksSnap.docs.map((link) => ({
              targetId: link.data().toGroupId,
              reason: link.data().reason,
              weight: link.data().weight ?? 0
            }));
            const summary = data.summary;
            const outline = summary
              ? {
                  outlineTitle: summary.outlineTitle ?? '',
                  h2: Array.isArray(summary.h2) ? summary.h2 : [],
                  h3: summary.h3
                    ? Object.values(summary.h3)
                        .flat()
                        .filter((item: unknown): item is string => typeof item === 'string')
                    : undefined,
                  faq: Array.isArray(summary.faq)
                    ? summary.faq.filter(
                        (item: unknown): item is { q: string; a: string } =>
                          !!item && typeof (item as { q?: string }).q === 'string'
                      )
                    : undefined
                }
              : undefined;
            return {
              id: docSnap.id,
              title: data.title ?? docSnap.id,
              intent: data.intent ?? 'info',
              priorityScore: data.priorityScore ?? 0,
              clusterStats: data.clusterStats ?? { size: keywords.length },
              outline,
              keywords,
              links,
              postUrl:
                typeof data.postUrl === 'string' && data.postUrl.trim().length
                  ? data.postUrl
                  : undefined
            };
          })
        );
        groupData.sort((a, b) => b.priorityScore - a.priorityScore);
        setGroups(groupData);
        setSelectedGroupIds((prev) => {
          const validIds = new Set(groupData.map((group) => group.id));
          let changed = false;
          const retained: string[] = [];
          prev.forEach((id) => {
            if (validIds.has(id)) {
              retained.push(id);
            } else {
              changed = true;
            }
          });
          if (!changed && retained.length === prev.size) {
            return prev;
          }
          return new Set(retained);
        });
      },
      (error) => {
        console.error('Failed to load groups', error);
        setToast({ message: 'Failed to load groups', type: 'error' });
      }
    );
    return () => unsubscribe();
  }, [selectedProjectId, selectedThemeId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setJobs([]);
      return;
    }
    const jobsRef = collection(firestore, `projects/${selectedProjectId}/jobs`);
    const jobsQuery = query(jobsRef, orderBy('finishedAt', 'desc'), limit(20));
    const unsubscribe = onSnapshot(
      jobsQuery,
      (snapshot) => {
        const data: JobHistoryItem[] = snapshot.docs.map((docSnap) => {
          const docData = docSnap.data();
          return {
            id: docSnap.id,
            type: docData.type ?? 'manual',
            status: docData.status ?? 'running',
            startedAt: docData.startedAt ?? '',
            finishedAt: docData.finishedAt ?? '',
            summary: docData.summary ?? {
              nodesProcessed: 0,
              newKeywords: 0,
              groupsCreated: 0,
              groupsUpdated: 0,
              outlinesCreated: 0,
              linksUpdated: 0,
              errors: []
            }
          };
        });
        setJobs(data);
      },
      (error) => {
        console.error('Failed to load jobs', error);
        setToast({ message: 'Failed to load job history', type: 'error' });
      }
    );
    return () => unsubscribe();
  }, [selectedProjectId]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  const displayProjects = useMemo(() => {
    if (!jobs.length || !selectedProjectId) {
      return projects;
    }
    const lastJob = jobs[0];
    return projects.map((project) =>
      project.id === selectedProjectId
        ? {
            ...project,
            lastJob: {
              status: lastJob.status,
              finishedAt: lastJob.finishedAt,
              nodesProcessed: lastJob.summary.nodesProcessed,
              outlinesCreated: lastJob.summary.outlinesCreated
            }
          }
        : project
    );
  }, [projects, jobs, selectedProjectId]);

  const selectedTheme = useMemo(
    () => themes.find((theme) => theme.id === selectedThemeId),
    [themes, selectedThemeId]
  );

  const handleRunProject = async (projectId: string) => {
    if (runningProjects.has(projectId)) {
      return;
    }
    setRunningProjects((prev) => {
      const next = new Set(prev);
      next.add(projectId);
      return next;
    });
    try {
      await postJson<{ status: string }>(`/projects/${projectId}/run`, { manual: true });
      setToast({ message: `Triggered pipeline for project ${projectId}`, type: 'info' });
    } catch (error) {
      console.error('Failed to trigger project pipeline', error);
      setToast({ message: 'Failed to trigger project pipeline', type: 'error' });
    } finally {
      setRunningProjects((prev) => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  };

  const handleRunTheme = async (themeId: string) => {
    if (!selectedProjectId) {
      setToast({ message: 'Select a project first', type: 'info' });
      return;
    }
    if (runningThemes.has(themeId)) {
      return;
    }
    setRunningThemes((prev) => {
      const next = new Set(prev);
      next.add(themeId);
      return next;
    });
    try {
      const result = await postJson<ThemeRefreshResponse>(
        `/projects/${selectedProjectId}/themes/${themeId}/refresh`,
        {}
      );
      const { newKeywords, groupsCreated } = result;
      setToast({
        message: `Theme refreshed: ${newKeywords} new keywords, ${groupsCreated} new groups.`,
        type: 'success'
      });
    } catch (error) {
      console.error('Failed to refresh theme', error);
      setToast({ message: 'Failed to refresh theme', type: 'error' });
    } finally {
      setRunningThemes((prev) => {
        const next = new Set(prev);
        next.delete(themeId);
        return next;
      });
    }
  };

  const handleRunOutline = async (themeId: string) => {
    if (!selectedProjectId) {
      setToast({ message: 'Select a project first', type: 'info' });
      return;
    }
    if (runningOutlineThemes.has(themeId)) {
      return;
    }
    setRunningOutlineThemes((prev) => {
      const next = new Set(prev);
      next.add(themeId);
      return next;
    });
    try {
      const groupIds = selectedGroupIds.size ? Array.from(selectedGroupIds) : undefined;
      const response = await postJson<OutlineRunResponse>(
        `/projects/${selectedProjectId}/themes/${themeId}/outlines:run`,
        { includeLinks: false, groupIds }
      );
      const created = response.outlinesCreated ?? 0;
      if (created > 0) {
        const message = groupIds?.length
          ? `Generated ${created} outlines for the selected clusters`
          : `Generated ${created} outlines`;
        setToast({ message, type: 'success' });
      } else {
        const message = groupIds?.length
          ? 'No outline targets were available for the selected clusters'
          : 'No outline targets available';
        setToast({ message, type: 'info' });
      }
    } catch (error) {
      console.error('Failed to trigger outline generation', error);
      setToast({ message: 'Failed to generate outlines', type: 'error' });
    } finally {
      setRunningOutlineThemes((prev) => {
        const next = new Set(prev);
        next.delete(themeId);
        return next;
      });
    }
  };

  const handleRunLinks = async (themeId: string) => {
    if (!selectedProjectId) {
      setToast({ message: 'Select a project first', type: 'info' });
      return;
    }
    if (runningLinkThemes.has(themeId)) {
      return;
    }
    setRunningLinkThemes((prev) => {
      const next = new Set(prev);
      next.add(themeId);
      return next;
    });
    try {
      const sourceGroupIds = selectedGroupIds.size ? Array.from(selectedGroupIds) : undefined;
      const response = await postJson<LinkRunResponse>(
        `/projects/${selectedProjectId}/themes/${themeId}/links:generate`,
        { sourceGroupIds }
      );
      if (response.linksCreated > 0) {
        const message = sourceGroupIds?.length
          ? `Updated ${response.linksCreated} internal links for the selected clusters`
          : `Updated ${response.linksCreated} internal links`;
        setToast({ message, type: 'success' });
      } else {
        const message = sourceGroupIds?.length
          ? 'No new link candidates found for the selected clusters'
          : 'No link candidates available';
        setToast({ message, type: 'info' });
      }
    } catch (error) {
      console.error('Failed to trigger link generation', error);
      setToast({ message: 'Failed to generate internal links', type: 'error' });
    } finally {
      setRunningLinkThemes((prev) => {
        const next = new Set(prev);
        next.delete(themeId);
        return next;
      });
    }
  };  const handleToggleGroupSelection = (groupId: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const handleSelectAllGroups = () => {
    setSelectedGroupIds(new Set(groups.map((group) => group.id)));
  };

  const handleClearGroupSelection = () => {
    setSelectedGroupIds(new Set());
  };

  const handleClearGroupOutlines = async () => {
    if (!selectedProjectId || !selectedThemeId) {
      setToast({ message: 'Select a project and theme first', type: 'info' });
      return;
    }
    if (!selectedGroupIds.size) {
      setToast({ message: 'Select clusters before clearing outlines', type: 'info' });
      return;
    }
    setClearingOutlines(true);
    try {
      const response = await postJson<ClearOutlineResponse>(
        `/projects/${selectedProjectId}/themes/${selectedThemeId}/outlines:delete`,
        { groupIds: Array.from(selectedGroupIds) }
      );
      setToast({ message: `Cleared outlines for ${response.cleared} clusters`, type: 'success' });
      if (response.cleared > 0) {
        setGroups((prev) =>
          prev.map((group) =>
            selectedGroupIds.has(group.id)
              ? { ...group, outline: undefined }
              : group
          )
        );
      }
    } catch (error) {
      console.error('Failed to clear outlines', error);
      setToast({ message: 'Failed to clear outlines', type: 'error' });
    } finally {
      setClearingOutlines(false);
    }
  };  const handleDeleteSelectedGroups = async () => {
    if (!selectedProjectId || !selectedThemeId) {
      setToast({ message: 'プロジェクトとテーマを選択してください', type: 'info' });
      return;
    }
    if (!selectedGroupIds.size) {
      setToast({ message: '削除するクラスタを選択してください', type: 'info' });
      return;
    }
    setDeletingGroups(true);
    try {
      await postJson<{ deleted: number }>(
        `/projects/${selectedProjectId}/themes/${selectedThemeId}/groups:delete`,
        { groupIds: Array.from(selectedGroupIds) }
      );
      setToast({
        message: `${selectedGroupIds.size} 件のクラスタを削除しました`,
        type: 'success'
      });
      setSelectedGroupIds(new Set());
    } catch (error) {
      console.error('Failed to delete groups', error);
      setToast({ message: 'クラスタの削除に失敗しました', type: 'error' });
    } finally {
      setDeletingGroups(false);
    }
  };

  const handleAddNode = (payload: { title: string; intent: string; depth: number }) => {
    if (!selectedProjectId || !selectedThemeId) return;
    addDoc(
      collection(firestore, `projects/${selectedProjectId}/themes/${selectedThemeId}/nodes`),
      {
        title: payload.title,
        intent: payload.intent,
        depth: Number.isNaN(payload.depth) ? 0 : payload.depth,
        status: 'ready',
        updatedAt: new Date().toISOString()
      }
    )
      .then(() => {
        setShowNodeModal(false);
        setToast({
          message: `Created node "${payload.title}" (intent: ${payload.intent})`,
          type: 'success'
        });
      })
      .catch((error) => {
        console.error('Failed to create node', error);
        setToast({ message: 'Failed to create node', type: 'error' });
      });
  };

  const handleDeleteNode = async (nodeId: string) => {
    if (!selectedProjectId || !selectedThemeId) return;
    try {
      await deleteDoc(
        doc(firestore, `projects/${selectedProjectId}/themes/${selectedThemeId}/nodes/${nodeId}`)
      );
      setToast({ message: `Deleted node ${nodeId}`, type: 'success' });
    } catch (error) {
      console.error('Failed to delete node', error);
      setToast({ message: 'Failed to delete node', type: 'error' });
    }
  };

  const handleUpdateNodeStatus = async (
    nodeId: string,
    status: NodeDocWithId['status']
  ) => {
    if (!selectedProjectId || !selectedThemeId) {
      return;
    }
    try {
      const nodeRef = doc(
        firestore,
        `projects/${selectedProjectId}/themes/${selectedThemeId}/nodes/${nodeId}`
      );
      const payload: Record<string, unknown> = {
        status,
        updatedAt: new Date().toISOString()
      };
      if (status === 'ready') {
        payload.lastIdeasAt = deleteField();
      }
      await updateDoc(nodeRef, payload);
      setToast({ message: `Updated node status to ${status}`, type: 'success' });
    } catch (error) {
      console.error('Failed to update node status', error);
      setToast({ message: 'Failed to update node status', type: 'error' });
    }
  };

  const handleSaveProjectSettings = async (settings: ProjectSettings) => {
    if (!selectedProjectId) return;
    try {
      await updateDoc(doc(firestore, `projects/${selectedProjectId}`), { settings });
      setToast({ message: 'Updated project settings', type: 'success' });
    } catch (error) {
      console.error('Failed to update project settings', error);
      setToast({ message: 'Failed to update project settings', type: 'error' });
    }
  };

  const handleSaveThemeSettings = async (settings: Partial<ProjectSettings>) => {
    if (!selectedProjectId || !selectedThemeId) return;
    try {
      const themeRef = doc(
        firestore,
        `projects/${selectedProjectId}/themes/${selectedThemeId}`
      );
      const isEmpty = Object.keys(settings).length === 0;
      if (isEmpty) {
        await updateDoc(themeRef, { settings: deleteField() });
      } else {
        await updateDoc(themeRef, { settings });
      }
      setToast({ message: 'Updated theme settings', type: 'success' });
    } catch (error) {
      console.error('Failed to update theme settings', error);
      setToast({ message: 'Failed to update theme settings', type: 'error' });
    }
  };

  const handleSubmitProjectForm = async (
    data: ProjectFormData & { settings?: ProjectSettings }
  ) => {
    const now = new Date().toISOString();
    if (projectModal?.mode === 'create') {
      if (projects.some((project) => project.id === data.id)) {
        throw new Error('Project ID already exists');
      }
      const payload: Record<string, unknown> = {
        name: data.name,
        halt: data.halt ?? false,
        settings: data.settings ?? DEFAULT_PROJECT_SETTINGS,
        createdAt: now,
        updatedAt: now
      };
      if (data.domain) {
        payload.domain = data.domain;
      }
      await setDoc(doc(firestore, `projects/${data.id}`), payload);
      setToast({ message: `Created project ${data.name}`, type: 'success' });
      setSelectedProjectId(data.id);
    } else if (projectModal?.mode === 'edit' && projectModal.project) {
      const updatePayload: Record<string, unknown> = {
        name: data.name,
        halt: data.halt ?? false,
        updatedAt: now
      };
      if (data.domain) {
        updatePayload.domain = data.domain;
      } else {
        updatePayload.domain = deleteField();
      }
      await updateDoc(doc(firestore, `projects/${data.id}`), updatePayload);
      setToast({ message: `Updated project ${data.name}`, type: 'success' });
    }
  };

  const handleSubmitThemeForm = async (data: ThemeFormData) => {
    if (!selectedProjectId) {
      throw new Error('Project not selected');
    }
    const now = new Date().toISOString();
    if (themeModal?.mode === 'create') {
      if (themes.some((theme) => theme.id === data.id)) {
        throw new Error('Theme ID already exists');
      }
      await setDoc(
        doc(firestore, `projects/${selectedProjectId}/themes/${data.id}`),
        {
          name: data.name,
          autoUpdate: data.autoUpdate,
          pendingNodes: 0,
          updatedAt: now
        },
        { merge: true }
      );
      setToast({ message: `Created theme ${data.name}`, type: 'success' });
      setSelectedThemeId(data.id);
    } else if (themeModal?.mode === 'edit' && themeModal.theme) {
      await updateDoc(doc(firestore, `projects/${selectedProjectId}/themes/${data.id}`), {
        name: data.name,
        autoUpdate: data.autoUpdate,
        updatedAt: now
      });
      setToast({ message: `Updated theme ${data.name}`, type: 'success' });
    }
  };

  const openCreateTheme = () => {
    if (!selectedProjectId) {
      setToast({ message: 'Select a project before adding a theme', type: 'info' });
      return;
    }
    setThemeModal({ mode: 'create' });
  };

  const handleCreateArticle = async (groupId: string) => {
    if (!selectedProjectId || !selectedThemeId) {
      setToast({ message: 'プロジェクトとテーマを選択してください', type: 'info' });
      return;
    }
    const blogConfigError = validateBlogConfig(selectedProject?.settings.blog);
    if (blogConfigError) {
      setToast({ message: blogConfigError, type: 'error' });
      return;
    }
    if (postingGroupIds.has(groupId)) {
      return;
    }
    const targetGroup = groups.find((group) => group.id === groupId);
    const label = targetGroup?.title ?? groupId;
    const isRewrite = Boolean(targetGroup?.postUrl);
    const actionLabel = isRewrite ? 'リライト' : '記事作成';
    setToast({ message: `${label} の${actionLabel}を開始します`, type: 'info' });
    setPostingGroupIds((prev) => {
      const next = new Set(prev);
      next.add(groupId);
      return next;
    });
    try {
      const response = await postJson<BlogRunResponse>(
        `/projects/${selectedProjectId}/themes/${selectedThemeId}/posts:run`,
        { groupIds: [groupId] }
      );
      if (response.postsCreated > 0) {
        setToast({
          message: `${label} の${isRewrite ? 'リライト結果を公開しました' : '記事を公開しました'}`,
          type: 'success'
        });
      } else {
        setToast({
          message: isRewrite
            ? 'リライト対象が見つかりませんでした。アウトラインを見直してください。'
            : '記事作成対象が見つかりませんでした。アウトラインをご確認ください。',
          type: 'info'
        });
      }
    } catch (error) {
      console.error('Failed to generate article', error);
      const message =
        error instanceof Error && error.message
          ? `記事作成に失敗しました: ${error.message}`
          : '記事作成に失敗しました';
      setToast({ message, type: 'error' });
    } finally {
      setPostingGroupIds((prev) => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
    }
  };

  return (
    <AppShell title="Keywords 管理UI（デモ）">
      <div className="flex flex-col gap-6">
        <ProjectSelector
          projects={displayProjects}
          selectedProjectId={selectedProjectId}
          runningProjectIds={runningProjects}
          onSelect={(projectId) => {
            setSelectedProjectId(projectId);
            setSelectedThemeId(undefined);
          }}
          onRunProject={handleRunProject}
          onCreateProject={() => setProjectModal({ mode: 'create' })}
          onEditProject={(project) => setProjectModal({ mode: 'edit', project })}
        />

        {selectedProject ? (
          <ProjectSettingsPanel
            projectId={selectedProject.id}
            description={selectedProject.description}
            settings={selectedProject.settings ?? DEFAULT_PROJECT_SETTINGS}
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 shadow-sm transition hover:border-primary hover:text-primary"
                onClick={openCreateTheme}
              >
                テーマ追加
              </button>
              <button
                type="button"
                className="rounded-md border border-primary px-3 py-2 text-sm text-primary shadow-sm transition hover:bg-primary/10"
                onClick={() => setShowJobHistory(true)}
              >
                ジョブ履歴を見る
              </button>
            </div>
          </header>

          <ThemeTable
            themes={themes}
            selectedThemeId={selectedThemeId}
            onSelect={(themeId) => setSelectedThemeId(themeId)}
            onExpandCategory={(themeId) => {
              setSelectedThemeId(themeId);
              setShowNodeModal(true);
            }}
            onRunTheme={handleRunTheme}
            onRunOutline={handleRunOutline}
            onRunLinks={handleRunLinks}
            onEditTheme={(theme) => {
              setSelectedThemeId(theme.id);
              setThemeModal({ mode: 'edit', theme });
            }}
            runningThemeIds={runningThemes}
            runningOutlineIds={runningOutlineThemes}
            runningLinkIds={runningLinkThemes}
            activeNodesCount={selectedThemeId ? nodes.length : undefined}
          />
        </section>

        {selectedProject && selectedThemeId ? (
          <ThemeSettingsPanel
            projectId={selectedProject.id}
            projectDescription={selectedProject.description}
            themeId={selectedThemeId}
            nodes={nodes}
            projectDefaults={selectedProject.settings ?? DEFAULT_PROJECT_SETTINGS}
            themeSettings={selectedTheme?.settings}
            onSave={handleSaveThemeSettings}
            themeName={selectedTheme?.name}
          />
        ) : null}

        {selectedThemeId ? (
          <NodeList
            nodes={nodes}
            onAddNode={() => setShowNodeModal(true)}
            onDeleteNode={handleDeleteNode}
            onUpdateNodeStatus={handleUpdateNodeStatus}
          />
        ) : null}

          <GroupPanel
            groups={groups}
            selectedGroupIds={selectedGroupIds}
            onToggleGroupSelection={handleToggleGroupSelection}
            onSelectAllGroups={handleSelectAllGroups}
            onClearSelection={handleClearGroupSelection}
            onClearOutlines={handleClearGroupOutlines}
            onDeleteSelectedGroups={handleDeleteSelectedGroups}
            deletingGroups={deletingGroups}
            clearingOutlines={clearingOutlines}
            onCreateArticle={handleCreateArticle}
            postingGroupIds={postingGroupIds}
          />
      </div>

      <ProjectFormModal
        open={projectModal !== null}
        mode={projectModal?.mode ?? 'create'}
        initialProject={projectModal?.project}
        onClose={() => setProjectModal(null)}
        onSubmit={handleSubmitProjectForm}
      />
      <ThemeFormModal
        open={themeModal !== null}
        mode={themeModal?.mode ?? 'create'}
        initialTheme={themeModal?.theme}
        onClose={() => setThemeModal(null)}
        onSubmit={handleSubmitThemeForm}
      />
      <NodeCreateModal
        open={showNodeModal}
        onClose={() => setShowNodeModal(false)}
        onSave={handleAddNode}
      />
      <JobHistoryDialog
        open={showJobHistory}
        jobs={jobs}
        onClose={() => setShowJobHistory(false)}
      />

      <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
        {toast ? <Toast message={toast.message} type={toast.type} /> : null}
      </div>
    </AppShell>
  );
}
