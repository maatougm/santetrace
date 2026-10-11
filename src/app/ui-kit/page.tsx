"use client";

/*
 * Internal UI kit preview for screenshot self-review. Shows every shared
 * component with obvious placeholders only ("000", "Exemple") — never values
 * that could be mistaken for patient data.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  Badge,
  Button,
  Card,
  CARE_STATUS_LABELS_AR,
  Checkbox,
  DataTable,
  DEMO_LABEL_AR,
  DemoLabel,
  describedBy,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  KeyValueList,
  LinkButton,
  Notice,
  PageHeader,
  PriorityBadge,
  Select,
  SegmentedControl,
  Skeleton,
  Spinner,
  Stat,
  StatusBadge,
  tabPanelProps,
  Tabs,
  TextArea,
  TextInput,
  Timestamp,
  type CareStatus,
  type IconName,
  type TableColumn,
} from "@/components/ui";

type Direction = "ltr" | "rtl";
type TabId = "a" | "b" | "c";

interface ExampleRow {
  id: string;
  name: string;
  value: string;
  status: CareStatus;
  priority?: "orange" | "red";
}

const PAGE: CSSProperties = { maxWidth: "var(--content-max)", margin: "0 auto", padding: "var(--space-6) var(--space-4) var(--space-16)" };
const STACK: CSSProperties = { display: "flex", flexDirection: "column", gap: "var(--space-6)" };
const ROW: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-3)" };
const GRID: CSSProperties = { display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))" };
const SWATCH: CSSProperties = { width: "100%", height: "2.5rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-line)" };
const CAPTION: CSSProperties = { fontSize: "var(--text-xs)", color: "var(--color-ink-3)" };

const SWATCHES: ReadonlyArray<readonly [string, string]> = [
  ["--color-bg", "Fond"],
  ["--color-surface", "Surface"],
  ["--color-ink", "Encre"],
  ["--color-accent", "Accent"],
  ["--color-accent-soft", "Accent doux"],
  ["--color-rail", "Rail"],
  ["--color-status-green", "Statut vert"],
  ["--color-status-orange-mark", "Priorité orange"],
  ["--color-status-red-mark", "Priorité rouge"],
  ["--color-status-unknown", "Inconnu"],
  ["--color-info", "Info"],
];

const ICONS: IconName[] = [
  "activity", "alert-triangle", "arrow-left", "arrow-right", "bell", "calendar", "check", "check-circle",
  "chevron-down", "chevron-left", "chevron-right", "clipboard", "clock", "cloud-off", "copy", "download",
  "droplet", "edit", "external-link", "eye", "file-text", "heart-pulse", "help-circle", "home", "inbox",
  "info", "languages", "lock", "log-out", "minus", "pill", "plus", "refresh", "send", "shield", "sliders",
  "stethoscope", "upload", "user", "user-plus", "users", "wifi", "wifi-off", "x", "x-circle",
];

const ROWS: ExampleRow[] = [
  { id: "1", name: "Exemple A", value: "000/00", status: "red", priority: "red" },
  { id: "2", name: "Exemple B", value: "000/00", status: "orange", priority: "orange" },
  { id: "3", name: "Exemple C", value: "0,0", status: "green" },
  { id: "4", name: "Exemple D", value: "—", status: "unknown" },
];

const COLUMNS: TableColumn<ExampleRow>[] = [
  { key: "name", header: "Patient (exemple)", render: (row) => <strong>{row.name}</strong> },
  { key: "status", header: "Statut", render: (row) => <StatusBadge status={row.status} size="sm" /> },
  { key: "value", header: "Valeur (unité)", numeric: true, render: (row) => row.value },
  { key: "when", header: "Reçu", render: () => <Timestamp iso={null} /> },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title} as="section">
      <div style={STACK}>{children}</div>
    </Card>
  );
}

function useDocumentDirection(direction: Direction) {
  useEffect(() => {
    const root = document.documentElement;
    const previous = { dir: root.dir, lang: root.lang };
    root.dir = direction;
    root.lang = direction === "rtl" ? "ar" : "fr";
    return () => {
      root.dir = previous.dir;
      root.lang = previous.lang;
    };
  }, [direction]);
}

export default function UiKitPage() {
  const [direction, setDirection] = useState<Direction>("ltr");
  const [unit, setUnit] = useState<"mmol" | "mg">("mmol");
  const [tab, setTab] = useState<TabId>("a");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [lastClicked, setLastClicked] = useState<string>("aucune");
  useDocumentDirection(direction);
  const rtl = direction === "rtl";

  return (
    <main style={PAGE}>
      <PageHeader
        eyebrow="Système de design"
        title="Kit d’interface Santetrace"
        description="Aperçu du kit d’interface — aucune donnée patient. Toutes les valeurs sont des gabarits (000, Exemple)."
        back={{ href: "/", label: "Accueil" }}
        actions={
          <>
            <DemoLabel>{rtl ? DEMO_LABEL_AR : undefined}</DemoLabel>
            <SegmentedControl<Direction>
              ariaLabel="Direction du document"
              size="sm"
              value={direction}
              onChange={setDirection}
              options={[
                { value: "ltr", label: "FR · LTR" },
                { value: "rtl", label: "AR · RTL", icon: "languages" },
              ]}
            />
          </>
        }
      />

      <div style={STACK}>
        <Section title="Couleurs">
          <div style={{ ...GRID, gridTemplateColumns: "repeat(auto-fill, minmax(7.5rem, 1fr))" }}>
            {SWATCHES.map(([token, label]) => (
              <div key={token} style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                <span style={{ ...SWATCH, background: `var(${token})` }} />
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{label}</span>
                <code style={CAPTION}>{token}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Boutons">
          <div style={ROW}>
            <Button iconStart="send">Envoyer</Button>
            <Button variant="secondary" iconStart="upload">Importer</Button>
            <Button variant="ghost" iconEnd="arrow-right">Continuer</Button>
            <Button variant="danger" iconStart="x-circle">Rejeter</Button>
          </div>
          <div style={ROW}>
            <Button size="sm">Petit</Button>
            <Button size="md">Moyen</Button>
            <Button size="lg">Grand</Button>
            <Button loading>Envoi…</Button>
            <Button variant="secondary" disabled>Désactivé</Button>
          </div>
          <div style={ROW}>
            <LinkButton href="/ui-kit" variant="secondary" iconStart="arrow-left">Retour</LinkButton>
            <LinkButton href="/ui-kit" iconEnd="chevron-right">Suivant</LinkButton>
            <LinkButton href="https://example.org" external variant="ghost">Lien externe</LinkButton>
          </div>
        </Section>

        <Section title="Statuts et priorités">
          <div style={ROW}>
            {(["green", "orange", "red", "unknown"] as const).map((status) => (
              <StatusBadge key={status} status={status} label={rtl ? CARE_STATUS_LABELS_AR[status] : undefined} />
            ))}
          </div>
          <div style={ROW}>
            {(["green", "orange", "red", "unknown"] as const).map((status) => (
              <StatusBadge key={status} status={status} size="lg" label={rtl ? CARE_STATUS_LABELS_AR[status] : undefined} />
            ))}
          </div>
          <div style={ROW}>
            <PriorityBadge priority="orange" />
            <PriorityBadge priority="red" />
            <PriorityBadge priority="orange" size="sm" />
            <PriorityBadge priority="red" size="sm" />
          </div>
          <div style={ROW}>
            <Badge>Neutre</Badge>
            <Badge tone="accent" icon="check">Accent</Badge>
            <Badge tone="muted" icon="clock">Discret</Badge>
            <Badge tone="outline">Contour</Badge>
            <Badge tone="orange">Orange</Badge>
            <Badge tone="red">Rouge</Badge>
          </div>
        </Section>

        <Section title="Messages">
          <Notice title="Information neutre">Texte d’exemple pour un message neutre.</Notice>
          <Notice tone="info" title="Information système">Texte d’exemple.</Notice>
          <Notice tone="success" title="Action enregistrée">Texte d’exemple.</Notice>
          <Notice tone="orange" title="Seuil orange (exemple)" action={<Button size="sm" variant="secondary">Voir</Button>}>
            Réservé au contenu prioritaire.
          </Notice>
          <Notice tone="red" role="note" title="Seuil rouge (exemple)">Réservé au contenu prioritaire.</Notice>
        </Section>

        <div style={GRID}>
          <Section title="Formulaire">
            <Field label="Systolique" htmlFor="kit-sys" hint="Valeur d’exemple" required>
              <TextInput id="kit-sys" inputMode="numeric" placeholder="000" suffix="mmHg" aria-describedby={describedBy("kit-sys", { hint: true })} />
            </Field>
            <Field label="Glycémie" htmlFor="kit-glu" error="Saisissez une valeur d’exemple.">
              <TextInput id="kit-glu" invalid placeholder="0,0" suffix={unit === "mmol" ? "mmol/L" : "mg/dL"} aria-describedby={describedBy("kit-glu", { error: true })} />
            </Field>
            <SegmentedControl<"mmol" | "mg">
              ariaLabel="Unité de glycémie"
              value={unit}
              onChange={setUnit}
              fullWidth
              options={[
                { value: "mmol", label: "mmol/L" },
                { value: "mg", label: "mg/dL" },
              ]}
            />
            <Field label="Contexte" htmlFor="kit-ctx">
              <Select id="kit-ctx" defaultValue="a">
                <option value="a">Exemple A</option>
                <option value="b">Exemple B</option>
              </Select>
            </Field>
            <Field label="Motif" htmlFor="kit-reason" hint="Obligatoire pour les décisions">
              <TextArea id="kit-reason" placeholder="Exemple de motif" aria-describedby={describedBy("kit-reason", { hint: true })} />
            </Field>
            <Checkbox
              label="J’accepte (exemple)"
              description="Texte d’exemple pour un consentement."
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <Checkbox label="Option désactivée" disabled />
          </Section>

          <Section title="Valeurs">
            <div style={{ ...GRID, gridTemplateColumns: "repeat(auto-fit, minmax(9rem, 1fr))" }}>
              <Stat label="Tension (exemple)" icon="heart-pulse" value="000/00" unit="mmHg" status="orange" meta="Exemple" />
              <Stat label="Glycémie (exemple)" icon="droplet" value="0,0" unit="mmol/L" status="green" />
              <Stat label="Valeur manquante" icon="activity" value="—" status="unknown" meta="Aucune mesure reçue" />
            </div>
            <Stat size="lg" label="Grand format" value="000" unit="mmHg" />
            <KeyValueList
              columns={2}
              items={[
                { label: "Code", value: "EX-000", mono: true },
                { label: "Règle", value: "Exemple v0" },
                { label: "Horodatage", value: <Timestamp iso="2026-01-01T09:00:00Z" locale={rtl ? "ar" : "fr"} /> },
                { label: "Relatif", value: <Timestamp iso="2026-01-01T09:00:00Z" format="relative" locale={rtl ? "ar" : "fr"} /> },
                { label: "Non renseigné", value: <Timestamp iso={null} /> },
                { label: "Source", value: "Document d’exemple, p. 0" },
              ]}
            />
          </Section>
        </div>

        <Section title="Tableau">
          <Card padding="none" title="Liste d’exemple" description={`Ligne activée : ${lastClicked}`}>
            <DataTable<ExampleRow>
              caption="Tableau d’exemple, valeurs fictives"
              captionHidden
              columns={COLUMNS}
              rows={ROWS}
              rowKey={(row) => row.id}
              rowTone={(row) => (row.priority ? `priority-${row.priority}` : undefined)}
              onRowClick={(row) => setLastClicked(row.name)}
            />
          </Card>
          <Card padding="none" title="Tableau vide">
            <DataTable<ExampleRow> columns={COLUMNS} rows={[]} rowKey={(row) => row.id} dense />
          </Card>
        </Section>

        <Section title="Onglets">
          <Tabs<TabId>
            ariaLabel="Onglets d’exemple"
            idPrefix="kit-tabs"
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "a", label: "Alertes", icon: "bell", count: 0 },
              { id: "b", label: "Mesures", icon: "activity" },
              { id: "c", label: "Documents", icon: "file-text", count: 0 },
            ]}
          />
          <div {...tabPanelProps("kit-tabs", tab)} style={CAPTION}>
            Panneau d’exemple « {tab} ».
          </div>
        </Section>

        <div style={GRID}>
          <Section title="Chargement">
            <div style={ROW}>
              <Spinner />
              <Spinner size={28} label="Chargement des exemples" />
            </div>
            <Skeleton height={28} width="40%" />
            <Skeleton lines={3} />
          </Section>
          <Section title="États">
            <EmptyState compact icon="inbox" title="Aucune mesure" description="Les mesures apparaîtront ici." />
            <ErrorState compact message="Le service n’a pas répondu (exemple)." code="EXAMPLE_ERROR" onRetry={() => setLastClicked("réessai")} />
          </Section>
        </div>

        <EmptyState
          icon="file-text"
          title="Aucun document"
          description="État vide pleine largeur, pour une liste réellement vide."
          action={<Button variant="secondary" iconStart="upload">Importer un exemple</Button>}
        />
        <ErrorState message="Impossible de joindre l’API (exemple). Les données affichées ne sont pas à jour." code="NETWORK_ERROR" onRetry={() => setLastClicked("réessai")} />

        <Section title="Dialogue">
          <div style={ROW}>
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>Ouvrir le dialogue</Button>
          </div>
          <Dialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            title="Rejeter la proposition"
            description="Un motif est obligatoire (exemple)."
            footer={
              <>
                <Button variant="secondary" onClick={() => setDialogOpen(false)}>Annuler</Button>
                <Button variant="danger" onClick={() => setDialogOpen(false)}>Rejeter</Button>
              </>
            }
          >
            <Field label="Motif" htmlFor="kit-dialog-reason">
              <TextArea id="kit-dialog-reason" placeholder="Exemple de motif" />
            </Field>
          </Dialog>
        </Section>

        <Section title="Rail clinicien (jetons)">
          <div style={{ background: "var(--color-rail)", color: "var(--color-rail-ink)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)", maxWidth: "var(--rail-width)" }}>
            <strong style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-lg)" }}>Santetrace</strong>
            <DemoLabel tone="dark" />
            {(["home", "bell", "users"] as const).map((name, index) => (
              <span key={name} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-md)", background: index === 0 ? "var(--color-rail-active)" : "transparent", color: index === 0 ? "var(--color-rail-ink)" : "var(--color-rail-ink-2)", boxShadow: index === 0 ? "inset 2px 0 0 var(--color-rail-accent)" : "none" }}>
                <Icon name={name} /> Exemple {index + 1}
              </span>
            ))}
          </div>
        </Section>

        <Section title="Icônes">
          <div style={{ ...GRID, gridTemplateColumns: "repeat(auto-fill, minmax(6.5rem, 1fr))" }}>
            {ICONS.map((name) => (
              <span key={name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-1)", padding: "var(--space-2)", color: "var(--color-ink-2)" }}>
                <Icon name={name} size={22} />
                <code style={CAPTION}>{name}</code>
              </span>
            ))}
          </div>
        </Section>
      </div>
    </main>
  );
}
