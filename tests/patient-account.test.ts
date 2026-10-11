import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { CareStore } from "../src/lib/care-store";
import { PatientAccountService, issuePatientClaimCode } from "../src/lib/patient-account-service";
import { resolveSessionActor, signSession, SESSION_COOKIE } from "../src/lib/care-session";
const input={login:"patient.new",password:"Synthetic password 123!",displayName:"Synthetic Patient",region:"Siliana",age:40,language:"fr" as const,consent:true as const,fictionalDemo:true as const,clientId:"register-once"};
const request=(token:string)=>new Request("http://localhost/api/session",{headers:{cookie:`${SESSION_COOKIE}=${token}`}});
test("repeated login and registration replay preserve stable owner and never expose hashes",async()=>{const store=new CareStore(":memory:");try{const service=new PatientAccountService(store);const actor=await service.register(input);assert.deepEqual(await service.login({login:"PATIENT.NEW",password:input.password}),actor);assert.deepEqual(await service.register(input),actor);assert.equal(store.read().accounts.filter(a=>a.role==="patient").length,1);assert.equal(JSON.stringify(actor).includes("password"),false);assert.equal(store.read().patients.find(p=>p.id===actor.patientId)?.displayName,input.displayName);}finally{store.close();}});
test("public registration rejects principal injection and invalid credentials without writes",async()=>{const store=new CareStore(":memory:");try{const service=new PatientAccountService(store);for(const extra of [{role:"clinician"},{patientId:"fatma"},{enabled:true},{clinicianId:"doctor"}])await assert.rejects(()=>service.register({...input,...extra}),e=>(e as {status:number}).status===400);for(const password of ["short","é".repeat(129)])await assert.rejects(()=>service.register({...input,password}));assert.equal(store.read().accounts.length,0);}finally{store.close();}});
test("claim code binds preserved patient once with a hash-only 24-hour credential and no grant",async()=>{const store=new CareStore(":memory:");try{const now=Date.parse("2026-10-11T10:00:00Z");const token=issuePatientClaimCode(store,"fatma",now);const claim=store.read().claimCodes[0];assert.equal(claim.expiresAt,"2026-10-12T10:00:00.000Z");assert.equal(JSON.stringify(store.read()).includes(token),false);const service=new PatientAccountService(store,{clock:()=>now});const actor=await service.register({...input,claimCode:token});assert.equal(actor.patientId,"fatma");assert.equal(store.read().patients.length,2);assert.equal(store.read().careGrants.length,0);await assert.rejects(()=>service.register({...input,login:"other.patient",clientId:"other",claimCode:token}));assert.equal(store.read().accounts.filter(a=>a.role==="patient").length,1);}finally{store.close();}});
test("sessions resolve current principal and reject disabled, version changed, expired and legacy cookies",async()=>{const store=new CareStore(":memory:");const oldSecret=process.env.SESSION_SECRET;process.env.SESSION_SECRET="synthetic-only-test-key";try{const actor=await new PatientAccountService(store).register(input);const now=Date.now(),token=signSession(actor,now,store);assert.deepEqual(resolveSessionActor(request(token),store,now),actor);assert.equal(resolveSessionActor(request(token),store,now+8*3600000),null);store.transaction(s=>{s.accounts.find(a=>a.id===actor.id)!.sessionVersion++;});assert.equal(resolveSessionActor(request(token),store,now),null);const newToken=signSession(actor,now,store);store.transaction(s=>{s.accounts.find(a=>a.id===actor.id)!.enabled=false;});assert.equal(resolveSessionActor(request(newToken),store,now),null);const body=Buffer.from(JSON.stringify({actor,expiresAt:now+10000})).toString("base64url"),legacy=body+"."+createHmac("sha256",process.env.SESSION_SECRET!).update(body).digest("base64url");assert.equal(resolveSessionActor(request(legacy),store,now),null);}finally{if(oldSecret===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=oldSecret;store.close();}});
test("concurrent initializers atomically provision exactly three distinct fictional clinicians",async()=>{const store=new CareStore(":memory:");try{await Promise.all([new PatientAccountService(store).initialize(),new PatientAccountService(store).initialize()]);const s=store.read();assert.equal(s.accounts.length,3);assert.equal(new Set(s.accounts.map(a=>a.login)).size,3);assert.equal(s.doctorProfiles.length,3);assert.ok(s.accounts.every(a=>a.role==="clinician"&&a.patientId===null));assert.equal(s.careGrants.length,0);}finally{store.close();}});
test("wrong password and unknown account return generic credential errors asynchronously",async()=>{const store=new CareStore(":memory:");try{const service=new PatientAccountService(store);await service.register(input);for(const login of [input.login,"does.not.exist"]){let completed=false;const pending=service.login({login,password:"Incorrect password 123!"}).catch(e=>{completed=true;assert.equal(e.code,"INVALID_CREDENTIALS");assert.equal(e.status,401);});assert.equal(completed,false);await pending;}}finally{store.close();}});
test("reserved clinician login cannot be captured by public patient registration",async()=>{const store=new CareStore(":memory:");try{const service=new PatientAccountService(store);for(const login of ["medecin.ref","medecin.general","medecin.specialiste"])await assert.rejects(()=>service.register({...input,login}),e=>(e as {status:number}).status===400);assert.equal(store.read().accounts.length,0);}finally{store.close();}});
test("registration replay verifies password without persisting an unsalted password fingerprint",async()=>{const store=new CareStore(":memory:");try{const service=new PatientAccountService(store);await service.register(input);const {createHash}=await import("node:crypto");const weak=createHash("sha256").update(JSON.stringify(input)).digest("hex");assert.equal(Object.values(store.read().idempotency).some(entry=>entry.hash===weak),false);await assert.rejects(()=>service.register({...input,password:"Different password 123!"}),e=>(e as {code:string}).code==="INVALID_CREDENTIALS");}finally{store.close();}});
test("claim expiry and concurrent owner claims preserve one rightful owner",async()=>{const store=new CareStore(":memory:");try{const now=Date.parse("2026-10-11T10:00:00Z"),token=issuePatientClaimCode(store,"fatma",now);await assert.rejects(()=>new PatientAccountService(store,{clock:()=>now+24*3600000}).register({...input,claimCode:token}));const service=new PatientAccountService(store,{clock:()=>now});const results=await Promise.allSettled([service.register({...input,claimCode:token}),service.register({...input,login:"claim.other",clientId:"second-claim",claimCode:token})]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(store.read().accounts.filter(a=>a.patientId==="fatma").length,1);}finally{store.close();}});
test("concurrent configured initializers hash three doctors once into atomic unique registry and login uses exact password",async()=>{const names=["DEMO_CLINICIAN_PASSWORD","DEMO_GENERALIST_PASSWORD","DEMO_SPECIALIST_PASSWORD"];const old=names.map(name=>process.env[name]);names.forEach((name,i)=>process.env[name]=`Synthetic doctor password ${i}!`);const store=new CareStore(":memory:");try{await Promise.all([new PatientAccountService(store).initialize(),new PatientAccountService(store).initialize()]);const service=new PatientAccountService(store),s=store.read();assert.equal(s.accounts.length,3);assert.ok(s.accounts.every(a=>a.enabled&&a.passwordHash.startsWith("scrypt$32768$8$1$")));assert.equal((await service.login({login:"medecin.general",password:"Synthetic doctor password 1!"})).id,"demo-generalist");await assert.rejects(()=>service.login({login:"medecin.ref",password:"Synthetic doctor password 1!"}));}finally{names.forEach((name,i)=>old[i]===undefined?delete process.env[name]:process.env[name]=old[i]);store.close();}});
test("unconfigured clinician accounts remain unusable while patient enrollment works",async()=>{const names=["DEMO_CLINICIAN_PASSWORD","DEMO_GENERALIST_PASSWORD","DEMO_SPECIALIST_PASSWORD"],old=names.map(n=>process.env[n]);names.forEach(n=>delete process.env[n]);const store=new CareStore(":memory:");try{const service=new PatientAccountService(store);await service.initialize();assert.ok(store.read().accounts.every(a=>!a.enabled&&!a.passwordHash));await assert.rejects(()=>service.login({login:"medecin.ref",password:input.password}));const actor=await service.register(input);assert.equal(actor.role,"patient");process.env.DEMO_CLINICIAN_PASSWORD="Synthetic new doctor password!";await service.initialize();assert.equal((await service.login({login:"medecin.ref",password:"Synthetic new doctor password!"})).id,"demo-clinician");}finally{names.forEach((name,i)=>old[i]===undefined?delete process.env[name]:process.env[name]=old[i]);store.close();}});
test("credential work is bounded across instances and overflow produces no account",async()=>{const store=new CareStore(":memory:");try{const results=await Promise.allSettled(Array.from({length:11},(_,i)=>new PatientAccountService(store).register({...input,login:`bounded.${i}`,clientId:`bounded-${i}`})));assert.equal(results.filter(r=>r.status==="fulfilled").length,10);const failure=results.find(r=>r.status==="rejected") as PromiseRejectedResult;assert.equal(failure.reason.code,"AUTH_BUSY");assert.equal(store.read().accounts.length,10);}finally{store.close();}});
test("principal disablement during async password checking prevents login",async()=>{const store=new CareStore(":memory:");try{const service=new PatientAccountService(store),actor=await service.register(input);const pending=service.login({login:input.login,password:input.password});store.transaction(s=>{s.accounts.find(a=>a.id===actor.id)!.enabled=false;});await assert.rejects(()=>pending,e=>(e as {code:string}).code==="INVALID_CREDENTIALS");}finally{store.close();}});
test("sessions use current display name rather than retaining mutable account snapshots",async()=>{const store=new CareStore(":memory:");try{const actor=await new PatientAccountService(store).register(input),now=Date.now(),token=signSession(actor,now,store);store.transaction(s=>{s.accounts.find(a=>a.id===actor.id)!.displayName="Updated account name";});assert.equal(resolveSessionActor(request(token),store,now)?.displayName,"Updated account name");const decoded=JSON.parse(Buffer.from(token.split(".")[0],"base64url").toString());assert.equal(decoded.actor,undefined);assert.equal(decoded.passwordHash,undefined);}finally{store.close();}});
test("non-ASCII login confusables are rejected before lowercase normalization",async()=>{const store=new CareStore(":memory:");try{const service=new PatientAccountService(store);await assert.rejects(()=>service.register({...input,login:"Kelvin.patient"}),e=>(e as {status:number}).status===400);assert.equal(store.read().accounts.length,0);}finally{store.close();}});
test("same registration metadata retries with reordered keys",async()=>{const s=new CareStore(":memory:");try{const service=new PatientAccountService(s),a=await service.register(input);const reordered=Object.fromEntries(Object.entries(input).reverse()) as typeof input;assert.deepEqual(await service.register(reordered),a);assert.equal(s.read().accounts.length,1);}finally{s.close();}});
test("configuration restore enables only accounts disabled by configuration",async()=>{const keys=["DEMO_CLINICIAN_PASSWORD","DEMO_GENERALIST_PASSWORD","DEMO_SPECIALIST_PASSWORD"],old=keys.map(k=>process.env[k]);const s=new CareStore(":memory:");try{process.env.DEMO_CLINICIAN_PASSWORD="Synthetic restore password!";const service=new PatientAccountService(s);await service.initialize();delete process.env.DEMO_CLINICIAN_PASSWORD;await service.initialize();assert.equal(s.read().accounts.find(a=>a.id==="demo-clinician")!.enabled,false);process.env.DEMO_CLINICIAN_PASSWORD="Synthetic restore password!";await service.initialize();assert.equal((await service.login({login:"medecin.ref",password:"Synthetic restore password!"})).id,"demo-clinician");s.transaction(st=>st.accounts.find(a=>a.id==="demo-clinician")!.enabled=false);await service.initialize();assert.equal(s.read().accounts.find(a=>a.id==="demo-clinician")!.enabled,false);}finally{keys.forEach((k,i)=>old[i]===undefined?delete process.env[k]:process.env[k]=old[i]);s.close();}});

// Removing either current-credential guard would re-enable a changed principal.
for (const change of ["credential", "session_version"] as const) {
 test(`configuration restore respects ${change} changes during asynchronous verification`, async () => {
  const keys = ["DEMO_CLINICIAN_PASSWORD", "DEMO_GENERALIST_PASSWORD", "DEMO_SPECIALIST_PASSWORD"];
  const old = keys.map(key => process.env[key]);
  const store = new CareStore(":memory:");
  try {
   keys.forEach(key => delete process.env[key]);
   process.env.DEMO_CLINICIAN_PASSWORD = "Synthetic former credential!";
   process.env.DEMO_GENERALIST_PASSWORD = "Synthetic replacement credential!";
   const service = new PatientAccountService(store);
   await service.initialize();
   delete process.env.DEMO_CLINICIAN_PASSWORD;
   await service.initialize();
   process.env.DEMO_CLINICIAN_PASSWORD = "Synthetic former credential!";

   const pending = service.initialize();
   store.transaction(state => {
    const doctor = state.accounts.find(account => account.id === "demo-clinician")!;
    if (change === "credential") doctor.passwordHash = state.accounts.find(account => account.id === "demo-generalist")!.passwordHash;
    else doctor.sessionVersion++;
   });
   const changed = store.read().accounts.find(account => account.id === "demo-clinician")!;
   await pending;
   const actual = store.read().accounts.find(account => account.id === "demo-clinician")!;
   assert.equal(actual.enabled, false);
   assert.equal(actual.configurationDisabled, true);
   assert.equal(actual.passwordHash, changed.passwordHash);
   assert.equal(actual.sessionVersion, changed.sessionVersion);
  } finally {
   keys.forEach((key, index) => old[index] === undefined ? delete process.env[key] : process.env[key] = old[index]);
   store.close();
  }
 });
}

test("first credential provisioning respects administrative disablement during asynchronous hashing", async () => {
 const keys = ["DEMO_CLINICIAN_PASSWORD", "DEMO_GENERALIST_PASSWORD", "DEMO_SPECIALIST_PASSWORD"];
 const old = keys.map(key => process.env[key]);
 const store = new CareStore(":memory:");
 try {
  keys.forEach(key => delete process.env[key]);
  const service = new PatientAccountService(store);
  await service.initialize();
  process.env.DEMO_CLINICIAN_PASSWORD = "Synthetic first credential!";
  const pending = service.initialize();
  store.transaction(state => {
   const doctor = state.accounts.find(account => account.id === "demo-clinician")!;
   doctor.enabled = false;
   doctor.configurationDisabled = false;
   doctor.sessionVersion++;
  });
  const changed = store.read().accounts.find(account => account.id === "demo-clinician")!;
  await pending;
  const actual = store.read().accounts.find(account => account.id === "demo-clinician")!;
  assert.equal(actual.enabled, false);
  assert.equal(actual.configurationDisabled, false);
  assert.equal(actual.passwordHash, changed.passwordHash);
  assert.equal(actual.sessionVersion, changed.sessionVersion);
  await service.initialize();
  const retried = store.read().accounts.find(account => account.id === "demo-clinician")!;
  assert.equal(retried.enabled, false);
  assert.equal(retried.configurationDisabled, false);
  assert.equal(retried.passwordHash, changed.passwordHash);
  assert.equal(retried.sessionVersion, changed.sessionVersion);
 } finally {
  keys.forEach((key, index) => old[index] === undefined ? delete process.env[key] : process.env[key] = old[index]);
  store.close();
 }
});
