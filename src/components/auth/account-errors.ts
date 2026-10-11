import type { AccessCopy } from "@/lib/client/copy/access";
import { describeApiError, type ApiError, type Language } from "@/lib/client/api";

export interface AccountErrorText {
  title: string;
  message: string;
}

/**
 * Account-specific wording for POST /api/accounts and POST /api/session.
 * A 401 here means rejected credentials, not an expired session; failures
 * never reveal whether a login exists.
 */
export function accountErrorText(error: ApiError, lang: Language, copy: AccessCopy["auth"]): AccountErrorText {
  const title = lang === "fr" ? "Connexion refusée" : "تم رفض الدخول";
  switch (error.code) {
    case "INVALID_CREDENTIALS":
      return { title, message: copy.invalidCredentials };
    case "ACCOUNT_EXISTS":
      return { title, message: copy.accountExists };
    case "CLAIM_UNAVAILABLE":
      return { title, message: copy.claimUnavailable };
    case "AUTH_BUSY":
      return { title, message: copy.busy };
    case "RATE_LIMITED":
      return { title, message: copy.rateLimited };
    case "ACCOUNT_CONFIGURATION":
      return { title, message: copy.configuration };
    default:
      break;
  }
  if (error.status === 429) return { title, message: copy.rateLimited };
  if (error.status === 401) return { title, message: copy.invalidCredentials };
  if (error.status === 400 || error.status === 409) {
    const server = lang === "fr" ? error.serverMessage : null;
    return { title, message: server || copy.invalidCredentials };
  }
  const description = describeApiError(error, lang);
  return { title: description.title, message: description.message };
}
