import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action } from "@qpilot/shared";
import type { Page } from "playwright";
import Tesseract from "tesseract.js";

const OCR_CACHE_DIR = join(tmpdir(), "qpilot-runtime-ocr");
const MIN_SURFACE_WIDTH = 40;
const MIN_SURFACE_HEIGHT = 20;
const MIN_FRAGMENT_CONFIDENCE = 12;
const MIN_MATCH_SCORE = 0.68;
const QUOTED_SEGMENT_PATTERN =
  /["'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f\u300a\u300b](.+?)["'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f\u300a\u300b]/g;
const NOTE_SPLIT_PATTERN = /[,.!?;:()\[\]{}<>/\u3002\uff0c\uff1f\uff01\uff1b\uff1a\u3001]+/;
const ACTION_WORD_PATTERN =
  /\b(?:click|tap|press|open|choose|select|switch(?:\s+to)?|go\s+to|focus|search)\b|\u70b9\u51fb|\u5355\u51fb|\u53cc\u51fb|\u6253\u5f00|\u8fdb\u5165|\u9009\u62e9|\u5207\u6362(?:\u5230)?|\u524d\u5f80|\u805a\u7126|\u641c\u7d22/gi;
const UI_NOISE_PATTERN =
  /\b(?:button|link|entry|option|dialog|modal|popup|tab|page|screen|section|field|result|results)\b|\u6309\u94ae|\u94fe\u63a5|\u5165\u53e3|\u9009\u9879|\u5f39\u7a97|\u7a97\u53e3|\u9875\u7b7e|\u9875\u9762|\u533a\u57df|\u5b57\u6bb5|\u754c\u9762|\u641c\u7d22\u7ed3\u679c/gi;
const SELECTOR_TEXT_PATTERNS = [
  /:has-text\((['"])(.*?)\1\)/gi,
  /\[(?:title|aria-label|name|placeholder|alt)\s*=\s*(['"])(.*?)\1\]/gi,
  /\btext=(['"]?)(.+?)\1$/gi
] as const;

mkdirSync(OCR_CACHE_DIR, { recursive: true });

type OcrWorker = Tesseract.Worker;
type OcrBlock = Tesseract.Block;
type OcrBbox = Tesseract.Bbox;

interface VisualSurface {
  label: string;
  offsetX: number;
  offsetY: number;
  image: Buffer;
}

export interface OcrTextFragment {
  text: string;
  normalizedText: string;
  confidence: number;
  kind: "line" | "word";
  bbox: OcrBbox;
  surfaceLabel: string;
  offsetX: number;
  offsetY: number;
}

export interface OcrFragmentMatch {
  candidate: string;
  fragment: OcrTextFragment;
  score: number;
}

export interface VisualClickTarget {
  x: number;
  y: number;
  confidence: number;
  matchedText: string;
  surfaceLabel: string;
  targetUsed: string;
}

let workerPromise: Promise<OcrWorker> | null = null;

const CSS_LIKE_TARGET = /^(#|\.|\[|\/|xpath=|text=|css=|id=|name=|role=|nth=|>>)|[>:[\].=#]/i;

const normalizeVisualText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

const safeHost = (value: string): string | null => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const normalizeHint = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, " ").trim();

const uniquePush = (values: string[], value: string, seen: Set<string>): void => {
  const trimmed = value.trim();
  const normalized = normalizeHint(trimmed);
  if (trimmed.length < 2 || seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  values.push(trimmed);
};

const sanitizeCandidate = (value: string): string =>
  value
    .replace(ACTION_WORD_PATTERN, " ")
    .replace(UI_NOISE_PATTERN, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractQuotedSegments = (value?: string): string[] => {
  if (!value) {
    return [];
  }

  return Array.from(value.matchAll(QUOTED_SEGMENT_PATTERN))
    .map((match) => match[1]?.trim() ?? "")
    .filter((item) => item.length >= 2);
};

const extractSelectorLiteralTexts = (target?: string): string[] => {
  if (!target) {
    return [];
  }

  const values = new Set<string>();
  for (const pattern of SELECTOR_TEXT_PATTERNS) {
    const matches = Array.from(target.matchAll(pattern));
    for (const match of matches) {
      const rawValue = match[2]?.trim();
      if (!rawValue || rawValue.length < 2) {
        continue;
      }
      values.add(rawValue);
    }
  }

  return Array.from(values);
};

export const deriveVisualSearchTexts = (action: Action): string[] => {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const quoted of extractQuotedSegments(action.note)) {
    uniquePush(candidates, sanitizeCandidate(quoted), seen);
  }

  for (const item of extractSelectorLiteralTexts(action.target)) {
    uniquePush(candidates, sanitizeCandidate(item), seen);
  }

  if (action.target && !CSS_LIKE_TARGET.test(action.target.trim())) {
    uniquePush(candidates, sanitizeCandidate(action.target), seen);
  }

  if (action.note) {
    for (const chunk of action.note.split(NOTE_SPLIT_PATTERN)) {
      uniquePush(candidates, sanitizeCandidate(chunk), seen);
    }
  }

  return candidates;
};

const isSubsequence = (needle: string, haystack: string): boolean => {
  let pointer = 0;
  for (const char of haystack) {
    if (needle[pointer] === char) {
      pointer += 1;
      if (pointer >= needle.length) {
        return true;
      }
    }
  }

  return pointer >= needle.length;
};

const computeMatchScore = (candidate: string, fragmentText: string): number => {
  const normalizedCandidate = normalizeVisualText(candidate);
  const normalizedFragment = normalizeVisualText(fragmentText);
  if (normalizedCandidate.length < 2 || normalizedFragment.length < 1) {
    return 0;
  }
  if (normalizedCandidate === normalizedFragment) {
    return 1;
  }
  if (normalizedFragment.includes(normalizedCandidate)) {
    return 0.92;
  }
  if (
    normalizedCandidate.includes(normalizedFragment) &&
    normalizedFragment.length >= Math.max(2, Math.ceil(normalizedCandidate.length * 0.45))
  ) {
    return 0.76 * (normalizedFragment.length / normalizedCandidate.length);
  }
  if (isSubsequence(normalizedCandidate, normalizedFragment)) {
    return 0.62;
  }
  return 0;
};

export const pickBestOcrFragmentMatch = (
  candidates: string[],
  fragments: OcrTextFragment[]
): OcrFragmentMatch | null => {
  let best: OcrFragmentMatch | null = null;

  for (const [candidateIndex, candidate] of candidates.entries()) {
    for (const fragment of fragments) {
      const textScore = computeMatchScore(candidate, fragment.text);
      if (textScore <= 0) {
        continue;
      }

      const confidenceBoost = Math.min(Math.max(fragment.confidence, 0), 100) / 100 * 0.16;
      const kindBoost = fragment.kind === "line" ? 0.03 : 0;
      const candidateBoost = Math.max(0, 0.06 - candidateIndex * 0.01);
      const score = textScore + confidenceBoost + kindBoost + candidateBoost;

      if (!best || score > best.score) {
        best = {
          candidate,
          fragment,
          score
        };
      }
    }
  }

  if (!best || best.score < MIN_MATCH_SCORE) {
    return null;
  }

  return best;
};

const flattenOcrFragments = (
  surface: VisualSurface,
  blocks: OcrBlock[] | null
): OcrTextFragment[] => {
  if (!blocks) {
    return [];
  }

  const fragments: OcrTextFragment[] = [];

  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const lineText = line.text.trim();
        const normalizedLineText = normalizeVisualText(lineText);
        if (normalizedLineText.length >= 2 && line.confidence >= MIN_FRAGMENT_CONFIDENCE) {
          fragments.push({
            text: lineText,
            normalizedText: normalizedLineText,
            confidence: line.confidence,
            kind: "line",
            bbox: line.bbox,
            surfaceLabel: surface.label,
            offsetX: surface.offsetX,
            offsetY: surface.offsetY
          });
        }

        for (const word of line.words) {
          const wordText = word.text.trim();
          const normalizedWordText = normalizeVisualText(wordText);
          if (normalizedWordText.length < 1 || word.confidence < MIN_FRAGMENT_CONFIDENCE) {
            continue;
          }
          fragments.push({
            text: wordText,
            normalizedText: normalizedWordText,
            confidence: word.confidence,
            kind: "word",
            bbox: word.bbox,
            surfaceLabel: surface.label,
            offsetX: surface.offsetX,
            offsetY: surface.offsetY
          });
        }
      }
    }
  }

  return fragments;
};

const getWorker = async (): Promise<OcrWorker> => {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await Tesseract.createWorker("eng+chi_sim", Tesseract.OEM.DEFAULT, {
        cachePath: OCR_CACHE_DIR
      });
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1"
      });
      return worker;
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }

  return workerPromise;
};

const buildVisualSurfaces = async (page: Page): Promise<VisualSurface[]> => {
  const surfaces: VisualSurface[] = [];
  const pageScreenshot = await page.screenshot({
    type: "png",
    fullPage: false,
    caret: "hide",
    animations: "disabled",
    scale: "css"
  });

  surfaces.push({
    label: "main",
    offsetX: 0,
    offsetY: 0,
    image: pageScreenshot
  });

  for (const [index, frame] of page.frames().entries()) {
    if (frame === page.mainFrame()) {
      continue;
    }

    try {
      const frameElement = await frame.frameElement();
      const box = await frameElement.boundingBox();
      if (!box || box.width < MIN_SURFACE_WIDTH || box.height < MIN_SURFACE_HEIGHT) {
        continue;
      }

      const image = await frameElement.screenshot({
        type: "png",
        caret: "hide",
        animations: "disabled",
        scale: "css"
      });
      surfaces.push({
        label: safeHost(frame.url()) ?? `frame-${index}`,
        offsetX: box.x,
        offsetY: box.y,
        image
      });
    } catch {
      continue;
    }
  }

  return surfaces;
};

export const resolveVisualClickTarget = async (
  page: Page,
  action: Action
): Promise<VisualClickTarget | null> => {
  const candidates = deriveVisualSearchTexts(action);
  if (candidates.length === 0) {
    return null;
  }

  const worker = await getWorker();
  const surfaces = await buildVisualSurfaces(page);
  const fragments: OcrTextFragment[] = [];

  for (const surface of surfaces) {
    const result = await worker.recognize(
      surface.image,
      {},
      {
        blocks: true
      }
    );
    fragments.push(...flattenOcrFragments(surface, result.data.blocks));
  }

  const match = pickBestOcrFragmentMatch(candidates, fragments);
  if (!match) {
    return null;
  }

  const centerX = match.fragment.offsetX + (match.fragment.bbox.x0 + match.fragment.bbox.x1) / 2;
  const centerY = match.fragment.offsetY + (match.fragment.bbox.y0 + match.fragment.bbox.y1) / 2;

  return {
    x: Math.max(1, Math.round(centerX)),
    y: Math.max(1, Math.round(centerY)),
    confidence: match.fragment.confidence,
    matchedText: match.fragment.text,
    surfaceLabel: match.fragment.surfaceLabel,
    targetUsed: `[ocr:${match.candidate}->${match.fragment.text}@${match.fragment.surfaceLabel}]`
  };
};
