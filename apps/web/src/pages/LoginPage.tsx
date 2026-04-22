import { FormEvent, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../i18n/I18nProvider";

type AuthMode = "register" | "login";

const readRedirect = (search: string): string => {
  const redirect = new URLSearchParams(search).get("redirect");
  if (!redirect || !redirect.startsWith("/")) {
    return "/projects";
  }
  return redirect;
};

export const LoginPage = () => {
  const { auth, status, login, register } = useAuth();
  const { pick } = useI18n();
  const allowRegistration =
    (import.meta.env.VITE_AUTH_SELF_SERVICE_REGISTRATION ?? "true") !== "false";
  const location = useLocation();
  const navigate = useNavigate();
  const redirectTo = useMemo(() => readRedirect(location.search), [location.search]);
  const [mode, setMode] = useState<AuthMode>(allowRegistration ? "register" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (status === "authenticated" && auth) {
    return <Navigate to={redirectTo} replace />;
  }

  const isRegister = allowRegistration && mode === "register";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    try {
      if (isRegister) {
        await register({
          email,
          password,
          displayName: displayName.trim() || undefined,
          tenantName: tenantName.trim() || undefined
        });
      } else {
        await login({ email, password });
      }
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_24%),linear-gradient(180deg,#eef3f9_0%,#e6edf5_100%)] px-6 py-10 text-slate-900">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.08fr,0.92fr]">
        <section className="console-sidebar overflow-hidden rounded-[32px] p-8">
          <div className="inline-flex items-center rounded-full border border-sky-300/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-100">
            {pick(
              "Owner-only private console",
              "\u4ec5 owner \u53ef\u7528\u7684\u79c1\u6709\u63a7\u5236\u53f0"
            )}
          </div>
          <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-tight text-white">
            {pick(
              "Sign in to the private QPilot control plane",
              "\u767b\u5f55\u79c1\u6709 QPilot \u63a7\u5236\u5e73\u9762"
            )}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
            {pick(
              "This workspace is privately operated by a single owner account. Use the approved email and password to reach runs, release gates, artifacts, and recovery controls.",
              "\u8fd9\u4e2a\u5de5\u4f5c\u533a\u7531\u5355\u4e00 owner \u79c1\u6709\u8fd0\u8425\uff0c\u53ea\u80fd\u4f7f\u7528\u5df2\u914d\u7f6e\u7684\u90ae\u7bb1\u4e0e\u5bc6\u7801\u8bbf\u95ee\u8fd0\u884c\u3001\u53d1\u5e03\u95e8\u7981\u3001\u4ea7\u7269\u4e0e\u6062\u590d\u63a7\u5236\u3002"
            )}
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              {
                title: pick("Owner-only access", "\u4ec5 owner \u53ef\u8bbf\u95ee"),
                description: pick(
                  "Only the configured allowlist account can enter the control plane.",
                  "\u53ea\u6709\u5df2\u914d\u7f6e\u767d\u540d\u5355\u8d26\u53f7\u624d\u80fd\u8fdb\u5165\u63a7\u5236\u53f0\u3002"
                )
              },
              {
                title: pick("Workspace isolation", "\u5de5\u4f5c\u533a\u9694\u79bb"),
                description: pick(
                  "Runs, releases, evidence, and secrets stay inside the private workspace boundary.",
                  "\u8fd0\u884c\u3001\u53d1\u5e03\u3001\u8bc1\u636e\u4e0e\u5bc6\u94a5\u90fd\u4fdd\u6301\u5728\u79c1\u6709\u5de5\u4f5c\u533a\u8fb9\u754c\u5185\u3002"
                )
              },
              {
                title: pick("Offline owner bootstrap", "\u79bb\u7ebf owner \u521d\u59cb\u5316"),
                description: pick(
                  "The first owner account is created from the server, not from a public sign-up flow.",
                  "\u9996\u4e2a owner \u8d26\u53f7\u901a\u8fc7\u670d\u52a1\u5668 CLI \u521d\u59cb\u5316\uff0c\u4e0d\u8d70\u516c\u7f51\u6ce8\u518c\u6d41\u7a0b\u3002"
                )
              }
            ].map((item) => (
              <article
                key={item.title}
                className="rounded-[22px] border border-white/10 bg-white/6 p-5 backdrop-blur-sm"
              >
                <h2 className="text-sm font-semibold text-white">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">{item.description}</p>
              </article>
            ))}
          </div>

          <div className="mt-8 rounded-[26px] border border-white/10 bg-slate-950/22 p-5">
            <p className="font-data text-[11px] uppercase tracking-[0.28em] text-slate-300/70">
              {pick("Console posture", "\u63a7\u5236\u53f0\u59ff\u6001")}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                pick("Release governance", "\u53d1\u5e03\u6cbb\u7406"),
                pick("Evidence-linked runs", "\u8bc1\u636e\u5173\u8054\u8fd0\u884c"),
                pick("Recovery-aware operations", "\u611f\u77e5\u6062\u590d\u7684\u8fd0\u7ef4")
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-white/10 bg-white/8 px-4 py-4 text-sm text-slate-200"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="console-shell-surface rounded-[32px] p-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-data text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Workspace access", "\u5de5\u4f5c\u533a\u8bbf\u95ee")}
              </p>
              <h2 className="mt-2 text-[2rem] font-semibold tracking-tight text-slate-950">
                {isRegister
                  ? pick("Create your first tenant", "\u521b\u5efa\u9996\u4e2a\u79df\u6237")
                  : pick("Resume the owner session", "\u7ee7\u7eed owner \u4f1a\u8bdd")}
              </h2>
            </div>

            {allowRegistration ? (
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-100/80 p-1 text-sm">
                <button
                  type="button"
                  onClick={() => setMode("register")}
                  className={`rounded-full px-4 py-2 font-medium transition ${
                    isRegister ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {pick("Create workspace", "\u521b\u5efa\u5de5\u4f5c\u533a")}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className={`rounded-full px-4 py-2 font-medium transition ${
                    !isRegister ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {pick("Sign in", "\u767b\u5f55")}
                </button>
              </div>
            ) : (
              <div className="rounded-full border border-slate-200 bg-slate-100/80 px-4 py-2 text-xs font-medium uppercase tracking-[0.24em] text-slate-600">
                {pick("Owner-only access", "\u4ec5 owner \u53ef\u8bbf\u95ee")}
              </div>
            )}
          </div>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                {pick("Email", "\u90ae\u7bb1")}
              </span>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="console-input text-sm"
                placeholder="you@example.com"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                {pick("Password", "\u5bc6\u7801")}
              </span>
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete={isRegister ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="console-input text-sm"
                placeholder={pick("At least 8 characters", "\u81f3\u5c11 8 \u4f4d")}
              />
            </label>

            {isRegister ? (
              <>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    {pick("Display name", "\u663e\u793a\u540d")}
                  </span>
                  <input
                    name="displayName"
                    type="text"
                    autoComplete="name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    className="console-input text-sm"
                    placeholder={pick("QA Lead", "\u4f8b\u5982 QA Lead")}
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    {pick("Workspace name", "\u5de5\u4f5c\u533a\u540d\u79f0")}
                  </span>
                  <input
                    name="tenantName"
                    type="text"
                    value={tenantName}
                    onChange={(event) => setTenantName(event.target.value)}
                    className="console-input text-sm"
                    placeholder={pick(
                      "Release Engineering",
                      "\u4f8b\u5982 Release Engineering"
                    )}
                  />
                </label>
              </>
            ) : null}

            {errorMessage ? (
              <div
                role="alert"
                className="console-alert rounded-[18px] border border-rose-200/90 bg-rose-50/92 px-4 py-3 text-sm text-rose-800"
              >
                {errorMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting || status === "loading"}
              className="console-button-primary w-full justify-center text-sm"
            >
              {submitting
                ? pick("Working...", "\u5904\u7406\u4e2d...")
                : isRegister
                  ? pick(
                      "Create workspace and continue",
                      "\u521b\u5efa\u5de5\u4f5c\u533a\u5e76\u7ee7\u7eed"
                    )
                  : pick("Sign in to the console", "\u767b\u5f55\u63a7\u5236\u53f0")}
            </button>

            <p className="rounded-[18px] bg-slate-50/90 px-4 py-3 text-xs leading-6 text-slate-500">
              {allowRegistration
                ? pick(
                    "The first registered account becomes the owner of its workspace and unlocks protected reports, release gates, and environment controls.",
                    "\u9996\u4e2a\u6ce8\u518c\u8d26\u53f7\u4f1a\u6210\u4e3a\u5de5\u4f5c\u533a owner\uff0c\u5e76\u89e3\u9501\u53d7\u4fdd\u62a4\u7684\u62a5\u544a\u3001\u53d1\u5e03\u95e8\u7981\u548c\u73af\u5883\u63a7\u5236\u3002"
                  )
                : pick(
                    "This console is privately operated by its owner. Only the configured allowlist account can sign in.",
                    "\u8fd9\u4e2a\u63a7\u5236\u53f0\u7531 owner \u79c1\u6709\u8fd0\u8425\uff0c\u53ea\u6709\u5df2\u914d\u7f6e\u7684\u767d\u540d\u5355\u8d26\u53f7\u624d\u80fd\u767b\u5f55\u3002"
                  )}
            </p>
          </form>
        </section>
      </div>
    </div>
  );
};
