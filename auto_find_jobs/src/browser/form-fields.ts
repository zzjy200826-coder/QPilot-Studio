import type { Page } from "playwright";
import { FormFieldSchema, type FormField } from "../domain/schemas.js";

export const extractFormFields = async (page: Page): Promise<FormField[]> => {
  const rawFields = await page.evaluate(() => {
    const textOf = (value: string | null | undefined): string | undefined => {
      const normalized = value?.replace(/\s+/g, " ").trim();
      return normalized ? normalized : undefined;
    };

    const slugify = (value: string | undefined): string => {
      const normalized = value
        ?.toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
      return normalized || "field";
    };

    const labelFor = (element: Element): string | undefined => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        const labels = Array.from(element.labels ?? [])
          .map((label) => textOf(label.textContent))
          .filter((value): value is string => Boolean(value));
        if (labels[0]) {
          return labels[0];
        }
      }

      const closestLabel = element.closest("label");
      if (closestLabel) {
        return textOf(closestLabel.textContent);
      }

      const parent = element.parentElement;
      const siblings = parent ? Array.from(parent.children) : [];
      for (const sibling of siblings) {
        if (sibling === element) {
          continue;
        }
        const siblingText = textOf(sibling.textContent);
        if (siblingText && siblingText.length <= 120) {
          return siblingText;
        }
      }

      return textOf(
        element.getAttribute("aria-label") ??
          element.getAttribute("placeholder") ??
          element.getAttribute("name")
      );
    };

    const sectionFor = (element: Element): string | undefined => {
      const fieldset = element.closest("fieldset");
      const legend = fieldset?.querySelector("legend");
      if (legend) {
        return textOf(legend.textContent);
      }

      const sectionHeading = element.closest("section, div")?.querySelector("h1, h2, h3, h4");
      return textOf(sectionHeading?.textContent ?? undefined);
    };

    const nodes = Array.from(document.querySelectorAll("input, select, textarea"));
    const grouped = new Set<string>();
    const seenFieldIds = new Map<string, number>();
    const fields: Array<Record<string, unknown>> = [];

    const nextStableFieldId = (parts: Array<string | undefined>): string => {
      const base = parts.map(slugify).filter(Boolean).join("-") || "field";
      const nextCount = (seenFieldIds.get(base) ?? 0) + 1;
      seenFieldIds.set(base, nextCount);
      return nextCount === 1 ? `job-helper-${base}` : `job-helper-${base}-${nextCount}`;
    };

    for (const [index, node] of nodes.entries()) {
      if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement)) {
        continue;
      }

      const type = node instanceof HTMLSelectElement ? "select" : node instanceof HTMLTextAreaElement ? "textarea" : node.type || "text";
      if (type === "hidden") {
        continue;
      }

      if (type === "radio" && node.name) {
        const radioKey = `radio:${node.name}`;
        if (grouped.has(radioKey)) {
          continue;
        }
        grouped.add(radioKey);

        const label = labelFor(node) ?? node.name ?? "Radio field";
        const section = sectionFor(node);
        const groupId = nextStableFieldId([type, node.name, label, section]);
        const radios = Array.from(
          document.querySelectorAll(`input[type="radio"][name="${CSS.escape(node.name)}"]`)
        ) as HTMLInputElement[];
        for (const radio of radios) {
          radio.setAttribute("data-job-helper-field", groupId);
        }

        fields.push({
          fieldId: groupId,
          selector: `[data-job-helper-field="${groupId}"]`,
          label,
          name: node.name,
          section,
          type: "radio",
          required: node.required,
          options: radios.map((radio) => ({
            label: labelFor(radio) ?? radio.value,
            value: radio.value
          }))
        });
        continue;
      }

      const label = labelFor(node) ?? node.getAttribute("name") ?? `Field ${index + 1}`;
      const section = sectionFor(node);
      const fieldId = nextStableFieldId([
        type,
        node.getAttribute("name") ?? undefined,
        node.getAttribute("id") ?? undefined,
        label,
        section
      ]);
      node.setAttribute("data-job-helper-field", fieldId);
      fields.push({
        fieldId,
        selector: `[data-job-helper-field="${fieldId}"]`,
        label,
        name: node.getAttribute("name") ?? undefined,
        placeholder: node.getAttribute("placeholder") ?? undefined,
        section,
        type:
          type === "email" ||
          type === "tel" ||
          type === "url" ||
          type === "textarea" ||
          type === "select-one" ||
          type === "select" ||
          type === "checkbox" ||
          type === "file" ||
          type === "date" ||
          type === "number"
            ? type === "select-one"
              ? "select"
              : type
            : "text",
        required: node.required,
        options:
          node instanceof HTMLSelectElement
            ? Array.from(node.options).map((option) => ({
                label: option.label,
                value: option.value
              }))
            : []
      });
    }

    return fields;
  });

  return rawFields.map((field) => FormFieldSchema.parse(field)) as FormField[];
};
