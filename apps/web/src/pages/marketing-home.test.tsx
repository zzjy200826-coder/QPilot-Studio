import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../i18n/I18nProvider", () => ({
  useI18n: () => ({
    language: "en",
    locale: "en-US",
    setLanguage: vi.fn(),
    pick: (english: string) => english,
    formatDateTime: vi.fn(),
    formatRelativeTime: vi.fn()
  })
}));

vi.mock("../lib/host-routing", () => ({
  resolvePrivateAppLoginUrl: () => "https://app.example.com/login"
}));

afterEach(() => {
  vi.resetModules();
});

describe("MarketingHomePage", () => {
  it("shows only the private operator CTA and no request-access copy", async () => {
    const { MarketingHomePage } = await import("./MarketingHomePage");

    const html = renderToStaticMarkup(<MarketingHomePage />);

    expect(html).toContain("Private operator login");
    expect(html).toContain("Go to operator login");
    expect(html).not.toContain("Request private access");
    expect(html).not.toContain("Talk to the owner");
  });
});
