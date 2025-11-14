const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '/api';

function buildUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const url = buildUrl(path);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text ||
        JSON.stringify({
          message: 'Request failed',
          url,
          status: response.status,
          statusText: response.statusText
        })
    );
  }
  return (await response.json()) as T;
}

export async function deleteRequest(path: string): Promise<void> {
  const url = buildUrl(path);
  const response = await fetch(url, {
    method: 'DELETE'
  });
  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(
      text ||
        JSON.stringify({
          message: 'Delete failed',
          url,
          status: response.status,
          statusText: response.statusText
        })
    );
  }
}

export async function suggestThemes(
  projectId: string,
  description: string
): Promise<string[]> {
  const path = `/projects/${projectId}/suggest-themes`;
  const { suggestions } = await postJson<{ suggestions: string[] }>(path, { description });
  return suggestions;
}

export async function suggestThemesGrok(
  projectId: string,
  description: string
): Promise<string[]> {
  const path = `/projects/${projectId}/suggest-themes-grok`;
  const { suggestions } = await postJson<{ suggestions: string[] }>(path, { description });
  return suggestions;
}

export async function suggestNodes(
  projectId: string,
  themeId: string,
  theme: string,
  existingNodes: string[],
  projectDescription: string
): Promise<string[]> {
  const path = `/projects/${projectId}/themes/${themeId}/suggest-nodes`;
  const { suggestions } = await postJson<{ suggestions: string[] }>(path, {
    projectDescription,
    theme,
    existingNodes
  });
  return suggestions;
}

export async function summarizeCluster(
  projectId: string,
  themeId: string,
  groupId: string
): Promise<any> {
  const path = `/projects/${projectId}/themes/${themeId}/groups/${groupId}/summarize-cluster`;
  return await postJson(path, {});
}

export async function summarizeClusterGrok(
  projectId: string,
  themeId: string,
  groupId: string
): Promise<any> {
  const path = `/projects/${projectId}/themes/${themeId}/groups/${groupId}/summarize-cluster-grok`;
  return await postJson(path, {});
}

export async function generateArticle(
  projectId: string,
  themeId: string,
  groupId: string
): Promise<any> {
  const path = `/projects/${projectId}/themes/${themeId}/groups/${groupId}/generate-article`;
  return await postJson(path, {});
}

export async function generateArticleGrok(
  projectId: string,
  themeId: string,
  groupId: string
): Promise<any> {
  const path = `/projects/${projectId}/themes/${themeId}/groups/${groupId}/generate-article-grok`;
  return await postJson(path, {});
}

export async function suggestNodesGrok(
  projectId: string,
  themeId: string,
  theme: string,
  existingNodes: string[],
  projectDescription: string
): Promise<string[]> {
  const path = `/projects/${projectId}/themes/${themeId}/suggest-nodes-grok`;
  const { suggestions } = await postJson<{ suggestions: string[] }>(path, {
    projectDescription,
    theme,
    existingNodes
  });
  return suggestions;
}
