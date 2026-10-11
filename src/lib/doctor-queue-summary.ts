import type { Actor } from "../contracts/care";
import type { DoctorQueueSummary, QueueBucket } from "../contracts/patient-platform";
import type { ProtocolApplication } from "../contracts/monitoring";
import type { CareState } from "./care-store";
import { fail } from "./monitoring-utils";
import { hasScope, resolvePatientAccess } from "./patient-access-service";

function validDate(value: string | null): string | null {
  if (value === null) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

function oldest(dates: (string | null)[]): string | null {
  const valid = dates.flatMap(date => { const at = validDate(date); return at ? [at] : []; });
  return valid.sort()[0] ?? null;
}

function bucket(items: { createdAt: string }[]): QueueBucket {
  return { count: items.length, oldestAt: oldest(items.map(item => item.createdAt)) };
}

/** Projection of waiting work only. Counts confer no clinical or mutation authority. */
export function projectDoctorQueueSummary(state: CareState, actor: Actor, patientId: string, now = new Date().toISOString()): DoctorQueueSummary {
  if (actor.role !== "clinician") fail("FORBIDDEN", "Accès médecin requis.", 403);
  const access = resolvePatientAccess(state, actor, patientId);
  const at = Date.parse(now);
  if (!Number.isFinite(at)) fail("INVALID_TIME");

  // Conversations stay private to their named recipient, including for the primary.
  const clinicalMessages = hasScope(access, "messages") ? bucket(state.messages.filter(message =>
    message.patientId === patientId && message.clinicianId === actor.id &&
    message.authorCategory === "patient" && message.kind === "clinical" && !message.review)) : null;
  const contactRequests = hasScope(access, "messages") ? bucket(state.contactRequests.filter(request =>
    request.patientId === patientId && request.clinicianId === actor.id &&
    (request.state === "requested" || request.state === "acknowledged"))) : null;

  const clinical = hasScope(access, "clinical");
  const openProposals = clinical ? state.careProposals.filter(proposal => proposal.patientId === patientId &&
    ["pending", "needs_review", "needs_inputs"].includes(proposal.state)) : [];
  const proposals = clinical ? {
    awaitingReview: openProposals.filter(proposal => proposal.state === "pending" || proposal.state === "needs_review").length,
    needsInputs: openProposals.filter(proposal => proposal.state === "needs_inputs").length,
    oldestAt: oldest(openProposals.flatMap(proposal => proposal.history.map(entry => entry.at))),
  } : null;

  const plan = clinical ? state.carePlans.find(plan => plan.patientId === patientId) : undefined;
  const deadline = validDate(plan?.reviewDeadline ?? null);
  // A delivered overdue notification is not a clinician's review or a new deadline.
  const planReview = clinical ? { overdue: deadline !== null && Date.parse(deadline) <= at, dueAt: deadline } : null;

  let blockedProtocols: QueueBucket | null = null;
  if (hasScope(access, "summary")) {
    const currentPolicies = new Map(state.protocols.filter(protocol =>
      protocol.patientId === patientId && protocol.state !== "revoked").map(protocol => [protocol.id, protocol]));
    const latest = new Map<string, ProtocolApplication>();
    for (const attempt of state.protocolApplications) {
      const policy = currentPolicies.get(attempt.protocolId);
      if (attempt.patientId !== patientId || !policy || attempt.protocolVersion !== policy.revision) continue;
      const previous = latest.get(attempt.protocolId);
      const time = Date.parse(attempt.createdAt), previousTime = previous ? Date.parse(previous.createdAt) : NaN;
      // Later stored attempts win a timestamp tie. Invalid dates are never used as an age.
      if (!previous || (Number.isFinite(time) ? time : -Infinity) >= (Number.isFinite(previousTime) ? previousTime : -Infinity)) latest.set(attempt.protocolId, attempt);
    }
    blockedProtocols = bucket([...latest.values()].filter(attempt => attempt.state === "blocked"));
  }

  return { clinicalMessages, contactRequests, proposals, planReview, blockedProtocols,
    oldestPendingAt: oldest([clinicalMessages?.oldestAt ?? null, contactRequests?.oldestAt ?? null,
      proposals?.oldestAt ?? null, planReview?.overdue ? planReview.dueAt : null, blockedProtocols?.oldestAt ?? null]) };
}
