import { createHash } from "node:crypto";
import { CareError } from "./care-error";
import type { CareState } from "./care-store";
import type { ReusableProtocol } from "../contracts/monitoring";

export function recordProtocolHistory(state:CareState,protocol:ReusableProtocol,at:string,clinicianId:string,reason:string):void {
    protocol.history ??= [];
    const existing=protocol.history.find(h=>h.revision===protocol.revision);
    if(existing?.snapshot)return;
    const proposal=state.careProposals.find(p=>p.id===protocol.sourceProposalId&&p.patientId===protocol.patientId&&p.state==="approved"&&p.decision!==null);
    const {history:_,...policy}=structuredClone(protocol);
    const snapshot=proposal?{policy,sourceProposal:structuredClone({id:proposal.id,revision:proposal.revision,action:proposal.action,sources:proposal.sources,guard:proposal.guard,decision:proposal.decision})}:undefined;
    if(existing){if(snapshot)existing.snapshot=snapshot;return;}
    protocol.history.push({revision:protocol.revision,at,clinicianId,reason,...(snapshot?{snapshot}:{})});
}
export function fail(code: string, message = "Données invalides.", status = 400): never { throw new CareError(status, code, message); }
export function boundedText(value: unknown, max = 500): string { if (typeof value !== "string" || !value.trim() || value.length > max)
    fail("INVALID_INPUT"); return value.trim(); }
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    fail("INVALID_INPUT"); return value as number; }
export function canonical(value: unknown): string { return JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v); }
export const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function replay<T>(state: CareState, key: string, payload: unknown, action: () => T): T { const digest = hash(canonical(payload)), old = state.idempotency[key]; if (old) {
    if (old.hash !== digest)
        fail("IDEMPOTENCY_CONFLICT", "Identifiant déjà utilisé.", 409);
    return structuredClone(old.result) as T;
} const result = action(); state.idempotency[key] = { hash: digest, result: structuredClone(result) }; return result; }
