import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Alert, DemoRules, Language, Note, PendingSubmission, Snapshot } from "../contracts/hackcure";
import { DEFAULT_RULES, DemoStore, seedState, type State } from "./store";
import { parseBloodPressure } from "./measurement";

export class ServiceError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export const hashToken = (text: string) => createHash("sha256").update(text).digest("hex");
export function requireGeneration(state: State, generation: unknown) {
  if (generation !== state.generation) throw new ServiceError("STALE_GENERATION", "La démo a été réinitialisée. Actualisez les données.", 409);
}
function patientById(state: State, id: string) {
  const patient = state.patients.find(p => p.id === id);
  if (!patient) throw new ServiceError("NOT_FOUND", "Patient introuvable.", 404);
  return patient;
}
export function validateRules(raw: unknown): DemoRules {
  if (!raw || typeof raw !== "object") throw new ServiceError("INVALID_RULES", "Règles de démonstration invalides.");
  const rules = raw as DemoRules;
  if (![rules.systolicWarn, rules.diastolicWarn, rules.systolicHigh, rules.diastolicHigh, rules.overdueHours].every(Number.isFinite)
    || rules.systolicWarn < 40 || rules.systolicHigh > 300 || rules.systolicHigh < rules.systolicWarn
    || rules.diastolicWarn < 20 || rules.diastolicHigh > 200 || rules.diastolicHigh < rules.diastolicWarn
    || rules.overdueHours < 1 || rules.overdueHours > 168) throw new ServiceError("INVALID_RULES", "Vérifiez les limites et le délai (1–168 heures).");
  return { systolicWarn: rules.systolicWarn, diastolicWarn: rules.diastolicWarn, systolicHigh: rules.systolicHigh, diastolicHigh: rules.diastolicHigh, overdueHours: rules.overdueHours };
}
export function snapshot(store: DemoStore): Snapshot {
  const state = store.read();
  return { generation: state.generation, serverTime: new Date().toISOString(), mode: "fictional_demo", storage: "sqlite", telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN), patients: state.patients, readings: state.readings.map(({ ...reading }) => reading), alerts: state.alerts, notes: state.notes, reminders: state.reminders, pending: state.pending.filter(p => p.source === "demo" && p.status === "pending" && new Date(p.expiresAt).getTime() > Date.now()).map(({ senderId: _sender, ...pending }) => pending) };
}
export function idempotent<T>(store: DemoStore, key: string | null, fingerprint: string, action: (state: State) => T): T {
  if (!key || key.length < 8 || key.length > 128) throw new ServiceError("IDEMPOTENCY_REQUIRED", "Un identifiant de requête est requis.");
  return store.transaction(state => {
    const old = state.idempotency[key];
    if (old) {
      if (old.fingerprint !== fingerprint) throw new ServiceError("KEY_CONFLICT", "Identifiant déjà utilisé pour une autre requête.", 409);
      return old.result as T;
    }
    const result = action(state);
    state.idempotency[key] = { fingerprint, result };
    const keys = Object.keys(state.idempotency);
    if (keys.length > 500) delete state.idempotency[keys[0]];
    return result;
  });
}
export function createPatient(state: State, raw: Record<string, unknown>) {
  const displayName = typeof raw.displayName === "string" ? raw.displayName.trim() : "";
  const region = typeof raw.region === "string" ? raw.region.trim() : "";
  if (displayName.length < 2 || displayName.length > 80 || region.length < 2 || region.length > 60 || !Number.isInteger(raw.age) || (raw.age as number) < 18 || (raw.age as number) > 110 || !["fr", "ar"].includes(String(raw.language)) || raw.consent !== true) throw new ServiceError("INVALID_PATIENT", "Indiquez un nom fictif, une région, un âge (18–110), une langue et le consentement démo.", 422);
  const patient = { id: randomUUID(), displayName, region, age: raw.age as number, language: raw.language as Language, fictional: true as const, consent: true, telegramLinked: false, createdAt: new Date().toISOString(), rules: { ...DEFAULT_RULES } };
  state.patients.push(patient);
  return { patient };
}
export function createInvite(state: State, patientId: string) {
  patientById(state, patientId);
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
  state.invites = state.invites.filter(i => i.patientId !== patientId && new Date(i.expiresAt).getTime() > Date.now());
  state.invites.push({ hash: hashToken(token), patientId, expiresAt, usedAt: null });
  const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  return { code: token, url: username ? `https://t.me/${username}?start=${token}` : null, expiresAt, telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN) };
}
export function linkTelegram(state: State, token: string, senderId: string, chatId: string) {
  const invite = state.invites.find(i => i.hash === hashToken(token) && !i.usedAt && new Date(i.expiresAt).getTime() > Date.now());
  if (!invite) throw new ServiceError("INVALID_INVITE", "Lien expiré ou déjà utilisé. Demandez un nouveau lien au centre.", 409);
  if (state.bindings.some(b => b.senderId === senderId && b.patientId !== invite.patientId)) throw new ServiceError("ALREADY_LINKED", "Ce compte est déjà lié à un autre patient.", 409);
  if (state.bindings.some(b => b.patientId === invite.patientId)) throw new ServiceError("ALREADY_LINKED", "Ce patient est déjà lié. Le centre doit retirer le lien existant.", 409);
  state.bindings.push({ patientId: invite.patientId, senderId, chatId });
  invite.usedAt = new Date().toISOString();
  const patient = patientById(state, invite.patientId);
  patient.telegramLinked = true;
  return patient;
}
export function proposeReading(state: State, patientId: string, text: string, source: "demo" | "telegram", senderId?: string): { pending: PendingSubmission } {
  patientById(state, patientId);
  let values;
  try { values = parseBloodPressure(text); } catch { throw new ServiceError("INVALID_MEASUREMENT", "Format attendu : 120/80 mmHg. Une seule mesure, sans décimales. Corrigez la saisie.", 422); }
  for (const old of state.pending) if (old.patientId === patientId && old.status === "pending" && old.source === source) old.status = "cancelled";
  const pending = { id: randomUUID(), patientId, ...values, submittedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), status: "pending" as const, source, generation: state.generation, senderId };
  state.pending.push(pending);
  const { senderId: _private, ...publicPending } = pending;
  return { pending: publicPending };
}
export function confirmReading(state: State, id: string, source: "demo" | "telegram", action: "confirm" | "cancel", senderId?: string) {
  const pending = state.pending.find(p => p.id === id && p.source === source && p.generation === state.generation && (source === "demo" || p.senderId === senderId));
  if (!pending) throw new ServiceError("NOT_FOUND", "Confirmation introuvable ou expirée.", 404);
  if (action === "cancel") {
    if (pending.status === "confirmed") throw new ServiceError("ALREADY_CONFIRMED", "La mesure est déjà confirmée.", 409);
    pending.status = "cancelled";
    return { cancelled: true };
  }
  if (pending.status === "confirmed") {
    const reading = state.readings.find(r => r.pendingId === pending.id)!;
    return { reading, alert: state.alerts.find(a => a.readingId === reading.id) ?? null };
  }
  if (pending.status !== "pending" || new Date(pending.expiresAt).getTime() <= Date.now()) throw new ServiceError("EXPIRED_CONFIRMATION", "Confirmation expirée. Envoyez une nouvelle mesure.", 409);
  pending.status = "confirmed";
  const now = new Date().toISOString();
  const reading = { id: randomUUID(), patientId: pending.patientId, systolic: pending.systolic, diastolic: pending.diastolic, unit: "mmHg" as const, measuredAt: null, submittedAt: pending.submittedAt, confirmedAt: now, source, pendingId: pending.id };
  state.readings.push(reading);
  const rules = patientById(state, pending.patientId).rules;
  let alert: Alert | null = null;
  if (reading.systolic >= rules.systolicWarn || reading.diastolic >= rules.diastolicWarn) {
    alert = { id: randomUUID(), patientId: pending.patientId, kind: "outside_demo_range", priority: reading.systolic >= rules.systolicHigh || reading.diastolic >= rules.diastolicHigh ? "high" : "review", status: "new", readingId: reading.id, reminderId: null, reason: `${reading.systolic}/${reading.diastolic} mmHg : hors plage configurée pour la démo. Règles non validées cliniquement.`, createdAt: now, acknowledgedAt: null, resolvedAt: null, rulesSnapshot: { ...rules } };
    state.alerts.push(alert);
  }
  for (const reminder of state.reminders) if (reminder.patientId === pending.patientId && reminder.initialSentAt && !reminder.satisfiedAt && pending.submittedAt >= reminder.initialSentAt) reminder.satisfiedAt = now;
  return { reading, alert };
}
export function addNote(state: State, patientId: string, raw: Record<string, unknown>) {
  patientById(state, patientId);
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (text.length < 1 || text.length > 1000) throw new ServiceError("INVALID_NOTE", "La note doit contenir 1 à 1 000 caractères.", 422);
  const kind = raw.kind ?? "follow_up";
  const outcome = raw.outcome ?? null;
  if (!["follow_up", "contact_attempt"].includes(String(kind)) || ![null, "contacted", "no_answer", "appointment_planned"].includes(outcome as null)) throw new ServiceError("INVALID_NOTE", "Type de suivi invalide.");
  const alertId = typeof raw.alertId === "string" ? raw.alertId : null;
  if (alertId && !state.alerts.some(a => a.id === alertId && a.patientId === patientId)) throw new ServiceError("NOT_FOUND", "Alerte introuvable.", 404);
  const note: Note = { id: randomUUID(), patientId, alertId, text, kind: kind as Note["kind"], outcome: outcome as Note["outcome"], authorLabel: "Dr Démo", createdAt: new Date().toISOString() };
  state.notes.push(note);
  return { note };
}
export function changeAlert(state: State, id: string, raw: Record<string, unknown>) {
  const alert = state.alerts.find(a => a.id === id);
  if (!alert) throw new ServiceError("NOT_FOUND", "Alerte introuvable.", 404);
  if (!["acknowledged", "resolved"].includes(String(raw.status))) throw new ServiceError("INVALID_STATUS", "Statut invalide.");
  if (alert.status === "resolved" && raw.status !== "resolved") throw new ServiceError("INVALID_TRANSITION", "Un suivi clôturé ne peut pas être réouvert ici.", 409);
  if (raw.status === "resolved" && (typeof raw.note !== "string" || !raw.note.trim())) throw new ServiceError("NOTE_REQUIRED", "Documentez l'action effectuée avant de clôturer le suivi.", 422);
  if (raw.note) addNote(state, alert.patientId, { ...raw, text: raw.note, alertId: alert.id });
  const now = new Date().toISOString();
  alert.acknowledgedAt ??= now;
  alert.status = raw.status as Alert["status"];
  if (alert.status === "resolved") alert.resolvedAt ??= now;
  return { alert };
}
export function updateRules(state: State, patientId: string, raw: unknown) { const patient = patientById(state, patientId); patient.rules = validateRules(raw); return { patient }; }
export function unlinkPatient(state: State, patientId: string) {
  const patient = patientById(state, patientId);
  patient.telegramLinked = false;
  state.bindings = state.bindings.filter(b => b.patientId !== patientId);
  state.invites = state.invites.filter(i => i.patientId !== patientId);
  for (const pending of state.pending) if (pending.patientId === patientId && pending.source === "telegram" && pending.status === "pending") pending.status = "cancelled";
  state.deliveries = state.deliveries.filter(d => !state.reminders.some(r => r.id === d.reminderId && r.patientId === patientId));
  return { patient };
}
export function resetDemo(state: State) { Object.assign(state, seedState()); return { generation: state.generation }; }
export function runReminders(state: State, phase: "initial" | "follow_up" | "silence", simulate: boolean) {
  const now = new Date().toISOString();
  let sent = 0, failed = 0, alertsCreated = 0;
  for (const patient of state.patients) {
    let reminder = state.reminders.find(r => r.patientId === patient.id && !r.satisfiedAt && !r.silenceAlertAt);
    if (!reminder && phase === "initial") {
      const last = [...state.reminders].reverse().find(r => r.patientId === patient.id);
      if (last && new Date(last.dueAt).getTime() + patient.rules.overdueHours * 3600000 > Date.now()) continue;
      reminder = { id: randomUUID(), patientId: patient.id, dueAt: now, followUpAt: new Date(Date.now() + patient.rules.overdueHours * 1800000).toISOString(), silenceAt: new Date(Date.now() + patient.rules.overdueHours * 3600000).toISOString(), initialSentAt: null, followUpSentAt: null, satisfiedAt: null, silenceAlertAt: null, deliveryError: null, simulated: simulate };
      state.reminders.push(reminder);
    }
    if (!reminder || reminder.simulated !== simulate || reminder.satisfiedAt) continue;
    if (phase === "silence") {
      if (!reminder.initialSentAt || reminder.silenceAlertAt || (!simulate && reminder.silenceAt > now)) continue;
      reminder.silenceAlertAt = now;
      state.alerts.push({ id: randomUUID(), patientId: patient.id, kind: "missing_measurement", priority: "review", status: "new", readingId: null, reminderId: reminder.id, reason: "Aucune mesure confirmée reçue après le rappel. Ce statut ne décrit pas l'état de santé.", createdAt: now, acknowledgedAt: null, resolvedAt: null, rulesSnapshot: null });
      alertsCreated++;
      continue;
    }
    const field = phase === "initial" ? "initialSentAt" : "followUpSentAt";
    if (reminder[field] || (phase === "follow_up" && (!reminder.initialSentAt || (!simulate && reminder.followUpAt > now)))) continue;
    if (simulate) { reminder[field] = now; reminder.deliveryError = null; sent++; continue; }
    const binding = state.bindings.find(b => b.patientId === patient.id);
    if (!binding || !process.env.TELEGRAM_BOT_TOKEN) { reminder.deliveryError = "Telegram non configuré ou patient non lié. Aucun message envoyé."; failed++; continue; }
    const deliveryId = `${reminder.id}:${phase}`;
    if (!state.deliveries.some(d => d.id === deliveryId)) state.deliveries.push({ id: deliveryId, chatId: binding.chatId, text: patient.language === "ar" ? "تذكير تجريبي: أرسل قراءة واحدة مثل 120/80. هذه ليست خدمة طوارئ ولا توجد مراقبة مستمرة." : "Rappel démo : envoyez une mesure, par exemple 120/80. Aucun suivi continu ni réponse urgente garantis.", sentAt: null, error: null, reminderId: reminder.id, phase });
  }
  return { sent, failed, alertsCreated, simulated: simulate };
}
