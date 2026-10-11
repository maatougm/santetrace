import test from "node:test";
import assert from "node:assert/strict";
import { SemanticSearchService } from "../src/lib/semantic-search";
import {fixtureStore,testDoctor,testOwner} from "./helpers/care-fixture";
import {PatientAccessService} from "../src/lib/patient-access-service";
import type {LocalModel} from "../src/lib/local-model";
import { createHash } from "node:crypto";
import { bumpPatientRevision } from "../src/lib/patient-access-service";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExternalNote } from "../src/contracts/external-visit";
const at=new Date().toISOString();
function setup(){const s=fixtureStore();s.transaction(st=>{st.medicalFacts.push({id:"f",patientId:"fatma",kind:"condition",code:"diabetes",label:"Diabète",value:null,polarity:"affirmed",verification:"patient_reported",sources:[],revision:1,createdAt:at,supersededBy:null},{id:"hidden",patientId:"ahmed",kind:"condition",code:"diabetes",label:"private other patient",value:null,polarity:"affirmed",verification:"patient_reported",sources:[],revision:1,createdAt:at,supersededBy:null});});return s;}
test("lexical fallback filters other patient and returns source links",async()=>{const s=setup();try{const r=await new SemanticSearchService(s).search(testDoctor,"fatma","diabète");assert.equal(r.mode,"lexical");assert.equal(r.noEvidence,false);assert.equal(r.hits[0].source.id,"f");assert.equal(JSON.stringify(r).includes("hidden"),false);}finally{s.close();}});
test("status-only rights never feed hidden chunks into embeddings",async()=>{const s=setup();try{let called=false;const model={generate:async()=>null,embed:async()=>{called=true;return [[1]];}};s.transaction(st=>st.careGrants[0].scopes=["status"]);await assert.rejects(()=>new SemanticSearchService(s,model).search(testDoctor,"fatma","diabetes"));assert.equal(called,false);}finally{s.close();}});
test("revocation during held embeddings prevents result release",async()=>{const s=setup();try{let release!:(v:number[][])=>void,began!:()=>void,batchSize=0;const started=new Promise<void>(r=>began=r),pending=new Promise<number[][]>(r=>release=r);const model:LocalModel={model:"test",generate:async()=>null,embed:texts=>{batchSize=texts.length;began();return pending;}};const result=new SemanticSearchService(s,model).search(testDoctor,"fatma","diabetes");await started;new PatientAccessService(s).update(testOwner,"grant:fatma",{action:"revoke",expectedRevision:1,clientId:"r"});release(Array.from({length:batchSize},()=>[1,0]));await assert.rejects(()=>result);}finally{s.close();}});
test("invalid vectors fall back and irrelevant query has no evidence",async()=>{const s=setup();try{const model:LocalModel={generate:async()=>null,embed:async()=>[[NaN]]};const r=await new SemanticSearchService(s,model).search(testDoctor,"fatma","xyzzzz");assert.equal(r.mode,"lexical");assert.equal(r.noEvidence,true);}finally{s.close();}});
test("semantic accepted similarity is a retrieval score only",async()=>{const s=setup();try{const model:LocalModel={model:"test",generate:async()=>null,embed:async texts=>texts.map(()=>[1,0])};const r=await new SemanticSearchService(s,model).search(testDoctor,"fatma","diabetes");assert.equal(r.mode,"semantic");assert.equal(r.hits[0].score,1);assert.equal((r as unknown as Record<string,unknown>).diagnosis,undefined);}finally{s.close();}});

test("whole PDF pages are searched and changed bytes are excluded",async()=>{
 const s=setup();try{
  const id="00000000-0000-4000-8000-000000000010",bytes=Buffer.from("%PDF- synthetic source");
  s.transaction(st=>st.documents.push({id,patientId:"fatma",filename:"dossier.pdf",contentHash:createHash("sha256").update(bytes).digest("hex"),uploadedAt:at,status:"needs_manual_review"}));
  const service=new SemanticSearchService(s,undefined,{fileReader:async()=>bytes,extractor:async()=>[{page:1,text:"First page"},{page:2,text:"Historique laboratoire thyroide"}]});
  const result=await service.search(testDoctor,"fatma","thyroide");assert.equal(result.hits[0].source.documentId,id);assert.equal(result.hits[0].source.page,2);assert.equal(result.hits[0].source.verification,"candidate");
  const changed=new SemanticSearchService(s,undefined,{fileReader:async()=>Buffer.from("changed"),extractor:async()=>[{page:2,text:"thyroide"}]});
  assert.equal((await changed.search(testDoctor,"fatma","thyroide")).noEvidence,true);
 }finally{s.close();}
});
test("held search is discarded after evidence revision changes",async()=>{
 const s=setup();try{
  let release!:(v:number[][])=>void,began!:()=>void,batchSize=0;const started=new Promise<void>(r=>began=r),pending=new Promise<number[][]>(r=>release=r);
  const model:LocalModel={generate:async()=>null,embed:texts=>{batchSize=texts.length;began();return pending;}};
  const result=new SemanticSearchService(s,model).search(testDoctor,"fatma","diabetes");
  await started;s.transaction(st=>bumpPatientRevision(st,"fatma","evidence"));release(Array.from({length:batchSize},()=>[1,0]));
  await assert.rejects(()=>result,e=>(e as {code:string}).code==="STALE_CONTEXT");
 }finally{s.close();}
});
test("source revisions and embedding model changes invalidate cached vectors",async()=>{
 const s=setup();try{
  const batchSizes:number[]=[];const model:LocalModel={embeddingModel:"embedding-v1",generate:async()=>null,embed:async texts=>{batchSizes.push(texts.length);return texts.map(()=>[1,0]);}};
  const service=new SemanticSearchService(s,model);await service.search(testDoctor,"fatma","diabetes");
  s.transaction(st=>{st.medicalFacts[0].revision++;st.medicalFacts[0].label="Diabète modifié";bumpPatientRevision(st,"fatma","context");});
  await service.search(testDoctor,"fatma","diabetes");
  (model as {embeddingModel:string}).embeddingModel="embedding-v2";
  await service.search(testDoctor,"fatma","diabetes");assert.deepEqual(batchSizes,[3,2,3]);
 }finally{s.close();}
});
test("unresponsive embedding obeys a service deadline and falls back to permitted lexical evidence",async()=>{
 const s=setup();try{
  const model:LocalModel={generate:async()=>null,embed:()=>new Promise(()=>{})};
  const result=await new SemanticSearchService(s,model).search(testDoctor,"fatma","diabète",{timeoutMs:5});
  assert.equal(result.mode,"lexical");assert.equal(result.noEvidence,false);
 }finally{s.close();}
});

function externalNote(id: string, patientId = "fatma", text = "Neuropathie documentée dans une note externe."): ExternalNote {
 return { id, patientId, grantId: "visit-grant", sessionId: "visit-session", declaredName: "Auteur déclaré", organization: "Cabinet déclaré", verification: "external_unverified", text, consultationDate: null, receivedAt: at, correctsNoteId: null };
}

test("unknown queries never embed an identical semantic sentinel, while unsupported terms remain searchable lexically", async () => {
 const s=setup();try{
  const documentId="00000000-0000-4000-8000-000000000011";
  s.transaction(st=>{st.medicalFacts=[];st.documents.push({id:documentId,patientId:"fatma",filename:"source.pdf",uploadedAt:at,status:"needs_manual_review"});});
  let calls=0;
  const model:LocalModel={generate:async()=>null,embed:async texts=>{calls++;return texts.map(()=>[1,0]);}};
  const service=new SemanticSearchService(s,model,{fileReader:async()=>Buffer.from("%PDF- synthetic"),extractor:async()=>[{page:1,text:"Neuropathie douloureuse."}]});
  for(const query of ["xyzzzz","777777"]){const unrelated=await service.search(testDoctor,"fatma",query);assert.equal(unrelated.mode,"lexical");assert.equal(unrelated.noEvidence,true);assert.equal(calls,0);}
  const relevant=await service.search(testDoctor,"fatma","neuropathie");
  assert.equal(relevant.mode,"lexical");assert.equal(relevant.noEvidence,false);assert.equal(relevant.hits[0].source.documentId,documentId);assert.equal(calls,0);
 }finally{s.close();}
});

test("fully redacted query produces no evidence and never reaches the embedding adapter", async () => {
 const s=setup();try{
  let calls=0;const model:LocalModel={generate:async()=>null,embed:async texts=>{calls++;return texts.map(()=>[1,0]);}};
  const query=s.read().patients.find(patient=>patient.id==="fatma")!.displayName;
  const result=await new SemanticSearchService(s,model).search(testDoctor,"fatma",query);
  assert.equal(calls,0);assert.equal(result.mode,"lexical");assert.equal(result.noEvidence,true);
 }finally{s.close();}
});

test("placeholder-only PDF chunks are omitted from semantic embedding batches and scored hits", async () => {
 const s=setup();try{
  const documentId="00000000-0000-4000-8000-000000000012";
  s.transaction(st=>st.documents.push({id:documentId,patientId:"fatma",filename:"source.pdf",uploadedAt:at,status:"needs_manual_review"}));
  const batches:string[][]=[];
  const model:LocalModel={generate:async()=>null,embed:async texts=>{batches.push(texts);return texts.map(()=>[1,0]);}};
  const result=await new SemanticSearchService(s,model,{fileReader:async()=>Buffer.from("%PDF- synthetic"),extractor:async()=>[{page:1,text:"Neuropathie douloureuse."}]}).search(testDoctor,"fatma","diabetes");
  assert.equal(result.mode,"semantic");assert.equal(batches.length,1);assert.equal(batches[0].includes("clinical source"),false);
  assert.equal(result.hits.some(hit=>hit.source.documentId===documentId),false);
 }finally{s.close();}
});

test("authorized external notes are searchable with immutable unverified provenance and patient filtering", async () => {
 const s=setup();try{
  s.transaction(st=>{st.careGrants[0].scopes=["clinical"];st.externalNotes.push(externalNote("external-note"),externalNote("other-note","ahmed","Neuropathie autre patient confidentielle."));});
  const result=await new SemanticSearchService(s).search(testDoctor,"fatma","neuropathie");
  assert.equal(result.noEvidence,false);assert.equal(result.hits.length,1);
  assert.equal(result.hits[0].source.kind,"external_note");assert.equal(result.hits[0].source.id,"external-note");
  assert.equal(result.hits[0].source.verification,"external_unverified");assert.equal(result.hits[0].source.polarity,"unknown");
  assert.match(result.hits[0].source.contentHash!,/^[0-9a-f]{64}$/);
  const again=await new SemanticSearchService(s).search(testDoctor,"fatma","neuropathie");
  assert.deepEqual(again.hits[0].source,result.hits[0].source);
  assert.equal(JSON.stringify(result).includes("other-note"),false);assert.equal(JSON.stringify(result).includes("Auteur déclaré"),false);
  s.transaction(st=>st.careGrants[0].scopes=["measurements"]);
  assert.equal((await new SemanticSearchService(s).search(testDoctor,"fatma","neuropathie")).hits.some(hit=>hit.source.kind==="external_note"),false);
 }finally{s.close();}
});

test("identified project-authored references are a separate namespace and labelled non-clinical", async () => {
 const s=setup();try{
  const result=await new SemanticSearchService(s).search(testDoctor,"fatma","prototype");
  const references=result.hits.filter(hit=>hit.source.kind==="reference");
  assert.ok(references.length>0);
  for(const hit of references){assert.match(hit.source.id,/^reference:project:/);assert.equal(hit.source.verification,"reference");assert.match(hit.source.contentHash!,/^[0-9a-f]{64}$/);assert.match(hit.excerpt,/Internal prototype policy; not a medical practice guideline/);}
  assert.equal(s.read().careActions.length,0);assert.equal(s.read().medicalFacts.length,2);
 }finally{s.close();}
});

test("search retains PDF evidence and bounded references when the authorized dossier is large", async () => {
 const s=setup();try{
  const documentId="00000000-0000-4000-8000-000000000013";
  s.transaction(st=>{
   const fact=st.medicalFacts[0];for(let i=0;i<60;i++)st.medicalFacts.push({...fact,id:`extra-${i}`,label:"Diabetes long dossier "+"glucose ".repeat(250)});
   for(let i=0;i<20;i++)st.externalNotes.push(externalNote(`note-${i}`,"fatma","glucose ".repeat(250)));
   st.documents.push({id:documentId,patientId:"fatma",filename:"source.pdf",uploadedAt:at,status:"needs_manual_review"});
  });
  const service=new SemanticSearchService(s,undefined,{fileReader:async()=>Buffer.from("%PDF- synthetic"),extractor:async()=>[{page:1,text:"Neuropathie douloureuse documentée."}]});
  assert.ok((await service.search(testDoctor,"fatma","neuropathie")).hits.some(hit=>hit.source.documentId===documentId));
  assert.ok((await service.search(testDoctor,"fatma","prototype")).hits.some(hit=>hit.source.kind==="reference"));
  const batches:string[][]=[];const model:LocalModel={generate:async()=>null,embed:async texts=>{batches.push(texts);return texts.map(()=>[1,0]);}};
  await new SemanticSearchService(s,model,{fileReader:async()=>Buffer.from("%PDF- synthetic"),extractor:async()=>[{page:1,text:"glucose ".repeat(5000)}]}).search(testDoctor,"fatma","glucose");
  assert.ok(batches.every(texts=>texts.length<=40));assert.ok(batches.every(texts=>texts.reduce((n,text)=>n+text.length,0)<=20000));
 }finally{s.close();}
});

test("reference source bytes match the identified manifest hash", async () => {
 const manifest=JSON.parse(await readFile("research/monitoring-reference-manifest.json","utf8")) as {references:{sourceFile:string;sha256:string;demoLabel:string}[]};
 assert.ok(manifest.references.length>0);
 for(const reference of manifest.references){const bytes=await readFile(reference.sourceFile);assert.equal(createHash("sha256").update(bytes).digest("hex"),reference.sha256);assert.equal(reference.demoLabel,"Internal prototype policy; not a medical practice guideline");}
});

test("a reference with mismatched source bytes is omitted rather than presented as evidence", async () => {
 const s=setup(),directory=await mkdtemp(join(tmpdir(),"hackcure-reference-test-"));try{
  const manifest=JSON.parse(await readFile("research/monitoring-reference-manifest.json","utf8")) as {references:{sha256:string}[]};
  manifest.references[0].sha256="0".repeat(64);
  const path=join(directory,"manifest.json");await writeFile(path,JSON.stringify(manifest));
  const result=await new SemanticSearchService(s,undefined,{referenceManifestPath:path}).search(testDoctor,"fatma","prototype");
  assert.equal(result.noEvidence,true);assert.equal(result.hits.some(hit=>hit.source.kind==="reference"),false);
 }finally{s.close();await rm(directory,{recursive:true,force:true});}
});
