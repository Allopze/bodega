"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { parseZ } from "@/lib/actions/parse-z"
import { guardAnyPermission } from "@/lib/auth/can"
import { decidePartsNoteLinesInBulk, type BulkLineDecision, type BulkLinesResult } from "@/lib/services/mantencion/parts-notes/bulk-lines"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import type { Permission } from "@/modules/permissions"

/**
 * Decisiones por línea en lote desde la bandeja de notas de pedido (ADR 0001, D33). Revalida `mant:np:manage` en el
 * servidor y valida la entrada con Zod (máx. 200 líneas, y el motivo del rechazo); el servicio agrupa por nota, vuelve a
 * mirar permiso y faena nota por nota y no deja que una falla tumbe a las demás.
 */

const PATH = "/mantencion/notas-pedido"
const MANAGE: Permission[] = ["mant:np:manage"]
const MAX_LINES = 200
const REASON_MIN = 5
const SHOWN_FAILURES = 3

const lineId = z.string().trim().min(1).max(64).regex(/^[\w-]+$/, "Identificador inválido.")

const bulkSchema = z.object({
  lineIds: z.array(lineId).min(1, "Elige al menos una línea.").max(MAX_LINES, `Elige como máximo ${MAX_LINES} líneas por vez.`),
  decision: z.enum(["comprar", "bodega", "rechazar"]),
  reason: z.string().trim().max(1000).optional(),
}).superRefine((value, ctx) => {
  if (value.decision === "rechazar" && (value.reason?.length ?? 0) < REASON_MIN) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: `Escribe un motivo de al menos ${REASON_MIN} caracteres.` })
  }
})

export interface BulkLinesActionState {
  ok: boolean
  message: string
  fieldErrors?: Record<string, string[]>
  result?: BulkLinesResult
}

const lineWord = (count: number) => (count === 1 ? "1 línea" : `${count} líneas`)

/** Participio de lo hecho, en singular y plural. */
const DONE: Record<BulkLineDecision, readonly [string, string]> = {
  comprar: ["enviada a compra", "enviadas a compra"],
  bodega: ["sacada de bodega", "sacadas de bodega"],
  rechazar: ["rechazada", "rechazadas"],
}

/** Lo que pasó, en una frase: cuántas salieron, qué solicitudes esperan algo, y por qué fallaron las otras notas. */
function summarize(decision: BulkLineDecision, result: BulkLinesResult): string {
  const parts: string[] = []
  if (result.ok > 0) {
    const codes = result.requests.map((request) => request.code).join(", ")
    parts.push(`${lineWord(result.ok)} ${DONE[decision][result.ok === 1 ? 0 : 1]}${codes ? ` (${codes})` : ""}.`)
  }
  const waiting = result.requests.filter((request) => !request.approved).map((request) => request.code)
  if (waiting.length > 0) parts.push(`${waiting.join(", ")} ${waiting.length === 1 ? "espera" : "esperan"} cotizaciones o su aprobación.`)
  if (result.failed.length > 0) {
    const shown = result.failed.slice(0, SHOWN_FAILURES).map((failure) => `${failure.noteCode}: ${failure.message}`).join(" · ")
    const rest = result.failed.length - SHOWN_FAILURES
    parts.push(`${result.failed.length === 1 ? "1 nota no se pudo" : `${result.failed.length} notas no se pudieron`}: ${shown}${rest > 0 ? ` · y ${rest} más` : ""}`)
  }
  return parts.join(" ")
}

/** Refresca la bandeja, los detalles, las OT, el Panel, Compras y los avisos del menú (cualquier nota del lote pudo cambiar). */
function refresh() {
  revalidateOperationalViews([PATH, "/mantencion/panel", "/compras", "/compras/nueva", "/solicitudes"])
  revalidatePath(`${PATH}/[id]`, "page")
  revalidatePath("/mantencion/ot/[id]", "page")
}

/**
 * `ok` es verdadero si salió al menos una línea (la pantalla se refresca igual); el `message` dice siempre lo que quedó sin
 * hacer. Con ninguna línea decidida es `ok: false` y el mensaje trae los motivos.
 */
export async function decideLinesInBulkAction(input: {
  lineIds: string[]
  decision: BulkLineDecision
  reason?: string
}): Promise<BulkLinesActionState> {
  const guard = await guardAnyPermission(MANAGE, PATH)
  if (guard.error) return guard.error
  const parsed = parseZ(bulkSchema, input)
  if (!parsed.ok) return { ...parsed, message: parsed.fieldErrors.lineIds?.[0] ?? parsed.fieldErrors.reason?.[0] ?? parsed.message }
  try {
    const result = await decidePartsNoteLinesInBulk(guard.session, parsed.data)
    refresh()
    return { ok: result.ok > 0, message: summarize(parsed.data.decision, result) || "No se decidió ninguna línea.", result }
  } catch (error) {
    return actionErrorResult(error, "No se pudieron decidir las líneas.")
  }
}
