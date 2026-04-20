import { z } from "zod";

export const parseBooleanEnvValue = (value: unknown): unknown => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }

  return value;
};

export const booleanEnv = (defaultValue: boolean) =>
  z.preprocess(parseBooleanEnvValue, z.boolean()).default(defaultValue);
