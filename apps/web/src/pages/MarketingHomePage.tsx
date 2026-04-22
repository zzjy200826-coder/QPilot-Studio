import { useMemo } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { resolvePrivateAppLoginUrl } from "../lib/host-routing";

export const MarketingHomePage = () => {
  const { pick } = useI18n();

  const privateLoginUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return "/login";
    }

    return resolvePrivateAppLoginUrl({
      host: window.location.host,
      protocol: window.location.protocol
    });
  }, []);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.14),transparent_24%),linear-gradient(180deg,#eef3f9_0%,#e6edf5_100%)] px-6 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="console-masthead px-6 py-8 sm:px-8 sm:py-9">
          <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_420px]">
            <div>
              <span className="console-data-pill inline-flex px-4 py-2 text-[11px] font-medium uppercase tracking-[0.22em] text-slate-700">
                {pick(
                  "Privately operated release intelligence",
                  "\u79c1\u6709\u5316\u53d1\u5e03\u667a\u80fd\u5e73\u53f0"
                )}
              </span>
              <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                {pick(
                  "One owner-operated control plane for browser validation, release evidence, and capacity confidence.",
                  "\u7528\u4e00\u4e2a\u7531 owner \u79c1\u6709\u8fd0\u8425\u7684\u63a7\u5236\u5e73\u9762\uff0c\u7edf\u4e00\u627f\u63a5\u6d4f\u89c8\u5668\u9a8c\u8bc1\u3001\u53d1\u5e03\u8bc1\u636e\u548c\u5bb9\u91cf\u4fe1\u5fc3\u3002"
                )}
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600">
                {pick(
                  "QPilot Studio packages functional runs, benchmark regressions, release gates, backup recovery, and operator controls into a private platform that is operated directly by its owner.",
                  "\u0051\u0050\u0069\u006c\u006f\u0074\u0020\u0053\u0074\u0075\u0064\u0069\u006f \u628a\u529f\u80fd\u8fd0\u884c\u3001\u57fa\u51c6\u56de\u5f52\u3001\u53d1\u5e03\u95e8\u7981\u3001\u5907\u4efd\u6062\u590d\u548c\u8fd0\u7ef4\u63a7\u5236\u6574\u5408\u6210\u4e00\u5957\u7531 owner \u76f4\u63a5\u8fd0\u8425\u7684\u79c1\u6709\u5e73\u53f0\u3002"
                )}
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <a href={privateLoginUrl} className="console-button-primary text-sm">
                  {pick("Private operator login", "\u79c1\u6709\u63a7\u5236\u53f0\u767b\u5f55")}
                </a>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                {[
                  pick(
                    "Owner-only workspace access",
                    "\u4ec5 owner \u53ef\u8bbf\u95ee\u7684\u5de5\u4f5c\u533a"
                  ),
                  pick("Release verdicts and waivers", "\u53d1\u5e03\u7ed3\u8bba\u4e0e\u8c41\u514d"),
                  pick("Backup-aware operations", "\u611f\u77e5\u5907\u4efd\u7684\u8fd0\u7ef4\u63a7\u5236")
                ].map((item) => (
                  <span
                    key={item}
                    className="console-data-pill px-3 py-1 text-xs font-medium text-slate-600"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <aside className="console-panel-subtle p-5">
              <p className="font-data text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Platform highlights", "\u5e73\u53f0\u4eae\u70b9")}
              </p>
              <div className="mt-4 space-y-3">
                {[
                  {
                    title: pick("Functional Lab", "\u529f\u80fd\u5b9e\u9a8c\u5ba4"),
                    summary: pick(
                      "Interactive browser runs, evidence capture, replay, and comparison.",
                      "\u4ea4\u4e92\u5f0f\u6d4f\u89c8\u5668\u8fd0\u884c\u3001\u8bc1\u636e\u91c7\u96c6\u3001\u56de\u653e\u4e0e\u5bf9\u6bd4\u3002"
                    )
                  },
                  {
                    title: pick("Gate Center", "\u95e8\u7981\u4e2d\u5fc3"),
                    summary: pick(
                      "Release verdicts, blockers, approvals, and waivers in one flow.",
                      "\u628a\u53d1\u5e03\u7ed3\u8bba\u3001\u963b\u585e\u9879\u3001\u5ba1\u6279\u548c\u8c41\u514d\u653e\u5230\u540c\u4e00\u6761\u6cbb\u7406\u94fe\u8def\u3002"
                    )
                  },
                  {
                    title: pick("Ops + Recovery", "\u8fd0\u7ef4\u4e0e\u6062\u590d"),
                    summary: pick(
                      "Readiness, alerts, backup health, restore verification, and maintenance windows.",
                      "\u8986\u76d6\u5c31\u7eea\u72b6\u6001\u3001\u544a\u8b66\u3001\u5907\u4efd\u5065\u5eb7\u3001\u6062\u590d\u9a8c\u6536\u548c\u7ef4\u62a4\u7a97\u53e3\u3002"
                    )
                  }
                ].map((item) => (
                  <article
                    key={item.title}
                    className="rounded-[22px] border border-slate-200 bg-white/88 p-4"
                  >
                    <h2 className="text-sm font-semibold text-slate-900">{item.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.summary}</p>
                  </article>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          {[
            {
              title: pick("Release control", "\u53d1\u5e03\u63a7\u5236"),
              summary: pick(
                "Connect runs, load signals, policies, and approvals into one release decision.",
                "\u628a\u8fd0\u884c\u7ed3\u679c\u3001\u538b\u6d4b\u4fe1\u53f7\u3001\u7b56\u7565\u548c\u5ba1\u6279\u6536\u655b\u6210\u4e00\u4e2a\u53d1\u5e03\u7ed3\u8bba\u3002"
              )
            },
            {
              title: pick("Operator confidence", "\u64cd\u4f5c\u5458\u4fe1\u5fc3"),
              summary: pick(
                "Keep readiness, recent alerts, and backup health visible before every ship decision.",
                "\u5728\u6bcf\u6b21\u53d1\u5e03\u524d\uff0c\u628a\u5c31\u7eea\u72b6\u6001\u3001\u6700\u8fd1\u544a\u8b66\u548c\u5907\u4efd\u5065\u5eb7\u6301\u7eed\u6446\u5728 owner \u773c\u524d\u3002"
              )
            },
            {
              title: pick("Private by default", "\u9ed8\u8ba4\u79c1\u6709"),
              summary: pick(
                "Private control plane access, tenant isolation, protected artifacts, and owner-only controls.",
                "\u9ed8\u8ba4\u79c1\u6709\u8bbf\u95ee\u3001\u79df\u6237\u9694\u79bb\u3001\u53d7\u4fdd\u62a4\u7684\u4ea7\u7269\u548c owner \u7ea7\u63a7\u5236\u3002"
              )
            }
          ].map((item) => (
            <article key={item.title} className="console-panel px-5 py-5">
              <h2 className="text-lg font-semibold text-slate-950">{item.title}</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">{item.summary}</p>
            </article>
          ))}
        </section>

        <section className="console-panel px-6 py-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="font-data text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Access model", "\u8bbf\u95ee\u6a21\u578b")}
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                {pick(
                  "This console is privately operated by the owner. The public site is only the product overview.",
                  "\u8fd9\u4e2a\u63a7\u5236\u53f0\u7531 owner \u79c1\u6709\u8fd0\u8425\uff0c\u516c\u5f00\u7ad9\u70b9\u53ea\u8d1f\u8d23\u4ea7\u54c1\u4ecb\u7ecd\u3002"
                )}
              </h2>
            </div>

            <div className="flex flex-wrap gap-3">
              <a href={privateLoginUrl} className="console-button-primary text-sm">
                {pick("Go to operator login", "\u524d\u5f80\u63a7\u5236\u53f0\u767b\u5f55")}
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
