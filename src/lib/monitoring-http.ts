import type { AccountLogin, AccountRegistration } from "../contracts/patient-platform";
import type { ActionReportInput, AssistantInput, ConnectorEvent, ContactInput, ContactUpdate, FactCorrection, FactInput, MessageForwardInput, MessageInput, MessageReview, OnboardingInput, PlanUpdate, ProposalDecision, ProposalEdit, ProtocolAuthorization, ProtocolReviewInput, ProtocolStateInput } from "../contracts/monitoring";
import type { GuestNoteInput, VisitRedeemInput, VisitSelectionInput } from "../contracts/external-visit";
import { CareService, CareError, requireActor } from "./care-service";
import type { CareStoreAdapter } from "./care-store";
import { cookieHeader, resolveSessionActor, signSession } from "./care-session";
import { getLoginThrottle, getPublicCredentialThrottles, loginScope, LoginRateLimitError, readBoundedJson, requireSameOrigin, type PublicCredentialThrottles } from "./care-http";
import { PatientAccountService } from "./patient-account-service";
import { PatientAccessService, recordDeniedAccess } from "./patient-access-service";
import { MonitoringAiService } from "./monitoring-ai-service";
import { LocalModelError, OllamaLocalModel, type LocalModel } from "./local-model";
import { NvidiaGenerationModel } from "./nvidia-model";
import { CarePlanService } from "./care-plan-service";
import { InterventionService } from "./intervention-service";
import { SemanticSearchService } from "./semantic-search";
import { ProtocolService } from "./protocol-service";
import { AssistantService } from "./assistant-service";
import { ConnectorService } from "./connector-service";
import { ExternalVisitService } from "./external-visit-service";
import { clearGuestCookieHeader, guestCookieHeader, guestTokenFromRequest } from "./external-visit-session";
import { boundedText, fail } from "./monitoring-utils";
import { AiCaseScoreService } from "./ai-case-score";
import { MedicalConsultationModel } from "./medical-consultation";
export const privateJson = (data: unknown, status = 200, headers?: HeadersInit) => Response.json(data, {
    status, headers: { "Cache-Control": "no-store", "Pragma": "no-cache", ...headers },
});
/** Provider configuration failures remain a reported fallback, never a prerequisite for capture. */
export function configuredGenerationModel(): LocalModel {
    try {
        const provider = process.env.HACKCURE_AI_PROVIDER ?? "ollama";
        if (provider === "nvidia") {
            const brain = new NvidiaGenerationModel();
            if (process.env.HACKCURE_MEDICAL_SPECIALIST_ENABLED !== "true") return brain;
            const model = process.env.HACKCURE_MEDICAL_SPECIALIST_MODEL;
            if (!model) throw new LocalModelError("provider_unavailable");
            const specialist = new OllamaLocalModel({ enabled: true, model, contextTokens: 4096, numPredict: 512, keepAlive: 0, advisorySelection: true });
            return new MedicalConsultationModel(brain, specialist);
        }
        if (provider !== "ollama") throw new LocalModelError("provider_unavailable");
        return new OllamaLocalModel();
    }
    catch {
        const unavailable = async (): Promise<never> => { throw new LocalModelError("provider_unavailable"); };
        return { generate: unavailable, embed: unavailable };
    }
}
/** Explicit cloud selection disables local embeddings, regardless of the local enable flag. */
export function configuredEmbeddingModel(): LocalModel | undefined {
    if ((process.env.HACKCURE_AI_PROVIDER ?? "ollama") !== "ollama" || process.env.HACKCURE_LOCAL_AI_ENABLED !== "true") return undefined;
    return configuredGenerationModel();
}
/** Compatibility for server callers that previously used this generation factory. */
export const configuredLocalModel = configuredGenerationModel;
function mutationKey(body: Record<string, unknown>): string {
    if (Object.keys(body).length !== 1 || !Object.hasOwn(body, "clientId"))
        fail("INVALID_INPUT");
    return boundedText(body.clientId, 120);
}
function resourcePatient(store: CareStoreAdapter, path: string[]): string | null {
    const state = store.read(), id = path[1];
    if (path[0] === "patients")
        return id ?? null;
    const collections = { grants:state.careGrants, alerts: state.alerts, reminders: state.reminders, "medical-facts": state.medicalFacts, proposals: state.careProposals, actions: state.careActions, messages: state.messages, "contact-requests": state.contactRequests, protocols: state.protocols, connectors: state.connectors, "external-visits": state.externalVisitGrants };
    const collection = collections[path[0] as keyof typeof collections];
    return collection?.find(item => item.id === id)?.patientId ?? null;
}
function sourceResponse(bytes: Buffer, request: Request): Response {
    const headers: Record<string,string> = { "Content-Type":"application/pdf", "Content-Disposition":"inline; filename=\"source.pdf\"", "Cache-Control":"private, no-store", "Pragma":"no-cache", "X-Content-Type-Options":"nosniff", "Content-Security-Policy":"sandbox", "Accept-Ranges":"bytes" };
    const range = request.headers.get("range");
    if (!range) return new Response(request.method === "HEAD" ? null : new Uint8Array(bytes), { headers: {...headers,"Content-Length":String(bytes.length)} });
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = match?.[1] ? Number(match[1]) : NaN, end = match?.[2] ? Number(match[2]) : bytes.length-1;
    if (match && !match[1] && match[2]) { start = Math.max(0,bytes.length-Number(match[2])); end = bytes.length-1; }
    if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= bytes.length || end < start) return new Response(null,{status:416,headers:{...headers,"Content-Range":"bytes */"+bytes.length}});
    end = Math.min(end,bytes.length-1);
    return new Response(request.method === "HEAD" ? null : new Uint8Array(bytes.subarray(start,end+1)),{status:206,headers:{...headers,"Content-Range":"bytes "+start+"-"+end+"/"+bytes.length,"Content-Length":String(end-start+1)}});
}
export function createCareHandler(store: CareStoreAdapter, publicThrottles: PublicCredentialThrottles = getPublicCredentialThrottles()) {
    const accounts = new PatientAccountService(store), access = new PatientAccessService(store);
    const service = new CareService(store), plans = new CarePlanService(store), interventions = new InterventionService(store);
    const protocols = new ProtocolService(store), assistant = new AssistantService(store), connectors = new ConnectorService(store), visits = new ExternalVisitService(store);
    return async function handle(request: Request): Promise<Response> {
        let path: string[] = [], actor = null as ReturnType<typeof resolveSessionActor>;
        try {
            const url = new URL(request.url), method = request.method;
            try {
                path = url.pathname.slice(5).split("/").filter(Boolean).map(decodeURIComponent);
            }
            catch {
                fail("INVALID_PATH");
            }
            const bearerIngress = path.length === 2 && path[0] === "connectors" && path[1] === "events" && method === "POST";
            if (!["GET", "HEAD"].includes(method) && !bearerIngress)
                requireSameOrigin(request);
            const body = ["POST", "PATCH"].includes(method) ? await readBoundedJson(request) : {};
            if (bearerIngress) {
                const authorization = request.headers.get("authorization") ?? "";
                const credential = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1] ?? "";
                const receipt = publicThrottles.connector.run(credential,()=>connectors.ingest(credential,body as ConnectorEvent));
                // Device credentials authorize ingestion, not disclosure of the patient's monitoring or care rules.
                return privateJson({ measurement: receipt.measurement },201);
            }
            if (path.length === 2 && path[0] === "external-visits" && path[1] === "redeem" && method === "POST") {
                let result;
                try {
                    const token = typeof body.token === "string" && /^[A-Za-z0-9_-]{43}$/.test(body.token) ? body.token : "invalid";
                    result = publicThrottles.redeem.run(token,()=>visits.redeem(body as VisitRedeemInput));
                } catch(error) {
                    if (error instanceof LoginRateLimitError) throw new CareError(404,"VISIT_UNAVAILABLE","Consultation indisponible.");
                    throw error;
                }
                return privateJson({visit:result.visit},201,{"Set-Cookie":guestCookieHeader(result.sessionToken)});
            }
            if (path[0] === "external-visit") {
                const token = guestTokenFromRequest(request) ?? "";
                if (path.length === 2 && path[1] === "session" && method === "DELETE") {
                    visits.endSession(token);
                    return privateJson({ok:true},200,{"Set-Cookie":clearGuestCookieHeader()});
                }
                if (path.length === 2 && path[1] === "record" && method === "GET") return privateJson(visits.record(token));
                if (path.length === 2 && path[1] === "notes" && method === "POST") return privateJson({note:visits.appendNote(token,body as GuestNoteInput)},201);
                if (path.length === 4 && path[1] === "documents" && path[3] === "source" && ["GET","HEAD"].includes(method)) return sourceResponse(await visits.source(token,path[2]),request);
                throw new CareError(404,"VISIT_UNAVAILABLE","Consultation indisponible.");
            }
            await accounts.initialize();
            actor = resolveSessionActor(request, store);
            if (path.length === 1 && path[0] === "accounts" && method === "POST") {
                actor = await getLoginThrottle().runAsync(loginScope(body), () => accounts.register(body as AccountRegistration));
                return privateJson({ actor, patientId: actor.patientId }, 201, { "Set-Cookie": cookieHeader(signSession(actor, Date.now(), store)) });
            }
            if (path.length === 1 && path[0] === "session") {
                if (method === "GET")
                    return privateJson({ actor, mode: "fictional_demo" });
                if (method === "POST") {
                    actor = await getLoginThrottle().runAsync(loginScope(body), () => accounts.login(body as AccountLogin));
                    return privateJson({ actor, mode: "fictional_demo" }, 200, { "Set-Cookie": cookieHeader(signSession(actor, Date.now(), store)) });
                }
                if (method === "DELETE")
                    return privateJson({ ok: true }, 200, { "Set-Cookie": cookieHeader("", 0) });
            }
            actor = requireActor(actor);
            if (path.length === 1 && path[0] === "doctors" && method === "GET")
                return privateJson(access.listDoctors());
            if (path[0] === "doctor-invitations") {
                if (path.length === 1 && method === "GET")
                    return privateJson(access.invitations(actor));
                if (path.length === 2 && path[1] === "accept" && method === "POST")
                    return privateJson(access.accept(actor, body));
            }
            if (path[0] === "grants" && path.length === 2 && method === "PATCH")
                return privateJson(access.update(actor, path[1], body));
            if (path[0] === "dashboard" && path.length === 1 && method === "GET")
                return privateJson(service.dashboard(actor));
            if (path[0] === "patients") {
                if (path.length === 1 && method === "POST")
                    return privateJson(service.enroll(actor, body), 201);
                const id = path[1], sub = path[2];
                if (path.length === 2 && method === "GET")
                    return privateJson(service.patient(actor, id));
                if (path.length === 3) {
                    if (sub === "grants" && method === "GET")
                        return privateJson(access.list(actor, id));
                    if (sub === "grants" && method === "POST")
                        return privateJson(access.issue(actor, id, body), 201);
                    if (sub === "access-journal" && method === "GET")
                        return privateJson(access.journal(actor, id, url.searchParams.get("cursor"), url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 50));
                    if (sub === "measurements" && method === "POST")
                        return privateJson(service.measurement(actor, id, body), 201);
                    if (sub === "rules" && method === "PATCH")
                        return privateJson(service.rules(actor, id, body));
                    if (sub === "reminders" && method === "POST")
                        return privateJson(service.reminder(actor, id, body), 201);
                    if (sub === "summary" && method === "GET")
                        return privateJson(service.summary(actor, id));
                    if (sub === "export" && method === "GET")
                        return privateJson(service.export(actor, id));
                    if (sub === "consent" && method === "PATCH")
                        return privateJson(service.consent(actor, id, body));
                    if (sub === "invite" && method === "POST")
                        return privateJson(service.invite(actor, id));
                    if (sub === "medical-facts" && method === "POST")
                        return privateJson({ fact: new MonitoringAiService(store).recordFact(actor, id, body as FactInput) }, 201);
                    if (sub === "care-plan" && method === "GET")
                        return privateJson(plans.getPlan(actor, id));
                    if (sub === "care-plan" && method === "PATCH")
                        return privateJson(plans.updatePlan(actor, id, body as PlanUpdate));
                    if (sub === "ai-case-score" && method === "GET")
                        return privateJson(new AiCaseScoreService(store, configuredGenerationModel()).get(actor, id));
                    if (sub === "ai-case-score" && method === "POST")
                        return privateJson(await new AiCaseScoreService(store, configuredGenerationModel()).generate(actor, id, { signal: request.signal, clientId: mutationKey(body) }));
                    if (sub === "proposals" && method === "GET")
                        return privateJson(plans.listProposals(actor, id));
                    if (sub === "messages" && method === "GET")
                        return privateJson(interventions.listMessages(actor, id, url.searchParams.get("clinicianId"), url.searchParams.get("after") ?? url.searchParams.get("cursor")));
                    if (sub === "messages" && method === "POST")
                        return privateJson({ message: interventions.sendMessage(actor, id, body as MessageInput) }, 201);
                    if (sub === "contact-requests" && method === "GET")
                        return privateJson(interventions.listContacts(actor, id));
                    if (sub === "contact-requests" && method === "POST")
                        return privateJson({ contactRequest: interventions.requestContact(actor, id, body as ContactInput) }, 201);
                    if (sub === "protocols" && method === "GET") return privateJson(protocols.list(actor,id));
                    if (sub === "protocols" && method === "POST") return privateJson({protocol:protocols.authorize(actor,id,body as ProtocolAuthorization)},201);
                    if (sub === "protocol-applications" && method === "GET") return privateJson(protocols.applications(actor,id));
                    if (sub === "assistant" && method === "POST") return privateJson(assistant.respond(actor,id,body as AssistantInput));
                    if (sub === "connectors" && method === "GET") return privateJson(connectors.list(actor,id));
                    if (sub === "connectors" && method === "POST") return privateJson(connectors.pair(actor,id,body as {deviceId:string;kind:"simulator"|"device";clientId:string}),201);
                    if (sub === "external-visits" && method === "GET") return privateJson({...visits.list(actor,id),notes:store.read().externalNotes.filter(note=>note.patientId===id)});
                    if (sub === "external-visits" && method === "POST") return privateJson(visits.issue(actor,id,body as VisitSelectionInput),201);
                    if (sub === "onboarding" && ["GET", "POST"].includes(method))
                        return privateJson(await new MonitoringAiService(store, configuredGenerationModel()).onboarding(actor, id, method === "GET" ? null : body as OnboardingInput, { signal: request.signal }));
                    if (sub === "report" && method === "POST")
                        return privateJson(await new MonitoringAiService(store, configuredGenerationModel()).report(actor, id, { signal: request.signal, clientId: mutationKey(body) }));
                    if (sub === "search" && method === "POST") {
                        if (Object.keys(body).some(k => !["query", "clientId"].includes(k)))
                            fail("INVALID_INPUT");
                        boundedText(body.clientId, 120);
                        return privateJson(await new SemanticSearchService(store, configuredEmbeddingModel(), { cachePath: process.env.HACKCURE_VECTOR_CACHE_PATH ?? ".data/monitoring-vectors.json" }).search(actor, id, boundedText(body.query, 500), { signal: request.signal }));
                    }
                }
                if (path.length === 4 && sub === "proposals" && path[3] === "generate" && method === "POST")
                    return privateJson(await new MonitoringAiService(store, configuredGenerationModel()).generateProposals(actor, id, { signal: request.signal, clientId: mutationKey(body) }));
                if (path.length === 5 && sub === "connectors" && path[4] === "simulate" && method === "POST") return privateJson(connectors.simulate(actor,id,path[3],body as ConnectorEvent),201);
            }
            if (path[0] === "medical-facts" && path.length === 2 && method === "PATCH")
                return privateJson({ fact: new MonitoringAiService(store).correctFact(actor, path[1], body as FactCorrection) });
            if (path[0] === "proposals" && path.length === 2 && method === "PATCH") {
                if (Object.hasOwn(body, "decision"))
                    return privateJson(plans.reviewProposal(actor, path[1], body as ProposalDecision));
                const proposal = plans.reviseProposal(actor, path[1], body as ProposalEdit);
                return privateJson({ proposal, plan: plans.getPlan(actor, proposal.patientId).plan, action: null });
            }
            if (path[0] === "actions" && path.length === 3 && path[2] === "reports" && method === "POST")
                return privateJson({ action: plans.reportAction(actor, path[1], body as ActionReportInput) });
            if (path[0] === "messages" && path.length === 3 && method === "POST") {
                if (path[2] === "read")
                    return privateJson({ message: interventions.markRead(actor, path[1], body as {
                            clientId: string;
                        }) });
                if (path[2] === "review")
                    return privateJson({ message: interventions.reviewMessage(actor, path[1], body as MessageReview) });
                if (path[2] === "forward")
                    return privateJson({ message: interventions.forwardMessage(actor, path[1], body as MessageForwardInput) },201);
            }
            if (path[0] === "contact-requests" && path.length === 2 && method === "PATCH")
                return privateJson({ contactRequest: interventions.updateContact(actor, path[1], body as ContactUpdate) });
            if (path[0] === "protocols" && path.length === 2 && method === "PATCH") {
                if (body.action === "revise") { const {action:_,...revision} = body; return privateJson({protocol:protocols.revise(actor,path[1],revision as ProtocolReviewInput)}); }
                return privateJson({protocol:protocols.setState(actor,path[1],body as ProtocolStateInput)});
            }
            if (path[0] === "connectors" && path.length === 2 && method === "PATCH") return privateJson(connectors.revoke(actor,path[1],body as {action:"revoke";expectedRevision:number;clientId:string}));
            if (path[0] === "external-visits" && path.length === 2 && method === "PATCH") return privateJson(visits.revoke(actor,path[1],body as {action:"revoke";expectedRevision:number;clientId:string}));
            if (path[0] === "alerts" && path.length === 2 && method === "PATCH")
                return privateJson(service.alert(actor, path[1], body));
            if (path[0] === "reminders" && path.length === 3 && path[2] === "acknowledgments" && method === "POST")
                return privateJson(service.acknowledgeReminder(actor, path[1], body));
            throw new CareError(404, "ROUTE_NOT_FOUND", "Route introuvable.");
        }
        catch (error) {
            if (error instanceof CareError) {
                const patientId = actor && [403, 404].includes(error.status) ? resourcePatient(store, path) : null;
                if (actor && patientId && !error.accessJournalRecorded)
                    recordDeniedAccess(store, actor, patientId, "request_denied");
                const headers: Record<string,string> | undefined = error.code === "VISIT_UNAVAILABLE" && path[0] === "external-visit" ? {"Set-Cookie":clearGuestCookieHeader()} : error instanceof LoginRateLimitError ? {"Retry-After":String(error.retryAfter)} : undefined;
                return privateJson({ error: { code: error.code, message: error.message } }, error.status, headers);
            }
            console.error("Care request failed", error instanceof Error ? error.name : "UnknownError");
            return privateJson({ error: { code: "INTERNAL_ERROR", message: "Service indisponible." } }, 500);
        }
    };
}
