import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("host routing", () => {
  it("matches the configured marketing host", async () => {
    vi.stubEnv("VITE_PUBLIC_MARKETING_HOST", "www.example.com");
    const module = await import("./host-routing");

    expect(module.isMarketingHost("www.example.com")).toBe(true);
    expect(module.isMarketingHost("app.example.com")).toBe(false);
  });

  it("falls back to www.* hosts when no explicit marketing host is configured", async () => {
    vi.stubEnv("VITE_PUBLIC_MARKETING_HOST", "");
    const module = await import("./host-routing");

    expect(module.isMarketingHost("www.example.com")).toBe(true);
    expect(module.isMarketingHost("localhost")).toBe(false);
    expect(module.isMarketingHost("127.0.0.1:4173")).toBe(false);
  });

  it("builds the private app login URL from explicit origin or the sibling app host", async () => {
    vi.stubEnv("VITE_PRIVATE_APP_ORIGIN", "https://app.example.com");
    let module = await import("./host-routing");
    expect(
      module.resolvePrivateAppLoginUrl({
        host: "www.example.com",
        protocol: "https:"
      })
    ).toBe("https://app.example.com/login");

    vi.resetModules();
    vi.stubEnv("VITE_PRIVATE_APP_ORIGIN", "");
    module = await import("./host-routing");
    expect(
      module.resolvePrivateAppLoginUrl({
        host: "www.example.com",
        protocol: "https:"
      })
    ).toBe("https://app.example.com/login");
  });
});
