import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    auth: null,
    maintenance: null,
    status: "unauthenticated",
    refresh: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn()
  })
}));

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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("LoginPage", () => {
  it("hides the registration UI when self-service registration is disabled", async () => {
    vi.stubEnv("VITE_AUTH_SELF_SERVICE_REGISTRATION", "false");
    const { LoginPage } = await import("./LoginPage");

    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>
    );

    expect(html).toContain("Owner-only access");
    expect(html).toContain("Sign in to the console");
    expect(html).not.toContain("Create workspace");
  });
});
