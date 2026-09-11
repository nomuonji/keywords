const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const localApiHost = local ? '127.0.0.1' : window.location.hostname;
// Production ships a small, read-only Firestore endpoint at the same origin.
// The full commands API remains intentionally local-only.
const BASE = import.meta.env.VITE_API_BASE_URL ?? (local ? `${window.location.protocol}//${localApiHost}:8787` : window.location.origin);
let mutationTail = Promise.resolve();

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) }
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('APIサーバーに接続できません。起動状態を確認して、再試行してください。');
  }
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? response.statusText);
  return await response.json();
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return request<T>(path, options);
  }

  const previous = mutationTail;
  let release: () => void = () => undefined;
  mutationTail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    return await request<T>(path, options);
  } finally {
    release();
  }
}
