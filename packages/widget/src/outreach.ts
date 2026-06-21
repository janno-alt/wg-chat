import type { OutreachTrigger } from '@kine-chat/shared';

/**
 * Clientseitige Outreach-Engine. Beobachtet Nutzerverhalten und feuert pro Trigger
 * höchstens EINMAL pro Session (Frequenz-Capping). Die Nachrichten sind vorgefertigt
 * → es entstehen KEINE LLM-Kosten, solange der Nutzer nicht selbst antwortet.
 */
export function startOutreach(
  triggers: OutreachTrigger[],
  siteKey: string,
  onFire: (t: OutreachTrigger) => void,
): () => void {
  const path = window.location.pathname || '/';
  const active = triggers.filter((t) => pathMatches(t.pageMatch, path) && !alreadyFired(siteKey, t.id));
  if (active.length === 0) return () => {};

  const cleanups: Array<() => void> = [];

  const fire = (t: OutreachTrigger) => {
    if (alreadyFired(siteKey, t.id)) return;
    markFired(siteKey, t.id);
    onFire(t);
  };

  for (const t of active) {
    switch (t.condition) {
      case 'time_on_page': {
        const id = window.setTimeout(() => fire(t), Math.max(0, t.threshold) * 1000);
        cleanups.push(() => clearTimeout(id));
        break;
      }
      case 'idle': {
        let id = window.setTimeout(() => fire(t), t.threshold * 1000);
        const reset = () => {
          clearTimeout(id);
          id = window.setTimeout(() => fire(t), t.threshold * 1000);
        };
        const evs = ['mousemove', 'keydown', 'scroll', 'touchstart'];
        evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
        cleanups.push(() => {
          clearTimeout(id);
          evs.forEach((e) => window.removeEventListener(e, reset));
        });
        break;
      }
      case 'scroll_depth': {
        const onScroll = () => {
          const h = document.documentElement;
          const depth = ((h.scrollTop + window.innerHeight) / h.scrollHeight) * 100;
          if (depth >= t.threshold) fire(t);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        cleanups.push(() => window.removeEventListener('scroll', onScroll));
        break;
      }
      case 'exit_intent': {
        const onLeave = (e: MouseEvent) => {
          if (e.clientY <= 0 && !e.relatedTarget) fire(t);
        };
        document.addEventListener('mouseout', onLeave);
        cleanups.push(() => document.removeEventListener('mouseout', onLeave));
        break;
      }
      case 'element_dwell': {
        if (!t.selector) break;
        const el = document.querySelector(t.selector);
        if (!el) break;
        let dwellTimer: number | null = null;
        const io = new IntersectionObserver((entries) => {
          for (const en of entries) {
            if (en.isIntersecting && dwellTimer === null) {
              dwellTimer = window.setTimeout(() => fire(t), Math.max(0, t.threshold) * 1000);
            } else if (!en.isIntersecting && dwellTimer !== null) {
              clearTimeout(dwellTimer);
              dwellTimer = null;
            }
          }
        });
        io.observe(el);
        cleanups.push(() => {
          if (dwellTimer !== null) clearTimeout(dwellTimer);
          io.disconnect();
        });
        break;
      }
    }
  }

  return () => cleanups.forEach((c) => c());
}

/** Prefix-Match: "/preise" matcht /preise und Unterpfade; "/" ist seitenweit. */
function pathMatches(pattern: string, path: string): boolean {
  if (!pattern || pattern === '/') return true;
  return path === pattern || path.startsWith(pattern.endsWith('/') ? pattern : `${pattern}/`) || path.startsWith(pattern);
}

function firedKey(siteKey: string): string {
  return `kine-chat:fired:${siteKey}`;
}
function firedSet(siteKey: string): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(firedKey(siteKey)) || '[]'));
  } catch {
    return new Set();
  }
}
function alreadyFired(siteKey: string, id: string): boolean {
  return firedSet(siteKey).has(id);
}
function markFired(siteKey: string, id: string): void {
  try {
    const s = firedSet(siteKey);
    s.add(id);
    sessionStorage.setItem(firedKey(siteKey), JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}
