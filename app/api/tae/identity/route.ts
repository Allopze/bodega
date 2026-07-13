import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { checkRateLimit, recordFailure, recordSuccessForTelemetry } from "@/lib/services/rate-limit"
import { validateRut } from "@/lib/rut"
import { findTaeWorkerByRut, getTaeLinkWorksiteId } from "@/lib/services/fuel-tae"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const requestHeaders = await headers()
  const ipAddress = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1"
  const rateLimitKey = `tae:identity:${ipAddress}`
  const rateLimit = await checkRateLimit(rateLimitKey)
  if (!rateLimit.allowed) {
    return NextResponse.json({ ok: false, message: "Demasiadas consultas. Intenta nuevamente más tarde." }, { status: 429 })
  }

  const { accessToken, rut } = await request.json() as { accessToken?: unknown; rut?: unknown }
  if (typeof rut !== "string" || !validateRut(rut)) {
    return NextResponse.json({ ok: false, message: "RUT inválido. Debe tener formato 12345678-9 o similar." }, { status: 400 })
  }

  try {
    const worksiteId = await getTaeLinkWorksiteId(typeof accessToken === "string" ? accessToken : "")
    const worker = await findTaeWorkerByRut(rut, worksiteId)
    if (!worker) {
      // Solo penaliza el fallo (RUT no encontrado en esta faena); las búsquedas
      // exitosas no cuentan contra el límite, igual que en la identificación PPA.
      await recordFailure(rateLimitKey, { maxAttempts: 10 })
      return NextResponse.json({ ok: false, message: "No se encontró ningún trabajador activo con este RUT en esta faena." }, { status: 404 })
    }
    await recordSuccessForTelemetry(rateLimitKey)
    // ponytail: mismo criterio de minimización que PPA — solo nombre + inicial de apellido, sin RUT ni cargo.
    return NextResponse.json({ ok: true, data: { id: worker.id, name: `${worker.firstName} ${worker.lastName?.[0] ?? ""}.` } })
  } catch {
    await recordFailure(rateLimitKey, { maxAttempts: 10 })
    return NextResponse.json({ ok: false, message: "El enlace TAE no está disponible" }, { status: 404 })
  }
}
