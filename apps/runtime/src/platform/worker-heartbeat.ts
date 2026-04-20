import type {
  InjectorWorker,
  LoadRunWorker,
  WorkerHeartbeatState
} from "@qpilot/shared";

export const getWorkerHeartbeatState = (params: {
  lastHeartbeatAt?: string;
  timeoutMs: number;
  now?: number;
}): {
  state: WorkerHeartbeatState;
  ageMs?: number;
} => {
  if (!params.lastHeartbeatAt) {
    return { state: "missing" };
  }

  const heartbeatTs = Date.parse(params.lastHeartbeatAt);
  if (Number.isNaN(heartbeatTs)) {
    return { state: "missing" };
  }

  const ageMs = Math.max(0, (params.now ?? Date.now()) - heartbeatTs);
  return {
    state: ageMs > params.timeoutMs ? "stale" : "fresh",
    ageMs
  };
};

export const summarizeInjectorWorkerHealth = (params: {
  workers: InjectorWorker[];
  timeoutMs: number;
  now?: number;
}): {
  timeoutMs: number;
  busyWorkers: number;
  staleWorkers: number;
  freshestHeartbeatAt?: string;
} => {
  const now = params.now ?? Date.now();
  const busyWorkers = params.workers.filter((worker) => worker.status === "busy");
  const staleWorkers = busyWorkers.filter((worker) => {
    const heartbeat = getWorkerHeartbeatState({
      lastHeartbeatAt: worker.lastHeartbeatAt,
      timeoutMs: params.timeoutMs,
      now
    });
    return heartbeat.state === "stale" || heartbeat.state === "missing";
  }).length;

  const freshestHeartbeatAt = params.workers
    .map((worker) => worker.lastHeartbeatAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0];

  return {
    timeoutMs: params.timeoutMs,
    busyWorkers: busyWorkers.length,
    staleWorkers,
    freshestHeartbeatAt
  };
};

export const enrichLoadRunWorkersWithHeartbeat = (params: {
  workers: LoadRunWorker[];
  injectorWorkers: InjectorWorker[];
  timeoutMs: number;
  now?: number;
}): LoadRunWorker[] => {
  const injectorById = new Map(params.injectorWorkers.map((worker) => [worker.id, worker]));
  const now = params.now ?? Date.now();

  return params.workers.map((worker) => {
    const injectorWorker = worker.injectorWorkerId
      ? injectorById.get(worker.injectorWorkerId)
      : undefined;
    const heartbeat = getWorkerHeartbeatState({
      lastHeartbeatAt: injectorWorker?.lastHeartbeatAt,
      timeoutMs: params.timeoutMs,
      now
    });

    return {
      ...worker,
      lastHeartbeatAt: injectorWorker?.lastHeartbeatAt,
      heartbeatState: heartbeat.state,
      heartbeatAgeMs: heartbeat.ageMs
    };
  });
};
