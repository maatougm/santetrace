#include <Arduino.h>
#include <algorithm>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <mbedtls/sha256.h>
#include <time.h>
#include "glucose_decoder.h"
#include "transport_safety.h"

using namespace santetrace;
namespace {
constexpr size_t MAX_OUTBOX = 128;
constexpr size_t MAX_CONFIG = 3800; // NVS strings are limited to 4000 bytes including terminator.
constexpr size_t MAX_ROW = 2048;
constexpr uint32_t CONTEXT_WAIT_MS = 3000;
constexpr uint32_t RACP_TIMEOUT_MS = 30000;
struct Config {
  String ssid, password, endpoint, credential, meterIdentity, bleAddress, epoch, ca;
  uint8_t addressType = 0;
  uint32_t passkey = 0;
  uint16_t firstSequence = 0;
  int timezoneMinutes = 0;
  bool valid = false;
} config;
struct Packet { uint8_t kind; uint8_t size; uint8_t bytes[32]; };
QueueHandle_t packets;
Preferences prefs;
NimBLEClient* client = nullptr;
NimBLERemoteCharacteristic* racp = nullptr;
NimBLEAddress target;
volatile bool connectRequested = false;
TransportBarrier transportBarrier;
volatile bool disconnected = false;
volatile bool authenticated = false;
bool provisionWindow = false, quarantine = false, procedureActive = false;
bool offsetKnown = false, pendingContext = false;
int inheritedOffset = 0;
int acknowledgedSequence = -1;
Checkpoint checkpoint;
GlucoseRecord waitingRecord;
uint32_t contextAt = 0, procedureAt = 0, nextBleAt = 0, nextSendAt = 0, nextWifiAt = 0;
uint32_t backoffMs = 1000;
String fingerprint;
String sha(const String& input);
bool due(uint32_t deadline) { return static_cast<int32_t>(millis() - deadline) >= 0; }
String bindingHash() {
  return sha(config.meterIdentity + ":" + config.epoch + ":" + config.credential + ":" +
    config.bleAddress + ":" + String(config.addressType) + ":" + String(config.firstSequence) + ":" + String(config.timezoneMinutes));
}

void status(const char* code) { Serial.printf("SANTETRACE %s\n", code); }
String sha(const String& input) {
  uint8_t digest[32]; char encoded[65];
  mbedtls_sha256_ret(reinterpret_cast<const unsigned char*>(input.c_str()), input.length(), digest, 0);
  for (size_t i = 0; i < 32; ++i) std::snprintf(encoded + i * 2, 3, "%02x", digest[i]);
  encoded[64] = '\0'; return String(encoded);
}
bool saveCheckpoint(const Checkpoint& next) {
  CheckpointBytes bytes{}, verified{}; Checkpoint parsed;
  if (!encodeCheckpoint(next, bytes) || prefs.putBytes("checkpoint", bytes.data(), bytes.size()) != bytes.size() ||
      prefs.getBytes("checkpoint", verified.data(), verified.size()) != verified.size() ||
      bytes != verified || !decodeCheckpoint(verified, parsed)) return false;
  checkpoint = parsed; acknowledgedSequence = parsed.acknowledgedSequence; return true;
}
bool validMac(const String& address) {
  if (address.length() != 17) return false;
  for (size_t i = 0; i < 17; ++i) {
    if (i % 3 == 2) { if (address[i] != ':') return false; }
    else if (!isxdigit(static_cast<unsigned char>(address[i]))) return false;
  }
  return true;
}
bool validEndpoint(const String& endpoint) {
  if (!endpoint.startsWith("https://") || !endpoint.endsWith("/api/connectors/events") || endpoint.length() > 512)
    return false;
  const String authority = endpoint.substring(8, endpoint.indexOf('/', 8));
  if (authority.isEmpty() || authority.indexOf('@') >= 0 || authority.indexOf(' ') >= 0) return false;
  for (size_t i = 0; i < endpoint.length(); ++i)
    if (static_cast<unsigned char>(endpoint[i]) <= 32 || endpoint[i] == '#' || endpoint[i] == '?') return false;
  return true;
}
bool parseConfig(const String& text, Config& out) {
  if (text.length() > MAX_CONFIG) return false;
  JsonDocument doc;
  if (deserializeJson(doc, text) || !doc.is<JsonObject>()) return false;
  const char* required[] = {"ssid", "password", "endpoint", "credential", "meterIdentity", "bleAddress", "epoch", "caPem"};
  for (const char* key : required) if (!doc[key].is<const char*>()) return false;
  if (!doc["passkey"].is<uint32_t>() || !doc["utcOffsetMinutes"].is<int>() || !doc["firstSequence"].is<uint16_t>() ||
      !doc["addressType"].is<uint8_t>() || !doc["clockVerified"].is<bool>() || !doc["clockVerified"].as<bool>()) return false;
  if (!doc["meterHistoryBelongsToPatient"].is<bool>() || !doc["meterHistoryBelongsToPatient"].as<bool>()) return false;
  out.ssid = doc["ssid"].as<String>(); out.password = doc["password"].as<String>();
  out.endpoint = doc["endpoint"].as<String>(); out.credential = doc["credential"].as<String>();
  out.meterIdentity = doc["meterIdentity"].as<String>(); out.bleAddress = doc["bleAddress"].as<String>();
  out.bleAddress.toLowerCase(); out.epoch = doc["epoch"].as<String>(); out.ca = doc["caPem"].as<String>();
  out.passkey = doc["passkey"].as<uint32_t>(); out.addressType = doc["addressType"].as<uint8_t>();
  out.timezoneMinutes = doc["utcOffsetMinutes"].as<int>();
  out.firstSequence = doc["firstSequence"].as<uint16_t>();
  if (out.ssid.isEmpty() || out.ssid.length() > 32 || out.password.length() > 64 ||
      !validEndpoint(out.endpoint) || out.credential.length() != 43 || !validMac(out.bleAddress) ||
      out.meterIdentity.isEmpty() || out.meterIdentity.length() > 100 || !validEpoch(out.epoch.c_str()) ||
      out.passkey > 999999 || out.addressType > 1 || out.timezoneMinutes < -840 || out.timezoneMinutes > 840 ||
      !out.ca.startsWith("-----BEGIN CERTIFICATE-----") || !out.ca.endsWith("-----END CERTIFICATE-----\n") ||
      out.ca.length() > 3000) return false;
  for (size_t i = 0; i < out.credential.length(); ++i) {
    const char c = out.credential[i];
    if (!isalnum(static_cast<unsigned char>(c)) && c != '_' && c != '-') return false;
  }
  for (size_t i = 0; i < out.meterIdentity.length(); ++i)
    if (static_cast<unsigned char>(out.meterIdentity[i]) < 32) return false;
  out.valid = true; return true;
}
size_t outboxCount() {
  File dir = LittleFS.open("/outbox");
  size_t count = 0;
  for (File row = dir.openNextFile(); row; row = dir.openNextFile()) if (!row.isDirectory()) ++count;
  return count;
}
void haltCapture(const char* reason) {
  quarantine = true; procedureActive = false; pendingContext = false;
  if (prefs.putString("halt", reason) == 0) status("quarantine_storage_failed");
  if (client && client->isConnected()) client->disconnect();
  status(reason);
}
bool persistRecord(const GlucoseRecord& record) {
  const String id = eventId(fingerprint.c_str(), config.epoch.c_str(), record).c_str();
  if (id.isEmpty()) { haltCapture("invalid_event_identity"); return false; }
  const String path = "/outbox/" + sha(id).substring(0, 32) + ".json";
  JsonDocument event;
  event["externalEventId"] = id; event["measuredAt"] = record.measuredAt;
  event["reading"]["kind"] = "glucose"; event["reading"]["value"] = record.value;
  event["reading"]["unit"] = record.mmol ? "mmol/L" : "mg/dL";
  event["quality"] = record.suspect ? "suspect" : "accepted";
  String body; serializeJson(event, body);
  JsonDocument row;
  row["sequence"] = record.sequence; row["body"] = body;
  row["binding"] = bindingHash();
  if (LittleFS.exists(path)) {
    File old = LittleFS.open(path, "r"); JsonDocument previous;
    if (!old || deserializeJson(previous, old) || previous["body"].as<String>() != body ||
        previous["binding"].as<String>() != row["binding"].as<String>()) {
      haltCapture("local_id_conflict"); return false;
    }
    return true;
  }
  if (outboxCount() >= MAX_OUTBOX || LittleFS.totalBytes() - LittleFS.usedBytes() < MAX_ROW * 2) {
    if (client && client->isConnected()) client->disconnect();
    procedureActive = false; status("outbox_full_capture_paused"); return false;
  }
  const String temp = path + ".tmp";
  File file = LittleFS.open(temp, "w");
  if (!file || serializeJson(row, file) == 0) { haltCapture("storage_write_failed"); return false; }
  file.flush(); file.close();
  File check = LittleFS.open(temp, "r"); JsonDocument verified;
  const bool complete = check && !deserializeJson(verified, check) && verified["body"].as<String>() == body &&
    verified["binding"].as<String>() == row["binding"].as<String>();
  check.close();
  if (!complete || !LittleFS.rename(temp, path)) { haltCapture("storage_commit_failed"); return false; }
  status("reading_persisted"); return true;
}
void receive(NimBLERemoteCharacteristic* characteristic, uint8_t* data, size_t size, bool notify) {
  // Once a frame was lost, never admit a later sequence before reconnect/replay.
  if (!transportBarrier.canProcess()) return;
  Packet packet{};
  const auto uuid = characteristic->getUUID();
  if (uuid == NimBLEUUID(uint16_t(0x2a18)) && notify) packet.kind = 1;
  else if (uuid == NimBLEUUID(uint16_t(0x2a34)) && notify) packet.kind = 2;
  else if (uuid == NimBLEUUID(uint16_t(0x2a52)) && !notify) packet.kind = 3;
  else return;
  if (size > sizeof(packet.bytes)) { transportBarrier.overflow(); return; }
  packet.size = size; memcpy(packet.bytes, data, size);
  if (xQueueSend(packets, &packet, 0) != pdTRUE) transportBarrier.overflow();
}
class ClientCallbacks : public NimBLEClientCallbacks {
  void onDisconnect(NimBLEClient*, int) override { disconnected = true; authenticated = false; }
  void onPassKeyEntry(NimBLEConnInfo& info) override { NimBLEDevice::injectPassKey(info, config.passkey); }
  void onConfirmPasskey(NimBLEConnInfo& info, uint32_t) override {
    // No unattended confirmation of an unknown displayed value.
    NimBLEDevice::injectConfirmPasskey(info, false);
  }
  void onAuthenticationComplete(NimBLEConnInfo& info) override {
    const String identity = info.getIdAddress().toString().c_str();
    authenticated = info.isEncrypted() && info.isAuthenticated() && identity.equalsIgnoreCase(config.bleAddress);
    if (!authenticated) {
      if (auto* peer = NimBLEDevice::getClientByHandle(info.getConnHandle())) peer->disconnect();
    }
  }
} clientCallbacks;
class ScanCallbacks : public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice* device) override {
    if (quarantine || connectRequested || !device->isAdvertisingService(NimBLEUUID(uint16_t(0x1808)))) return;
    if (!String(device->getAddress().toString().c_str()).equalsIgnoreCase(config.bleAddress) ||
        device->getAddress().getType() != config.addressType) return;
    target = device->getAddress(); connectRequested = true; NimBLEDevice::getScan()->stop();
  }
} scanCallbacks;
void connectMeter() {
  connectRequested = false;
  if (quarantine || outboxCount() >= MAX_OUTBOX || !config.valid) return;
  if (!client) {
    client = NimBLEDevice::createClient();
    if (!client) { status("ble_client_unavailable"); return; }
    client->setClientCallbacks(&clientCallbacks, false); client->setConnectTimeout(5000);
  }
  authenticated = false; disconnected = false;
  if (!client->connect(target) || !client->secureConnection() || !authenticated) {
    if (client->isConnected()) client->disconnect(); status("ble_pairing_not_verified"); return;
  }
  auto* service = client->getService(NimBLEUUID(uint16_t(0x1808)));
  auto* measurement = service ? service->getCharacteristic(NimBLEUUID(uint16_t(0x2a18))) : nullptr;
  auto* context = service ? service->getCharacteristic(NimBLEUUID(uint16_t(0x2a34))) : nullptr;
  racp = service ? service->getCharacteristic(NimBLEUUID(uint16_t(0x2a52))) : nullptr;
  if (!measurement || !measurement->canNotify() || !racp || !racp->canIndicate() || !racp->canWrite() ||
      !measurement->subscribe(true, receive) || (context && (!context->canNotify() || !context->subscribe(true, receive))) ||
      !racp->subscribe(false, receive)) {
    client->disconnect(); status("glucose_profile_unavailable"); return;
  }
  offsetKnown = false; inheritedOffset = 0; pendingContext = false;
  xQueueReset(packets);
  // Subscribe ALL characteristics before RACP. Re-read last ACK inclusively for safe replay.
  uint8_t request[5] = {1, 3, 1, 0, 0};
  const uint16_t start = acknowledgedSequence >= 0 ? acknowledgedSequence : config.firstSequence;
  request[3] = start & 0xff; request[4] = start >> 8;
  procedureActive = true; procedureAt = millis();
  if (!racp->writeValue(request, sizeof(request), true)) {
    procedureActive = false; client->disconnect(); status("racp_write_failed"); return;
  }
  status("racp_records_requested");
}
void processPacket(const Packet& packet) {
  if (quarantine || !procedureActive || !transportBarrier.canProcess()) return;
  if (packet.kind == 1) {
    if (pendingContext) { waitingRecord.suspect = true; if (!persistRecord(waitingRecord)) return; pendingContext = false; }
    ClockPolicy clock{true, config.timezoneMinutes, offsetKnown, inheritedOffset};
    auto decoded = decodeGlucose(packet.bytes, packet.size, clock);
    if (!decoded.ok) { haltCapture(decoded.error); return; }
    if (decoded.record.sequence < config.firstSequence) { haltCapture("record_before_patient_binding"); return; }
    inheritedOffset = decoded.record.timeOffsetMinutes; offsetKnown = true;
    if (decoded.record.contextFollows) { waitingRecord = decoded.record; contextAt = millis(); pendingContext = true; }
    else persistRecord(decoded.record);
  } else if (packet.kind == 2) {
    if (!pendingContext || !validContext(packet.bytes, packet.size, waitingRecord.sequence)) {
      haltCapture("context_sequence_or_payload_invalid"); return;
    }
    // Current API cannot retain the full medical context, so it remains suspect even when associated.
    waitingRecord.suspect = true; persistRecord(waitingRecord); pendingContext = false;
  } else if (packet.kind == 3) {
    if (packet.size != 4 || packet.bytes[0] != 6 || packet.bytes[1] != 0 || packet.bytes[2] != 1 ||
        (packet.bytes[3] != 1 && packet.bytes[3] != 6)) { haltCapture("racp_not_completed"); return; }
    if (pendingContext) { waitingRecord.suspect = true; persistRecord(waitingRecord); pendingContext = false; }
    procedureActive = false; if (client && client->isConnected()) client->disconnect();
    status("racp_completed");
  }
}
bool receiptMatches(JsonDocument& receipt, JsonDocument& sent) {
  JsonVariant measurement = receipt["measurement"];
  return measurement.is<JsonObject>() && measurement["id"].is<const char*>() &&
    measurement["source"].as<String>() == "device" && measurement["kind"].as<String>() == "glucose" &&
    measurement["measuredAt"].as<String>() == sent["measuredAt"].as<String>() &&
    measurement["clientId"].as<String>() == sent["externalEventId"].as<String>() &&
    measurement["unit"].as<String>() == sent["reading"]["unit"].as<String>() &&
    measurement["value"].is<double>() && std::abs(measurement["value"].as<double>() - sent["reading"]["value"].as<double>()) < 0.000001 &&
    measurement["connector"]["deviceId"].as<String>() == config.meterIdentity &&
    measurement["connector"]["externalEventId"].as<String>() == sent["externalEventId"].as<String>() &&
    measurement["connector"]["quality"].as<String>() == sent["quality"].as<String>() &&
    measurement["connector"]["simulated"].is<bool>() && !measurement["connector"]["simulated"].as<bool>();
}
class BoundedReceiptStream : public Stream {
 public:
  String text;
  bool overflow = false;
  BoundedReceiptStream() { text.reserve(8192); }
  size_t write(uint8_t byte) override { return write(&byte, 1); }
  size_t write(const uint8_t* bytes, size_t length) override {
    if (length > 8192 - text.length()) { overflow = true; return 0; }
    if (!text.concat(reinterpret_cast<const char*>(bytes), length)) { overflow = true; return 0; }
    return length;
  }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
};
void sendOldest() {
  if (quarantine || !transportBarrier.canAdvanceCheckpoint() || procedureActive || WiFi.status() != WL_CONNECTED ||
      !due(nextSendAt) || time(nullptr) < 1700000000) return;
  File dir = LittleFS.open("/outbox"); String oldestPath; int lowestSequence = 65536;
  for (File file = dir.openNextFile(); file; file = dir.openNextFile()) {
    if (file.isDirectory()) continue;
    JsonDocument row;
    if (file.size() > MAX_ROW || deserializeJson(row, file) || !row["sequence"].is<uint16_t>() || !row["body"].is<const char*>()) {
      haltCapture("outbox_corrupt"); return;
    }
    const int sequence = row["sequence"].as<int>();
    if (sequence < lowestSequence) { lowestSequence = sequence; oldestPath = String(file.path()); }
  }
  if (oldestPath.isEmpty()) return;
  File file = LittleFS.open(oldestPath, "r"); JsonDocument row;
  if (!file || deserializeJson(row, file) || row["binding"].as<String>() != bindingHash()) {
    haltCapture("outbox_binding_mismatch"); return;
  }
  const String body = row["body"].as<String>(); file.close();
  JsonDocument event;
  if (deserializeJson(event, body)) { haltCapture("outbox_corrupt"); return; }
  WiFiClientSecure tls; tls.setCACert(config.ca.c_str()); tls.setHandshakeTimeout(10);
  HTTPClient http; http.setTimeout(10000); http.setConnectTimeout(10000);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if (!http.begin(tls, config.endpoint)) { status("https_setup_failed"); nextSendAt = millis() + 5000; return; }
  http.addHeader("Content-Type", "application/json"); http.addHeader("Authorization", "Bearer " + config.credential);
  const int code = http.POST(body);
  if (code >= 200 && code < 300) {
    const int length = http.getSize();
    if (length > 8192) { http.end(); haltCapture("receipt_size_invalid"); return; }
    BoundedReceiptStream response;
    const int transferred = http.writeToStream(&response); JsonDocument receipt;
    const bool verified = transferred > 0 && !response.overflow && !deserializeJson(receipt, response.text) && receiptMatches(receipt, event);
    http.end();
    if (!verified) { haltCapture("receipt_not_verified"); return; }
    if (!transportBarrier.canAdvanceCheckpoint()) { haltCapture("radio_queue_overflow_quarantined"); return; }
    // ACK durable before deleting. Crash between steps repeats the identical event safely.
    if (lowestSequence > acknowledgedSequence) {
      const Checkpoint next{checkpoint.binding, lowestSequence};
      if (!saveCheckpoint(next)) { haltCapture("checkpoint_write_failed"); return; }
    }
    if (!LittleFS.remove(oldestPath)) { haltCapture("outbox_delete_failed"); return; }
    backoffMs = 1000; nextSendAt = millis() + 100; status("reading_server_verified"); return;
  }
  http.end();
  if (code == 401 || code == 403 || code == 404) { haltCapture("connector_revoked_or_unavailable"); return; }
  if (code >= 400 && code < 500 && code != 408 && code != 429) { haltCapture("event_rejected_quarantined"); return; }
  backoffMs = std::min(uint32_t(60000), backoffMs * 2);
  nextSendAt = millis() + backoffMs + (esp_random() % 500); status("upload_retry_pending");
}
void provisionSerial() {
  static String input; static bool tooLong = false;
  if (!provisionWindow && millis() < 90000 && digitalRead(0) == LOW) {
    provisionWindow = true; status("physical_usb_provision_window_open");
  }
  if (!provisionWindow || millis() > 90000) { provisionWindow = false; return; }
  while (Serial.available()) {
    const char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') { if (input.length() < MAX_CONFIG + 16) input += c; else tooLong = true; continue; }
    if (tooLong || !input.startsWith("PROVISION ") || outboxCount() != 0) status("provision_rejected");
    else {
      Config proposed;
      if (!parseConfig(input.substring(10), proposed)) status("provision_invalid");
      else if (prefs.putString("config", input.substring(10)) == 0) status("provision_storage_failed");
      else {
        prefs.remove("halt"); input = ""; status("provision_saved_restarting"); delay(100); ESP.restart();
      }
    }
    input = ""; tooLong = false;
  }
}
} // namespace

void setup() {
  Serial.begin(115200); pinMode(0, INPUT_PULLUP);
  // Never automatically format storage: that would silently lose pending measurements.
  if (!LittleFS.begin(false) || !LittleFS.mkdir("/outbox") && !LittleFS.exists("/outbox") || !prefs.begin("santetrace", false)) {
    quarantine = true; status("storage_unavailable_manual_setup_required"); return;
  }
  packets = xQueueCreate(512, sizeof(Packet));
  if (!packets) { quarantine = true; status("queue_unavailable"); return; }
  if (!parseConfig(prefs.getString("config", ""), config)) { status("unprovisioned_hold_boot_for_usb_setup"); return; }
  if (!prefs.getString("halt", "").isEmpty()) { quarantine = true; status("persistent_quarantine_operator_review_required"); return; }
  fingerprint = sha(config.meterIdentity).substring(0, 16);
  const String binding = bindingHash();
  CheckpointBytes stored{}; Checkpoint existing, selected;
  const size_t storedSize = prefs.getBytesLength("checkpoint");
  const bool existingValid = storedSize == stored.size() && prefs.getBytes("checkpoint", stored.data(), stored.size()) == stored.size() &&
    decodeCheckpoint(stored, existing);
  if (storedSize != 0 && !existingValid) { haltCapture("checkpoint_corrupt"); return; }
  if (!selectCheckpoint(existingValid ? &existing : nullptr, binding.c_str(), config.firstSequence, outboxCount() != 0, selected) ||
      !saveCheckpoint(selected)) { haltCapture("binding_checkpoint_storage_failed"); return; }
  WiFi.mode(WIFI_STA); WiFi.begin(config.ssid.c_str(), config.password.c_str());
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  NimBLEDevice::init("SanteTrace Gateway"); NimBLEDevice::setSecurityAuth(true, true, true);
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_KEYBOARD_ONLY);
  auto* scan = NimBLEDevice::getScan(); scan->setScanCallbacks(&scanCallbacks, false);
  scan->setActiveScan(true); scan->setInterval(100); scan->setWindow(80);
  status("configured_radio_hardware_unverified");
}
void loop() {
  provisionSerial();
  if (!config.valid || quarantine || !packets) { delay(20); return; }
  if (!transportBarrier.canProcess()) { haltCapture("radio_queue_overflow_quarantined"); return; }
  Packet packet;
  while (transportBarrier.canProcess() && xQueueReceive(packets, &packet, 0) == pdTRUE && !quarantine) processPacket(packet);
  if (!transportBarrier.canProcess()) { haltCapture("radio_queue_overflow_quarantined"); return; }
  if (disconnected) {
    // Drain records received before the radio disconnect before closing this procedure.
    disconnected = false; procedureActive = false;
    if (pendingContext) { waitingRecord.suspect = true; persistRecord(waitingRecord); pendingContext = false; }
    nextBleAt = millis() + 10000;
  }
  if (pendingContext && millis() - contextAt > CONTEXT_WAIT_MS) {
    waitingRecord.suspect = true; persistRecord(waitingRecord); pendingContext = false; status("missing_context_suspect");
  }
  if (procedureActive && millis() - procedureAt > RACP_TIMEOUT_MS) {
    if (client && client->isConnected()) client->disconnect(); procedureActive = false; status("racp_timeout_replay_required");
  }
  if (WiFi.status() != WL_CONNECTED && due(nextWifiAt)) { WiFi.reconnect(); nextWifiAt = millis() + 15000; }
  sendOldest();
  if (connectRequested) connectMeter();
  if (!procedureActive && !connectRequested && (!client || !client->isConnected()) &&
      outboxCount() == 0 && due(nextBleAt) && !NimBLEDevice::getScan()->isScanning()) {
    NimBLEDevice::getScan()->start(5000, false, true); nextBleAt = millis() + 15000;
  }
  delay(10);
}
