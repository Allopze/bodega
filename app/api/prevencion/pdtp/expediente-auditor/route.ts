/**
 * GET /api/prevencion/pdtp/expediente-auditor
 * Expediente auditor del Programa de Trabajo Preventivo: ejecuciones,
 * fuentes, obligaciones, acciones, seguimientos, aprobaciones y cambios de
 * una faena autorizada. No incluye URLs de evidencia crudas ni rutas
 * internas — solo identificadores de ejecución/acción resolubles dentro de
 * la aplicación con la autorización del visitante.
 */

export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { addExportMetadataSheet } from "@/lib/reports/export"
import { assertWorksiteAccess, getPdtpAuditDossier, isActivePdtpWorksite } from "@/lib/services/prevention-pdtp"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"
import { recordAudit } from "@/lib/audit"

function safe(value: unknown) {
  if (value === null || value === undefined) return ""
  const text = String(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

function styleHeader(sheet: { getRow: (row: number) => { font: object; fill: object } }) {
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  const url = request.nextUrl
  const requestedWorksiteId = url.searchParams.get("faena") || undefined
  const programId = url.searchParams.get("programId") || undefined

  const auditOutcome = async (result: "success" | "denied" | "invalid" | "error", reason: string, worksiteId?: string) => {
    try {
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "export",
        entityType: "prevention_pdtp_program",
        entityId: programId ?? "unspecified",
        entityCode: programId,
        newState: { result, requestedWorksiteId: worksiteId ?? requestedWorksiteId ?? null, dossier: true },
        reason,
      })
    } catch (auditError) {
      logger.error("[prevencion/pdtp/expediente-auditor:audit]", auditError)
    }
  }

  if (!can(session, "prevention:pdtp:view")) {
    await auditOutcome("denied", "Expediente auditor PDTP denegado por falta de permiso")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }
  if (!programId) {
    await auditOutcome("invalid", "Expediente auditor PDTP rechazado porque falta el programa")
    return NextResponse.json({ error: "Selecciona un programa para generar el expediente." }, { status: 400 })
  }

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" = scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  if (scope.mode === "none") {
    await auditOutcome("denied", "Expediente auditor PDTP denegado por falta de alcance de faena")
    return NextResponse.json({ error: "No tienes faenas habilitadas para exportar." }, { status: 403 })
  }

  const worksiteId = requestedWorksiteId ?? (scope.mode === "some" && scope.ids.length === 1 ? scope.ids[0] : undefined)
  if (!worksiteId) {
    await auditOutcome("invalid", "Expediente auditor PDTP rechazado porque falta seleccionar una faena")
    return NextResponse.json({ error: "Selecciona una faena para generar el expediente." }, { status: 400 })
  }

  try {
    try {
      assertWorksiteAccess(worksiteId, worksiteIds)
    } catch {
      await auditOutcome("denied", "Expediente auditor PDTP denegado por faena fuera del alcance", worksiteId)
      return NextResponse.json({ error: "Sin acceso a la faena solicitada." }, { status: 403 })
    }
    if (!(await isActivePdtpWorksite(worksiteId))) {
      await auditOutcome("invalid", "Expediente auditor PDTP rechazado porque la faena no existe o está inactiva", worksiteId)
      return NextResponse.json({ error: "La faena solicitada no existe o está inactiva." }, { status: 400 })
    }

    const dossier = await getPdtpAuditDossier({ programId, worksiteId, scope: worksiteIds })
    if (!dossier) {
      await auditOutcome("invalid", "Expediente auditor PDTP rechazado porque el programa no existe", worksiteId)
      return NextResponse.json({ error: "Programa no encontrado." }, { status: 404 })
    }

    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    workbook.creator = "Plataforma Chome"
    workbook.created = new Date()

    const cover = workbook.addWorksheet("Programa")
    cover.columns = [{ key: "label", width: 24 }, { key: "value", width: 70 }]
    cover.addRow({ label: "Programa", value: safe(dossier.programTitle) })
    cover.addRow({ label: "Estado", value: dossier.status })
    cover.addRow({ label: "Versión de contenido", value: dossier.contentVersion })
    cover.addRow({ label: "Digest (SHA-256)", value: dossier.contentDigest ?? "Sin firmar" })
    cover.addRow({ label: "Faena", value: safe(dossier.worksiteName) })
    cover.getColumn("label").font = { bold: true }

    const executions = workbook.addWorksheet("Ejecuciones")
    executions.columns = [
      { header: "N° actividad", key: "n", width: 12 }, { header: "Actividad", key: "activity", width: 50 },
      { header: "Año", key: "year", width: 8 }, { header: "Mes", key: "month", width: 8 }, { header: "Semana", key: "week", width: 10 },
      { header: "Cantidad", key: "qty", width: 12 }, { header: "Estado", key: "status", width: 14 },
      { header: "Con evidencia", key: "evidence", width: 14 }, { header: "Actor", key: "actor", width: 24 },
      { header: "Fecha", key: "at", width: 22 }, { header: "ID ejecución (navegable)", key: "id", width: 30 },
    ]
    for (const row of dossier.executions) executions.addRow({
      n: row.activityN, activity: safe(row.activityName), year: row.year, month: row.month, week: row.week,
      qty: row.executedQuantity, status: row.status, evidence: row.hasEvidence ? "Sí" : "No",
      actor: row.executedByUserId ?? "", at: row.executedAt ?? "", id: row.executionId,
    })
    styleHeader(executions)

    const sources = workbook.addWorksheet("Fuentes")
    sources.columns = [
      { header: "N° actividad", key: "n", width: 12 }, { header: "Tipo de fuente", key: "sourceType", width: 20 },
      { header: "ID de fuente", key: "sourceId", width: 30 }, { header: "Vigente", key: "active", width: 10 },
      { header: "Justificación", key: "justification", width: 50 }, { header: "Creado por", key: "createdBy", width: 24 },
      { header: "Fecha creación", key: "createdAt", width: 22 }, { header: "Retirado por", key: "retiredBy", width: 24 },
      { header: "Fecha retiro", key: "retiredAt", width: 22 }, { header: "Motivo retiro", key: "retirementReason", width: 50 },
    ]
    for (const row of dossier.sourceLinks) sources.addRow({
      n: row.activityN, sourceType: row.sourceType, sourceId: safe(row.sourceId), active: row.isActive ? "Sí" : "No",
      justification: safe(row.justification), createdBy: row.createdByUserId, createdAt: row.createdAt,
      retiredBy: row.retiredByUserId ?? "", retiredAt: row.retiredAt ?? "", retirementReason: safe(row.retirementReason ?? ""),
    })
    styleHeader(sources)

    const obligations = workbook.addWorksheet("Obligaciones a demanda")
    obligations.columns = [
      { header: "N° actividad", key: "n", width: 12 }, { header: "Actividad", key: "activity", width: 40 },
      { header: "Origen", key: "origin", width: 14 }, { header: "Tipo de fuente", key: "sourceType", width: 18 },
      { header: "ID de fuente", key: "sourceId", width: 24 }, { header: "Estado", key: "status", width: 14 },
      { header: "Vencimiento", key: "dueAt", width: 22 }, { header: "Cantidad esperada", key: "plannedQuantity", width: 16 },
      { header: "ID obligación (navegable)", key: "id", width: 30 },
    ]
    for (const row of dossier.obligations) obligations.addRow({
      n: row.activityNumber, activity: safe(row.activityName), origin: row.obligation.origin, sourceType: row.obligation.sourceType ?? "",
      sourceId: safe(row.obligation.sourceId ?? ""), status: row.obligation.status, dueAt: row.obligation.dueAt ?? "",
      plannedQuantity: row.obligation.plannedQuantity, id: row.obligation.id,
    })
    styleHeader(obligations)

    // Columnas del Anexo 15 ("Seguimiento y Control") más el daño potencial y
    // la normativa legal del Anexo 8 ("Evidencia Objetiva No Planeada"), que
    // son parte del registro que el auditor exige y antes no se exportaban.
    const actions = workbook.addWorksheet("Acciones correctivas")
    actions.columns = [
      { header: "N°", key: "n", width: 8 }, { header: "Fecha", key: "fecha", width: 14 },
      { header: "Área / Faena", key: "worksite", width: 24 },
      { header: "Desviación detectada", key: "hallazgo", width: 40 },
      { header: "Daño potencial", key: "danoPotencial", width: 16 },
      { header: "Medidas correctivas", key: "accion", width: 40 },
      { header: "Normativa legal aplicable", key: "normativaLegal", width: 30 },
      { header: "Responsable mejora", key: "responsable", width: 24 },
      { header: "Fecha ejecución MC", key: "plazo", width: 18 }, { header: "Prioridad", key: "prioridad", width: 12 },
      { header: "Estado", key: "estado", width: 14 }, { header: "Vencida", key: "vencida", width: 10 },
      { header: "ID acción (navegable)", key: "id", width: 30 },
    ]
    for (const row of dossier.actions) actions.addRow({
      n: row.n, fecha: row.createdAt?.slice(0, 10) ?? "", worksite: safe(dossier.worksiteName),
      hallazgo: safe(row.hallazgo), danoPotencial: row.danoPotencial ?? "",
      accion: safe(row.accion), normativaLegal: safe(row.normativaLegal ?? ""),
      responsable: safe(row.responsable),
      plazo: row.plazo, prioridad: row.prioridad, estado: row.estado, vencida: row.vencida ? "Sí" : "No",
      id: row.id,
    })
    styleHeader(actions)

    const followups = workbook.addWorksheet("Seguimiento")
    followups.columns = [
      { header: "ID acción", key: "actionId", width: 30 }, { header: "Fecha", key: "fecha", width: 22 },
      { header: "Estado anterior", key: "estadoAnterior", width: 18 }, { header: "Estado nuevo", key: "estadoNuevo", width: 18 },
      { header: "Observación", key: "observacion", width: 50 },
    ]
    for (const [actionId, items] of Object.entries(dossier.followupsByActionId)) {
      for (const item of items) followups.addRow({
        actionId, fecha: item.fecha, estadoAnterior: item.estadoAnterior ?? "", estadoNuevo: item.estadoNuevo, observacion: safe(item.observacion ?? ""),
      })
    }
    styleHeader(followups)

    const approvals = workbook.addWorksheet("Aprobaciones")
    approvals.columns = [
      { header: "Orden", key: "order", width: 8 }, { header: "Paso", key: "label", width: 28 },
      { header: "Obligatorio", key: "required", width: 12 }, { header: "Decisión", key: "decision", width: 14 },
      { header: "Actor", key: "actor", width: 24 }, { header: "Fecha", key: "at", width: 22 },
    ]
    for (const step of dossier.approvalSteps) approvals.addRow({
      order: step.stepOrder, label: safe(step.label), required: step.isRequired ? "Sí" : "No",
      decision: step.decision?.decision ?? "Pendiente", actor: step.decision?.actorUserId ?? "", at: step.decision?.decidedAt ?? "",
    })
    styleHeader(approvals)

    const changes = workbook.addWorksheet("Cambios")
    changes.columns = [
      { header: "Versión", key: "version", width: 10 }, { header: "Sección", key: "section", width: 24 },
      { header: "Actor", key: "actor", width: 24 }, { header: "Fecha", key: "at", width: 22 }, { header: "Nota", key: "note", width: 60 },
    ]
    for (const row of dossier.changes) changes.addRow({
      version: row.version, section: row.section, actor: row.changedByUserId ?? "", at: row.changedAt, note: safe(row.note ?? ""),
    })
    styleHeader(changes)

    const batches = workbook.addWorksheet("Lotes de importación")
    batches.columns = [
      { header: "Estado", key: "status", width: 14 }, { header: "Adaptador", key: "adapterCode", width: 20 },
      { header: "Archivo", key: "fileName", width: 40 }, { header: "SHA-256", key: "checksum", width: 66 },
      { header: "Solicitado por", key: "requestedBy", width: 24 }, { header: "Aplicado por", key: "appliedBy", width: 24 },
      { header: "Creado", key: "createdAt", width: 22 }, { header: "Aplicado", key: "appliedAt", width: 22 },
      { header: "Motivo cancelación", key: "cancellationReason", width: 50 },
    ]
    for (const row of dossier.importBatches) batches.addRow({
      status: row.status, adapterCode: row.adapterCode, fileName: safe(row.sourceFileName), checksum: row.sourceChecksumSha256,
      requestedBy: row.requestedByUserId, appliedBy: row.appliedByUserId ?? "", createdAt: row.createdAt,
      appliedAt: row.appliedAt ?? "", cancellationReason: safe(row.cancellationReason ?? ""),
    })
    styleHeader(batches)

    addExportMetadataSheet(workbook, session, {
      rowCount: dossier.executions.length + dossier.sourceLinks.length + dossier.obligations.length + dossier.actions.length,
      filters: { programId, worksiteId },
    })

    await auditOutcome("success", `Expediente auditor PDTP generado (${dossier.executions.length} ejecuciones, ${dossier.actions.length} acciones)`, worksiteId)
    const xlsx = await workbook.xlsx.writeBuffer()

    return new NextResponse(xlsx, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": encodeContentDisposition(`pdtp-expediente-auditor-${dossier.programId}.xlsx`, "attachment"),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (err) {
    logger.error("[prevencion/pdtp/expediente-auditor]", err)
    await auditOutcome("error", "Expediente auditor PDTP fallido durante la generación", worksiteId)
    return NextResponse.json({ error: "Error al generar el expediente" }, { status: 500 })
  }
}
