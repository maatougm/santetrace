import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CareStore, seedCareState } from "../src/lib/care-store";

test("legacy disk migration preserves resources, private files and replay across two reopenings without active grants",()=>{
 const dir=mkdtempSync(join(tmpdir(),"care-migrate-")),path=join(dir,"care.sqlite");
 const legacy=seedCareState() as unknown as Record<string,unknown>;
 for(const key of ["schemaVersion","accounts","careGrants","legacyRelationships","patientRevisions"])delete legacy[key];
 legacy.documents=[{id:"private-id",patientId:"fatma",filename:"original.pdf",uploadedAt:"2026-01-01",status:"reviewed",privatePath:join(dir,"private.pdf")}];
 legacy.observations=[{id:"result-id",revisions:[{reason:"preserved history"}]}];
 legacy.idempotency={old:{hash:"original",result:{id:"private-id"}}};
 writeFileSync(join(dir,"private.pdf"),"private synthetic bytes");
 const db=new DatabaseSync(path);db.exec("CREATE TABLE care_state (id INTEGER PRIMARY KEY,body TEXT NOT NULL)");db.prepare("INSERT INTO care_state VALUES(1,?)").run(JSON.stringify(legacy));db.close();
 try {for(let i=0;i<2;i++){const store=new CareStore(path);try {const s=store.read();assert.equal(s.schemaVersion,2);assert.deepEqual(s.documents,legacy.documents);assert.deepEqual(s.observations,legacy.observations);assert.deepEqual(s.idempotency,legacy.idempotency);assert.equal(s.careGrants.length,0);assert.equal(s.legacyRelationships.length,2);assert.equal(s.accounts.length,0);}finally{store.close();}}
 assert.equal(readFileSync(join(dir,"private.pdf"),"utf8"),"private synthetic bytes");const backups=readdirSync(dir).filter(p=>p.includes("backup"));assert.equal(backups.length,1);const backup=new DatabaseSync(join(dir,backups[0]),{readOnly:true});try{const before=JSON.parse((backup.prepare("SELECT body FROM care_state WHERE id=1").get() as {body:string}).body);assert.equal(before.schemaVersion,undefined);assert.deepEqual(before.documents,legacy.documents);}finally{backup.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("promise transaction callback rolls back without serializing partial state",()=>{const store=new CareStore(":memory:");try {assert.throws(()=>store.transaction(async s=>{s.patients[0].displayName="must not persist";return true;}),/synchronous/);assert.equal(store.read().patients[0].displayName,"Fatma Ben Salah");}finally{store.close();}});
