/**
 * In-Memory Realtime-Hub für die Live-Übernahme (Phase 7). Verwaltet die offenen
 * WebSockets von Agenten (pro Tenant) und Besuchern (pro Konversation) und routet
 * Nachrichten dazwischen. Ausreichend für einen Einzel-Container (Mittwald). Für
 * Mehr-Instanz-Betrieb später durch Redis-Pub/Sub ersetzbar – gleiche Schnittstelle.
 */
export interface WsLike {
  send(data: string): void;
  readyState: number;
}

const OPEN = 1;

class Hub {
  private agents = new Map<string, Set<WsLike>>(); // tenantId -> Agenten-Sockets
  private visitors = new Map<string, Set<WsLike>>(); // conversationId -> Besucher-Sockets

  addAgent(tenantId: string, s: WsLike): void {
    let set = this.agents.get(tenantId);
    if (!set) this.agents.set(tenantId, (set = new Set()));
    set.add(s);
  }
  removeAgent(tenantId: string, s: WsLike): void {
    this.agents.get(tenantId)?.delete(s);
  }
  addVisitor(conversationId: string, s: WsLike): void {
    let set = this.visitors.get(conversationId);
    if (!set) this.visitors.set(conversationId, (set = new Set()));
    set.add(s);
  }
  removeVisitor(conversationId: string, s: WsLike): void {
    this.visitors.get(conversationId)?.delete(s);
  }

  private deliver(s: WsLike, obj: unknown): void {
    if (s.readyState !== OPEN) return;
    try {
      s.send(JSON.stringify(obj));
    } catch {
      /* defekte Verbindung ignorieren */
    }
  }

  broadcastToAgents(tenantId: string, obj: unknown): void {
    for (const s of this.agents.get(tenantId) ?? []) this.deliver(s, obj);
  }
  sendToVisitor(conversationId: string, obj: unknown): void {
    for (const s of this.visitors.get(conversationId) ?? []) this.deliver(s, obj);
  }
}

export const hub = new Hub();
