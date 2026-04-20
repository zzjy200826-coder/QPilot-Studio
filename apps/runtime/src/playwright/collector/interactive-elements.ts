import type { Frame, Page } from "playwright";
import type { InteractiveElement } from "@qpilot/shared";

const MAX_ELEMENTS = 220;
const MAX_ELEMENTS_PER_FRAME = 72;

interface FrameCollectionResult {
  elements: InteractiveElement[];
  frameUrl?: string;
  frameTitle?: string;
}

const INTERACTIVE_SELECTOR_PARTS = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "iframe",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='option']",
  "[role='radio']",
  "[role='checkbox']",
  "[role='textbox']",
  "[onclick]",
  "[tabindex]",
  "[aria-haspopup]",
  "[data-testid]",
  "[data-test]",
  "[contenteditable='true']"
];

const STRUCTURE_SELECTOR_PARTS = [
  "label",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "form",
  "section[id]",
  "section[class]",
  "article[id]",
  "article[class]",
  "nav",
  "main",
  "header",
  "footer",
  "aside",
  "div[id]",
  "div[class]",
  "span[id]",
  "span[class]",
  "li[id]",
  "li[class]",
  "img[alt]",
  "img[id]",
  "img[class]",
  "[aria-label]",
  "[title]"
];

const FRAME_SELECTOR = Array.from(
  new Set([...INTERACTIVE_SELECTOR_PARTS, ...STRUCTURE_SELECTOR_PARTS])
).join(",");

const CONTEXT_ROOT_SELECTOR = [
  "dialog",
  "[role='dialog']",
  "[role='alertdialog']",
  "[aria-modal='true']",
  "[id*='modal']",
  "[id*='dialog']",
  "[id*='popup']",
  ".modal",
  ".dialog",
  ".popup",
  "[class*='modal']",
  "[class*='dialog']",
  "[class*='popup']"
].join(",");

const CONTEXT_CHILD_SELECTOR = Array.from(
  new Set([...INTERACTIVE_SELECTOR_PARTS, ...STRUCTURE_SELECTOR_PARTS])
).join(",");

const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea", "summary"]);
const STRUCTURE_TAGS = new Set([
  "label",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "form",
  "section",
  "article",
  "nav",
  "main",
  "header",
  "footer",
  "aside",
  "div",
  "span",
  "li",
  "img",
  "iframe"
]);

const safeHost = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

const frameLabelFrom = (
  framePath: string,
  frameUrl?: string,
  frameTitle?: string
): string => {
  const trimmedTitle = frameTitle?.trim();
  if (trimmedTitle) {
    return trimmedTitle.slice(0, 80);
  }

  const host = safeHost(frameUrl);
  if (host) {
    return host;
  }

  return framePath === "main" ? "main page" : framePath;
};

const scoreElement = (element: InteractiveElement): number => {
  let score = 0;
  const tag = element.tag.toLowerCase();

  if (
    element.contextType === "modal" ||
    element.contextType === "dialog" ||
    element.contextType === "iframe-modal"
  ) {
    score += 12;
  }
  if (tag === "iframe") {
    score += 10;
  }
  if (INTERACTIVE_TAGS.has(tag)) {
    score += 8;
  }
  if (element.type === "password") {
    score += 10;
  }
  if (element.framePath && element.framePath !== "main") {
    score += 4;
  }
  if (element.id) {
    score += 4;
  }
  if (element.text || element.ariaLabel || element.placeholder) {
    score += 3;
  }
  if (element.contextLabel) {
    score += 2;
  }
  if (element.testId) {
    score += 2;
  }
  if (STRUCTURE_TAGS.has(tag)) {
    score += 1;
  }

  return score;
};

const dedupeKey = (element: InteractiveElement): string =>
  [
    element.framePath ?? "main",
    element.selector ?? "",
    element.text ?? "",
    element.contextLabel ?? "",
    element.title ?? ""
  ].join("|");

const buildSyntheticFrameElement = (
  framePath: string,
  result: FrameCollectionResult
): InteractiveElement | null => {
  if (framePath === "main" || result.elements.length === 0) {
    return null;
  }

  const label = frameLabelFrom(framePath, result.frameUrl, result.frameTitle);
  const nearby = result.frameUrl?.slice(0, 180);

  return {
    tag: "iframe",
    selector: `iframe[data-frame-path='${framePath}']`,
    text: `Frame: ${label}`,
    ariaLabel: result.frameTitle?.slice(0, 160) || label,
    title: result.frameUrl?.slice(0, 160),
    nearbyText: nearby,
    contextType: "iframe",
    framePath,
    frameUrl: result.frameUrl,
    frameTitle: result.frameTitle,
    isVisible: true,
    isEnabled: true
  };
};

const collectFrameElements = async (
  frame: Frame,
  framePath: string,
  limit: number
): Promise<FrameCollectionResult> => {
  const payload = await frame
    .evaluate(
      ({
        selector,
        contextRootSelector,
        contextChildSelector,
        limit: innerLimit,
        framePath: innerFramePath
      }) => {
        const uniqueNodes = new Set<Element>(Array.from(document.querySelectorAll(selector)));

        for (const root of Array.from(document.querySelectorAll(contextRootSelector))) {
          uniqueNodes.add(root);
          for (const child of Array.from(root.querySelectorAll(contextChildSelector))) {
            uniqueNodes.add(child);
          }
        }

        const nodes = Array.from(uniqueNodes);

        const normalizeText = (value: string | null | undefined): string | undefined => {
          const next = value?.replace(/\s+/g, " ").trim();
          return next ? next.slice(0, 160) : undefined;
        };

        const textFromNode = (node: Element | null | undefined): string | undefined => {
          if (!(node instanceof HTMLElement)) {
            return undefined;
          }
          return normalizeText(node.innerText);
        };

        const textFromIdRef = (value: string | null): string | undefined => {
          if (!value) {
            return undefined;
          }

          return (
            value
              .split(/\s+/)
              .map((id) => textFromNode(document.getElementById(id)))
              .filter(Boolean)
              .join(" ")
              .trim() || undefined
          );
        };

        const isVisible = (element: HTMLElement): boolean => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            Number(style.opacity || "1") > 0 &&
            rect.width > 1 &&
            rect.height > 1
          );
        };

        const frameSource = (element: HTMLElement): string | undefined =>
          element.tagName.toLowerCase() === "iframe"
            ? normalizeText((element as HTMLIFrameElement).src || element.getAttribute("src"))
            : undefined;

        const deriveContextRoot = (element: HTMLElement): HTMLElement | null =>
          element.closest(contextRootSelector);

        const deriveContextLabel = (contextRoot: HTMLElement | null): string | undefined => {
          if (!contextRoot) {
            return undefined;
          }

          const heading = contextRoot.querySelector("h1,h2,h3,h4,h5,h6,[role='heading'],.title,.header");
          return (
            normalizeText(contextRoot.getAttribute("aria-label")) ||
            normalizeText(contextRoot.getAttribute("title")) ||
            normalizeText(textFromNode(heading)) ||
            normalizeText(contextRoot.innerText)
          );
        };

        const labelTextFor = (element: HTMLElement): string | undefined => {
          if ("labels" in element) {
            const labels = Array.from((element as HTMLInputElement).labels ?? []);
            const joined = labels
              .map((label) => textFromNode(label))
              .filter(Boolean)
              .join(" ")
              .trim();
            if (joined) {
              return joined;
            }
          }

          const labelledBy = textFromIdRef(element.getAttribute("aria-labelledby"));
          if (labelledBy) {
            return labelledBy;
          }

          const closestLabel = textFromNode(element.closest("label"));
          if (closestLabel) {
            return closestLabel;
          }

          if (element.id) {
            return textFromNode(document.querySelector(`label[for="${CSS.escape(element.id)}"]`));
          }

          return undefined;
        };

        const nearbyText = (element: HTMLElement, contextRoot: HTMLElement | null): string | undefined => {
          const bits = [
            labelTextFor(element),
            textFromNode(element.previousElementSibling),
            textFromNode(element.nextElementSibling),
            textFromNode(contextRoot?.querySelector("h1,h2,h3,h4,h5,h6,[role='heading'],.title,.header") ?? null)
          ]
            .filter(Boolean)
            .join(" ")
            .trim();
          return bits ? bits.slice(0, 180) : undefined;
        };

        const deriveSemanticLabel = (
          element: HTMLElement,
          role?: string,
          frameSrc?: string
        ): string | undefined => {
          const tag = element.tagName.toLowerCase();
          const inputType =
            "type" in element ? String((element as HTMLInputElement).type || "").toLowerCase() : "";

          if (tag === "iframe") {
            return "Embedded frame";
          }
          if (tag === "input") {
            if (inputType === "password") {
              return "Password field";
            }
            if (inputType === "email") {
              return "Email field";
            }
            if (inputType === "search") {
              return "Search field";
            }
            if (inputType === "submit") {
              return "Submit input";
            }
            if (inputType === "checkbox") {
              return "Checkbox";
            }
            if (inputType === "radio") {
              return "Radio option";
            }
            return "Input field";
          }
          if (tag === "textarea") {
            return "Text area";
          }
          if (tag === "select") {
            return "Select field";
          }
          if (tag === "button" || role === "button") {
            return "Button";
          }
          if (tag === "a" || role === "link") {
            return "Link";
          }
          if (tag === "summary") {
            return "Summary toggle";
          }
          if (tag === "label") {
            return "Label";
          }
          if (/^h[1-6]$/.test(tag)) {
            return `Heading ${tag.slice(1)}`;
          }
          if (tag === "form") {
            return "Form";
          }
          if (tag === "nav") {
            return "Navigation";
          }
          if (tag === "img") {
            return "Image";
          }
          if (frameSrc) {
            return "Frame host";
          }

          return undefined;
        };

        const priorityFor = (
          element: HTMLElement,
          contextRoot: HTMLElement | null,
          text?: string,
          ariaLabel?: string,
          frameSrc?: string
        ): number => {
          const tag = element.tagName.toLowerCase();
          let score = 0;

          if (contextRoot) {
            score += 24;
          }
          if (tag === "iframe") {
            score += 16;
          }
          if (["input", "textarea", "select"].includes(tag)) {
            score += 12;
          }
          if (["button", "a", "summary"].includes(tag)) {
            score += 10;
          }
          if (/^h[1-6]$/.test(tag) || tag === "form" || tag === "nav") {
            score += 6;
          }
          if (element.id) {
            score += 6;
          }
          if (text || ariaLabel) {
            score += 4;
          }
          if (frameSrc) {
            score += 6;
          }
          if (
            "type" in element &&
            String((element as HTMLInputElement).type || "").toLowerCase() === "password"
          ) {
            score += 10;
          }
          if (innerFramePath !== "main") {
            score += 3;
          }

          return score;
        };

        const toSelector = (element: HTMLElement): string => {
          const tag = element.tagName.toLowerCase();

          if (element.id) {
            return `#${element.id}`;
          }

          const testId = element.getAttribute("data-testid") || element.getAttribute("data-test");
          if (testId) {
            return `${tag}[data-testid='${testId}']`;
          }

          const name = element.getAttribute("name");
          if (name) {
            return `${tag}[name='${name}']`;
          }

          const ariaLabel = element.getAttribute("aria-label");
          if (ariaLabel) {
            return `${tag}[aria-label='${ariaLabel}']`;
          }

          const title = element.getAttribute("title");
          if (title) {
            return `${tag}[title='${title}']`;
          }

          if (element.className) {
            const classes = String(element.className)
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((item) => `.${item}`)
              .join("");
            if (classes) {
              return `${tag}${classes}`;
            }
          }

          return tag;
        };

        return {
          frameUrl: window.location.href,
          frameTitle: document.title || undefined,
          elements: nodes
            .filter((node): node is HTMLElement => node instanceof HTMLElement)
            .map((node, index) => {
              const element = node as HTMLElement & HTMLInputElement;
              const tag = element.tagName.toLowerCase();
              const visible = isVisible(element);
              const isDisabled =
                element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
              const contextRoot = deriveContextRoot(element);
              const contextLabel = deriveContextLabel(contextRoot);
              const frameSrc = frameSource(element);
              const role = normalizeText(element.getAttribute("role"));
              const semanticLabel = deriveSemanticLabel(element, role, frameSrc);
              const text =
                normalizeText(element.innerText) ||
                normalizeText(labelTextFor(element)) ||
                semanticLabel;
              const ariaLabel =
                normalizeText(element.getAttribute("aria-label")) ||
                normalizeText(textFromIdRef(element.getAttribute("aria-labelledby"))) ||
                semanticLabel;
              const type = "type" in element ? element.type || undefined : undefined;
              const testId = normalizeText(
                element.getAttribute("data-testid") || element.getAttribute("data-test")
              );
              const title = normalizeText(element.getAttribute("title")) || frameSrc;
              const rawValue =
                type && type.toLowerCase() === "password"
                  ? undefined
                  : "value" in element
                    ? normalizeText(String(element.value || ""))
                    : undefined;
              const currentContextType = (contextRoot
                ? innerFramePath === "main"
                  ? role === "dialog"
                    ? "dialog"
                    : "modal"
                  : "iframe-modal"
                : innerFramePath === "main"
                  ? "page"
                  : "iframe") as InteractiveElement["contextType"];
              const priority = priorityFor(element, contextRoot, text, ariaLabel, frameSrc);
              const nearby = [nearbyText(element, contextRoot), frameSrc]
                .filter(Boolean)
                .join(" ")
                .trim();

              return {
                order: index,
                priority,
                tag,
                id: element.id || undefined,
                className: String(element.className || "") || undefined,
                selector: toSelector(element),
                text,
                type,
                placeholder: normalizeText(element.getAttribute("placeholder")),
                name: normalizeText(element.getAttribute("name")),
                ariaLabel,
                role,
                title,
                testId,
                value: rawValue,
                nearbyText: nearby ? nearby.slice(0, 180) : undefined,
                contextType: currentContextType,
                contextLabel,
                framePath: innerFramePath,
                frameUrl: window.location.href,
                frameTitle: document.title || undefined,
                isVisible: visible,
                isEnabled: !isDisabled
              };
            })
            .filter((item) => item.isVisible && item.isEnabled && item.type !== "hidden")
            .sort((left, right) => right.priority - left.priority || left.order - right.order)
            .slice(0, innerLimit)
            .map(({ order: _order, priority: _priority, ...item }) => item)
        };
      },
      {
        selector: FRAME_SELECTOR,
        contextRootSelector: CONTEXT_ROOT_SELECTOR,
        contextChildSelector: CONTEXT_CHILD_SELECTOR,
        limit,
        framePath
      }
    )
    .catch(() => ({
      frameUrl: frame.url(),
      frameTitle: undefined,
      elements: []
    }));

  return payload;
};

export const collectInteractiveElements = async (page: Page): Promise<InteractiveElement[]> => {
  const frameResults = await Promise.all(
    page.frames().map((frame, index) => {
      const framePath = frame === page.mainFrame() ? "main" : `frame-${index}`;
      return collectFrameElements(frame, framePath, MAX_ELEMENTS_PER_FRAME).then((result) => ({
        framePath,
        result
      }));
    })
  );

  const deduped = new Map<string, InteractiveElement>();

  for (const { result } of frameResults) {
    for (const element of result.elements) {
      const key = dedupeKey(element);
      const existing = deduped.get(key);
      if (!existing || scoreElement(element) > scoreElement(existing)) {
        deduped.set(key, element);
      }
    }
  }

  for (const { framePath, result } of frameResults) {
    const synthetic = buildSyntheticFrameElement(framePath, result);
    if (!synthetic) {
      continue;
    }

    const key = dedupeKey(synthetic);
    const existing = deduped.get(key);
    if (!existing || scoreElement(synthetic) > scoreElement(existing)) {
      deduped.set(key, synthetic);
    }
  }

  return Array.from(deduped.values())
    .sort((left, right) => scoreElement(right) - scoreElement(left))
    .slice(0, MAX_ELEMENTS);
};
