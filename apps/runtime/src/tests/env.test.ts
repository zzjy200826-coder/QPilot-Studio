import { describe, expect, it } from "vitest";
import { parseBooleanEnvValue } from "../config/env-parsers.js";

describe("environment boolean parsing", () => {
  it("treats common false-like strings as false", () => {
    expect(parseBooleanEnvValue("false")).toBe(false);
    expect(parseBooleanEnvValue("0")).toBe(false);
    expect(parseBooleanEnvValue("off")).toBe(false);
    expect(parseBooleanEnvValue("no")).toBe(false);
  });

  it("treats common true-like strings as true", () => {
    expect(parseBooleanEnvValue("true")).toBe(true);
    expect(parseBooleanEnvValue("1")).toBe(true);
    expect(parseBooleanEnvValue("on")).toBe(true);
    expect(parseBooleanEnvValue("yes")).toBe(true);
  });

  it("passes through unknown values for zod to validate", () => {
    expect(parseBooleanEnvValue("maybe")).toBe("maybe");
    expect(parseBooleanEnvValue(undefined)).toBeUndefined();
  });
});
