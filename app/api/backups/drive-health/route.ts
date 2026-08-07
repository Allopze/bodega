/**
 * GET /api/backups/drive-health
 *
 * Devuelve el estado completo del Service Account de Google Drive
 * más un resumen textual. Usado por SaHealthSection (client component)
 * para re-verificar sin recargar la página.
 */
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { getDriveHealth, getSaStatusSummary } from "@/lib/services/backups"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "admin:backups")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  try {
    const driveHealth = await getDriveHealth()
    const summary = getSaStatusSummary(driveHealth)

    return NextResponse.json({ driveHealth, summary })
  } catch {
    return NextResponse.json(
      {
        driveHealth: null,
        summary: { label: "Error al verificar", status: "failed", details: ["No se pudo ejecutar el healthcheck"] },
      },
      { status: 200 }, // 200 para que el cliente pueda leer el error
    )
  }
}
