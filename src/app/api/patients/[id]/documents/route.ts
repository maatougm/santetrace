import { endoResponse, endoJson, type RouteContext } from "../../../../../lib/endorecord-http";
import { readBoundedBody } from "../../../../../lib/care-http";
import { MAX_PDF_BYTES } from "../../../../../lib/endorecord-service";
import { CareError, authorizePatient } from "../../../../../lib/care-service";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request,context:RouteContext) {
  return endoResponse(request,async(service,actor)=>{
    const {id}=await context.params;
    authorizePatient(service.store.read(),actor,id);
    const bytes=await readBoundedBody(request,MAX_PDF_BYTES+64*1024);
    let form:FormData;
    try { form=await new Request(request.url,{method:"POST",headers:request.headers,body:Buffer.from(bytes)}).formData(); }
    catch { throw new CareError(400,"INVALID_FORM","Formulaire de document invalide."); }
    const file=form.get("file");
    if (!(file instanceof File)) throw new CareError(400,"INVALID_FILE","Fichier PDF requis.");
    if(file.size>MAX_PDF_BYTES)throw new CareError(413,"TOO_LARGE","Maximum 5 Mio par document.");
    return endoJson(await service.upload(actor,id,file.name,new Uint8Array(await file.arrayBuffer())),201);
  });
}
