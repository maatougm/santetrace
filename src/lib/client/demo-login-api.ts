/**
 * Demo-only quick sign-in (fictional accounts; the server keeps it disabled by
 * default). GET lists the enabled roles; POST {role} sets the existing secure
 * session cookie and returns the actor. No credential ever leaves the client.
 * After a successful POST the caller must run the regular admission
 * (`adoptSignedInActor`) before navigating, exactly like a password sign-in.
 */
import type { Actor } from "@/contracts/care";
import { acceptDemoActor, enabledDemoRoles, type DemoRole } from "@/components/auth/demo-login";
import { CLIENT_ERROR_CODES, DEFAULT_TIMEOUT_MS, ApiError, request, type RequestOptions } from "./transport";

const DEMO_LOGIN_PATH = "/care/demo-login";

/** Enabled roles; any failure (missing route, disabled, malformed) means none. */
export async function getDemoLoginRoles(options?: RequestOptions): Promise<DemoRole[]> {
  try {
    const payload = await request<unknown>(DEMO_LOGIN_PATH, { ...options, timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS });
    return enabledDemoRoles(payload);
  } catch {
    return [];
  }
}

/** Signs in as the demo actor of `role`. Rejects when the answer is not that role's actor. */
export async function postDemoLogin(role: DemoRole, options?: RequestOptions): Promise<Actor> {
  const payload = await request<unknown>(DEMO_LOGIN_PATH, {
    ...options,
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    method: "POST",
    json: { role },
    expect: ["actor"],
  });
  const actor = acceptDemoActor(role, payload);
  if (!actor) {
    throw new ApiError({
      status: 0,
      code: CLIENT_ERROR_CODES.invalidResponse,
      kind: "invalid_response",
      message: "Demo sign-in returned an unexpected actor",
    });
  }
  return actor;
}
