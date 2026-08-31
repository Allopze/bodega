export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { buildInspectionFollowupWorkbook } from "@/lib/services/prevention-inspection-followup"
import { encodeContentDisposition, todayInChile } from "@/lib/utils"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:inspections:export")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  try {
    const bytes = await buildInspectionFollowupWorkbook({ userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions })
    return new NextResponse(bytes, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": encodeContentDisposition(`anexo-15-seguimiento-${todayInChile()}.xlsx`, "attachment"),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    } })
  } catch {
    return NextResponse.json({ error: "No se pudo generar el seguimiento." }, { status: 500 })
  }
}
