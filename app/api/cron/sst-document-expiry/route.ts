/**
 * GET /api/cron/sst-document-expiry
 *
 * Endpoint protegido por CRON_SECRET: vence documentos SST cuya expiresAt
 * ya pasó y notifica vencimientos próximos (30/15/7 días).
 * Llamar diariamente via cron externo:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yourdomain/api/cron/sst-document-expiry
 */

import { type NextRequest, NextResponse } from 'next/server'
import { expireOverdueDocuments, notifyExpiringDocuments } from '@/lib/services/prevention-documents-library'
import { logger } from '@/lib/logger'
import { verifyCronSecret } from '@/lib/security/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')

  if (!secret) {
    logger.error('[cron/sst-document-expiry] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'Cron secret not configured' }, { status: 500 })
  }

  if (!verifyCronSecret(authHeader, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const expired = await expireOverdueDocuments()
    const notified = await notifyExpiringDocuments()
    logger.info('[cron/sst-document-expiry] Completed', { ...expired, ...notified })
    return NextResponse.json({ ok: true, ...expired, ...notified })
  } catch (err) {
    logger.error('[cron/sst-document-expiry] Fatal error', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
