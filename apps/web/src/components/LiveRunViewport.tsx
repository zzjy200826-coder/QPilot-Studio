import { useEffect, useRef, useState } from "react";
import type { LiveStreamMessage, RunLivePhase } from "@qpilot/shared";
import { useI18n } from "../i18n/I18nProvider";
import { api } from "../lib/api";

type ViewportConnectionState = "connecting" | "live" | "reconnecting" | "closed";
type LiveTransport = "screencast" | "snapshot";

interface LiveRunViewportProps {
  runId: string;
  enabled: boolean;
  fallbackScreenshot?: string;
  currentStepNumber: number;
  phase: RunLivePhase | "idle";
  autoFollow: boolean;
  pageTitle: string;
  pageUrl?: string;
  runHeaded?: boolean;
}

const reconnectDelay = (attempt: number): number => Math.min(4_000, 600 * attempt);

export const LiveRunViewport = ({
  runId,
  enabled,
  fallbackScreenshot,
  currentStepNumber,
  phase,
  autoFollow,
  pageTitle,
  pageUrl,
  runHeaded
}: LiveRunViewportProps) => {
  const { formatDateTime, pick } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const [connection, setConnection] = useState<ViewportConnectionState>(
    enabled ? "connecting" : "closed"
  );
  const [hasLiveFrame, setHasLiveFrame] = useState(false);
  const [fps, setFps] = useState<number | null>(null);
  const [captureMs, setCaptureMs] = useState<number | null>(null);
  const [viewerCount, setViewerCount] = useState<number | null>(null);
  const [transport, setTransport] = useState<LiveTransport | null>(null);
  const [lastFrameTs, setLastFrameTs] = useState<string | null>(null);
  const [livePageTitle, setLivePageTitle] = useState<string | null>(null);
  const [livePageUrl, setLivePageUrl] = useState<string | null>(null);

  useEffect(() => {
    const clearRetry = (): void => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const closeSocket = (): void => {
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState < WebSocket.CLOSING) {
        socket.close();
      }
    };

    if (!enabled || !runId) {
      clearRetry();
      closeSocket();
      setConnection("closed");
      setHasLiveFrame(false);
      setFps(null);
      setCaptureMs(null);
      setViewerCount(null);
      setTransport(null);
      setLastFrameTs(null);
      setLivePageTitle(null);
      setLivePageUrl(null);
      return () => undefined;
    }

    let disposed = false;
    let attempts = 0;
    setLivePageTitle(null);
    setLivePageUrl(null);

    const scheduleReconnect = (): void => {
      if (disposed) {
        return;
      }

      clearRetry();
      attempts += 1;
      setConnection("reconnecting");
      retryTimerRef.current = window.setTimeout(() => {
        connect();
      }, reconnectDelay(attempts));
    };

    const connect = (): void => {
      if (disposed) {
        return;
      }

      clearRetry();
      closeSocket();
      setConnection(attempts === 0 ? "connecting" : "reconnecting");
      const socket = api.createRunLiveSocket(runId);
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) {
          socket.close();
          return;
        }
        attempts = 0;
        setConnection("live");
      };

      socket.onclose = () => {
        if (disposed) {
          return;
        }
        scheduleReconnect();
      };

      socket.onerror = () => {
        if (!disposed) {
          socket.close();
        }
      };

      socket.onmessage = (event) => {
        if (disposed) {
          return;
        }

        try {
          const payload = JSON.parse(event.data) as LiveStreamMessage;
          if (payload.type === "run.metric") {
            setFps(payload.data.fps);
            setCaptureMs(payload.data.captureMs);
            setViewerCount(payload.data.viewerCount);
            setTransport(payload.data.transport);
            setLivePageTitle(payload.data.pageTitle ?? null);
            setLivePageUrl(payload.data.pageUrl ?? null);
            return;
          }

          const canvas = canvasRef.current;
          if (!canvas) {
            return;
          }

          const image = new Image();
          image.onload = () => {
            const width = payload.data.width ?? image.width;
            const height = payload.data.height ?? image.height;
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            if (!context) {
              return;
            }
            context.clearRect(0, 0, width, height);
            context.drawImage(image, 0, 0, width, height);
            setTransport(payload.data.transport);
            setHasLiveFrame(true);
            setLastFrameTs(payload.ts);
            setLivePageTitle(payload.data.pageTitle ?? null);
            setLivePageUrl(payload.data.pageUrl ?? null);
          };
          image.src = `data:${payload.data.mimeType};base64,${payload.data.imageData}`;
        } catch {
          // Ignore malformed messages from the wire.
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      clearRetry();
      closeSocket();
      setConnection("closed");
    };
  }, [enabled, runId]);

  const fallbackUrl = fallbackScreenshot ? `${api.runtimeBase}${fallbackScreenshot}` : null;
  const phaseLabel =
    phase === "booting"
      ? pick("booting", "启动中")
      : phase === "sensing"
        ? pick("sensing", "感知中")
        : phase === "planning"
          ? pick("planning", "规划中")
          : phase === "drafting"
            ? pick("drafting", "等待草案处理")
            : phase === "executing"
              ? pick("executing", "执行中")
              : phase === "verifying"
                ? pick("verifying", "校验中")
                : phase === "paused"
                  ? pick("paused", "已暂停")
                  : phase === "manual"
                    ? pick("manual", "等待人工处理")
                    : phase === "persisting"
                      ? pick("persisting", "保存中")
                      : phase === "reporting"
                        ? pick("reporting", "生成报告中")
                        : phase === "finished"
                          ? pick("finished", "已完成")
                          : pick("idle", "空闲");
  const connectionLabel =
    connection === "live"
      ? transport === "screencast"
        ? pick("WS video live", "WS 视频直播")
        : pick("WS frame fallback", "WS 帧回退")
      : connection === "reconnecting"
        ? pick("Reconnecting feed", "正在重连画面流")
        : connection === "connecting"
          ? pick("Connecting feed", "正在连接画面流")
          : pick("Playback mode", "回放模式");

  return (
    <div className="relative mt-4 min-h-[56vh] overflow-hidden rounded-[28px] border border-slate-200 bg-slate-950">
      {hasLiveFrame ? (
        <>
          <canvas ref={canvasRef} className="h-full min-h-[56vh] w-full object-contain" />
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-[linear-gradient(180deg,rgba(2,6,23,0.78),rgba(2,6,23,0))] p-4">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-white/14 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
                {transport === "screencast"
                  ? pick("Live video stream", "实时视频流")
                  : pick("Snapshot fallback", "截图回退")}
              </span>
              <span className="rounded-full bg-white/14 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
                {pick(`Step #${currentStepNumber}`, `步骤 #${currentStepNumber}`)}
              </span>
              <span className="rounded-full bg-white/14 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
                {fps ? `${fps.toFixed(1)} fps` : pick("warming up", "预热中")}
              </span>
              <span className="rounded-full bg-white/14 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
                {captureMs
                  ? pick(`${captureMs} ms capture`, `${captureMs} ms 采集`)
                  : pick("capturing", "采集中")}
              </span>
              <span className="rounded-full bg-white/14 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
                {pick(
                  `${viewerCount ?? 1} viewer${viewerCount === 1 ? "" : "s"}`,
                  `${viewerCount ?? 1} 位查看者`
                )}
              </span>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <span className="rounded-full bg-white/14 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
                {connectionLabel}
              </span>
              <span className="rounded-full bg-white/14 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
                {autoFollow ? pick("Following latest", "跟随最新") : pick("Inspecting history", "查看历史")}
              </span>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,rgba(2,6,23,0),rgba(2,6,23,0.82))] p-4 text-white">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{livePageTitle ?? pageTitle}</p>
                <p className="mt-1 truncate text-xs text-white/80">{livePageUrl ?? pageUrl}</p>
              </div>
              <span className="rounded-full bg-white/14 px-3 py-1 text-[11px] font-medium text-white/90 backdrop-blur">
                {lastFrameTs
                  ? formatDateTime(lastFrameTs, pick("receiving", "接收中"))
                  : pick("receiving", "接收中")}
              </span>
            </div>
          </div>
        </>
      ) : fallbackUrl ? (
        <>
          <img
            src={fallbackUrl}
            alt={`step-${currentStepNumber}`}
            className="h-full min-h-[56vh] w-full object-contain"
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-[linear-gradient(180deg,rgba(2,6,23,0.72),rgba(2,6,23,0))] p-4">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-white/14 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
                {enabled ? pick("Waiting for live frames", "等待实时画面") : pick("Recorded evidence", "已保存证据")}
              </span>
              <span className="rounded-full bg-white/14 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
                {pick(`Step #${currentStepNumber}`, `步骤 #${currentStepNumber}`)}
              </span>
              <span className="rounded-full bg-white/14 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
                {phaseLabel}
              </span>
            </div>
            <span className="rounded-full bg-white/14 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
              {enabled ? connectionLabel : pick("Playback mode", "回放模式")}
            </span>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,rgba(2,6,23,0),rgba(2,6,23,0.82))] p-4 text-white">
            <p className="text-sm font-medium">{livePageTitle ?? pageTitle}</p>
            <p className="mt-1 truncate text-xs text-white/80">{livePageUrl ?? pageUrl}</p>
          </div>
        </>
      ) : (
        <div className="flex min-h-[56vh] flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="flex gap-2">
            <span className="h-3 w-3 animate-pulse rounded-full bg-sky-400" />
            <span className="h-3 w-3 animate-pulse rounded-full bg-cyan-300 [animation-delay:120ms]" />
            <span className="h-3 w-3 animate-pulse rounded-full bg-emerald-300 [animation-delay:240ms]" />
          </div>
          <div className="space-y-2">
            <p className="text-lg font-semibold text-white">
              {enabled
                ? pick("Live browser feed is starting.", "实时浏览器画面正在启动。")
                : pick("No browser evidence yet.", "暂时还没有浏览器证据。")}
            </p>
            <p className="text-sm text-slate-300">
              {runHeaded
                ? pick(
                    "A visible Chromium window should also be open locally for manual takeover.",
                    "本地也会打开一个可见的 Chromium 窗口，方便你人工接管。"
                  )
                : pick(
                    "The first recorded frame will appear here automatically.",
                    "第一帧记录画面会自动出现在这里。"
                  )}
            </p>
            <p className="text-xs text-slate-400">
              {enabled
                ? connection === "reconnecting"
                  ? pick(
                      "The stream dropped for a moment and is reconnecting.",
                      "画面流刚刚短暂中断，正在重新连接。"
                    )
                  : pick(
                      "Once the runtime emits the first frame, this viewport will switch to live video.",
                      "一旦 runtime 推出第一帧，这里就会自动切换成实时画面。"
                    )
                : pick(
                    "Finished runs replay their saved evidence here.",
                    "已结束的运行会在这里回放保存下来的证据。"
                  )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
