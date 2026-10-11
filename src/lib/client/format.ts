/**
 * Display formatting shared by patient and clinician screens. Values are shown
 * exactly as recorded, with their own unit: no silent unit conversion.
 */
import type { Language, Measurement, Status } from "./api";

const LOCALE: Record<Language, string> = {
  fr: "fr-FR",
  // Latin digits keep clinical values unambiguous for Tunisian readers.
  ar: "ar-TN-u-nu-latn",
};

export function localeFor(lang: Language): string {
  return LOCALE[lang];
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(iso: string | null | undefined, lang: Language = "fr"): string {
  const date = parse(iso);
  if (!date) return "—";
  return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatDate(iso: string | null | undefined, lang: Language = "fr"): string {
  const date = parse(iso);
  if (!date) return "—";
  return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: "medium" }).format(date);
}

export function formatTime(iso: string | null | undefined, lang: Language = "fr"): string {
  const date = parse(iso);
  if (!date) return "—";
  return new Intl.DateTimeFormat(LOCALE[lang], { timeStyle: "short" }).format(date);
}

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

export function formatRelative(iso: string | null | undefined, lang: Language = "fr", now: number = Date.now()): string {
  const date = parse(iso);
  if (!date) return "—";
  const seconds = Math.round((date.getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(LOCALE[lang], { numeric: "auto" });
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(seconds) >= size || unit === "second") {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return formatter.format(0, "second");
}

export function formatNumber(value: number, lang: Language = "fr", maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits }).format(value);
}

type MeasurementValue = Pick<Measurement, "kind" | "systolic" | "diastolic" | "value" | "unit">;

/** "142/91" for blood pressure, "7,2" for glucose, "72" for pulse — without unit. */
export function formatMeasurementNumber(m: MeasurementValue, lang: Language = "fr"): string {
  if (m.kind === "blood_pressure") {
    if (m.systolic === undefined || m.diastolic === undefined) return "—";
    return `${formatNumber(m.systolic, lang, 0)}/${formatNumber(m.diastolic, lang, 0)}`;
  }
  if (m.value === undefined) return "—";
  // Pulse (bpm) and mg/dL are whole numbers; only mmol/L keeps one decimal.
  return formatNumber(m.value, lang, m.unit === "mmol/L" ? 1 : 0);
}

/** "142/91 mmHg" or "7,2 mmol/L". */
export function formatMeasurement(m: MeasurementValue, lang: Language = "fr"): string {
  const number = formatMeasurementNumber(m, lang);
  return number === "—" ? number : `${number} ${m.unit}`;
}

const KIND_LABEL: Record<Language, Record<Measurement["kind"], string>> = {
  fr: { blood_pressure: "Tension artérielle", glucose: "Glycémie", pulse: "Pouls" },
  ar: { blood_pressure: "ضغط الدم", glucose: "سكر الدم", pulse: "النبض" },
};

export function measurementKindLabel(kind: Measurement["kind"], lang: Language = "fr"): string {
  return KIND_LABEL[lang][kind];
}

const SOURCE_LABEL: Record<Language, Record<Measurement["source"], string>> = {
  fr: { app: "Application", telegram: "Telegram", simulated: "Simulé (démo)", device: "Appareil connecté" },
  ar: { app: "التطبيق", telegram: "تيليغرام", simulated: "محاكاة (تجريبي)", device: "جهاز متصل" },
};

export function measurementSourceLabel(source: Measurement["source"], lang: Language = "fr"): string {
  return SOURCE_LABEL[lang][source];
}

/**
 * A reading is simulated when either its source or its server-resolved
 * connector binding says so. This label must follow the reading everywhere.
 */
export function isSimulatedMeasurement(m: Pick<Measurement, "source" | "connector">): boolean {
  return m.source === "simulated" || m.connector?.simulated === true;
}

/** A connector reading flagged "suspect" is excluded from the rules; every list must say so. */
export function isSuspectMeasurement(m: Pick<Measurement, "connector">): boolean {
  return m.connector?.quality === "suspect";
}

/** Same wording as the simulator (SHARE_COPY.simulator.quality.suspect); null when not suspect. */
const SUSPECT_LABEL: Record<Language, string> = {
  fr: "Suspecte (exclue des règles)",
  ar: "مشكوك فيها (مستبعدة من القواعد)",
};

export function measurementQualityLabel(m: Pick<Measurement, "connector">, lang: Language = "fr"): string | null {
  return isSuspectMeasurement(m) ? SUSPECT_LABEL[lang] : null;
}

/** Pulse has no monitoring profile: its value is shown, never classified. */
export function isUnscoredMeasurement(m: Pick<Measurement, "kind">): boolean {
  return m.kind === "pulse";
}

/** Source label that never hides a simulation behind "connected device". */
export function measurementProvenanceLabel(m: Pick<Measurement, "source" | "connector">, lang: Language = "fr"): string {
  return isSimulatedMeasurement(m) ? SOURCE_LABEL[lang].simulated : SOURCE_LABEL[lang][m.source];
}

const UNSCORED_LABEL: Record<Language, string> = {
  fr: "Non évalué (aucun profil de suivi)",
  ar: "غير مُقيَّم (لا يوجد ملف متابعة)",
};

/** Status label for one reading; pulse is "not evaluated", never "missing data". */
export function measurementStatusLabel(m: Pick<Measurement, "kind" | "status">, lang: Language = "fr"): string {
  return isUnscoredMeasurement(m) ? UNSCORED_LABEL[lang] : STATUS_LABEL[lang][m.status];
}

const STATUS_LABEL: Record<Language, Record<Status, string>> = {
  fr: {
    green: "Aucun seuil haut dépassé (démo) — valeurs basses non évaluées",
    orange: "Suivi requis",
    red: "Priorité haute",
    unknown: "Inconnu — données manquantes",
  },
  ar: {
    green: "لم يُتجاوز أي حد أعلى (تجريبي) — القيم المنخفضة غير مُقيَّمة",
    orange: "متابعة مطلوبة",
    red: "أولوية عالية",
    unknown: "غير معروف — بيانات ناقصة",
  },
};

export function statusLabel(status: Status, lang: Language = "fr"): string {
  return STATUS_LABEL[lang][status];
}

/** Sort weight: red first, then orange, unknown, green. */
export function statusRank(status: Status): number {
  return { red: 0, orange: 1, unknown: 2, green: 3 }[status];
}

/** Value for <input type="datetime-local"> in the device's local time. */
export function toDateTimeLocalValue(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Converts a datetime-local value (no zone) into a UTC ISO string, which the
 * API requires ("date avec fuseau horaire"). Returns null when invalid.
 */
export function fromDateTimeLocalValue(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Converts a YYYY-MM-DD date input into an ISO timestamp at local midnight. */
export function fromDateInputValue(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** YYYY-MM-DD for <input type="date"> from an ISO string (local calendar day). */
export function toDateInputValue(iso: string | null | undefined): string {
  const date = parse(iso);
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
