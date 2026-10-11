import test from "node:test";
import assert from "node:assert/strict";
import { PatientAccountService } from "../src/lib/patient-account-service";
import { CareService } from "../src/lib/care-service";
import { currentGuard } from "../src/lib/patient-access-service";
import { fixtureStore, testOwner, testDoctor } from "./helpers/care-fixture";

test("configured primary disable atomically invalidates approved authority and restore requires review",async()=>{
 const old=process.env.DEMO_CLINICIAN_PASSWORD;process.env.DEMO_CLINICIAN_PASSWORD="Synthetic primary password!";
 const store=fixtureStore();
 try{
  store.transaction(s=>s.accounts=s.accounts.filter(a=>a.id!==testDoctor.id));
  const accounts=new PatientAccountService(store);await accounts.initialize();
  store.transaction(s=>{
   s.carePlans.push({id:"policy",patientId:"fatma",revision:3,state:"active",clinicianId:testDoctor.id,profileBindings:[],actionIds:[],reviewDeadline:null});
   s.protocols.push({id:"approved",patientId:"fatma",revision:1,state:"active",clinicianId:testDoctor.id,sourceProposalId:"proposal",authorityRevision:0,requiredContextRevision:0,carePlanRevision:3,profileVersions:[],actions:[],predicates:[],exclusions:[],stopCriteria:[],validUntil:"2026-10-12T12:00:00Z",minIntervalSeconds:60,maxApplications:1,createdAt:new Date().toISOString(),history:[]});
   s.dueTasks.push({id:"due",patientId:"fatma",kind:"remind",phaseKey:"phase",dueAt:new Date().toISOString(),attempts:0,state:"pending",leaseOwner:null,leaseUntil:null,guard:currentGuard(s,"fatma"),resourceId:null});
  });
  delete process.env.DEMO_CLINICIAN_PASSWORD;await accounts.initialize();
  const record=new CareService(store).patient(testOwner,"fatma");
  assert.equal(record.plan?.state,"awaiting_clinician");assert.equal(record.plan?.clinicianId,null);assert.equal(record.plan?.revision,4);
  assert.equal(record.access.authorityRevision,1);assert.equal(store.read().protocols[0].state,"suspended");assert.equal(store.read().dueTasks[0].state,"cancelled");
  assert.equal(store.read().careGrants[0].state,"active");
  await accounts.initialize();assert.equal(currentGuard(store.read(),"fatma").authorityRevision,1);
  process.env.DEMO_CLINICIAN_PASSWORD="Synthetic primary password!";await accounts.initialize();
  assert.equal(store.read().accounts.find(a=>a.id===testDoctor.id)?.enabled,true);
  assert.equal(new CareService(store).patient(testOwner,"fatma").plan?.state,"awaiting_clinician");assert.equal(store.read().protocols[0].state,"suspended");
 }finally{store.close();if(old===undefined)delete process.env.DEMO_CLINICIAN_PASSWORD;else process.env.DEMO_CLINICIAN_PASSWORD=old;}
});
