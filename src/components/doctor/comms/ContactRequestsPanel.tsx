"use client";

import { useCallback, useRef, useState } from "react";
import { Badge, Button, Card, EmptyState, Notice, Skeleton, Timestamp, type BadgeTone, type IconName } from "@/components/ui";
import { runFenced, type AccessFence } from "@/lib/client/access-fence";
import { listContactRequests, updateContact, type ContactRequest, type ContactUpdate } from "@/lib/client/care-api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { createClientId } from "@/lib/client/ids";
import { toApiError } from "@/lib/client/transport";
import { usePolling } from "@/lib/client/use-polling";
import { ApiErrorState, errorText } from "../shared/ApiErrorState";
import { STALE_ANSWER, contactActions } from "./message-state";
import { ReasonDialog } from "./ReasonDialog";
import { fenceFetcher } from "./use-message-thread";
import styles from "./Comms.module.css";

const copy = CARE_COPY.fr;
const CONTACT_POLL_MS = 10_000;

type Action = ContactUpdate["action"];

const STATE_BADGE: Record<ContactRequest["state"], { tone: BadgeTone; icon: IconName }> = {
  requested: { tone: "outline", icon: "clock" },
  acknowledged: { tone: "neutral", icon: "eye" },
  contact_reported: { tone: "accent", icon: "check" },
  cancelled: { tone: "muted", icon: "x" },
};

const ACTION: Record<Action, { label: string; icon: IconName; title: string; description: string; done: string }> = {
  acknowledge: {
    label: "Accuser réception",
    icon: "eye",
    title: "Accuser réception de la demande",
    description: "Le patient verra que vous avez vu sa demande. Ce n’est ni un appel ni la résolution d’une alerte.",
    done: "Réception accusée.",
  },
  contact_reported: {
    label: "Déclarer un contact",
    icon: "check",
    title: "Déclarer un contact avec le patient",
    description:
      "Déclaration attribuée à votre nom : un contact a eu lieu hors de l’application. L’application n’établit aucun appel et ne vérifie pas cette déclaration.",
    done: "Contact déclaré (déclaration attribuée, pas un appel établi par l’application).",
  },
  cancel: {
    label: "Annuler la demande",
    icon: "x-circle",
    title: "Annuler la demande de contact",
    description: "La demande est close sans contact déclaré. L’historique reste consultable.",
    done: "Demande annulée.",
  },
};

const HISTORY_ACTION: Record<string, string> = {
  request: "Demande créée",
  requested: "Demande créée",
  acknowledge: "Réception accusée",
  contact_reported: "Contact déclaré",
  cancel: "Demande annulée",
};

interface ContactRequestsPanelProps {
  patientId: string;
  actorId: string;
  fence: AccessFence;
  onDenied: () => void;
}

function ContactItem({ request, actorId, onAction }: { request: ContactRequest; actorId: string; onAction: (action: Action) => void }) {
  const badge = STATE_BADGE[request.state];
  return (
    <li className={styles.contact}>
      <div className={styles.badges}>
        <Badge tone={badge.tone} icon={badge.icon}>
          {copy.contactState[request.state]}
        </Badge>
        <Timestamp iso={request.createdAt} label="Demandée" />
      </div>
      {request.history.length > 0 ? (
        <ul className={styles.history}>
          {request.history.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              {/* History carries no author category: only "you" can be attributed with certainty. */}
              {HISTORY_ACTION[entry.action] ?? entry.action} {entry.authorId === actorId ? "par vous" : "par un autre participant"},{" "}
              <Timestamp iso={entry.at} format="relative" />
              {entry.reason ? ` — ${entry.reason}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {contactActions(request.state).length > 0 ? (
        <div className={styles.actions}>
          {contactActions(request.state).map((action) => (
            <Button key={action} size="sm" variant="secondary" iconStart={ACTION[action].icon} onClick={() => onAction(action)}>
              {ACTION[action].label}
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/** Contact requests addressed to this clinician. A request is never a call. */
export function ContactRequestsPanel({ patientId, actorId, fence, onDenied }: ContactRequestsPanelProps) {
  const fetcher = useCallback(
    (signal: AbortSignal) => fenceFetcher(fence, (s) => listContactRequests(patientId, { signal: s }))(signal),
    [fence, patientId],
  );
  const poll = usePolling(`doctor-contacts:${actorId}:${patientId}`, fetcher, { intervalMs: CONTACT_POLL_MS, onDenied });
  const [target, setTarget] = useState<{ request: ContactRequest; action: Action } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const attemptRef = useRef<{ key: string; clientId: string } | null>(null);

  const close = () => {
    setTarget(null);
    setFailure(null);
  };

  const submit = async (reason: string) => {
    if (!target) return;
    const { request, action } = target;
    const key = `${request.id}:${request.revision}:${action}:${reason}`;
    const clientId = attemptRef.current?.key === key ? attemptRef.current.clientId : createClientId("contact");
    attemptRef.current = { key, clientId };
    setSubmitting(true);
    setFailure(null);
    try {
      const result = await runFenced(fence, () => updateContact(request.id, { action, expectedRevision: request.revision, reason, clientId }));
      if (result.status === "stale") {
        setFailure(STALE_ANSWER);
        return;
      }
      const updated = result.value.contactRequest;
      poll.mutate((current) =>
        current ? { contactRequests: current.contactRequests.map((item) => (item.id === updated.id ? updated : item)) } : current,
      );
      void poll.refresh();
      attemptRef.current = null;
      setDone(ACTION[action].done);
      close();
    } catch (caught) {
      const apiError = toApiError(caught);
      if (apiError.isConflict) attemptRef.current = null;
      setFailure(apiError.isConflict ? "Cette demande a changé entre-temps. Fermez, vérifiez son état actuel puis réessayez." : errorText(apiError));
    } finally {
      setSubmitting(false);
    }
  };

  // Only this patient and this clinician (also drops a previous context's payload during a key change).
  const requests = (poll.data?.contactRequests ?? []).filter(
    (request) => request.clinicianId === actorId && request.patientId === patientId,
  );

  let body;
  if (poll.status === "loading") body = <Skeleton lines={3} />;
  else if (!poll.data) {
    const missing = toApiError(poll.error).status === 404;
    body = missing ? (
      <Notice tone="neutral" icon="info" title="Liste des demandes indisponible">
        Le serveur ne fournit pas encore la liste des demandes de contact pour ce dossier. Rien n’est affiché à sa place.
      </Notice>
    ) : (
      <ApiErrorState error={poll.error} onRetry={() => void poll.refresh()} compact />
    );
  } else if (requests.length === 0) {
    body = <EmptyState compact icon="inbox" title="Aucune demande de contact" description="Le patient ne vous a adressé aucune demande." />;
  } else {
    body = (
      <ul className={styles.contacts}>
        {requests.map((request) => (
          <ContactItem key={request.id} request={request} actorId={actorId} onAction={(action) => setTarget({ request, action })} />
        ))}
      </ul>
    );
  }

  return (
    <Card
      title="Demandes de contact"
      description="Une demande n’est jamais un appel. « Contact déclaré » est une déclaration attribuée, sans transport audio ou vidéo."
    >
      <div className={styles.stack} aria-busy={poll.status === "loading" || undefined}>
        {body}
        {done ? <Notice tone="success">{done}</Notice> : null}
      </div>
      <ReasonDialog
        key={target ? `${target.request.id}:${target.action}` : "none"}
        open={target !== null}
        title={target ? ACTION[target.action].title : ""}
        description={target ? ACTION[target.action].description : ""}
        confirmLabel={target ? ACTION[target.action].label : ""}
        submitting={submitting}
        failure={failure}
        onClose={close}
        onSubmit={(reason) => void submit(reason)}
      />
    </Card>
  );
}
