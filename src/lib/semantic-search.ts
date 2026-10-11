import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Actor } from "../contracts/care";
import type { GenerationOptions, SearchResponse, SourceChunk, SourceRef } from "../contracts/monitoring";
import { type CareState, type CareStoreAdapter } from "./care-store";
import { LocalModelError, type LocalModel } from "./local-model";
import { extractPdfPages, type PdfExtractor } from "./endorecord-service";
import { currentGuard, hasScope, journalAccess, requirePatientCapability, resolvePatientAccess } from "./patient-access-service";
import { boundedText, canonical, fail, hash } from "./monitoring-utils";
const THRESHOLD = 0.35;
const norm = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const words = (text: string) => norm(text).match(/[\p{L}\p{N}]+/gu) ?? [];
const SAFE_WORDS = new Set(words("hypertension diabetes diabete tension arterielle blood pressure glucose glycemie hba1c hemoglobine glyquee mmol mg dl mol mmhg bpm pulse pouls systolic diastolic condition treatment traitement allergy allergie symptom symptome measurement mesure observation exam examen laboratory laboratoire affirmed negated uncertain unknown confirmed patient_reported simulated candidate external_unverified pression سكر ضغط نبض قلب دم"));
/** Only a closed clinical vocabulary and numbers cross the local model boundary. */
function embeddingText(text: string): string {
    const tokens = words(text);
    if (!tokens.some(token => SAFE_WORDS.has(token))) return "";
    return tokens.filter(token => SAFE_WORDS.has(token) || /^\d{1,6}$/.test(token)).join(" ").slice(0, 500);
}
function withoutMaskedIdentity(text: string): string { return text.replace(/\[(?:identité masquée|courriel masqué|identifiant masqué)\]/gu, " "); }
function cosine(a: number[], b: number[]): number { if (!a.length || a.length !== b.length || a.length > 4096 || [...a, ...b].some(v => typeof v !== "number" || !Number.isFinite(v)))
    throw new Error("Invalid vector"); const aa = a.reduce((s, v) => s + v * v, 0), bb = b.reduce((s, v) => s + v * v, 0); if (!aa || !bb || !Number.isFinite(aa) || !Number.isFinite(bb))
    throw new Error("Invalid norm"); return a.reduce((s, v, i) => s + v * b[i], 0) / Math.sqrt(aa * bb); }
async function boundedEmbedding(model: LocalModel, texts: string[], options: GenerationOptions): Promise<number[][]> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort = () => { };
    try {
        if (options.signal?.aborted)
            throw new LocalModelError("aborted");
        const stopped = new Promise<never>((_, reject) => {
            abort = () => { controller.abort(); reject(new LocalModelError("aborted")); };
            options.signal?.addEventListener("abort", abort, { once: true });
            timer = setTimeout(() => { controller.abort(); reject(new LocalModelError("timeout")); }, Math.max(1, Math.min(options.timeoutMs ?? 15000, 15000)));
        });
        return await Promise.race([model.embed(texts, { ...options, signal: controller.signal }), stopped]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
    }
}
type Options = {
    fileReader?: (path: string) => Promise<Buffer>;
    extractor?: PdfExtractor;
    documentDirectory?: string;
    cachePath?: string | null;
    referenceManifestPath?: string;
};
export class SemanticSearchService {
    private readonly vectors = new Map<string, number[]>();
    private loaded = false;
    constructor(private readonly store: CareStoreAdapter, private readonly model?: LocalModel, private readonly options: Options = {}) { }
    private authorize(state: CareState, actor: Actor, id: string) {
        const access = resolvePatientAccess(state, actor, id);
        const scope = hasScope(access, "documents") ? "documents" : hasScope(access, "clinical") ? "clinical" : hasScope(access, "measurements") ? "measurements" : null;
        if (!scope) fail("FORBIDDEN", "Recherche non autorisée.", 403);
        requirePatientCapability(state, actor, id, scope);
        if (!state.patients.find(patient => patient.id === id)!.fictional) fail("FICTIONAL_ONLY");
        return access;
    }
    private check(actor: Actor, id: string) { const state = this.store.read(); return { state, access: this.authorize(state, actor, id) }; }
    private assertSnapshot(actor: Actor, id: string, guard: ReturnType<typeof currentGuard>) {
        const { state } = this.check(actor, id);
        if (canonical(currentGuard(state, id)) !== canonical(guard)) fail("STALE_CONTEXT", "Le dossier ou les droits ont changé.", 409);
    }
    async search(actor: Actor, id: string, query: string, options: GenerationOptions = {}): Promise<SearchResponse> {
        query = boundedText(query, 500);
        const { state, access } = this.check(actor, id), guard = currentGuard(state, id), patient = state.patients.find(p => p.id === id)!;
        const redact = (text: string) => { for (const value of [patient.displayName, patient.region])
            if (value)
                text = text.split(value).join("[identité masquée]"); return text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[courriel masqué]").replace(/\b(?:\+?\d[\s().-]*){8,}\b/g, "[identifiant masqué]"); };
        const factChunks: SourceChunk[] = [], measurementChunks: SourceChunk[] = [], observationChunks: SourceChunk[] = [], noteChunks: SourceChunk[] = [], documentChunks: SourceChunk[] = [];
        // Each category has reserved space: notes and references cannot crowd out PDFs.
        // The combined bounds remain 39 chunks / 18k characters plus one query.
        const add = (target: SourceChunk[], maxChunks: number, maxCharacters: number, source: SourceRef, text: string) => {
            const remaining = maxCharacters - target.reduce((total, chunk) => total + chunk.text.length, 0);
            if (target.length >= maxChunks || remaining <= 0) return;
            const excerpt = redact(text).slice(0, Math.min(1000, remaining));
            if (!excerpt.trim()) return;
            target.push({ id: `${source.kind}:${source.id}:${source.revision}`, source, text: excerpt, extractionVersion: "search-v2" });
        };
        if (hasScope(access, "clinical"))
            for (const f of state.medicalFacts.filter(f => f.patientId === id && !f.supersededBy))
                add(factChunks, 8, 3000, { kind: "patient_fact", id: f.id, revision: f.revision, contentHash: hash(canonical(f)), date: f.createdAt, verification: f.verification, polarity: f.polarity }, `${f.kind}: ${f.label} ${f.code ?? ""} ${f.value ?? ""} (${f.polarity}, ${f.verification})`);
        if (hasScope(access, "measurements"))
            for (const m of state.measurements.filter(m => m.patientId === id).slice(-20))
                add(measurementChunks, 8, 2000, { kind: "measurement", id: m.id, revision: 1, contentHash: hash(canonical(m)), date: m.measuredAt, verification: m.connector?.quality === "suspect" ? "candidate" : m.source === "simulated" || m.connector?.simulated ? "simulated" : m.source === "device" ? "confirmed" : "patient_reported", polarity: m.connector?.quality === "suspect" ? "uncertain" : "affirmed" }, m.kind === "blood_pressure" ? `blood pressure tension ${m.systolic}/${m.diastolic} ${m.unit}` : `${m.kind} ${m.value} ${m.unit}`);
        if (hasScope(access, "clinical") && hasScope(access, "documents"))
            for (const o of state.observations.filter(o => o.patientId === id))
                add(observationChunks, 4, 1000, { kind: "observation", id: o.id, revision: o.revisions.length + 1, contentHash: hash(canonical(o)), documentId: o.documentId, date: o.examDate, verification: "confirmed", polarity: "affirmed" }, `${o.exam} ${o.value} ${o.unit} ${o.examDate}`);
        if (hasScope(access, "clinical"))
            for (const note of state.externalNotes.filter(note => note.patientId === id).slice(-6))
                add(noteChunks, 6, 3000, { kind: "external_note", id: note.id, revision: 1, contentHash: hash(canonical(note)), date: note.consultationDate ?? note.receivedAt, verification: "external_unverified", polarity: "unknown" }, note.text);
        if (hasScope(access, "documents"))
            for (const d of state.documents.filter(d => d.patientId === id).slice(-4)) {
                if (documentChunks.length >= 10 || documentChunks.reduce((total, chunk) => total + chunk.text.length, 0) >= 6500) break;
                if (!/^[0-9a-f-]{36}$/i.test(d.id))
                    continue;
                try {
                    this.check(actor, id);
                    const bytes = await (this.options.fileReader ?? readFile)(join(resolve(this.options.documentDirectory ?? process.env.HACKCURE_DOCUMENT_DIRECTORY ?? ".data/care-documents"), `${d.id}.pdf`));
                    if (bytes.length > 5 * 1024 * 1024)
                        continue;
                    const { createHash } = await import("node:crypto");
                    if (d.contentHash && createHash("sha256").update(bytes).digest("hex") !== d.contentHash)
                        continue;
                    const pages = await (this.options.extractor ?? extractPdfPages)(bytes);
                    if (pages.length > 20)
                        continue;
                    for (const p of pages)
                        for (let offset = 0; offset < p.text.length && documentChunks.length < 10 && documentChunks.reduce((total, chunk) => total + chunk.text.length, 0) < 6500; offset += 1000)
                            add(documentChunks, 10, 6500, { kind: "candidate", id: `document:${d.id}:page:${p.page}:offset:${offset}`, revision: 1, documentId: d.id, page: p.page, contentHash: d.contentHash ?? null, date: d.uploadedAt, verification: "candidate", polarity: "unknown" }, p.text.slice(offset, offset + 1000));
                }
                catch { /* No OCR inference; other permitted facts remain searchable. */ }
            }
        const referenceChunks = await this.referenceChunks();
        const chunks = [...factChunks, ...measurementChunks, ...observationChunks, ...noteChunks, ...documentChunks, ...referenceChunks];
        const searchQuery = withoutMaskedIdentity(redact(query));
        const meaningfulQuery = embeddingText(searchQuery);
        const embeddable = chunks.map((chunk, index) => ({ chunk, index, text: embeddingText(withoutMaskedIdentity(chunk.text)) })).filter(item => item.text.length > 0);
        let mode: SearchResponse["mode"] = "lexical";
        const scores = new Map<number, number>();
        if (this.model && meaningfulQuery && embeddable.length)
            try {
                this.assertSnapshot(actor, id, guard);
                await this.loadCache();
                this.assertSnapshot(actor, id, guard);
                const model = this.model.embeddingModel ?? this.model.model ?? "configured_embedding";
                const indexed = embeddable.map(item => ({ ...item, key: hash(canonical({ source: item.chunk.source, text: item.text, version: item.chunk.extractionVersion, model })) }));
                const missing = indexed.filter(item => !this.vectors.has(item.key));
                const texts = [meaningfulQuery, ...missing.map(item => item.text)];
                if (texts.length > 40)
                    throw new Error("Embedding batch limit");
                const results = await boundedEmbedding(this.model, texts, options);
                if (results.length !== texts.length)
                    throw new Error("Invalid dimensions");
                for (const v of results)
                    cosine(v, results[0]);
                missing.forEach((item, position) => this.vectors.set(item.key, results[position + 1]));
                indexed.forEach(item => scores.set(item.index, cosine(results[0], this.vectors.get(item.key)!)));
                mode = "semantic";
                await this.saveCache();
            }
            catch {
                mode = "lexical";
            }
        if (options.signal?.aborted)
            fail("REQUEST_ABORTED", "Recherche annulée.", 499);
        this.assertSnapshot(actor, id, guard);
        const terms = new Set(words(searchQuery));
        const hits = chunks.map((c, i) => { const tokens = new Set(words(withoutMaskedIdentity(c.text))); const score = mode === "semantic" ? scores.get(i) ?? -1 : [...terms].filter(w => tokens.has(w)).length / Math.max(1, terms.size); return { id: c.id, source: c.source, excerpt: c.text, score: mode === "semantic" ? score : null, rank: score }; }).filter(h => mode === "semantic" ? h.rank >= THRESHOLD : h.rank > 0).sort((a, b) => b.rank - a.rank).slice(0, 5).map(({ rank: _, ...h }) => h);
        this.store.transaction(current => {
            this.authorize(current, actor, id);
            if (canonical(currentGuard(current, id)) !== canonical(guard)) fail("STALE_CONTEXT", "Le dossier ou les droits ont changé.", 409);
            journalAccess(current, actor, id, "search_record", "patient", id, "allowed");
        });
        return { hits, noEvidence: !hits.length, mode };
    }
    private async referenceChunks(): Promise<SourceChunk[]> {
        const chunks: SourceChunk[] = [];
        try {
            const path = this.options.referenceManifestPath ?? resolve("research/monitoring-reference-manifest.json");
            if ((await stat(path)).size > 64 * 1024) return chunks;
            const manifestBytes = await readFile(path);
            if (manifestBytes.length > 64 * 1024) return chunks;
            const manifest = JSON.parse(manifestBytes.toString("utf8")) as { schemaVersion?: unknown; references?: unknown };
            if (manifest.schemaVersion !== "monitoring-reference-v1" || !Array.isArray(manifest.references) || manifest.references.length > 8) return chunks;
            for (const raw of manifest.references) {
                if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
                const entry = raw as Record<string, unknown>;
                if (typeof entry.id !== "string" || !/^[a-z0-9-]{1,80}$/.test(entry.id) || !Number.isSafeInteger(entry.revision) || (entry.revision as number) < 1 || typeof entry.sourceFile !== "string" || !/^research\/[a-z0-9-]+\.md$/.test(entry.sourceFile) || typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) continue;
                if (entry.issuer !== "HackCure prototype team" || entry.reuse !== "Project-authored content only" || entry.demoLabel !== "Internal prototype policy; not a medical practice guideline" || entry.url !== null || typeof entry.title !== "string" || entry.title.length > 200 || typeof entry.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Number.isFinite(Date.parse(entry.date))) continue;
                const sourcePath = resolve(entry.sourceFile);
                if ((await stat(sourcePath)).size > 16 * 1024) continue;
                const bytes = await readFile(sourcePath);
                if (bytes.length > 16 * 1024 || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) continue;
                const text = bytes.toString("utf8");
                const label = `Référence générale : ${entry.title}. ${entry.demoLabel}. Émetteur : ${entry.issuer}.\n`;
                const bodySize = 1000 - label.length;
                if (bodySize <= 0) continue;
                for (let offset = 0, part = 0; offset < text.length && chunks.length < 3; offset += bodySize, part++) {
                    const remaining = 2500 - chunks.reduce((total, chunk) => total + chunk.text.length, 0);
                    if (remaining <= label.length) break;
                    const source: SourceRef = { kind: "reference", id: `reference:project:${entry.id}:part:${part}`, revision: entry.revision as number, contentHash: entry.sha256, date: `${entry.date}T00:00:00.000Z`, verification: "reference", polarity: "affirmed" };
                    chunks.push({ id: `${source.kind}:${source.id}:${source.revision}`, source, text: (label + text.slice(offset, offset + bodySize)).slice(0, remaining), extractionVersion: "project-reference-v1" });
                }
            }
        } catch { /* Missing/unverifiable prototype references never become clinical evidence. */ }
        return chunks;
    }
    private async loadCache() { if (this.loaded)
        return; this.loaded = true; if (!this.options.cachePath)
        return; try {
        if ((await stat(this.options.cachePath)).size > 32 * 1024 * 1024)
            return;
        const values = JSON.parse(await readFile(this.options.cachePath, "utf8")) as unknown;
        if (!Array.isArray(values) || values.length > 512)
            return;
        for (const row of values) {
            if (Array.isArray(row) && typeof row[0] === "string" && /^[0-9a-f]{64}$/.test(row[0]) && Array.isArray(row[1])) {
                cosine(row[1], row[1]);
                this.vectors.set(row[0], row[1]);
            }
        }
    }
    catch {
        this.vectors.clear();
    } }
    private async saveCache() { while (this.vectors.size > 512)
        this.vectors.delete(this.vectors.keys().next().value!); if (!this.options.cachePath)
        return; const path = resolve(this.options.cachePath); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temp = path + "." + randomUUID() + ".tmp"; await writeFile(temp, JSON.stringify([...this.vectors]), { mode: 0o600, flag: "wx" }); await rename(temp, path); }
}
