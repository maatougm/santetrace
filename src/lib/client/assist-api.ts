/**
 * Approved advice and bounded reuse (feature 006, lot C): assistant, reusable
 * protocols and their application log. The server alone decides authority and
 * eligibility; this client never computes a similarity score or eligibility.
 */
import type {
  AssistantInput,
  AssistantResponse,
  ProtocolApplication,
  ProtocolAuthorization,
  ProtocolPredicate,
  ProtocolReviewInput,
  ProtocolStateInput,
  ReusableProtocol,
} from "@/contracts/monitoring";
import { aiOptions, request, seg, type RequestOptions } from "./transport";

export type {
  AssistantInput,
  AssistantResponse,
  ProtocolApplication,
  ProtocolAuthorization,
  ProtocolPredicate,
  ProtocolReviewInput,
  ProtocolStateInput,
  ReusableProtocol,
};

const patientPath = (patientId: string, sub: string) => `/patients/${seg(patientId)}/${sub}`;

/** Fixed record queries or a free question. Free medical text becomes a message only with an accepted recipient. */
export function askAssistant(patientId: string, input: AssistantInput, options?: RequestOptions): Promise<AssistantResponse> {
  return request<AssistantResponse>(patientPath(patientId, "assistant"), {
    ...aiOptions(options),
    method: "POST",
    json: input,
    expect: ["replyKind", "answer", "approvedActions", "sources", "messageId", "meta"],
  });
}

export function listProtocols(patientId: string, options?: RequestOptions): Promise<{ protocols: ReusableProtocol[] }> {
  return request<{ protocols: ReusableProtocol[] }>(patientPath(patientId, "protocols"), { ...options, expect: ["protocols"] });
}

/** Explicit reusable authorization by the primary clinician. Separate from approving a proposal once. */
export function createProtocol(patientId: string, input: ProtocolAuthorization, options?: RequestOptions): Promise<{ protocol: ReusableProtocol }> {
  return request<{ protocol: ReusableProtocol }>(patientPath(patientId, "protocols"), {
    ...options,
    method: "POST",
    json: input,
    expect: ["protocol"],
  });
}

/** Explicit review creating an immutable new version bound to the current context. */
export function reviseProtocol(protocolId: string, input: ProtocolReviewInput, options?: RequestOptions): Promise<{ protocol: ReusableProtocol }> {
  return request<{ protocol: ReusableProtocol }>(`/protocols/${seg(protocolId)}`, {
    ...options,
    method: "PATCH",
    json: { action: "revise", ...input },
    expect: ["protocol"],
  });
}

export function setProtocolState(protocolId: string, input: ProtocolStateInput, options?: RequestOptions): Promise<{ protocol: ReusableProtocol }> {
  return request<{ protocol: ReusableProtocol }>(`/protocols/${seg(protocolId)}`, {
    ...options,
    method: "PATCH",
    json: input,
    expect: ["protocol"],
  });
}

export function listProtocolApplications(patientId: string, options?: RequestOptions): Promise<{ applications: ProtocolApplication[] }> {
  return request<{ applications: ProtocolApplication[] }>(patientPath(patientId, "protocol-applications"), {
    ...options,
    expect: ["applications"],
  });
}

/**
 * Form bounds for the protocol dialog (input sanity, not clinical defaults).
 * Server validation: minIntervalSeconds 60..604800, maxApplications 1..100,
 * validUntil at most 30 days ahead. The UI stays at or inside those bounds.
 */
export const PROTOCOL_FORM_LIMITS = {
  maxApplicationsMin: 1,
  maxApplicationsMax: 20,
  minIntervalHoursMin: 1,
  /** 7 days = 604800 s, the server maximum. */
  minIntervalHoursMax: 24 * 7,
  validityDaysMax: 30,
  reasonMax: 500,
} as const;
