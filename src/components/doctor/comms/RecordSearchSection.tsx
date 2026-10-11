"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Badge, Button, Card, Field, Notice, TextInput, describedBy } from "@/components/ui";
import { runFenced } from "@/lib/client/access-fence";
import { SHARE_COPY } from "@/lib/client/copy/share";
import { createClientId } from "@/lib/client/ids";
import { SEARCH_QUERY_MAX, searchRecord, type SearchResponse } from "@/lib/client/search-api";
import { toApiError, type ApiError } from "@/lib/client/transport";
import type { DoctorSectionProps } from "../PatientAccessScope";
import { ApiErrorState } from "../shared/ApiErrorState";
import { normalizeSearchQuery, partitionHits, type QueryProblem } from "./search-results";
import { SearchHitList } from "./SearchHitList";
import styles from "./Comms.module.css";

const copy = SHARE_COPY.fr.search;

const PROBLEM_TEXT: Record<QueryProblem, string> = {
  empty: copy.emptyQuery,
  too_long: `Question trop longue (${SEARCH_QUERY_MAX} caractères au plus).`,
};

type SearchState =
  | { status: "idle" }
  | { status: "searching"; query: string }
  | { status: "done"; query: string; response: SearchResponse }
  | { status: "failed"; query: string; error: ApiError };

function ResultView({ state, patientId }: { state: SearchState; patientId: string }) {
  if (state.status === "failed") return <ApiErrorState error={state.error} compact />;
  if (state.status !== "done") return null;
  const { response, query } = state;
  const { patient, reference } = partitionHits(response.hits);
  const empty = response.noEvidence || response.hits.length === 0;
  return (
    <div className={styles.stack}>
      <div className={styles.resultHead}>
        <p className={styles.subTitle}>Résultats pour « {query} »</p>
        <Badge tone={response.mode === "semantic" ? "neutral" : "outline"} icon="search">
          {copy.mode[response.mode]}
        </Badge>
      </div>
      {empty ? (
        <Notice tone="neutral" icon="help-circle" title={copy.noEvidence}>
          L’absence de résultat n’est pas une absence de maladie, de symptôme ou de traitement : elle signifie seulement
          qu’aucune source autorisée ne répond à cette question.
        </Notice>
      ) : (
        <SearchHitList patientId={patientId} patientHits={patient} referenceHits={reference} />
      )}
    </div>
  );
}

/** Short live announcement; the result list itself is not a live region. */
function announcement(state: SearchState): string {
  if (state.status === "searching") return copy.searching;
  if (state.status !== "done") return "";
  const count = state.response.hits.length;
  if (state.response.noEvidence || count === 0) return copy.noEvidence;
  return count === 1 ? "1 résultat." : `${count} résultats.`;
}

/** Search in the sources this clinician may read, plus an identified reference library. */
export function RecordSearchSection({ patientId, fence, refresh }: DoctorSectionProps) {
  const inputId = useId();
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);
  const attemptRef = useRef<{ query: string; clientId: string } | null>(null);

  useEffect(() => {
    // Access changed or ended, or another actor/patient context: drop the query
    // in flight, every displayed hit and the retry key (a replay must not
    // return an answer computed under the previous authority).
    const reset = () => {
      sequenceRef.current += 1;
      controllerRef.current?.abort();
      attemptRef.current = null;
      setState({ status: "idle" });
    };
    const unsubscribe = fence.subscribe(reset);
    return () => {
      unsubscribe();
      reset();
    };
  }, [fence]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { query, error } = normalizeSearchQuery(text);
    setFieldError(error ? PROBLEM_TEXT[error] : null);
    if (error) {
      document.getElementById(inputId)?.focus();
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const sequence = ++sequenceRef.current;
    const clientId = attemptRef.current?.query === query ? attemptRef.current.clientId : createClientId("search");
    attemptRef.current = { query, clientId };
    setState({ status: "searching", query });
    try {
      const result = await runFenced(fence, () => searchRecord(patientId, { query, clientId }, { signal: controller.signal }));
      if (sequence !== sequenceRef.current) return;
      attemptRef.current = null;
      setState(result.status === "current" ? { status: "done", query, response: result.value } : { status: "idle" });
    } catch (caught) {
      if (sequence !== sequenceRef.current) return;
      const apiError = toApiError(caught);
      if (apiError.isAborted) {
        setState({ status: "idle" });
        return;
      }
      setState({ status: "failed", query, error: apiError });
      if (apiError.isAccessDenied) refresh();
    }
  };

  const searching = state.status === "searching";
  const hint = `${copy.queryHint} Les résultats restent des extraits sourcés : vérifiez la source avant toute décision.`;

  return (
    <Card title={copy.title} description={copy.description}>
      <div className={styles.stack}>
        <form className={styles.searchForm} onSubmit={(event) => void submit(event)} noValidate role="search">
          <Field label={copy.queryLabel} htmlFor={inputId} hint={hint} error={fieldError} required>
            <TextInput
              id={inputId}
              type="search"
              value={text}
              maxLength={SEARCH_QUERY_MAX}
              autoComplete="off"
              invalid={Boolean(fieldError)}
              aria-describedby={describedBy(inputId, { hint, error: fieldError })}
              onChange={(event) => {
                setText(event.target.value);
                if (fieldError) setFieldError(null);
              }}
            />
          </Field>
          <div className={styles.searchSubmit}>
            <Button type="submit" variant="primary" iconStart="search" loading={searching}>
              {searching ? copy.searching : copy.submit}
            </Button>
          </div>
        </form>
        <p role="status" className={styles.srOnly}>
          {announcement(state)}
        </p>
        <div aria-busy={searching || undefined}>
          <ResultView state={state} patientId={patientId} />
        </div>
      </div>
    </Card>
  );
}
