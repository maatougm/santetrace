import test from "node:test";
import assert from "node:assert/strict";
import {CareStore} from "../src/lib/care-store";
import {createCareHandler} from "../src/lib/monitoring-http";
import { fixtureStore, testDoctor, testOwner } from "./helpers/care-fixture";
import { signSession } from "../src/lib/care-session";
import { ExternalVisitService } from "../src/lib/external-visit-service";
import { randomBytes } from "node:crypto";
import type { CareProposal } from "../src/contracts/monitoring";

test("patient onboarding leads to separate drafts, individual doctor approval and owner completion over HTTP",async()=>{
 const oldModel=process.env.HACKCURE_OLLAMA_BASE_URL,oldDoctor=process.env.DEMO_CLINICIAN_PASSWORD;
 process.env.HACKCURE_OLLAMA_BASE_URL="https://untrusted.invalid/";process.env.DEMO_CLINICIAN_PASSWORD="Synthetic workflow doctor password!";
 const s=fixtureStore();
 try {
  const handle=createCareHandler(s),ownerCookie=`hackcure_session=${signSession(testOwner,Date.now(),s)}`,doctorCookie=`hackcure_session=${signSession(testDoctor,Date.now(),s)}`;
  const req=(path:string,method="GET",body?:unknown,cookie=ownerCookie)=>handle(new Request(`http://localhost/api/${path}`,{method,headers:{cookie,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  const onboarding=await req("patients/fatma/onboarding","POST",{answers:[{questionId:"condition.hypertension",value:false,polarity:"negated"},{questionId:"condition.diabetes",value:true,polarity:"affirmed"}],expectedContextRevision:0,clientId:"journey-onboarding"});
  assert.equal(onboarding.status,200);assert.ok((await onboarding.json()).questions.every((q:{required:boolean})=>!q.required));
  const generated=await req("patients/fatma/proposals/generate","POST",{clientId:"journey-proposals"});assert.equal(generated.status,200);
  const statuses=(await generated.json()).proposals;assert.deepEqual(statuses.map((p:{kind:string})=>p.kind).sort(),["home_measurement","lab_exam"]);
  assert.ok(statuses.every((p:unknown)=>Object.keys(p as object).sort().join()==="id,kind,revision,state"));
  const list=await req("patients/fatma/proposals","GET",undefined,doctorCookie);assert.equal(list.status,200);
  const drafts=(await list.json()).proposals as CareProposal[],home=drafts.find(p=>p.kind==="home_measurement")!,exam=drafts.find(p=>p.kind==="lab_exam")!;
  assert.equal(exam.state,"needs_review");
  const approve=await req(`proposals/${home.id}`,"PATCH",{decision:"approve",expectedRevision:home.revision,expectedGuard:home.guard,reason:"Validation individuelle",clientId:"journey-approval"},doctorCookie);
  assert.equal(approve.status,200);const approved=await approve.json();assert.ok(approved.action);
  const patient=await req("patients/fatma");assert.equal(patient.status,200);const record=await patient.json();assert.equal(record.revision.contextRevision,1);assert.equal(record.actions.length,1);assert.equal(record.proposals.find((p:{id:string})=>p.id===exam.id).state,"needs_review");
  const activated=await req("patients/fatma/care-plan","PATCH",{action:"activate",profileBindings:[{conditionFactId:record.medicalFacts.find((f:{code:string;polarity:string})=>f.code==="diabetes"&&f.polarity==="affirmed").id,profileId:"demo_glucose",profileVersion:record.patient.rules.version}],expectedRevision:record.plan.revision,clientId:"journey-plan"},doctorCookie);
  assert.equal(activated.status,200);const before=(await activated.json()).plan;
  const completion=await req(`actions/${approved.action.id}/reports`,"POST",{state:"completed",expectedRevision:approved.action.revision,clientId:"journey-complete"});assert.equal(completion.status,200);assert.equal((await completion.json()).action.state,"completed");
  const after=await req("patients/fatma/care-plan");assert.equal((await after.json()).plan.revision,before.revision,"runtime progress does not change policy revision");
 } finally {s.close();if(oldModel===undefined)delete process.env.HACKCURE_OLLAMA_BASE_URL;else process.env.HACKCURE_OLLAMA_BASE_URL=oldModel;if(oldDoctor===undefined)delete process.env.DEMO_CLINICIAN_PASSWORD;else process.env.DEMO_CLINICIAN_PASSWORD=oldDoctor;}
});

test("public credential routes bound invalid attempts before SQLite and isolate their ceilings",async()=>{
 const s=fixtureStore();
 try {
  const handle=createCareHandler(s), original=s.transaction.bind(s);
  let transactions=0;
  s.transaction=(action)=>{transactions++;return original(action);};
  const token=randomBytes(32).toString("base64url"), credential=randomBytes(32).toString("base64url");
  const post=(path:string,body:unknown,authorization?:string)=>handle(new Request(`http://localhost/api/${path}`,{method:"POST",headers:{"Content-Type":"application/json",...(authorization?{authorization}:{})},body:JSON.stringify(body)}));
  const statuses=[];
  for(let i=0;i<32;i++)statuses.push((await post("external-visits/redeem",{token,declaredName:"External doctor",organization:"Fictional clinic"})).status);
  assert.ok(statuses.every(status=>status===404),"redemption stays neutral when throttled");
  assert.ok(transactions<=5,`redemption touched SQLite ${transactions} times`);
  transactions=0;
  const responses=[];
  for(let i=0;i<100;i++)responses.push(await post("connectors/events",{},`Bearer ${credential}`));
  assert.ok(responses.some(response=>response.status===429));
  assert.ok(transactions<=60,`bearer ingress touched SQLite ${transactions} times`);
  assert.ok(responses.filter(response=>response.status===429).every(response=>response.headers.has("retry-after")));
 } finally {s.close();}
});

test("the actual single-use share URL redeems once and guest identity stays separate",async()=>{
 const s=fixtureStore();
 try {
  const fact={id:"fact-to-share",patientId:"fatma",kind:"condition" as const,code:"hypertension",label:"Patient declaration",value:null,polarity:"affirmed" as const,revision:1,verification:"patient_reported" as const,createdAt:new Date().toISOString(),supersededBy:null,sources:[]};
  // Selection is explicit and frozen; the HTTP adapter must not require an account cookie.
  s.transaction(state=>state.medicalFacts.push(fact));
  const issued=new ExternalVisitService(s).issue(testOwner,"fatma",{selection:[{kind:"patient_fact",id:fact.id,revision:1}],clientId:"http-single-use"});
  assert.ok(issued.url);const token=new URL(issued.url!,"http://localhost").hash.slice(1);
  const handle=createCareHandler(s),patientCookie=`hackcure_session=${signSession(testOwner,Date.now(),s)}`;
  const req=()=>new Request("http://localhost/api/external-visits/redeem",{method:"POST",headers:{"Content-Type":"application/json",cookie:patientCookie},body:JSON.stringify({token,declaredName:"Declared doctor",organization:""})});
  const winner=await handle(req());assert.equal(winner.status,201);
  assert.equal((await winner.json()).visit.organization,"");
  const guestCookie=winner.headers.get("set-cookie")!.split(";")[0];assert.match(guestCookie,/hackcure_external_visit=/);
  const losing=await handle(req());assert.equal(losing.status,404);assert.equal((await losing.json()).error.code,"VISIT_UNAVAILABLE");
  const record=await handle(new Request("http://localhost/api/external-visit/record",{headers:{cookie:`${patientCookie}; ${guestCookie}`}}));
  assert.equal(record.status,200);assert.equal((await record.json()).selection.medicalFacts[0].id,fact.id);
 }finally{s.close();}
});

test("invalid model configuration never prevents medical fact capture and generation falls back honestly", async()=>{
 const previous=process.env.HACKCURE_OLLAMA_BASE_URL;
 process.env.HACKCURE_OLLAMA_BASE_URL="https://untrusted.invalid/";
 const s=fixtureStore();
 try{
  const handler=createCareHandler(s),cookie=`hackcure_session=${signSession(testOwner,Date.now(),s)}`;
  const post=(path:string,body:unknown)=>handler(new Request(`http://localhost/api/${path}`,{method:"POST",headers:{cookie,"Content-Type":"application/json"},body:JSON.stringify(body)}));
  const captured=await post("patients/fatma/medical-facts",{kind:"condition",code:"hypertension",label:"Tension",value:null,polarity:"affirmed",expectedContextRevision:0,clientId:"config-fact"});
  assert.equal(captured.status,201);
  assert.equal(s.read().medicalFacts.length,1);
  const generated=await post("patients/fatma/proposals/generate",{clientId:"config-generation"});
  assert.equal(generated.status,200);
  const result=await generated.json();
  assert.equal(result.meta.mode,"deterministic");
  assert.equal(result.meta.failureReason,"provider_unavailable");
  assert.equal((await post("patients/fatma/proposals/generate",{})).status,400);
 } finally {s.close();if(previous===undefined)delete process.env.HACKCURE_OLLAMA_BASE_URL;else process.env.HACKCURE_OLLAMA_BASE_URL=previous;}
});

test("care-plan messaging and contact HTTP routes return real scoped records",async()=>{
 const previous=process.env.DEMO_CLINICIAN_PASSWORD;process.env.DEMO_CLINICIAN_PASSWORD="Synthetic doctor password!";
 const s=fixtureStore();
 try {
  const handler=createCareHandler(s),patientCookie=`hackcure_session=${signSession(testOwner,Date.now(),s)}`,doctorCookie=`hackcure_session=${signSession(testDoctor,Date.now(),s)}`;
  const request=(path:string,method="GET",body?:unknown,cookie=patientCookie)=>handler(new Request(`http://localhost/api/${path}`,{method,headers:{cookie,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  const plan=await request("patients/fatma/care-plan");assert.equal(plan.status,200);assert.ok((await plan.json()).plan);
  const message=await request("patients/fatma/messages","POST",{text:"Nouvelle information à revoir",kind:"administrative",clinicianId:testDoctor.id,clientId:"http-message"});
  assert.equal(message.status,201);const messageBody=await message.json();assert.equal(messageBody.message.kind,"clinical");
  const listed=await request("patients/fatma/messages","GET",undefined,doctorCookie);assert.equal(listed.status,200);assert.equal((await listed.json()).messages[0].id,messageBody.message.id);
  const contact=await request("patients/fatma/contact-requests","POST",{clinicianId:testDoctor.id,clientId:"http-contact"});assert.equal(contact.status,201);assert.equal((await contact.json()).contactRequest.state,"requested");
  assert.equal((await request("patients/ahmed/messages","GET")).status,404);
  assert.equal((await request("patients/%ZZ")).status,400);
  const unmatched=await request("unknown-route");assert.equal(unmatched.status,404);assert.equal((await unmatched.json()).error.code,"ROUTE_NOT_FOUND");
 } finally {s.close();if(previous===undefined)delete process.env.DEMO_CLINICIAN_PASSWORD;else process.env.DEMO_CLINICIAN_PASSWORD=previous;}
});
test("HTTP permanent account registers, signs current session and keeps dossier on repeat login",async()=>{const s=new CareStore(":memory:");try{const handle=createCareHandler(s);const input={login:"http.patient",password:"Synthetic password for HTTP!",displayName:"HTTP patient",age:42,region:"Tunis",language:"fr",consent:true,fictionalDemo:true,clientId:"http-register"};const req=(path:string,body?:unknown,cookie?:string)=>new Request(`http://localhost/api/${path}`,{method:body?"POST":"GET",headers:{...(body?{"Content-Type":"application/json"}:{}),...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const registration=await handle(req("accounts",input));assert.equal(registration.status,201);assert.equal(registration.headers.get("cache-control"),"no-store");const initial=await registration.json();const login=await handle(req("session",{login:input.login,password:input.password}));assert.equal(login.status,200);assert.equal((await login.json()).actor.id,initial.actor.id);const cookie=login.headers.get("set-cookie")!.split(";")[0];const record=await handle(req(`patients/${initial.patientId}`,undefined,cookie));assert.equal(record.status,200);assert.equal((await record.json()).access.owner,true);const legacy=await handle(req("patients",{consent:true},cookie));assert.equal(legacy.status,410);assert.equal((await handle(req("session",{role:"clinician",password:input.password}))).status,401);assert.equal(s.read().careGrants.length,0);}finally{s.close();}});
