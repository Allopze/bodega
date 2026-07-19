export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { recordAudit } from "@/lib/audit"
import { getRiskImportSourceFile } from "@/lib/services/prevention-risk-import"
import { readBuffer } from "@/lib/storage/helpers"
import { encodeContentDisposition } from "@/lib/utils"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:risk:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  try {
    const { id } = await params
    const source = await getRiskImportSourceFile(id, { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions })
    const bytes = await readBuffer(source.absolutePath)
    await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export", entityType: "prevention_risk_import_batch", entityId: source.batch.id, newState: { checksumSha256: source.batch.sourceChecksumSha256, sizeBytes: bytes.length }, reason: "Descarga de original MIPER importado" })
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": encodeContentDisposition(source.batch.sourceFileName, "attachment"), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
  } catch {
    return NextResponse.json({ error: "Lote MIPER no encontrado o fuera de alcance" }, { status: 404 })
  }
}
