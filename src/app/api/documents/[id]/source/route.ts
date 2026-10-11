import { endoResponse, type RouteContext } from "../../../../../lib/endorecord-http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:RouteContext) {
  return endoResponse(request,async(service,actor)=>new Response(new Uint8Array(await service.source(actor,(await context.params).id)),{headers:{"Content-Type":"application/pdf","Content-Disposition":"inline; filename=\"source.pdf\"","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox"}}));
}
