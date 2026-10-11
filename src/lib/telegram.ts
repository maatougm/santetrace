type Fetch = typeof fetch;

// Keep this module in server routes/scripts; never import it from client components.
export async function telegramRequest(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  fetchImpl: Fetch = fetch,
  timeoutMs = 10_000,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!token.trim()) throw new Error("Telegram bot token is not configured.");
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
  } catch {
    // Network errors can contain the credential-bearing request URL.
    throw new Error(timeout.aborted ? "Telegram request timed out." : "Telegram request failed.");
  }
  if (!response.ok) throw new Error(`Telegram HTTP request failed (${response.status}).`);
  let data: { ok?: unknown; result?: unknown };
  try {
    data = await response.json();
  } catch {
    throw new Error("Telegram returned an invalid response.");
  }
  if (!data || data.ok !== true) throw new Error("Telegram API rejected the request.");
  return data.result;
}

export function createTelegramClient(token: string, fetchImpl: Fetch = fetch) {
  return {
    async sendTelegramMessage(chatId: string, text: string, keyboard?: unknown): Promise<{ messageId: number }> {
      const result = await telegramRequest(token, "sendMessage", {
        chat_id: chatId,
        text,
        ...(keyboard === undefined ? {} : { reply_markup: keyboard }),
      }, fetchImpl);
      const messageId = (result as { message_id?: unknown } | null)?.message_id;
      if (!Number.isSafeInteger(messageId) || (messageId as number) <= 0) {
        throw new Error("Telegram returned an invalid message identifier.");
      }
      return { messageId: messageId as number };
    },
    async answerTelegramCallback(id: string): Promise<void> {
      const result = await telegramRequest(token, "answerCallbackQuery", { callback_query_id: id }, fetchImpl);
      if (result !== true) throw new Error("Telegram returned an invalid callback acknowledgement.");
    },
  };
}

export async function sendTelegramMessage(chatId: string, text: string, keyboard?: unknown): Promise<{ messageId: number }> {
  return createTelegramClient(process.env.TELEGRAM_BOT_TOKEN ?? "").sendTelegramMessage(chatId, text, keyboard);
}

export async function answerTelegramCallback(id: string): Promise<void> {
  await createTelegramClient(process.env.TELEGRAM_BOT_TOKEN ?? "").answerTelegramCallback(id);
}
