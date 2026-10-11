import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ExternalVisitService } from "../src/lib/external-visit-service";
import { CareService } from "../src/lib/care-service";
import { fixtureStore, testOwner } from "./helpers/care-fixture";
const now=Date.parse("2026-10-11T08:00:00Z"), pdf=Buffer.from("%PDF-1.4 entire selected file");
function setup(fileReader:()=>Promise<Buffer>=async()=>pdf){
  const store=fixtureStore();store.transaction(s=>s.documents.push({id:"33333333-3333-4333-8333-333333333333",patientId:"fatma",filename:"a.pdf",contentHash:createHash("sha256").update(pdf).digest("hex"),uploadedAt:new Date(now).toISOString(),status:"reviewed"}));
  const service=new ExternalVisitService(store,{clock:()=>now,fileReader}), input={selection:[{kind:"document" as const,id:"33333333-3333-4333-8333-333333333333",revision:1}],clientId:"issue"};
  const issued=service.issue(testOwner,"fatma",input),token=new URL(issued.url!,"http://localhost").hash.slice(1),session=service.redeem({token,declaredName:"Declared guest",organization:"Cabinet"});
  return {store,service,issued,input,session};
}
test("revocation during held PDF read prevents late bytes and records denial",async()=>{
  let release!:(b:Buffer)=>void, entered!:()=>void;const reached=new Promise<void>(r=>{entered=r;});
  const s=setup(async()=>{entered();return new Promise<Buffer>(r=>{release=r;});}),pending=s.service.source(s.session.sessionToken,"33333333-3333-4333-8333-333333333333");
  await reached;s.service.revoke(testOwner,s.issued.grant.id,{action:"revoke",expectedRevision:2,clientId:"revoke"});release(pdf);
  await assert.rejects(pending,{code:"VISIT_UNAVAILABLE",status:404});
  assert.equal(s.store.read().accessJournal.some(e=>e.actorCategory==="guest"&&e.outcome==="denied"),true);s.store.close();
});
test("changed file bytes or metadata cannot substitute another selected PDF",async()=>{
  const s=setup(async()=>Buffer.from("%PDF-1.4 wrong bytes"));await assert.rejects(s.service.source(s.session.sessionToken,"33333333-3333-4333-8333-333333333333"),{code:"VISIT_UNAVAILABLE",status:404});s.store.close();
});
test("withdrawal or selected hash change during file I/O prevents release",async()=>{
  for(const change of ["withdraw","hash"]){
    let release!:(b:Buffer)=>void, entered!:()=>void;const reached=new Promise<void>(r=>{entered=r;});
    const s=setup(async()=>{entered();return new Promise<Buffer>(r=>{release=r;});});
    const pending=s.service.source(s.session.sessionToken,"33333333-3333-4333-8333-333333333333");
    await reached;
    if(change==="withdraw")new CareService(s.store).consent(testOwner,"fatma",{consent:false});
    else s.store.transaction(state=>{state.documents[0].contentHash="a".repeat(64);});
    release(pdf);await assert.rejects(pending,{code:"VISIT_UNAVAILABLE",status:404});s.store.close();
  }
});
test("withdrawn consent blocks sessions and note replay while owner keeps grant control",()=>{
  const s=setup(),input={text:"Initial note",consultationDate:null,correctsNoteId:null,clientId:"note"};
  const old=s.service.appendNote(s.session.sessionToken,input);new CareService(s.store).consent(testOwner,"fatma",{consent:false});
  assert.throws(()=>s.service.appendNote(s.session.sessionToken,input),{code:"VISIT_UNAVAILABLE",status:404});
  assert.throws(()=>s.service.record(s.session.sessionToken),{code:"VISIT_UNAVAILABLE",status:404});
  assert.equal(s.store.read().externalNotes[0].id,old.id);assert.equal(s.service.list(testOwner,"fatma").grants.length,1);
  assert.throws(()=>s.service.issue(testOwner,"fatma",s.input),{code:"CONSENT_REVOKED"});s.store.close();
});
test("revocation before note commit adds nothing and stale revoke is rejected",()=>{
  const s=setup();assert.throws(()=>s.service.revoke(testOwner,s.issued.grant.id,{action:"revoke",expectedRevision:1,clientId:"stale"}),{code:"STALE_REVISION"});
  s.service.revoke(testOwner,s.issued.grant.id,{action:"revoke",expectedRevision:2,clientId:"revoke"});
  assert.throws(()=>s.service.appendNote(s.session.sessionToken,{text:"Late note",consultationDate:null,correctsNoteId:null,clientId:"late"}),{code:"VISIT_UNAVAILABLE",status:404});
  assert.equal(s.store.read().externalNotes.length,0);s.store.close();
});
