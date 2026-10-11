import { fixtureStore } from "./helpers/care-fixture";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor } from "../src/contracts/care";
import { CareStore } from "../src/lib/care-store";
import { CareError } from "../src/lib/care-service";
import { EndoRecordService, extractPdfPages, MAX_PDF_BYTES, proposeCandidates } from "../src/lib/endorecord-service";
const doctor:Actor={id:"demo-clinician",role:"clinician",displayName:"Doctor",patientId:null};
const patient:Actor={id:"patient:fatma",role:"patient",displayName:"Fatma",patientId:"fatma"};
const other:Actor={...doctor,id:"other"};
const text="Patient: Fatma Ben Salah\nDEMONSTRATION FICTIVE\nDate examen: 03/10/2026\nHbA1c: 8,4 %";
const bytes=new TextEncoder().encode("%PDF-1.4 synthetic test fixture");
const errorCode=(code:string)=>(error:unknown)=>error instanceof CareError&&error.code===code;
async function fixture(action:(service:EndoRecordService,store:CareStore)=>Promise<void>,pages=[{page:1,text}]) {
 const store=fixtureStore(),dir=await mkdtemp(join(tmpdir(),"endorecord-"));
 try {await action(new EndoRecordService(store,dir,async()=>pages),store);} finally {store.close();await rm(dir,{recursive:true,force:true});}
}
test("extract explicit HbA1c with source evidence, date and identity; ambiguous dates stay null",()=>{
 const [candidate]=proposeCandidates([{page:2,text}],"Fatma Ben Salah","document","fatma");
 assert.equal(candidate.value,8.4);assert.equal(candidate.unit,"%");assert.equal(candidate.examDate,"2026-10-03");assert.equal(candidate.page,2);assert.equal(candidate.identityMatch,"matched");assert.match(candidate.sourceText,/HbA1c/);
 assert.equal(proposeCandidates([{page:1,text:text+"\nPrinted 04/10/2026"}],"Fatma Ben Salah","document","fatma")[0].examDate,null);
 assert.equal(proposeCandidates([{page:1,text:"Patient: Someone Else\nHbA1c: 9 %"}],"Fatma Ben Salah","document","fatma")[0].identityMatch,"mismatch");
});
test("candidate requires clinician plus explicit identity; original evidence survives corrections and revisions",async()=>fixture(async(service,store)=>{
 const uploaded=await service.upload(patient,"fatma","lab.pdf",bytes);const c=uploaded.candidates[0];
 assert.equal(store.read().observations.length,0);
 assert.throws(()=>service.review(patient,c.id,{action:"confirm",identityConfirmed:true}),errorCode("FORBIDDEN"));
 assert.throws(()=>service.review(doctor,c.id,{action:"confirm"}),errorCode("IDENTITY_REQUIRED"));
 assert.throws(()=>service.review(doctor,c.id,{action:"confirm",identityConfirmed:true,value:8.5}),errorCode("INVALID_INPUT"));
 const confirmed=service.review(doctor,c.id,{action:"confirm",identityConfirmed:true,value:8.5,reason:"PDF checked"});
 assert.equal(confirmed.observation!.value,8.5);assert.equal(confirmed.candidate.value,8.4);assert.equal(confirmed.observation!.documentId,uploaded.document.id);
 assert.throws(()=>service.review(doctor,c.id,{action:"confirm",identityConfirmed:true}),errorCode("ALREADY_REVIEWED"));
 const revision=service.revise(doctor,confirmed.observation!.id,{value:8.6,unit:"%",examDate:"2026-10-03",reason:"Second review"}).observation;
 assert.equal(revision.revisions[0].value,8.5);assert.equal(revision.revisions[0].author,doctor.id);assert.equal(revision.value,8.6);
 assert.equal(store.read().documents[0].status,"reviewed");
}));
test("source and upload enforce assigned scope and revoked consent",async()=>fixture(async(service,store)=>{
 const {document}=await service.upload(patient,"fatma","../lab.pdf",bytes);
 assert.equal(document.filename,".._lab.pdf");assert.deepEqual(await service.source(doctor,document.id),Buffer.from(bytes));
 await assert.rejects(()=>service.source(other,document.id),errorCode("NOT_FOUND"));
 await assert.rejects(()=>service.upload(other,"fatma","lab.pdf",bytes),errorCode("NOT_FOUND"));
 store.transaction(s=>{s.patients.find(p=>p.id==="fatma")!.consent=false;});
 await assert.rejects(()=>service.source(doctor,document.id),errorCode("CONSENT_REVOKED"));
 assert.deepEqual(await service.source(patient,document.id),Buffer.from(bytes));
}));
test("scans never produce trusted values, rejection requires reason, invalid dates/units rejected",async()=>{
 await fixture(async(service,store)=>{const result=await service.upload(patient,"fatma","scan.pdf",bytes);assert.equal(result.document.status,"needs_manual_review");assert.equal(store.read().observations.length,0);},[{page:1,text:""}]);
 await fixture(async(service)=>{const c=(await service.upload(patient,"fatma","lab.pdf",bytes)).candidates[0];
 assert.throws(()=>service.review(doctor,c.id,{action:"confirm",identityConfirmed:true,examDate:"2026-02-30",reason:"check"}),errorCode("INVALID_DATE"));
 assert.throws(()=>service.review(doctor,c.id,{action:"confirm",identityConfirmed:true,unit:"mg/dL",reason:"check"}),errorCode("INVALID_VALUE"));
 assert.throws(()=>service.review(doctor,c.id,{action:"reject"}),errorCode("INVALID_INPUT"));
 assert.equal(service.review(doctor,c.id,{action:"reject",reason:"Incorrect source"}).observation,null);
 });
});
test("invalid PDF, excessive bytes and excessive pages are rejected before persistence",async()=>{
 await fixture(async(service,store)=>{await assert.rejects(()=>service.upload(patient,"fatma","bad.pdf",new Uint8Array(10)),errorCode("INVALID_PDF"));await assert.rejects(()=>service.upload(patient,"fatma","large.pdf",new Uint8Array(MAX_PDF_BYTES+1)),errorCode("TOO_LARGE"));assert.equal(store.read().documents.length,0);});
 await fixture(async(service)=>{await assert.rejects(()=>service.upload(patient,"fatma","pages.pdf",bytes),errorCode("TOO_MANY_PAGES"));},Array.from({length:21},(_,i)=>({page:i+1,text:""})));
});
test("PDFjs extracts the real synthetic demo file",async()=>{
 const {readFile}=await import("node:fs/promises");const pages=await extractPdfPages(new Uint8Array(await readFile("demos/fatma-hba1c.pdf")));
 const c=proposeCandidates(pages,"Fatma Ben Salah","demo","fatma")[0];assert.equal(c.value,8.4);assert.equal(c.examDate,"2026-10-03");assert.equal(c.identityMatch,"matched");
});
test("identical uploads reuse patient-scoped source even concurrently and after confirmation",async()=>fixture(async(service,store)=>{
 const [first,second]=await Promise.all([service.upload(patient,"fatma","first.pdf",bytes),service.upload(patient,"fatma","again.pdf",bytes)]);
 assert.equal(first.document.id,second.document.id);assert.equal(store.read().documents.length,1);assert.equal(store.read().candidates.length,1);
 service.review(doctor,first.candidates[0].id,{action:"confirm",identityConfirmed:true});
 const repeat=await service.upload(patient,"fatma","again.pdf",bytes);assert.equal(repeat.candidates[0].status,"confirmed");assert.equal(store.read().observations.length,1);
 const another=await service.upload(doctor,"ahmed","same.pdf",bytes);assert.notEqual(another.document.id,first.document.id);assert.equal(store.read().documents.length,2);
 const {readdir}=await import("node:fs/promises");
 // Two patients own two files; a concurrent duplicate's temporary file has been removed.
 const directory=(service as unknown as {directory:string}).directory;assert.equal((await readdir(directory)).length,2);
}));
test("future exam dates are blocked at confirmation and revision, today remains valid",async()=>fixture(async(service)=>{
 const c=(await service.upload(patient,"fatma","lab.pdf",bytes)).candidates[0];
 assert.throws(()=>service.review(doctor,c.id,{action:"confirm",identityConfirmed:true,examDate:"2099-01-01",reason:"check"}),errorCode("FUTURE_EXAM_DATE"));
 const today=new Date().toISOString().slice(0,10);
 const confirmed=service.review(doctor,c.id,{action:"confirm",identityConfirmed:true,examDate:today,reason:"Date checked"});
 assert.throws(()=>service.revise(doctor,confirmed.observation!.id,{value:8.5,unit:"%",examDate:"2099-01-01",reason:"check"}),errorCode("FUTURE_EXAM_DATE"));
 assert.equal(service.revise(doctor,confirmed.observation!.id,{value:8.5,unit:"%",examDate:today,reason:"checked"}).observation.examDate,today);
}));
test("PDF timeout terminates actual workers and bounded concurrency releases slots",async()=>{
 const {writeFile}=await import("node:fs/promises");const {runPdfWorker,activePdfParsers}=await import("../src/lib/endorecord-service");
 const dir=await mkdtemp(join(tmpdir(),"pdf-worker-test-"));const path=join(dir,"busy.mjs");const marker=join(dir,"still-running");
 await writeFile(path,`import {writeFileSync} from 'node:fs'; setInterval(()=>{},5); setTimeout(()=>writeFileSync(${JSON.stringify(marker)},'work continued'),600);`);
 try {
  const first=runPdfWorker(bytes,{workerPath:path,timeoutMs:150}),second=runPdfWorker(bytes,{workerPath:path,timeoutMs:150});
  assert.equal(activePdfParsers(),2);
  await assert.rejects(()=>runPdfWorker(bytes,{workerPath:path,timeoutMs:150}),errorCode("PARSER_BUSY"));
  const result=await Promise.allSettled([first,second]);assert.ok(result.every(r=>r.status==="rejected"&&errorCode("PDF_TIMEOUT")(r.reason)));assert.equal(activePdfParsers(),0);
  await new Promise(resolve=>setTimeout(resolve,700));
  const {access}=await import("node:fs/promises");await assert.rejects(()=>access(marker));
 } finally {await rm(dir,{recursive:true,force:true});}
});
test("explicit different identity is authoritative over reference prose and partial names",()=>{
 const candidate=(text:string,name="Fatma Ben Salah")=>proposeCandidates([{page:1,text:`${text}\nDate examen: 03/10/2026\nHbA1c: 8.4 %`}],name,"doc","fatma")[0];
 for (const source of ["Patient: Ahmed Trabelsi\nReference: Fatma Ben Salah", "Nom: Fatma Ben Salahani", "Patient: Fatma Ben", "Patient: Fatma Ben Salah\nNom: Ahmed Trabelsi"]) {
  const c=candidate(source);assert.equal(c.identityMatch,"mismatch");assert.equal(c.confidence,"low");
 }
 assert.equal(candidate("Reference: Fatma Ben Salah").identityMatch,"unknown");
 assert.equal(candidate("Patient: FATMA   BEN SALAH").identityMatch,"matched");
});
test("source rechecks consent after async file read and does not audit denied release",async()=>fixture(async(service,store)=>{
 const {document}=await service.upload(patient,"fatma","lab.pdf",bytes);
 const race=new EndoRecordService(store,".data/unused",async()=>[],async()=>{
  await Promise.resolve();store.transaction(state=>{state.patients.find(p=>p.id==="fatma")!.consent=false;});
  return Buffer.from(bytes);
 });
 await assert.rejects(()=>race.source(doctor,document.id),errorCode("CONSENT_REVOKED"));
 assert.equal(store.read().audit.filter(entry=>entry.action==="read_document_source").length,0);
}));
