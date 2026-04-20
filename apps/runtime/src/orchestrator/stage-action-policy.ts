import type {
  Action,
  LLMDecision,
  PageSnapshot,
  RunConfig,
  RunWorkingMemory
} from "@qpilot/shared";
import { assessGoalStageTransition, safeHost } from "./goal-alignment.js";

const AUTH_ACTION_PATTERN =
  /login|sign.?in|account|password|username|provider|authorize|oauth|qq|wechat|weixin|\u767b\u5f55|\u8d26\u53f7|\u5bc6\u7801|\u6388\u6743|\u0051\u0051|\u5fae\u4fe1/i;

const buildWaitAction = (language: RunConfig["language"], note: {
  zh: string;
  en: string;
}): Action => ({
  type: "wait",
  ms: 1500,
  note: language === "zh-CN" ? note.zh : note.en
});

const isAuthAction = (action: Action): boolean =>
  AUTH_ACTION_PATTERN.test(
    `${action.target ?? ""} ${action.note ?? ""} ${action.value ?? ""}`.toLowerCase()
  );

const buildWrongTargetRecovery = (input: {
  runConfig: RunConfig;
  snapshot: PageSnapshot;
}): Action[] => {
  const currentHost = safeHost(input.snapshot.url);
  const targetHost = safeHost(input.runConfig.targetUrl);

  const note =
    input.runConfig.language === "zh-CN"
      ? currentHost && targetHost && currentHost !== targetHost
        ? `当前站点 "${currentHost}" 与目标不一致，先回到 "${targetHost}" 对应入口重新开始`
        : "当前页面与目标阶段不一致，先回到目标入口重新开始"
      : currentHost && targetHost && currentHost !== targetHost
        ? `The current site "${currentHost}" does not match the target. Return to "${targetHost}" and restart from the intended entry.`
        : "The current page does not match the intended goal stage. Return to the target entry and restart.";

  return [
    {
      type: "navigate",
      target: input.runConfig.targetUrl,
      note
    },
    buildWaitAction(input.runConfig.language, {
      zh: "\u7b49\u5f85\u76ee\u6807\u5165\u53e3\u91cd\u65b0\u52a0\u8f7d",
      en: "Wait for the target entry page to load again"
    })
  ];
};

export const applyStageActionPolicy = (input: {
  snapshot: PageSnapshot;
  runConfig: RunConfig;
  decision: LLMDecision;
  workingMemory?: RunWorkingMemory;
}): LLMDecision => {
  const transition = assessGoalStageTransition({
    goal: input.runConfig.goal,
    snapshot: input.snapshot
  });

  const effectiveStage =
    transition.stage !== "unknown"
      ? transition.stage
      : input.workingMemory?.stage ?? "unknown";
  const effectiveAlignment =
    transition.alignment !== "unknown"
      ? transition.alignment
      : input.workingMemory?.alignment ?? "unknown";

  if (effectiveAlignment === "blocked" || effectiveStage === "security_challenge") {
    return {
      ...input.decision,
      actions: [
        buildWaitAction(input.runConfig.language, {
          zh: "\u5f53\u524d\u5904\u4e8e\u963b\u585e\u9636\u6bb5\uff0c\u5148\u7b49\u5f85\u4eba\u5de5\u5904\u7406\u6216\u9875\u9762\u72b6\u6001\u53d8\u5316",
          en: "The flow is currently blocked. Wait for manual resolution or a visible page-state change."
        })
      ],
      is_finished: false
    };
  }

  if (effectiveAlignment === "wrong_target") {
    return {
      ...input.decision,
      actions: buildWrongTargetRecovery({
        runConfig: input.runConfig,
        snapshot: input.snapshot
      }),
      is_finished: false
    };
  }

  if (effectiveStage === "authenticated_app" && effectiveAlignment === "aligned") {
    const hasAuthActions = input.decision.actions.some(isAuthAction);
    if (hasAuthActions || !input.decision.is_finished) {
      return {
        ...input.decision,
        plan: {
          strategy:
            input.runConfig.language === "zh-CN"
              ? "\u5f53\u524d\u5df2\u5728\u5bf9\u9f50\u7684\u8ba4\u8bc1\u540e\u5e94\u7528\u754c\u9762\uff0c\u76f4\u63a5\u5224\u5b9a\u5b8c\u6210"
              : "The run is already on the aligned authenticated application surface, so it can finish directly.",
          reason:
            input.runConfig.language === "zh-CN"
              ? "\u9636\u6bb5\u7b56\u7565\u62d2\u7edd\u5728\u6210\u529f\u6001\u5185\u7ee7\u7eed\u6267\u884c\u767b\u5f55/\u6388\u6743/\u8d26\u5bc6\u63d0\u4ea4\u7c7b\u52a8\u4f5c"
              : "The stage policy blocks further login, authorization, or credential-submission actions after success has already been reached."
        },
        actions: [],
        is_finished: true
      };
    }
  }

  return input.decision;
};
