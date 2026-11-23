import { NextRequest, NextResponse } from "next/server"
import type { Session } from "next-auth"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import {
  OnwayChallengeError,
  cancelOnwayChallenge,
  getOnwayChallengeStatus,
  readOnwayChallengeFrame,
  sendOnwayChallengeInput,
  type OnwayChallengeErrorCode,
} from "@/lib/integrations/onway/onway-client"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "cache-control": "no-store" }

const ERROR_STATUS: Record<OnwayChallengeErrorCode, number> = {
  ONWAY_CHALLENGE_BUSY: 409,
  ONWAY_CHALLENGE_ACTIVE: 409,
  ONWAY_CHALLENGE_NOT_FOUND: 404,
  ONWAY_CHALLENGE_FORBIDDEN: 403,
  ONWAY_CHALLENGE_EXPIRED: 410,
  ONWAY_CHALLENGE_CLOSED: 410,
  ONWAY_CHALLENGE_SOLVED: 409,
  ONWAY_CHALLENGE_FRAME_UNAVAILABLE: 503,
  ONWAY_CHALLENGE_INPUT_INVALID: 400,
}

/**
 * La apertura ya pasó por `requirePermission`. Aquí sólo se comprueba sesión y
 * permiso en cada frame —no la puerta de módulo, que consulta la base— porque
 * la vista pide imágenes cada 700 ms y la verificación dura minutos. El
 * `userId` del desafío se valida dentro del cliente: nadie puede mirar ni
 * tocar la vista de otra persona.
 */
async function sessionFor(): Promise<
  | { session: Session; error: null }
  | { session: null; error: NextResponse }
> {
  const session = await auth()
  if (!session) {
    return { session: null, error: NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE }) }
  }
  if (!can(session, "flota:manage_gps")) {
    return { session: null, error: NextResponse.json({ ok: false, code: "FORBIDDEN" }, { status: 403, headers: NO_STORE }) }
  }
  return { session, error: null }
}

function errorResponse(error: unknown, context: string) {
  if (error instanceof OnwayChallengeError) {
    logger.warn(`[flota/onway/verificacion/${context}]`, { code: error.code })
    return NextResponse.json(
      { ok: false, code: error.code },
      { status: ERROR_STATUS[error.code], headers: NO_STORE },
    )
  }
  logger.error(`[flota/onway/verificacion/${context}]`, { code: "UNKNOWN" })
  return NextResponse.json(
    { ok: false, code: "ONWAY_VERIFICATION_FAILED" },
    { status: 502, headers: NO_STORE },
  )
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await sessionFor()
  if (guard.error) return guard.error
  const { id } = await params

  if (request.nextUrl.searchParams.get("frame") === "1") {
    try {
      const frame = await readOnwayChallengeFrame(id, guard.session.user.id)
      return new NextResponse(new Uint8Array(frame), {
        headers: { "content-type": "image/jpeg", "cache-control": "no-store, max-age=0" },
      })
    } catch (error) {
      return errorResponse(error, "frame")
    }
  }

  try {
    const status = await getOnwayChallengeStatus(id, guard.session.user.id)
    return NextResponse.json({ ok: true, ...status }, { headers: NO_STORE })
  } catch (error) {
    return errorResponse(error, "status")
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await sessionFor()
  if (guard.error) return guard.error
  const { id } = await params
  const body = await request.json().catch(() => null) as unknown

  if (body && typeof body === "object" && !Array.isArray(body)
    && (body as Record<string, unknown>).action === "cancel") {
    try {
      const status = await cancelOnwayChallenge(id, guard.session.user.id)
      return NextResponse.json({ ok: true, ...status }, { headers: NO_STORE })
    } catch (error) {
      return errorResponse(error, "cancel")
    }
  }

  try {
    await sendOnwayChallengeInput(id, guard.session.user.id, body)
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  } catch (error) {
    return errorResponse(error, "input")
  }
}
