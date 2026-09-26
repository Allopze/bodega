/**
 * GET /api/cron/sst-weekly-alerts
 *
 * Endpoint protegido por CRON_SECRET para ejecutar el job de alertas
 * de evaluaciones semanales vencidas del conductor líder.
 *
 * Llamar diariamente via cron externo (vercel cron, GitHub Actions, etc.):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yourdomain/api/cron/sst-weekly-alerts
 */

import { type NextRequest, NextResponse } from 'next/server'
import { checkOverdueWeeklyAlerts } from '@/lib/services/sst-alerts'
import { logger } from '@/lib/logger'
import { verifyCronSecret } from '@/lib/security/cron-auth'
import { withCronLock } from '@/lib/services/cron-lock'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Techo explícito: estos jobs recorren tablas que crecen y sin cota un
// corte por timeout de plataforma deja estado parcial sin señal accionable.
export const maxDuration = 300

// `outcome` y `code` son el contrato de `scripts/cron-runner.mjs` (PREV-C04):
// sin ellos el runner daba por rota cada corrida aunque el trabajo se hiciera.
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Validate CRON_SECRET to prevent unauthorized invocations
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')

  if (!secret) {
    logger.error('[cron/sst-weekly-alerts] CRON_SECRET is not configured')
    return NextResponse.json({ ok: false, outcome: 'failed', code: 'SST_CRON_CONFIGURATION', error: 'Cron secret not configured' }, { status: 500 })
  }

  if (!verifyCronSecret(authHeader, secret)) {
    return NextResponse.json({ ok: false, outcome: 'unauthorized', code: 'SST_CRON_UNAUTHORIZED', error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await withCronLock("sst-weekly-alerts", () => checkOverdueWeeklyAlerts())
    if ('skipped' in result && result.skipped === true) return NextResponse.json({ ok: true, outcome: 'skipped', code: 'SST_CRON_SKIPPED', reason: result.reason })
    logger.info('[cron/sst-weekly-alerts] Completed', result)
    return NextResponse.json({ ok: true, outcome: 'success', code: 'SST_CRON_SUCCESS', ...result })
  } catch (err) {
    // H-B11: en producción no se expone `err.message` al cliente porque puede
    // filtrar paths internos y fragmentos de SQL. Mismo criterio que los otros
    // siete crons; éste era el único que quedaba sin el gate.
    logger.error('[cron/sst-weekly-alerts] Fatal error', err)
    const isProd = process.env.NODE_ENV === 'production'
    return NextResponse.json(
      { ok: false, outcome: 'failed', code: 'SST_CRON_FAILED', error: isProd ? 'Internal cron error' : (err instanceof Error ? err.message : 'Unknown error') },
      { status: 503 }
    )
  }
}
