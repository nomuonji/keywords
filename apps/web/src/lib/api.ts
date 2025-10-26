export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function deleteRequest(path: string): Promise<void> {
  const response = await fetch(`/api${path}`, {
    method: 'DELETE'
  });
  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(text || `Delete failed with status ${response.status}`);
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

export async function suggestNodes(
  projectId: string,
  themeId: string,
  theme: string,
  existingNodes: string[]
): Promise<string[]> {
  const path = `/projects/${projectId}/themes/${themeId}/suggest-nodes`;
  const { suggestions } = await postJson<{ suggestions: string[] }>(path, {
    theme,
    existingNodes
  });
  return suggestions;
}
