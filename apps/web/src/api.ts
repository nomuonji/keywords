const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) } });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? response.statusText);
  return response.json();
}
