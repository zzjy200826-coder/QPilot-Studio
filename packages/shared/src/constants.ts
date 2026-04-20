export const HIGH_RISK_KEYWORDS = [
  "delete",
  "remove",
  "drop",
  "payment",
  "pay",
  "checkout",
  "order",
  "submit order",
  "refund",
  "transfer",
  "withdraw",
  "delete record",
  "delete project",
  "delete user",
  "\u5220\u9664",
  "\u4ed8\u6b3e",
  "\u652f\u4ed8",
  "\u4e0b\u5355",
  "\u63d0\u4ea4\u8ba2\u5355",
  "\u9000\u6b3e",
  "\u8f6c\u8d26",
  "\u63d0\u73b0"
] as const;

export const RUNTIME_EVENTS = {
  RUN_STATUS: "run.status",
  RUN_LLM: "run.llm",
  STEP_CREATED: "step.created",
  TESTCASE_CREATED: "testcase.created",
  RUN_FINISHED: "run.finished",
  RUN_ERROR: "run.error"
} as const;
