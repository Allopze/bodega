import { NextRequest, NextResponse } from "next/server"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { DtePortalClient } from "@/lib/services/dte-portal/client"
import { buildDtePortalClientConfig, isDteSyncEnabled } from "@/lib/services/dte-portal/config"
import { syncDteDocuments, rollingSyncPeriods } from "@/lib/services/dte-portal/sync"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/cron/dte-portal-sync
 *
 * Sincronización automática del libro de compras DTE.
 *
 * Cubre el mes en curso **y el anterior** (ver `rollingSyncPeriods`): los
 * proveedores entregan con retraso y el corte por "período cerrado" dejaba
 * fuera del libro, de forma permanente, todo documento que llegara después de
 * la primera corrida exitosa del mes.
 *
 * Protegido por CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || !verifyCronSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!(await isDteSyncEnabled())) {
    return NextResponse.json({ ok: true, skipped: true, reason: "DTE sync not enabled" })
  }

  let client: DtePortalClient
  try {
    client = new DtePortalClient(await buildDtePortalClientConfig())
  } catch (error) {
    return NextResponse.json({ ok: false, error: sanitize(error) }, { status: 500 })
  }

  // Un período que falla no debe impedir el otro: el mes en curso es el que
  // más importa y no puede quedar rehén de un timeout leyendo el anterior.
  const periods = rollingSyncPeriods()
  const results = []
  let anyFailed = false

  for (const periodo of periods) {
    try {
      const result = await syncDteDocuments(client, { periodo, trigger: "cron" })
      results.push(result)
      if (result.status === "failed") anyFailed = true
    } catch (error) {
      anyFailed = true
      const message = sanitize(error)
      logger.error("[cron/dte-portal-sync] período falló", { periodo, message })
      results.push({ periodo, status: "failed" as const, error: message })
    }
  }

  // `ok:false` cuando cualquiera de los dos falló: el scheduler usa el código
  // HTTP para que la falla se vea, y un 200 con un período roto adentro es
  // exactamente el tipo de éxito aparente que ya nos costó meses.
  return NextResponse.json({ ok: !anyFailed, periods, results }, { status: anyFailed ? 500 : 200 })
}

/**
 * Nunca dejar salir una credencial en el mensaje de error.
 *
 * Se comparan los VALORES además de los nombres: la versión anterior sólo
 * buscaba las palabras "clave" y "rut_usr", así que un mensaje que trajera la
 * contraseña sin nombrarla pasaba intacto.
 */
function sanitize(error: unknown): string {
  const message = error instanceof Error ? error.message : "DTE portal sync failed"
  const secrets = [
    process.env.DTE_PORTAL_CLAVE,
    process.env.DTE_PORTAL_RUT_USR,
    process.env.DTE_PORTAL_RUT_EMP,
  ].filter((value): value is string => Boolean(value && value.length >= 4))

  if (secrets.some((value) => message.includes(value))) return "DTE portal configuration error"
  if (/clave|rut_usr|rut_emp/i.test(message)) return "DTE portal configuration error"
  return message.slice(0, 500)
}
