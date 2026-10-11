import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Actor } from "../contracts/care";
import { getCareStore, type CareStoreAdapter } from "./care-store";
const shared=globalThis as typeof globalThis & {careSessionSecret?:string};
function secret(){if(process.env.SESSION_SECRET)return process.env.SESSION_SECRET;if(process.env.NODE_ENV==="production")throw new Error("SESSION_SECRET is required in production");return shared.careSessionSecret??=randomBytes(32).toString("hex");}
export const SESSION_COOKIE="hackcure_session";
type Session = {version:2;principalId:string;sessionVersion:number;expiresAt:number};
export function signSession(actor:Actor,now=Date.now(),store:CareStoreAdapter=getCareStore()):string {
 const principal=store.read().accounts.find(a=>a.id===actor.id&&a.enabled);
 if(!principal)throw new Error("Current enabled principal required for session");
 const payload:Session={version:2,principalId:principal.id,sessionVersion:principal.sessionVersion,expiresAt:now+8*3600000};
 const body=Buffer.from(JSON.stringify(payload)).toString("base64url");return body+"."+createHmac("sha256",secret()).update(body).digest("base64url");
}
export function verifySession(token:string|undefined,now=Date.now(),store:CareStoreAdapter=getCareStore()):Actor|null {
 if(!token||token.length>2048)return null;
 try {
  const [body,sig,...extra]=token.split(".");if(extra.length||!body||!sig||!/^[A-Za-z0-9_-]+$/.test(body)||!/^[A-Za-z0-9_-]+$/.test(sig))return null;
  const expected=createHmac("sha256",secret()).update(body).digest(),actual=Buffer.from(sig,"base64url");if(actual.length!==expected.length||!timingSafeEqual(expected,actual))return null;
  const payload=JSON.parse(Buffer.from(body,"base64url").toString()) as Session;
  if(payload.version!==2||typeof payload.principalId!=="string"||!Number.isSafeInteger(payload.sessionVersion)||!Number.isFinite(payload.expiresAt)||payload.expiresAt<=now||payload.expiresAt>now+8*3600000)return null;
  const principal=store.read().accounts.find(a=>a.id===payload.principalId&&a.enabled&&a.sessionVersion===payload.sessionVersion);
  if(!principal||!["patient","clinician"].includes(principal.role))return null;
  if(principal.role==="patient"&&(!principal.patientId||!store.read().patients.some(p=>p.id===principal.patientId)))return null;
  if(principal.role==="clinician"&&principal.patientId!==null)return null;
  return {id:principal.id,role:principal.role,displayName:principal.displayName,patientId:principal.patientId};
 }catch{return null;}
}
export function resolveSessionActor(request:Request,store:CareStoreAdapter,now=Date.now()):Actor|null {
 const values=request.headers.get("cookie")?.split(";").map(x=>x.trim()).filter(x=>x.startsWith(SESSION_COOKIE+"="))??[];
 if(values.length!==1)return null;return verifySession(values[0].slice(SESSION_COOKIE.length+1),now,store);
}
export function actorFromRequest(request:Request){return resolveSessionActor(request,getCareStore());}
export function cookieHeader(token:string,maxAge=28800){return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV==="production"?"; Secure":""}`;}
