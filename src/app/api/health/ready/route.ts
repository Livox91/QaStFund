import { GET as getReadiness } from "@/app/api/health/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return getReadiness();
}
