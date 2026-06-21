/**
 * Schmaler Admin-Client für den MCP-Server. Spricht die gesicherte Admin-REST-API
 * des Backends (x-admin-key) – KEINE direkte DB-/LLM-Anbindung. So bleibt die
 * gesamte Logik (Kaskade, Ingestion, Kosten) an einer Stelle im Backend.
 */
const API = (process.env.WG_CHAT_API ?? 'http://localhost:8787').replace(/\/$/, '');
const KEY = process.env.WG_CHAT_ADMIN_KEY ?? '';

export const apiBase = API;
export const hasKey = Boolean(KEY);

export async function adminFetch<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  if (!KEY) {
    throw new Error('WG_CHAT_ADMIN_KEY ist nicht gesetzt – Admin-Zugriff nicht möglich.');
  }
  const res = await fetch(`${API}/api/admin${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-admin-key': KEY },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error((json as { message?: string })?.message || `${res.status} ${res.statusText}`);
  }
  return json as T;
}
