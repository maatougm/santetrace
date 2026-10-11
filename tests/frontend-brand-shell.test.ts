import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { connectionBadgeView, type LiveStatus } from "../src/components/ui/connection-badge";

const read = (...parts: string[]): string => readFileSync(join(process.cwd(), ...parts), "utf8");
const STATUSES: readonly LiveStatus[] = ["connecting", "live", "reconnecting", "offline", "unavailable", "denied"];

// ---------------------------------------------------------------------------
// Live connection badge: honest wording, never a clinical colour
// ---------------------------------------------------------------------------

test("connection badge has a non-empty fr and ar label and detail for every status", () => {
  for (const lang of ["fr", "ar"] as const) {
    for (const status of STATUSES) {
      const view = connectionBadgeView(status, null, lang, 0);
      assert.ok(view.label.trim().length > 0, `${lang}/${status} label`);
      assert.ok(view.detail.trim().length > 0, `${lang}/${status} detail`);
    }
  }
});

test("only the live status claims real-time delivery", () => {
  const live = STATUSES.filter((status) => connectionBadgeView(status, null, "fr", 0).tone === "live");
  assert.deepEqual(live, ["live"]);
  assert.equal(connectionBadgeView("unavailable", null, "fr", 0).tone, "fallback");
  assert.equal(connectionBadgeView("offline", null, "fr", 0).tone, "offline");
  assert.equal(connectionBadgeView("denied", null, "fr", 0).tone, "denied");
  assert.equal(connectionBadgeView("reconnecting", null, "fr", 0).tone, "pending");
});

test("polling fallback states say the screen still refreshes", () => {
  for (const status of ["connecting", "reconnecting", "unavailable"] as const) {
    assert.match(connectionBadgeView(status, null, "fr", 0).detail, /actualise/);
  }
});

test("last event time is appended only when known and never in the future", () => {
  const now = Date.UTC(2026, 9, 11, 6, 0, 0);
  assert.doesNotMatch(connectionBadgeView("live", null, "fr", now).detail, /Dernier événement/);
  assert.doesNotMatch(connectionBadgeView("live", Number.NaN, "fr", now).detail, /Dernier événement/);
  assert.match(connectionBadgeView("live", now - 5_000, "fr", now).detail, /Dernier événement reçu : il y a 5 secondes/);
  assert.match(connectionBadgeView("live", now - 180_000, "fr", now).detail, /il y a 3 minutes/);
  // A device clock behind the server must not produce "dans 10 secondes".
  assert.doesNotMatch(connectionBadgeView("live", now + 10_000, "fr", now).detail, /dans/);
  assert.match(connectionBadgeView("live", now - 5_000, "ar", now).detail, /آخر حدث/);
});

test("screen-reader description does not change with every live event", () => {
  const now = Date.UTC(2026, 9, 11, 6, 0, 0);
  const first = connectionBadgeView("live", now - 1_000, "fr", now);
  const later = connectionBadgeView("live", now - 42_000, "fr", now);
  assert.equal(first.description, later.description);
  assert.notEqual(first.detail, later.detail);
  assert.doesNotMatch(first.description, /Dernier événement/);
});

test("the badge stays presentational: it does not import the live hook (the shells do)", () => {
  const sources = [read("src/components/ui/ConnectionBadge.tsx"), read("src/components/ui/connection-badge.ts")];
  for (const source of sources) assert.doesNotMatch(source, /from\s+["'][^"']*use-live["']/);
});

// ---------------------------------------------------------------------------
// Brand: Santetrace in visible shells and metadata, internal identifiers kept
// ---------------------------------------------------------------------------

test("manifest is branded Santetrace with the brand blue", () => {
  const manifest = JSON.parse(read("public", "manifest.webmanifest")) as Record<string, unknown>;
  assert.match(String(manifest.name), /^Santetrace/);
  assert.equal(manifest.short_name, "Santetrace");
  assert.equal(manifest.theme_color, "#005eb8");
  assert.doesNotMatch(JSON.stringify(manifest), /HackCure/);
});

test("root and patient metadata name the application Santetrace", () => {
  for (const file of ["src/app/layout.tsx", "src/app/patient/layout.tsx"]) {
    const source = read(file);
    assert.match(source, /applicationName: "Santetrace"/, file);
    assert.doesNotMatch(source, /HackCure/, file);
  }
});

test("visible shell and sign-in copy no longer mention the previous brand", () => {
  const files = [
    "src/components/layout/BrandMark.tsx",
    "src/components/layout/ClinicianShell.tsx",
    "src/components/auth/SignInScreen.tsx",
    "src/components/auth/sign-in-copy.ts",
    "src/lib/client/i18n.ts",
    "src/lib/client/copy/access.ts",
  ];
  for (const file of files) {
    assert.doesNotMatch(read(file), /HackCure/, file);
    assert.doesNotMatch(read(file), /Sentetrace/, file);
  }
  assert.match(read("src/components/layout/BrandMark.tsx"), />Santetrace</);
});

test("service worker still never caches the API and keeps its internal cache prefix", () => {
  const sw = read("public", "sw.js");
  assert.match(sw, /const PREFIX = "hackcure-";/);
  assert.match(sw, /\/api\/\*\* is NEVER cached/);
  assert.match(sw, /if \(isApi\(url\)\) return;/);
  assert.match(sw, /<title>Santetrace — hors ligne<\/title>/);
});

// ---------------------------------------------------------------------------
// Tokens: NHS-adapted values under unchanged names
// ---------------------------------------------------------------------------

test("tokens keep their names, use the NHS blue accent and drop the editorial serif", () => {
  const tokens = read("src/components/ui/tokens.css");
  assert.match(tokens, /--color-accent: #005eb8;/);
  assert.match(tokens, /--color-bg: #f0f4f5;/);
  assert.match(tokens, /--color-surface: #ffffff;/);
  assert.match(tokens, /--font-display: var\(--font-sans\);/);
  assert.doesNotMatch(tokens, /Iowan|Palatino|Georgia|Book Antiqua/);
  for (const name of ["--color-rail", "--color-status-red", "--color-status-orange", "--color-status-unknown", "--touch-min", "--patient-max"]) {
    assert.match(tokens, new RegExp(`${name}:`), name);
  }
});

test("text inputs never render below 16px (no iOS zoom)", () => {
  assert.match(read("src/components/ui/Control.module.css"), /font-size: max\(1rem, var\(--text-md\)\);/);
});
