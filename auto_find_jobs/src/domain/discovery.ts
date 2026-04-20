import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { chromium } from "playwright";
import { z } from "zod";
import {
  type DiscoveredJob,
  type JobSource,
  DiscoveredJobSchema,
  JobSourceKindSchema
} from "./schemas.js";

const greenhouseJobsSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.number().or(z.string()),
      title: z.string(),
      absolute_url: z.string().url(),
      content: z.string().optional(),
      location: z.object({ name: z.string().optional() }).optional(),
      offices: z.array(z.object({ name: z.string().optional() })).optional(),
      updated_at: z.string().optional()
    })
  )
});

const leverPostingSchema = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string().url().optional(),
  applyUrl: z.string().url().optional(),
  categories: z
    .object({
      location: z.string().optional(),
      commitment: z.string().optional(),
      team: z.string().optional()
    })
    .optional(),
  descriptionPlain: z.string().optional(),
  additionalPlain: z.string().optional(),
  createdAt: z.number().optional()
});

const feishuRowSchema = z.object({
  company: z.string().trim().min(1),
  batch: z.string().trim().optional(),
  title: z.string().trim().optional(),
  applyUrl: z.string().url(),
  referralCode: z.string().trim().optional(),
  details: z.string().trim().optional()
});

type FeishuRow = z.infer<typeof feishuRowSchema>;

interface DiscoveryServiceOptions {
  greenhouseApiBase?: string;
  leverApiBase?: string;
  fetchImpl?: typeof fetch;
  browser?: {
    headless?: boolean;
    sessionsRoot?: string;
    getStorageStatePath?: (siteKey: string) => string | null | undefined;
    saveStorageStatePath?: (siteKey: string, storagePath: string) => void | Promise<void>;
  };
}

interface EvaluatedFeishuCell {
  text: string;
  links: string[];
}

interface EvaluatedFeishuRow {
  company: string;
  batch?: string;
  title?: string;
  applyUrl: string;
  referralCode?: string;
  details?: string;
}

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

const defaultLocation = "Remote / Not specified";
const feishuReadyTimeoutMs = 90_000;
const batchPattern = /(?:\u6625\u62db|\u79cb\u62db|\u8865\u5f55|\u5b9e\u4e60|\u6821\u62db|\u793e\u62db)/i;
const companyNoisePattern =
  /(?:\u516c\u53f8|\u6279\u6b21|\u6295\u9012\u94fe\u63a5|\u5185\u63a8\u7801|\u63a8\u8350\u7801|\u5728\u804c|\u6295\u9012\u8be6\u60c5|\u5b98\u7f51\u94fe\u63a5|\u5185\u63a8\u94fe\u63a5|\u7f51\u7533\u6295\u9012|\u7f51\u7533\u5165\u53e3|\u622a\u6b62\u65f6\u95f4|\u6295\u9012\u673a\u4f1a|\u54a8\u8be2|\u6587\u6863|\u5fae\u4fe1|offer|balance|\u5de5\u4f5c\u5730\u70b9|\u4ec5\u53ef\u6295\u9012|\u4ec5\u652f\u6301|\u65e0\u5185\u63a8|\u52a0\u8f7d\u4e2d|\u767b\u5f55|\u6ce8\u518c|\u516c\u53f8\u4ecb\u7ecd)/i;

const normalizeText = (value: string | undefined): string =>
  (value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const cleanText = (value: string | undefined): string =>
  (value ?? "").replace(/\s+/g, " ").trim();

const buildFingerprint = (input: {
  externalJobId?: string;
  company: string;
  title: string;
  location: string;
  applyUrl: string;
}): string => {
  const stableKey = input.externalJobId
    ? `external:${input.externalJobId}`
    : `${normalizeText(input.company)}|${normalizeText(input.title)}|${normalizeText(
        input.location
      )}|${normalizeText(input.applyUrl)}`;
  return createHash("sha1").update(stableKey).digest("hex");
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const fetchJson = async <T>(url: string, fetchImpl: typeof fetch): Promise<T> => {
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json, text/plain;q=0.9, */*;q=0.8"
    }
  });
  if (!response.ok) {
    throw new Error(`Discovery request failed (${response.status}) for ${url}`);
  }
  return (await response.json()) as T;
};

const fetchText = async (url: string, fetchImpl: typeof fetch): Promise<string> => {
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
    }
  });
  if (!response.ok) {
    throw new Error(`Discovery request failed (${response.status}) for ${url}`);
  }
  return response.text();
};

const isFeishuSheetUrl = (seedUrl: string): boolean => {
  try {
    const url = new URL(seedUrl);
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

const detectKindFromUrl = (seedUrl: string): z.infer<typeof JobSourceKindSchema> => {
  const lowered = seedUrl.toLowerCase();
  if (lowered.includes("greenhouse.io")) {
    return "greenhouse";
  }
  if (lowered.includes("lever.co")) {
    return "lever";
  }
  if (isFeishuSheetUrl(seedUrl)) {
    return "feishu_sheet";
  }
  return "generic";
};

const deriveGreenhouseToken = (seedUrl: string): string => {
  const url = new URL(seedUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "v1" && parts[1] === "boards") {
    return parts[2] ?? "";
  }
  if (parts[0] === "boards" && parts[1]) {
    return parts[1];
  }
  return parts[0] ?? "";
};

const deriveLeverSite = (seedUrl: string): string => {
  const url = new URL(seedUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname.startsWith("api.")) {
    return parts[2] ?? "";
  }
  return parts[0] ?? "";
};

const stripHtml = (value: string | undefined): string | undefined => {
  const stripped = value
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped ? stripped : undefined;
};

const extractJsonLdCandidates = (html: string): unknown[] => {
  const matches = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  const items: unknown[] = [];

  for (const match of matches) {
    const raw = match[1]?.trim();
    if (!raw) {
      continue;
    }

    try {
      items.push(JSON.parse(raw));
    } catch {
      continue;
    }
  }

  return items;
};

const flattenJsonLd = (input: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(input)) {
    return input.flatMap(flattenJsonLd);
  }
  if (!input || typeof input !== "object") {
    return [];
  }

  const record = input as Record<string, unknown>;
  const graph = record["@graph"];
  if (Array.isArray(graph)) {
    return graph.flatMap(flattenJsonLd);
  }
  return [record];
};

const extractJobPostingNodes = (html: string): Array<Record<string, unknown>> =>
  extractJsonLdCandidates(html)
    .flatMap(flattenJsonLd)
    .filter((item) => {
      const type = item["@type"];
      return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
    });

const pickLocation = (node: Record<string, unknown>): string => {
  const direct = node.jobLocation;
  if (Array.isArray(direct)) {
    const flattened = direct
      .flatMap((item) => pickLocation(item as Record<string, unknown>))
      .filter(Boolean)
      .join(" / ");
    return flattened || defaultLocation;
  }
  if (direct && typeof direct === "object") {
    const address = (direct as Record<string, unknown>).address;
    if (address && typeof address === "object") {
      const normalizedAddress = address as Record<string, unknown>;
      const parts = [
        normalizedAddress.addressLocality,
        normalizedAddress.addressRegion,
        normalizedAddress.addressCountry
      ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
      if (parts.length > 0) {
        return parts.join(", ");
      }
    }
  }
  return defaultLocation;
};

const buildSheetJobTitle = (row: FeishuRow): string => {
  if (row.title) {
    return row.title;
  }
  if (row.batch) {
    return `${row.company} ${row.batch} Apply Entry`;
  }
  return `${row.company} Apply Entry`;
};

const inferAtsFromApplyUrl = (applyUrl: string): DiscoveredJob["ats"] => {
  const lowered = applyUrl.toLowerCase();
  if (lowered.includes("greenhouse.io")) {
    return "greenhouse";
  }
  if (lowered.includes("lever.co")) {
    return "lever";
  }
  if (lowered.includes("mokahr.com")) {
    return "moka";
  }

  try {
    const url = new URL(applyUrl);
    if (url.hostname.toLowerCase().includes("mokahr.com")) {
      return "moka";
    }
    const pathname = url.pathname.toLowerCase();
    if (pathname.includes("/apply/greenhouse/")) {
      return "greenhouse";
    }
    if (pathname.includes("/apply/lever/")) {
      return "lever";
    }
  } catch {
    // ignore invalid URL
  }

  return "portal";
};

const isLikelyApplyLink = (href: string): boolean => {
  if (!/^https?:\/\//i.test(href)) {
    return false;
  }

  const lowered = href.toLowerCase();
  if (
    lowered.includes("my.feishu.cn") ||
    lowered.includes("feishu.cn/wiki") ||
    lowered.includes("larksuite.com/wiki") ||
    lowered.includes("docs.qq.com") ||
    lowered.includes("docs.google.com")
  ) {
    return false;
  }

  return /job|jobs|career|campus|apply|greenhouse|lever|position|zhaopin|zhiye|moka/i.test(
    lowered
  );
};

const extractReferralCode = (value: string): string | undefined => {
  const normalized = cleanText(value);
  const textMatch = normalized.match(
    /(?:^|\b)(?:\u5185\u63a8\u7801|\u63a8\u8350\u7801|referral\s*code|recommendation\s*code|recommend\s*code|referralcode|recommendationcode|code)\s*[:：]\s*([A-Z0-9-]{4,})/i
  );
  if (textMatch?.[1]) {
    return textMatch[1].trim();
  }

  try {
    const url = new URL(value);
    for (const key of ["code", "recommendCode", "referralCode", "recommendationCode", "recommendation_code"]) {
      const nextValue = url.searchParams.get(key);
      if (nextValue) {
        return nextValue.trim();
      }
    }
  } catch {
    // ignore non-URL input
  }

  return undefined;
};

const decodeFeishuSnapshotValue = (value: unknown): string => {
  if (typeof value !== "string" || !value) {
    return "";
  }

  try {
    return gunzipSync(Buffer.from(value, "base64")).toString("utf8");
  } catch {
    return "";
  }
};

const normalizeSnapshotToken = (value: string): string => {
  let token = cleanText(value).replace(/\uFFFD/g, " ").trim();
  token = token.replace(/^[^A-Za-z0-9\u4e00-\u9fff]+/u, "");
  token = token.replace(/^[A-Za-z](?=(?:\u5185\u63a8\u94fe\u63a5|\u6295\u9012\u94fe\u63a5|\u5b98\u7f51\u94fe\u63a5|\u7f51\u7533\u6295\u9012|\u7f51\u7533\u5165\u53e3))/u, "");
  return cleanText(token);
};

const extractApplyUrlFromToken = (value: string): string | undefined => {
  const normalized = cleanText(value);
  const directMatch = normalized.match(/https?:\/\/[^\s]+/i);
  if (directMatch?.[0]) {
    const trimmed = directMatch[0].replace(/[?.,;!，。；！]+$/u, "");
    return isLikelyApplyLink(trimmed) ? trimmed : undefined;
  }

  const bareDomainMatch = normalized.match(/(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}[^\s]*/);
  if (!bareDomainMatch?.[0]) {
    return undefined;
  }

  const maybeUrl = `https://${bareDomainMatch[0].replace(/[?.,;!，。；！]+$/u, "")}`;
  return isLikelyApplyLink(maybeUrl) ? maybeUrl : undefined;
};

const isLikelyCompanyToken = (value: string): boolean => {
  const normalized = normalizeSnapshotToken(value).replace(/^[^A-Za-z0-9\u4e00-\u9fff]+/u, "").trim();
  if (!normalized || normalized.length < 2 || normalized.length > 24) {
    return false;
  }
  if (extractApplyUrlFromToken(normalized)) {
    return false;
  }
  if (batchPattern.test(normalized)) {
    return false;
  }
  if (companyNoisePattern.test(normalized)) {
    return false;
  }
  if (/^(company|batch|apply(?:\s*link)?|code|referral|recommendation)\b[:：]?/i.test(normalized)) {
    return false;
  }
  if (/^[0-9]+(?:\s+[0-9]+)*$/u.test(normalized)) {
    return false;
  }
  if (/^[A-Za-z]$/u.test(normalized)) {
    return false;
  }
  return /[\u4e00-\u9fff]/u.test(normalized) || /[A-Za-z]{2,}/u.test(normalized);
};

const extractBatchFromToken = (value: string): string | undefined => {
  const match = normalizeSnapshotToken(value).match(batchPattern);
  return match?.[1];
};

const hasNearbyApplyUrl = (tokens: string[], index: number, maxDistance = 8): boolean =>
  tokens
    .slice(index + 1, index + 1 + maxDistance)
    .some((token) => Boolean(extractApplyUrlFromToken(token)));

const buildFeishuRowFromSegment = (segment: string[]): FeishuRow | null => {
  if (segment.length === 0) {
    return null;
  }

  const company = normalizeSnapshotToken(segment[0] ?? "").replace(/^[^A-Za-z0-9\u4e00-\u9fff]+/u, "").trim();
  if (!isLikelyCompanyToken(company)) {
    return null;
  }

  const applyUrl = segment.map((token) => extractApplyUrlFromToken(token)).find(Boolean);
  if (!applyUrl) {
    return null;
  }

  const batch = segment.map((token) => extractBatchFromToken(token)).find(Boolean);
  const referralCode = segment.map((token) => extractReferralCode(token)).find(Boolean);
  const details = cleanText(segment.slice(1).join(" "));

  return feishuRowSchema.parse({
    company,
    batch: batch ?? undefined,
    applyUrl,
    referralCode: referralCode ?? undefined,
    details: details || undefined
  });
};

const parseFeishuSnapshotRows = (snapshot: unknown): FeishuRow[] => {
  if (!snapshot || typeof snapshot !== "object") {
    return [];
  }

  const blocks = (snapshot as { blocks?: Record<string, unknown> }).blocks ?? {};
  const tokens = Object.values(blocks)
    .flatMap((value) =>
      decodeFeishuSnapshotValue(value)
        .split(/[\u0000-\u001f]+/)
        .map((token) => normalizeSnapshotToken(token))
        .filter(Boolean)
    )
    .filter((token) => token.length > 0);

  const headerIndex = tokens.findIndex((token) => /\u6295\u9012\u94fe\u63a5|apply\s*link/i.test(token));
  const workingTokens = headerIndex >= 0 ? tokens.slice(headerIndex + 1) : tokens;

  const rows: FeishuRow[] = [];
  for (let index = 0; index < workingTokens.length; index += 1) {
    const token = workingTokens[index] ?? "";
    const applyUrl = extractApplyUrlFromToken(token);
    if (!applyUrl) {
      continue;
    }

    let company: string | undefined;
    let batch: string | undefined;
    for (let cursor = index - 1; cursor >= Math.max(0, index - 8); cursor -= 1) {
      const candidate = workingTokens[cursor] ?? "";
      if (!batch) {
        batch = extractBatchFromToken(candidate);
      }
      if (!company && isLikelyCompanyToken(candidate)) {
        company = normalizeSnapshotToken(candidate);
        break;
      }
    }

    if (!company) {
      continue;
    }

    const referralCode =
      [
        token,
        ...workingTokens.slice(index + 1, index + 4),
        ...workingTokens.slice(Math.max(0, index - 2), index)
      ]
        .map((entry) => extractReferralCode(entry))
        .find(Boolean) ?? undefined;
    const details = cleanText(
      [
        token,
        ...workingTokens.slice(index + 1, index + 3).filter((entry) => !extractReferralCode(entry))
      ]
        .filter(Boolean)
        .join(" ")
    );

    rows.push(
      feishuRowSchema.parse({
        company,
        batch,
        applyUrl,
        referralCode: referralCode ?? undefined,
        details: details || undefined
      })
    );
  }

  const deduped = new Map<string, FeishuRow>();
  for (const row of rows) {
    const key = `${row.company}|${row.applyUrl}`;
    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  }

  return [...deduped.values()];
};

const parseFeishuSnapshotRowsV2 = (snapshot: unknown): FeishuRow[] => {
  if (!snapshot || typeof snapshot !== "object") {
    return [];
  }

  const blocks = (snapshot as { blocks?: Record<string, unknown> }).blocks ?? {};
  const tokens = Object.values(blocks)
    .flatMap((value) =>
      decodeFeishuSnapshotValue(value)
        .split(/[\u0000-\u001f]+/)
        .map((token) => normalizeSnapshotToken(token))
        .filter(Boolean)
    )
    .filter((token) => token.length > 0);

  const headerIndex = tokens.findIndex((token) => /\u6295\u9012\u94fe\u63a5|apply\s*link/i.test(token));
  const workingTokens = headerIndex >= 0 ? tokens.slice(headerIndex + 1) : tokens;
  const companyAnchorIndexes = workingTokens
    .map((token, index) => ({ token, index }))
    .filter(({ token, index }) => isLikelyCompanyToken(token) && hasNearbyApplyUrl(workingTokens, index))
    .map(({ index }) => index);

  const visibleTokenLimit = companyAnchorIndexes.length
    ? Math.min(workingTokens.length, companyAnchorIndexes[companyAnchorIndexes.length - 1]! + 8)
    : workingTokens.length;
  const visibleTokens = workingTokens.slice(0, visibleTokenLimit);
  const visibleCompanyAnchors = companyAnchorIndexes.filter((index) => index < visibleTokenLimit);

  const rows: FeishuRow[] = [];
  for (let anchorIndex = 0; anchorIndex < visibleCompanyAnchors.length; anchorIndex += 1) {
    const segmentStart = visibleCompanyAnchors[anchorIndex]!;
    const segmentEnd = visibleCompanyAnchors[anchorIndex + 1] ?? visibleTokens.length;
    const row = buildFeishuRowFromSegment(visibleTokens.slice(segmentStart, segmentEnd));
    if (row) {
      rows.push(row);
    }
  }

  const deduped = new Map<string, FeishuRow>();
  for (const row of rows) {
    const key = `${row.company}|${row.applyUrl}`;
    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  }

  return [...deduped.values()];
};

const extractFeishuRowsFromPage = async (
  page: import("playwright").Page
): Promise<FeishuRow[]> =>
  page
    .evaluate<EvaluatedFeishuRow[]>(() => {
      const normalize = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/g, " ").trim();

      const looksLikeApplyLink = (href: string): boolean => {
        if (!/^https?:\/\//i.test(href)) {
          return false;
        }

        const lowered = href.toLowerCase();
        if (
          lowered.includes("my.feishu.cn") ||
          lowered.includes("feishu.cn/wiki") ||
          lowered.includes("larksuite.com/wiki") ||
          lowered.includes("docs.qq.com") ||
          lowered.includes("docs.google.com")
        ) {
          return false;
        }

        return /job|jobs|career|campus|apply|greenhouse|lever|position|zhaopin|zhiye|moka/i.test(
          lowered
        );
      };

      const extractCode = (value: string): string | undefined => {
        const normalized = normalize(value);
        const match = normalized.match(
          /(?:^|\b)(?:\u5185\u63a8\u7801|\u63a8\u8350\u7801|referral\s*code|recommendation\s*code|recommend\s*code|referralcode|recommendationcode|code)\s*[:：]\s*([A-Z0-9-]{4,})/i
        );
        if (match?.[1]) {
          return match[1].trim();
        }

        try {
          const url = new URL(value);
          for (const key of ["code", "recommendCode", "referralCode", "recommendationCode", "recommendation_code"]) {
            const nextValue = url.searchParams.get(key);
            if (nextValue) {
              return nextValue.trim();
            }
          }
        } catch {
          // ignore invalid URL text
        }

        return undefined;
      };

      const semanticRows: EvaluatedFeishuCell[][] = Array.from(
        document.querySelectorAll("tr, [role='row']")
      ).map((row) => {
        const cells: EvaluatedFeishuCell[] = Array.from(
          row.querySelectorAll("th, td, [role='columnheader'], [role='cell'], [role='gridcell']")
        ).map((cell) => ({
          text: normalize(cell.textContent),
          links: (Array.from(cell.querySelectorAll("a[href]")) as HTMLAnchorElement[])
            .map((link) => link.href)
            .filter(looksLikeApplyLink)
        }));

        return cells.filter((cell) => cell.text.length > 0 || cell.links.length > 0);
      });

      const headerIndex = semanticRows.findIndex((cells) => {
        const texts = cells.map((cell) => cell.text);
        return (
          texts.some((text) => /公司|company/i.test(text)) &&
          texts.some((text) => /投递链接|申请链接|官网链接|apply|link/i.test(text))
        );
      });

      const headerRow = headerIndex >= 0 ? semanticRows[headerIndex] : undefined;
      if (headerRow) {
        const headers = headerRow.map((cell) => cell.text);
        const companyIndex = headers.findIndex((header) => /公司|company/i.test(header));
        const batchIndex = headers.findIndex((header) => /批次|batch/i.test(header));
        const titleIndex = headers.findIndex((header) => /岗位|职位|title|position/i.test(header));
        const linkIndex = headers.findIndex((header) => /投递链接|申请链接|官网链接|apply|link/i.test(header));
        const codeIndex = headers.findIndex((header) => /内推码|推荐码|referral|code/i.test(header));
        const detailsIndex = headers.findIndex((header) => /详情|说明|detail|note/i.test(header));

        const semanticResults = semanticRows
          .slice(headerIndex + 1)
          .map((cells): EvaluatedFeishuRow | null => {
            const company = normalize(cells[companyIndex]?.text || cells[0]?.text);
            const batch = normalize(cells[batchIndex]?.text) || undefined;
            const title = normalize(cells[titleIndex]?.text) || undefined;
            const linkCell = cells[linkIndex];
            const applyUrl = linkCell?.links?.[0];
            const detailsText = normalize(
              [cells[detailsIndex]?.text, cells[linkIndex]?.text, cells[codeIndex]?.text]
                .filter(Boolean)
                .join(" ")
            );
            const referralCode =
              (cells[codeIndex]?.text
                ? extractCode(cells[codeIndex].text) || normalize(cells[codeIndex].text)
                : extractCode(detailsText || applyUrl || "")) || undefined;

            if (!company || !applyUrl) {
              return null;
            }

            return {
              company,
              batch,
              title,
              applyUrl,
              referralCode,
              details: detailsText || undefined
            };
          })
          .filter((row): row is EvaluatedFeishuRow => Boolean(row));

        if (semanticResults.length > 0) {
          return semanticResults;
        }
      }

      const fallbackBlocks = (Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[])
        .map((anchor): EvaluatedFeishuRow | null => {
          const href = anchor.href;
          if (!looksLikeApplyLink(href)) {
            return null;
          }

          let container: HTMLElement | null = anchor.parentElement;
          let bestText = normalize(anchor.textContent);
          let depth = 0;
          while (container && depth < 6) {
            const nextText = normalize(container.innerText);
            if (nextText && nextText.length <= 600) {
              bestText = nextText;
            }
            container = container.parentElement;
            depth += 1;
          }

          const lines = bestText
            .split(/\n+/)
            .map((line: string) => normalize(line))
            .filter(Boolean);
          const company =
            lines.find(
              (line: string) =>
                !/内推码|推荐码|referral|code|链接|link|http|www\.|批次|详情|说明/i.test(line) &&
                line.length <= 40
            ) || "";
          const batch =
            lines.find((line: string) => /春招|秋招|暑期|校招|社招|实习|batch/i.test(line)) || "";
          const referralCode = extractCode(bestText) || undefined;

          if (!company) {
            return null;
          }

          return {
            company,
            batch: batch || undefined,
            applyUrl: href,
            referralCode,
            details: bestText || undefined
          };
        })
        .filter((row): row is EvaluatedFeishuRow => Boolean(row));

      const seen = new Set<string>();
      return fallbackBlocks.filter((row) => {
        const key = `${row.company}|${row.applyUrl}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    })
    .then((rows) => feishuRowSchema.array().parse(rows));

const mapGreenhouseJobs = async (
  source: JobSource,
  options: Required<Pick<DiscoveryServiceOptions, "fetchImpl">> &
    Pick<DiscoveryServiceOptions, "greenhouseApiBase">
): Promise<DiscoveredJob[]> => {
  const boardToken = deriveGreenhouseToken(source.seedUrl);
  if (!boardToken) {
    throw new Error(`Could not derive a Greenhouse board token from ${source.seedUrl}`);
  }

  const apiBase = options.greenhouseApiBase
    ? trimTrailingSlash(options.greenhouseApiBase)
    : "https://boards-api.greenhouse.io/v1/boards";
  const endpoint = `${apiBase}/${boardToken}/jobs?content=true`;
  const json = greenhouseJobsSchema.parse(await fetchJson<unknown>(endpoint, options.fetchImpl));
  const discoveredAt = new Date().toISOString();

  return json.jobs.map((job) =>
    DiscoveredJobSchema.parse({
      id: randomUUID(),
      sourceId: source.id,
      fingerprint: buildFingerprint({
        externalJobId: String(job.id),
        company: source.label,
        title: job.title,
        location:
          job.location?.name ??
          job.offices?.map((office) => office.name).filter(Boolean).join(" / ") ??
          defaultLocation,
        applyUrl: job.absolute_url
      }),
      externalJobId: String(job.id),
      ats: "greenhouse",
      company: source.label,
      title: job.title,
      location:
        job.location?.name ??
        job.offices?.map((office) => office.name).filter(Boolean).join(" / ") ??
        defaultLocation,
      applyUrl: job.absolute_url,
      hostedUrl: job.absolute_url,
      description: stripHtml(job.content),
      metadata: {
        boardToken,
        endpoint
      },
      sourceSeedUrl: source.seedUrl,
      remoteUpdatedAt: job.updated_at,
      discoveredAt,
      updatedAt: discoveredAt
    })
  );
};

const mapLeverJobs = async (
  source: JobSource,
  options: Required<Pick<DiscoveryServiceOptions, "fetchImpl">> &
    Pick<DiscoveryServiceOptions, "leverApiBase">
): Promise<DiscoveredJob[]> => {
  const site = deriveLeverSite(source.seedUrl);
  if (!site) {
    throw new Error(`Could not derive a Lever site token from ${source.seedUrl}`);
  }

  const limit = 100;
  const postings: z.infer<typeof leverPostingSchema>[] = [];
  const apiBase = options.leverApiBase
    ? trimTrailingSlash(options.leverApiBase)
    : "https://api.lever.co/v0/postings";

  for (let skip = 0; ; skip += limit) {
    const endpoint = `${apiBase}/${site}?mode=json&limit=${limit}&skip=${skip}`;
    const json = z
      .array(leverPostingSchema)
      .parse(await fetchJson<unknown>(endpoint, options.fetchImpl));
    postings.push(...json);
    if (json.length < limit) {
      break;
    }
  }

  const discoveredAt = new Date().toISOString();
  return postings.map((posting) =>
    DiscoveredJobSchema.parse({
      id: randomUUID(),
      sourceId: source.id,
      fingerprint: buildFingerprint({
        externalJobId: posting.id,
        company: source.label,
        title: posting.text,
        location: posting.categories?.location ?? defaultLocation,
        applyUrl: posting.applyUrl ?? posting.hostedUrl ?? source.seedUrl
      }),
      externalJobId: posting.id,
      ats: "lever",
      company: source.label,
      title: posting.text,
      location: posting.categories?.location ?? defaultLocation,
      applyUrl: posting.applyUrl ?? posting.hostedUrl ?? source.seedUrl,
      hostedUrl: posting.hostedUrl,
      description: [posting.descriptionPlain, posting.additionalPlain]
        .filter(Boolean)
        .join("\n\n"),
      metadata: {
        team: posting.categories?.team,
        commitment: posting.categories?.commitment,
        site
      },
      sourceSeedUrl: source.seedUrl,
      postedAt: posting.createdAt ? new Date(posting.createdAt).toISOString() : undefined,
      discoveredAt,
      updatedAt: discoveredAt
    })
  );
};

const mapJsonLdJobs = async (
  source: JobSource,
  options: Required<Pick<DiscoveryServiceOptions, "fetchImpl">>
): Promise<DiscoveredJob[]> => {
  const html = await fetchText(source.seedUrl, options.fetchImpl);
  const nodes = extractJobPostingNodes(html);
  const discoveredAt = new Date().toISOString();

  return nodes.map((node, index) => {
    const title = typeof node.title === "string" ? node.title : "Untitled role";
    const companyRecord =
      node.hiringOrganization && typeof node.hiringOrganization === "object"
        ? (node.hiringOrganization as Record<string, unknown>)
        : undefined;
    const company = typeof companyRecord?.name === "string" ? companyRecord.name : source.label;
    const applyUrl =
      typeof node.url === "string" && node.url.startsWith("http") ? node.url : source.seedUrl;
    const location = pickLocation(node);
    const description =
      typeof node.description === "string" ? stripHtml(node.description) : undefined;
    const identifier =
      typeof node.identifier === "string"
        ? node.identifier
        : typeof (node.identifier as Record<string, unknown> | undefined)?.value === "string"
          ? ((node.identifier as Record<string, unknown>).value as string)
          : `jsonld-${index}`;

    return DiscoveredJobSchema.parse({
      id: randomUUID(),
      sourceId: source.id,
      fingerprint: buildFingerprint({
        externalJobId: identifier,
        company,
        title,
        location,
        applyUrl
      }),
      externalJobId: identifier,
      ats: "jsonld",
      company,
      title,
      location,
      applyUrl,
      hostedUrl: applyUrl,
      description,
      metadata: {
        employmentType: node.employmentType,
        validThrough: node.validThrough
      },
      sourceSeedUrl: source.seedUrl,
      postedAt: typeof node.datePosted === "string" ? node.datePosted : undefined,
      discoveredAt,
      updatedAt: discoveredAt
    });
  });
};

const mapFeishuSheetJobs = async (
  source: JobSource,
  options: NonNullable<DiscoveryServiceOptions["browser"]>
): Promise<DiscoveredJob[]> => {
  const browser = await chromium.launch({ headless: options.headless ?? false });
  const url = new URL(source.seedUrl);
  const siteKey = `source-feishu-${url.hostname.replace(/[^a-z0-9.-]/gi, "_")}`;
  const persistedPath = options.getStorageStatePath?.(siteKey) ?? null;
  const storageStatePath =
    persistedPath ??
    (options.sessionsRoot
      ? resolve(options.sessionsRoot, `${siteKey}.json`)
      : resolve(process.cwd(), `${siteKey}.json`));

  await mkdir(dirname(storageStatePath), { recursive: true });

  const context = await browser.newContext({
    storageState: existsSync(storageStatePath) ? storageStatePath : undefined,
    userAgent
  });
  const page = await context.newPage();
  let clientSnapshot: unknown | null = null;

  page.on("response", async (response) => {
    if (!response.url().includes("/space/api/v3/sheet/client_vars")) {
      return;
    }

    try {
      const json = await response.json();
      clientSnapshot = json?.data?.snapshot ?? null;
    } catch {
      // ignore transient parse failures
    }
  });

  try {
    await page.goto(source.seedUrl, {
      waitUntil: "domcontentloaded",
      timeout: feishuReadyTimeoutMs
    });

    const startedAt = Date.now();
    let rows: FeishuRow[] = [];

    while (Date.now() - startedAt < feishuReadyTimeoutMs) {
      rows = clientSnapshot ? parseFeishuSnapshotRowsV2(clientSnapshot) : [];
      if (rows.length === 0) {
        rows = await extractFeishuRowsFromPage(page).catch(() => []);
      }
      if (rows.length > 0) {
        break;
      }

      const pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
      if (/鐧诲綍|娉ㄥ唽|login|sign in/i.test(pageText)) {
        await page.waitForTimeout(1_500);
        continue;
      }

      await page.waitForTimeout(1_000);
    }

    if (rows.length === 0) {
      throw new Error(
        "\u98de\u4e66\u8868\u683c\u91cc\u6ca1\u6709\u63d0\u53d6\u5230\u53ef\u7528\u7684\u6295\u9012\u94fe\u63a5\u3002\u8bf7\u786e\u8ba4\u8868\u683c\u5df2\u516c\u5f00\u53ef\u8bbf\u95ee\uff0c\u6216\u8005\u5148\u5728\u5f39\u51fa\u7684\u6d4f\u89c8\u5668\u91cc\u5b8c\u6210\u4e00\u6b21\u98de\u4e66\u767b\u5f55\u3002"
      );
    }

    await context.storageState({ path: storageStatePath });
    await options.saveStorageStatePath?.(siteKey, storageStatePath);

    const discoveredAt = new Date().toISOString();
    return rows.map((row) => {
      const ats = inferAtsFromApplyUrl(row.applyUrl);
      const title = buildSheetJobTitle(row);
      const detailLines = [
        row.details,
        row.batch ? `Batch: ${row.batch}` : undefined,
        row.referralCode ? `Referral Code: ${row.referralCode}` : undefined
      ]
        .filter(Boolean)
        .join("\n");

      return DiscoveredJobSchema.parse({
        id: randomUUID(),
        sourceId: source.id,
        fingerprint: buildFingerprint({
          company: row.company,
          title,
          location: defaultLocation,
          applyUrl: row.applyUrl
        }),
        ats,
        company: row.company,
        title,
        location: defaultLocation,
        applyUrl: row.applyUrl,
        hostedUrl:
          ats === "greenhouse" || ats === "lever" || ats === "moka" ? row.applyUrl : undefined,
        description:
          detailLines ||
          (ats === "greenhouse" || ats === "lever"
            ? "\u8fd9\u662f\u4ece\u98de\u4e66\u5c97\u4f4d\u8868\u5bfc\u5165\u7684\u53ef\u76f4\u63a5\u81ea\u52a8\u6295\u9012\u94fe\u63a5\u3002"
            : ats === "moka"
              ? "\u8fd9\u662f\u4ece\u98de\u4e66\u5c97\u4f4d\u8868\u5bfc\u5165\u7684 Moka \u5165\u53e3\u94fe\u63a5\u3002\u7cfb\u7edf\u4f1a\u5148\u5c1d\u8bd5\u8fdb\u5165\u5c97\u4f4d\u8be6\u60c5\u5e76\u70b9\u51fb\u7533\u8bf7\uff0c\u9047\u5230\u767b\u5f55/\u9a8c\u8bc1\u7801\u65f6\u518d\u5207\u6362\u4e3a\u4eba\u5de5\u63a5\u7ba1\u3002"
            : "\u8fd9\u662f\u4ece\u98de\u4e66\u5c97\u4f4d\u8868\u5bfc\u5165\u7684\u5c97\u4f4d\u5165\u53e3\u6216\u5c97\u4f4d\u8be6\u60c5\u94fe\u63a5\u3002\u7cfb\u7edf\u4f1a\u5148\u6253\u5f00\u53ef\u89c1\u6d4f\u89c8\u5668\uff0c\u4f60\u5728\u9875\u9762\u91cc\u624b\u52a8\u9009\u5c97/\u767b\u5f55\u540e\uff0c\u53ef\u4ee5\u56de\u5230\u786e\u8ba4\u961f\u5217\u7ee7\u7eed\u81ea\u52a8\u586b\u8868\u3002"),
        metadata: {
          sourceKind: "feishu_sheet",
          batch: row.batch,
          referralCode: row.referralCode ?? extractReferralCode(row.applyUrl),
          autoApplyEligible: true
        },
        sourceSeedUrl: source.seedUrl,
        discoveredAt,
        updatedAt: discoveredAt
      });
    });
  } finally {
    await Promise.allSettled([page.close(), context.close(), browser.close()]);
  }
};

export class JobDiscoveryService {
  constructor(private readonly options: DiscoveryServiceOptions = {}) {}

  private get fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  detectSourceKind(seedUrl: string): z.infer<typeof JobSourceKindSchema> {
    return detectKindFromUrl(seedUrl);
  }

  async discover(source: JobSource): Promise<DiscoveredJob[]> {
    switch (source.kind) {
      case "greenhouse":
        return mapGreenhouseJobs(source, {
          fetchImpl: this.fetchImpl,
          greenhouseApiBase: this.options.greenhouseApiBase
        });
      case "lever":
        return mapLeverJobs(source, {
          fetchImpl: this.fetchImpl,
          leverApiBase: this.options.leverApiBase
        });
      case "feishu_sheet":
        if (!this.options.browser) {
          throw new Error("\u5f53\u524d\u8fd0\u884c\u73af\u5883\u6ca1\u6709\u914d\u7f6e\u98de\u4e66\u8868\u683c\u626b\u63cf\u6240\u9700\u7684\u6d4f\u89c8\u5668\u80fd\u529b\u3002");
        }
        return mapFeishuSheetJobs(source, this.options.browser);
      case "generic":
      default:
        return mapJsonLdJobs(source, {
          fetchImpl: this.fetchImpl
        });
    }
  }
}

export const discoveryUtils = {
  buildFingerprint,
  deriveGreenhouseToken,
  deriveLeverSite,
  detectSourceKind: detectKindFromUrl,
  extractJobPostingNodes,
  isFeishuSheetUrl,
  inferAtsFromApplyUrl,
  isLikelyApplyLink,
  extractReferralCode,
  parseFeishuSnapshotRows: parseFeishuSnapshotRowsV2
};
