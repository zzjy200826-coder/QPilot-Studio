import type { ApplicationEvent } from "../domain/schemas.js";

type StreamWriter = {
  write: (chunk: string) => void;
};

export class ApplicationEventHub {
  private readonly subscribers = new Map<string, Map<string, StreamWriter>>();

  subscribe(attemptId: string, clientId: string, writer: StreamWriter): void {
    const bucket = this.subscribers.get(attemptId) ?? new Map<string, StreamWriter>();
    bucket.set(clientId, writer);
    this.subscribers.set(attemptId, bucket);
  }

  unsubscribe(attemptId: string, clientId: string): void {
    const bucket = this.subscribers.get(attemptId);
    if (!bucket) {
      return;
    }

    bucket.delete(clientId);
    if (bucket.size === 0) {
      this.subscribers.delete(attemptId);
    }
  }

  publish(event: ApplicationEvent): void {
    const bucket = this.subscribers.get(event.attemptId);
    if (!bucket) {
      return;
    }

    const payload = `event: application-event\ndata: ${JSON.stringify(event)}\n\n`;
    for (const [, writer] of bucket) {
      writer.write(payload);
    }
  }
}
