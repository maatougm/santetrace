/**
 * Source-authored French clinical content (server facts, reasons, care
 * instructions, model explanations, and section forms that are not translated)
 * keeps its own language and direction under an Arabic shell. Spread on the
 * wrapping element: `<div {...FRENCH_SOURCE}>…</div>`. Never machine-translate
 * such content in the frontend.
 */
export const FRENCH_SOURCE = Object.freeze({ lang: "fr", dir: "ltr" } as const);

/**
 * Free text written by a person (patient or clinician messages, external
 * notes, review reasons, and what is being typed in a composer) whose language
 * is NOT recorded. Inside a French island it must not inherit `fr`/`ltr`:
 * an empty `lang` honestly says "language unknown" and `dir="auto"` lets the
 * text's own first strong character choose its direction (Arabic → RTL).
 * Never guess the language (from names, roles, accounts or nationality) and
 * never translate or rewrite the text. Spread on the element holding the text.
 */
export const UNKNOWN_LANGUAGE_TEXT = Object.freeze({ lang: "", dir: "auto" } as const);

/** Simple BCP 47 shape (e.g. "ar", "fr", "ar-TN"); anything else is treated as unknown. */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * Attributes for authored text when the source MAY carry real language
 * metadata: a well-formed recorded tag is kept, otherwise the language is
 * unknown. Direction stays automatic either way (a recorded language does not
 * prove the text's direction). Returns a new object.
 */
export function authoredTextAttrs(recordedLanguage?: string | null): { lang: string; dir: "auto" } {
  const lang = typeof recordedLanguage === "string" && LANGUAGE_TAG.test(recordedLanguage) ? recordedLanguage : "";
  return { lang, dir: "auto" };
}
