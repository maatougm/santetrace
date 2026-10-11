import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { AccessEnvelope } from "../src/contracts/patient-platform";
import {
  DEFAULT_TAB,
  FREQUENT_TABS,
  SECONDARY_TABS,
  TAB_GROUPS,
  TAB_IDS,
  parseTabId,
  recordNavView,
  tabAllowed,
  tabCounts,
  type TabCountSource,
  type TabId,
} from "../src/components/doctor/record/record-tabs";
import { RECORD_NAV_COPY } from "../src/components/doctor/record/record-nav-copy";

const read = (...parts: string[]): string => readFileSync(join(process.cwd(), ...parts), "utf8");
const RECORD_DIR = "src/components/doctor/record";

const ACCESS: AccessEnvelope = {
  owner: false,
  relationship: "primary",
  scopes: ["status", "measurements", "clinical", "documents", "summary", "alerts", "messages"],
  grantId: "grant-1",
  grantRevision: 1,
  authorityRevision: 3,
  canManageCare: true,
  canReviewLabs: true,
};

/** Only the fields the counts read; the rest of a projected record is irrelevant here. */
function countSource(overrides: Record<string, unknown> = {}): TabCountSource {
  return {
    access: ACCESS,
    alerts: [{ status: "new" }, { status: "acknowledged" }, { status: "resolved" }],
    candidates: [{ status: "proposed" }, { status: "confirmed" }],
    proposals: [{ state: "pending" }, { state: "needs_review" }, { state: "approved" }],
    measurements: [{ id: "m1" }, { id: "m2" }],
    externalNotes: [],
    reminders: [{ id: "r1" }],
    ...overrides,
  } as unknown as TabCountSource;
}

const accessRecord = (access: Partial<AccessEnvelope>) => ({ access: { ...ACCESS, ...access } });

const once = (ids: readonly TabId[]) => [...ids].sort();

// --- ids, hashes, default ---------------------------------------------------

test("the 13 section ids (= #hashes) and their order are unchanged; the record opens on care, never messages", () => {
  assert.deepEqual(
    [...TAB_IDS],
    ["messages", "alerts", "care", "trends", "measurements", "documents", "report", "protocols", "search", "notes", "reminders", "rules", "summary"],
  );
  assert.equal(DEFAULT_TAB, "care");
  assert.notEqual(DEFAULT_TAB, "messages");
});

test("parseTabId accepts only the 13 ids (select values are checked, not trusted)", () => {
  for (const id of TAB_IDS) assert.equal(parseTabId(id), id);
  for (const bad of ["", "Messages", "#notes", "unknown", "__proto__", "toString"]) assert.equal(parseTabId(bad), null);
});

// --- access and counts (preserved) ------------------------------------------

test("tabAllowed keeps the same scope rules", () => {
  const full = accessRecord({});
  for (const id of TAB_IDS) assert.equal(tabAllowed(full, id), true, id);

  const narrow = accessRecord({ scopes: ["measurements"], canManageCare: false });
  const allowed = TAB_IDS.filter((id) => tabAllowed(narrow, id));
  assert.deepEqual(allowed, ["trends", "measurements", "protocols", "search"]);

  const owner = accessRecord({ owner: true, scopes: [], canManageCare: false });
  for (const id of TAB_IDS) assert.equal(tabAllowed(owner, id), true, `owner sees ${id}`);

  const manager = accessRecord({ scopes: [], canManageCare: true });
  assert.equal(tabAllowed(manager, "rules"), true);
  assert.equal(tabAllowed(manager, "reminders"), true);
  assert.equal(tabAllowed(manager, "notes"), false);
  assert.equal(tabAllowed(manager, "messages"), false);
});

test("counts are the record's real numbers; absent counts stay absent, never an invented 0", () => {
  assert.deepEqual(tabCounts(countSource()), {
    alerts: 2,
    care: 2,
    measurements: 2,
    documents: 1,
    notes: undefined,
    reminders: 1,
  });
  const empty = tabCounts(countSource({ alerts: [], candidates: [], proposals: [], measurements: [], reminders: [], externalNotes: undefined }));
  assert.equal(empty.care, undefined, "no reviewable proposal: no badge");
  assert.equal(empty.notes, undefined);
  assert.equal(empty.documents, 0, "documents keeps its actual 0");
  assert.equal(empty.measurements, 0);
  assert.equal(empty.messages, undefined);
  assert.equal(tabCounts(countSource({ externalNotes: [{ id: "n1" }, { id: "n2" }] })).notes, 2);
});

// --- grouping -----------------------------------------------------------------

test("phone groups list every section exactly once", () => {
  const grouped = TAB_GROUPS.flatMap((group) => group.tabs);
  assert.equal(grouped.length, TAB_IDS.length);
  assert.deepEqual(once(grouped), once(TAB_IDS));
  assert.deepEqual(
    TAB_GROUPS.map((group) => group.id),
    ["communication", "followUp", "evidence", "tools"],
  );
  for (const group of TAB_GROUPS) assert.ok(group.tabs.length > 0, group.id);
});

test("desktop: four frequent destinations, the nine others once each in 'Autres sections'", () => {
  assert.deepEqual([...FREQUENT_TABS], ["care", "measurements", "documents", "messages"]);
  assert.equal(SECONDARY_TABS.length, 9);
  assert.deepEqual(once([...FREQUENT_TABS, ...SECONDARY_TABS]), once(TAB_IDS));
  for (const id of FREQUENT_TABS) assert.ok(!SECONDARY_TABS.includes(id), id);
});

// --- navigation view model ----------------------------------------------------

test("a frequent section is current in the row; the secondary select shows its placeholder", () => {
  const view = recordNavView("care", tabCounts(countSource()), RECORD_NAV_COPY.fr);
  assert.equal(view.active, "care");
  assert.equal(view.activeLabel, "Suivi et plan");
  assert.deepEqual(
    view.frequent.map((option) => [option.id, option.current]),
    [
      ["care", true],
      ["measurements", false],
      ["documents", false],
      ["messages", false],
    ],
  );
  assert.equal(view.secondaryValue, "");
  assert.equal(view.secondaryLabel, null);
});

test("a secondary selection is reported as selected and visibly named", () => {
  const view = recordNavView("rules", tabCounts(countSource()), RECORD_NAV_COPY.fr);
  assert.equal(view.secondaryValue, "rules");
  assert.equal(view.secondaryLabel, "Règles");
  assert.equal(view.activeLabel, "Règles");
  assert.ok(view.frequent.every((option) => !option.current), "no frequent button claims the selection");
  const current = view.secondaryGroups.flatMap((group) => group.options).filter((option) => option.current);
  assert.deepEqual(current.map((option) => option.id), ["rules"]);
  const phoneCurrent = view.groups.flatMap((group) => group.options).filter((option) => option.current);
  assert.deepEqual(phoneCurrent.map((option) => option.id), ["rules"]);
});

test("the phone list has all 13 once; the secondary list has the 9 others once, empty groups dropped", () => {
  const view = recordNavView("notes", tabCounts(countSource()), RECORD_NAV_COPY.fr);
  const phone = view.groups.flatMap((group) => group.options.map((option) => option.id));
  assert.deepEqual(once(phone), once(TAB_IDS));
  const secondary = view.secondaryGroups.flatMap((group) => group.options.map((option) => option.id));
  assert.deepEqual(once(secondary), once(SECONDARY_TABS));
  for (const group of view.secondaryGroups) assert.ok(group.options.length > 0, group.id);
  assert.deepEqual(
    view.groups.map((group) => group.label),
    TAB_GROUPS.map((group) => RECORD_NAV_COPY.fr.groups[group.id]),
  );
});

test("option text carries the real count; no count means no number", () => {
  const view = recordNavView("care", tabCounts(countSource()), RECORD_NAV_COPY.fr);
  const byId = new Map(view.groups.flatMap((group) => group.options).map((option) => [option.id, option]));
  assert.equal(byId.get("measurements")?.text, "Mesures (2)");
  assert.equal(byId.get("alerts")?.text, "Alertes (2)");
  assert.equal(byId.get("care")?.text, "Suivi et plan (2)");
  assert.equal(byId.get("messages")?.text, "Messages");
  assert.equal(byId.get("notes")?.text, "Notes externes");
  const zero = recordNavView("care", tabCounts(countSource({ candidates: [] })), RECORD_NAV_COPY.fr);
  const documents = zero.frequent.find((option) => option.id === "documents");
  assert.equal(documents?.count, 0);
  assert.equal(documents?.text, "Documents (0)");
});

test("the view follows the shell language and leaves its inputs untouched", () => {
  const counts = Object.freeze(tabCounts(countSource()));
  const before = JSON.stringify(counts);
  const view = recordNavView("summary", counts, RECORD_NAV_COPY.ar);
  assert.equal(JSON.stringify(counts), before);
  assert.equal(view.activeLabel, RECORD_NAV_COPY.ar.sections.summary);
  assert.equal(view.secondaryLabel, RECORD_NAV_COPY.ar.sections.summary);
  assert.match(view.frequent[0]?.label ?? "", /[؀-ۿ]/);
});

// --- copy -----------------------------------------------------------------------

type Leaf = { path: string; kind: "string" | "function"; arity?: number; value?: string };

function leaves(value: unknown, path = ""): Leaf[] {
  if (typeof value === "string") return [{ path, kind: "string", value }];
  if (typeof value === "function") return [{ path, kind: "function", arity: value.length }];
  if (typeof value === "object" && value !== null) {
    return Object.keys(value)
      .sort()
      .flatMap((key) => leaves((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key));
  }
  return [{ path, kind: "string", value: String(value) }];
}

test("record navigation copy: same keys and arities in French and Arabic, the 13 sections and 4 groups covered", () => {
  const shape = (lang: "fr" | "ar") => leaves(RECORD_NAV_COPY[lang]).map(({ path, kind, arity }) => ({ path, kind, arity }));
  assert.deepEqual(shape("ar"), shape("fr"));
  for (const lang of ["fr", "ar"] as const) {
    assert.deepEqual(once(Object.keys(RECORD_NAV_COPY[lang].sections) as TabId[]), once(TAB_IDS), lang);
    assert.deepEqual(Object.keys(RECORD_NAV_COPY[lang].groups).sort(), TAB_GROUPS.map((group) => group.id).sort(), lang);
  }
});

test("record navigation copy: no empty value, and the Arabic is actually Arabic", () => {
  const arabic = /[؀-ۿ]/;
  for (const lang of ["fr", "ar"] as const) {
    for (const leaf of leaves(RECORD_NAV_COPY[lang])) {
      if (leaf.kind === "string") assert.ok(leaf.value && leaf.value.trim().length > 0, `${lang}.${leaf.path} is empty`);
    }
  }
  for (const leaf of leaves(RECORD_NAV_COPY.ar)) {
    if (leaf.kind === "string") assert.match(leaf.value ?? "", arabic, `ar.${leaf.path} is not Arabic`);
  }
  for (const id of TAB_IDS) assert.notEqual(RECORD_NAV_COPY.ar.sections[id], RECORD_NAV_COPY.fr.sections[id], id);
  for (const lang of ["fr", "ar"] as const) {
    const label = RECORD_NAV_COPY[lang].alertsShortcut(7);
    assert.match(label, /\(7\)/, `${lang} alerts shortcut shows the real count`);
  }
  assert.match(RECORD_NAV_COPY.ar.alertsShortcut(7), arabic);
});

test("French labels keep the brief's wording", () => {
  const fr = RECORD_NAV_COPY.fr;
  assert.equal(fr.writeToPatient, "Écrire au patient");
  assert.equal(fr.messagesNotShared, "Messages non partagés");
  assert.equal(fr.alertsShortcut(3), "Alertes (3)");
  assert.equal(fr.sectionSelectLabel, "Section du dossier");
  assert.equal(fr.moreSelectLabel, "Autres sections");
  assert.deepEqual(
    FREQUENT_TABS.map((id) => fr.sections[id]),
    ["Suivi et plan", "Mesures", "Documents", "Messages"],
  );
});

// --- static checks on the record page -----------------------------------------------

test("the record page mounts exactly one RecordPanel and never a message thread outside it", () => {
  const view = read(RECORD_DIR, "PatientRecordView.tsx");
  assert.equal(view.match(/<RecordPanel\b/g)?.length, 1, "one active RecordPanel");
  for (const file of ["PatientRecordView.tsx", "RecordSectionNav.tsx", "RecordActions.tsx"]) {
    const source = read(RECORD_DIR, file);
    assert.doesNotMatch(source, /MessageSection|MessageThread|\.\.\/comms\//, `${file} must not mount the message thread`);
  }
  assert.doesNotMatch(read(RECORD_DIR, "RecordSectionNav.tsx"), /<RecordPanel\b|useEffect|useLayoutEffect/, "the nav is stateless");
});

test("the panel is labelled by its own heading, not by a tab that no longer exists", () => {
  const view = read(RECORD_DIR, "PatientRecordView.tsx");
  assert.doesNotMatch(view, /tabPanelProps|<Tabs\b|role="tabpanel"/);
  assert.match(view, /aria-labelledby=\{panelTitleId\}/);
  assert.match(view, /<h2 id=\{panelTitleId\}/);
});

test("the section navigation sits before the situation and AI cards; clinical source keeps fr/ltr", () => {
  const view = read(RECORD_DIR, "PatientRecordView.tsx");
  const nav = view.indexOf("<RecordSectionNav");
  const situation = view.indexOf("<SituationCard");
  const ai = view.indexOf("<AiCaseScoreCard");
  const panel = view.indexOf("<RecordPanel");
  assert.ok(nav > 0 && situation > nav && ai > nav && panel > ai, "nav → situation → AI → panel");
  assert.ok(view.indexOf("<StaleNotice") < nav, "stale notice stays above the nav");
  const sourceWrap = view.lastIndexOf("{...FRENCH_SOURCE}", situation);
  assert.ok(sourceWrap > nav, "situation and AI cards are wrapped as French source");
  assert.ok(view.lastIndexOf("{...FRENCH_SOURCE}", panel) > ai, "panel content is wrapped as French source");
  assert.match(view, /<AiCaseScoreCard key=\{patientId\} patientId=\{patientId\}/);
});

test("the nav uses native selects with visible labels and no menu library", () => {
  const nav = read(RECORD_DIR, "RecordSectionNav.tsx");
  const imports = [...nav.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
  for (const source of imports) {
    assert.ok(/^(react|@\/components\/ui|\.\/record-tabs|\.\/record-nav-copy|\.\/RecordSectionNav\.module\.css)$/.test(source ?? ""), source);
  }
  assert.equal(nav.match(/<Select\b/g)?.length, 2, "phone select + 'Autres sections' select");
  assert.equal(nav.match(/<label htmlFor=/g)?.length, 2, "both selects have a visible label");
  assert.match(nav, /<optgroup/);
  assert.match(nav, /aria-current=/);
});

// --- phone jump to the current section ---------------------------------------------

test("jump label: the exact current section label for all 13 sections, in French and Arabic", () => {
  const arabic = /[؀-ۿ]/;
  const counts = tabCounts(countSource());
  for (const id of TAB_IDS) {
    const fr = recordNavView(id, counts, RECORD_NAV_COPY.fr);
    assert.equal(fr.activeLabel, RECORD_NAV_COPY.fr.sections[id], id);
    assert.equal(RECORD_NAV_COPY.fr.jumpToSection(fr.activeLabel), `Aller à ${RECORD_NAV_COPY.fr.sections[id]}`, `fr ${id}`);

    const ar = recordNavView(id, counts, RECORD_NAV_COPY.ar);
    const label = RECORD_NAV_COPY.ar.jumpToSection(ar.activeLabel);
    assert.equal(ar.activeLabel, RECORD_NAV_COPY.ar.sections[id], id);
    assert.equal(label, `الانتقال إلى ${RECORD_NAV_COPY.ar.sections[id]}`, `ar ${id}`);
    assert.match(label, arabic, `ar ${id} is Arabic`);
    assert.doesNotMatch(label, /[A-Za-z]/, `ar ${id} has no Latin text`);
    // The label is the section name only, never with its count.
    assert.doesNotMatch(label, /\(\d+\)/, `ar ${id} carries no count`);
    assert.doesNotMatch(RECORD_NAV_COPY.fr.jumpToSection(fr.activeLabel), /\(\d+\)/, `fr ${id} carries no count`);
  }
});

test("jump control: a native type=button inside the phone presentation, right after the select", () => {
  const nav = read(RECORD_DIR, "RecordSectionNav.tsx");
  const phoneStart = nav.indexOf("className={styles.phone}");
  const desktopStart = nav.indexOf("className={styles.desktop}");
  assert.ok(phoneStart > 0 && desktopStart > phoneStart, "phone presentation precedes the desktop one");
  const phone = nav.slice(phoneStart, desktopStart);
  assert.match(
    phone,
    /<\/Select>\s*<button\s+type="button"[^>]*onClick=\{onJump\}[^>]*>\s*\{copy\.jumpToSection\(view\.activeLabel\)\}\s*<\/button>/,
    "the jump button follows the select and is labelled with the current section",
  );
  assert.match(phone, /<button\s+type="button"\s+className=\{styles\.jump\}\s+aria-controls=\{panelId\}/);
  assert.equal(phone.match(/<button\b/g)?.length, 1, "one jump control on the phone");
  assert.match(nav, /onJump: \(\) => void;/);
});

test("jump wiring: reveals and focuses the mounted panel only; the select still keeps its focus", () => {
  const view = read(RECORD_DIR, "PatientRecordView.tsx");
  assert.match(view, /const jumpToPanel = \(\) => revealPanel\(panelRef\.current, true\);/);
  assert.equal(view.match(/\bjumpToPanel\b/g)?.length, 2, "defined once, passed once");
  assert.match(view, /<RecordSectionNav[^>]*onSelect=\{openSection\}[^>]*onJump=\{jumpToPanel\}/);
  assert.match(view, /const openSection = \(next: TabId\) => \{\s*selectTab\(next\);\s*revealPanel\(panelRef\.current, false\);\s*\};/);

  // revealPanel only scrolls and focuses: no section change, hash, reload or request.
  const reveal = view.slice(view.indexOf("function revealPanel"), view.indexOf("interface RecordUnavailableProps"));
  assert.match(reveal, /scrollIntoView\(\{ block: "start", behavior: reduceMotion \? "auto" : "smooth" \}\)/);
  assert.match(reveal, /if \(moveFocus\) panel\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(reveal, /setTab|selectTab|location|history|hash|reload|fetch|refresh/);
  assert.equal(view.match(/<RecordPanel\b/g)?.length, 1, "the jump mounts nothing: still one RecordPanel");
});

test("jump CSS: 44px target, 16px wrapping label, tokens only, no motion", () => {
  const css = read(RECORD_DIR, "RecordSectionNav.module.css");
  const rule = css.match(/\.jump\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.ok(rule.length > 0, ".jump rule exists");
  assert.match(rule, /min-height:\s*var\(--touch-min\)/);
  assert.match(rule, /font-size:\s*var\(--text-base\)/);
  assert.match(rule, /white-space:\s*normal/);
  const jumpRules = [...css.matchAll(/\.jump[^{]*\{([^}]*)\}/g)].map((match) => match[1]).join("\n");
  assert.doesNotMatch(jumpRules, /transition|animation/);
});

test("nav CSS: tokens only, logical properties, phone label ≥16px, layout switch at 768px", () => {
  const css = read(RECORD_DIR, "RecordSectionNav.module.css");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "no hex colours");
  assert.doesNotMatch(css, /(^|[\s;{])(left|right|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right))\s*:/m);
  assert.match(css, /@media \(min-width: 768px\)/);
  assert.match(css, /\.label\s*\{[^}]*font-size:\s*var\(--text-base\)/);
  assert.match(css, /min-height:\s*var\(--touch-min\)/);
});
