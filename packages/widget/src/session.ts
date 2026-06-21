/** Stabile, pro Tenant getrennte Session-ID im localStorage (für Konversations-Kontinuität). */
export function getSessionId(siteKey: string): string {
  const key = `kine-chat:sid:${siteKey}`;
  try {
    let v = localStorage.getItem(key);
    if (!v) {
      v = globalThis.crypto?.randomUUID?.() ?? `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, v);
    }
    return v.slice(0, 64);
  } catch {
    // Privater Modus o.ä. – Fallback ohne Persistenz
    return `s_${Date.now()}_${Math.random().toString(36).slice(2)}`.slice(0, 64);
  }
}
