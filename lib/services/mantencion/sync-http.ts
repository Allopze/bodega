import type { ZodError } from "zod"

/**
 * Piezas HTTP comunes de los handlers `/api/mantencion/sync/*`. Los handlers
 * quedan delgados: autenticar, leer y validar el cuerpo, llamar al servicio y
 * serializar su resultado. Todas las respuestas llevan la forma `{ ok, code,
 * message, field? }` que la app ya sabe interpretar (`SyncRecordResponse`).
 */

export const NO_STORE = { "Cache-Control": "no-store" } as const

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

/** 422: el envío no cumple el contrato. Definitivo: la app lo deja «Rechazado» con este mensaje. */
export function invalidResponse(message: string, field?: string): Response {
  return jsonResponse({ ok: false, code: "invalid", message, ...(field ? { field } : {}) }, 422)
}

export function issueResponse(error: ZodError): Response {
  const issue = error.issues[0]
  return invalidResponse(issue?.message ?? "Los datos enviados no son válidos.", issue?.path.join(".") || undefined)
}

export async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await request.json() }
  } catch {
    return { ok: false, response: invalidResponse("El cuerpo del envío no es JSON válido.") }
  }
}
