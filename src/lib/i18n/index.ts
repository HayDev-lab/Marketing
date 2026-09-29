import { core } from "./dicts/core";
import { brands } from "./dicts/brands";
import { trends } from "./dicts/trends";
import { planner } from "./dicts/planner";
import { studio } from "./dicts/studio";
import { analytics } from "./dicts/analytics";
import { publishing } from "./dicts/publishing";
import { settings } from "./dicts/settings";
import { mcp } from "./dicts/mcp";
import { autopilot } from "./dicts/autopilot";

export type Locale = "hy" | "ru" | "en";
export const LOCALES: Locale[] = ["hy", "ru", "en"];
export const LOCALE_LABELS: Record<Locale, string> = { hy: "Հայերեն", ru: "Русский", en: "English" };
export type Dict = Record<string, string>;

const MODULES: Record<Locale, Dict>[] = [core, brands, trends, planner, studio, analytics, publishing, settings, mcp, autopilot];

export const DICTIONARIES: Record<Locale, Dict> = {
  hy: Object.assign({}, ...MODULES.map((m) => m.hy)),
  ru: Object.assign({}, ...MODULES.map((m) => m.ru)),
  en: Object.assign({}, ...MODULES.map((m) => m.en)),
};

export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  let text = DICTIONARIES[locale]?.[key] ?? DICTIONARIES.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

// Development i18n QA: returns keys present in EN but missing in other locales
export function missingKeys(): Record<Locale, string[]> {
  const report: Record<Locale, string[]> = { hy: [], ru: [], en: [] };
  for (const key of Object.keys(DICTIONARIES.en)) {
    for (const locale of ["hy", "ru", "en"] as Locale[]) {
      if (!DICTIONARIES[locale][key]) report[locale].push(key);
    }
  }
  return report;
}
