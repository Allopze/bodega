/**
 * GET /api/prevencion/pdtp/cierres/[closureId]/export
 *
 * Descarga el RE-36 **congelado** de un cierre mensual.
 *
 * El punto de toda la Fase 4 vive acá: el documento se renderiza desde
 * `closure.snapshotJson.re36`, **sin volver a consultar la base**. Meses
 * después, con el programa ya revisado, con ejecuciones nuevas cargadas y con
 * desvíos retirados, esta descarga sigue produciendo exactamente el Excel que
 * se distribuyó y se firmó. Si alguna vez aparece un `buildPdtpRe36Document`
 * en esta ruta, el cierre dejó de ser una foto y volvió a ser una consulta.
 *
 * Se le agrega una hoja "Cierre" con la procedencia del archivo (corte,
 * motivo, quién cerró, huella y versión), que es lo que permite auditarlo sin
 * abrir la plataforma.
 */

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { renderPdtpRe36Buffer } from "@/lib/reports/pdtp-re36-workbook"
import { getPdtpPeriodClosure } from "@/lib/services/pdtp/period-closures"
import type { PdtpPeriodClosureSnapshot } from "@/lib/services/pdtp/period-closures"
import { pdtpClosureFilenameBase, pdtpClosureMonthLabel, pdtpClosureSheet } from "@/lib/services/pdtp/period-closure-export"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"
import { recordAudit } from "@/lib/audit"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ closureId: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const { closureId } = await context.params

  const auditOutcome = async (result: "success" | "denied" | "error", reason: string) => {
    try {
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "export",
        entityType: "pdtp_period_closure",
        entityId: closureId,
        newState: { result },
        reason,
      })
    } catch (auditError) {
      logger.error("[prevencion/pdtp/cierres/export:audit]", auditError)
    }
  }

  if (!can(session, "prevention:pdtp:view")) {
    await auditOutcome("denied", "Descarga del cierre PDTP denegada por falta de permiso")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") {
    await auditOutcome("denied", "Descarga del cierre PDTP denegada por falta de alcance de faena")
    return NextResponse.json({ error: "No tienes faenas habilitadas." }, { status: 403 })
  }
  const worksiteIds: string[] | "all" = scope.mode === "all" ? "all" : scope.ids

  try {
    let closure
    try {
      closure = await getPdtpPeriodClosure(closureId, worksiteIds)
    } catch {
      // `assertWorksiteAccess` lanza cuando la faena del cierre está fuera del
      // alcance: es un 403, no un 500.
      await auditOutcome("denied", "Descarga del cierre PDTP denegada por faena fuera del alcance")
      return NextResponse.json({ error: "Sin acceso a la faena de este cierre." }, { status: 403 })
    }
    if (!closure) {
      await auditOutcome("error", "Descarga del cierre PDTP fallida: el cierre no existe")
      return NextResponse.json({ error: "Cierre no encontrado." }, { status: 404 })
    }

    const snapshot = closure.snapshotJson as PdtpPeriodClosureSnapshot
    const monthLabel = pdtpClosureMonthLabel(closure)
    // La hoja «Cierre» y el nombre los comparte el archivado en Cloudreve.
    const xlsx = await renderPdtpRe36Buffer(snapshot.re36, { session, closure: pdtpClosureSheet(closure, snapshot) })

    const filenameBase = pdtpClosureFilenameBase(closure, snapshot)
    await auditOutcome("success", `Descarga del cierre PDTP de ${monthLabel} (versión ${closure.version})`)

    return new NextResponse(xlsx, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(`${filenameBase}.xlsx`, "attachment"),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (err) {
    logger.error("[prevencion/pdtp/cierres/export]", err)
    await auditOutcome("error", "Descarga del cierre PDTP fallida durante la generación")
    return NextResponse.json({ error: "Error al generar el export del cierre" }, { status: 500 })
  }
}
