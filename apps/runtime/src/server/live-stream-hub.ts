import type { CDPSession, Page } from "playwright";
import type { LiveStreamMessage, RunLivePhase } from "@qpilot/shared";

const SOCKET_OPEN = 1;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

interface LiveSocketLike {
  send: (payload: string) => void;
  close: () => void;
  readyState: number;
}

interface RunStreamViewer {
  id: string;
  socket: LiveSocketLike;
}

interface RunStreamMeta {
  phase?: RunLivePhase | "idle";
  stepIndex?: number;
  message?: string;
  pageUrl?: string;
  pageTitle?: string;
}

interface ScreencastFrameEvent {
  data: string;
  sessionId: number;
  metadata?: {
    deviceWidth?: number;
    deviceHeight?: number;
  };
}

interface RunStreamSource {
  page: Page;
  cdp: CDPSession | null;
  meta: RunStreamMeta;
  viewers: Map<string, RunStreamViewer>;
  frameSeq: number;
  lastFrameAt?: number;
  frameListener?: (event: ScreencastFrameEvent) => void;
  screencastActive: boolean;
  fallbackTimer: NodeJS.Timeout | null;
  fallbackCapturing: boolean;
}

const toNowIso = (): string => new Date().toISOString();

const safeSend = (socket: LiveSocketLike, payload: LiveStreamMessage): boolean => {
  if (socket.readyState !== SOCKET_OPEN) {
    return false;
  }

  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
};

export class LiveStreamHub {
  private readonly runs = new Map<string, RunStreamSource>();
  private readonly pendingViewers = new Map<string, Map<string, RunStreamViewer>>();
  private readonly fallbackIntervalMs = 900;

  registerRun(runId: string, page: Page): void {
    const existing = this.runs.get(runId);
    if (existing) {
      if (existing.page !== page) {
        void this.replaceRunPage(runId, page);
      } else {
        void this.ensureStreaming(runId);
      }
      return;
    }

    const pending = this.pendingViewers.get(runId) ?? new Map<string, RunStreamViewer>();
    const source: RunStreamSource = {
      page,
      cdp: null,
      meta: {},
      viewers: pending,
      frameSeq: 0,
      screencastActive: false,
      fallbackTimer: null,
      fallbackCapturing: false
    };

    this.runs.set(runId, source);
    this.pendingViewers.delete(runId);
    void this.ensureStreaming(runId);
  }

  private async replaceRunPage(runId: string, page: Page): Promise<void> {
    const source = this.runs.get(runId);
    if (!source) {
      return;
    }

    await this.stopScreencast(runId);

    if (source.frameListener && source.cdp) {
      source.cdp.off("Page.screencastFrame", source.frameListener);
    }
    await source.cdp?.detach().catch(() => undefined);

    source.page = page;
    source.cdp = null;
    source.frameListener = undefined;
    source.screencastActive = false;
    source.lastFrameAt = undefined;

    if (source.fallbackTimer) {
      clearInterval(source.fallbackTimer);
      source.fallbackTimer = null;
    }

    void this.ensureStreaming(runId);
  }

  async unregisterRun(runId: string): Promise<void> {
    const source = this.runs.get(runId);
    if (!source) {
      return;
    }

    await this.stopScreencast(runId);
    source.frameListener = undefined;
    source.cdp = null;

    if (source.fallbackTimer) {
      clearInterval(source.fallbackTimer);
      source.fallbackTimer = null;
    }

    this.runs.delete(runId);
  }

  updateRunMeta(runId: string, patch: Partial<RunStreamMeta>): void {
    const source = this.runs.get(runId);
    if (!source) {
      return;
    }

    source.meta = {
      ...source.meta,
      ...patch
    };
  }

  subscribe(runId: string, clientId: string, socket: LiveSocketLike): void {
    const viewer: RunStreamViewer = { id: clientId, socket };
    const source = this.runs.get(runId);
    if (source) {
      source.viewers.set(clientId, viewer);
      void this.ensureStreaming(runId);
      return;
    }

    const pending = this.pendingViewers.get(runId) ?? new Map<string, RunStreamViewer>();
    pending.set(clientId, viewer);
    this.pendingViewers.set(runId, pending);
  }

  unsubscribe(runId: string, clientId: string): void {
    const source = this.runs.get(runId);
    if (source) {
      source.viewers.delete(clientId);
      if (source.viewers.size === 0) {
        void this.stopScreencast(runId);
        if (source.fallbackTimer) {
          clearInterval(source.fallbackTimer);
          source.fallbackTimer = null;
        }
      }
    }

    const pending = this.pendingViewers.get(runId);
    if (pending) {
      pending.delete(clientId);
      if (pending.size === 0) {
        this.pendingViewers.delete(runId);
      }
    }
  }

  close(): void {
    for (const [runId, source] of this.runs) {
      void this.stopScreencast(runId);
      if (source.fallbackTimer) {
        clearInterval(source.fallbackTimer);
      }
      for (const viewer of source.viewers.values()) {
        viewer.socket.close();
      }
    }
    this.runs.clear();

    for (const viewers of this.pendingViewers.values()) {
      for (const viewer of viewers.values()) {
        viewer.socket.close();
      }
    }
    this.pendingViewers.clear();
  }

  private async ensureStreaming(runId: string): Promise<void> {
    const source = this.runs.get(runId);
    if (!source || source.viewers.size === 0) {
      return;
    }

    const cdpReady = await this.ensureCdpSession(runId);
    if (cdpReady) {
      await this.startScreencast(runId);
      return;
    }

    this.ensureFallbackLoop(runId);
    void this.captureFallback(runId);
  }

  private async ensureCdpSession(runId: string): Promise<boolean> {
    const source = this.runs.get(runId);
    if (!source) {
      return false;
    }

    if (source.cdp) {
      return true;
    }

    try {
      const cdp = await source.page.context().newCDPSession(source.page);
      const frameListener = (event: ScreencastFrameEvent) => {
        void this.handleScreencastFrame(runId, event);
      };
      cdp.on("Page.screencastFrame", frameListener);
      source.cdp = cdp;
      source.frameListener = frameListener;
      return true;
    } catch {
      source.cdp = null;
      source.frameListener = undefined;
      return false;
    }
  }

  private async startScreencast(runId: string): Promise<void> {
    const source = this.runs.get(runId);
    if (!source || source.screencastActive || source.viewers.size === 0 || !source.cdp) {
      return;
    }

    try {
      await source.cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 60,
        everyNthFrame: 1,
        maxWidth: DEFAULT_VIEWPORT.width,
        maxHeight: DEFAULT_VIEWPORT.height
      });
      source.screencastActive = true;
      if (source.fallbackTimer) {
        clearInterval(source.fallbackTimer);
        source.fallbackTimer = null;
      }
    } catch {
      source.screencastActive = false;
      this.ensureFallbackLoop(runId);
    }
  }

  private async stopScreencast(runId: string): Promise<void> {
    const source = this.runs.get(runId);
    if (!source || !source.cdp || !source.screencastActive) {
      return;
    }

    try {
      await source.cdp.send("Page.stopScreencast");
    } catch {
      // Ignore teardown errors during shutdown.
    } finally {
      source.screencastActive = false;
    }
  }

  private ensureFallbackLoop(runId: string): void {
    const source = this.runs.get(runId);
    if (!source || source.fallbackTimer || source.viewers.size === 0) {
      return;
    }

    source.fallbackTimer = setInterval(() => {
      void this.captureFallback(runId);
    }, this.fallbackIntervalMs);
    source.fallbackTimer.unref();
  }

  private async captureFallback(runId: string): Promise<void> {
    const source = this.runs.get(runId);
    if (!source || source.fallbackCapturing || source.viewers.size === 0) {
      return;
    }

    if (source.page.isClosed()) {
      await this.unregisterRun(runId);
      return;
    }

    source.fallbackCapturing = true;
    const startedAt = Date.now();

    try {
      const buffer = await source.page.screenshot({
        type: "jpeg",
        quality: 55,
        fullPage: false,
        animations: "disabled",
        scale: "css"
      });
      const finishedAt = Date.now();
      const viewport = source.page.viewportSize() ?? DEFAULT_VIEWPORT;

      this.broadcastFrame(runId, {
        transport: "snapshot",
        imageData: buffer.toString("base64"),
        width: viewport.width,
        height: viewport.height,
        startedAt,
        finishedAt
      });
    } catch {
      // Best-effort fallback only. The next capture will retry automatically.
    } finally {
      source.fallbackCapturing = false;
    }
  }

  private async handleScreencastFrame(
    runId: string,
    event: ScreencastFrameEvent
  ): Promise<void> {
    const source = this.runs.get(runId);
    if (!source) {
      return;
    }

    try {
      if (source.viewers.size === 0) {
        await this.stopScreencast(runId);
        return;
      }

      const finishedAt = Date.now();
      const startedAt = source.lastFrameAt ?? finishedAt;
      const viewport = source.page.viewportSize() ?? DEFAULT_VIEWPORT;
      const width = Math.round(event.metadata?.deviceWidth ?? viewport.width);
      const height = Math.round(event.metadata?.deviceHeight ?? viewport.height);

      this.broadcastFrame(runId, {
        transport: "screencast",
        imageData: event.data,
        width,
        height,
        startedAt,
        finishedAt
      });
    } finally {
      await source.cdp
        ?.send("Page.screencastFrameAck", {
          sessionId: event.sessionId
        })
        .catch(() => undefined);
    }
  }

  private broadcastFrame(
    runId: string,
    input: {
      transport: "screencast" | "snapshot";
      imageData: string;
      width?: number;
      height?: number;
      startedAt: number;
      finishedAt: number;
    }
  ): void {
    const source = this.runs.get(runId);
    if (!source) {
      return;
    }

    source.frameSeq += 1;
    const deltaMs = source.lastFrameAt
      ? Math.max(1, input.finishedAt - source.lastFrameAt)
      : this.fallbackIntervalMs;
    const fps = Number((1000 / deltaMs).toFixed(2));
    source.lastFrameAt = input.finishedAt;
    const ts = toNowIso();

    const framePayload: LiveStreamMessage = {
      type: "run.frame",
      runId,
      ts,
      data: {
        mimeType: "image/jpeg",
        imageData: input.imageData,
        frameSeq: source.frameSeq,
        transport: input.transport,
        width: input.width,
        height: input.height,
        phase: source.meta.phase as RunLivePhase | undefined,
        stepIndex: source.meta.stepIndex,
        pageUrl: source.meta.pageUrl,
        pageTitle: source.meta.pageTitle,
        message: source.meta.message
      }
    };

    const metricPayload: LiveStreamMessage = {
      type: "run.metric",
      runId,
      ts,
      data: {
        fps,
        captureMs: Math.max(1, input.finishedAt - input.startedAt),
        viewerCount: source.viewers.size,
        transport: input.transport,
        width: input.width,
        height: input.height,
        phase: source.meta.phase as RunLivePhase | undefined,
        stepIndex: source.meta.stepIndex,
        pageUrl: source.meta.pageUrl,
        pageTitle: source.meta.pageTitle
      }
    };

    for (const [viewerId, viewer] of source.viewers) {
      const frameOk = safeSend(viewer.socket, framePayload);
      const metricOk = safeSend(viewer.socket, metricPayload);
      if (!frameOk || !metricOk) {
        source.viewers.delete(viewerId);
      }
    }

    if (source.viewers.size === 0) {
      void this.stopScreencast(runId);
      if (source.fallbackTimer) {
        clearInterval(source.fallbackTimer);
        source.fallbackTimer = null;
      }
    }
  }
}
