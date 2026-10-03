import { toLocalISODate } from "./dateMatch";

/** Variables supported inside user templates. */
export const TEMPLATE_VARIABLES = ["name", "phone", "birthday", "date"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/** Matches {varName} tokens, allowing spaces inside the braces. */
const VAR_RE = /\{\s*([A-Za-z]+)\s*\}/g;

export interface RenderedTemplate {
  text: string;
  /** Variable names referenced by the template but absent from the record. */
  unknownVariables: string[];
}

/**
 * Render a template for one contact.
 * Only replaces variables that exist on the record; unknown variables are
 * reported (and left in place) rather than silently removed.
 */
export function renderTemplate(
  template: string,
  record: { name?: string | null; phone?: string | null; birthday?: string | null },
  today: Date = new Date(),
): RenderedTemplate {
  const values: Partial<Record<TemplateVariable, string>> = {
    name: record.name ?? undefined,
    phone: record.phone ?? undefined,
    birthday: record.birthday ?? undefined,
    date: toLocalISODate(today),
  };

  let unknownVariables: string[] = [];
  const text = template.replace(VAR_RE, (full, rawName: string) => {
    const varName = rawName.toLowerCase();
    const value = values[varName as TemplateVariable];
    if (value === null || value === undefined) {
      if (!unknownVariables.includes(varName)) unknownVariables.push(varName);
      return full; // keep {unknown} visible so the user notices
  }
    return value;
  });

  return { text, unknownVariables: [...new Set(unknownVariables)] };
}

/** Extract distinct variable names referenced by a template body. */
export function extractVariables(template: string): string[] {
  const out: string[] = [];
  const re = new RegExp(VAR_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    const name = m[1].toLowerCase();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}
