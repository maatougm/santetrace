/**
 * Demo-only quick sign-in (fictional accounts, disabled by default on the
 * server). The client never holds a credential: it only learns which roles
 * the server enables and asks for one by name. Anything unexpected hides the
 * buttons instead of guessing.
 */
import type { Actor } from "@/contracts/care";

export type DemoRole = Actor["role"];

/** Display order of the quick buttons. */
export const DEMO_ROLES: readonly DemoRole[] = ["patient", "clinician"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Roles to offer, from GET /api/care/demo-login. `enabled: false`, a missing
 * or malformed `roles` list, or a non-boolean `enabled` all yield none.
 */
export function enabledDemoRoles(payload: unknown): DemoRole[] {
  if (!isRecord(payload) || !Array.isArray(payload.roles)) return [];
  if (payload.enabled !== undefined && payload.enabled !== true) return [];
  const listed = new Set(payload.roles.filter((role): role is string => typeof role === "string"));
  return DEMO_ROLES.filter((role) => listed.has(role));
}

/** Space opened after a demo sign-in (same mapping as the regular sign-in). */
export function demoHomePath(role: DemoRole): string {
  return role === "clinician" ? "/doctor" : "/patient";
}

/** The server's actor, only when it is a well-formed actor of the requested role. */
export function acceptDemoActor(role: DemoRole, payload: unknown): Actor | null {
  if (!isRecord(payload) || !isRecord(payload.actor)) return null;
  const { id, role: actorRole, displayName, patientId } = payload.actor;
  if (typeof id !== "string" || typeof displayName !== "string" || actorRole !== role) return null;
  if (patientId !== null && typeof patientId !== "string") return null;
  return { id, role, displayName, patientId };
}
