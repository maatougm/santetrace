/**
 * Patient-owned accounts (feature 006, lot A). Credentials and claim codes are
 * sent once and never stored by the client. After a successful call the form
 * must run `adoptSignedInActor(actor)` before navigating.
 */
import type { Actor } from "@/contracts/care";
import type { AccountLogin, AccountRegistration } from "@/contracts/patient-platform";
import { request, type RequestOptions } from "./transport";
import type { SessionEnvelope } from "./api";

export type { AccountLogin, AccountRegistration };

export interface RegistrationResponse {
  actor: Actor;
  patientId: string;
}

/** POST /api/accounts. A claim code (from a local operator) attaches an existing fictional record. */
export function registerPatient(input: AccountRegistration, options?: RequestOptions): Promise<RegistrationResponse> {
  return request<RegistrationResponse>("/accounts", {
    ...options,
    method: "POST",
    json: input,
    expect: ["actor", "patientId"],
  });
}

/** POST /api/session with login/password, for patients and preconfigured fictional doctors alike. */
export function loginAccount(input: AccountLogin, options?: RequestOptions): Promise<SessionEnvelope> {
  return request<SessionEnvelope>("/session", {
    ...options,
    method: "POST",
    json: { login: input.login, password: input.password },
    expect: ["actor"],
  });
}

/** Client-side mirror of the server rules, for early field hints only. The server decides. */
export const ACCOUNT_LIMITS = {
  loginPattern: /^[a-z0-9._-]{3,40}$/,
  passwordMin: 12,
  passwordMax: 128,
  ageMin: 18,
  ageMax: 120,
  displayNameMax: 80,
  regionMax: 80,
} as const;

export function normalizeLogin(value: string): string {
  return value.trim().toLowerCase();
}
