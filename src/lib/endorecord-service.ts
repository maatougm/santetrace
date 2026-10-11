import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { Actor, Candidate, Document, Observation } from "../contracts/care";
import { audit, authorizePatient, CareError, requireClinician } from "./care-service";
import { bumpPatientRevision, journalAccess, recordDeniedAccess, requirePatientCapability, requirePatientReadScope } from "./patient-access-service";
import { careId, type CareState, type CareStoreAdapter } from "./care-store";

export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export type PdfPage = { page: number; text: string };
export type PdfExtractor = (bytes: Uint8Array) => Promise<PdfPage[]>;
const fail = (code: string, message: string, status = 400): never => { throw new CareError(status, code, message); };

const parserState = globalThis as typeof globalThis & { endorecordActiveParsers?: number };
export function activePdfParsers() { return parserState.endorecordActiveParsers || 0; }
export async function runPdfWorker(bytes: Uint8Array, options: { timeoutMs?: number; workerPath?: string } = {}): Promise<PdfPage[]> {
  if (activePdfParsers() >= 2) fail("PARSER_BUSY", "Deux documents sont déjà en cours d’analyse. Réessayez.", 429);
  parserState.endorecordActiveParsers = activePdfParsers() + 1;
  let worker: Worker | undefined;
  try {
    // This is a Node worker shipped via outputFileTracingIncludes, not a browser worker.
    // Reflect.construct keeps Turbopack from interpreting the runtime filesystem path
    // as a browser-worker import and globbing the entire application into its graph.
    worker = Reflect.construct(Worker, [options.workerPath || resolve(process.cwd(), "src/lib/endorecord-pdf-worker.mjs"), { execArgv: [], workerData: { bytes: new Uint8Array(bytes) }, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } }]) as Worker;
    return await new Promise<PdfPage[]>((accept, reject) => {
      let finished = false;
      const finish = (error?: Error, pages?: PdfPage[]) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        // Termination is awaited before releasing the slot: timed-out parser work cannot continue.
        void worker!.terminate().then(() => error ? reject(error) : accept(pages!), reject);
      };
      const timer = setTimeout(() => finish(new CareError(422, "PDF_TIMEOUT", "Analyse PDF interrompue après le délai autorisé.")), options.timeoutMs ?? 10_000);
      worker!.once("message", message => message.error ? finish(new CareError(message.error.status, message.error.code, message.error.message)) : finish(undefined, message.pages));
      worker!.once("error", () => finish(new CareError(422, "PDF_RESOURCE_LIMIT", "Analyse PDF interrompue : document trop complexe.")));
      worker!.once("exit", () => { if (!finished) finish(new CareError(422, "INVALID_PDF", "Analyse PDF interrompue.")); });
    });
  } finally { parserState.endorecordActiveParsers = Math.max(0, activePdfParsers() - 1); }
}
export async function extractPdfPages(bytes: Uint8Array): Promise<PdfPage[]> { return runPdfWorker(bytes); }
function normalized(value: string) { return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("INVALID_DATE", "Date d’examen requise (AAAA-MM-JJ).");
  const date = new Date(value as string);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail("INVALID_DATE", "Date d’examen invalide.");
  if ((value as string) > new Date().toISOString().slice(0, 10)) fail("FUTURE_EXAM_DATE", "La date d’examen ne peut pas être dans le futur.");
  return value as string;
}
function extractedDate(text: string): string | null {
  const dates = [...text.matchAll(/\b(\d{2})[/.\-](\d{2})[/.\-](\d{4})\b/g)].map(m => `${m[3]}-${m[2]}-${m[1]}`);
  const isoDates = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(m => m[0]);
  const unique = [...new Set([...dates, ...isoDates])];
  if (unique.length !== 1) return null;
  try { return calendarDate(unique[0]); } catch { return null; }
}
export function proposeCandidates(pages: PdfPage[], patientName: string, documentId: string, patientId: string): Candidate[] {
  const fullText = pages.map(p => p.text).join("\n");
  const name = normalized(patientName);
  // Only an explicitly labeled patient identity is authoritative. A name in
  // reference prose, another result, or a partial name cannot establish identity.
  const labelledNames = [...fullText.matchAll(/(?:^|\n)\s*(?:patient(?:e)?|nom)\s*:\s*([^\n]+)/gi)].map(match => normalized(match[1]));
  const identityMatch: Candidate["identityMatch"] = !labelledNames.length ? "unknown"
    : labelledNames.every(labelled => labelled === name) ? "matched" : "mismatch";
  const examDate = extractedDate(fullText);
  const candidates: Candidate[] = [];
  for (const page of pages) {
    // Extract only the explicit HbA1c result and unit, never a numeric reference interval.
    const pattern = /(?:HbA1c|h[eé]moglobine\s+glyqu[eé]e)\s*[:=]?\s*(\d{1,3}(?:[.,]\d{1,3})?)\s*(%|mmol\s*\/\s*mol)/gi;
    for (const match of page.text.matchAll(pattern)) {
      const value = Number(match[1].replace(",", "."));
      const unit = match[2] === "%" ? "%" : "mmol/mol";
      const start = Math.max(0, match.index! - 80), end = Math.min(page.text.length, match.index! + match[0].length + 80);
      const complete = identityMatch === "matched" && examDate !== null;
      candidates.push({ id: careId(), documentId, patientId, exam: "HbA1c", value, unit, examDate, page: page.page, sourceText: page.text.slice(start, end).trim(), confidence: complete ? "high" : "low", confidenceReason: complete ? "Nom, valeur, unité et date explicites ; confirmation clinique toujours requise." : "Identité ou date non vérifiée ; contrôle du PDF requis.", identityMatch, status: "proposed" });
      if (candidates.length > 100) fail("TOO_MANY_RESULTS", "Trop de résultats dans ce document.", 413);
    }
  }
  return candidates;
}
function boundedText(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail("INVALID_INPUT", `${field} requis ou trop long.`);
  return (value as string).trim();
}
function resultValues(exam: unknown, value: unknown, unit: unknown, examDate: unknown) {
  const name = boundedText(exam, "Examen", 100), resultUnit = boundedText(unit, "Unité", 40);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) fail("INVALID_VALUE", "Résultat numérique invalide.");
  // Unit and plausible range must be reviewed together. No conversion is inferred.
  if (name.toLowerCase() === "hba1c" && (!["%", "mmol/mol"].includes(resultUnit) || (resultUnit === "%" ? (value as number) > 30 : (value as number) > 300))) fail("INVALID_VALUE", "Unité ou valeur HbA1c incohérente.");
  return { exam: name, value: value as number, unit: resultUnit, examDate: calendarDate(examDate) };
}
export class EndoRecordService {
  constructor(public store: CareStoreAdapter, private directory = process.env.HACKCURE_DOCUMENT_DIRECTORY || ".data/care-documents", private extractor: PdfExtractor = extractPdfPages, private fileReader: (path: string) => Promise<Buffer> = readFile) {}
  private clinicalTransaction<T>(actor: Actor, patientId: string | undefined, action: string, mutate: (state: CareState) => T): T {
    try { return this.store.transaction(mutate); }
    catch (error) {
      if (patientId && error instanceof CareError && [403,404].includes(error.status)) { recordDeniedAccess(this.store,actor,patientId,action); error.accessJournalRecorded = true; }
      throw error;
    }
  }
  private sourcePath(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) fail("NOT_FOUND", "Document inaccessible.", 404);
    return join(resolve(this.directory), `${id}.pdf`);
  }
  async upload(actor: Actor, patientId: string, filename: string, bytes: Uint8Array) {
    const patient = authorizePatient(this.store.read(), actor, patientId);
    const access = requirePatientCapability(this.store.read(), actor, patientId, "documents");
    if (!access.owner && !access.canManageCare) fail("FORBIDDEN", "Droits de capture insuffisants.", 403);
    if (bytes.byteLength > MAX_PDF_BYTES) fail("TOO_LARGE", "Maximum 5 Mio par document.", 413);
    if (bytes.byteLength < 8 || Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-") fail("INVALID_PDF", "Un document PDF est requis.");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const existing = this.store.transaction(state => {
      const access = requirePatientCapability(state, actor, patientId, "documents");
      if (!access.owner && !access.canManageCare) fail("FORBIDDEN", "Droits de capture insuffisants.", 403);
      const document = state.documents.find(d => d.patientId === patientId && d.contentHash === contentHash);
      if (!document) return null;
      audit(state, actor, "reuse_document", document.id);
      return { document, candidates: state.candidates.filter(c => c.documentId === document.id) };
    });
    if (existing) return existing;
    const pages = await this.extractor(bytes);
    if (pages.length > 20) fail("TOO_MANY_PAGES", "Maximum 20 pages par document.", 413);
    const id = careId();
    const candidates = proposeCandidates(pages, patient.displayName, id, patientId);
    const document: Document = { id, patientId, contentHash, filename: filename.replace(/[\r\n\x00-\x1f/\\]/g, "_").slice(0, 160) || "document.pdf", uploadedAt: new Date().toISOString(), status: candidates.length ? "review" : "needs_manual_review", ...(!candidates.length ? { error: "Aucun résultat HbA1c texte extrait ; saisie/revue manuelle nécessaire. OCR non disponible." } : {}) };
    await mkdir(resolve(this.directory), { recursive: true, mode: 0o700 });
    await writeFile(this.sourcePath(id), bytes, { mode: 0o600, flag: "wx" });
    try {
      const result = this.store.transaction(state => {
        const access = requirePatientCapability(state, actor, patientId, "documents");
      if (!access.owner && !access.canManageCare) fail("FORBIDDEN", "Droits de capture insuffisants.", 403);
        const duplicate = state.documents.find(d => d.patientId === patientId && d.contentHash === contentHash);
        if (duplicate) { audit(state, actor, "reuse_document", duplicate.id); return { document: duplicate, candidates: state.candidates.filter(c => c.documentId === duplicate.id) }; }
        state.documents.push(document); state.candidates.push(...candidates); bumpPatientRevision(state, patientId, "context"); bumpPatientRevision(state, patientId, "evidence"); journalAccess(state,actor,patientId,"upload_document","document",id,"allowed"); audit(state, actor, "upload_document", id); return { document, candidates };
      });
      if (result.document.id !== id) await unlink(this.sourcePath(id));
      return result;
    } catch (error) { await unlink(this.sourcePath(id)); throw error; }
  }
  async source(actor: Actor, id: string) {
    const checkAccess = () => {
      const state = this.store.read();
      const document = state.documents.find(d => d.id === id);
      if (!document) fail("NOT_FOUND", "Document inaccessible.", 404);
      requirePatientReadScope(state, actor, document!.patientId, "documents");
    };
    try { checkAccess(); } catch(error) { const doc=this.store.read().documents.find(d=>d.id===id); if(doc)recordDeniedAccess(this.store,actor,doc.patientId,"read_document_source"); throw error; }
    let bytes: Buffer;
    try { bytes = await this.fileReader(this.sourcePath(id)); }
    catch (error) { if (error instanceof CareError) throw error; return fail("SOURCE_UNAVAILABLE", "Source PDF indisponible.", 404); }
    // File I/O yields to other requests; consent or assignment can change meanwhile.
    // Reauthorize immediately before releasing bytes and only audit allowed reads.
    try { this.store.transaction(state => {
      const document = state.documents.find(d => d.id === id);
      if (!document) fail("NOT_FOUND", "Document inaccessible.", 404);
      requirePatientReadScope(state, actor, document!.patientId, "documents");
      audit(state, actor, "read_document_source", id);
      journalAccess(state,actor,document!.patientId,"read_document_source","document",id,"allowed");
    }); } catch(error) { const doc=this.store.read().documents.find(d=>d.id===id); if(doc)recordDeniedAccess(this.store,actor,doc.patientId,"read_document_source"); throw error; }
    return bytes;
  }
  review(actor: Actor, id: string, body: Record<string, unknown>) {
    const patientId = this.store.read().candidates.find(c => c.id === id)?.patientId;
    return this.clinicalTransaction(actor,patientId,"review_candidate",state => {
      requireClinician(actor);
      const candidate = state.candidates.find(c => c.id === id); if (!candidate) fail("NOT_FOUND", "Résultat inaccessible.", 404);
      const c = candidate!; requirePatientCapability(state, actor, c.patientId, "manage");
      if (c.status !== "proposed") fail("ALREADY_REVIEWED", "Résultat déjà revu.", 409);
      if (body.action !== "confirm" && body.action !== "reject") fail("INVALID_ACTION", "Action de revue invalide.");
      let observation: Observation | null = null;
      let reason: string | undefined;
      if (body.action === "reject") { reason = boundedText(body.reason, "Motif"); c.status = "rejected"; }
      else {
        if (body.identityConfirmed !== true) fail("IDENTITY_REQUIRED", "Confirmez l’identité en consultant le PDF original.");
        const values = resultValues(body.exam ?? c.exam, body.value ?? c.value, body.unit ?? c.unit, body.examDate ?? c.examDate);
        const corrected = values.exam !== c.exam || values.value !== c.value || values.unit !== c.unit || values.examDate !== c.examDate;
        if (corrected) reason = boundedText(body.reason, "Motif de correction");
        observation = { id: careId(), patientId: c.patientId, ...values, documentId: c.documentId, candidateId: c.id, confirmedBy: actor.id, confirmedAt: new Date().toISOString(), revisions: [] };
        state.observations.push(observation); c.status = "confirmed";
      }
      // Original extraction remains unchanged; confirmed values are a separate sourced record.
      bumpPatientRevision(state,c.patientId,"context"); bumpPatientRevision(state,c.patientId,"evidence");
      journalAccess(state,actor,c.patientId,"review_candidate","candidate",id,"allowed");
      audit(state, actor, `candidate_${body.action}${reason ? `: ${reason}` : ""}${body.action === "confirm" ? ": identity_checked" : ""}`, id);
      const document = state.documents.find(d => d.id === c.documentId);
      if (document && state.candidates.filter(item => item.documentId === document.id).every(item => item.status !== "proposed")) document.status = "reviewed";
      return { candidate: c, observation };
    });
  }
  revise(actor: Actor, id: string, body: Record<string, unknown>) {
    const patientId = this.store.read().observations.find(o => o.id === id)?.patientId;
    return this.clinicalTransaction(actor,patientId,"revise_observation",state => {
      requireClinician(actor);
      const observation = state.observations.find(o => o.id === id); if (!observation) fail("NOT_FOUND", "Résultat inaccessible.", 404);
      const o = observation!; requirePatientCapability(state, actor, o.patientId, "manage");
      const reason = boundedText(body.reason, "Motif de correction");
      const values = resultValues(o.exam, body.value, body.unit, body.examDate);
      o.revisions.push({ value: o.value, unit: o.unit, examDate: o.examDate, reason, author: actor.id, at: new Date().toISOString() });
      Object.assign(o, values); bumpPatientRevision(state,o.patientId,"context"); bumpPatientRevision(state,o.patientId,"evidence"); audit(state, actor, "revise_observation", id);
      journalAccess(state,actor,o.patientId,"revise_observation","observation",id,"allowed");
      return { observation: o };
    });
  }
}
