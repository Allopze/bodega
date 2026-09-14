import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { resolveTrustedClientIp } from "@/lib/security/login-rate-limit-ip"
import {
  PUBLIC_IDENTITY_LOOKUP_QUOTA_MESSAGE,
  PUBLIC_IDENTITY_LOOKUP_UNIFORM_MESSAGE,
  consumePublicIdentityLookupQuota,
  settleUniformIdentityLookupLatency,
} from "@/lib/security/public-identity-lookup"
import { validateRut } from "@/lib/rut"
import { findTaeWorkerByRut, getTaeLinkWorksiteId } from "@/lib/services/fuel-tae"
import { isRouteOperational } from "@/lib/services/module-toggles"

export const runtime = "nodejs"

export async function POST(request: Request) {
  if (!await isRouteOperational("/combustibles/tae")) {
    return NextResponse.json({ ok: false, message: "Control TAE temporalmente inactivo" }, { status: 503 })
  }
  const requestHeaders = await headers()
  const ipAddress = resolveTrustedClientIp(requestHeaders)
  const rateLimitKey = `tae:identity:${ipAddress}`

  const { accessToken, rut } = await request.json() as { accessToken?: unknown; rut?: unknown }
  // El formato del RUT es una validación sintáctica del cliente: no dice nada
  // sobre quién existe, así que puede seguir siendo su propia respuesta y no
  // consume cuota.
  if (typeof rut !== "string" || !validateRut(rut)) {
    return NextResponse.json({ ok: false, message: "RUT inválido. Debe tener formato 12345678-9 o similar." }, { status: 400 })
  }

  /*
   * COM-003 (auditoría 2026-09-14): con el enlace TAE —que circula impreso en
   * el punto de carga— cualquiera distinguía un 404 "no se encontró ningún
   * trabajador activo con este RUT en esta faena" de un 200 con nombre, y los
   * aciertos NO consumían cuota (`recordFailure` sólo penalizaba el fallo,
   * 10 por IP). Enumerar la dotación de una faena era gratis.
   *
   * Ahora se consume la cuota antes de resolver el enlace, de modo que acertar
   * cuesta igual que fallar, y todas las ramas de rechazo posteriores comparten
   * cuerpo, código y piso de latencia con la identificación PPA (PPA-002).
   */
  if (!await consumePublicIdentityLookupQuota(rateLimitKey)) {
    return NextResponse.json({ ok: false, message: PUBLIC_IDENTITY_LOOKUP_QUOTA_MESSAGE }, { status: 429 })
  }

  const startedAt = Date.now()
  try {
    const worksiteId = await getTaeLinkWorksiteId(typeof accessToken === "string" ? accessToken : "")
    const worker = await findTaeWorkerByRut(rut, worksiteId)
    if (!worker) {
      await settleUniformIdentityLookupLatency(startedAt)
      return NextResponse.json({ ok: false, message: PUBLIC_IDENTITY_LOOKUP_UNIFORM_MESSAGE }, { status: 404 })
    }
    await settleUniformIdentityLookupLatency(startedAt)
    // ponytail: mismo criterio de minimización que PPA — solo nombre + inicial de apellido, sin RUT ni cargo.
    return NextResponse.json({ ok: true, data: { id: worker.id, name: `${worker.firstName} ${worker.lastName?.[0] ?? ""}.` } })
  } catch {
    // Enlace inválido, revocado o vencido: antes tenía su propio texto ("El
    // enlace TAE no está disponible") y por lo tanto se distinguía del RUT
    // ausente. Ahora es el mismo cuerpo y el mismo código.
    await settleUniformIdentityLookupLatency(startedAt)
    return NextResponse.json({ ok: false, message: PUBLIC_IDENTITY_LOOKUP_UNIFORM_MESSAGE }, { status: 404 })
  }
}
