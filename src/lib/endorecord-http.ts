import { actorFromRequest } from "./care-session";
import { CareError, requireActor } from "./care-service";
import { getCareStore } from "./care-store";
import { EndoRecordService } from "./endorecord-service";
import { PatientAccountService } from "./patient-account-service";
import { requireSameOrigin } from "./care-http";
export type RouteContext = { params: Promise<{id:string}> };
export async function endoResponse(request:Request, action:(service:EndoRecordService, actor:ReturnType<typeof requireActor>)=>Promise<Response>|Response) {
  try {
    if (request.method !== "GET") requireSameOrigin(request);
    await new PatientAccountService(getCareStore()).initialize();
    return await action(new EndoRecordService(getCareStore()), requireActor(actorFromRequest(request)));
  } catch(error) {
    const failure=error instanceof CareError?error:new CareError(500,"INTERNAL_ERROR","Service documentaire indisponible.");
    if (!(error instanceof CareError)) console.error("EndoRecord request failed",error instanceof Error?error.name:"UnknownError");
    return Response.json({error:{code:failure.code,message:failure.message}},{status:failure.status,headers:{"Cache-Control":"no-store"}});
  }
}
export const endoJson=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
