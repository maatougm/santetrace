import { CareStore } from "../../src/lib/care-store";
import { SHARING_SCOPES } from "../../src/contracts/patient-platform";
import type { Actor } from "../../src/contracts/care";
export const testOwner: Actor = { id: "patient:fatma", role: "patient", patientId: "fatma", displayName: "Fatma" };
export const testDoctor: Actor = { id: "demo-clinician", role: "clinician", patientId: null, displayName: "Test" };
export function fixtureStore(path=":memory:") {
 const store = new CareStore(path);
 store.transaction(s => {
  const at = new Date().toISOString();
  for (const actor of [testOwner, testDoctor, { ...testDoctor, id: "secondary" }]) if(!s.accounts.some(a=>a.id===actor.id))s.accounts.push({ ...actor, login: actor.id==="demo-clinician"?"medecin.ref":actor.id, passwordHash: "test-only", enabled: true, sessionVersion: 1, createdAt: at });
  for (const id of ["fatma", "ahmed"]) if(!s.careGrants.some(g=>g.id===`grant:${id}`))s.careGrants.push({ id: `grant:${id}`, patientId: id, clinicianId: testDoctor.id, relationship: "primary", scopes: [...SHARING_SCOPES], state: "active", revision: 1, issuedAt: at, acceptedAt: at, revokedAt: null });
 });
 return store;
}
