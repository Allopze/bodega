import { NextRequest, NextResponse } from "next/server"
import { purgeOnwayRetention } from "@/lib/integrations/onway/onway-retention"
import { cronRequestSource, parseCronAllowedSources, verifyCronRequest } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { isRouteOperational } from "@/lib/services/module-toggles"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const allowedSources = parseCronAllowedSources(process.env.CRON_ALLOWED_SOURCES)
  const enforceSource = process.env.NODE_ENV === "production" || allowedSources.length > 0
  if (!secret || !verifyCronRequest({
    authorization: request.headers.get("authorization"),
    forwardedFor: request.headers.get("x-forwarded-for"),
    realIp: request.headers.get("x-real-ip"),
  }, secret, allowedSources, enforceSource)) {
    return NextResponse.json({ ok: false, outcome: "unauthorized", code: "FLEET_GPS_CRON_UNAUTHORIZED" }, { status: 401 })
  }
  // Mismo href que `fleet-onway-sync`: apagar Monitoreo GPS tiene que detener
  // también la purga, o el módulo apagado sigue borrando datos por su cuenta.
  if (!await isRouteOperational("/flota/monitoreo")) {
    return NextResponse.json({ ok: true, outcome: "disabled", code: "FLEET_GPS_CRON_DISABLED" }, { status: 200 })
  }
  const source = cronRequestSource({ forwardedFor: request.headers.get("x-forwarded-for"), realIp: request.headers.get("x-real-ip") })
  const result = await withCronLock("fleet-onway-retention", () => purgeOnwayRetention())
  if ("skipped" in result) return NextResponse.json({ ok: false, outcome: "conflict", code: "FLEET_GPS_CRON_ACTIVE_RUN", source }, { status: 409 })
  return NextResponse.json({ ok: true, outcome: "success", code: "FLEET_GPS_CRON_SUCCESS", ...result })
}
