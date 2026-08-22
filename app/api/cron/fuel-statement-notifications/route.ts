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
import { fuelCronContractFor } from '@/lib/combustibles/fuel-cron-contract'
import { logger } from '@/lib/logger'
import { verifyCronSecret } from '@/lib/security/cron-auth'
import { withCronLock } from '@/lib/services/cron-lock'
import { isRouteOperational } from '@/lib/services/module-toggles'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')

  if (!secret) {
    logger.error('[cron/fuel-statement-notifications] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'Cron secret not configured' }, { status: 500 })
  }

  if (!verifyCronSecret(authHeader, secret)) {
    return respond(fuelCronContractFor({ unauthorized: true }))
  }
  if (!await isRouteOperational('/combustibles/cuenta-corriente')) {
    return respond(fuelCronContractFor({ disabled: true }))
  }

  try {
    const outcome = await withCronLock('fuel-statement-notifications', () => checkFuelStatementNotifications())
    if (outcome && typeof outcome === 'object' && 'skipped' in outcome) {
      logger.warn('[cron/fuel-statement-notifications] Skipped: otra corrida en curso')
      return respond(fuelCronContractFor({ conflict: true }))
    }
    logger.info('[cron/fuel-statement-notifications] Completed')
    return respond(fuelCronContractFor({ failed: 0, total: 1 }))
  } catch (err) {
    logger.error('[cron/fuel-statement-notifications] Fatal error', err)
    return respond(fuelCronContractFor({ failed: 1, total: 1 }), { error: err instanceof Error ? err.message : 'Unknown error' })
  }
}

function respond(contract: ReturnType<typeof fuelCronContractFor>, extra?: Record<string, unknown>) {
  return NextResponse.json({
    ok: contract.ok,
    outcome: contract.outcome,
    code: contract.code,
    health: contract.health,
    ...extra,
  }, { status: contract.httpStatus })
}
