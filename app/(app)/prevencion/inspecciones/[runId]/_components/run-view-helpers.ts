import {
  ANSWER_COMMENT_MIN_LENGTH,
  type CompletionBlocker,
} from "@/lib/prevention/inspections"
import type { HeldRow } from "@/lib/prevention/inspection-capture"
import type { Draft, ItemInfo } from "./types"

/** Clave de un ítem en el borrador y en los índices de la pantalla. */
export function draftKey(sectionId: string, itemId: string) {
  return `${sectionId}::${itemId}`
}

/** Lo que muestra un ítem al que todavía no se le escribió nada. */
export const EMPTY_DRAFT: Draft = { result: "", comment: "", value: "", needsConfirmation: false }

/**
 * Los resultados que exigen explicar el motivo por escrito: «No aplica» saca el
 * ítem del denominador, «Regular» puntúa 0,5 y «No cumple» genera el hallazgo.
 * Es la misma regla que `validateAnswerRow` y `assessRunCompletion`.
 */
export function resultNeedsReason(result: string): boolean {
  return result === "not_applicable" || result === "partial" || result === "non_conforming"
}

/** ¿El ítem exige un motivo y todavía no lo tiene (o es más corto que el mínimo)? */
export function reasonIsMissing(draft: { result: string; comment: string }): boolean {
  return resultNeedsReason(draft.result) && draft.comment.trim().length < ANSWER_COMMENT_MIN_LENGTH
}

/**
 * Acomodo de los ítems de una sección para la captura: un ítem suelto o una
 * prenda de la matriz (varios ítems con el mismo `matrix.rowId`). El EPP es una
 * matriz prenda × {usa, estado}; pintar cada celda como un ítem aparte duplicaba
 * la prenda y alargaba la ficha a ~12.000 px.
 */
export type ItemBlock =
  | { kind: "item"; item: ItemInfo }
  | { kind: "matrix"; rowId: string; rowLabel: string; items: ItemInfo[] }

/** Agrupa por `matrix.rowId` en el orden de la primera aparición; lo demás queda como viene. */
export function groupSectionItems(items: readonly ItemInfo[]): ItemBlock[] {
  const blocks: ItemBlock[] = []
  const matrixBlocks = new Map<string, Extract<ItemBlock, { kind: "matrix" }>>()
  for (const item of items) {
    if (!item.matrix) {
      blocks.push({ kind: "item", item })
      continue
    }
    const existing = matrixBlocks.get(item.matrix.rowId)
    if (existing) {
      existing.items.push(item)
      continue
    }
    const block: Extract<ItemBlock, { kind: "matrix" }> = {
      kind: "matrix",
      rowId: item.matrix.rowId,
      rowLabel: item.matrix.rowLabel,
      items: [item],
    }
    matrixBlocks.set(item.matrix.rowId, block)
    blocks.push(block)
  }
  return blocks
}

/** «Usa (Sí/No/N/A)» → «Usa»: las opciones ya dicen Sí/No/N/A, repetirlas en el rótulo sólo ocupa lugar. */
export function matrixColumnShortLabel(columnLabel: string): string {
  return columnLabel.replace(/\s*\([^)]*\)\s*$/, "").trim() || columnLabel
}

/* ── Qué falta para declarar ejecutada ──────────────────────────────────────
 * El resumen del progreso agrupa lo que impide cerrar por naturaleza, para que
 * cada parte lleve al primer ítem que corresponde. Las filas retenidas (las que
 * el servidor todavía no tiene) entran con su propia clase: «sin motivo» si es
 * eso lo que les falta y «por corregir» si es otra cosa (un número mal escrito,
 * fotos que quitar).
 */

export type ProgressGapKind = "unanswered" | "no_reason" | "unconfirmed" | "to_fix" | "closing_act"

export interface ProgressGap {
  kind: ProgressGapKind
  /** `sectionId::itemId`; `null` sólo en el acta de cierre, que no cuelga de un ítem. */
  key: string | null
  /** Qué ítem es (o, en el acta y en las filas retenidas, el mensaje completo). */
  text: string
}

export const PROGRESS_GAP_ORDER: readonly ProgressGapKind[] = ["unanswered", "no_reason", "unconfirmed", "to_fix", "closing_act"]

const BLOCKER_GAP_KIND: Record<CompletionBlocker["kind"], ProgressGapKind> = {
  missing_required: "unanswered",
  missing_na_reason: "no_reason",
  missing_partial_reason: "no_reason",
  missing_nc_reason: "no_reason",
  unconfirmed_critical: "unconfirmed",
  missing_closing_act: "closing_act",
}

/**
 * Lo que falta, ordenado como están los ítems en la inspección (el acta al
 * final). No repite un ítem: una fila retenida ya trae su problema, así que el
 * impedimento del cierre de esa misma fila no se cuenta dos veces.
 */
export function collectProgressGaps(args: {
  blockers: readonly CompletionBlocker[]
  held: readonly HeldRow[]
  /** Claves en el orden de la inspección. */
  itemKeys: readonly string[]
  drafts: Readonly<Record<string, Pick<Draft, "result" | "comment">>>
}): ProgressGap[] {
  const gaps: ProgressGap[] = []
  const seen = new Set<string>()
  for (const row of args.held) {
    seen.add(row.key)
    const draft = args.drafts[row.key]
    gaps.push({
      kind: row.reason === "invalid" && draft && reasonIsMissing(draft) ? "no_reason" : "to_fix",
      key: row.key,
      text: row.problem,
    })
  }
  for (const blocker of args.blockers) {
    const key = blocker.sectionId && blocker.itemId ? draftKey(blocker.sectionId, blocker.itemId) : null
    if (key) {
      if (seen.has(key)) continue
      seen.add(key)
    }
    gaps.push({ kind: BLOCKER_GAP_KIND[blocker.kind], key, text: blocker.detail })
  }
  const order = new Map(args.itemKeys.map((key, index) => [key, index]))
  const position = (gap: ProgressGap) => (gap.key === null ? Number.MAX_SAFE_INTEGER : order.get(gap.key) ?? Number.MAX_SAFE_INTEGER - 1)
  return gaps.sort((a, b) => position(a) - position(b))
}

export interface ProgressGapGroup {
  kind: ProgressGapKind
  count: number
  /** El primero de su clase, en el orden de la inspección; `null` en el acta. */
  firstKey: string | null
  label: string
}

const GAP_GROUP_LABEL: Record<ProgressGapKind, (count: number) => string> = {
  unanswered: (count) => `${count} sin responder`,
  no_reason: (count) => `${count} sin motivo`,
  unconfirmed: (count) => `${count} por confirmar`,
  to_fix: (count) => `${count} por corregir`,
  closing_act: () => "acta incompleta",
}

/** «3 sin responder · 1 sin motivo · 1 por confirmar · acta incompleta», como grupos con su primer ítem. */
export function groupProgressGaps(gaps: readonly ProgressGap[]): ProgressGapGroup[] {
  const groups: ProgressGapGroup[] = []
  for (const kind of PROGRESS_GAP_ORDER) {
    const ofKind = gaps.filter((gap) => gap.kind === kind)
    if (ofKind.length === 0) continue
    groups.push({
      kind,
      count: ofKind.length,
      firstKey: ofKind.find((gap) => gap.key !== null)?.key ?? null,
      label: GAP_GROUP_LABEL[kind](ofKind.length),
    })
  }
  return groups
}

/** Lo que se agrega tras el nombre del ítem en la lista del progreso. */
export const PROGRESS_GAP_SUFFIX: Record<ProgressGapKind, string> = {
  unanswered: "sin responder",
  no_reason: "falta el motivo",
  unconfirmed: "por confirmar contra la foto",
  to_fix: "",
  closing_act: "",
}

/* ── Acciones del registro ─────────────────────────────────────────────────
 * Acta PDF, reabrir y cancelar son del registro y no de la captura: viven en
 * el encabezado de la página en los dos modos. Sin `"use client"` a propósito:
 * `page.tsx` (servidor) decide con esto si pinta el componente.
 */

export interface RecordActionsAvailability {
  pdf: boolean
  reopen: boolean
  cancel: boolean
}

export function recordActionsAvailability(
  status: string,
  permissions: { canReview: boolean; canManage: boolean },
): RecordActionsAvailability {
  const closed = status === "completed" || status === "reviewed"
  return {
    // Función #3: el acta de LA inspección. El Excel es agregado y en fiscalización se pide ésta.
    pdf: closed,
    // A-05: rectificar una ejecución declarada por error.
    reopen: permissions.canReview && closed,
    // A-04: cancelar una que ya no corresponde.
    cancel: permissions.canManage && ["planned", "in_progress", "completed"].includes(status),
  }
}

/* ── Saltar a un ítem ───────────────────────────────────────────────────────
 * El ítem de la captura es un solo árbol (`item-…`). La vista de lectura
 * todavía pinta tarjeta y tabla a la vez —una oculta por CSS—, así que se
 * prueban también sus ids y se usa `offsetParent` (null si el elemento o un
 * ancestro tiene `display:none`) para devolver el que esté pintado (I-06).
 */
function visibleItemElement(key: string): HTMLElement | null {
  for (const prefix of ["item-", "item-mobile-", "item-desktop-"]) {
    const el = document.getElementById(`${prefix}${key}`)
    if (el && el.offsetParent !== null) return el
  }
  return null
}

/**
 * Salta al ítem y enfoca su primer control, para dejar a la persona lista para
 * responder. Con `focus: "comment"` enfoca el comentario (lo que falta cuando
 * el resultado exige motivo), si está a la vista.
 */
export function jumpToItem(key: string, focus?: "comment") {
  const el = visibleItemElement(key)
  if (!el) return
  el.scrollIntoView({ behavior: "smooth", block: "center" })
  const comment = focus === "comment" ? el.querySelector<HTMLElement>("[data-item-comment]") : null
  const target = comment && comment.offsetParent !== null
    ? comment
    : el.querySelector<HTMLElement>("button, select, input, textarea, [tabindex]")
  target?.focus({ preventScroll: true })
}

/** Salta al acta de cierre (no cuelga de un ítem). */
export function jumpToClosingAct() {
  const el = document.getElementById("acta-cierre")
  if (!el) return
  el.scrollIntoView({ behavior: "smooth", block: "start" })
  el.querySelector<HTMLElement>("button, select, input, textarea")?.focus({ preventScroll: true })
}

/* ── Avance por sección ─────────────────────────────────────────────────── */

export interface SectionProgress {
  answered: number
  total: number
}

/** Cuántos ítems de cada sección tienen respuesta en el borrador: «3 de 12». */
export function sectionProgressById(
  sections: readonly { id: string; items: readonly { id: string }[] }[],
  drafts: Readonly<Record<string, Pick<Draft, "result">>>,
): Record<string, SectionProgress> {
  const progress: Record<string, SectionProgress> = {}
  for (const section of sections) {
    progress[section.id] = {
      answered: section.items.filter((item) => drafts[draftKey(section.id, item.id)]?.result).length,
      total: section.items.length,
    }
  }
  return progress
}
