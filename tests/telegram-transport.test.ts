import assert from "node:assert/strict";
import test from "node:test";
import { createTelegramClient, telegramRequest } from "../src/lib/telegram";

const token = "fictional-token";
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const mock = (handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch =>
  (async (url, init) => handler(String(url), init!)) as typeof fetch;

test("sendMessage uses JSON, reply_markup, a timeout signal, and returns its identifier", async () => {
  const keyboard = { inline_keyboard: [[{ text: "Confirmer", callback_data: "confirm:example" }]] };
  const client = createTelegramClient(token, mock((url, init) => {
    assert.equal(url, `https://api.telegram.org/bot${token}/sendMessage`);
    assert.equal(init.method, "POST");
    assert.deepEqual(init.headers, { "Content-Type": "application/json" });
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(init.body as string), { chat_id: "123", text: "165/100", reply_markup: keyboard });
    return response({ ok: true, result: { message_id: 42 } });
  }));
  assert.deepEqual(await client.sendTelegramMessage("123", "165/100", keyboard), { messageId: 42 });
});

test("callback acknowledgement and messages without keyboards", async () => {
  const methods: string[] = [];
  const client = createTelegramClient(token, mock((url, init) => {
    methods.push(url.split("/").at(-1)!);
    const body = JSON.parse(init.body as string);
    if (url.endsWith("answerCallbackQuery")) {
      assert.deepEqual(body, { callback_query_id: "callback" });
      return response({ ok: true, result: true });
    }
    assert.deepEqual(body, { chat_id: "123", text: "Bonjour" });
    return response({ ok: true, result: { message_id: 1 } });
  }));
  await client.answerTelegramCallback("callback");
  await client.sendTelegramMessage("123", "Bonjour");
  assert.deepEqual(methods, ["answerCallbackQuery", "sendMessage"]);
});

test("HTTP and API failures do not expose Telegram response text", async () => {
  for (const [body, status, expected] of [
    [{ description: token }, 503, /HTTP request failed \(503\)/],
    [{ ok: false, description: token }, 200, /API rejected/],
    [null, 200, /API rejected/],
  ] as const) {
    const client = createTelegramClient(token, mock(() => response(body, status)));
    await assert.rejects(client.sendTelegramMessage("123", "Bonjour"), expected);
    await assert.rejects(client.answerTelegramCallback("callback"), (error: Error) => !error.message.includes(token));
  }
});

test("network failures sanitize URL-bearing errors", async () => {
  const client = createTelegramClient(token, mock(() => { throw new Error(`Failed https://api.telegram.org/bot${token}/sendMessage`); }));
  await assert.rejects(client.sendTelegramMessage("123", "Bonjour"), { message: "Telegram request failed." });
});

test("malformed responses and invalid message identifiers fail closed", async () => {
  const invalidJson = createTelegramClient(token, mock(() => new Response("not json")));
  await assert.rejects(invalidJson.sendTelegramMessage("123", "Bonjour"), /invalid response/);
  const invalidAcknowledgement = createTelegramClient(token, mock(() => response({ ok: true, result: null })));
  await assert.rejects(invalidAcknowledgement.answerTelegramCallback("callback"), /invalid callback acknowledgement/);
  for (const message_id of [undefined, "42", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const client = createTelegramClient(token, mock(() => response({ ok: true, result: { message_id } })));
    await assert.rejects(client.sendTelegramMessage("123", "Bonjour"), /invalid message identifier/);
  }
});

test("missing tokens never make a request", async () => {
  let called = false;
  const client = createTelegramClient(" ", mock(() => { called = true; return response({ ok: true }); }));
  await assert.rejects(client.answerTelegramCallback("callback"), /not configured/);
  assert.equal(called, false);
});

test("timeouts abort requests and remain sanitized", async () => {
  const pending = telegramRequest(token, "getUpdates", {}, mock((_url, init) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new Error(token)), { once: true });
  })), 5);
  // AbortSignal.timeout uses an unref'ed timer; hold the test open until it fires.
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(pending, { message: "Telegram request timed out." });
  } finally {
    clearTimeout(keepAlive);
  }
});
