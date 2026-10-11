# IoT UI independent code review

**APPROVE the final 27-file immutable freeze at manifest SHA-256 `b2ad9a56d6c2e5fc9d049ef0f3217a91a1cb2d4795b4105eb08b10c48fffe31b`. No remaining findings.**

The 27-file immutable freeze `.orchestration/sentetrace-redesign/iot-ui-freeze` has manifest SHA-256 `0710d3487d58417934f1b3ec46a068055ab816228709400d351f4115af959f7a`. All 27 frozen file hashes matched before and after verification. All 538 baseline files were verified against `iot-ui-baseline.json`. Git staged/unstaged changes were inspected; approval is bound to the immutable freeze rather than the changing worktree.

## Resolved finding

[MEDIUM/P2 — RESOLVED] A confirmed connector revocation previously left its one-time credential visible and retained in component state.

File: `src/components/patient/devices/ConnectorsCard.tsx:143` (initial frozen revision).

The `onRevoked` callback updates the row and reloads the list but never clears the credential reducer. A displayed/revealed secret for that same connector therefore survives a successful revocation. The backend correctly revokes the token; this is a frontend credential-lifecycle issue, not an authorization bypass. Clear the credential only after a current, confirmed revocation of the connector that owns it, and cover same-connector versus another-connector behavior. The dedicated security reviewer found this independently; the final Claude fix has now been independently verified. The reducer retains the server connector ID and clears only a matching confirmed current revoke. A different connector, or a newer binding with the same reusable device name, retains its own secret. A pairing without a server connector ID exposes no new secret. Seven meaningful regressions exercise matching/different/re-paired binding, null replay, missing ID, stale/failed result and actual component wiring.

## Reviewed behavior

The explicit real-device pairing submits exactly `{deviceId, kind:"device", clientId}` and uses the existing access fence. It creates a server binding, with FR/AR text clearly distinguishing that from a verified Bluetooth/physical connection. Simulated readings can select only enabled simulator bindings; physical bindings cannot be used to send simulated readings. Pair retries retain the idempotency key for the same kind/name. The returned credential stays in component memory, masked until explicit reveal, with no storage/log/URL/clipboard path. Patient/fence-key changes, epoch moves, access denial and acknowledgement clear it; stale asynchronous pairing cannot restore it. Pending revoke operations remain fenced.

Consultation metadata is independently parsed and rebuilt before display. Unknown/malformed metadata, unsafe identifier controls/bidi characters, unknown failure values and a contradictory `consulted` plus failure reason are rejected. Source counts and duration are nonnegative safe integers. Model names come from actual returned metadata and are rendered as escaped isolated text. Missing metadata makes no specialist claim. Experimental selection, human review and lack of diagnostic/treatment authority remain visible. A valid score survives invalid optional metadata. The existing primary-managing-clinician eligibility, fail-closed current revision guard, explicit generation POST, source display and queue order remain unchanged.

The queue patient link is one keyboard stop with a 44px minimum target. Device CSS uses logical RTL properties, wrapping forms and selectable secrets that wrap. This source review does not substitute for browser layout testing or physical hardware verification.

## Independent verification

Isolated snapshot: `/var/folders/s6/nvkhyq3d5yd07knvyfk5v9800000gn/T/santetrace-iot-ui-review-zu4_2okv`. It overlays the verified baseline with all 27 frozen files; seven separately owned backend/dependency files whose MAIN versions had advanced were restored from MAIN for current integration compatibility. No env, secrets, database, runtime or build output was copied or modified.

- New device, consultation and existing brand suites: **49/49 passed**.
- Existing `frontend-doctor-ai-case-score.test.ts`: **22/22 passed**.
- Strict `node node_modules/typescript/bin/tsc --noEmit --incremental false`: **exit 0**.
- All 27 reviewed frozen source hashes remained unchanged after verification.

No product source edits or runtime changes were made by this reviewer. Final verification reconstructed `.orchestration/sentetrace-redesign/iot-ui-final-freeze` over the retained isolated snapshot. Exactly three files changed from the initial freeze: `ConnectorsCard.tsx`, `credential-state.ts` and `frontend-patient-devices.test.ts`; the other 24 hashes are identical. The current approved HTTP receipt dependency/test was copied into the isolated snapshot as well. **All 78/78 focused tests passed** (29 device, 15 consultation, 12 brand and 22 doctor-score), with **fresh strict TypeScript exit 0**. All 27 final frozen/tested hashes matched before and after verification.

## Approved final freeze hashes

| File | SHA-256 |
|------|---------|
| `src/lib/client/doctor-api.ts` | `dc40a416e1df501ae6055b8e437de905922447f1a2dfba8023765347994c2e7f` |
| `src/lib/client/devices-api.ts` | `d79940cbcb01cf20d04e554c1614ba76d244c451452548f9104f13c6eda506cf` |
| `src/lib/client/copy/share.ts` | `11653d422d9aefbd7bb0f1f74efc49a8b98b2a05f52e6e6db970556a8cd93ecf` |
| `src/components/patient/devices/pairing-logic.ts` | `e265f6c7a54a643c45cacb55de6df2d21affe28c6ac00e8dabc51f85856db611` |
| `src/components/patient/devices/CredentialNotice.tsx` | `f1bf651e3acd688657d8d47a76a1f9023bb6021ea0acf2c2ea1b97238e21f7aa` |
| `src/components/patient/devices/devices.module.css` | `602ffcdffccd235bec430ee56fb587de03d38315178f38e8109e5b4d5a3ad61d` |
| `src/components/patient/devices/PairForm.tsx` | `e7e8107664e45a5faa595c13472b70ee64d11c9881f81f68b716dec2940d95c8` |
| `src/components/patient/devices/ConnectorsCard.tsx` | `a16978e32af7f93d00028b7d9c7b98ad8d9fe3693d7eee9c943f97bd8311fcf5` |
| `src/components/patient/devices/simulator-logic.ts` | `7d9c733ab3ecc0ba03889d1c6a68dad0e52ee23c960a8e2483349ee3b70fb269` |
| `src/components/patient/devices/SimulatorPanel.tsx` | `990a866c5b9a399fe1213705f3c24c33eb4847b1484ff2d08fea7d519f8bd7c1` |
| `src/components/patient/devices/DeviceSetupGuide.tsx` | `8257463ab1a8f9962609ce0fa5358d2fc10e0c47ccc08b63d7bc6af14c5c9e6b` |
| `src/components/patient/devices/ConnectorRows.tsx` | `28f5cc6dbbe56d69cc41bfb5e8d5a47abe954e61cca8d877b6838574ea3e5256` |
| `src/components/patient/devices/device-setup.ts` | `e069b78ff093b9291977889ee4af0c543cf4480fb5cfdfee64bba97892bb9903` |
| `src/components/patient/devices/SimulatedReadingCard.tsx` | `f8f4b9a130cc7f03f9cfe955c7a66a0dc49e3ef8d374803e4723daef25cf3632` |
| `src/components/patient/devices/credential-state.ts` | `1305987ec9ca144955a37070a448410a0832a9f6cee3d75321b5d4f22a06950d` |
| `src/components/doctor/record/AiCaseScoreCard.tsx` | `2e4fd24222cd5473cdfd421eda644036dcbf9a6c8e4e2f6e437ee87251b907b4` |
| `src/components/doctor/record/AiScoreDetails.tsx` | `a1311595e65a07ac611bdd857be49327d203ed9f8700eaae312cd5ef8a220275` |
| `src/components/doctor/record/ai-case-score-view.ts` | `a96a0385ca569fbafe50fe2119a2ddaa56de0ab27549aeab738de1b502cb9507` |
| `src/components/doctor/care/ConsultationProvenance.tsx` | `6bc444533ee27987b0f47d4b064bd53eeadb45533ee47fa5b1da721ddccdc779` |
| `src/components/doctor/care/AiMetaLine.tsx` | `c0158d7ddf9715e95b1fac15cbdeb832ea68356239237104de806697052b6fa1` |
| `src/components/doctor/care/consultation-view.ts` | `ab1b955f0f1a2b60250d2267d61348da6f8035685c194fa23995393e4b374041` |
| `src/components/doctor/care/ConsultationProvenance.module.css` | `9ba9ad02a96fd01ca2a0d9872bf2bde2fa313e7edb13aa322b48e6b4c725a2ff` |
| `src/components/doctor/dashboard/Dashboard.module.css` | `2652d440fc535105e5ee5d7f01e39ddceaab1ccf0923519ed49f0a74a4ac32ec` |
| `src/app/patient/measure/devices/page.tsx` | `f67696d26cfed3b232c8ff9098c8f5e712f0d1efd8969476efe7b9304606b93d` |
| `tests/frontend-brand-shell.test.ts` | `3fdb59452013823288732a0ee1f6e1c8239b259f6c198b1653ce836df4a80355` |
| `tests/frontend-patient-devices.test.ts` | `f00e0e4ab7178c87df68cad6c4b84d168fddd6d92e5bd714fa257b396ef1131b` |
| `tests/frontend-doctor-consultation.test.ts` | `6be0d26000a57fdf80b921c3e76d06efe89c7de1f72d9545544b2ec7f8e4b13d` |

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 open (1 resolved) | pass |
| LOW | 0 | pass |

Verdict: APPROVE — exact final manifest and hashes above; no CRITICAL/HIGH issues or unresolved findings. This approval covers code and focused software verification, not browser/hardware validation.
