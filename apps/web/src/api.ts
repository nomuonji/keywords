const BASE = import.meta.env.VITE_API_BASE_URL ?? `${window.location.protocol}//${window.location.hostname}:8787`;
let requestTail = Promise.resolve();

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const previous = requestTail;
  let release: () => void = () => undefined;
  requestTail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    const response = await fetch(`${BASE}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) } });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? response.statusText);
    return await response.json();
  } finally {
    release();
  }
}
