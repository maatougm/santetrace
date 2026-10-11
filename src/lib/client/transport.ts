/**
 * Single same-origin transport for every HackCure client module.
 *
 * Every helper throws ApiError on failure. Nothing here invents data: when the
 * backend is missing (404 HTML / 501) or unreachable, callers get a typed error
 * they must surface honestly.
 */
import type { Language } from "@/contracts/hackcure";

export type { Language };

/** Ordinary reads and mutations. */
export const DEFAULT_TIMEOUT_MS = 15_000;
/** PDF upload and extraction. */
export const UPLOAD_TIMEOUT_MS = 60_000;
/** Explicit model operations (onboarding, proposals, report, assistant, search). Server budget is 30 s. */
export const AI_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ApiErrorKind = "http" | "network" | "timeout" | "aborted" | "invalid_response";

/** Codes produced by this client (server codes pass through unchanged). */
export const CLIENT_ERROR_CODES = {
  network: "NETWORK_UNAVAILABLE",
  timeout: "REQUEST_TIMEOUT",
  aborted: "REQUEST_ABORTED",
  invalidResponse: "INVALID_RESPONSE",
  endpointUnavailable: "ENDPOINT_UNAVAILABLE",
  notImplemented: "NOT_IMPLEMENTED",
  http: "HTTP_ERROR",
} as const;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly kind: ApiErrorKind;
  /** Server-provided message (already user-facing French in this backend). */
  readonly serverMessage: string | null;

  constructor(params: {
    status: number;
    code: string;
    kind: ApiErrorKind;
    message: string;
    serverMessage?: string | null;
  }) {
    super(params.message);
    this.name = "ApiError";
    this.status = params.status;
    this.code = params.code;
    this.kind = params.kind;
    this.serverMessage = params.serverMessage ?? null;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** Network failure or timeout: the device may be offline. */
  get isOffline(): boolean {
    return this.kind === "network" || this.kind === "timeout";
  }

  /** Route missing or explicitly not implemented yet by the backend. */
  get isUnavailable(): boolean {
    return (
      this.code === CLIENT_ERROR_CODES.endpointUnavailable ||
      this.code === CLIENT_ERROR_CODES.notImplemented ||
      this.status === 501
    );
  }

  get isAborted(): boolean {
    return this.kind === "aborted";
  }

  /** 409: the server state moved on (stale revision/guard, replay mismatch). */
  get isConflict(): boolean {
    return this.status === 409;
  }

  /**
   * The server refused this actor for this resource: session gone (401),
   * access withdrawn (403) or record hidden (404 with an error envelope).
   * A bare 404 without envelope is a missing route, not a denial.
   */
  get isAccessDenied(): boolean {
    if (this.kind !== "http") return false;
    if (this.status === 401 || this.status === 403) return true;
    return this.status === 404 && this.code !== CLIENT_ERROR_CODES.endpointUnavailable;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Normalises anything thrown into an ApiError. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError({
    status: 0,
    code: CLIENT_ERROR_CODES.invalidResponse,
    kind: "invalid_response",
    message: error instanceof Error ? error.message : "Erreur inattendue.",
  });
}

/** Thrown locally when a response arrived after the access fence moved on. */
export function staleResponseError(message = "Response superseded"): ApiError {
  return new ApiError({ status: 0, code: CLIENT_ERROR_CODES.aborted, kind: "aborted", message });
}

export interface ErrorDescription {
  title: string;
  message: string;
  code: string;
}

type ErrorCopyKey =
  | "offline"
  | "timeout"
  | "unauthenticated"
  | "forbidden"
  | "notFound"
  | "unavailable"
  | "invalid"
  | "conflict"
  | "tooLarge"
  | "busy"
  | "server"
  | "generic";

const ERROR_COPY: Record<Language, Record<ErrorCopyKey, { title: string; message: string }>> = {
  fr: {
    offline: { title: "Serveur injoignable", message: "Connexion indisponible. Rien n’a été envoyé ; réessayez une fois en ligne." },
    timeout: { title: "Délai dépassé", message: "Le serveur n’a pas répondu à temps. Rien n’est confirmé tant qu’il ne répond pas." },
    unauthenticated: { title: "Session expirée", message: "Reconnectez-vous pour continuer." },
    forbidden: { title: "Accès refusé", message: "Ce dossier n’est pas accessible avec cette session." },
    notFound: { title: "Introuvable ou inaccessible", message: "Cet élément n’existe pas ou n’est pas accessible avec cette session." },
    unavailable: { title: "Fonction pas encore disponible", message: "Ce point d’API n’est pas encore en service côté serveur." },
    invalid: { title: "Réponse inattendue", message: "Le serveur a renvoyé une réponse non conforme au contrat. Rien n’est affiché à sa place." },
    conflict: { title: "Conflit", message: "Cette action entre en conflit avec l’état actuel du dossier." },
    tooLarge: { title: "Fichier trop volumineux", message: "Le fichier dépasse la limite autorisée (PDF ≤ 5 Mio, ≤ 20 pages)." },
    busy: { title: "Service occupé", message: "Le service est occupé ou indisponible. Rien n’a été enregistré ; réessayez dans un instant." },
    server: { title: "Erreur serveur", message: "Le serveur a rencontré une erreur. Réessayez." },
    generic: { title: "Action impossible", message: "La demande n’a pas abouti." },
  },
  ar: {
    offline: { title: "تعذّر الوصول إلى الخادم", message: "لا يوجد اتصال. لم يُرسل أي شيء؛ أعد المحاولة عند عودة الاتصال." },
    timeout: { title: "انتهت المهلة", message: "لم يستجب الخادم في الوقت المحدد. لا شيء مؤكَّد قبل رده." },
    unauthenticated: { title: "انتهت الجلسة", message: "يرجى تسجيل الدخول من جديد للمتابعة." },
    forbidden: { title: "الوصول مرفوض", message: "هذا الملف غير متاح لهذه الجلسة." },
    notFound: { title: "غير موجود أو غير متاح", message: "هذا العنصر غير موجود أو غير متاح لهذه الجلسة." },
    unavailable: { title: "الخدمة غير متوفرة بعد", message: "هذه الخدمة لم تُفعَّل بعد على الخادم." },
    invalid: { title: "رد غير متوقع", message: "أرسل الخادم ردًا غير مطابق. لم يُعرض أي بديل." },
    conflict: { title: "تعارض", message: "هذا الإجراء يتعارض مع الحالة الحالية للملف." },
    tooLarge: { title: "الملف كبير جدًا", message: "يتجاوز الملف الحد المسموح (PDF ≤ 5 ميغابايت، ≤ 20 صفحة)." },
    busy: { title: "الخدمة مشغولة", message: "الخدمة مشغولة أو غير متاحة. لم يُسجَّل أي شيء؛ أعد المحاولة بعد قليل." },
    server: { title: "خطأ في الخادم", message: "حدث خطأ في الخادم. أعد المحاولة." },
    generic: { title: "تعذّر الإجراء", message: "لم يكتمل الطلب." },
  },
};

/**
 * User-facing description of an error. Server messages are preferred for
 * validation errors (the backend already words them for users) in French.
 */
export function describeApiError(error: unknown, lang: Language = "fr"): ErrorDescription {
  const apiError = toApiError(error);
  const copy = ERROR_COPY[lang];
  const pick = (key: ErrorCopyKey, useServer = false): ErrorDescription => ({
    title: copy[key].title,
    message: useServer && lang === "fr" && apiError.serverMessage ? apiError.serverMessage : copy[key].message,
    code: apiError.code,
  });

  if (apiError.kind === "network") return pick("offline");
  if (apiError.kind === "timeout") return pick("timeout");
  if (apiError.kind === "invalid_response") return pick("invalid");
  if (apiError.isUnavailable) return pick("unavailable");
  if (apiError.status === 401) return pick("unauthenticated", true);
  if (apiError.status === 403) return pick("forbidden", true);
  if (apiError.status === 404) return pick("notFound", true);
  if (apiError.status === 409) return pick("conflict", true);
  if (apiError.status === 413) return pick("tooLarge", true);
  if (apiError.status === 503) return pick("busy", true);
  if (apiError.status >= 500) return pick("server");
  return pick("generic", true);
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export const API_BASE = "/api";

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface InternalRequest extends RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  json?: unknown;
  formData?: FormData;
  /** Top-level keys that must exist on a successful JSON response. */
  expect?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readErrorEnvelope(payload: unknown): { code: string; message: string } | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  const { code, message } = payload.error;
  return {
    code: typeof code === "string" && code ? code : CLIENT_ERROR_CODES.http,
    message: typeof message === "string" ? message : "",
  };
}

function combineSignals(timeoutMs: number, external?: AbortSignal): { signal: AbortSignal; didTimeout: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

function timeoutError(): ApiError {
  return new ApiError({ status: 0, code: CLIENT_ERROR_CODES.timeout, kind: "timeout", message: "Request timed out" });
}

function abortedError(): ApiError {
  return new ApiError({ status: 0, code: CLIENT_ERROR_CODES.aborted, kind: "aborted", message: "Request aborted" });
}

function httpError(status: number, payload: unknown, method: string, path: string): ApiError {
  const envelope = readErrorEnvelope(payload);
  if (envelope) {
    return new ApiError({
      status,
      code: envelope.code,
      kind: "http",
      message: envelope.message || `HTTP ${status}`,
      serverMessage: envelope.message || null,
    });
  }
  // No JSON envelope: the route itself is missing or unimplemented.
  const code =
    status === 404 ? CLIENT_ERROR_CODES.endpointUnavailable : status === 501 ? CLIENT_ERROR_CODES.notImplemented : CLIENT_ERROR_CODES.http;
  return new ApiError({ status, code, kind: "http", message: `HTTP ${status} on ${method} ${path}` });
}

export async function request<T>(path: string, options: InternalRequest = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json" };
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  if (method !== "GET") headers["x-hackcure-client"] = "web";

  const timeoutMs = options.timeoutMs ?? (options.formData ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const { signal, didTimeout, dispose } = combineSignals(timeoutMs, options.signal);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body,
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal,
    });
  } catch (error) {
    dispose();
    if (didTimeout()) throw timeoutError();
    if (options.signal?.aborted) throw abortedError();
    throw new ApiError({
      status: 0,
      code: CLIENT_ERROR_CODES.network,
      kind: "network",
      message: error instanceof Error ? error.message : "Network error",
    });
  }

  try {
    const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
    let payload: unknown = null;
    if (isJson) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }
    // An abort or timeout during the body read is not a malformed response.
    if (didTimeout()) throw timeoutError();
    if (options.signal?.aborted) throw abortedError();

    if (!response.ok) throw httpError(response.status, payload, method, path);

    if (!isJson || !isRecord(payload)) {
      throw new ApiError({
        status: response.status,
        code: CLIENT_ERROR_CODES.invalidResponse,
        kind: "invalid_response",
        message: `Non-JSON response on ${method} ${path}`,
      });
    }
    const missing = (options.expect ?? []).filter((key) => !(key in payload));
    if (missing.length > 0) {
      throw new ApiError({
        status: response.status,
        code: CLIENT_ERROR_CODES.invalidResponse,
        kind: "invalid_response",
        message: `Response for ${method} ${path} is missing: ${missing.join(", ")}`,
      });
    }
    return payload as T;
  } finally {
    dispose();
  }
}

/** Encodes one path segment. */
export const seg = (value: string): string => encodeURIComponent(value);

/** Appends defined query parameters to a path. */
export function withQuery(path: string, query: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

/** AI calls get the 45 s deadline unless the caller passes a shorter one. */
export function aiOptions(options?: RequestOptions): RequestOptions {
  return { ...options, timeoutMs: options?.timeoutMs ?? AI_TIMEOUT_MS };
}
