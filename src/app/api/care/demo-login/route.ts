import { getCareStore } from "../../../../lib/care-store";
import { createDemoLoginHandler } from "../../../../lib/demo-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = (request: Request) => createDemoLoginHandler(getCareStore())(request);
export const GET = handle;
export const POST = handle;
