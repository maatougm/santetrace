import { endoResponse, endoJson, type RouteContext } from "../../../../lib/endorecord-http";
import { readBoundedJson } from "../../../../lib/care-http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function PATCH(request:Request,context:RouteContext) {
  return endoResponse(request,async(service,actor)=>endoJson(service.review(actor,(await context.params).id,await readBoundedJson(request))));
}
