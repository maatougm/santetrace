/**
 * How a real ESP32 would send readings: the exact ingest route and credential
 * header the server reads, TLS verification kept on, nothing secret in a URL.
 * Honest by construction: the Contour BLE profile is unverified, the hardware
 * is absent, and nothing here says a device is connected. Shows a placeholder,
 * never the credential.
 */
import { Notice } from "@/components/ui";
import { SHARE_COPY } from "@/lib/client/copy/share";
import type { Language } from "@/lib/client/transport";
import { CREDENTIAL_HEADER_LINE, EXAMPLE_EVENT_JSON, INGEST_REQUEST_LINE, INSECURE_TLS_CALL } from "./device-setup";
import dev from "./devices.module.css";
import styles from "../patient.module.css";

function Code({ children }: { children: string }) {
  return (
    <code className={dev.inlineCode} dir="ltr" translate="no">
      {children}
    </code>
  );
}

export function DeviceSetupGuide({ lang, headingId }: { lang: Language; headingId: string }) {
  const copy = SHARE_COPY[lang].devices;
  return (
    <section className={dev.guide} aria-labelledby={headingId}>
      <h3 id={headingId} className={dev.guideTitle}>
        {copy.setupTitle}
      </h3>
      <Notice tone="neutral" icon="help-circle" role="note">
        {copy.setupStatus}
      </Notice>
      <ol className={dev.steps}>
        <li>
          <span>{copy.setupStepEndpoint}</span> <Code>{INGEST_REQUEST_LINE}</Code>
        </li>
        <li>
          <span>{copy.setupStepHeader}</span> <Code>{CREDENTIAL_HEADER_LINE}</Code>
        </li>
        <li>
          <span>{copy.setupStepBody}</span>
          <pre className={dev.codeBlock} dir="ltr" translate="no">
            {EXAMPLE_EVENT_JSON}
          </pre>
        </li>
        <li>
          <span>{copy.setupStepTls}</span> <Code>{INSECURE_TLS_CALL}</Code>
        </li>
        <li>{copy.setupStepUrl}</li>
      </ol>
      <p className={styles.metaLine}>{copy.setupHonest}</p>
    </section>
  );
}
