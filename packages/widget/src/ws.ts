type Handler = (msg: Record<string, unknown>) => void;

/**
 * Besucher-WebSocket fürs Live-Empfangen von Agenten-Nachrichten und dem
 * Handoff-Status. Reconnect mit einfacher Verzögerung. Liefert eine close()-Fn.
 */
export function connectVisitorWs(
  apiBase: string,
  siteKey: string,
  conversationId: string,
  sessionId: string,
  onMessage: Handler,
): () => void {
  const wsBase = apiBase.replace(/^http/i, 'ws');
  const url =
    `${wsBase}/ws/visitor?siteKey=${encodeURIComponent(siteKey)}` +
    `&conversationId=${encodeURIComponent(conversationId)}&sessionId=${encodeURIComponent(sessionId)}`;

  let closed = false;
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    try {
      ws = new WebSocket(url);
    } catch {
      return;
    }
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (!closed) timer = setTimeout(open, 3000);
    };
    ws.onerror = () => {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  };
  open();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
  };
}
