import type { ServerResponse } from "node:http";
import type { RuntimeEvent } from "@qpilot/shared";

interface Client {
  id: string;
  res: ServerResponse;
}

export class SseHub {
  private readonly runClients = new Map<string, Set<Client>>();
  private heartbeatTimer: NodeJS.Timeout;

  constructor() {
    this.heartbeatTimer = setInterval(() => {
      const payload = `event: ping\ndata: {"ts":"${new Date().toISOString()}"}\n\n`;
      for (const clients of this.runClients.values()) {
        for (const client of clients) {
          client.res.write(payload);
        }
      }
    }, 15_000);
    this.heartbeatTimer.unref();
  }

  subscribe(runId: string, clientId: string, res: ServerResponse): void {
    const clients = this.runClients.get(runId) ?? new Set<Client>();
    clients.add({ id: clientId, res });
    this.runClients.set(runId, clients);
  }

  unsubscribe(runId: string, clientId: string): void {
    const clients = this.runClients.get(runId);
    if (!clients) {
      return;
    }
    for (const item of clients) {
      if (item.id === clientId) {
        clients.delete(item);
        break;
      }
    }
    if (clients.size === 0) {
      this.runClients.delete(runId);
    }
  }

  publish(event: RuntimeEvent): void {
    const clients = this.runClients.get(event.runId);
    if (!clients || clients.size === 0) {
      return;
    }

    const payload = `event: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
      client.res.write(payload);
    }
  }

  close(): void {
    clearInterval(this.heartbeatTimer);
    for (const clients of this.runClients.values()) {
      for (const client of clients) {
        client.res.end();
      }
    }
    this.runClients.clear();
  }
}
