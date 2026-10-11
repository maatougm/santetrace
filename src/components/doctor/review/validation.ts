/**
 * Client-side checks for lab review forms, mirroring the backend limits
 * (exam ≤100, unit ≤40, reason ≤500 chars, finite value, calendar date).
 * The server stays authoritative; these give field-level feedback first.
 */
import { isFutureCalendarDate, isValidCalendarDate } from "../shared/dates";

export const LIMITS = { exam: 100, unit: 40, reason: 500, maxValue: 1_000_000 } as const;

export interface ResultDraft {
  exam: string;
  value: string;
  unit: string;
  examDate: string;
  reason: string;
}

export type ResultErrors = Partial<Record<keyof ResultDraft, string>>;

export interface ValidResult {
  exam: string;
  value: number;
  unit: string;
  examDate: string;
  reason: string;
}

export function parseDecimal(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function requiredReason(reason: string, label = "Motif"): string | undefined {
  const trimmed = reason.trim();
  if (!trimmed) return `${label} obligatoire.`;
  if (trimmed.length > LIMITS.reason) return `${LIMITS.reason} caractères au maximum.`;
  return undefined;
}

export function validateResult(draft: ResultDraft, options: { checkExam: boolean }): { errors: ResultErrors; value: ValidResult | null } {
  const errors: ResultErrors = {};
  const exam = draft.exam.trim();
  const unit = draft.unit.trim();
  const value = parseDecimal(draft.value);

  if (options.checkExam) {
    if (!exam) errors.exam = "Nom de l’examen obligatoire.";
    else if (exam.length > LIMITS.exam) errors.exam = `${LIMITS.exam} caractères au maximum.`;
  }
  if (value === null) errors.value = "Valeur numérique obligatoire.";
  else if (value < 0 || value > LIMITS.maxValue) errors.value = "Valeur hors limites.";
  if (!unit) errors.unit = "Unité obligatoire : aucune unité n’est déduite.";
  else if (unit.length > LIMITS.unit) errors.unit = `${LIMITS.unit} caractères au maximum.`;
  if (!draft.examDate) errors.examDate = "Date d’examen obligatoire.";
  else if (!isValidCalendarDate(draft.examDate)) errors.examDate = "Date invalide.";
  else if (isFutureCalendarDate(draft.examDate)) errors.examDate = "La date d’examen ne peut pas être dans le futur.";
  errors.reason = requiredReason(draft.reason, "Motif de correction");

  const hasError = Object.values(errors).some(Boolean);
  return {
    errors,
    value: hasError || value === null ? null : { exam, value, unit, examDate: draft.examDate, reason: draft.reason.trim() },
  };
}
