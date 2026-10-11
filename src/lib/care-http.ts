import { createHash } from "node:crypto";
import { CareError } from "./care-service";
export const MAX_JSON_BYTES = 65536;
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let actual: URL;
  let expected: URL;
  try {
    actual = new URL(origin);
    expected = new URL(process.env.APP_ORIGIN || request.url);
  } catch {
    throw new CareError(403, "INVALID_ORIGIN", "Origine refusée.");
  }
  if (origin !== actual.origin) throw new CareError(403, "INVALID_ORIGIN", "Origine refusée.");
  if (actual.origin === expected.origin) return;
  // Next may normalize the dev request URL to localhost even for a 127.0.0.1 browser tab.
  // Only local development aliases qualify; supplied Host/forwarded headers never set authority.
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (!process.env.APP_ORIGIN && process.env.NODE_ENV !== "production"
      && loopback.has(actual.hostname) && loopback.has(expected.hostname)
      && actual.protocol === expected.protocol && actual.port === expected.port) return;
  throw new CareError(403, "INVALID_ORIGIN", "Origine refusée.");
}
export async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > maxBytes) {
    await request.body?.cancel();
    throw new CareError(413, "TOO_LARGE", "Requête trop volumineuse.");
  }
  if (!request.body) throw new CareError(400, "INVALID_JSON", "Objet JSON requis.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new CareError(413, "TOO_LARGE", "Requête trop volumineuse.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
export async function readBoundedJson(request: Request): Promise<Record<string, unknown>> {
  const bytes = await readBoundedBody(request, MAX_JSON_BYTES);
  let body: unknown;
  try { body = JSON.parse(Buffer.from(bytes).toString("utf8")); }
  catch { throw new CareError(400, "INVALID_JSON", "JSON invalide."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CareError(400, "INVALID_JSON", "Objet JSON requis.");
  return body as Record<string, unknown>;
}
const CLINICIAN_LOGIN_SCOPE = createHash("sha256").update("clinician:demo-clinician").digest("hex");
export function loginScope(body: Record<string, unknown>): string {
  // The clinician bucket belongs to the single configured demo account, never its supplied password.
  const identity = typeof body.login === "string" ? `account:${body.login.length<=40?body.login.toLowerCase():"invalid"}` : body.role === "clinician" ? "clinician:demo-clinician"
    : body.role === "patient" ? `patient:${typeof body.code === "string" ? body.code : ""}` : "invalid-role";
  return createHash("sha256").update(identity).digest("hex");
}
type LoginBucket = { failed: number; windowStarted: number };
export class LoginThrottle {
  private readonly buckets = new Map<string, LoginBucket>();
  private clinicianBucket: LoginBucket | null = null;
  private asyncWindow: {started:number;attempts:number} | null = null;
  private readonly asyncBuckets = new Map<string, LoginBucket>();
  constructor(private readonly clock = Date.now, private readonly limit = 5, private readonly windowMs = 60000, private readonly maxBuckets = 256) {
    if (maxBuckets < 2) throw new Error("Two login bucket slots are required");
  }
  get bucketCount() { return this.buckets.size + this.asyncBuckets.size + (this.clinicianBucket ? 1 : 0); }
  async runAsync<T>(scope: string, action: () => Promise<T>): Promise<T> {
    const now=this.clock();
    for(const [key,bucket] of this.asyncBuckets)if(now-bucket.windowStarted>=this.windowMs)this.asyncBuckets.delete(key);
    if(!this.asyncWindow||now-this.asyncWindow.started>=this.windowMs)this.asyncWindow={started:now,attempts:0};
    if(this.asyncWindow.attempts>=this.maxBuckets)throw new LoginRateLimitError(Math.max(1,Math.ceil((this.asyncWindow.started+this.windowMs-now)/1000)));
    let bucket=this.asyncBuckets.get(scope);
    if(!bucket){bucket={failed:0,windowStarted:now};this.asyncBuckets.set(scope,bucket);}
    if(bucket.failed>=this.limit)throw new LoginRateLimitError(Math.max(1,Math.ceil((bucket.windowStarted+this.windowMs-now)/1000)));
    // Reserve before invoking a Promise callback so overlapping requests cannot bypass limits.
    bucket.failed++;this.asyncWindow.attempts++;
    const result=await action();
    bucket.failed--;return result;
  }
  run<T>(scope: string, login: () => T): T {
    const now = this.clock();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStarted >= this.windowMs) this.buckets.delete(key);
    }
    if (this.clinicianBucket && now - this.clinicianBucket.windowStarted >= this.windowMs) this.clinicianBucket = null;
    const clinician = scope === CLINICIAN_LOGIN_SCOPE;
    let bucket = clinician ? this.clinicianBucket : this.buckets.get(scope);
    if (!bucket) {
      // Retain recently used scopes while bounding arbitrary invalid-invitation cardinality.
      if (!clinician && this.buckets.size >= this.maxBuckets - 1) this.buckets.delete(this.buckets.keys().next().value!);
      bucket = { failed: 0, windowStarted: now };
    }
    // Reserve one slot for the fixed clinician account; patient-key churn cannot evict it.
    if (clinician) this.clinicianBucket = bucket;
    else { this.buckets.delete(scope); this.buckets.set(scope, bucket); }
    if (bucket.failed >= this.limit) {
      throw new LoginRateLimitError(Math.max(1, Math.ceil((bucket.windowStarted + this.windowMs - now) / 1000)));
    }
    try { return login(); }
    catch (error) { bucket.failed++; throw error; }
  }
}
export class LoginRateLimitError extends CareError {
  constructor(public readonly retryAfter: number) { super(429, "RATE_LIMITED", "Trop de tentatives. Réessayez plus tard."); }
}
// Scope keys contain only hashes; forwarded-IP headers are deliberately ignored.
const shared = globalThis as typeof globalThis & { careLoginThrottle?: LoginThrottle };
export function getLoginThrottle() { return shared.careLoginThrottle ??= new LoginThrottle(); }

/** Public credentials have independent, bounded attempt budgets, including successful requests. */
export class PublicCredentialThrottle {
  private buckets = new Map<string, number>();
  private window: { started: number; attempts: number } | null = null;
  constructor(private readonly clock = Date.now, private readonly perCredential = 5, private readonly globalLimit = 256, private readonly windowMs = 60000) {}
  get bucketCount() { return this.buckets.size; }
  run<T>(credential: string, action: () => T): T {
    const now = this.clock();
    if (!this.window || now - this.window.started >= this.windowMs) {
      this.window = { started: now, attempts: 0 };
      this.buckets.clear();
    }
    const key = createHash("sha256").update(credential).digest("hex");
    const attempts = this.buckets.get(key) ?? 0;
    if (this.window.attempts >= this.globalLimit || attempts >= this.perCredential)
      throw new LoginRateLimitError(Math.max(1, Math.ceil((this.window.started + this.windowMs - now) / 1000)));
    // Reserve synchronously before any SQLite work; distinct credentials cannot reset the ceiling.
    this.window.attempts++;
    this.buckets.set(key, attempts + 1);
    return action();
  }
}
export type PublicCredentialThrottles = { redeem: PublicCredentialThrottle; connector: PublicCredentialThrottle };
const publicShared = globalThis as typeof globalThis & { carePublicCredentialThrottles?: PublicCredentialThrottles };
export function getPublicCredentialThrottles(): PublicCredentialThrottles {
  return publicShared.carePublicCredentialThrottles ??= {
    redeem: new PublicCredentialThrottle(),
    connector: new PublicCredentialThrottle(Date.now, 60),
  };
}
