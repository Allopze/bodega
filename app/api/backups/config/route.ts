/**
 * GET /api/backups/config
 *
 * Devuelve la configuración de backups persistida en DB para que el
 * scheduler y orquestador lean valores en tiempo real sin redeploy.
 *
 * Protegido por CRON_SECRET (misma protección que /api/cron/*).
 */
export const dynamic = "force-dynamic"

import { type NextRequest, NextResponse } from "next/server"
import { getBackupConfig } from "@/lib/services/backups"
import { verifyCronSecret } from "@/lib/security/cron-auth"

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers.get("authorization")

  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }

  if (!verifyCronSecret(authHeader, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const config = await getBackupConfig()
    return NextResponse.json({
      backupHour: config.backupHour,
      retentionDays: config.retentionDays,
      maxAgeHours: config.maxAgeHours,
      manualTimeoutMinutes: config.manualTimeoutMinutes,
      driveBackupsEnabled: config.driveBackupsEnabled,
      cloudreveBackupsEnabled: config.cloudreveBackupsEnabled,
      cloudreveBackupsPath: config.cloudreveBackupsPath,
    })
  } catch {
    return NextResponse.json({
      backupHour: 3,
      retentionDays: 30,
      maxAgeHours: 36,
      manualTimeoutMinutes: 30,
      driveBackupsEnabled: false,
      cloudreveBackupsEnabled: false,
      cloudreveBackupsPath: "backups/plataforma",
    })
  }
}
