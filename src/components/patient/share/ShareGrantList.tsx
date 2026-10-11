"use client";

/**
 * Links already issued, with the server's state (pending/active/revoked/
 * expired), and revocation after confirmation. Notes from external visitors
 * are listed when the server includes them, with their declared, unverified
 * author.
 */
import { useState } from "react";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Skeleton, type BadgeTone, type IconName } from "@/components/ui";
import type { ExternalVisitGrant } from "@/contracts/external-visit";
import { runFenced, type AccessFence } from "@/lib/client/access-fence";
import { SHARE_COPY } from "@/lib/client/copy/share";
import { formatDateTime } from "@/lib/client/format";
import type { Messages } from "@/lib/client/i18n";
import { createClientId } from "@/lib/client/ids";
import { revokeExternalVisit, type OwnerVisitGrant, type OwnerVisitList } from "@/lib/client/share-api";
import { describeApiError, toApiError, type ApiError, type Language } from "@/lib/client/transport";
import { ExternalNoteItem } from "@/components/guest/ExternalNoteItem";
import { ApiErrorNotice } from "./ApiErrorNotice";
import { canRevokeGrant } from "./share-selection";
import { invalidatesList, type FencedResource } from "./use-fenced-resource";
import styles from "../patient.module.css";
import share from "./share.module.css";

const STATE_BADGE: Record<ExternalVisitGrant["state"], { tone: BadgeTone; icon: IconName }> = {
  pending: { tone: "outline", icon: "clock" },
  active: { tone: "accent", icon: "eye" },
  revoked: { tone: "muted", icon: "x" },
  expired: { tone: "muted", icon: "clock" },
};

function replaceGrant(list: OwnerVisitList, grant: OwnerVisitGrant): OwnerVisitList {
  return { ...list, grants: list.grants.map((g) => (g.id === grant.id ? grant : g)) };
}

const newestFirst = (a: { createdAt: string }, b: { createdAt: string }) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

function GrantRow({ grant, lang, live, onRevoke }: { grant: OwnerVisitGrant; lang: Language; live: boolean; onRevoke: () => void }) {
  const copy = SHARE_COPY[lang].share;
  const badge = STATE_BADGE[grant.state];
  return (
    <li className={share.grant}>
      <div className={share.grantText}>
        <div className={share.grantHead}>
          <Badge tone={badge.tone} icon={badge.icon}>
            {copy.state[grant.state]}
          </Badge>
          <span className={styles.metaLine}>{copy.itemsCount(grant.selection.length)}</span>
        </div>
        <p className={styles.metaLine}>{copy.createdAt(formatDateTime(grant.createdAt, lang))}</p>
        {grant.state === "pending" ? <p className={styles.metaLine}>{copy.redeemBy(formatDateTime(grant.redeemBy, lang))}</p> : null}
      </div>
      {canRevokeGrant(grant) ? (
        <Button variant="ghost" iconStart="x" disabled={!live} onClick={onRevoke}>
          {copy.revoke}
        </Button>
      ) : null}
    </li>
  );
}

interface RevokeDialogProps {
  target: OwnerVisitGrant | null;
  fence: AccessFence;
  lang: Language;
  t: Messages;
  onClose: () => void;
  onRevoked: (grant: OwnerVisitGrant) => void;
  /** 409 or access refused: the list is reloaded before any new attempt. */
  onRefused: () => void;
}

function RevokeGrantDialog({ target, fence, lang, t, onClose, onRevoked, onRefused }: RevokeDialogProps) {
  const copy = SHARE_COPY[lang].share;
  // One key per (grant, revision): a retry reuses it, a reloaded revision gets a new one.
  const [key, setKey] = useState<{ target: string; clientId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);

  const close = () => {
    setFailure(null);
    setKey(null);
    onClose();
  };

  const confirm = async () => {
    if (!target || busy) return;
    const targetKey = `${target.id}:${target.revision}`;
    const current = key?.target === targetKey ? key : { target: targetKey, clientId: createClientId("share-revoke") };
    setKey(current);
    setBusy(true);
    setFailure(null);
    try {
      const result = await runFenced(fence, () => revokeExternalVisit(target.id, { expectedRevision: target.revision, clientId: current.clientId }));
      if (result.status === "current") {
        setKey(null);
        onRevoked(result.value.grant);
      } else {
        close();
      }
    } catch (caught) {
      const error = toApiError(caught);
      setFailure(error);
      if (invalidatesList(error)) {
        setKey(null);
        onRefused();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={target !== null}
      onClose={close}
      title={copy.revokeTitle}
      description={copy.revokeBody}
      closeLabel={t.common.close}
      size="sm"
      footer={
        <div className={styles.dialogActions}>
          <Button variant="ghost" onClick={close} disabled={busy}>
            {t.common.cancel}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>
            {busy ? copy.revoking : copy.revokeConfirm}
          </Button>
        </div>
      }
    >
      {failure ? <ApiErrorNotice error={failure} lang={lang} /> : null}
    </Dialog>
  );
}

function NotesCard({ list, lang }: { list: OwnerVisitList; lang: Language }) {
  const copy = SHARE_COPY[lang].share;
  if (!list.notes) return null;
  const notes = [...list.notes].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  return (
    <Card id="share-notes" title={copy.notesTitle}>
      {notes.length === 0 ? (
        <EmptyState compact icon="message" title={copy.notesEmpty} />
      ) : (
        <div className={share.notes}>
          {notes.map((note) => (
            <ExternalNoteItem key={note.id} note={note} lang={lang} unverifiedLabel={copy.noteUnverified} />
          ))}
        </div>
      )}
    </Card>
  );
}

interface ShareGrantListProps {
  fence: AccessFence;
  live: boolean;
  resource: FencedResource<OwnerVisitList>;
  lang: Language;
  t: Messages;
}

export function ShareGrantList({ fence, live, resource, lang, t }: ShareGrantListProps) {
  const copy = SHARE_COPY[lang].share;
  const [target, setTarget] = useState<OwnerVisitGrant | null>(null);
  const { state, reload, update } = resource;

  const body = () => {
    if (state.status === "loading") return live ? <Skeleton lines={3} /> : <p className={styles.metaLine}>{copy.offline}</p>;
    if (state.status === "error") {
      const description = describeApiError(state.error, lang);
      return <ErrorState compact title={description.title} message={description.message} code={description.code} onRetry={reload} retryLabel={t.common.retry} />;
    }
    if (state.value.grants.length === 0) return <EmptyState compact icon="link" title={copy.listEmpty} />;
    return (
      <ul className={share.grantList}>
        {[...state.value.grants].sort(newestFirst).map((grant) => (
          <GrantRow key={grant.id} grant={grant} lang={lang} live={live} onRevoke={() => setTarget(grant)} />
        ))}
      </ul>
    );
  };

  return (
    <>
      <Card id="share-grants" title={copy.listTitle}>
        {body()}
      </Card>
      {state.status === "ready" ? <NotesCard list={state.value} lang={lang} /> : null}
      <RevokeGrantDialog
        target={target}
        fence={fence}
        lang={lang}
        t={t}
        onClose={() => setTarget(null)}
        onRefused={reload}
        onRevoked={(grant) => {
          update((list) => replaceGrant(list, grant));
          setTarget(null);
          reload();
        }}
      />
    </>
  );
}
