/**
 * Pure rendering decisions for the patient assistant (feature 006, story 4).
 *
 * The reply kind decides everything; nothing here composes medical text. The
 * server `answer` is shown as plain text, approved actions only for an
 * `approved_action` reply, and "recorded as a message" only when the server
 * returned a real message id.
 */
import type { AiFailure, AiMeta, AssistantInput, AssistantResponse, CareAction, SourceRef } from "@/contracts/monitoring";
import { ASSIST_COPY } from "@/lib/client/copy/assist";
import { CARE_COPY } from "@/lib/client/copy/care";
import type { Language } from "@/lib/client/transport";

export const QUESTION_MAX = 2000;

export type QuestionError = "emptyQuestion" | "tooLong";

export function validateQuestion(text: string): QuestionError | null {
  const trimmed = text.trim();
  if (!trimmed) return "emptyQuestion";
  return trimmed.length > QUESTION_MAX ? "tooLong" : null;
}

/** Fixed ASSIST_COPY.assistant notes a reply may carry. */
export type ReplyNote = "messageRecorded" | "noRecipientPending" | "unavailableBody";

export interface ReplyView {
  kind: AssistantResponse["replyKind"];
  /** Server text, rendered as plain text; null when there is none to show. */
  answer: string | null;
  actions: CareAction[];
  sources: SourceRef[];
  note: ReplyNote | null;
  mode: AiMeta["mode"];
  failure: AiFailure | null;
  /** An approved action's live check says its approval no longer holds. */
  lapsed: boolean;
}

const KNOWN_KINDS: ReadonlySet<string> = new Set(["record_answer", "approved_action", "needs_clinician", "unavailable"]);

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function replyView(response: AssistantResponse, inputKind: AssistantInput["kind"]): ReplyView {
  const base = { mode: response.meta.mode, failure: response.meta.failureReason, lapsed: false };
  const answer = textOrNull(response.answer);

  if (!KNOWN_KINDS.has(response.replyKind)) {
    // Unknown shape: show nothing from it, only the fixed fallback.
    return { ...base, kind: "unavailable", answer: null, actions: [], sources: [], note: "unavailableBody" };
  }
  switch (response.replyKind) {
    case "record_answer":
      return { ...base, kind: "record_answer", answer, actions: [], sources: response.sources, note: null };
    case "approved_action": {
      const lapsed = response.approvedActions.some((action) => action.approval?.currentlyApproved === false);
      return { ...base, kind: "approved_action", answer, actions: response.approvedActions, sources: response.sources, note: null, lapsed };
    }
    case "needs_clinician": {
      const note: ReplyNote | null =
        response.messageId !== null ? "messageRecorded" : inputKind === "record_query" ? null : "noRecipientPending";
      return { ...base, kind: "needs_clinician", answer, actions: [], sources: response.sources, note };
    }
    default:
      return { ...base, kind: "unavailable", answer, actions: [], sources: [], note: answer ? null : "unavailableBody" };
  }
}

export interface ReplyProvenance {
  /** Label of the mode the server reported (local, remote/cloud or fixed rules); null for an unknown mode. */
  modeLabel: string | null;
  /** On a model failure: the deterministic fallback with its reason. */
  fallbackLine: string | null;
}

/**
 * Where the reply came from, exactly as the server's `meta` says: a cloud
 * reply is labelled as a remote external model, never as local, and nothing
 * here claims clinical validation. An unknown mode gets no guessed label.
 */
export function replyProvenance(view: Pick<ReplyView, "mode" | "failure">, lang: Language): ReplyProvenance {
  const care = CARE_COPY[lang];
  const modes = care.aiMode as Record<string, string>;
  return {
    modeLabel: Object.hasOwn(modes, view.mode) ? modes[view.mode] : null,
    fallbackLine: view.failure ? `${care.aiMode.deterministic} · ${care.aiFailure[view.failure]}` : null,
  };
}

/** Reply heading; a lapsed approval is never titled "Consigne déjà validée". */
export function replyTitle(view: Pick<ReplyView, "kind" | "lapsed">, lang: Language): string {
  return view.lapsed ? CARE_COPY[lang].plan.approvalLapsed : ASSIST_COPY[lang].assistant.replyKind[view.kind];
}
