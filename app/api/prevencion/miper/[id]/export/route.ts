export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/db"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { recordAudit } from "@/lib/audit"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"
import { buildMiperWorkbook, miperFilenameBase } from "@/lib/reports/miper-workbook"
import { getMiperVersion } from "@/lib/services/miper/queries"
import { buildMiperSnapshot, snapshotSha } from "@/lib/services/miper/snapshots"
import { encodeContentDisposition } from "@/lib/utils"

/**
 * Descarga el libro RE-04 de una versión sellada del MIPER. Con `?estado=vivo`
 * se arma desde el estado vivo (leyenda "Incluye cambios no aprobados" y nombre
 * de archivo con sufijo "-vivo"); sin el parámetro —y siempre desde el cron de
 * archivado, que no usa esta ruta— se exporta la versión sellada.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:risk:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  try {
    const { id } = await params
    const detail = await getMiperVersion(id, { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions })
    const liveState = new URL(request.url).searchParams.get("estado") === "vivo"
    let liveSnapshot: Awaited<ReturnType<typeof buildMiperSnapshot>> | undefined
    if (liveState) liveSnapshot = await buildMiperSnapshot(db, detail.version.matrixId)
    const workbook = await buildMiperWorkbook(detail, undefined, { liveState, liveSnapshot })
    const snapshot = liveSnapshot ?? (detail.version.snapshot as { entries: unknown[] })
    const entryCount = snapshot.entries.length
    // La huella del libro vivo no es la de la versión sellada: en modo vivo se
    // registra la del estado que se exportó, para que la traza sea verificable.
    const snapshotSha256 = liveState && liveSnapshot ? snapshotSha(liveSnapshot) : detail.version.snapshotSha256
    addExportMetadataSheet(workbook, session, { filters: { worksiteId: detail.worksiteId, versionId: detail.version.id, versionNumber: detail.version.versionNumber, estado: liveState ? "vivo" : "sellado", snapshotSha256 }, rowCount: entryCount })
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "export",
      entityType: "prevention_risk_matrix_version",
      entityId: detail.version.id,
      entityCode: `MIPER-${detail.version.period}-v${detail.version.versionNumber}`,
      newState: { sheetCount: workbook.worksheets.length, entryCount, estado: liveState ? "vivo" : "sellado", snapshotSha256 },
      reason: liveState ? "Exportación Excel de la MIPER en estado vivo (incluye cambios no aprobados)" : "Exportación Excel de versión MIPER sellada",
    })
    const bytes = await workbook.xlsx.writeBuffer()
    return new NextResponse(bytes, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": encodeContentDisposition(`${miperFilenameBase(detail, { liveState })}.xlsx`, "attachment"), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
  } catch {
    return NextResponse.json({ error: "MIPER no encontrada o fuera de alcance" }, { status: 404 })
  }
}
