/** The opaque guest token is resolved against the server store, never an account actor. */
export const GUEST_SESSION_COOKIE = "hackcure_external_visit";
export function guestTokenFromRequest(request: Request): string | null {
  const values = request.headers.get("cookie")?.split(";").map(value => value.trim())
    .filter(value => value.startsWith(`${GUEST_SESSION_COOKIE}=`)) ?? [];
  if (values.length !== 1) return null;
  const token = values[0].slice(GUEST_SESSION_COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
export function guestCookieHeader(token: string, maxAge = 3600): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new TypeError("Invalid guest credential");
  const lifetime = Math.max(0, Math.min(3600, Math.floor(maxAge)));
  return `${GUEST_SESSION_COOKIE}=${token}; Path=/api/external-visit; HttpOnly; SameSite=Strict; Max-Age=${lifetime}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
export function clearGuestCookieHeader(): string {
  return `${GUEST_SESSION_COOKIE}=; Path=/api/external-visit; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
