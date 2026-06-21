import { render } from 'preact';
import { App } from './Widget.js';
import { STYLES } from './styles.js';

/**
 * Bootstrap des einbettbaren Widgets. Liest tenant + Backend-URL aus dem
 * Script-Tag (<script src=".../w.js" data-tenant="KEY" data-api="https://chat…">)
 * und rendert in einen isolierten Shadow DOM, damit das Host-Theme nichts überschreibt.
 */
function init(): void {
  if (document.getElementById('kine-chat-root')) return; // doppelte Einbindung vermeiden

  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[data-tenant]');

  const siteKey = script?.dataset.tenant;
  if (!siteKey) {
    console.warn('[kine-chat] data-tenant fehlt – Widget wird nicht geladen.');
    return;
  }

  let apiBase = script?.dataset.api;
  if (!apiBase && script?.src) {
    try {
      apiBase = new URL(script.src).origin;
    } catch {
      /* ignore */
    }
  }
  apiBase = apiBase || window.location.origin;

  const host = document.createElement('div');
  host.id = 'kine-chat-root';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);
  const mount = document.createElement('div');
  shadow.appendChild(mount);

  render(<App siteKey={siteKey} apiBase={apiBase} />, mount);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
