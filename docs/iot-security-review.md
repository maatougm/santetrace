# IoT software security review

Review date: 2026-10-11. Review-only work; no production code, credentials, runtime configuration, live database, or device hardware was modified or inspected. The `security-review` skill and repository `AGENTS.md` were applied.

## Status

**Final verdict: APPROVED for the frozen software scope below.** Both actionable findings were remediated and independently rechecked; no remaining P0/P1/P2 security issue was identified in this scope. This approval is limited to source/software verification. Hardware BLE/profile/association, Wi-Fi, power-loss recovery, and physical flash protection remain unverified because no ESP32 or glucometer was available.

## Resolved findings

### P1 — Device bearer upload receipt discloses unrelated patient monitoring

- **Resolved:** the frozen bearer branch now returns only `{ measurement: receipt.measurement }` after the unchanged ingest/auth/replay checks (`src/lib/monitoring-http.ts:99`–`:101`, SHA-256 `5aa3b29c7dd8f120690531401b80903458fb64e0c40b27a7fff67358262e2fb3`). A separate disposable-memory HTTP reproduction confirmed no unrelated BP value appears in either first or duplicate receipts, while internal monitoring still contains the synthetic BP reason. The dedicated regression verifies all-kind rule snapshots are withheld even when the submitted glucose event raises an alert, plus current revocation/conflicts and the full authenticated owner simulator receipt. **Final P1 verdict: APPROVED for this exact backend freeze.**
- Original location: `src/lib/connector-service.ts:104` (`d148b1dbbb33175037ba1f4254347383515b810a84ffff0fc52ed29b9739aac0`), returned without projection by `src/lib/monitoring-http.ts:99` (`68c120ab00334951c697f28da9fcbaecd80e45bec4ce8b1b2686ca1dee72df9d`).
- A connector credential can POST without a user cookie. `capture()` returns the full `MeasurementReceipt`, including `monitoring`; `ingestReading()` computes that state from all the patient's conditions and measurements (`src/lib/care-service.ts:58`, `:63`, `:109`), and `aggregateMonitoring()` joins all evaluation reasons (`src/lib/monitoring-evaluation.ts:201`). Those reasons include numeric readings for other measurement kinds. An alert receipt also contains the patient's complete `rulesSnapshot` (`src/lib/care-service.ts:106`).
- Reproduction: in a disposable `fixtureStore()` using only synthetic records, an owner recorded BP 171/81 and an active hypertension plan, then a glucose-device bearer submitted 120 mg/dL. Its receipt's aggregate reasons contained the unrelated BP value `171 mmHg`. The reproduction used no network socket, live database, model/provider request, or printed credential. The successful existing tests do not assert this response boundary.
- Impact: a device's upload credential has a patient-wide monitoring read capability although the documented contract describes an upload binding without access to the medical record. A compromised or externally provisioned device can learn other condition readings and care thresholds through an ordinary upload.
- Minimum fix: project the bearer-only HTTP response to `{ measurement }` (or an equally narrow submitted-event receipt). Preserve server computation and owner-authenticated simulator receipts. The gateway verifies only `receipt.measurement` (`firmware/contour-gateway/src/main.cpp:259`); it does not consume aggregate monitoring or alerts. Keep the receipt `no-store` and enforce current binding/consent before idempotent replay as today.
- Required regression: use two kinds of synthetic patient evidence; assert the bearer POST and its duplicate return only the submitted-event receipt, with no aggregate monitoring, unrelated numeric values, alert history, or all-kind rule snapshot. Confirm owner simulator behavior and the existing gateway rehearsal still work.

### P2 — Confirmed connector revocation does not clear its one-time UI credential

- **Resolved:** the confirmed/current fenced revoke callback now dispatches `connector_revoked` with the returned server connector ID before updating/reloading the list (`ConnectorsCard.tsx:145`–`:150`, SHA-256 `a16978e32af7f93d00028b7d9c7b98ad8d9fe3693d7eee9c943f97bd8311fcf5`). The credential is bound to that immutable connector ID; the reducer clears only its matching ID (`credential-state.ts:82`–`:83`, SHA-256 `1305987ec9ca144955a37070a448410a0832a9f6cee3d75321b5d4f22a06950d`). A late revoke of an older/different binding cannot erase a fresh pairing's secret even if the device name is reused. Missing server IDs fail closed; null replay, stale/failure, and scope/fence/denial rules remain intact. **Final P2 verdict: APPROVED for the final 27-file frontend freeze.**
- Original frozen location: `src/components/patient/devices/ConnectorsCard.tsx:145`–`:148`, SHA-256 `fe63444f4b0db7cfe40d0ca3aa733b22d2b1297ab9f0ad7f33c85357a552aa38`, from `.orchestration/sentetrace-redesign/iot-ui-freeze/files/`.
- Reproduction from the callback and reducer: pair a connector, reveal its credential, then successfully revoke that connector. `onRevoked` updates the list and closes the dialog but never dispatches a clearing action. The existing credential state has no connector ID, and connector revocation does not move the patient authority fence. The secret can therefore stay revealed beside the revoked row until acknowledgment, unmount, or a separate access-context change.
- Impact: unnecessary retention/display of an invalidated sensitive credential, with misleading provisioning state. The server correctly rejects the revoked token before replay, so this is not an authorization bypass.
- Fix: clear the shown credential after a confirmed revoke (clearing any held credential is the smallest safe change), or carry its connector ID and clear on that connector's successful revocation. Add one focused revoke-lifecycle check.

## Reviewed safeguards

- Pair/list/revoke require a current enabled patient owner. Pairing issues a random 32-byte bearer once, persists only its hash and connector ID for replay, and strips `credentialHash` from public connector projections. Body fields cannot choose patient, source, connector identity, or simulation provenance.
- Bearer parsing requires the exact 43-character base64url format. A bounded per-credential/global throttle exists; malformed JSON is size-bounded. Current connector enablement, owner account enablement, and patient consent are checked before duplicate receipts. Event content mismatches under the same idempotency key conflict.
- Firmware admits a configured BLE service/address/type, then requires an encrypted and authenticated identity match before subscribing. Numeric confirmation is refused; the configured passkey is injected only in the authenticated pairing flow. All measurement/context/RACP subscriptions precede the RACP read.
- Firmware rejects insecure endpoints, uses `setCACert`, and disables redirects before attaching the bearer. The installed ESP32 TLS implementation enables required chain verification and hostname verification when a CA is supplied. Responses are bounded, including chunked bodies, and their measurement identity, provenance, time, value, unit, and quality are verified before ACK/delete.
- Outbox rows bind to the configured meter/epoch/credential and use temporary-file verification plus rename. Checkpoint binding and ACK are encoded in one integrity-checked NVS blob; ACK persistence precedes row deletion. An irreversible atomic overflow barrier prevents further admission/processing/checkpoint advancement and causes persistent quarantine. The two P1 transport findings from the code reviewer were already remediated in the firmware reviewed here.
- UI credentials remain in component memory, are masked until explicit reveal, are absent from storage/URLs/logs/outbox/runtime context, and are discarded for stale pairing responses or patient/fence/authority changes. Acknowledgment clears them. Setup copy accurately distinguishes a server binding from a verified physical connection.
- No hardcoded production credential was found in the scoped source. Provisioning examples use explicit placeholders. The rehearsal replaces its own process session secret, uses an in-memory store, and prints a fixed failure message rather than an assertion that could contain a bearer.

## Verification

Independently run:

- `node --import tsx --test tests/care-device-connectors.test.ts tests/care-connectors.test.ts tests/iot-glucose-decoder.test.ts`: **30/30 passed**, including the isolated ingestion rehearsal.
- In the Claude worktree: `node --import tsx --test tests/frontend-patient-devices.test.ts tests/frontend-access-fence.test.ts tests/frontend-session-purge.test.ts`: **53/53 passed**. All 27 worktree delta files matched the immutable frontend manifest before this run.
- `npm audit --audit-level=high --json`: **0 known reported vulnerabilities** in the npm lockfile at review time. This is not a firmware dependency vulnerability audit. ESLint/security-plugin is not installed in the project's toolchain; a source-pattern review was used without downloading or changing dependencies.
- Independent disposable-memory reproduction of P1: **unrelated BP value exposed = true**; only Boolean metadata was printed.
- Final backend recheck: `node --import tsx --test tests/care-connector-receipt-http.test.ts tests/care-device-connectors.test.ts tests/care-connectors.test.ts`: **20/20 passed**, including the unchanged gateway ingestion rehearsal. The regression file hash was `4868e049c2a2dc37659a25eaa08640aa0a4b05da90ea176deb8f9a55d46c8975`.
- Independent HTTP recheck of the original P1 scenario at the final backend freeze: **bearer keys = measurement only**, **unrelated BP value exposed = false**, **duplicate receipt identical = true**, **internal monitoring preserved = true**. No cookie, live database, sockets, providers, or printed bearer were used.
- Final UI recheck in the Claude worktree: `node --import tsx --test tests/frontend-patient-devices.test.ts`: **29/29 passed**, including same-binding revoke clearing, different-binding preservation, reused-name/new-binding late-revoke isolation, null replay, missing ID, stale/error outcomes, and callback wiring. All 27 final immutable/current-worktree file hashes matched the final manifest, and exactly the expected three files changed from the initial freeze. The firmware main source and final backend/regression hashes were rechecked unchanged during this final pass.

Existing firmware evidence was reused instead of duplicating the build and sanitizer runs: worker reports 62 decoder assertions, 229 transport assertions with ASan/UBSan, and an actual PlatformIO ESP32 compile. This review does not convert those checks into a physical-device validation.

## Frozen scope identifiers

Firmware source freeze supplied by its worker and independently matched:

| File | SHA-256 |
| --- | --- |
| `firmware/contour-gateway/src/main.cpp` | `55385cb932d2bf65f7474d5dcdbfd91245d9cf8a2c752cfa2acba1e7dd938a7d` |
| `firmware/contour-gateway/include/glucose_decoder.h` | `4b842c629deecacd2832be786e447b0a130c179164eb8eba1088603207be8f20` |
| `firmware/contour-gateway/include/transport_safety.h` | `4446644ab83e97e06dff7224978de8f8c23b7ac97dcdfde87521a6347cbb5d2d` |
| `firmware/contour-gateway/platformio.ini` | `7deae8c2dbc92d29657e2c44face75c8e507444e3113d7fdc8e516e79edd563d` |
| `firmware/contour-gateway/config.example.json` | `f3b0e1a72e0a8cc8c558de0969bb08050806b310eead490f822650720d2e8e7e` |
| `firmware/contour-gateway/tests/transport_test.cpp` | `b706d61a76ecc70fa6bc516a5e0176fed00ac575311516bacd245d876ab70d92` |
| `src/lib/iot/glucose-decoder.ts` | `15260623de85a555f5eea963aa6dd5c44e3aa676c88fe4d40316391790e080cd` |
| `scripts/rehearse-device-ingress.ts` | `21da3c9b568cc75a74d705ff8fe1721dd24c193094ff2d78de4f98177df6ef7b` |
| `src/lib/connector-service.ts` | `d148b1dbbb33175037ba1f4254347383515b810a84ffff0fc52ed29b9739aac0` |
| `src/lib/monitoring-http.ts` (final P1 fix) | `5aa3b29c7dd8f120690531401b80903458fb64e0c40b27a7fff67358262e2fb3` |
| `tests/care-connector-receipt-http.test.ts` | `4868e049c2a2dc37659a25eaa08640aa0a4b05da90ea176deb8f9a55d46c8975` |
| `src/lib/care-http.ts` | `2d054f2817cc1b2563949a56f5ba51f7e3b9b62efaa2321c1fbb402587973e08` |
| `src/lib/care-session.ts` | `b16033dea72135c72d7da2d263009ec33ee5cc37e2195acad3232df40067306a` |
| `src/lib/patient-access-service.ts` | `14dfd99d5ca598c3a07a97012854f4e88e1ba3c69b1acd396d4b98f2312f960d` |
| `src/lib/care-service.ts` | `87ff288b9b0432667fca8f6904fd70d849dec4d65ddc1a3bdd7cb1c48277fc92` |
| `src/lib/monitoring-evaluation.ts` | `9a371d631d39a32978ce312cae377db179a78dcc9894a4e2d4fc52c3a884117c` |
| Frontend `src/components/patient/devices/ConnectorsCard.tsx` | `a16978e32af7f93d00028b7d9c7b98ad8d9fe3693d7eee9c943f97bd8311fcf5` |
| Frontend `src/components/patient/devices/credential-state.ts` | `1305987ec9ca144955a37070a448410a0832a9f6cee3d75321b5d4f22a06950d` |
| Frontend `tests/frontend-patient-devices.test.ts` | `f00e0e4ab7178c87df68cad6c4b84d168fddd6d92e5bd714fa257b396ef1131b` |

The final frontend verdict applies only to the 27 immutable files and hashes in `.orchestration/sentetrace-redesign/iot-ui-final-freeze/manifest.json`, manifest SHA-256 `b2ad9a56d6c2e5fc9d049ef0f3217a91a1cb2d4795b4105eb08b10c48fffe31b`. All 27 frozen hashes were verified. Its three changes from the original 27-file `iot-ui-freeze/manifest.json` (created 2026-10-11T07:01:21Z) are listed above; the other 24 reviewed files are byte-identical. The initial delta was compared with `iot-ui-before/` and `iot-ui-baseline.json`. The final scope is the frozen firmware source hashes, backend source/regression hashes, and this final frontend manifest; the verdict must be rechecked if those files change.

## Deployment limits

The prototype explicitly stores its Wi-Fi secret and bearer in NVS and measurement bodies in LittleFS without application encryption. Secure Boot, Flash Encryption/NVS Encryption, secure recovery, and physical validation are documented deployment prerequisites, not verified protections in this review. No claim of readiness for production medical use, validated Contour interoperability, or real BLE delivery is made.
