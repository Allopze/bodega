/**
 * GET /api/cron/fuel-statement-notifications
 *
 * Endpoint protegido por CRON_SECRET para verificar cuentas corrientes de
 * combustible vencidas / por vencer y cargas sin asignar, y notificar.
 *
 * Antes esto se disparaba en cada render de /combustibles (efecto secundario en
 * un GET). Ahora se ejecuta como job. Llamar diariamente vía cron externo:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yourdomain/api/cron/fuel-statement-notifications
 */

import { type NextRequest, NextResponse } from 'next/server'
import { checkFuelStatementNotifications } from '@/lib/combustibles/notifications'
import { logger } from '@/lib/logger'
import { verifyCronSecret } from '@/lib/security/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')

  if (!secret) {
    logger.error('[cron/fuel-statement-notifications] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'Cron secret not configured' }, { status: 500 })
  }

  if (!verifyCronSecret(authHeader, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await checkFuelStatementNotifications()
    logger.info('[cron/fuel-statement-notifications] Completed')
    return NextResponse.json({ ok: true })
  } catch (err) {
    logger.error('[cron/fuel-statement-notifications] Fatal error', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
