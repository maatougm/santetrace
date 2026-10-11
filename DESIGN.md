# Santetrace Design System

> Fictional demonstration. Synthetic data only. Demo thresholds are not clinically validated.
> Source of truth for code: `src/components/ui/` (tokens in `tokens.css`, props in `contract.ts`).
> Internal preview: `/ui-kit` (placeholders only, no patient data).
> Brand: **Santetrace** (final spelling, with an "a"; never "Sentetrace") in every visible surface. Internal identifiers (package name, storage keys,
> service-worker cache prefix `hackcure-`, cookies, DB names) are deliberately unchanged.

## 1. Direction: a public-health service, adapted from the NHS design system

Santetrace sits between two consultations. A patient types a blood-pressure reading on a phone, and
a clinician triages a queue on a laptop or a phone. Both need to **trust what they read**. The
visual language adapts the public NHS digital service manual
(service-manual.nhs.uk/design-system): it is well tested, accessible and familiar for healthcare.
Santetrace uses no NHS logo and claims no affiliation.

- **Blue for brand and action.** NHS blue (`--color-accent #005eb8`) for the header band, primary
  buttons, links, selection and the active tab. Dark blue (`--color-accent-strong #003087`) for
  hover and the solid 3px edge under buttons.
- **White on pale cool grey.** Cards are white (`--color-surface`) with 1px `#d8dde0` borders and
  no shadow, on a `#f0f4f5` page. Text is near-black `#212b32`; secondary text is `#4c6272`.
- **Colour means priority.** Amber and red appear only when something needs clinical attention.
  Green is the muted "no demo threshold crossed" status. It is never a button, a badge or a
  connection state.
- **Two-tone focus.** `:focus-visible` draws a 3px dark ring with a yellow halo (`#ffeb3b`) in the
  offset gap. On the blue header the link turns yellow with a dark bottom bar, as in the NHS header.
- **One readable sans.** The system UI sans stack serves body text, headings and big numbers
  (`--font-display` maps to `--font-sans`). The page and inputs start at 16px. There is no editorial
  serif and no web font.
- **Responsive equally.** Clinician: a blue header band with nav; under 720px the nav moves to
  its own full-width row. Patient: a white top bar with a blue top edge. Phones get a 5-item
  bottom tab bar (fits 320px, safe-area aware). From 960px a sticky top nav and a 1080px workspace.
- **Honest states.** "Missing" looks missing (dashed outline + question icon). "Queued" is never
  shown as "received". "Live" is claimed only when the live channel is connected; otherwise the
  connection badge says the screen refreshes on a timer.

No hero banners, no gradients, no emoji, no stock illustrations, no web fonts.

## 2. Tokens

All tokens live in `src/components/ui/tokens.css`, which the root layout imports once.
Names are a shared contract: tune values, never rename.

### Colour

| Group | Tokens | Use |
|---|---|---|
| Surfaces | `--color-bg`, `--color-bg-sunken`, `--color-surface`, `--color-surface-raised`, `--color-surface-muted` | Page, wells/tracks, cards, inputs/popovers, quiet panels and table headers |
| Lines | `--color-line-subtle`, `--color-line`, `--color-line-strong` | Row dividers, card borders, control borders |
| Washes | `--color-hover`, `--color-press`, `--color-overlay` | Hover/press on any light surface, dialog backdrop |
| Ink | `--color-ink`, `--color-ink-2`, `--color-ink-3`, `--color-ink-4`, `--color-ink-inverse` | Primary text, body, secondary/labels, placeholder/disabled (>= 4.5:1), text on dark |
| Accent | `--color-accent`, `--color-accent-strong`, `--color-accent-soft`, `--color-accent-wash`, `--color-accent-ink` | Primary action, hover/eyebrows, selected fills, row hover, text on accent |
| Focus | `--color-focus`, `--color-focus-halo`, `--color-focus-inverse`, `--focus-width`, `--focus-offset` | 3px dark ring + yellow halo; yellow on the blue header |
| Rail (header band) | `--color-rail`, `--color-rail-2`, `--color-rail-line`, `--color-rail-ink`, `--color-rail-ink-2`, `--color-rail-hover`, `--color-rail-active`, `--color-rail-accent` | Blue clinician header and sign-in identity panel (historical names kept) |
| Control line | `--color-line-control` | 2px input borders (>= 3:1 non-text contrast) |
| Status | `--color-status-{green,orange,red,unknown}` (+ `-soft`, `-mark`, `-line`) | See section 4. Text uses the base token; `-mark` is for bars, edges and chart thresholds |
| Info | `--color-info`, `--color-info-soft` | Neutral system information (not priority) |
| Error | `--color-error`, `--color-error-soft`, `--color-danger`, `--color-danger-strong` | Form validation and destructive confirm only |
| Chart | `--chart-systolic`, `--chart-diastolic`, `--chart-glucose`, `--chart-lab`, `--chart-grid`, `--chart-axis`, `--chart-threshold-orange`, `--chart-threshold-red` | Series, grid, axes, threshold lines |

Contrast (computed): ink on bg 13:1. ink-3 on white 6.4:1, on bg 5.8:1. ink-4 on bg 4.7:1.
Accent on white 6.4:1. White on accent 6.4:1. Red text on red-soft 6.1:1. Green text on white 6.2:1.
Orange text on orange-soft 6.0:1. Rail-ink-2 on rail 5.6:1. Yellow focus on blue 5.3:1.

### Type scale

| Token | Size | Use |
|---|---|---|
| `--text-2xs` | 12px | Eyebrows, small badges, tab labels on 320px phones |
| `--text-xs` | 13px | Labels above values, table headers, hints |
| `--text-sm` | 14px | Secondary text, notices, dense tables, field labels |
| `--text-base` | 16px | Body (document default) |
| `--text-md` | 17px | Inputs (never below 16px), card titles |
| `--text-lg` | 19px | Card and section titles |
| `--text-xl` | 22px | Dialog titles, small stats |
| `--text-2xl` | 28px | Stat values, mobile page titles |
| `--text-3xl` | 34px | Page titles (bold sans) |
| `--text-4xl` | 40px | Patient headline value (`Stat size="lg"`) |

Families: `--font-sans` (UI), `--font-display` (h1, dialog titles), `--font-numeric` (big numbers),
`--font-mono` (codes, IDs), `--font-arabic`. Weights: `--weight-regular/medium/semibold/bold`.
Leading: `--leading-tight 1.25`, `--leading-snug 1.4`, `--leading-normal 1.5`, `--leading-relaxed 1.65`.
Tracking: `--tracking-eyebrow`, `--tracking-tight`, `--tracking-display` (all become 0 in Arabic).

### Space, shape, motion, layout

- Space on a 4px grid: `--space-0-5` (2px) to `--space-16` (64px), with half steps `-1-5` and `-2-5`.
- Controls: `--control-h-sm 36px`, `--control-h-md 44px`, `--control-h-lg 52px`; `--touch-min 44px`.
- Radius: `--radius-xs 2`, `-sm 4` (inputs), `-md 4` (buttons), `-lg 8` (cards, dialogs), `-pill`.
- Shadow: cards are flat; `--shadow-button` (solid 3px edge under primary buttons), `--shadow-2`
  (raised panels, bottom tab bar), `--shadow-3` (dialogs).
- Motion: `--duration-fast 120ms`, `-base 200ms`, `-slow 320ms`, `--ease-out`, `--ease-in-out`.
  Under `prefers-reduced-motion` every duration becomes 0. Spinners keep a slow rotation because
  that motion is essential.
- Layout: `--content-max 1200px` (clinician), `--patient-max 600px` (patient phone column),
  `--patient-max-wide 1080px` (patient desktop), `--header-height 64px`, z-layers `--z-*`.

## 3. Principles in practice

1. **One accent, one meaning.** Blue means "act here" or "you are here". If two things on a
   screen are blue, they should both be actionable or selected.
2. **Priority is earned.** Amber and red are reserved for orange and red status, alert priority and
   destructive confirmation. A screen with no alerts has no amber or red on it.
3. **Never colour alone.** Every status shows an icon with a distinct shape and a text label.
4. **Show the gap.** A missing value renders "—" with an "unknown" badge. It is never shown as 0,
   never as the last known value without its date, and never with a green look.
5. **Source beside fact.** Every clinical number carries its unit, its time and (for labs) a link to
   its source page.

## 4. Status semantics

| Status | Default label (fr) | Icon | Look | Meaning |
|---|---|---|---|---|
| `green` | Aucun seuil haut dépassé (démo) | minus | Muted sage chip | No HIGH demo threshold crossed; the demo profiles have no low thresholds, so the label says low values are not assessed. It does **not** mean "healthy", "normal" or "stable". Never celebratory. A whole condition or the global view is never green without complete coverage (feature 006) |
| `orange` | Suivi requis | alert-triangle | Amber chip | Follow-up threshold crossed (priority) |
| `red` | Priorité haute | alert-octagon | Red chip | High-priority threshold crossed (priority) |
| `unknown` | Inconnu — données manquantes | help-circle | **Dashed** outline on paper, grey ink | Missing or stale data. Never reassuring |

Priority (`PriorityBadge`): orange is an amber chip with an amber border; red is **solid red with
white text** so it outranks everything else on the screen.

Rules:
- Amber and red are only for `orange`/`red` status, alert priority, priority edges on cards/rows
  (`Card tone="priority-*"`, `DataTable rowTone`), orange/red `Notice` and the `danger` button.
- Dashed outlines mean "unknown" and nothing else.
- `--color-error` (same hue as red) is the one non-priority exception: inline validation errors
  and destructive confirmation. It is always paired with an icon and text.
- API failures (`ErrorState`) are shown in **neutral ink**, not red, so a failed panel never looks
  like a red alert. They are framed, name what failed, show the machine code and offer a retry.

Other states, using non-priority tones (`Badge`):

| Domain | State | Badge |
|---|---|---|
| Outbox delivery | Queued on device | `tone="outline" icon="clock"` "En attente d’envoi" |
| | Received by server | `tone="neutral" icon="check"` "Reçu" |
| | Seen by clinician | `tone="accent" icon="eye"` "Vu par le soignant" |
| | Offline | `tone="outline" icon="wifi-off"` (never "envoyé") |
| EndoRecord candidate | Proposed (unreviewed) | `tone="outline"`, kept out of the trusted chart |
| | Confirmed | `tone="accent" icon="check"` |
| | Corrected | `tone="neutral" icon="edit"`, with previous value + reviewer visible |
| | Rejected | `tone="muted" icon="x"` |
| Alert lifecycle | Open / acknowledged / resolved | `outline` / `neutral` / `muted` (priority shown separately) |

Confidence labels describe extraction evidence ("valeur et unité lues sur la page 2"), never an
invented percentage.

## 5. Components

Import everything from `@/components/ui`. Each component implements `contract.ts` exactly and
adds only optional props (listed as "+").

| Component | Use | Notes |
|---|---|---|
| `Icon` | Inline SVG, 24 viewBox, 1.75 stroke, `currentColor` | Decorative unless `title`. Arrows, chevron-left/right, log-out and send **mirror automatically in RTL**; + `mirror` to override. Also accepts `alert-octagon`, `circle-dashed` |
| `Button` | Actions | Defaults to `type="button"`, so pass `type="submit"` in forms. `loading` disables, sets `aria-busy` and swaps the start icon for a spinner. `danger` is for destructive confirmation only. + `ref` |
| `LinkButton` | Navigation that looks like a button | Default `primary`. `external` gets `target=_blank`, `rel`, an external icon and an off-screen "(nouvel onglet)". + `aria-label`, `aria-current`, `newTabLabel`, `prefetch` |
| `Card` | The base surface | `padding="none"` for flush tables (the header gets a divider). `tone="priority-*"` adds a 4px edge on the inline-start side for alert cards only. With `id` + `title`, the section is labelled by its heading. + `headingLevel` (default 2) |
| `PageHeader` | One per page, owns the h1 | Bold sans. `back` renders a mirrored arrow link. + `titleId` |
| `StatusBadge` | Care status | See section 4. Pass the Arabic `label` in RTL (`CARE_STATUS_LABELS_AR`) |
| `PriorityBadge` | Alert priority | Orange chip or solid red. Arabic: `PRIORITY_LABELS_AR` |
| `Badge` | Metadata, counts, lifecycle states | `orange`/`red` tones are for priority content only |
| `Notice` | Inline message | `neutral`/`info`/`success` are not priority. `red` defaults to `role="alert"`. On desktop the `action` sits at the inline end |
| `Field` | Label + hint + error around one control | Hint sits **above** the control and the error below with an icon. Wire the control with `id={htmlFor}` and `aria-describedby={describedBy(htmlFor, { hint, error })}` |
| `TextInput` | Text/number input | `suffix` holds a fixed unit (`mmHg`). Font is 16px so iOS never zooms. `className` styles the outer box; other props, `ref` included, go on `<input>` |
| `Select`, `TextArea` | Native controls in the same box | Same `className`/`ref` split |
| `Checkbox` | Consent, options | The whole row is the 44px target. `description` is wired with `aria-describedby`. + `invalid`, `ref` |
| `SegmentedControl` | 2–4 exclusive options (unit, period, language) | Native radios inside a `radiogroup`: arrow keys work and the hit area is 44px at md/lg. + `name` |
| `Tabs` | Switching views in place | Automatic activation. Arrow keys follow reading direction; Home and End jump to the ends. + `idPrefix`, then put `tabPanelProps(idPrefix, active)` on the panel |
| `DataTable` | Lists of records | Semantic table; the **wrapper** scrolls horizontally on narrow screens. `numeric` columns are tabular and end-aligned. `onRowClick` makes rows focusable (Enter/Space) and nested links/buttons keep their own behaviour. + `rowTone`, `captionHidden`, `scrollLabel` |
| `Stat` | One measured value | Big tabular number + unit as an LTR island, then status + meta. Show "—" with `status="unknown"` when missing. + `size` (`lg` for the patient headline), `statusLabel` |
| `KeyValueList` | Record facts (`<dl>`) | Columns respond to the **container**, so it works in side panels. `mono` values are bidi-isolated |
| `Timestamp` | Every date/time | `<time dateTime>`. fr → `fr-FR`; ar → `ar-TN-u-nu-latn` (Latin digits). Africa/Tunis by default so server and client match. Relative values refresh every 30 s and show the absolute date on hover. Null renders "—" plus off-screen "non renseigné". + `timeZone`. `formatTimestamp()` is exported for charts |
| `Spinner` / `Skeleton` | Loading | Put `aria-busy` on the loading region. Skeletons are hidden from assistive tech |
| `EmptyState` | Genuinely empty data | Not for failures, not for missing clinical values |
| `ErrorState` | Failed request | Title, honest message, discreet `code`, optional retry. Neutral ink. + `icon`, `codeLabel`, `retrying` |
| `Dialog` | Confirmations, reason capture | Native `<dialog>`: focus trap, Esc and backdrop close, focus returns to the opener. Initial focus goes to the first field (the close button is last in DOM order). Becomes a bottom sheet on phones. + `closeLabel`, `closeOnBackdrop` |
| `DemoLabel` | Persistent honesty marker | "Démonstration fictive · données synthétiques". `tone="dark"` on the rail. Arabic: `DEMO_LABEL_AR` |
| `VisuallyHidden` | Screen-reader-only text | |

Composition defaults: page = `PageHeader` + a stack of `Card`s with `--space-6` gaps. Tables live in
`Card padding="none"`. One primary button per view, placed at the inline end of the card header or
the bottom of a form.

## 6. RTL and Arabic

- The root sets `lang` and `dir` (`<html lang="ar" dir="rtl">`); components never hard-code direction.
- CSS uses logical properties only: `margin-inline-start`, `padding-inline`, `inset-inline-end`,
  `border-inline-start`, `text-align: start`. The only physical rules are the DataTable priority
  edge (inset shadow), which has an explicit `[dir="rtl"]` twin.
- `:lang(ar)` swaps `--font-sans` and `--font-display` to `--font-arabic`, sets every tracking token
  to 0, raises line-heights (tight 1.4, normal 1.75) so diacritics are never clipped, and nudges
  the small sizes up one step (`--text-2xs` 12px … `--text-base` 16px) because Arabic letterforms
  are denser than Latin at the same size.
  Never letter-space Arabic, never italicise it, never uppercase it (`text-transform` has no effect).
- Directional icons mirror automatically (`Icon`). Clocks, checkmarks and media icons do not.
- Numbers stay in Latin digits (`ar-TN-u-nu-latn`), matching Tunisian lab documents. Value + unit
  (`138/86 mmHg`) and codes are LTR islands (`Stat`, `KeyValueList mono`, `<bdi>`), so they never
  reorder inside Arabic sentences.
- Use Arabic punctuation (`،` `؟`). Do not put `الـ` directly before a Latin word.
- Darija wording requires review by a fluent speaker before any real use (constitution).

## 7. Charts

- **Every axis is labelled with its unit** ("Pression artérielle (mmHg)", "Glycémie (mmol/L)").
- **Never put incomparable units on one axis.** Blood pressure, glucose and each lab analyte get
  their own chart or their own small multiple. No dual-axis charts.
- Systolic and diastolic may share one mmHg axis (`--chart-systolic` NHS blue and `--chart-diastolic` mid blue).
  Glucose is `--chart-glucose`; confirmed lab values are `--chart-lab`.
- Threshold lines are dashed in `--chart-threshold-orange` / `--chart-threshold-red` and labelled
  "Seuil démo …". They are the only amber/red on a chart.
- A legend is always visible (not hover-only), and a **source line** sits under every chart:
  "Source : mesures saisies par le patient" or "Source : document X, page N (confirmé le …)".
- Gaps stay gaps. Do not interpolate across missing days. Show the "no data" range, and never read
  absence as stability.
- Only confirmed lab values are charted. Proposed values never appear on the trusted chart.
- Grid lines are `--chart-grid`; axis text is `--chart-axis` at `--text-xs` with tabular figures.
  Format time ticks with `formatTimestamp()` so they match the rest of the UI.
- Each point offers its exact value, unit, time and (for labs) a link to its source.
  Provide a table alternative (`DataTable`) for screen-reader users.

## 8. Accessibility checklist (WCAG 2.2 AA)

- [ ] Text contrast >= 4.5:1 (large text >= 3:1); icons and control borders >= 3:1.
- [ ] Visible `:focus-visible` ring: 2px `--color-focus`, 2px offset (inverse ring on the rail).
- [ ] Touch targets >= 44px for md/lg controls; never below 24px.
- [ ] Every input has a visible `<label>`; hints and errors are connected with `aria-describedby`;
      invalid controls set `aria-invalid`.
- [ ] Status is never colour-only (icon + text); charts have a legend and a table alternative.
- [ ] Every page has exactly one h1 (`PageHeader`) and logical heading order (Card titles are h2).
- [ ] Loading regions have `aria-busy`; spinners have a label; failures use `ErrorState` (`role="alert"`).
- [ ] Dialogs trap focus, close on Esc and return focus to the opener.
- [ ] Tables use `<th scope="col">` and a caption (visible or `captionHidden`).
- [ ] `prefers-reduced-motion` turns off non-essential motion.
- [ ] Layout works at 320px wide and at 200% zoom with no page-level horizontal scroll.
- [ ] `lang`/`dir` are correct; Arabic renders with zero tracking and clear diacritics.

## 9. Do not

- Do not use amber or red for decoration, branding, charts (except thresholds) or API errors.
- Do not show `green` as success, "normal" or "healthy". It means only "no demo threshold crossed".
- Do not render missing data as 0, as a blank, or with a reassuring colour. Use "—" with `unknown`.
- Do not show a queued measurement as received, or a received one as seen by a clinician.
- Do not chart proposed (unconfirmed) lab values, or combine different units on one axis.
- Do not invent confidence percentages, diagnoses or treatment advice in UI copy.
- Do not show anything that looks like real patient data in previews. Use "000" and "Exemple".
- Do not add web fonts, icon fonts, gradients on white, glassmorphism, emoji or hero banners.
- Do not use physical CSS properties (`left`, `margin-right`, `text-align: left`) for layout.
- Do not letter-space, italicise or uppercase Arabic.
- Do not put a second primary button in the same view, or a `danger` button outside a confirmation.
- Do not remove focus outlines, and do not use `div`s with click handlers instead of buttons/links.

## 10. Bounded dashboard and patient refinements (2026-10-11)

Source: `docs/dashboard-ui-improvement-brief.md`. These extend the NHS blue/white direction above;
tokens, colours, status semantics and the brand **Santetrace** are unchanged.

- **Clinician language.** The clinician shell reuses the existing device language preference
  (`useLanguagePreference`, same storage key and cleanup) through `ClinicianLanguageProvider` and
  `useDocumentLanguage`. There is no second preference. Shell, session gate, navigation, freshness/error
  UI, dashboard copy and record navigation follow FR/AR with a labelled 44px language toggle.
- **French source stays French.** Server-authored clinical content and section forms that are not
  translated (situation card, AI estimate card, record section panels) keep `lang="fr" dir="ltr"`
  via `FRENCH_SOURCE`. The frontend never machine-translates clinical facts, reasons or model text.
- **Compact queue.** Header = "Patients" + count, one freshness indicator, quiet invitations link. The
  demo marker stays in the shell strip only. Under 768px the five existing filters sit in a native
  `<details>` (collapsed by default, 44px summary naming the active filter and its count); from
  768px the same disclosure is held open with its summary hidden. One queue (Patient · Urgence ·
  Estimation IA) in `buildPatientQueue` order. The estimate is only the genuine server `/100` ("IA · à
  revoir") with a short always-visible caveat; it never sorts or derives anything.
- **Record navigation.** All 13 sections, hashes, scopes, counts and the `care` default are kept.
  Phone: one labelled native select ("Section du dossier") with grouped options. Desktop: four
  frequent buttons (Suivi et plan, Mesures, Documents, Messages) plus a labelled "Autres sections"
  select that names a selected secondary section. The navigation sits right under the patient
  header, before the situation and AI cards. Exactly one active section panel is mounted, labelled
  by its visible heading; Messages is never pre-mounted (read receipts).
- **Patient home.** Order: safety notices and status → "Ajouter une mesure" (single primary) →
  real submission result → latest reading (with its provenance badges) → next step → compact
  labelled secondary link list (same four destinations, quiet devices link) → outbox.
- **Neutral reminders.** Page title "Mes rappels" / "تذكيراتي" with a neutral intro. Medication
  wording appears only for medication reminders ("Pris / Pas pris"), care actions keep
  "Fait / À faire". The general reminders entry uses a bell, not a pill.
- **Phone type.** Important labels, filters, section navigation and field labels are 16px minimum.
  Metadata may keep the smaller secondary tokens.
