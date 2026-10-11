import type { Actor } from "../contracts/care";
import type { CareStoreAdapter } from "./care-store";
import { CareError } from "./care-service";
import { cookieHeader, signSession } from "./care-session";
import { LoginRateLimitError, PublicCredentialThrottle, readBoundedJson, requireSameOrigin } from "./care-http";

type DemoRole = "patient" | "clinician";
const DEMO_PATIENT_LOGIN = "qa.patient.day.0240";
const DEMO_PATIENT_ID = "6ba1ee80-c835-403e-af9f-7908b67b7ea2";
const DEMO_CLINICIAN_LOGIN = "medecin.ref";
const DEMO_CLINICIAN_ID = "demo-clinician";
const shared = globalThis as typeof globalThis & { demoQuickLoginThrottle?: PublicCredentialThrottle };
const json = (data: unknown, status = 200, extra: HeadersInit = {}) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store", "Pragma": "no-cache", ...extra },
});

/** Only the explicitly selected, existing fictional rehearsal accounts qualify. */
function demoActor(store: CareStoreAdapter, role: DemoRole): Actor | null {
  const state = store.read();
  // A mixed or real-patient database must never expose password-free clinician access.
  if (!state.patients.length || state.patients.some(patient => patient.fictional !== true)
      || state.doctorProfiles.some(profile => profile.fictional !== true)) return null;
  const principal = state.accounts.find(account => account.enabled && account.role === role
    && account.login === (role === "patient" ? DEMO_PATIENT_LOGIN : DEMO_CLINICIAN_LOGIN));
  if (!principal || principal.configurationDisabled === true) return null;
  if (role === "patient") {
    if (principal.patientId !== DEMO_PATIENT_ID || !state.patients.some(patient =>
      patient.id === DEMO_PATIENT_ID && patient.fictional === true && patient.consent === true)) return null;
  } else if (principal.id !== DEMO_CLINICIAN_ID || principal.patientId !== null
      || !state.doctorProfiles.some(profile => profile.id === principal.id && profile.fictional === true)) return null;
  return { id: principal.id, role: principal.role, displayName: principal.displayName, patientId: principal.patientId };
}

export function createDemoLoginHandler(store: CareStoreAdapter, options: {
  enabled?: () => boolean;
  throttle?: PublicCredentialThrottle;
  clock?: () => number;
} = {}) {
  const enabled = options.enabled ?? (() => process.env.HACKCURE_DEMO_QUICK_LOGIN_ENABLED === "true");
  const throttle = options.throttle ?? (shared.demoQuickLoginThrottle ??= new PublicCredentialThrottle(Date.now, 60));
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method === "GET") {
        const roles = enabled() ? (["patient", "clinician"] as const).filter(role => demoActor(store, role)) : [];
        return json({ enabled: roles.length > 0, roles });
      }
      if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET, POST" });
      if (!enabled()) throw new CareError(404, "DEMO_LOGIN_UNAVAILABLE", "Accès de démonstration indisponible.");
      if (!request.headers.get("origin")) throw new CareError(403, "INVALID_ORIGIN", "Origine refusée.");
      requireSameOrigin(request);
      const body = await readBoundedJson(request);
      if (Object.keys(body).length !== 1 || !Object.hasOwn(body, "role")
          || (body.role !== "patient" && body.role !== "clinician"))
        throw new CareError(400, "INVALID_ROLE", "Rôle de démonstration invalide.");
      const actor = throttle.run("demo-quick-login:" + body.role, () => {
        const current = demoActor(store, body.role as DemoRole);
        if (!current) throw new CareError(404, "DEMO_LOGIN_UNAVAILABLE", "Accès de démonstration indisponible.");
        return current;
      });
      return json({ actor, mode: "fictional_demo" }, 200, {
        "Set-Cookie": cookieHeader(signSession(actor, options.clock?.() ?? Date.now(), store)),
      });
    } catch (error) {
      if (error instanceof CareError) return json({ error: error.code, message: error.message }, error.status,
        error instanceof LoginRateLimitError ? { "Retry-After": String(error.retryAfter) } : {});
      return json({ error: "DEMO_LOGIN_UNAVAILABLE", message: "Accès de démonstration indisponible." }, 503);
    }
  };
}
