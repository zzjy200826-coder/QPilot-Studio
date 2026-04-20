import type { Action } from "@qpilot/shared";
import { HIGH_RISK_KEYWORDS } from "@qpilot/shared";

const normalize = (value: string): string => value.trim().toLowerCase();

export const isHighRiskAction = (action: Action): boolean => {
  const material = [action.target, action.value, action.note]
    .filter((value): value is string => Boolean(value))
    .map(normalize)
    .join(" ");

  if (!material) {
    return false;
  }

  return HIGH_RISK_KEYWORDS.some((keyword) => material.includes(keyword));
};
