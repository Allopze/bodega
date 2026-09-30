export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { recordAudit } from "@/lib/audit"
import { addExportMetadataSheet } from "@/lib/reports/export"
import { buildMiperWorkbook, miperFilenameBase } from "@/lib/reports/miper-workbook"
import { getMiperVersion } from "@/lib/services/miper/queries"
import { encodeContentDisposition } from "@/lib/utils"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:risk:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  try {
    const { id } = await params
    const detail = await getMiperVersion(id, { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions })
    const workbook = await buildMiperWorkbook(detail)
    const entryCount = (detail.version.snapshot as { entries: unknown[] }).entries.length
    addExportMetadataSheet(workbook, session, { filters: { worksiteId: detail.worksiteId, versionId: detail.version.id, versionNumber: detail.version.versionNumber, snapshotSha256: detail.version.snapshotSha256 }, rowCount: entryCount })
    await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export", entityType: "prevention_risk_matrix_version", entityId: detail.version.id, entityCode: `MIPER-${detail.version.period}-v${detail.version.versionNumber}`, newState: { sheetCount: workbook.worksheets.length, entryCount, snapshotSha256: detail.version.snapshotSha256 }, reason: "Exportación Excel de versión MIPER sellada" })
    const bytes = await workbook.xlsx.writeBuffer()
    return new NextResponse(bytes, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": encodeContentDisposition(`${miperFilenameBase(detail)}.xlsx`, "attachment"), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
  } catch {
    return NextResponse.json({ error: "MIPER no encontrada o fuera de alcance" }, { status: 404 })
  }
}
