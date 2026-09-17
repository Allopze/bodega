/**
 * GET /api/prevencion/pdtp/export
 * Exporta una hoja del Programa de Trabajo Preventivo SG-SST como Excel.
 */

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { renderPdtpRe36Buffer } from "@/lib/reports/pdtp-re36-workbook"
import { buildPdtpExport, buildPdtpRe36Document, assertWorksiteAccess, isActivePdtpWorksite } from "@/lib/services/prevention-pdtp"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"
import { recordAudit } from "@/lib/audit"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  const url = request.nextUrl
  const requestedWorksiteId = url.searchParams.get("faena") || undefined
  const programId = url.searchParams.get("programId") || undefined
  const formato = normalizeFormato(url.searchParams.get("formato"))
  const auditOutcome = async (result: "success" | "denied" | "invalid" | "error", reason: string, worksiteId?: string) => {
    try {
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "export",
        entityType: "prevention_pdtp_program",
        entityId: programId ?? "unspecified",
        entityCode: programId,
        newState: {
          result,
          formato,
          requestedWorksiteId: worksiteId ?? requestedWorksiteId ?? null,
          requestedYear: url.searchParams.get("year"),
          sheetCode: normalizeSheetCode(url.searchParams.get("hoja")),
        },
        reason,
      })
    } catch (auditError) {
      logger.error("[prevencion/pdtp/export:audit]", auditError)
    }
  }
  if (!can(session, "prevention:pdtp:view")) {
    await auditOutcome("denied", "Exportación PDTP denegada por falta de permiso")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const sheetCode = normalizeSheetCode(url.searchParams.get("hoja"))
  const yearParam = Number.parseInt(url.searchParams.get("year") ?? "", 10)
  const currentYear = new Date().getFullYear()
  const minYear = 2024
  const maxYear = currentYear + 2
  const year = Number.isFinite(yearParam) && yearParam >= minYear && yearParam <= maxYear
    ? yearParam
    : currentYear
  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []

  if (scope.mode === "none") {
    await auditOutcome("denied", "Exportación PDTP denegada por falta de alcance de faena")
    return NextResponse.json({ error: "No tienes faenas habilitadas para exportar." }, { status: 403 })
  }

  const worksiteId = requestedWorksiteId
    ?? (scope.mode === "some" && scope.ids.length === 1 ? scope.ids[0] : undefined)
  if (!worksiteId) {
    await auditOutcome("invalid", "Exportación PDTP rechazada porque falta seleccionar una faena")
    return NextResponse.json({ error: "Selecciona una faena para generar el export." }, { status: 400 })
  }

  try {
    try {
      assertWorksiteAccess(worksiteId, worksiteIds)
    } catch {
      await auditOutcome("denied", "Exportación PDTP denegada por faena fuera del alcance", worksiteId)
      return NextResponse.json({ error: "Sin acceso a la faena solicitada." }, { status: 403 })
    }
    if (!(await isActivePdtpWorksite(worksiteId))) {
      await auditOutcome("invalid", "Exportación PDTP rechazada porque la faena no existe o está inactiva", worksiteId)
      return NextResponse.json({ error: "La faena solicitada no existe o está inactiva." }, { status: 400 })
    }

    if (formato === "plano") {
      const report = await buildPdtpExport({ programId, year, sheetCode, worksiteId, scope: worksiteIds })
      const xlsx = await buildXlsxBuffer(report)
      await auditOutcome("success", `Exportación Excel plana de programa preventivo acotada por faena (${year}, ${sheetCode}, ${report.sheets?.length ?? 1} hoja(s))`, worksiteId)

      return new NextResponse(xlsx, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": encodeContentDisposition(`${report.filenameBase}.xlsx`, "attachment"),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      })
    }

    // Formato RE-36 (default): el documento por faena, no una hoja plana.
    // A diferencia de `buildPdtpExport`, `buildPdtpRe36Document` no acepta
    // resolver el programa por año: exige `programId` explícito.
    if (!programId) {
      await auditOutcome("invalid", "Exportación RE-36 rechazada porque falta indicar el programa", worksiteId)
      return NextResponse.json({ error: "Falta indicar el programa para exportar el RE-36." }, { status: 400 })
    }
    const doc = await buildPdtpRe36Document({ programId, worksiteId, scope: worksiteIds })
    const xlsx = await renderPdtpRe36Buffer(doc)
    // El nombre usa el año y la versión del programa resuelto (`doc.program`)
    // y el código de faena del registro resuelto (`doc.worksite.code`), no
    // el `?year=`/`?faena=` de la query: mismo motivo que `buildPdtpExport`
    // (ver comentario de `filenameBase` en `lib/services/pdtp/sheets.ts`) —
    // un `?year=` legado o un id de faena no siempre coincide con lo resuelto.
    const filenameBase = `RE-36-PDTP-${doc.program.year}-${doc.worksite.code}-v${doc.program.version}`
    await auditOutcome("success", `Exportación RE-36 de programa preventivo acotada por faena (${doc.program.year}, ${doc.sheets.length} hoja(s))`, worksiteId)

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
    logger.error("[prevencion/pdtp/export]", err)
    await auditOutcome("error", "Exportación PDTP fallida durante la generación", worksiteId)
    return NextResponse.json({ error: "Error al generar el export" }, { status: 500 })
  }
}

/**
 * No valida contra una lista fija de ocho códigos: un programa distinto al
 * 2026 puede tener sus propias vistas. Un código que no exista para el
 * programa resuelto falla más abajo (buildPdtpExport → 500 auditado), en vez
 * de sustituirse en silencio por "pdtp_general".
 */
function normalizeSheetCode(value: string | null): string {
  const trimmed = value?.trim()
  return trimmed || "pdtp_general"
}

/**
 * `formato=re36` es el default (el documento por faena, formato oficial que
 * firma Legal). `formato=plano` conserva la planilla plana previa a esta
 * tarea. Un valor desconocido no revienta la ruta: cae al default, igual que
 * `normalizeSheetCode` con un código inexistente.
 */
function normalizeFormato(value: string | null): "re36" | "plano" {
  return value === "plano" ? "plano" : "re36"
}
