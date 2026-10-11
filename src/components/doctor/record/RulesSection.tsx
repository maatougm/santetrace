"use client";

import { useState, type FormEvent } from "react";
import { Badge, Button, Card, Field, Notice, SegmentedControl, TextInput, describedBy } from "@/components/ui";
import { UNGUARDED_MUTATIONS, type MutationGuard } from "@/lib/client/access-fence";
import { updateRules, type GlucoseUnit, type Patient, type Rules, type RulesInput } from "@/lib/client/api";
import { errorText } from "../shared/ApiErrorState";
import { DEMO_RULE_LABEL } from "../shared/labels";
import styles from "./Record.module.css";

type NumericKey = Exclude<keyof RulesInput, "glucoseUnit">;
type Draft = Record<NumericKey, string> & { glucoseUnit: GlucoseUnit };
type Errors = Partial<Record<NumericKey, string>>;

interface Bounds {
  min: number;
  max: number;
}

const BP_BOUNDS = { systolic: { min: 50, max: 300 }, diastolic: { min: 30, max: 200 } } as const;
const GLUCOSE_BOUNDS: Record<GlucoseUnit, Bounds> = { "mg/dL": { min: 20, max: 600 }, "mmol/L": { min: 1, max: 33.4 } };
const OVERDUE_BOUNDS: Bounds = { min: 1, max: 720 };

const PAIRS: { label: string; warn: NumericKey; high: NumericKey; bounds: (unit: GlucoseUnit) => Bounds; unit: (u: GlucoseUnit) => string }[] = [
  { label: "Systolique", warn: "systolicWarn", high: "systolicHigh", bounds: () => BP_BOUNDS.systolic, unit: () => "mmHg" },
  { label: "Diastolique", warn: "diastolicWarn", high: "diastolicHigh", bounds: () => BP_BOUNDS.diastolic, unit: () => "mmHg" },
  { label: "Glycémie", warn: "glucoseWarn", high: "glucoseHigh", bounds: (u) => GLUCOSE_BOUNDS[u], unit: (u) => u },
];

const NUMERIC_KEYS: NumericKey[] = [
  "systolicWarn",
  "systolicHigh",
  "diastolicWarn",
  "diastolicHigh",
  "glucoseWarn",
  "glucoseHigh",
  "overdueHours",
];

function toDraft(rules: Rules): Draft {
  return {
    systolicWarn: String(rules.systolicWarn),
    systolicHigh: String(rules.systolicHigh),
    diastolicWarn: String(rules.diastolicWarn),
    diastolicHigh: String(rules.diastolicHigh),
    glucoseWarn: String(rules.glucoseWarn),
    glucoseHigh: String(rules.glucoseHigh),
    glucoseUnit: rules.glucoseUnit,
    overdueHours: String(rules.overdueHours),
  };
}

function parse(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function inRange(value: number | null, bounds: Bounds): string | undefined {
  if (value === null) return "Valeur numérique requise.";
  if (value < bounds.min || value > bounds.max) return `Entre ${bounds.min} et ${bounds.max}.`;
  return undefined;
}

function validate(draft: Draft): { errors: Errors; input: RulesInput | null } {
  const errors: Errors = {};
  for (const pair of PAIRS) {
    const bounds = pair.bounds(draft.glucoseUnit);
    const warn = parse(draft[pair.warn]);
    const high = parse(draft[pair.high]);
    errors[pair.warn] = inRange(warn, bounds);
    errors[pair.high] = inRange(high, bounds);
    if (!errors[pair.warn] && !errors[pair.high] && warn !== null && high !== null && warn >= high) {
      errors[pair.high] = "Le seuil priorité haute doit être strictement supérieur au seuil de suivi.";
    }
  }
  const overdue = parse(draft.overdueHours);
  errors.overdueHours =
    inRange(overdue, OVERDUE_BOUNDS) ?? (overdue !== null && !Number.isInteger(overdue) ? "Nombre entier d’heures." : undefined);

  if (NUMERIC_KEYS.some((key) => errors[key])) return { errors, input: null };
  const value = (key: NumericKey) => parse(draft[key]) as number;
  return {
    errors,
    input: {
      systolicWarn: value("systolicWarn"),
      systolicHigh: value("systolicHigh"),
      diastolicWarn: value("diastolicWarn"),
      diastolicHigh: value("diastolicHigh"),
      glucoseWarn: value("glucoseWarn"),
      glucoseHigh: value("glucoseHigh"),
      glucoseUnit: draft.glucoseUnit,
      overdueHours: value("overdueHours"),
    },
  };
}

function changedCount(draft: Draft, rules: Rules): number {
  const numeric = NUMERIC_KEYS.filter((key) => parse(draft[key]) !== rules[key]).length;
  return numeric + (draft.glucoseUnit !== rules.glucoseUnit ? 1 : 0);
}

interface RulesSectionProps {
  patient: Patient;
  onUpdated: (patient: Patient) => void;
  /** Record mutation guard: a result held across an authority change is discarded. */
  guard?: MutationGuard;
}

const DISCARDED = "Résultat écarté : l’accès au dossier a changé pendant l’opération. Vérifiez l’état actuel avant de recommencer.";

/** Keyed by rules version by the caller: a new version resets the draft. */
export function RulesSection({ patient, onUpdated, guard = UNGUARDED_MUTATIONS }: RulesSectionProps) {
  const rules = patient.rules;
  const [draft, setDraft] = useState<Draft>(() => toDraft(rules));
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const changes = changedCount(draft, rules);
  const set = (key: NumericKey, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validate(draft);
    setErrors(result.errors);
    if (!result.input) {
      const first = NUMERIC_KEYS.find((key) => result.errors[key]);
      if (first) document.getElementById(`rules-${first}`)?.focus();
      return;
    }
    setSaving(true);
    setFailure(null);
    // Ticket taken before the request: success AND failure are both gated by it.
    const commit = guard.begin();
    try {
      const response = await updateRules(patient.id, result.input);
      if (!commit(() => onUpdated(response.patient))) setFailure(DISCARDED);
    } catch (error) {
      if (!commit(() => setFailure(errorText(error)))) setFailure(DISCARDED);
    } finally {
      setSaving(false);
    }
  };

  const numberField = (key: NumericKey, label: string, unit: string, hint?: string) => {
    const id = `rules-${key}`;
    return (
      <Field label={label} htmlFor={id} hint={hint} error={errors[key]} required>
        <TextInput
          id={id}
          type="number"
          inputMode="decimal"
          step="any"
          value={draft[key]}
          suffix={unit}
          invalid={Boolean(errors[key])}
          aria-describedby={describedBy(id, { hint, error: errors[key] })}
          onChange={(event) => set(key, event.target.value)}
        />
      </Field>
    );
  };

  return (
    <div className={styles.sectionStack}>
      <Notice tone="info" icon="shield" title="Règles de démonstration non validées cliniquement">
        Chaque enregistrement crée une nouvelle version immuable. Les mesures et alertes passées gardent la version qui les a
        évaluées ; seules les nouvelles mesures utilisent la nouvelle version. Comparateur : « supérieur ou égal ».
      </Notice>

      <Card
        title="Seuils du patient"
        description={
          <span className={styles.versionLine}>
            Version en vigueur <code className={styles.mono}>{rules.version}</code>
            <Badge tone="outline">{DEMO_RULE_LABEL}</Badge>
          </span>
        }
      >
        <form className={styles.rulesForm} onSubmit={(event) => void submit(event)} noValidate>
          {PAIRS.map((pair) => {
            const unit = pair.unit(draft.glucoseUnit);
            return (
              <fieldset key={pair.label} className={styles.rulesRow}>
                <legend className={styles.rulesLegend}>{pair.label}</legend>
                {numberField(pair.warn, "Seuil de suivi (orange) ≥", unit)}
                {numberField(pair.high, "Seuil priorité haute (rouge) ≥", unit)}
              </fieldset>
            );
          })}

          <fieldset className={styles.rulesRow}>
            <legend className={styles.rulesLegend}>Unité et fraîcheur</legend>
            <div className={styles.unitField}>
              <span className={styles.fieldLabel}>Unité des seuils de glycémie</span>
              <SegmentedControl<GlucoseUnit>
                ariaLabel="Unité des seuils de glycémie"
                value={draft.glucoseUnit}
                onChange={(value) => setDraft((current) => ({ ...current, glucoseUnit: value }))}
                options={[
                  { value: "mg/dL", label: "mg/dL" },
                  { value: "mmol/L", label: "mmol/L" },
                ]}
              />
            </div>
            {numberField("overdueHours", "Mesure en retard après", "h", "Au-delà, le statut devient « inconnu ».")}
          </fieldset>

          {draft.glucoseUnit !== rules.glucoseUnit ? (
            <Notice tone="info" icon="alert-triangle" title="Les seuils ne sont pas convertis">
              Vous changez l’unité de {rules.glucoseUnit} vers {draft.glucoseUnit} : saisissez les seuils de glycémie dans la
              nouvelle unité.
            </Notice>
          ) : null}

          {failure ? (
            <Notice tone="neutral" icon="x-circle" role="alert" title="Version non enregistrée">
              {failure}
            </Notice>
          ) : null}

          <div className={styles.formActions}>
            <Button type="submit" variant="primary" iconStart="check" loading={saving} disabled={changes === 0}>
              {changes === 0
                ? "Aucune modification"
                : `Enregistrer une nouvelle version (${changes} modification${changes > 1 ? "s" : ""})`}
            </Button>
            {changes > 0 ? (
              <Button variant="ghost" onClick={() => { setDraft(toDraft(rules)); setErrors({}); }}>
                Annuler les modifications
              </Button>
            ) : null}
          </div>
        </form>
      </Card>
    </div>
  );
}
