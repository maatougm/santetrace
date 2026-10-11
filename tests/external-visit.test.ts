import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ExternalVisitService } from "../src/lib/external-visit-service";
import { GUEST_SESSION_COOKIE, guestCookieHeader, guestTokenFromRequest } from "../src/lib/external-visit-session";
import { CareService } from "../src/lib/care-service";
import { fixtureStore, testOwner, testDoctor } from "./helpers/care-fixture";

const start = Date.parse("2026-10-11T08:00:00Z");
const pdf = Buffer.from("%PDF-1.4 fictional whole document pages");
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function setup() {
  const store = fixtureStore(); let now = start;
  store.transaction(s => {
    s.documents.push({id:"11111111-1111-4111-8111-111111111111",patientId:"fatma",filename:"full.pdf",contentHash:digest(pdf),uploadedAt:new Date(start).toISOString(),status:"reviewed"});
    s.documents.push({id:"22222222-2222-4222-8222-222222222222",patientId:"fatma",filename:"hidden.pdf",contentHash:digest(pdf),uploadedAt:new Date(start).toISOString(),status:"reviewed"});
    s.medicalFacts.push({id:"fact-old",patientId:"fatma",kind:"condition",code:"diabetes",label:"Déclaration",value:null,polarity:"affirmed",verification:"patient_reported",sources:[],revision:1,createdAt:new Date(start).toISOString(),supersededBy:null});
  });
  const service = new ExternalVisitService(store,{clock:()=>now,fileReader:async()=>pdf});
  const input = {selection:[{kind:"patient_fact" as const,id:"fact-old",revision:1},{kind:"document" as const,id:"11111111-1111-4111-8111-111111111111",revision:1}],clientId:"issue-1"};
  const issued = service.issue(testOwner,"fatma",input);
  const token = new URL(issued.url!,"http://localhost").hash.slice(1);
  const activate = () => service.redeem({token,declaredName:"Dr. Fiction",organization:"Demo cabinet"});
  return {store,service,issued,input,token,activate,setNow:(value:number)=>{now=value;}};
}

test("issue stores only hashes; replay returns metadata and null URL", () => {
  const s=setup();
  assert.match(s.token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal("tokenHash" in s.issued.grant,false);
  assert.equal("frozenProjection" in s.issued.grant,false);
  assert.equal(JSON.stringify(s.store.read()).includes(s.token),false);
  assert.equal(s.service.issue(testOwner,"fatma",s.input).url,null);
  assert.equal(s.store.read().externalVisitGrants.length,1);
  assert.throws(()=>s.service.issue(testOwner,"fatma",{...s.input,selection:[{kind:"document",id:"22222222-2222-4222-8222-222222222222",revision:1}]}),{code:"IDEMPOTENCY_CONFLICT"});
  s.store.close();
});

test("preview has no side effect; twenty explicit competing activations yield one session", async () => {
  const s=setup();
  assert.equal(s.store.read().externalVisitGrants[0].state,"pending");
  assert.equal(guestTokenFromRequest(new Request("http://localhost/share#"+s.token)),null);
  const settled=await Promise.allSettled(Array.from({length:20},async()=>s.activate()));
  const winners=settled.filter(r=>r.status==="fulfilled");
  assert.equal(winners.length,1);
  for(const r of settled)if(r.status==="rejected")assert.equal(r.reason.code,"VISIT_UNAVAILABLE");
  assert.equal(s.store.read().externalVisitSessions.length,1);
  s.store.close();
});

test("optional guest organization may be empty; invalid declarations do not consume the link", () => {
  const s = setup();
  try {
    for (const organization of [null, 123, "x".repeat(101)]) {
      assert.throws(() => s.service.redeem({ token: s.token, declaredName: "Dr. Fiction", organization } as never), { code: "INVALID_INPUT" });
      assert.equal(s.store.read().externalVisitGrants[0].state, "pending");
      assert.equal(s.store.read().externalVisitSessions.length, 0);
    }
    const session = s.service.redeem({ token: s.token, declaredName: "Dr. Fiction", organization: "   " });
    assert.equal(session.visit.organization, "");
    assert.equal(session.visit.verification, "unverified");
    const note = s.service.appendNote(session.sessionToken, { text: "Fictional consultation note.", consultationDate: "2026-10-11", correctsNoteId: null, clientId: "optional-organization-note" });
    assert.equal(note.organization, "");
    assert.equal(note.verification, "external_unverified");
    assert.throws(() => s.service.redeem({ token: s.token, declaredName: "Another guest", organization: "" }), { code: "VISIT_UNAVAILABLE" });
  } finally { s.store.close(); }
});

test("guest cookie is separate, HttpOnly, strict, bounded and ignores account cookie", () => {
  const token="a".repeat(43), header=guestCookieHeader(token);
  assert.match(header,new RegExp("^"+GUEST_SESSION_COOKIE+"="));
  assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Strict/);assert.match(header,/Max-Age=3600/);
  assert.equal(guestTokenFromRequest(new Request("http://localhost",{headers:{cookie:"hackcure_session="+token}})),null);
  assert.equal(guestTokenFromRequest(new Request("http://localhost",{headers:{cookie:GUEST_SESSION_COOKIE+"="+token}})),token);
  assert.equal(guestTokenFromRequest(new Request("http://localhost",{headers:{cookie:GUEST_SESSION_COOKIE+"="+token+"; "+GUEST_SESSION_COOKIE+"="+token}})),null);
});

test("winner reads frozen selected fact and whole PDF repeatedly; later facts remain excluded", async () => {
  const s=setup(), session=s.activate();
  s.store.transaction(state=>{
    state.medicalFacts[0].supersededBy="new-fact";
    state.medicalFacts.push({...state.medicalFacts[0],id:"new-fact",label:"Correction",revision:2,supersededBy:null});
  });
  const record=s.service.record(session.sessionToken);
  assert.equal(record.selection.medicalFacts.length,1);
  assert.equal(record.selection.medicalFacts[0].label,"Déclaration");
  assert.equal(record.selection.medicalFacts[0].supersededBy,null);
  assert.equal(record.selection.documents.length,1);
  assert.equal("patient" in record,false);
  assert.deepEqual(await s.service.source(session.sessionToken,"11111111-1111-4111-8111-111111111111"),pdf);
  assert.deepEqual(await s.service.source(session.sessionToken,"11111111-1111-4111-8111-111111111111"),pdf);
  await assert.rejects(s.service.source(session.sessionToken,"22222222-2222-4222-8222-222222222222"),{code:"VISIT_UNAVAILABLE",status:404});
  assert.equal(JSON.stringify(s.store.read()).includes(session.sessionToken),false);
  s.store.close();
});

test("selection cannot escape patient, source version or approval scope", () => {
  const store=fixtureStore(), service=new ExternalVisitService(store,{clock:()=>start});
  new CareService(store).measurement(testOwner,"fatma",{kind:"pulse",value:72,unit:"bpm",measuredAt:new Date().toISOString(),clientId:"pulse"});
  const measurement=store.read().measurements[0];
  assert.throws(()=>service.issue(testDoctor,"fatma",{selection:[{kind:"measurement",id:measurement.id,revision:1}],clientId:"doctor"}),{code:"FORBIDDEN"});
  assert.throws(()=>service.issue(testOwner,"fatma",{selection:[{kind:"measurement",id:measurement.id,revision:2}],clientId:"bad-version"}),{code:"INVALID_SELECTION"});
  assert.throws(()=>service.issue(testOwner,"fatma",{selection:[{kind:"patient_fact",id:"other-patient",revision:1}],clientId:"bad-id"}),{code:"INVALID_SELECTION"});
  assert.throws(()=>service.issue(testOwner,"fatma",{selection:[{kind:"approved_action",id:"unapproved",revision:1}],clientId:"draft"}),{code:"INVALID_SELECTION"});
  store.close();
});

test("explicit earlier observation revision preserves values without later correction history", () => {
  const s=setup();
  s.store.transaction(state=>state.observations.push({id:"lab",patientId:"fatma",exam:"HbA1c",value:9,unit:"%",examDate:"2026-10-11",documentId:"11111111-1111-4111-8111-111111111111",candidateId:"candidate",confirmedBy:testDoctor.id,confirmedAt:new Date(start).toISOString(),revisions:[{value:7,unit:"%",examDate:"2026-09-01",reason:"Correction",author:testDoctor.id,at:new Date(start).toISOString()}]}));
  const issued=s.service.issue(testOwner,"fatma",{selection:[{kind:"observation",id:"lab",revision:1}],clientId:"old-lab"});
  const session=s.service.redeem({token:new URL(issued.url!,"http://localhost").hash.slice(1),declaredName:"Guest",organization:"Cabinet"});
  const selected=s.service.record(session.sessionToken).selection;
  assert.equal(selected.observations[0].value,7);assert.equal(selected.observations[0].examDate,"2026-09-01");assert.deepEqual(selected.observations[0].revisions,[]);assert.equal(selected.documents.length,0);
  s.store.close();
});

test("approved action selection excludes pending proposals and cannot select another patient's sources", () => {
  const s=setup();
  s.store.transaction(state=>{
    const guard={contextRevision:0,evidenceRevision:0,authorityRevision:0,carePlanRevision:0,profileVersions:[]};
    state.careProposals.push({id:"approved",patientId:"fatma",revision:2,kind:"home_measurement",state:"approved",action:{templateId:"home.glucose",templateVersion:1,parameters:{}},sources:[],guard,decision:{clinicianId:testDoctor.id,at:new Date(start).toISOString(),reason:"Approved"},history:[]});
    state.careActions.push({id:"action",patientId:"fatma",planId:"plan",revision:1,proposalId:"approved",protocolId:null,originVersion:2,action:{templateId:"home.glucose",templateVersion:1,parameters:{}},dueAt:new Date(start).toISOString(),state:"pending",reportedAt:null,clientId:"approval",createdAt:new Date(start).toISOString()});
    state.medicalFacts.push({...state.medicalFacts[0],id:"other",patientId:"ahmed"});
  });
  const issued=s.service.issue(testOwner,"fatma",{selection:[{kind:"approved_action",id:"action",revision:1}],clientId:"action-only"});
  const session=s.service.redeem({token:new URL(issued.url!,"http://localhost").hash.slice(1),declaredName:"Guest",organization:"Cabinet"});
  const selected=s.service.record(session.sessionToken).selection;assert.equal(selected.actions.length,1);assert.equal(selected.medicalFacts.length,0);
  assert.throws(()=>s.service.issue(testOwner,"fatma",{selection:[{kind:"patient_fact",id:"other",revision:1}],clientId:"wrong-patient"}),{code:"INVALID_SELECTION"});
  s.store.close();
});

test("plain notes are server-attributed, append-only, idempotent and suspend reuse", () => {
  const s=setup(), session=s.activate();
  s.store.transaction(state=>state.protocols.push({id:"p",patientId:"fatma",revision:1,state:"active",clinicianId:"demo-clinician",sourceProposalId:"q",authorityRevision:0,requiredContextRevision:0,carePlanRevision:0,profileVersions:[],actions:[],predicates:[],exclusions:[],stopCriteria:[],validUntil:new Date(start+86400000).toISOString(),minIntervalSeconds:60,maxApplications:2,createdAt:new Date(start).toISOString(),history:[]}));
  const input={text:"Le patient déclare une amélioration. <script>alert(1)</script>",consultationDate:"2026-10-11",correctsNoteId:null,clientId:"note-1"};
  const note=s.service.appendNote(session.sessionToken,input);
  assert.equal(note.declaredName,"Dr. Fiction");assert.equal(note.verification,"external_unverified");
  assert.equal(note.text,input.text);
  assert.equal(s.store.read().protocols[0].state,"suspended");
  assert.equal(s.store.read().patientRevisions.find(r=>r.patientId==="fatma")!.contextRevision,1);
  assert.equal(s.store.read().patientRevisions.find(r=>r.patientId==="fatma")!.evidenceRevision,1);
  assert.deepEqual(s.service.appendNote(session.sessionToken,input),note);
  assert.equal(s.store.read().externalNotes.length,1);
  assert.throws(()=>s.service.appendNote(session.sessionToken,{...input,text:"different"}),{code:"IDEMPOTENCY_CONFLICT"});
  assert.throws(()=>s.service.appendNote(session.sessionToken,{...input,clientId:"forged",declaredName:"Real verified doctor"} as typeof input),{code:"INVALID_INPUT"});
  const corrected=s.service.appendNote(session.sessionToken,{...input,clientId:"note-2",text:"Correction explicite",correctsNoteId:note.id});
  assert.equal(corrected.correctsNoteId,note.id);assert.equal(s.store.read().externalNotes[0].text,input.text);
  assert.throws(()=>s.service.appendNote(session.sessionToken,{...input,clientId:"note-3",correctsNoteId:"foreign-note"}),{code:"INVALID_INPUT"});
  s.store.close();
});

test("expiry uses 24-hour redemption, absolute 60 minutes, idle 15 minutes and explicit end", () => {
  const expired=setup();expired.setNow(start+24*3600000);assert.throws(expired.activate,{code:"VISIT_UNAVAILABLE",status:404});expired.store.close();
  const idle=setup(), i=idle.activate();idle.setNow(start+15*60000);assert.throws(()=>idle.service.record(i.sessionToken),{code:"VISIT_UNAVAILABLE",status:404});idle.store.close();
  const absolute=setup(), a=absolute.activate();
  for(let minutes=10;minutes<60;minutes+=10){absolute.setNow(start+minutes*60000);absolute.service.record(a.sessionToken);}
  absolute.setNow(start+60*60000);assert.throws(()=>absolute.service.record(a.sessionToken),{code:"VISIT_UNAVAILABLE",status:404});absolute.store.close();
  const ended=setup(), e=ended.activate();ended.service.endSession(e.sessionToken);ended.service.endSession(e.sessionToken);assert.throws(()=>ended.service.record(e.sessionToken),{code:"VISIT_UNAVAILABLE",status:404});ended.store.close();
});
