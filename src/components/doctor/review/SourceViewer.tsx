"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { Button, buttonClassName, ErrorState, Icon, Notice, Skeleton, Spinner } from "@/components/ui";
import { ApiError, CLIENT_ERROR_CODES, DOCUMENT_LIMITS, describeApiError, documentSourceUrl } from "@/lib/client/api";
import { VISIT_UNAVAILABLE } from "@/lib/client/share-api";
import styles from "./Review.module.css";

/*
 * The original PDF is drawn on a canvas with PDF.js instead of the browser's
 * built-in viewer, which showed a blank frame in embedded Chromium for the
 * sandboxed source response (Content-Security-Policy: sandbox). The app fetches the
 * authorized bytes itself (same-origin cookies, no-store), keeps them only in
 * memory, and hands them to the PDF.js worker. PDF.js never gets the document
 * URL; it only loads its own public, versioned static assets from this origin
 * (worker, standard fonts, image/colour decoders: see public/pdfjs/PROVENANCE.md).
 * No annotation layer, no XFA, no scripting manager, no pdf.sandbox bundle and
 * no QuickJS wasm are loaded. The legacy build is used because the modern one
 * needs unpolyfilled ES2025+ builtins.
 */

type PdfJs = typeof import("pdfjs-dist");

/** Must equal node_modules/pdfjs-dist and the public/pdfjs/<version>/ copy. */
const PDFJS_VERSION = "6.4.299";

/** Device-pixel oversampling cap (sharp on 2x screens, bounded memory). */
const MAX_OUTPUT_SCALE = 2;
/** Canvas backing store cap: 8 MP, about 2048 × 4096 px. */
const MAX_CANVAS_PIXELS = 8_388_608;
/** Largest embedded image PDF.js will decode (A4 scanned at 600 dpi fits). */
const MAX_IMAGE_PIXELS = 36_000_000;
const MAX_MIB = DOCUMENT_LIMITS.maxBytes / (1024 * 1024);

interface ViewerFailure {
  title: string;
  message: string;
  code: string;
}

type DocState = { kind: "loading" } | { kind: "ready"; pdf: PDFDocumentProxy } | { kind: "error"; failure: ViewerFailure };
type PageState = { kind: "rendering" } | { kind: "rendered" } | { kind: "error"; failure: ViewerFailure };

class SourceViewerError extends Error {
  readonly failure: ViewerFailure;

  constructor(failure: ViewerFailure) {
    super(failure.code);
    this.name = "SourceViewerError";
    this.failure = failure;
  }
}

const FAILURES = {
  tooLarge: {
    title: "Source PDF trop volumineuse",
    message: `Le fichier dépasse ${MAX_MIB} Mio et n’est pas affiché ici. Téléchargez l’original pour le consulter.`,
    code: "SOURCE_TOO_LARGE",
  },
  viewerUnavailable: {
    title: "Lecteur PDF indisponible",
    message: "Le lecteur intégré n’a pas pu démarrer dans ce navigateur. Téléchargez l’original pour le consulter.",
    code: "PDF_VIEWER_UNAVAILABLE",
  },
  invalid: {
    title: "PDF illisible",
    message: "Le fichier reçu n’est pas un PDF valide ou il est endommagé. Aucune page n’est affichée à sa place.",
    code: "PDF_INVALID",
  },
  password: {
    title: "PDF protégé par mot de passe",
    message: "Ce PDF ne peut pas être affiché ici. Téléchargez l’original pour le consulter.",
    code: "PDF_PASSWORD",
  },
  open: {
    title: "Ouverture du PDF impossible",
    message: "Le lecteur intégré n’a pas pu ouvrir ce PDF. Téléchargez l’original pour le consulter.",
    code: "PDF_OPEN_FAILED",
  },
  render: {
    title: "Affichage du PDF impossible",
    message: "Cette page n’a pas pu être rendue fidèlement. Téléchargez l’original pour la vérifier.",
    code: "PDF_RENDER_FAILED",
  },
} as const satisfies Record<string, ViewerFailure>;

/** Absolute same-origin URL of a static PDF.js asset copied to public/pdfjs/<version>/. */
function pdfjsAssetUrl(path: string): string {
  return new URL(`/pdfjs/${PDFJS_VERSION}/${path}`, window.location.origin).href;
}

let pdfjsPromise: Promise<PdfJs> | null = null;

/** Loads PDF.js once, in the browser only, with the local static worker (no CDN, no bundler worker URL). */
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs")
    .then((pdfjs) => {
      // A worker from another version would fail obscurely; refuse before any network use.
      if (pdfjs.version !== PDFJS_VERSION) throw new Error(`pdfjs-dist ${pdfjs.version} ≠ assets ${PDFJS_VERSION}`);
      pdfjs.GlobalWorkerOptions.workerSrc = pdfjsAssetUrl("pdf.worker.min.mjs");
      return pdfjs;
    })
    .catch(() => {
      pdfjsPromise = null;
      throw new SourceViewerError(FAILURES.viewerUnavailable);
    });
  return pdfjsPromise;
}

async function readEnvelope(response: Response): Promise<{ code: string; message: string } | null> {
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) return null;
  try {
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || !("error" in payload)) return null;
    const error = (payload as { error: unknown }).error;
    if (typeof error !== "object" || error === null) return null;
    const { code, message } = error as { code?: unknown; message?: unknown };
    return { code: typeof code === "string" ? code : CLIENT_ERROR_CODES.http, message: typeof message === "string" ? message : "" };
  } catch {
    return null;
  }
}

async function sourceHttpError(response: Response): Promise<ApiError> {
  const envelope = await readEnvelope(response);
  const code = envelope?.code ?? (response.status === 404 ? CLIENT_ERROR_CODES.endpointUnavailable : CLIENT_ERROR_CODES.invalidResponse);
  return new ApiError({
    status: response.ok ? 0 : response.status,
    code,
    kind: response.ok ? "invalid_response" : "http",
    message: envelope?.message || `Source HTTP ${response.status}`,
    serverMessage: envelope?.message || null,
  });
}

/** Reads the body into memory, stopping as soon as it exceeds the upload limit. */
async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) throw new SourceViewerError(FAILURES.invalid);
  if (Number(response.headers.get("content-length")) > maxBytes) {
    void response.body.cancel();
    throw new SourceViewerError(FAILURES.tooLarge);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      void reader.cancel();
      throw new SourceViewerError(FAILURES.tooLarge);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Authorized source bytes: same-origin session cookie, never stored by the HTTP cache. */
async function fetchSourceBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/pdf" },
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError({ status: 0, code: CLIENT_ERROR_CODES.network, kind: "network", message: "Source unreachable" });
  }
  const isPdf = (response.headers.get("content-type") ?? "").includes("application/pdf");
  if (!response.ok || !isPdf) throw await sourceHttpError(response);
  return readBoundedBytes(response, DOCUMENT_LIMITS.maxBytes);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

/** Maps fetch and PDF.js errors (matched by exception name) to an honest, user-facing failure. */
function toFailure(error: unknown, fallback: ViewerFailure): ViewerFailure {
  if (error instanceof SourceViewerError) return error.failure;
  if (error instanceof ApiError) {
    const description = describeApiError(error, "fr");
    return { title: "Source PDF indisponible", message: description.message, code: description.code };
  }
  if (errorName(error) === "InvalidPDFException") return FAILURES.invalid;
  if (errorName(error) === "PasswordException") return FAILURES.password;
  // PDF.js retries a failed worker on the main thread; this message means both failed to load.
  if (error instanceof Error && error.message.includes("Setting up fake worker failed")) return FAILURES.viewerUnavailable;
  return fallback;
}

/** CSS size fits the frame width; the backing store is oversampled for sharpness, within the pixel cap. */
function fitPage(pageWidth: number, pageHeight: number, frameWidth: number, devicePixelRatio: number) {
  const cssScale = frameWidth / pageWidth;
  const cssWidth = frameWidth;
  const cssHeight = pageHeight * cssScale;
  const wanted = Math.min(Math.max(devicePixelRatio || 1, 1), MAX_OUTPUT_SCALE);
  const capped = Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight));
  return { cssWidth, cssHeight, renderScale: cssScale * Math.min(wanted, capped) };
}

/** Source refusals that end the reader's access (guest routes answer every one with 404 VISIT_UNAVAILABLE). */
const DENIAL_STATUSES: ReadonlySet<number> = new Set([401, 403, 404, 410]);

function isSourceDenial(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "http" && (error.code === VISIT_UNAVAILABLE || DENIAL_STATUSES.has(error.status));
}

/** Opens the authorized PDF in PDF.js; destroys the worker-side document on change, retry or unmount. */
function usePdfDocument(sourceUrl: string, attempt: number, onAccessDenied?: () => void): DocState {
  const [state, setState] = useState<DocState>({ kind: "loading" });
  // Latest callback without refetching the PDF when the caller re-renders; reported once per viewer.
  const deniedRef = useRef(onAccessDenied);
  const reportedRef = useRef(false);
  useEffect(() => {
    deniedRef.current = onAccessDenied;
  }, [onAccessDenied]);

  useEffect(() => {
    const controller = new AbortController();
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setState({ kind: "loading" });

    void (async () => {
      try {
        const bytes = await fetchSourceBytes(sourceUrl, controller.signal);
        const pdfjs = await loadPdfJs();
        if (controller.signal.aborted) return;
        // The bytes are transferred to the worker: nothing stays on the main thread or on disk.
        loadingTask = pdfjs.getDocument({
          data: bytes,
          // Public static assets only (same origin, versioned path); never the private document.
          standardFontDataUrl: pdfjsAssetUrl("standard_fonts/"),
          wasmUrl: pdfjsAssetUrl("wasm/"),
          iccUrl: pdfjsAssetUrl("iccs/"),
          useWorkerFetch: true,
          stopAtErrors: true,
          maxImageSize: MAX_IMAGE_PIXELS,
          enableXfa: false,
          verbosity: pdfjs.VerbosityLevel.ERRORS,
        });
        const pdf = await loadingTask.promise;
        if (!controller.signal.aborted) setState({ kind: "ready", pdf });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ kind: "error", failure: toFailure(error, FAILURES.open) });
        if (isSourceDenial(error) && deniedRef.current && !reportedRef.current) {
          reportedRef.current = true;
          deniedRef.current();
        }
      }
    })();

    return () => {
      controller.abort();
      void loadingTask?.destroy();
    };
  }, [sourceUrl, attempt]);

  return state;
}

interface PagerProps {
  page: number;
  count: number;
  onChange: (page: number) => void;
}

function Pager({ page, count, onChange }: PagerProps) {
  return (
    <div className={styles.pager} role="group" aria-label="Pages du PDF">
      <Button
        size="sm"
        variant="ghost"
        iconStart="chevron-left"
        aria-label="Page précédente"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      />
      <span className={styles.pagerStatus} aria-live="polite">
        Page {page} / {count}
      </span>
      <Button
        size="sm"
        variant="ghost"
        iconStart="chevron-right"
        aria-label="Page suivante"
        disabled={page >= count}
        onClick={() => onChange(page + 1)}
      />
    </div>
  );
}

interface SourceViewerProps {
  documentId: string;
  filename: string;
  /** Page of the selected candidate; null shows the first page. */
  page: number | null;
  /**
   * Trusted same-origin URL builder for the original PDF. Defaults to the
   * account-session route; guest views pass `guestDocumentSourceUrl`.
   */
  sourceUrl?: (documentId: string) => string;
  /**
   * Called once, on the first refusal of the PDF source (VISIT_UNAVAILABLE,
   * 401, 403, 404, 410), so the caller can end its session or request fresh
   * scope instead of keeping stale authority. Absent: viewer message only.
   */
  onAccessDenied?: () => void;
}

export function SourceViewer({ documentId, filename, page, sourceUrl = documentSourceUrl, onAccessDenied }: SourceViewerProps) {
  const [attempt, setAttempt] = useState(0);
  // A string dependency: an inline builder from the caller never refetches on re-render.
  const url = sourceUrl(documentId);
  const doc = usePdfDocument(url, attempt, onAccessDenied);
  const [pageState, setPageState] = useState<PageState>({ kind: "rendering" });
  const [currentPage, setCurrentPage] = useState(page ?? 1);
  const [syncedKey, setSyncedKey] = useState(`${documentId}:${page ?? ""}`);
  const [frameWidth, setFrameWidth] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A newly selected candidate (or document) moves the viewer to its page.
  const requestKey = `${documentId}:${page ?? ""}`;
  if (requestKey !== syncedKey) {
    setSyncedKey(requestKey);
    setCurrentPage(page ?? 1);
  }

  const pdf = doc.kind === "ready" ? doc.pdf : null;
  const pageCount = pdf?.numPages ?? 0;
  const shownPage = pageCount > 0 ? Math.min(Math.max(currentPage, 1), pageCount) : 1;
  const requestedMissing = page !== null && pageCount > 0 && !(Number.isInteger(page) && page >= 1 && page <= pageCount);

  const observeFrame = useCallback((node: HTMLDivElement | null) => {
    if (!node) return undefined;
    const observer = new ResizeObserver((entries) => setFrameWidth(Math.floor(entries[0]?.contentRect.width ?? 0)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [shownPage, pdf]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!pdf || !canvas || frameWidth <= 0) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    setPageState({ kind: "rendering" });

    void (async () => {
      try {
        const pdfPage = await pdf.getPage(shownPage);
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const fit = fitPage(base.width, base.height, frameWidth, window.devicePixelRatio);
        const viewport = pdfPage.getViewport({ scale: fit.renderScale });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(fit.cssWidth)}px`;
        canvas.style.height = `${Math.floor(fit.cssHeight)}px`;
        task = pdfPage.render({ canvas, viewport });
        await task.promise;
        if (!cancelled) setPageState({ kind: "rendered" });
      } catch (error) {
        // A retry destroys the document while a page may still be rendering: not a page failure.
        if (cancelled || pdf.loadingTask.destroyed || errorName(error) === "RenderingCancelledException") return;
        setPageState({ kind: "error", failure: toFailure(error, FAILURES.render) });
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, shownPage, frameWidth]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const goTo = useCallback((next: number) => setCurrentPage(next), []);
  const onSelectedPage = page !== null && shownPage === page;

  return (
    <section className={styles.viewer} aria-label="PDF original">
      <header className={styles.viewerBar}>
        <div className={styles.viewerTitle}>
          <span className={styles.viewerName} title={filename}>
            {filename}
          </span>
          <span className={styles.muted}>
            {pageCount > 0 ? `PDF original · page ${shownPage} sur ${pageCount}` : "PDF original"}
            {onSelectedPage ? " · page du résultat sélectionné" : ""}
          </span>
        </div>
        <div className={styles.viewerTools}>
          {pageCount > 1 ? <Pager page={shownPage} count={pageCount} onChange={goTo} /> : null}
          {page !== null && !onSelectedPage && !requestedMissing && pageCount > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => goTo(page)}>
              Page du résultat ({page})
            </Button>
          ) : null}
          <a href={url} download={filename} className={buttonClassName({ variant: "ghost", size: "sm" })}>
            <Icon name="download" size={16} />
            <span>Télécharger l’original</span>
          </a>
        </div>
      </header>
      {requestedMissing ? (
        <div className={styles.viewerNotice}>
          <Notice tone="neutral" icon="info">
            La page {page} indiquée pour ce résultat n’existe pas dans ce PDF ({pageCount} page{pageCount > 1 ? "s" : ""}).
            Vérifiez la valeur sur le document original.
          </Notice>
        </div>
      ) : null}
      <div className={styles.viewerBody}>
        <div ref={scrollRef} className={styles.viewerScroll} aria-busy={doc.kind === "loading" || pageState.kind === "rendering"}>
          {doc.kind === "loading" ? <Skeleton height="100%" radius={0} /> : null}
          {doc.kind === "error" ? (
            <div className={styles.viewerError}>
              <ErrorState {...doc.failure} onRetry={retry} retryLabel="Réessayer" />
            </div>
          ) : null}
          {doc.kind === "ready" ? (
            <div ref={observeFrame} className={styles.pageFrame}>
              <canvas
                ref={canvasRef}
                className={styles.pageCanvas}
                hidden={pageState.kind === "error"}
                role="img"
                aria-label={`Page ${shownPage} du PDF original ${filename}`}
              />
              {pageState.kind === "error" ? (
                <ErrorState {...pageState.failure} onRetry={retry} retryLabel="Réessayer" />
              ) : null}
            </div>
          ) : null}
        </div>
        {doc.kind === "ready" && pageState.kind === "rendering" ? (
          <div className={styles.pageStatus}>
            <Spinner size={16} label={`Affichage de la page ${shownPage}`} />
            <span aria-hidden="true">Affichage de la page…</span>
          </div>
        ) : null}
      </div>
      <p className={styles.viewerNote}>
        Image de la page originale, rendue depuis la source protégée (lisible uniquement avec votre session). Le PDF fait
        foi ; le texte cité à côté n’est qu’une extraction automatique.
      </p>
    </section>
  );
}
