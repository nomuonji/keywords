const baseUrl = import.meta.env.VITE_API_BASE_URL;

function ensureBaseUrl(): string {
  if (!baseUrl) {
    throw new Error('VITE_API_BASE_URL is not configured');
  }
  return baseUrl;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${ensureBaseUrl()}${path}`, {
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
  const response = await fetch(`${ensureBaseUrl()}${path}`, {
    method: 'DELETE'
  });
  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(text || `Delete failed with status ${response.status}`);
  }
}
