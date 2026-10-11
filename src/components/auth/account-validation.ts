/**
 * Client-side checks for the account forms. They only give early, field-level
 * feedback; the server applies the same rules and decides.
 */
import { ACCOUNT_LIMITS, normalizeLogin, type AccountRegistration } from "@/lib/client/accounts-api";
import type { AccessCopy } from "@/lib/client/copy/access";
import type { Language } from "@/lib/client/api";

export interface RegistrationDraft {
  login: string;
  password: string;
  passwordConfirm: string;
  displayName: string;
  region: string;
  age: string;
  language: Language;
  consent: boolean;
  fictional: boolean;
  claimCode: string;
}

export type RegistrationField = Exclude<keyof RegistrationDraft, "language">;
export type FieldErrors<F extends string> = Partial<Record<F, string>>;

/** Field order used to focus the first invalid control. */
export const REGISTRATION_FIELDS: readonly RegistrationField[] = [
  "login",
  "password",
  "passwordConfirm",
  "displayName",
  "region",
  "age",
  "consent",
  "fictional",
  "claimCode",
];

function passwordLengthOk(password: string): boolean {
  const length = [...password].length;
  return length >= ACCOUNT_LIMITS.passwordMin && length <= ACCOUNT_LIMITS.passwordMax;
}

export function validateLogin(login: string, password: string, copy: AccessCopy["auth"]): FieldErrors<"login" | "password"> {
  const errors: FieldErrors<"login" | "password"> = {};
  if (!login.trim()) errors.login = copy.required;
  if (!password) errors.password = copy.required;
  return errors;
}

export function validateRegistration(draft: RegistrationDraft, copy: AccessCopy["auth"]): FieldErrors<RegistrationField> {
  const errors: FieldErrors<RegistrationField> = {};
  const login = normalizeLogin(draft.login);
  if (!login) errors.login = copy.required;
  else if (!ACCOUNT_LIMITS.loginPattern.test(login)) errors.login = copy.invalidLogin;
  if (!draft.password) errors.password = copy.required;
  else if (!passwordLengthOk(draft.password)) errors.password = copy.invalidPassword;
  if (draft.password && draft.passwordConfirm !== draft.password) errors.passwordConfirm = copy.passwordMismatch;
  if (!draft.displayName.trim()) errors.displayName = copy.required;
  if (!draft.region.trim()) errors.region = copy.required;
  const age = Number(draft.age);
  if (!draft.age.trim()) errors.age = copy.required;
  else if (!Number.isInteger(age) || age < ACCOUNT_LIMITS.ageMin || age > ACCOUNT_LIMITS.ageMax) errors.age = copy.invalidAge;
  if (!draft.consent) errors.consent = copy.consentRequired;
  if (!draft.fictional) errors.fictional = copy.fictionalRequired;
  return errors;
}

/** Builds the exact POST /api/accounts body; never includes role/patient/clinician fields. */
export function toRegistration(draft: RegistrationDraft, clientId: string): AccountRegistration {
  const claim = draft.claimCode.trim();
  return {
    login: normalizeLogin(draft.login),
    password: draft.password,
    displayName: draft.displayName.trim().slice(0, ACCOUNT_LIMITS.displayNameMax),
    region: draft.region.trim().slice(0, ACCOUNT_LIMITS.regionMax),
    age: Number(draft.age),
    language: draft.language,
    consent: true,
    fictionalDemo: true,
    clientId,
    ...(claim ? { claimCode: claim } : {}),
  };
}

export function firstInvalid<F extends string>(order: readonly F[], errors: FieldErrors<F>): F | null {
  return order.find((field) => Boolean(errors[field])) ?? null;
}
