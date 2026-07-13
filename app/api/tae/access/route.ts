import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { checkRateLimit, recordFailure, recordSuccessForTelemetry } from "@/lib/services/rate-limit"
import { getTaeAccessConfig } from "@/lib/services/fuel-tae"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const requestHeaders = await headers()
  const ipAddress = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1"
  const rateLimit = await checkRateLimit(`tae:access:${ipAddress}`)
  if (!rateLimit.allowed) return NextResponse.json({ ok: false, message: "Demasiadas consultas" }, { status: 429 })
  try {
    const { accessToken } = await request.json() as { accessToken?: unknown }
    const config = await getTaeAccessConfig(typeof accessToken === "string" ? accessToken : "")
    await recordSuccessForTelemetry(`tae:access:${ipAddress}`)
    return NextResponse.json({ ok: true, data: config })
  } catch {
    await recordFailure(`tae:access:${ipAddress}`, { maxAttempts: 20 })
    return NextResponse.json({ ok: false, message: "El enlace TAE no está disponible" }, { status: 404 })
  }
}
