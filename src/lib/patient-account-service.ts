import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { Actor, Patient } from "../contracts/care";
import type { AccountLogin, AccountPrincipal, AccountRegistration } from "../contracts/patient-platform";
import { canonical } from "./monitoring-utils";
import { bumpPatientRevision } from "./patient-access-service";
import { CareError } from "./care-service";
import { careId, DEFAULT_CARE_RULES, type CareStoreAdapter } from "./care-store";

const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const dummySalt = randomBytes(16);
// Bound memory and queued credential work across service instances in this process.
const shared = globalThis as typeof globalThis & { carePasswordWork?: { active: number; waiting: (()=>void)[] } };
async function derive(password: string, salt: Buffer): Promise<Buffer> {
 const work = shared.carePasswordWork ??= { active: 0, waiting: [] };
 if(work.active >= 2) {
  if(work.waiting.length >= 8) throw new CareError(503,"AUTH_BUSY","Authentification temporairement indisponible.");
  await new Promise<void>(resolve=>work.waiting.push(resolve));
 } else work.active++;
 try {return await new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,32,SCRYPT_OPTIONS,(error,key)=>error?reject(error):resolve(key)));}
 finally {const next=work.waiting.shift();if(next)next();else work.active--;}
}
async function hashPassword(password: string): Promise<string> {
 const salt=randomBytes(16),key=await derive(password,salt);
 return `scrypt$32768$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}
async function passwordMatches(password: string, encoded: string | undefined): Promise<boolean> {
 const parts=encoded?.split("$");
 const valid=parts?.length===6&&parts[0]==="scrypt"&&parts[1]==="32768"&&parts[2]==="8"&&parts[3]==="1"&&/^[A-Za-z0-9_-]+$/.test(parts[4])&&/^[A-Za-z0-9_-]+$/.test(parts[5]);
 const salt=valid?Buffer.from(parts![4],"base64url"):dummySalt;
 const expected=valid?Buffer.from(parts![5],"base64url"):Buffer.alloc(32);
 const usable=valid&&salt.length>=16&&expected.length===32;
 const actual=await derive(password,usable?salt:dummySalt);
 return Boolean(usable&&timingSafeEqual(actual,expected));
}
function invalidInput(): never {throw new CareError(400,"INVALID_ACCOUNT","Compte patient fictif invalide.");}
function invalidCredentials(): never {throw new CareError(401,"INVALID_CREDENTIALS","Identifiants invalides.");}
function normalizeLogin(value: unknown): string {
 if(typeof value!=="string"||!/^[A-Za-z0-9._-]{3,40}$/.test(value))invalidInput();
 const login=value.toLowerCase();if(!/^[a-z0-9._-]{3,40}$/.test(login))invalidInput();return login;
}
function validatePassword(value: unknown): asserts value is string {
 if(typeof value!=="string"||value.length>256||[...value].length<12||[...value].length>128||Buffer.byteLength(value,"utf8")>512)invalidInput();
}
function boundedText(value: unknown, max: number): asserts value is string {if(typeof value!=="string"||!value.trim()||value.length>max)invalidInput();}
function exactKeys(value: unknown, allowed: string[]): asserts value is Record<string,unknown> {
 if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))invalidInput();
}
function actorOf(principal: AccountPrincipal): Actor {return {id:principal.id,role:principal.role,displayName:principal.displayName,patientId:principal.patientId};}
const DOCTORS = [
 {id:"demo-clinician",login:"medecin.ref",displayName:"Dr Leila Mansour",specialty:"Médecin référent",environment:"DEMO_CLINICIAN_PASSWORD"},
 {id:"demo-generalist",login:"medecin.general",displayName:"Dr Sami Ben Youssef",specialty:"Médecine générale",environment:"DEMO_GENERALIST_PASSWORD"},
 {id:"demo-specialist",login:"medecin.specialiste",displayName:"Dr Ines Gharbi",specialty:"Endocrinologie",environment:"DEMO_SPECIALIST_PASSWORD"},
] as const;

export class PatientAccountService {
 constructor(private readonly store: CareStoreAdapter, private readonly options: {clock?:()=>number} = {}) {}
 private now() {return this.options.clock?.()??Date.now();}
 async initialize(): Promise<void> {
  const prepared: {doctor: (typeof DOCTORS)[number]; configured: boolean; passwordHash: string | null; restoreMatches: boolean; verifiedHash: string | null; verifiedVersion: number | null}[]=[];
  for(const doctor of DOCTORS) {
   const password=process.env[doctor.environment];
   if(password)validatePassword(password);
   const current=this.store.read().accounts.find(a=>a.id===doctor.id);
   const passwordHash=password&&(!current?.passwordHash)?await hashPassword(password):null;
   const restoreMatches=Boolean(password&&current?.configurationDisabled&&await passwordMatches(password,current.passwordHash));
   prepared.push({doctor,configured:Boolean(password),passwordHash,restoreMatches,verifiedHash:current?.passwordHash??null,verifiedVersion:current?.sessionVersion??null});
  }
  this.store.transaction(state=>{
   for(const {doctor,configured,passwordHash,restoreMatches,verifiedHash,verifiedVersion} of prepared) {
    const current=state.accounts.find(a=>a.id===doctor.id);
    if(current) {
     if(current.role!=="clinician"||current.login!==doctor.login||current.patientId!==null)throw new CareError(503,"ACCOUNT_CONFIGURATION","Configuration indisponible.");
     if(configured&&!current.passwordHash&&passwordHash&&current.configurationDisabled!==false&&current.passwordHash===verifiedHash&&current.sessionVersion===verifiedVersion) {current.passwordHash=passwordHash;current.enabled=true;current.configurationDisabled=false;current.sessionVersion++;}
     if(configured&&current.configurationDisabled&&restoreMatches&&current.passwordHash===verifiedHash&&current.sessionVersion===verifiedVersion) {current.enabled=true;current.configurationDisabled=false;current.sessionVersion++;}
     if(!configured&&current.enabled) {
      current.enabled=false;current.configurationDisabled=true;current.sessionVersion++;
      const affected=new Set(state.careGrants.filter(g=>g.clinicianId===current.id&&g.state==="active").map(g=>g.patientId));
      for(const patientId of affected){
       bumpPatientRevision(state,patientId,"authority");
       for(const plan of state.carePlans.filter(p=>p.patientId===patientId&&p.clinicianId===current.id)){plan.state="awaiting_clinician";plan.clinicianId=null;plan.revision++;}
       for(const task of state.dueTasks.filter(t=>t.patientId===patientId&&!["completed","cancelled"].includes(t.state)))task.state="cancelled";
      }
     }
    } else {
     if(state.accounts.some(a=>a.login===doctor.login))throw new CareError(503,"ACCOUNT_CONFIGURATION","Configuration indisponible.");
     state.accounts.push({id:doctor.id,role:"clinician",patientId:null,login:doctor.login,displayName:doctor.displayName,passwordHash:passwordHash??"",enabled:configured,sessionVersion:1,createdAt:new Date(this.now()).toISOString()});
    }
    if(!state.doctorProfiles.some(p=>p.id===doctor.id))state.doctorProfiles.push({id:doctor.id,displayName:doctor.displayName,specialty:doctor.specialty,fictional:true});
   }
  });
 }
 async register(input: AccountRegistration): Promise<Actor> {
  exactKeys(input,["login","password","displayName","region","age","language","consent","fictionalDemo","clientId","claimCode"]);
  const login=normalizeLogin(input.login);if(DOCTORS.some(d=>d.login===login))invalidInput();validatePassword(input.password);boundedText(input.displayName,100);boundedText(input.region,100);boundedText(input.clientId,200);
  if(!Number.isInteger(input.age)||input.age<18||input.age>120||!["fr","ar"].includes(input.language)||input.consent!==true||input.fictionalDemo!==true)invalidInput();
  if(input.claimCode!==undefined&&(typeof input.claimCode!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(input.claimCode)))invalidInput();
  const replayKey="account-register:"+createHash("sha256").update(input.clientId).digest("hex");
  // Metadata replay hashes omit passwords; replay authentication uses the salted scrypt hash.
  const {password: _password, ...metadata}=input;
  const hash=createHash("sha256").update(canonical({...metadata,login})).digest("hex");
  const previous=this.store.read().idempotency[replayKey];
  if(previous) {
   if(previous.hash!==hash)throw new CareError(409,"IDEMPOTENCY_CONFLICT","Requête déjà utilisée.");
   return this.registrationActor((previous.result as {principalId:string}).principalId,input.password);
  }
  const passwordHash=await hashPassword(input.password);
  const result=this.store.transaction(state=>{
   const replay=state.idempotency[replayKey];
   if(replay) {if(replay.hash!==hash)throw new CareError(409,"IDEMPOTENCY_CONFLICT","Requête déjà utilisée.");return {principalId:(replay.result as {principalId:string}).principalId,actor:null};}
   if(state.accounts.some(a=>a.login===login))throw new CareError(409,"ACCOUNT_EXISTS","Compte indisponible.");
   const at=new Date(this.now()).toISOString();
   let patient: Patient;
   if(input.claimCode) {
    const claimHash=createHash("sha256").update(input.claimCode).digest("hex"),claim=state.claimCodes.find(c=>c.hash===claimHash);
    if(!claim||claim.usedAt!==null||Date.parse(claim.expiresAt)<=this.now())throw new CareError(400,"CLAIM_UNAVAILABLE","Code indisponible.");
    const preserved=state.patients.find(p=>p.id===claim.patientId);
    if(!preserved||state.accounts.some(a=>a.patientId===claim.patientId))throw new CareError(400,"CLAIM_UNAVAILABLE","Code indisponible.");
    patient=preserved;claim.usedAt=at;
   } else {
    patient={id:careId(),displayName:input.displayName.trim(),region:input.region.trim(),age:input.age,language:input.language,fictional:true,consent:true,rules:{...DEFAULT_CARE_RULES},status:"unknown",createdAt:at};
    state.patients.push(patient);state.patientRevisions.push({patientId:patient.id,contextRevision:0,evidenceRevision:0,authorityRevision:0});
   }
   const principal: AccountPrincipal={id:careId(),role:"patient",patientId:patient.id,login,displayName:patient.displayName,passwordHash,enabled:true,sessionVersion:1,createdAt:at};
   state.accounts.push(principal);state.idempotency[replayKey]={hash,result:{principalId:principal.id}};return {principalId:principal.id,actor:actorOf(principal)};
  });
  return result.actor??this.registrationActor(result.principalId,input.password);
 }
 private async registrationActor(principalId:string,password:string): Promise<Actor> {
  const principal=this.store.read().accounts.find(a=>a.id===principalId);
  const matches=await passwordMatches(password,principal?.passwordHash);
  const current=principal&&this.store.read().accounts.find(a=>a.id===principal.id);
  if(!matches||!current?.enabled||current.passwordHash!==principal!.passwordHash||current.sessionVersion!==principal!.sessionVersion)invalidCredentials();
  return actorOf(current);
 }
 async login(input: AccountLogin): Promise<Actor> {
  try {exactKeys(input,["login","password"]);validatePassword(input.password);} catch {invalidCredentials();}
  let login:string;try {login=normalizeLogin(input.login);} catch {invalidCredentials();}
  const principal=this.store.read().accounts.find(a=>a.login===login);
  const matches=await passwordMatches(input.password,principal?.passwordHash);
  // Re-resolve after hashing, including account changes while work was outside the transaction.
  const current=principal&&this.store.read().accounts.find(a=>a.id===principal.id);
  if(!matches||!current?.enabled||current.sessionVersion!==principal!.sessionVersion||current.passwordHash!==principal!.passwordHash)invalidCredentials();
  return actorOf(current);
 }
}

/** Operator-only local command; raw code is returned once and never persisted. */
export function issuePatientClaimCode(store: CareStoreAdapter, patientId: string, now=Date.now()): string {
 const token=randomBytes(32).toString("base64url"),hash=createHash("sha256").update(token).digest("hex");
 store.transaction(state=>{
  if(!state.patients.some(p=>p.id===patientId)||state.accounts.some(a=>a.patientId===patientId))throw new CareError(400,"CLAIM_UNAVAILABLE","Dossier indisponible.");
  const at=new Date(now).toISOString();for(const claim of state.claimCodes.filter(c=>c.patientId===patientId&&c.usedAt===null))claim.usedAt=at;
  state.claimCodes.push({hash,patientId,expiresAt:new Date(now+24*3600000).toISOString(),usedAt:null});
 });return token;
}
