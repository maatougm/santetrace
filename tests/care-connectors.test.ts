import test from "node:test";
import assert from "node:assert/strict";
import { ConnectorService } from "../src/lib/connector-service";
import { CareService } from "../src/lib/care-service";
import { createDemoMonitoringProfiles } from "../src/lib/monitoring-evaluation";
import { fixtureStore, testOwner, testDoctor } from "./helpers/care-fixture";
const now=Date.parse("2026-10-11T08:00:00Z");
const event=(id="event-1")=>({externalEventId:id,measuredAt:new Date(now).toISOString(),reading:{kind:"glucose" as const,value:190,unit:"mg/dL" as const},quality:"accepted" as const});
function setup(){const store=fixtureStore(),service=new ConnectorService(store,()=>now),input={deviceId:"DEMO-GLUCOSE",kind:"simulator" as const,clientId:"pair"},paired=service.pairSimulator(testOwner,"fatma",input);return {store,service,input,paired};}
test("pair returns credential once, hides hashes, and persists neither secret nor replay URL",()=>{
  const s=setup();assert.match(s.paired.credential!,/^[A-Za-z0-9_-]{43}$/);
  assert.equal("credentialHash" in s.paired.connector,false);assert.equal("credentialHash" in s.service.list(testOwner,"fatma").connectors[0],false);
  assert.equal(JSON.stringify(s.store.read()).includes(s.paired.credential!),false);
  assert.equal(s.service.pairSimulator(testOwner,"fatma",s.input).credential,null);assert.equal(s.store.read().connectors.length,1);s.store.close();
});
test("bearer ingress derives patient and simulation identity from binding",()=>{
  const s=setup(),receipt=s.service.ingest(s.paired.credential!,event());
  assert.equal(receipt.measurement.patientId,"fatma");assert.equal(receipt.measurement.source,"simulated");assert.equal(receipt.measurement.connector!.simulated,true);assert.equal(receipt.measurement.status,"orange");
  assert.throws(()=>s.service.ingest(s.paired.credential!,{...event("spoof"),patientId:"ahmed",simulated:false} as ReturnType<typeof event>),{code:"INVALID_INPUT"});
  assert.equal(s.store.read().measurements.length,1);s.store.close();
});
test("invalid units, reading fields and time are rejected before capture",()=>{
  const s=setup();
  for(const input of [
    {...event(),reading:{kind:"glucose",value:190,unit:"bpm"}},
    {...event(),reading:{kind:"pulse",value:301,unit:"bpm"}},
    {...event(),reading:{kind:"pulse",value:0,unit:"bpm"}},
    {...event(),reading:{kind:"blood_pressure",systolic:90,diastolic:110,unit:"mmHg"}},
    {...event(),reading:{kind:"glucose",value:190,unit:"mg/dL",patientId:"ahmed"}},
    {...event(),quality:"trust_me"},
    {...event(),measuredAt:"2026-10-11"},
    {...event(),measuredAt:new Date(now+3600000).toISOString()},
  ])assert.throws(()=>s.service.ingest(s.paired.credential!,input as ReturnType<typeof event>));
  assert.equal(s.store.read().measurements.length,0);s.store.close();
});
test("suspect high reading stays unknown without alert; pulse remains unscored",()=>{
  const s=setup(),suspect=s.service.simulate(testOwner,"fatma",s.paired.connector.id,{...event(),quality:"suspect",reading:{kind:"glucose",value:300,unit:"mg/dL"}});
  assert.equal(suspect.measurement.status,"unknown");assert.equal(suspect.alert,null);assert.equal(suspect.measurement.connector!.quality,"suspect");
  const pulse=s.service.simulate(testOwner,"fatma",s.paired.connector.id,{...event("pulse"),reading:{kind:"pulse",value:72,unit:"bpm"}});
  assert.equal(pulse.measurement.status,"unknown");assert.equal(pulse.alert,null);s.store.close();
});
test("delayed receipt preserves measurement time and signals delay",()=>{
  const s=setup(),measuredAt=new Date(now-48*3600000).toISOString();
  s.store.transaction(state=>{
    const profile=createDemoMonitoringProfiles(state.patients.find(p=>p.id==="fatma")!.rules).find(p=>p.rulePack==="demo_glucose")!;
    state.monitoringProfiles.push(profile);
    state.medicalFacts.push({id:"diabetes",patientId:"fatma",kind:"condition",code:"diabetes",label:"Diabetes",value:null,polarity:"affirmed",verification:"patient_reported",sources:[],revision:1,createdAt:new Date(now).toISOString(),supersededBy:null});
    state.carePlans.push({id:"plan",patientId:"fatma",revision:1,state:"active",clinicianId:testDoctor.id,profileBindings:[{conditionFactId:"diabetes",profileId:profile.id,profileVersion:profile.version}],actionIds:[],reviewDeadline:null});
  });
  const receipt=s.service.ingest(s.paired.credential!,{...event(),reading:{kind:"glucose",value:120,unit:"mg/dL"},measuredAt});
  assert.equal(receipt.measurement.measuredAt,measuredAt);assert.equal(receipt.measurement.receivedAt,new Date(now).toISOString());assert.match(receipt.measurement.clockWarning!,/Delayed/);
  assert.equal(receipt.monitoring.coverage.includes("stale"),true);assert.equal(receipt.monitoring.priority,"unknown");s.store.close();
});
test("event id dedupes across ingress and browser, mismatched retry conflicts",()=>{
  const s=setup(),one=s.service.ingest(s.paired.credential!,event()),two=s.service.simulate(testOwner,"fatma",s.paired.connector.id,event());
  assert.deepEqual(two,one);assert.equal(s.store.read().measurements.length,1);
  assert.throws(()=>s.service.ingest(s.paired.credential!,{...event(),reading:{kind:"glucose",value:195,unit:"mg/dL"}}),{code:"IDEMPOTENCY_CONFLICT"});s.store.close();
});
test("owner authentication, binding revocation and withdrawn consent precede replay",()=>{
  const s=setup();s.service.ingest(s.paired.credential!,event());
  assert.throws(()=>s.service.simulate(testDoctor,"fatma",s.paired.connector.id,event()),{code:"FORBIDDEN"});
  s.service.revoke(testOwner,s.paired.connector.id,{action:"revoke",expectedRevision:1,clientId:"revoke"});
  assert.throws(()=>s.service.ingest(s.paired.credential!,event()),{code:"CONNECTOR_UNAVAILABLE"});assert.equal(s.store.read().measurements.length,1);s.store.close();
  const withdrawn=setup();new CareService(withdrawn.store).consent(testOwner,"fatma",{consent:false});
  assert.equal(withdrawn.service.list(testOwner,"fatma").connectors.length,1);
  assert.throws(()=>withdrawn.service.pairSimulator(testOwner,"fatma",withdrawn.input),{code:"CONSENT_REVOKED"});
  assert.throws(()=>withdrawn.service.simulate(testOwner,"fatma",withdrawn.paired.connector.id,event()));withdrawn.store.close();
});
