# IoT software code review

**APPROVE the four TypeScript software files at the hashes below.** Firmware is reviewed separately in the final section and is not included in this approval.

Reviewed the full decoder, tests and rehearsal plus the existing connector service, HTTP handler, store and session call sites. Git staged/unstaged output was also inspected; the new files are untracked, so approval is bound to their content hashes.

## Decoder and ingress findings

No CRITICAL, HIGH, MEDIUM or LOW findings identified in the four-file delta.

The decoder checks exact length/flags before optional parsing, signed IEEE SFLOAT mantissa/exponent, special values, concentration presence, distinct kg/L→mg/dL and mol/L→mmol/L conversion, calendar validity, verified explicit timezone and signed sensor offset. Missing offsets require prior verified transfer context; arrival time is never substituted. Control-solution/reserved samples and clock faults are rejected. Sensor warnings, unverifiable context and unsupported valid sample sites remain suspect.

The event identity uses a meter fingerprint, explicit epoch, sequence, original calendar stamp and sensor offset; timezone/arrival time do not create a new retry ID. The unchanged generic ingress still validates units/ranges, binds provenance/ownership from the connector, deduplicates exact retries, rejects conflicting retries and checks consent/account/revocation before releasing a duplicate receipt.

Flag, time-offset and unit behavior was cross-checked against the primary [Bluetooth SIG Glucose Service v1.0.1, §3.1](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/GLS_v1.0.1/out/en/index-en.html). This is a reference decoder, not physical-device interoperability or clinical validation.

The rehearsal passes an explicit `:memory:` store to the request handler, creates only fictional test state, sets process-local generated session credentials, performs no fetch or socket call, and prints only fixed test metadata. The bearer token is not persisted or logged. Its `source=device` assertions exercise the physical binding branch inside the disposable test; the output explicitly says `physicalDeviceVerified:false` and `mode:isolated_software_test`.

## Independent verification

- `node --import tsx --test tests/iot-glucose-decoder.test.ts tests/care-device-connectors.test.ts`: **23/23 passed**, no skipped/cancelled tests.
- Full strict TypeScript, `node node_modules/typescript/bin/tsc --noEmit --incremental false`: **exit 0**.
- Rehearsal repeated with global `fetch` replaced by a hard failure: **passed**, one deduplicated in-memory measurement, invalid/revoked tokens rejected, original timestamp preserved and no physical-device claim. No app DB or model was used.
- Four file hashes unchanged after independent tests.

| File | SHA-256 |
|------|---------|
| `src/lib/iot/glucose-decoder.ts` | `15260623de85a555f5eea963aa6dd5c44e3aa676c88fe4d40316391790e080cd` |
| `tests/iot-glucose-decoder.test.ts` | `52ad85496528ed74430073acb8b1829b1a0384afa6537842515e146a8cd25623` |
| `tests/care-device-connectors.test.ts` | `9b0573ff397e40769a8b0b615512f783755778b3a69761e50bc55cc20fd4ffe0` |
| `scripts/rehearse-device-ingress.ts` | `21da3c9b568cc75a74d705ff8fe1721dd24c193094ff2d78de4f98177df6ef7b` |

## Ephemeral medical matrix safety review

Static-only approval was sent before execution for `/tmp/santetrace-medical-ai-scenario-matrix.ts`, initially SHA `df9c0983ea706abe80a383d703c3aeff915203b87d2a804664551ab3f80cd544`; the count-only diagnostic amendment at SHA `b4be46cb84e26f6c1be937c11d146ec9e5433c69236edcf9b2a3a4204ff0311b` was also approved.

The script runs separately with disposable stores; the authorized production-demo snapshot opens SQLite read-only and requires the chosen patient to be fictional before cloning into memory. It uses the reviewed provider factory, asserts redacted/aliased prompts before dispatch, bounds actual generation at 9 plus the prior diagnostic request, logs only closed metadata/counts and fixed reasons, and injects transport rejections without fabricating any accepted provider output. Cleanup unloads the exact specialist. Its contradiction-quality exception is explicit; `engineeringSuccess` is not synonymous with `allExpectationsPassed` or clinical accuracy. This reviewer did not run the matrix or read private environment contents.

## Medical consultation V2 — minimal backend delta

**APPROVE** the four-file strengthening against `.orchestration/sentetrace-redesign/medical-v1-before`:

| File | SHA-256 |
|------|---------|
| `src/lib/local-model.ts` | `9c3edf325002d5158810bd971cef39b0b1eb8fc73280c10835d0c1262e69b90a` |
| `src/lib/medical-consultation.ts` | `03dc8e3abe77efa20bbcfa87f3c1d4aa7d15507890d8e1e80bc14002f01cccd5` |
| `src/lib/generation-identity.ts` | `c4ffa8692410a5b86e08481944706579ebde47cfdc49bef8afee135b3c6f83ca` |
| `tests/medical-consultation.test.ts` | `a76917771b99c9b08914a8321c5c6d741c6b5be50ef32568c7ddd17f901627ac` |

The medical advisory now requires **empty `questionIds`** in the Ollama schema, instruction and post-validation bound. Claims remain limited to three and proposals remain empty. `groundedSchemaFor` creates a fresh cloned schema, so these advisory restrictions do not mutate the brain's schema or question path. Evidence grounding and authority checks remain unchanged. `source-bound-medical-consultation-v2` is included in both generated and configured pipeline identities, invalidating V1 cached output. New regressions reject both a single otherwise valid question and the duplicate enum case observed during the actual model run.

Independent verification: **85/85 targeted tests passed** across medical consultation, medical evidence, monitoring AI, NVIDIA and case scores; **fresh full strict TypeScript exit 0**. All four reviewed source hashes remain unchanged after tests. No runtime/model activation was performed by this reviewer, and this approval does not claim clinical accuracy.

## Firmware — corrected source and final limit adjustment approved

**APPROVE the corrected frozen source below. No remaining findings.** The worker completed the genuine final ESP32 build; this reviewer independently verified the resulting binary hashes. Physical interoperability remains unverified.

The initial source at main.cpp SHA `b8b78d2b4f54760ca9d16fcfca0c3ad7a856efa922ee1fa9c0b9c5d39897bc21` had two HIGH/P1 findings sent immediately to root and the firmware worker. Both are resolved in the approved revision:

1. **Non-atomic binding/ACK reset** (original `main.cpp:365`): setup wrote a new binding before separately resetting the old ACK, so a crash could reuse the previous meter's high checkpoint. The new `transport_safety.h` packs binding, sequence, format version and checksum into one 76-byte NVS blob. `saveCheckpoint` performs one `putBytes`, verifies the complete readback and decodes it before updating in-memory progress. Setup rejects corrupt blobs, refuses mismatched bindings with pending readings and initializes a new binding with `firstSequence-1`. Host regressions exercise old-meter ACK 65000 versus new first sequence 7, interruption before/after commit, pending rows and torn blobs.
2. **ACK could cross a dropped notification** (original `main.cpp:389`): callbacks could fill/drop/refill during the unchecked draining loop, then a later received record could advance the checkpoint beyond the missing one. The new irreversible atomic `TransportBarrier` is checked by callback admission, packet processing/draining, HTTP upload and pre-ACK commit. Overflow now stops processing, persists quarantine and retains pending files without advancing the checkpoint. There is no automatic reset/recovery that hides a lost frame. Host regressions cover dropped-N then every later sequence's processing/ACK gates and cross-thread callback visibility. Documentation now describes conservative operator review instead of automatic unsafe replay.

The complete reviewed gateway preserves owner-bound token provisioning, authenticating BLE association and fixed device identity, subscriptions before RACP, explicit meter-time policy and stable retry identifiers, context/sensor-quality restrictions, bounded persistent outbox writes with readback/rename, verified HTTPS with disabled redirects, bounded receipt reads and semantic receipt matching before ACK/deletion. Application logs use fixed status codes, with no bearer/PIN/reading/identity output. Quarantine and flash failures preserve pending data; storage is never automatically formatted. The configuration example requires explicit clock/history attestation and contains placeholders, not live credentials. The documented unencrypted prototype flash and absent physical-device testing remain stated limits.

Independent C++ compilation with strict warnings and AddressSanitizer/UndefinedBehaviorSanitizer:

```sh
clang++ -std=c++17 -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined -I firmware/contour-gateway/include firmware/contour-gateway/tests/decoder_test.cpp -o /tmp/santetrace-decoder-review-test
/tmp/santetrace-decoder-review-test
clang++ -std=c++17 -Wall -Wextra -Werror -pedantic -pthread -fsanitize=address,undefined -I firmware/contour-gateway/include firmware/contour-gateway/tests/transport_test.cpp -o /tmp/santetrace-transport-review-test
/tmp/santetrace-transport-review-test
```

Results: **62 decoder assertions + 229 transport safety assertions passed**, no sanitizer findings. These are independently run host software tests. The worker reported the final genuine PlatformIO build passing in 6.27 seconds, with 1,273,125 bytes of program flash and 56,608 bytes of static RAM, and LittleFS image generation passing in 4.31 seconds. This reviewer independently checked `firmware.bin` (1,279,696 bytes, SHA `81bc4dd1b0f8ad95e356cccfb1e2f2292ff4dc200420d89e534b13729dddeddc`) and `littlefs.bin` (1,441,792 bytes, SHA `0d3b2fb0250b24d14ae5ddf2ea5b0b893ff012a1bacb82a028e6e06bae4cfa24`) against the recorded build evidence. No glucometer/ESP32 hardware was supplied, and actual Contour compatibility, Wi-Fi/power-loss recovery on flash and radio integration are not verified.

The final configuration restriction is also **APPROVED**: `MAX_CONFIG` decreased from 12000 to 3800 bytes, with an explanatory NVS limit comment, and the CA maximum decreased from 7000 to 3000 bytes. Reversing exactly those two lines reconstructs the previously reviewed main.cpp SHA `2dbdf939e7ac5ea1d3fc07c7278c7e4efb4ae347d96251c41e2945e40c0df529`; no other source behavior changed. The final source and guide hashes below match the build evidence.

**Focused firmware security review: PASS for the software prototype at these hashes.** The checks cover authenticated BLE association with the configured identity, trusted-CA HTTPS without redirects, bounded and semantically verified receipts, fixed status logging without credentials or readings, physical USB provisioning, pending-data binding protection, explicit clock/history attestation, rejection of control/time-fault samples and durable checkpoint advancement only after an exact receipt. The pinned NimBLE `injectPassKey` logs a return code rather than the supplied passkey, and the project does not enable dependency debug logging. This is this code reviewer's focused security check; the separately assigned security reviewer provides an additional independent assessment. Prototype NVS/flash is unencrypted as disclosed, and no physical BLE, flash power-loss or device interoperability result is claimed.

| File | SHA-256 |
|------|---------|
| `firmware/contour-gateway/src/main.cpp` | `55385cb932d2bf65f7474d5dcdbfd91245d9cf8a2c752cfa2acba1e7dd938a7d` |
| `firmware/contour-gateway/include/glucose_decoder.h` | `4b842c629deecacd2832be786e447b0a130c179164eb8eba1088603207be8f20` |
| `firmware/contour-gateway/include/transport_safety.h` | `4446644ab83e97e06dff7224978de8f8c23b7ac97dcdfde87521a6347cbb5d2d` |
| `firmware/contour-gateway/tests/decoder_test.cpp` | `89531805ef97a5658a078a29c09f485cd9f18276cc191ef98991d702bd4fe0d1` |
| `firmware/contour-gateway/tests/transport_test.cpp` | `b706d61a76ecc70fa6bc516a5e0176fed00ac575311516bacd245d876ab70d92` |
| `firmware/contour-gateway/platformio.ini` | `7deae8c2dbc92d29657e2c44face75c8e507444e3113d7fdc8e516e79edd563d` |
| `firmware/contour-gateway/config.example.json` | `f3b0e1a72e0a8cc8c558de0969bb08050806b310eead490f822650720d2e8e7e` |
| `docs/iot-contour-gateway.md` | `219f4dab10993289333a6143c01948d890d7bc0ac4aaef1eb36c32e607998230` |

## Device bearer receipt — privacy fix

**APPROVE** `src/lib/monitoring-http.ts` SHA `5aa3b29c7dd8f120690531401b80903458fb64e0c40b27a7fff67358262e2fb3` and `tests/care-connector-receipt-http.test.ts` SHA `4868e049c2a2dc37659a25eaa08640aa0a4b05da90ea176deb8f9a55d46c8975`.

The bearer device-ingress HTTP branch now projects the internal result to exactly `{measurement}` after the unchanged throttled `ConnectorService.ingest` call. The firmware verifies only this submitted-measurement receipt, so ACK semantics stay intact. Unrelated monitoring reasons, other-condition values and the alert's whole rule snapshot are excluded on both first response and replay. Internal alert/monitoring creation, event validation, consent/revocation-before-replay checks, deduplication/conflict handling and the authenticated owner simulator's full receipt are unchanged. Reviewed the surrounding HTTP authentication branch, service capture/replay and shared ingestion call site.

Independent verification: **33/33 targeted tests passed**, including the three new HTTP privacy tests plus device connectors, decoder and existing connector suites; **fresh full strict TypeScript exit 0**. Tests establish the unrelated BP value in the internal fixture before asserting it is excluded, verify alert-producing ingress retains internal alerts, and verify authenticated owner simulator receipts remain complete. Both source hashes stayed frozen after tests. No new findings.

## Review Summary

| Scope | CRITICAL | HIGH | MEDIUM | LOW | Verdict |
|-------|----------|------|--------|-----|---------|
| Four TypeScript software files | 0 | 0 | 0 | 0 | APPROVE |
| Matrix script static safety | 0 | 0 | 0 | 0 | APPROVE exact hashes |
| Medical V2 four-file strengthening | 0 | 0 | 0 | 0 | APPROVE exact hashes |
| Device bearer HTTP privacy fix | 0 | 0 | 0 | 0 | APPROVE exact hashes |
| Corrected frozen firmware source | 0 | 0 open (2 resolved) | 0 | 0 | APPROVE final source; genuine build passed |

This reviewer owns only this report; no product source, environment, runtime or database edits were made.
