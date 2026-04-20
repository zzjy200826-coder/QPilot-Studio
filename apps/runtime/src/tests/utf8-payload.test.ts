import { describe, expect, it } from "vitest";
import {
  decodeUtf8Base64Text,
  looksEncodingDamaged,
  resolveUtf8TextInput
} from "../server/utf8-payload.js";

describe("utf8-payload", () => {
  it("decodes base64-encoded UTF-8 text", () => {
    const encoded = Buffer.from("\u641c\u7d22\u6d1b\u514b\u738b\u56fd", "utf8").toString("base64");

    expect(decodeUtf8Base64Text(encoded, "goal")).toBe("\u641c\u7d22\u6d1b\u514b\u738b\u56fd");
  });

  it("passes through plain ASCII text", () => {
    expect(
      resolveUtf8TextInput({
        fieldName: "goal",
        value: "Open the site and log in."
      })
    ).toBe("Open the site and log in.");
  });

  it("rejects visibly damaged plain-text payloads", () => {
    expect(() =>
      resolveUtf8TextInput({
        fieldName: "goal",
        value: "??????"
      })
    ).toThrowError(/goal appears to be encoding-damaged/i);
    expect(looksEncodingDamaged("??????")).toBe(true);
  });

  it("rejects invalid base64 payloads", () => {
    expect(() =>
      decodeUtf8Base64Text("not-base64!", "goal")
    ).toThrowError(/goalBase64 must be valid base64-encoded UTF-8 text/i);
  });
});
