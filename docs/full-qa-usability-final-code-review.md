# Final code review: usability corrections and post-submit focus

Reviewed on 2026-10-11 after root confirmed the freeze, both native reports existed, and the native jobs had exited. Beforeimage: MAIN at `/Users/bigmo/Documents/ChatGPT/hakathon`, containing the previously approved 66-path frontend candidate. Candidate: `.claude/worktrees/claude-frontend-006`. Ownership is this report only; no application source was changed by this reviewer.

**Verdict: APPROVE for the 16 assigned follow-up paths.** No confirmed CRITICAL, HIGH, MEDIUM or LOW findings. Final production build and browser acceptance remain root-owned; this is code approval of the sealed source snapshot.

## Scope and context

Read `docs/full-platform-usability-final.md`, `docs/full-qa-dialog-postsubmit-triage.md`, and the native completion reports `.orchestration/full-qa/claude-usability-report.md` and `claude-postsubmit-focus-report.md`. Reviewed full changed components and their surrounding score, reminder, message-thread and review-dialog call sites against MAIN, rather than the worktree's unrelated Git base.

The installed Next guides previously read for this same frontend review remain applicable: internationalization, the `use client` directive, and CSS ordering/production behavior under `node_modules/next/dist/docs/`. These follow-up changes introduce no routing API or server/client boundary change.

## Behavioral review

- **Current-section jump:** the labelled native phone button has a 44px minimum target, a wrapping 16px label and an explicit `aria-controls`. The label uses the exact current localized section name across all 13 options. Its callback only calls the existing `revealPanel(panelRef.current, true)`; it does not change the section/hash, mount another panel, reload data, request AI, or create a message-read effect. The native select still keeps focus, reduced motion uses instant scrolling, and clinical cards/notices remain in their existing positions. Desktop presentation and access rules are unchanged.
- **Unavailable score reason:** the existing `scoreUnavailableText(view.text, lang)` supplies the visibly rendered reason and its actual language/direction. Known reasons localize; unknown French source stays verbatim French/LTR. The dash is hidden from assistive technology and the visible reason occurs once, with the old tooltip/hidden duplicate removed. Wrapping uses existing tokens. Genuine values, numeric units, eligibility, queue filtering and ordering are unchanged.
- **Reminder guidance:** the shared note now explicitly distinguishes medication declaration here from a plan action followed in the plan. Medication cards retain “Votre déclaration”; plan cards receive the neutral “Action du plan” label in French/Arabic. The immutable declaration notice, medication “Pris / Pas pris”, plan state/alert note, server-authored titles, notification delivery and outbox/pending/failure paths are unchanged.
- **Post-submit focus:** only `ReasonDialog` opts in to the generic Dialog fallback, and only a marked message ancestor can be captured. Both opener and fallback DOM nodes are recorded once before `showModal`; there is no lookup after the answer/close. The same keyed message `li` remains programmatically focusable with `tabIndex={-1}` after its review button disappears. The fallback requires a disconnected opener, a connected captured message and lost focus; a live element/new modal wins, detached actor/patient targets are skipped, and connected-dialog Strict Mode cleanup consumes nothing. Normal connected-opener return, microtask deferral, native close veto/re-sync, backdrop rules, busy guards, failure/conflict behavior and clinical review request/fence semantics are preserved.

No automatic AI invocation, new read receipt, clinical/action/risk-order change, access-capability change, dependency, or backend change is introduced by these paths.

## Independent verification

Executed against the frozen worktree with `APP_ORIGIN` removed, without loading actual environment files or using an app/database runtime:

```sh
env -u APP_ORIGIN node --import tsx --test tests/frontend-record-navigation.test.ts \
  tests/frontend-doctor-queue.test.ts \
  tests/frontend-doctor-queue-filter.test.ts \
  tests/frontend-doctor-ai-case-score.test.ts \
  tests/frontend-doctor-score-cell.test.ts \
  tests/frontend-patient-reminders-copy.test.ts \
  tests/frontend-care-reminders.test.ts \
  tests/frontend-outbox.test.ts \
  tests/frontend-dialog-focus.test.ts \
  tests/frontend-care-review.test.ts \
  tests/frontend-source-language-attrs.test.ts \
  tests/frontend-clinician-locale.test.ts
env -u APP_ORIGIN node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Focused result: **200 tests, 200 pass, 0 fail, 0 cancelled, 0 skipped**. TypeScript exited **0** with no diagnostics. The focused suite exercises navigation/count/access invariants, queue/score semantics, reminder branch behavior, outbox identity/immutability, review guards, focus fallback loss/connectivity/Strict Mode/new-modal cases, and language boundaries.

The focus decision tests execute the actual pure helper. Component wiring and CSS tests inspect source; they do not replace browser proof of native dialog timing, visible focus rings, phone wrapping, or reduced-motion behavior. Root already owns the integrated suite, production build, responsive FR/AR browser checks, and actual successful-review/Cancel/Escape/error/busy flows.

## Exact sealed hashes

The 16 candidate path hashes and their MAIN beforeimage hashes were identical before and after the focused checks/typecheck. Fifteen assigned paths modify the approved beforeimage; `tests/frontend-doctor-score-cell.test.ts` is new.

Candidate aggregate SHA-256: `864aebd7420586c6d5b1e353dc88c3115896b5d56971416ba9cd127aeb6a4303`.

Aggregate input: sorted candidate records, each exactly `<sha256>  <repo-relative path>\n`.

### Frozen candidate

```text
480d1309476bee670ed11fbfc2e72d4b32e407397eab9fb4a836b9c8c98502dc  src/components/doctor/comms/MessageItem.tsx
943eb9c7008a565b81c4076aa225e4aecad8063ff0d110cae0759b308bfcbfc1  src/components/doctor/comms/ReasonDialog.tsx
62ffef9dac7bcad49a0accea143dc1ea8e1fee6118afa1961649f3d2a08574ee  src/components/doctor/dashboard/Dashboard.module.css
e2e71cff07ff2a4a24249ebe864013757d36188af14ad255ae8a3cc0e01051a8  src/components/doctor/dashboard/ScoreCell.tsx
64f6e35fbe952e1412d5b7024306a9c6cc16f465af561e76484d81976290db54  src/components/doctor/record/PatientRecordView.tsx
454b6fa36ffd048552d302682963cfa9035704d22de90c957fb56fb34cd8ee74  src/components/doctor/record/RecordSectionNav.module.css
80ce801c9c5664b0c72bcc483e05eaefaadc344e986977bd13339dbdefca50f4  src/components/doctor/record/RecordSectionNav.tsx
5652f64d54e8296c0c6947551eb52fab5245fe1fa8614a6b36bbf8a894367011  src/components/doctor/record/record-nav-copy.ts
a467936d30109dcb6a2bc78da24a2cc2adc3797b5d51dcd197ffb52c59e8ef62  src/components/patient/RemindersScreen.tsx
6fc93084431f360e23e9b132e1255477704d4a4aa646e429ef4a3fbdacd6d976  src/components/ui/Dialog.tsx
d1b5a8a8749accf1677452c584c85e58b779d502eff6c8aa4708e011e39847ab  src/components/ui/focus-return.ts
d1121e21bcb940f405eaf64080bc6179ab24ecf23d5cd49cd375afce060f75f7  src/lib/client/copy/assist.ts
f1b0c8a76d2c330a388a7802142bd08d7256cf4915fa538a8e10870ac51bc82b  tests/frontend-dialog-focus.test.ts
c6001fe52b6779b69ed12b0a043b2c952cc630d63f9a154fb34a3abf61eb348c  tests/frontend-doctor-score-cell.test.ts
ea49410e8841e3fc3dca3df27c612c5d75621c398656cf62623f812785d350b4  tests/frontend-patient-reminders-copy.test.ts
c2b96268774e8852d58af23e0b5714c4cff2836f24348402aba79f4b9a830d21  tests/frontend-record-navigation.test.ts
```

### MAIN beforeimage

```text
e95279cb52d2522435819406b012538acd5afff0cb1d6a7e10851c9c903679a8  src/components/doctor/comms/MessageItem.tsx
888a222b2413b22fd76ff42702c598bab6b87ff6b3d35d3951a9661967d3a3d1  src/components/doctor/comms/ReasonDialog.tsx
b22e8f1e4f4d0cf66d7d2f424b9c966cb77d899757a0f5d4efdbe20385d71034  src/components/doctor/dashboard/Dashboard.module.css
e57c7598bbdc655d3539f02a1b0626c7c3fa2fd9641dee191800a868f7680fef  src/components/doctor/dashboard/ScoreCell.tsx
6f3b6895006e1e378b3ca0864c59de6432bb62e7bc54ef4fdc3249fda8474152  src/components/doctor/record/PatientRecordView.tsx
5a5cf585aa7f21ecc13a6325474c92b9a7b0e91f6605a3cfa2e3a2703d375b3e  src/components/doctor/record/RecordSectionNav.module.css
38b9a2f94085eb1d6938044fca11a3e76ce57054e239e9b4d674ef74abcd814c  src/components/doctor/record/RecordSectionNav.tsx
6e57b1ffb70589375bd13b520969c20cc9d914f000bfd87036a6273c6c93016a  src/components/doctor/record/record-nav-copy.ts
f203012e79b077e4d1bc8ed3367ea54cc06ee3888a103f4d3808b2a9a9073898  src/components/patient/RemindersScreen.tsx
e8b9f607643cb8a419c05a4ce69d464fcccd844e226ccce41885416a51b00813  src/components/ui/Dialog.tsx
829225d2d99c05ab7ff9ec9149d11b59bd21cba005734312cf409410d756319a  src/components/ui/focus-return.ts
363eeb93ce529cc3249f14f8f8bf601a9ded135ba6e71cb4e4a3ae66ceeecd2d  src/lib/client/copy/assist.ts
5e354da045ceea2ff9be3543b5d85f79f8564541fd3fd680cc12a0f1ba530bb1  tests/frontend-dialog-focus.test.ts
ABSENT  tests/frontend-doctor-score-cell.test.ts
65ee2e86b7fcb1b6d980e323cf2999bf0c2672d6cc7de81750cf73301e794455  tests/frontend-patient-reminders-copy.test.ts
2203f7403cde2a432b22ab4e7efb32170db584ec4f1ca043423fdf4f74984b6d  tests/frontend-record-navigation.test.ts
```

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: **APPROVE** — no confirmed issue in the assigned, frozen follow-up source. Apply only the sealed paths; final runtime acceptance is root-owned.
