import type { Action, Language } from "@qpilot/shared";

const localize = (language: Language | undefined, english: string, chinese: string): string =>
  language === "zh-CN" ? chinese : english;

const describeDismissed = (
  language: Language | undefined,
  dismissed: string[]
): string =>
  dismissed.length > 0
    ? localize(language, `, dismissed=${dismissed.join("|")}`, `, \u5df2\u5173\u95ed=${dismissed.join("|")}`)
    : "";

export const runtimeText = (language?: Language) => ({
  pausedObservation: localize(
    language,
    "Run paused from the desktop control bar.",
    "\u8fd0\u884c\u5df2\u901a\u8fc7\u684c\u9762\u63a7\u5236\u680f\u6682\u505c\u3002"
  ),
  pausedMessage: localize(
    language,
    "Execution paused. Resume when you are ready to continue.",
    "\u6267\u884c\u5df2\u6682\u505c\u3002\u51c6\u5907\u597d\u540e\u53ef\u4ee5\u7ee7\u7eed\u3002"
  ),
  missingApiKey: localize(
    language,
    "OPENAI_API_KEY is not configured. Please update .env before creating runs.",
    "\u5c1a\u672a\u914d\u7f6e OPENAI_API_KEY\u3002\u8bf7\u5148\u66f4\u65b0 .env \u518d\u521b\u5efa Run\u3002"
  ),
  bootingBrowser: localize(
    language,
    "Browser session started. Opening target page.",
    "\u6d4f\u89c8\u5668\u4f1a\u8bdd\u5df2\u542f\u52a8\uff0c\u6b63\u5728\u6253\u5f00\u76ee\u6807\u9875\u9762\u3002"
  ),
  loadedSessionProfile: (profile: string) =>
    localize(
      language,
      `Loaded session profile "${profile}" and captured the startup page.`,
      `\u5df2\u52a0\u8f7d\u4f1a\u8bdd Profile "${profile}" \u5e76\u6355\u83b7\u542f\u52a8\u9875\u9762\u3002`
    ),
  startupCaptured: localize(
    language,
    "Startup page captured before the first planning cycle.",
    "\u9996\u6b21\u89c4\u5212\u524d\u5df2\u6355\u83b7\u542f\u52a8\u9875\u9762\u3002"
  ),
  sessionLoaded: (profile: string) =>
    localize(
      language,
      `Session "${profile}" loaded.`,
      `\u5df2\u52a0\u8f7d\u4f1a\u8bdd "${profile}"\u3002`
    ),
  initialPageReady: localize(
    language,
    "Initial page ready for planning.",
    "\u521d\u59cb\u9875\u9762\u5df2\u51c6\u5907\u597d\uff0c\u53ef\u4ee5\u5f00\u59cb\u89c4\u5212\u3002"
  ),
  visibleStartupCaptured: localize(
    language,
    "Visible browser opened. Startup evidence captured.",
    "\u5df2\u6253\u5f00\u53ef\u89c1\u6d4f\u89c8\u5668\uff0c\u5e76\u6355\u83b7\u542f\u52a8\u8bc1\u636e\u3002"
  ),
  headlessStartupCaptured: localize(
    language,
    "Target page loaded. Startup evidence captured.",
    "\u76ee\u6807\u9875\u9762\u5df2\u52a0\u8f7d\uff0c\u5e76\u6355\u83b7\u542f\u52a8\u8bc1\u636e\u3002"
  ),
  resumeFromStartup: localize(
    language,
    "Resuming from the last captured startup state.",
    "\u6b63\u4ece\u4e0a\u4e00\u6b21\u6355\u83b7\u7684\u542f\u52a8\u72b6\u6001\u7ee7\u7eed\u3002"
  ),
  resumeGeneralPlanning: localize(
    language,
    "Resuming general planning after the pause.",
    "\u6682\u505c\u540e\u6b63\u5728\u7ee7\u7eed\u901a\u7528\u89c4\u5212\u3002"
  ),
  defaultBlockedPageReason: localize(
    language,
    "A manual challenge is blocking the page.",
    "\u5f53\u524d\u9875\u9762\u88ab\u4eba\u5de5\u9a8c\u8bc1\u5173\u5361\u62e6\u622a\u3002"
  ),
  manualReviewBeforePlanning: localize(
    language,
    "Manual review required before planning can continue. Solve it in the visible browser, then click Resume.",
    "\u7ee7\u7eed\u89c4\u5212\u4e4b\u524d\u9700\u8981\u4eba\u5de5\u590d\u6838\u3002\u8bf7\u5728\u53ef\u89c1\u6d4f\u89c8\u5668\u91cc\u5148\u5b8c\u6210\u5904\u7406\uff0c\u7136\u540e\u70b9\u51fb\u7ee7\u7eed\u3002"
  ),
  securityChallengeDetected: localize(
    language,
    "Security challenge detected.",
    "\u68c0\u6d4b\u5230\u5b89\u5168\u9a8c\u8bc1\u6311\u6218\u3002"
  ),
  captureBeforePlanning: localize(
    language,
    "Capturing the current page before planning the next actions.",
    "\u6b63\u5728\u4e3a\u4e0b\u4e00\u8f6e\u89c4\u5212\u6355\u83b7\u5f53\u524d\u9875\u9762\u3002"
  ),
  snapshotSentToPlanner: localize(
    language,
    "Snapshot captured. Sending page context to the planner.",
    "\u5df2\u6355\u83b7\u5feb\u7167\uff0c\u6b63\u5728\u628a\u9875\u9762\u4e0a\u4e0b\u6587\u53d1\u9001\u7ed9\u89c4\u5212\u5668\u3002"
  ),
  plannerCacheHit: localize(
    language,
    "Planner cache hit. Reusing a previous decision for the same page state.",
    "\u547d\u4e2d Planner \u7f13\u5b58\uff0c\u6b63\u5728\u590d\u7528\u76f8\u540c\u9875\u9762\u72b6\u6001\u7684\u65e7\u51b3\u7b56\u3002"
  ),
  plannerFreshDecision: localize(
    language,
    "Planner returned a fresh decision for the current page state.",
    "\u5f53\u524d\u9875\u9762\u72b6\u6001\u5df2\u751f\u6210\u65b0\u7684 Planner \u51b3\u7b56\u3002"
  ),
  templateReplayMatched: (title: string, score: number) =>
    localize(
      language,
      `Matched case template "${title}" (${Math.round(score * 100)}% confidence). Reusing stored steps before calling the planner.`,
      `\u5df2\u547d\u4e2d Case \u6a21\u677f\u201c${title}\u201d\uff08\u7f6e\u4fe1\u5ea6 ${Math.round(score * 100)}%\uff09\uff0c\u4f18\u5148\u590d\u7528\u5df2\u6c89\u6dc0\u7684\u6b65\u9aa4\u540e\u518d\u51b3\u5b9a\u662f\u5426\u8c03\u7528 Planner\u3002`
    ),
  replayingCaseTemplate: (title: string) =>
    localize(
      language,
      `Replaying case template "${title}" without invoking the planner.`,
      `\u6b63\u5728\u56de\u653e Case \u6a21\u677f\u201c${title}\u201d\uff0c\u6682\u4e0d\u8c03\u7528 Planner\u3002`
    ),
  templateReplayFallback: (title: string, category?: string) =>
    localize(
      language,
      `Case template "${title}" drifted${category ? ` (${category})` : ""}. Falling back to live planner recovery.`,
      `Case \u6a21\u677f\u201c${title}\u201d\u5df2\u504f\u822a${category ? `\uff08${category}\uff09` : ""}\uff0c\u6b63\u5728\u56de\u9000\u5230 Planner \u5b9e\u65f6\u63a5\u7ba1\u3002`
    ),
  awaitingDraftApproval: localize(
    language,
    "Next action drafted. Waiting for approval before execution.",
    "\u4e0b\u4e00\u6b65\u52a8\u4f5c\u5df2\u751f\u6210\uff0c\u6b63\u5728\u7b49\u5f85\u6279\u51c6\u540e\u6267\u884c\u3002"
  ),
  abortingRun: localize(
    language,
    "Abort requested. Closing the browser and ending the run.",
    "\u5df2\u8bf7\u6c42\u7ec8\u6b62\uff0c\u6b63\u5728\u5173\u95ed\u6d4f\u89c8\u5668\u5e76\u7ed3\u675f\u8fd9\u6b21\u8fd0\u884c\u3002"
  ),
  nextActionDrafted: (action: Action) =>
    localize(
      language,
      `Next action drafted: ${action.type}${action.target ? ` ${action.target}` : ""}`.trim(),
      `\u5df2\u751f\u6210\u4e0b\u4e00\u6b65\u52a8\u4f5c\uff1a${action.type}${action.target ? ` ${action.target}` : ""}`.trim()
    ),
  draftSkippedObservation: localize(
    language,
    "Draft action skipped. Re-planning from the current page state.",
    "\u5df2\u8df3\u8fc7\u5f53\u524d\u8349\u7a3f\u52a8\u4f5c\uff0c\u6b63\u5728\u57fa\u4e8e\u5f53\u524d\u9875\u9762\u91cd\u65b0\u89c4\u5212\u3002"
  ),
  replanningAfterStepFailure: (category?: string) =>
    localize(
      language,
      `The last action ended with ${category ?? "an ineffective result"}. Re-planning before executing any more queued steps.`,
      `\u4e0a\u4e00\u6b65\u51fa\u73b0${category ?? "\u65e0\u6548\u7ed3\u679c"}\uff0c\u4e3a\u907f\u514d\u7ee7\u7eed\u6267\u884c\u8fc7\u671f\u52a8\u4f5c\uff0c\u6b63\u5728\u91cd\u65b0\u89c4\u5212\u3002`
    ),
  repeatedIneffectiveActions: (count: number, host?: string, surface?: string) =>
    localize(
      language,
      `Detected ${count} consecutive ineffective attempts${host ? ` on ${host}` : ""}${surface ? ` (surface=${surface})` : ""}. Stopping to avoid more random clicks.`,
      `\u5df2\u68c0\u6d4b\u5230${count}\u6b21\u8fde\u7eed\u65e0\u6548\u5c1d\u8bd5${host ? `\uff08${host}\uff09` : ""}${surface ? `\uff0csurface=${surface}` : ""}\uff0c\u4e3a\u907f\u514d\u7ee7\u7eed\u4e71\u70b9\uff0c\u5c06\u5148\u6682\u505c\u81ea\u52a8\u5316\u3002`
    ),
  credentialValidationFailed: (detail: string) =>
    localize(
      language,
      `Credential validation failed: ${detail}. Stopping to avoid retrying the same rejected login.`,
      `\u68c0\u6d4b\u5230\u767b\u5f55\u6821\u9a8c\u5931\u8d25\uff1a${detail}\u3002\u4e3a\u907f\u514d\u91cd\u590d\u63d0\u4ea4\u540c\u4e00\u7ec4\u88ab\u62d2\u7edd\u7684\u8d26\u53f7\uff0c\u8fd0\u884c\u5c06\u505c\u6b62\u3002`
    ),
  extractingCases: localize(
    language,
    "Extracting reusable UI/API cases from the successful run.",
    "\u6b63\u5728\u4ece\u6210\u529f\u8fd0\u884c\u4e2d\u63d0\u53d6\u53ef\u590d\u7528\u7684 UI/API case\u3002"
  ),
  resumeActionExecution: localize(
    language,
    "Resuming action execution after the pause.",
    "\u6682\u505c\u540e\u6b63\u5728\u7ee7\u7eed\u6267\u884c\u52a8\u4f5c\u3002"
  ),
  stoppedAtMaxSteps: (maxSteps: number) =>
    localize(
      language,
      `Stopped after reaching maxSteps=${maxSteps}`,
      `\u5df2\u5728\u8fbe\u5230 maxSteps=${maxSteps} \u540e\u505c\u6b62\u3002`
    ),
  resumeLoginScenario: localize(
    language,
    "Resuming login scenario execution after the pause.",
    "\u6682\u505c\u540e\u6b63\u5728\u7ee7\u7eed\u6267\u884c\u767b\u5f55\u573a\u666f\u3002"
  ),
  loginBlockedReason: localize(
    language,
    "A manual challenge is blocking the login flow.",
    "\u5f53\u524d\u767b\u5f55\u6d41\u7a0b\u88ab\u4eba\u5de5\u9a8c\u8bc1\u5173\u5361\u62e6\u622a\u3002"
  ),
  manualReviewBeforeLogin: localize(
    language,
    "Manual review required before the login scenario can continue. Solve it in the visible browser, then click Resume.",
    "\u7ee7\u7eed\u767b\u5f55\u573a\u666f\u524d\u9700\u8981\u4eba\u5de5\u590d\u6838\u3002\u8bf7\u5728\u53ef\u89c1\u6d4f\u89c8\u5668\u91cc\u5148\u5904\u7406\uff0c\u7136\u540e\u70b9\u51fb\u7ee7\u7eed\u3002"
  ),
  captureLoginScenario: (index: number, total: number, name: string) =>
    localize(
      language,
      `Capturing the page for login scenario ${index} of ${total}: ${name}`,
      `\u6b63\u5728\u4e3a\u767b\u5f55\u573a\u666f ${index}/${total} \u6355\u83b7\u9875\u9762\uff1a${name}`
    ),
  loginScenarioSnapshotSent: (name: string) =>
    localize(
      language,
      `Scenario snapshot captured for ${name}. Sending it to the planner.`,
      `\u5df2\u4e3a\u573a\u666f ${name} \u6355\u83b7\u5feb\u7167\uff0c\u6b63\u5728\u53d1\u9001\u7ed9\u89c4\u5212\u5668\u3002`
    ),
  loginScenarioGoal: (name: string) =>
    localize(language, `Login scenario: ${name}`, `\u767b\u5f55\u573a\u666f\uff1a${name}`),
  resumeLoginActionExecution: localize(
    language,
    "Resuming login action execution after the pause.",
    "\u6682\u505c\u540e\u6b63\u5728\u7ee7\u7eed\u6267\u884c\u767b\u5f55\u52a8\u4f5c\u3002"
  ),
  continuingPendingAction: localize(
    language,
    "Continuing with the pending browser action.",
    "\u6b63\u5728\u7ee7\u7eed\u5f85\u5b8c\u6210\u7684\u6d4f\u89c8\u5668\u52a8\u4f5c\u3002"
  ),
  executingAction: (action: Action) =>
    localize(
      language,
      `Executing ${action.type}${action.target ? ` on ${action.target}` : ""}.`,
      `\u6b63\u5728\u6267\u884c ${action.type}${action.target ? ` \uff08${action.target}\uff09` : ""}\u3002`
    ),
  actionNeedsManualVerification: localize(
    language,
    "The page requires manual verification.",
    "\u5f53\u524d\u9875\u9762\u9700\u8981\u4eba\u5de5\u9a8c\u8bc1\u3002"
  ),
  manualReviewDuringAction: localize(
    language,
    "Manual review required during action execution. Solve it in the visible browser, then click Resume.",
    "\u6267\u884c\u52a8\u4f5c\u8fc7\u7a0b\u4e2d\u9700\u8981\u4eba\u5de5\u590d\u6838\u3002\u8bf7\u5148\u5728\u53ef\u89c1\u6d4f\u89c8\u5668\u91cc\u5904\u7406\uff0c\u7136\u540e\u70b9\u51fb\u7ee7\u7eed\u3002"
  ),
  retryAfterManualReview: localize(
    language,
    "Retrying the action after manual review.",
    "\u4eba\u5de5\u590d\u6838\u5b8c\u6210\u540e\u6b63\u5728\u91cd\u8bd5\u8fd9\u4e2a\u52a8\u4f5c\u3002"
  ),
  manualReviewCompletedSuffix: localize(
    language,
    "manual review completed",
    "\u5df2\u5b8c\u6210\u4eba\u5de5\u590d\u6838"
  ),
  checkingOutcome: localize(
    language,
    "Checking whether the page outcome matches the expected result.",
    "\u6b63\u5728\u68c0\u67e5\u9875\u9762\u7ed3\u679c\u662f\u5426\u7b26\u5408\u9884\u671f\u3002"
  ),
  captureAndStoreEvidence: localize(
    language,
    "Capturing the latest browser frame and storing evidence.",
    "\u6b63\u5728\u6355\u83b7\u6700\u65b0\u6d4f\u89c8\u5668\u753b\u9762\u5e76\u4fdd\u5b58\u8bc1\u636e\u3002"
  ),
  checksSummary: (checks: Array<{ expected: string; found: boolean }>) =>
    checks
      .map((item) =>
        `${item.expected}:${item.found ? localize(language, "OK", "\u547d\u4e2d") : localize(language, "MISS", "\u672a\u547d\u4e2d")}`
      )
      .join(", "),
  stepPersisted: localize(
    language,
    "Step persisted to the run timeline.",
    "\u6b65\u9aa4\u5df2\u5199\u5165\u8fd0\u884c\u65f6\u95f4\u7ebf\u3002"
  ),
  executionHaltedByPageGuard: localize(
    language,
    "Execution halted by page guard.",
    "\u6267\u884c\u88ab\u9875\u9762\u5b88\u536b\u7b56\u7565\u4e2d\u65ad\u3002"
  ),
  manualInterventionTimeout: localize(
    language,
    "Manual intervention timed out after 10 minutes.",
    "\u4eba\u5de5\u5904\u7406\u5728 10 \u5206\u949f\u540e\u8d85\u65f6\u3002"
  ),
  manualReviewCompletedObservation: (reason: string) =>
    localize(
      language,
      `Manual review completed: ${reason}`,
      `\u4eba\u5de5\u590d\u6838\u5df2\u5b8c\u6210\uff1a${reason}`
    ),
  manualReviewCompletedMessage: localize(
    language,
    "Manual review completed. Resuming automation.",
    "\u4eba\u5de5\u590d\u6838\u5df2\u5b8c\u6210\uff0c\u6b63\u5728\u6062\u590d\u81ea\u52a8\u5316\u3002"
  ),
  generatingReports: localize(
    language,
    "Generating HTML and Excel reports.",
    "\u6b63\u5728\u751f\u6210 HTML \u548c Excel \u62a5\u544a\u3002"
  ),
  blockedHighRiskAction: (action: Action) =>
    localize(
      language,
      `Blocked high-risk action: ${action.type} ${action.target ?? ""}`.trim(),
      `\u5df2\u963b\u6b62\u9ad8\u98ce\u9669\u52a8\u4f5c\uff1a${action.type} ${action.target ?? ""}`.trim()
    ),
  checkingChallengesAndOverlays: localize(
    language,
    "Checking the page for security challenges and blocking overlays.",
    "\u6b63\u5728\u68c0\u67e5\u9875\u9762\u662f\u5426\u5b58\u5728\u5b89\u5168\u6311\u6218\u6216\u906e\u7f69\u963b\u6321\u3002"
  ),
  executionBlockedBeforeAction: (reason: string) =>
    localize(
      language,
      `Execution blocked before action by security challenge: ${reason}`,
      `\u52a8\u4f5c\u6267\u884c\u524d\u88ab\u5b89\u5168\u9a8c\u8bc1\u963b\u65ad\uff1a${reason}`
    ),
  resolveClickTarget: (target: string) =>
    localize(
      language,
      `Resolving click target ${target}.`,
      `\u6b63\u5728\u5b9a\u4f4d\u70b9\u51fb\u76ee\u6807 ${target}\u3002`
    ),
  clickingTarget: (target: string) =>
    localize(language, `Clicking ${target}.`, `\u6b63\u5728\u70b9\u51fb ${target}\u3002`),
  retryClickAfterOverlay: (target: string) =>
    localize(
      language,
      `Retrying click on ${target} with force after overlay dismissal.`,
      `\u5df2\u5173\u95ed\u906e\u7f69\uff0c\u6b63\u5728\u5f3a\u5236\u91cd\u8bd5\u70b9\u51fb ${target}\u3002`
    ),
  tryingVisualTarget: (hint: string) =>
    localize(
      language,
      `DOM locator was not found. Trying OCR fallback for ${hint}.`,
      `DOM \u5b9a\u4f4d\u672a\u547d\u4e2d\uff0c\u6b63\u5728\u5c1d\u8bd5 ${hint} \u7684 OCR \u89c6\u89c9\u5b9a\u4f4d\u3002`
    ),
  visualTargetResolved: (matchedText: string, surfaceLabel: string) =>
    localize(
      language,
      `OCR matched "${matchedText}" on ${surfaceLabel}.`,
      `OCR \u5728 ${surfaceLabel} \u4e0a\u547d\u4e2d\u4e86\u201c${matchedText}\u201d\u3002`
    ),
  clickCompleted: (target: string) =>
    localize(language, `Click completed on ${target}.`, `\u5df2\u5b8c\u6210\u70b9\u51fb ${target}\u3002`),
  resolveInputTarget: (target: string) =>
    localize(
      language,
      `Resolving input target ${target}.`,
      `\u6b63\u5728\u5b9a\u4f4d\u8f93\u5165\u76ee\u6807 ${target}\u3002`
    ),
  fillingTarget: (target: string) =>
    localize(language, `Filling ${target}.`, `\u6b63\u5728\u586b\u5199 ${target}\u3002`),
  inputCompleted: (target: string) =>
    localize(language, `Input completed on ${target}.`, `\u5df2\u5b8c\u6210\u586b\u5199 ${target}\u3002`),
  resolveSelectTarget: (target: string) =>
    localize(
      language,
      `Resolving select target ${target}.`,
      `\u6b63\u5728\u5b9a\u4f4d\u9009\u62e9\u76ee\u6807 ${target}\u3002`
    ),
  selectingOption: (target: string) =>
    localize(language, `Selecting option on ${target}.`, `\u6b63\u5728 ${target} \u4e0a\u9009\u62e9\u9009\u9879\u3002`),
  selectionCompleted: (target: string) =>
    localize(language, `Selection completed on ${target}.`, `\u5df2\u5b8c\u6210 ${target} \u7684\u9009\u62e9\u3002`),
  navigatingTo: (url: string) =>
    localize(language, `Navigating to ${url}.`, `\u6b63\u5728\u8df3\u8f6c\u5230 ${url}\u3002`),
  navigationCompleted: (url: string) =>
    localize(language, `Navigation completed to ${url}.`, `\u5df2\u5b8c\u6210\u8df3\u8f6c\u5230 ${url}\u3002`),
  waitingForSettle: (remainingMs: number) =>
    localize(
      language,
      `Waiting ${remainingMs} ms for the page to settle.`,
      `\u6b63\u5728\u7b49\u5f85 ${remainingMs} ms\uff0c\u8ba9\u9875\u9762\u7a33\u5b9a\u4e0b\u6765\u3002`
    ),
  waitCompleted: (totalMs: number) =>
    localize(language, `Wait completed after ${totalMs} ms.`, `\u7b49\u5f85 ${totalMs} ms \u540e\u5df2\u5b8c\u6210\u3002`),
  actionCompletedObservation: (action: Action, targetUsed: string | undefined, dismissed: string[]) =>
    localize(
      language,
      `${action.type} completed${targetUsed ? ` (target=${targetUsed}` : ""}${describeDismissed(
        language,
        dismissed
      )}${targetUsed ? ")" : ""}`,
      `${action.type} \u5df2\u5b8c\u6210${targetUsed ? ` (\u76ee\u6807=${targetUsed}` : ""}${describeDismissed(
        language,
        dismissed
      )}${targetUsed ? ")" : ""}`
    ),
  actionTriggeredChallenge: (action: Action, reason: string) =>
    localize(
      language,
      `${action.type} triggered security challenge: ${reason}`,
      `${action.type} \u89e6\u53d1\u4e86\u5b89\u5168\u9a8c\u8bc1\u6311\u6218\uff1a${reason}`
    ),
  actionFailed: (action: Action, reason: string) =>
    localize(
      language,
      `${action.type} failed: ${reason}`,
      `${action.type} \u6267\u884c\u5931\u8d25\uff1a${reason}`
    )
});

export type RuntimeText = ReturnType<typeof runtimeText>;
