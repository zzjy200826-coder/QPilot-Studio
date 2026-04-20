import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JobSource } from "../../domain/schemas.js";
import { StatusBadge } from "../components/StatusBadge";
import { ApiError, api } from "../lib/api";

type SourceKindDraft = JobSource["kind"] | "";

const isFeishuSheetUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    return (
      (hostname.includes("feishu.cn") || hostname.includes("larksuite.com")) &&
      pathname.includes("/sheets/")
    );
  } catch {
    return false;
  }
};

const isUnsupportedSpreadsheetUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    return (
      hostname.includes("docs.google.com") ||
      hostname.includes("docs.qq.com") ||
      pathname.includes("/spreadsheets/")
    );
  } catch {
    return false;
  }
};

const humanizeToken = (value: string): string =>
  value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const deriveSourceLabel = (value: string, kind: SourceKindDraft): string => {
  if (!value) {
    return "";
  }

  if (kind === "feishu_sheet") {
    return "飞书岗位表";
  }

  try {
    const url = new URL(value);
    const firstPathToken = url.pathname.split("/").filter(Boolean)[0];
    return humanizeToken(firstPathToken || url.hostname);
  } catch {
    return "";
  }
};

export const SourcesPage = () => {
  const queryClient = useQueryClient();
  const sourcesQuery = useQuery({
    queryKey: ["sources"],
    queryFn: api.listSources
  });

  const [draft, setDraft] = useState<{
    label: string;
    seedUrl: string;
    kind: SourceKindDraft;
  }>({
    label: "",
    seedUrl: "",
    kind: ""
  });
  const [notice, setNotice] = useState<{
    tone: "warning" | "info";
    message: string;
  } | null>(null);

  const seedUrl = draft.seedUrl.trim();
  const suggestedKind = useMemo<SourceKindDraft>(() => {
    if (draft.kind) {
      return draft.kind;
    }
    return isFeishuSheetUrl(seedUrl) ? "feishu_sheet" : "";
  }, [draft.kind, seedUrl]);

  const derivedLabel = useMemo(
    () => (draft.label.trim() ? "" : deriveSourceLabel(seedUrl, suggestedKind)),
    [draft.label, seedUrl, suggestedKind]
  );

  const createSourceMutation = useMutation({
    mutationFn: api.createSource,
    onSuccess: (createdSource) => {
      setDraft({
        label: "",
        seedUrl: "",
        kind: ""
      });
      setNotice({
        tone: "info",
        message: `来源“${createdSource.label}”已保存，现在可以扫描它来导入岗位。`
      });
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (error) => {
      setNotice({
        tone: "warning",
        message: error instanceof ApiError ? error.message : "保存来源失败，请稍后再试。"
      });
    }
  });

  const discoverMutation = useMutation({
    mutationFn: (sourceId?: string) => api.discoverSources(sourceId),
    onSuccess: (result) => {
      setNotice({
        tone: "info",
        message:
          result.jobs.length > 0
            ? `扫描完成，本次新导入了 ${result.jobs.length} 条岗位入口。`
            : "扫描完成，但当前没有发现新的岗位入口。"
      });
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error) => {
      setNotice({
        tone: "warning",
        message: error instanceof ApiError ? error.message : "扫描来源失败，请稍后再试。"
      });
    }
  });

  const deleteSourceMutation = useMutation({
    mutationFn: api.deleteSource,
    onSuccess: () => {
      setNotice({
        tone: "info",
        message: "来源已删除。"
      });
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error) => {
      setNotice({
        tone: "warning",
        message: error instanceof ApiError ? error.message : "删除来源失败，请稍后再试。"
      });
    }
  });

  const handleCreateSource = () => {
    if (!seedUrl) {
      setNotice({
        tone: "warning",
        message: "请先填写来源 URL。"
      });
      return;
    }

    if (isUnsupportedSpreadsheetUrl(seedUrl) && suggestedKind !== "feishu_sheet") {
      setNotice({
        tone: "warning",
        message:
          "Google Sheets / 腾讯文档 这类表格暂时还不能直接导入。飞书表格请显式选择“飞书表格导入”，其他情况请填写具体招聘页、Greenhouse 职位板或 Lever feed。"
      });
      return;
    }

    const label = draft.label.trim() || derivedLabel;
    if (!label) {
      setNotice({
        tone: "warning",
        message: "请填写来源名称，或者提供一个能自动推断名称的 URL。"
      });
      return;
    }

    setNotice(null);
    createSourceMutation.mutate({
      label,
      seedUrl,
      kind: suggestedKind || undefined
    });
  };

  return (
    <div className="workspace-stack">
      <section className="section-headline">
        <div>
          <p className="workspace-kicker">职位发现源</p>
          <h3>支持 ATS、通用职位页，以及飞书表格导入。</h3>
        </div>
        <button
          type="button"
          data-testid="scan-all-sources-button"
          className="button button-primary"
          onClick={() => discoverMutation.mutate(undefined)}
        >
          {discoverMutation.isPending ? "扫描中..." : "扫描所有启用的来源"}
        </button>
      </section>

      {notice ? (
        <div className={`inline-alert${notice.tone === "warning" ? " inline-alert-warning" : ""}`}>
          <p className="list-card-copy">{notice.message}</p>
        </div>
      ) : null}

      <section className="workspace-two-column">
        <div className="subsection">
          <div className="subsection-head">
            <div>
              <p className="workspace-kicker">添加来源</p>
              <h4>飞书表格会被当作岗位入口导入器；ATS 和职位页仍按原逻辑扫描。</h4>
            </div>
          </div>
          <div className="workspace-stack">
            <label className="form-field">
              <span>来源名称</span>
              <input
                data-testid="source-label"
                value={draft.label}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    label: event.target.value
                  })
                }
              />
            </label>

            {!draft.label.trim() && derivedLabel ? (
              <p className="list-card-copy">将自动使用“{derivedLabel}”作为来源名称。</p>
            ) : null}

            <label className="form-field">
              <span>种子 URL</span>
              <input
                data-testid="source-seed-url"
                placeholder="支持 Greenhouse / Lever / JSON-LD 职位页 / 飞书 sheets 链接"
                value={draft.seedUrl}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    seedUrl: event.target.value
                  })
                }
              />
            </label>

            <label className="form-field">
              <span>来源类型覆盖</span>
              <select
                data-testid="source-kind"
                value={suggestedKind}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    kind: event.target.value as SourceKindDraft
                  })
                }
              >
                <option value="">自动识别</option>
                <option value="greenhouse">Greenhouse</option>
                <option value="lever">Lever</option>
                <option value="generic">通用 JSON-LD</option>
                <option value="feishu_sheet">飞书表格导入</option>
              </select>
            </label>

            {suggestedKind === "feishu_sheet" ? (
              <div className="inline-alert">
                <p className="list-card-copy">
                  扫描飞书表格时，系统会在本地浏览器里读取表格内容并复用登录态。首次扫描如果需要登录，请在弹出的浏览器里完成一次飞书登录。
                </p>
              </div>
            ) : null}

            <button
              type="button"
              data-testid="save-source-button"
              className="button button-primary"
              onClick={handleCreateSource}
            >
              {createSourceMutation.isPending ? "保存中..." : "保存来源"}
            </button>
          </div>
        </div>

        <div className="subsection">
          <div className="subsection-head">
            <div>
              <p className="workspace-kicker">当前来源</p>
              <h4>飞书导入的岗位入口也会和其他来源一起进入统一去重队列。</h4>
            </div>
          </div>
          <div className="workspace-stack">
            {sourcesQuery.data && sourcesQuery.data.length === 0 ? (
              <div className="workspace-empty">
                还没有来源。先添加一个招聘页、ATS 链接，或者飞书岗位表。
              </div>
            ) : null}

            {sourcesQuery.data?.map((source) => (
              <article key={source.id} className="list-card">
                <div className="list-card-row">
                  <div>
                    <p className="list-card-title">{source.label}</p>
                    <p className="list-card-copy">{source.seedUrl}</p>
                  </div>
                  <StatusBadge status={source.kind} />
                </div>
                <p className="list-card-copy">最近扫描：{source.lastScanAt ?? "尚未扫描"}</p>
                {source.lastScanError ? (
                  <p className="list-card-copy list-card-copy-danger">错误：{source.lastScanError}</p>
                ) : null}
                <div className="button-row">
                  <button
                    type="button"
                    className="button"
                    onClick={() => discoverMutation.mutate(source.id)}
                  >
                    立即扫描
                  </button>
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => deleteSourceMutation.mutate(source.id)}
                  >
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
