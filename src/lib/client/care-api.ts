/**
 * Supervised monitoring loop (feature 006, lot B): onboarding and facts,
 * proposals and plan, action self-reports, clinician report, messages and
 * contact requests. Model-backed calls use the 45 s AI deadline; their result
 * must still pass the caller's access fence before it is shown.
 */
import type {
  ActionReportInput,
  CareAction,
  CareMessage,
  CarePlan,
  CareProposal,
  ContactInput,
  ContactRequest,
  ContactUpdate,
  Coverage,
  FactCorrection,
  FactInput,
  MedicalFact,
  MessageInput,
  MessageReview,
  OnboardingInput,
  OnboardingResponse,
  PlanResponse,
  PlanUpdate,
  ProfileBinding,
  ProposalDecision,
  ProposalEdit,
  ProposalGenerationResponse,
  ProposalReviewResult,
  ProposalStatus,
  ReportResponse,
} from "@/contracts/monitoring";
import { aiOptions, request, seg, withQuery, type RequestOptions } from "./transport";

export type {
  ActionReportInput,
  CareAction,
  CareMessage,
  CarePlan,
  CareProposal,
  ContactInput,
  ContactRequest,
  ContactUpdate,
  Coverage,
  FactCorrection,
  FactInput,
  MedicalFact,
  MessageInput,
  MessageReview,
  OnboardingInput,
  OnboardingResponse,
  PlanResponse,
  PlanUpdate,
  ProfileBinding,
  ProposalDecision,
  ProposalEdit,
  ProposalGenerationResponse,
  ProposalReviewResult,
  ProposalStatus,
  ReportResponse,
};

const patientPath = (patientId: string, sub: string) => `/patients/${seg(patientId)}/${sub}`;

// ---------------------------------------------------------------------------
// Onboarding and medical facts
// ---------------------------------------------------------------------------

/** Read-only: current facts and the next registry questions. Never mutates facts. */
export function getOnboarding(patientId: string, options?: RequestOptions): Promise<OnboardingResponse> {
  return request<OnboardingResponse>(patientPath(patientId, "onboarding"), {
    ...aiOptions(options),
    expect: ["facts", "questions", "meta"],
  });
}

export function submitOnboarding(patientId: string, input: OnboardingInput, options?: RequestOptions): Promise<OnboardingResponse> {
  return request<OnboardingResponse>(patientPath(patientId, "onboarding"), {
    ...aiOptions(options),
    method: "POST",
    json: input,
    expect: ["facts", "questions", "meta"],
  });
}

/** Owner declaration; the server marks it patient_reported, never confirmed. */
export function recordFact(patientId: string, input: FactInput, options?: RequestOptions): Promise<{ fact: MedicalFact }> {
  return request<{ fact: MedicalFact }>(patientPath(patientId, "medical-facts"), {
    ...options,
    method: "POST",
    json: input,
    expect: ["fact"],
  });
}

/** Appends a corrected version; the previous fact and its sources stay in history. */
export function correctFact(factId: string, input: FactCorrection, options?: RequestOptions): Promise<{ fact: MedicalFact }> {
  return request<{ fact: MedicalFact }>(`/medical-facts/${seg(factId)}`, {
    ...options,
    method: "PATCH",
    json: input,
    expect: ["fact"],
  });
}

// ---------------------------------------------------------------------------
// Proposals and plan
// ---------------------------------------------------------------------------

/** Patients receive ProposalStatus only; clinicians with care authority receive full drafts. */
export function listProposals(
  patientId: string,
  options?: RequestOptions,
): Promise<{ proposals: (CareProposal | ProposalStatus)[] }> {
  return request<{ proposals: (CareProposal | ProposalStatus)[] }>(patientPath(patientId, "proposals"), {
    ...options,
    expect: ["proposals"],
  });
}

export function generateProposals(
  patientId: string,
  input: { clientId: string },
  options?: RequestOptions,
): Promise<ProposalGenerationResponse> {
  return request<ProposalGenerationResponse>(patientPath(patientId, "proposals/generate"), {
    ...aiOptions(options),
    method: "POST",
    json: input,
    expect: ["proposals", "meta"],
  });
}

/** Approve once or reject one item. Approval never creates a reusable protocol. */
export function reviewProposal(proposalId: string, input: ProposalDecision, options?: RequestOptions): Promise<ProposalReviewResult> {
  return request<ProposalReviewResult>(`/proposals/${seg(proposalId)}`, {
    ...options,
    method: "PATCH",
    json: input,
    expect: ["proposal"],
  });
}

/** Edit creates a new proposal revision that still needs an explicit decision. */
export function reviseProposal(proposalId: string, input: ProposalEdit, options?: RequestOptions): Promise<{ proposal: CareProposal }> {
  return request<{ proposal: CareProposal }>(`/proposals/${seg(proposalId)}`, {
    ...options,
    method: "PATCH",
    json: input,
    expect: ["proposal"],
  });
}

export function getCarePlan(patientId: string, options?: RequestOptions): Promise<PlanResponse> {
  return request<PlanResponse>(patientPath(patientId, "care-plan"), {
    ...options,
    expect: ["plan", "actions", "evaluations", "coverage"],
  });
}

export function updateCarePlan(patientId: string, input: PlanUpdate, options?: RequestOptions): Promise<PlanResponse> {
  return request<PlanResponse>(patientPath(patientId, "care-plan"), {
    ...options,
    method: "PATCH",
    json: input,
    expect: ["plan", "actions", "evaluations", "coverage"],
  });
}

/** Patient self-report. Completion is not a clinical resolution. */
export function reportCareAction(actionId: string, input: ActionReportInput, options?: RequestOptions): Promise<{ action: CareAction }> {
  return request<{ action: CareAction }>(`/actions/${seg(actionId)}/reports`, {
    ...options,
    method: "POST",
    json: input,
    expect: ["action"],
  });
}

// ---------------------------------------------------------------------------
// Clinician report
// ---------------------------------------------------------------------------

export function generateReport(patientId: string, input: { clientId: string }, options?: RequestOptions): Promise<ReportResponse> {
  return request<ReportResponse>(patientPath(patientId, "report"), {
    ...aiOptions(options),
    method: "POST",
    json: input,
    expect: ["report", "meta"],
  });
}

// ---------------------------------------------------------------------------
// Messages and contact requests
// ---------------------------------------------------------------------------

export interface MessagePage {
  messages: CareMessage[];
  nextCursor: string | null;
}

export function listMessages(
  patientId: string,
  query: { after?: string | null; clinicianId?: string | null } = {},
  options?: RequestOptions,
): Promise<MessagePage> {
  const path = withQuery(patientPath(patientId, "messages"), { after: query.after ?? null, clinicianId: query.clinicianId ?? null });
  return request<MessagePage>(path, { ...options, expect: ["messages", "nextCursor"] });
}

export function sendMessage(patientId: string, input: MessageInput, options?: RequestOptions): Promise<{ message: CareMessage }> {
  return request<{ message: CareMessage }>(patientPath(patientId, "messages"), {
    ...options,
    method: "POST",
    json: input,
    expect: ["message"],
  });
}

/** Read receipt only: reading is neither clinical review nor action completion. */
export function markMessageRead(messageId: string, input: { clientId: string }, options?: RequestOptions): Promise<{ message: CareMessage }> {
  return request<{ message: CareMessage }>(`/messages/${seg(messageId)}/read`, {
    ...options,
    method: "POST",
    json: input,
    expect: ["message"],
  });
}

/**
 * Owner-authorized forwarding: the patient explicitly forwards one of their own
 * clinical messages (e.g. sent to a secondary doctor) to the current primary
 * clinician. Nothing else of that private thread is exposed. Primary review of
 * the forwarded copy is still separate from any protocol reauthorization.
 */
export function forwardMessage(
  messageId: string,
  input: { clinicianId: string; clientId: string },
  options?: RequestOptions,
): Promise<{ message: CareMessage }> {
  return request<{ message: CareMessage }>(`/messages/${seg(messageId)}/forward`, {
    ...options,
    method: "POST",
    json: input,
    expect: ["message"],
  });
}

/** Primary clinician marks the clinical context reviewed. Does not reactivate protocols. */
export function reviewMessage(messageId: string, input: MessageReview, options?: RequestOptions): Promise<{ message: CareMessage }> {
  return request<{ message: CareMessage }>(`/messages/${seg(messageId)}/review`, {
    ...options,
    method: "POST",
    json: input,
    expect: ["message"],
  });
}

/** GET …/contact-requests answers `{contacts}`; exposed here under the clearer `contactRequests`. */
export async function listContactRequests(patientId: string, options?: RequestOptions): Promise<{ contactRequests: ContactRequest[] }> {
  const { contacts } = await request<{ contacts: ContactRequest[] }>(patientPath(patientId, "contact-requests"), {
    ...options,
    expect: ["contacts"],
  });
  return { contactRequests: contacts };
}

/** A request to be contacted. It is never a connected call. */
export function requestContact(patientId: string, input: ContactInput, options?: RequestOptions): Promise<{ contactRequest: ContactRequest }> {
  return request<{ contactRequest: ContactRequest }>(patientPath(patientId, "contact-requests"), {
    ...options,
    method: "POST",
    json: input,
    expect: ["contactRequest"],
  });
}

export function updateContact(contactId: string, input: ContactUpdate, options?: RequestOptions): Promise<{ contactRequest: ContactRequest }> {
  return request<{ contactRequest: ContactRequest }>(`/contact-requests/${seg(contactId)}`, {
    ...options,
    method: "PATCH",
    json: input,
    expect: ["contactRequest"],
  });
}

// ---------------------------------------------------------------------------
// Pure helpers shared by patient and clinician views
// ---------------------------------------------------------------------------

/** Full drafts carry an action template; patient projections never do. */
export function isFullProposal(proposal: CareProposal | ProposalStatus): proposal is CareProposal {
  return "action" in proposal && proposal.action !== undefined;
}

/**
 * The only fields a patient view may read from a proposal. Strips anything a
 * server bug might add (names, parameters, sources, hypotheses).
 */
export function toPatientProposalStatus(proposal: CareProposal | ProposalStatus): ProposalStatus {
  return { id: proposal.id, revision: proposal.revision, kind: proposal.kind, state: proposal.state };
}

/**
 * Demonstration profiles that a clinician may bind when activating a plan.
 * Hint only: the server validates every binding against its own registry.
 */
export const DEMO_PROFILE_FOR_CONDITION: Readonly<Record<string, string>> = {
  hypertension: "demo_blood_pressure",
  diabetes: "demo_glucose",
};

export function suggestProfileBindings(
  facts: readonly MedicalFact[],
  rulesVersion: string | null,
): ProfileBinding[] {
  if (!rulesVersion) return [];
  return facts
    .filter((fact) => fact.kind === "condition" && fact.polarity === "affirmed" && !fact.supersededBy && fact.code)
    .flatMap((fact) => {
      const profileId = DEMO_PROFILE_FOR_CONDITION[fact.code ?? ""];
      return profileId ? [{ conditionFactId: fact.id, profileId, profileVersion: rulesVersion }] : [];
    });
}
