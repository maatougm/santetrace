import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Alert, DemoRules, Note, Patient, PendingSubmission, Reading, Reminder } from "../contracts/hackcure";

export type InternalPending = PendingSubmission & { senderId?: string };
export type Delivery = { id: string; chatId: string; text: string; keyboard?: unknown; sentAt: string | null; error: string | null; reminderId?: string; phase?: "initial" | "follow_up" };
export type State = {
  generation: string; patients: Patient[]; readings: Reading[]; alerts: Alert[]; notes: Note[]; reminders: Reminder[];
  pending: InternalPending[]; invites: { hash: string; patientId: string; expiresAt: string; usedAt: string | null }[];
  bindings: { patientId: string; senderId: string; chatId: string }[];
  processedUpdates: number[]; deliveries: Delivery[];
  idempotency: Record<string, { fingerprint: string; result: unknown }>;
};
export const DEFAULT_RULES: DemoRules = { systolicWarn: 140, diastolicWarn: 90, systolicHigh: 160, diastolicHigh: 100, overdueHours: 24 };
export function seedState(now = new Date()): State {
  const iso = now.toISOString();
  const patients: Patient[] = [
    { id: "fatma", displayName: "Fatma Ben Salah", region: "Siliana", age: 62, language: "ar", fictional: true, consent: true, telegramLinked: false, createdAt: iso, rules: { ...DEFAULT_RULES } },
    { id: "ahmed", displayName: "Ahmed Trabelsi", region: "Kairouan", age: 54, language: "fr", fictional: true, consent: true, telegramLinked: false, createdAt: iso, rules: { ...DEFAULT_RULES } },
    { id: "leila", displayName: "Leïla Mansour", region: "Tunis", age: 47, language: "fr", fictional: true, consent: true, telegramLinked: false, createdAt: iso, rules: { ...DEFAULT_RULES } },
    { id: "salah", displayName: "Salah Gharbi", region: "Jendouba", age: 68, language: "ar", fictional: true, consent: true, telegramLinked: false, createdAt: iso, rules: { ...DEFAULT_RULES } },
  ];
  const readings: Reading[] = [];
  for (const [index, patient] of patients.entries()) for (let day = 7; day >= 1; day--) {
    const at = new Date(now.getTime() - (day + (patient.id === "ahmed" ? 2 : 0)) * 86400000).toISOString();
    readings.push({ id: randomUUID(), patientId: patient.id, systolic: 121 + index * 3 + day % 4, diastolic: 76 + index * 2 + day % 3, unit: "mmHg", measuredAt: null, submittedAt: at, confirmedAt: at, source: "demo", pendingId: randomUUID() });
  }
  const reminderId = randomUUID();
  const past = new Date(now.getTime() - 48 * 3600000).toISOString();
  const reminders: Reminder[] = [{ id: reminderId, patientId: "ahmed", dueAt: past, followUpAt: past, silenceAt: past, initialSentAt: past, followUpSentAt: past, satisfiedAt: null, silenceAlertAt: iso, deliveryError: null, simulated: true }];
  const alerts: Alert[] = [{ id: randomUUID(), patientId: "ahmed", kind: "missing_measurement", priority: "review", status: "new", readingId: null, reminderId, reason: "Aucune mesure confirmée reçue après un rappel simulé.", createdAt: iso, acknowledgedAt: null, resolvedAt: null, rulesSnapshot: null }];
  return { generation: randomUUID(), patients, readings, alerts, notes: [], reminders, pending: [], invites: [], bindings: [], processedUpdates: [], deliveries: [], idempotency: {} };
}

// ponytail: one transactional state document for a single demo workspace; normalized PostgreSQL migration is the cloud upgrade path.
export class DemoStore {
  private db: DatabaseSync;
  constructor(path: string = process.env.HACKCURE_DATABASE_PATH || ".data/hackcure.sqlite") {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)");
    this.db.prepare("INSERT OR IGNORE INTO state(id,body) VALUES(1,?)").run(JSON.stringify(seedState()));
  }
  read(): State { return JSON.parse((this.db.prepare("SELECT body FROM state WHERE id=1").get() as { body: string }).body) as State; }
  transaction<T>(action: (state: State) => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.read();
      const result = action(state);
      this.db.prepare("UPDATE state SET body=? WHERE id=1").run(JSON.stringify(state));
      this.db.exec("COMMIT");
      return result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  close() { this.db.close(); }
}
const singleton = globalThis as typeof globalThis & { hackcureStore?: DemoStore };
export function getStore() { return singleton.hackcureStore ??= new DemoStore(); }
