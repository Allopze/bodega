export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { recordAudit } from "@/lib/audit"
import { addExportMetadataSheet } from "@/lib/reports/export"
import { buildMiperWorkbook } from "@/lib/services/prevention-risk-export"
import { encodeContentDisposition } from "@/lib/utils"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:risk:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  try {
    const { id } = await params
    const access = { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
    const { workbook, detail } = await buildMiperWorkbook(id, access)
    addExportMetadataSheet(workbook, session, { filters: { worksiteId: detail.matrix.worksiteId, matrixId: detail.matrix.id, status: detail.matrix.status, sourceHashSha256: detail.matrix.publishedHashSha256 }, rowCount: detail.entries.length })
    await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export", entityType: "prevention_risk_matrix", entityId: detail.matrix.id, entityCode: `MIPER-v${detail.matrix.matrixVersion}`, newState: { sheetCount: workbook.worksheets.length, entryCount: detail.entries.length, controlCount: detail.controls.length, sourceHashSha256: detail.matrix.publishedHashSha256 }, reason: "Exportación Excel de MIPER publicada" })
    const bytes = await workbook.xlsx.writeBuffer()
    return new NextResponse(bytes, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": encodeContentDisposition(`MIPER_${detail.worksiteName}_v${detail.matrix.matrixVersion}.xlsx`, "attachment"), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
  } catch {
    return NextResponse.json({ error: "MIPER no encontrada o fuera de alcance" }, { status: 404 })
  }
}
