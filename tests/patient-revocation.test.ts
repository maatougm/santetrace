import test from "node:test";
import assert from "node:assert/strict";
import { CareService } from "../src/lib/care-service";
import { EndoRecordService } from "../src/lib/endorecord-service";
import { PatientAccessService } from "../src/lib/patient-access-service";
import { fixtureStore, testOwner, testDoctor } from "./helpers/care-fixture";
test("held PDF source rechecks narrowed grant and journals denied release without bytes",async()=>{const s=fixtureStore();try{const id="00000000-0000-4000-8000-000000000001";s.transaction(st=>st.documents.push({id,patientId:"fatma",filename:"synthetic.pdf",uploadedAt:new Date().toISOString(),status:"review"}));let release!:(b:Buffer)=>void;const bytes=new Promise<Buffer>(r=>release=r);const service=new EndoRecordService(s,".data/unused",async()=>[],()=>bytes);const result=service.source(testDoctor,id);new PatientAccessService(s).update(testOwner,"grant:fatma",{action:"update",scopes:["status"],expectedRevision:1,clientId:"narrow"});release(Buffer.from("private bytes"));await assert.rejects(()=>result,e=>(e as {code:string}).code==="FORBIDDEN");assert.equal(s.read().audit.some(a=>a.action==="read_document_source"),false);assert.equal(s.read().accessJournal.at(-1)?.outcome,"denied");}finally{s.close();}});
test("revocation blocks measurement replay and retains denial journal after rollback",()=>{const s=fixtureStore();try{const svc=new CareService(s),b={kind:"glucose",value:100,unit:"mg/dL",measuredAt:new Date().toISOString(),clientId:"m"};svc.measurement(testDoctor,"fatma",b);new PatientAccessService(s).update(testOwner,"grant:fatma",{action:"revoke",expectedRevision:1,clientId:"r"});assert.throws(()=>svc.measurement(testDoctor,"fatma",b));assert.equal(s.read().measurements.length,1);assert.equal(s.read().accessJournal.at(-1)?.outcome,"denied");assert.equal(svc.patient(testOwner,"fatma").measurements.length,1);}finally{s.close();}});
test("legacy assignment creates no effective rights",()=>{const s=fixtureStore();try{s.transaction(st=>st.careGrants=[]);assert.throws(()=>new CareService(s).patient(testDoctor,"fatma"));assert.equal(new CareService(s).patient(testOwner,"fatma").patient.id,"fatma");}finally{s.close();}});

test("resource-ID clinical operations retain allowed and denied access journal entries",()=>{
 const s=fixtureStore();try{
  const care=new CareService(s),endo=new EndoRecordService(s);
  const receipt=care.measurement(testOwner,"fatma",{kind:"glucose",value:260,unit:"mg/dL",measuredAt:new Date().toISOString(),clientId:"journal-reading"});
  assert.ok(receipt.alert);
  s.transaction(st=>st.candidates.push({id:"journal-candidate",documentId:"journal-document",patientId:"fatma",exam:"HbA1c",value:7.2,unit:"%",examDate:"2026-10-10",page:1,sourceText:"synthetic",confidence:"high",confidenceReason:"synthetic",identityMatch:"matched",status:"proposed"}));
  endo.review(testDoctor,"journal-candidate",{action:"confirm",identityConfirmed:true});
  assert.ok(s.read().accessJournal.some(j=>j.action==="review_candidate"&&j.resourceId==="journal-candidate"&&j.outcome==="allowed"));
  const second={...testDoctor,id:"secondary"};s.transaction(st=>st.careGrants.push({id:"partial",patientId:"fatma",clinicianId:second.id,relationship:"specialist",scopes:["status"],state:"active",revision:1,issuedAt:new Date().toISOString(),acceptedAt:new Date().toISOString(),revokedAt:null}));
  assert.throws(()=>care.alert(second,receipt.alert!.id,{action:"acknowledge"}));
  assert.equal(s.read().accessJournal.at(-1)?.outcome,"denied");
  const before=s.read().accessJournal.length;
  assert.throws(()=>endo.revise(second,s.read().observations[0].id,{value:7.1,unit:"%",examDate:"2026-10-10",reason:"Revoir"}));
  assert.equal(s.read().accessJournal.length,before+1);assert.equal(s.read().accessJournal.at(-1)?.outcome,"denied");
 }finally{s.close();}
});
