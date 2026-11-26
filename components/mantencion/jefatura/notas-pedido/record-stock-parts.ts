import type { FlowDraft, FlowJob, FlowPart } from "@/lib/mantencion/client/flow-types"
import { partsFilled } from "@/lib/mantencion/client/flow-validate"
import type { SyncCorrectivePart, SyncRecord } from "@/lib/mantencion/contracts"
import type { WorkOrderAvailablePart } from "@/lib/services/mantencion/parts/types"
import { parseQty, qtyInputText } from "./parts-notes-format"

/**
 * Repuestos reservados para la OT en el registro web (ADR mantención 0001): una línea de repuesto puede venir de
 * la bodega de la faena (`source: "stock"`, con `productId` y la reserva `allocationId` que eligió el mecánico) o
 * ser el texto libre de siempre. La línea de bodega no se rechaza por falta de stock: el servidor la concilia.
 *
 * `StockFlowPart` es `FlowPart` con esos tres campos. En el flujo de la app (`flow-types.ts`) `FlowPart` ya los
 * lleva; aquí se declara por intersección para no depender del orden de integración, y es idéntico al tipo real.
 */
export type StockFlowPart = FlowPart & {
  source?: "stock" | "externo"
  productId?: string | null
  allocationId?: string | null
}

type StockLine = StockFlowPart & { source: "stock"; allocationId: string; productId: string }

export function isStockPart(part: FlowPart): part is StockLine {
  const candidate = part as StockFlowPart
  return candidate.source === "stock" && !!candidate.productId && !!candidate.allocationId
}

const blank = (part: FlowPart) => !part.description.trim() && !(part as StockFlowPart).source

/** Cuánto lleva tomado cada reserva entre todas las líneas de bodega de los trabajos (id de reserva → cantidad). */
export function stockUsedByAllocation(jobs: readonly FlowJob[]): Record<string, number> {
  const used: Record<string, number> = {}
  for (const job of jobs) {
    if (job.noParts) continue
    for (const part of job.parts) {
      if (isStockPart(part)) used[part.allocationId] = (used[part.allocationId] ?? 0) + parseQty(part.quantity)
    }
  }
  return used
}

/** Lo que aún se puede tomar de cada reserva: lo reservado menos lo que ya tienen las líneas. */
export function leftByAllocation(available: readonly WorkOrderAvailablePart[], jobs: readonly FlowJob[]): Record<string, number> {
  const used = stockUsedByAllocation(jobs)
  return Object.fromEntries(available.map((part) => [part.allocationId, Math.max(0, Math.round((part.remaining - (used[part.allocationId] ?? 0)) * 100) / 100)]))
}

/**
 * Un clic en el chip de un repuesto reservado: si el trabajo ya tiene una línea de esa reserva, le suma 1 (sin pasar
 * de lo disponible); si no, agrega la línea con cantidad 1 —o lo que quede, si es menos— y reemplaza la línea en
 * blanco que el trabajo trae de partida. Un trabajo con «No se usaron repuestos» marcado deja de tenerlo.
 */
export function addStockPart(job: FlowJob, part: WorkOrderAvailablePart, left: number): FlowJob {
  if (left <= 0) return job
  const existing = job.parts.findIndex((candidate) => isStockPart(candidate) && candidate.allocationId === part.allocationId)
  if (existing >= 0) {
    const current = job.parts[existing]!
    const next = parseQty(current.quantity) + Math.min(1, left)
    return { ...job, noParts: false, parts: job.parts.map((candidate, index) => (index === existing ? { ...candidate, quantity: qtyInputText(next) } : candidate)) }
  }
  const line: StockFlowPart = {
    quantity: qtyInputText(Math.min(1, left)),
    description: part.name,
    source: "stock",
    productId: part.productId,
    allocationId: part.allocationId,
  }
  const at = job.parts.findIndex(blank)
  const parts = at >= 0 ? job.parts.map((candidate, index) => (index === at ? line : candidate)) : [...job.parts, line]
  return { ...job, noParts: false, parts }
}

/**
 * La cantidad que escribió el mecánico en una línea de bodega, acotada a lo disponible de su reserva (el texto que
 * aún no es un número, como «1,», se respeta). Una unidad entera (`wholeOnly`) no admite decimales.
 */
export function capStockQuantity(text: string, options: { max: number; wholeOnly: boolean }): string {
  const value = parseQty(text)
  if (value <= 0) return text
  const whole = options.wholeOnly ? Math.floor(value) : value
  if (whole > options.max) return qtyInputText(options.wholeOnly ? Math.floor(options.max) : options.max)
  return whole === value ? text : qtyInputText(whole)
}

/** El tope de una línea de bodega: lo reservado menos lo que tomaron las demás líneas de la misma reserva. */
export function stockLineMax(jobs: readonly FlowJob[], part: WorkOrderAvailablePart, own: FlowPart): number {
  const used = stockUsedByAllocation(jobs)
  const others = (used[part.allocationId] ?? 0) - parseQty(own.quantity)
  return Math.max(0, Math.round((part.remaining - others) * 100) / 100)
}

/**
 * Pasa al registro que se envía los campos de bodega de cada línea (`source`, `productId`, `allocationId`). El flujo
 * ya los conserva al armar el registro (`buildRecord`); esto sólo completa lo que falte, así que si la línea ya los
 * trae no cambia nada. Las líneas de texto libre viajan igual que siempre.
 */
export function withStockFields(payload: SyncRecord, draft: Pick<FlowDraft, "jobs">): SyncRecord {
  if (payload.kind !== "C") return payload
  return {
    ...payload,
    jobs: payload.jobs.map((job, jobIndex) => {
      const source = draft.jobs[jobIndex]
      if (!source || source.noParts) return job
      const filled = partsFilled(source)
      return {
        ...job,
        parts: job.parts.map((part, index): SyncCorrectivePart => {
          const line = filled[index]
          if (!line || !isStockPart(line)) return part
          return { ...part, source: part.source ?? "stock", productId: part.productId ?? line.productId, allocationId: part.allocationId ?? line.allocationId }
        }),
      }
    }),
  }
}
