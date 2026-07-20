/**
 * GET /api/backups/drive-health
 *
 * Devuelve el estado completo del Service Account de Google Drive
 * más un resumen textual. Usado por SaHealthSection (client component)
 * para re-verificar sin recargar la página.
 */
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getDriveHealth, getSaStatusSummary } from "@/lib/services/backups"

export async function GET() {
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
