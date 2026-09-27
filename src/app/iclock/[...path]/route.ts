import { NextRequest, NextResponse } from "next/server";
import { withSystem } from "@/lib/db";
import { logger } from "@/lib/errors";
import { admsRoute } from "@/modules/biometric/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ZKTeco / eSSL terminals call fixed ADMS paths: /iclock/cdata,
// /iclock/getrequest and /iclock/devicecmd. They answer in plain text.
async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const action = path[0]?.replace(/\.aspx$/i, "").toLowerCase() ?? "";
  try {
    return await withSystem(() => admsRoute(req, action));
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : error, action },
      "ADMS request failed",
    );
    return new NextResponse("ERROR", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
  }
}
export { handler as GET, handler as POST };
