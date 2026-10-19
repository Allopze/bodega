export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"
import { ModuleDisabledError } from "@/lib/services/module-toggles"
import { assertInspectionOperationEnabled } from "@/lib/services/prevention-inspections"
import { buildInspectionFollowupWorkbook } from "@/lib/services/prevention-inspection-followup"
import { encodeContentDisposition, todayInChile } from "@/lib/utils"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:inspections:export")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  try {
    // P2-11: este export no aplicaba el interruptor del submódulo que sí respetan
    // el export principal y las server actions; con Inspecciones apagado el Excel
    // seguía descargándose.
    await assertInspectionOperationEnabled()
    const bytes = await buildInspectionFollowupWorkbook({ userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions })
    return new NextResponse(bytes, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": encodeContentDisposition(`anexo-15-seguimiento-${todayInChile()}.xlsx`, "attachment"),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    } })
  } catch (error) {
    if (error instanceof ModuleDisabledError) {
      return NextResponse.json({ error: "El submódulo Inspecciones está desactivado." }, { status: 403 })
    }
    // El `catch {}` anterior se tragaba la causa: una descarga que fallaba no dejaba rastro.
    logger.error("[prevencion/inspecciones/seguimiento/export]", error)
    return NextResponse.json({ error: "No se pudo generar el seguimiento." }, { status: 500 })
  }
}
