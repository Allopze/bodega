/**
 * GET /api/cron/generated-documents-archive
 *
 * Segunda mano del archivado de documentos generados en Cloudreve. El archivo
 * se arma y se sube en el `after()` de la acción que produjo el hecho; esto
 * recoge lo que ahí no alcanzó:
 *
 * - sube las copias que quedaron en disco local (Cloudreve estaba caído);
 * - arma los Excel pendientes, que no necesitan sesión;
 * - deja fallidos, para el reintento manual, los PDF que nadie pudo imprimir
 *   a tiempo (el cron no tiene sesión para abrir una página de impresión).
 *
 * Corre en el scheduler interno de docker-compose (cada 15 minutos) y no en
 * GitHub Actions: detrás del túnel de Cloudflare una subida lenta chocaría con
 * el corte de 100 s.
 */
import { type NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { verifyCronSecret } from "@/lib/security/cron-auth"
import { withCronLock } from "@/lib/services/cron-lock"
import { drainGeneratedDocuments, expireUnrenderedSessionRows } from "@/lib/services/generated-documents/drain"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    logger.error("[cron/generated-documents-archive] CRON_SECRET is not configured")
    return NextResponse.json({ ok: false, outcome: "failed", code: "GENDOCS_CRON_FAILED" }, { status: 503 })
  }
  if (!verifyCronSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, outcome: "unauthorized", code: "GENDOCS_CRON_UNAUTHORIZED" }, { status: 401 })
  }
  try {
    const result = await withCronLock("generated-documents-archive", async () => {
      const expired = await expireUnrenderedSessionRows()
      const summary = await drainGeneratedDocuments({ limit: 50 })
      return { expired, ...summary }
    })
    if ("skipped" in result) {
      return NextResponse.json({ ok: true, outcome: "success", code: "GENDOCS_CRON_SUCCESS", skipped: true })
    }
    if (result.disabled) {
      return NextResponse.json({ ok: true, outcome: "disabled", code: "GENDOCS_CRON_DISABLED", expired: result.expired })
    }
    logger.info("[cron/generated-documents-archive] completed", result)
    // Un documento que no subió queda en la cola con su código y se ve en
    // Administración: no es una falla del cron.
    return NextResponse.json({ ok: true, outcome: "success", code: "GENDOCS_CRON_SUCCESS", ...result })
  } catch (error) {
    logger.error("[cron/generated-documents-archive] failed", error)
    return NextResponse.json({ ok: false, outcome: "failed", code: "GENDOCS_CRON_FAILED" }, { status: 503 })
  }
}
