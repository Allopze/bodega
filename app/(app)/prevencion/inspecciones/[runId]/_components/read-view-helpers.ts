import { fieldKindIsScorable, isExcludedResult } from "@/lib/prevention/inspections"
import { draftKey, EMPTY_DRAFT, groupSectionItems } from "./run-view-helpers"
import type { AnswerInfo, Draft, ItemInfo, SectionInfo } from "./types"

/**
 * Cómo se reparte una sección en el modo lectura. Quien revisa busca lo que
 * necesita su atención —lo que no cumple, lo que quedó a medias, lo que se
 * registró como dato, lo que trae foto—; lo conforme es el fondo y se pliega
 * por sección. Puro y sin React: lo prueban las unitarias.
 */

export type ReadEvidence = AnswerInfo["evidence"]

export type ReadItemClass =
  | "non_conforming"
  | "partial"
  /** Un dato que se registró (N° de serie, fecha, relato): es el contenido, no un juicio. */
  | "recorded"
  /** Leído de la planilla y sin ratificar. */
  | "unconfirmed"
  /** Un resultado que esta pantalla no conoce: se muestra, no se esconde. */
  | "other"
  /** Conforme, pero con foto: lo que tiene foto se ve. */
  | "with_evidence"
  | "conforming"
  | "not_applicable"
  | "unanswered"

const FOLDED: ReadonlySet<ReadItemClass> = new Set(["conforming", "not_applicable", "unanswered"])

/** ¿Esta clase va en la lista principal (y no plegada)? */
export function needsAttention(cls: ReadItemClass): boolean {
  return !FOLDED.has(cls)
}

export function classifyReadItem(item: Pick<ItemInfo, "kind">, draft: Draft, evidenceCount: number): ReadItemClass {
  if (draft.needsConfirmation) return "unconfirmed"
  let cls: ReadItemClass
  if (!fieldKindIsScorable(item.kind)) {
    cls = draft.value.trim() !== "" ? "recorded" : "unanswered"
  } else if (draft.result === "") {
    cls = "unanswered"
  } else if (draft.result === "non_conforming") {
    cls = "non_conforming"
  } else if (draft.result === "partial") {
    cls = "partial"
  } else if (draft.result === "conforming") {
    cls = "conforming"
  } else if (isExcludedResult(draft.result)) {
    cls = "not_applicable"
  } else {
    cls = "other"
  }
  return evidenceCount > 0 && FOLDED.has(cls) ? "with_evidence" : cls
}

export interface ReadEntry {
  /** `sectionId::itemId`. */
  key: string
  item: ItemInfo
  draft: Draft
  cls: ReadItemClass
  evidence: ReadEvidence
  answerId: string | null
}

/** Un ítem suelto o una prenda de la matriz (sus celdas van juntas). */
export type ReadBlock =
  | { kind: "item"; entry: ReadEntry }
  | { kind: "matrix"; rowId: string; rowLabel: string; entries: ReadEntry[] }

export interface ReadFoldedCounts {
  conforming: number
  notApplicable: number
  unanswered: number
}

export interface ReadSectionView {
  attention: ReadBlock[]
  folded: ReadBlock[]
  counts: ReadFoldedCounts
  /** Cuántos ítems quedan plegados. */
  foldedCount: number
}

const NO_EVIDENCE: ReadEvidence = []

export function buildReadSection(
  section: Pick<SectionInfo, "id" | "items">,
  drafts: Readonly<Record<string, Draft>>,
  evidenceOf: (key: string) => ReadEvidence | undefined,
  answerIdOf: (key: string) => string | null | undefined,
): ReadSectionView {
  const entryOf = (item: ItemInfo): ReadEntry => {
    const key = draftKey(section.id, item.id)
    const draft = drafts[key] ?? EMPTY_DRAFT
    const evidence = evidenceOf(key) ?? NO_EVIDENCE
    return { key, item, draft, cls: classifyReadItem(item, draft, evidence.length), evidence, answerId: answerIdOf(key) ?? null }
  }

  const attention: ReadBlock[] = []
  const folded: ReadBlock[] = []
  const counts: ReadFoldedCounts = { conforming: 0, notApplicable: 0, unanswered: 0 }
  let foldedCount = 0

  for (const block of groupSectionItems(section.items)) {
    const entries = block.kind === "item" ? [entryOf(block.item)] : block.items.map(entryOf)
    const read: ReadBlock = block.kind === "item"
      ? { kind: "item", entry: entries[0]! }
      : { kind: "matrix", rowId: block.rowId, rowLabel: block.rowLabel, entries }
    if (entries.some((entry) => needsAttention(entry.cls))) {
      attention.push(read)
      continue
    }
    folded.push(read)
    for (const entry of entries) {
      foldedCount += 1
      if (entry.cls === "conforming") counts.conforming += 1
      else if (entry.cls === "not_applicable") counts.notApplicable += 1
      else counts.unanswered += 1
    }
  }
  return { attention, folded, counts, foldedCount }
}

/**
 * «Extintores · 12 conformes», «Extintores · 10 conformes, 2 no aplican» o
 * «Extintores · 3 sin responder»: lo que dice el rótulo del pliegue.
 */
export function foldedSectionLabel(title: string, counts: ReadFoldedCounts): string {
  const parts: string[] = []
  if (counts.conforming > 0) parts.push(`${counts.conforming} ${counts.conforming === 1 ? "conforme" : "conformes"}`)
  if (counts.notApplicable > 0) parts.push(`${counts.notApplicable} ${counts.notApplicable === 1 ? "no aplica" : "no aplican"}`)
  if (counts.unanswered > 0) parts.push(`${counts.unanswered} sin responder`)
  return `${title} · ${parts.join(", ")}`
}

/** ¿Hay una sola respuesta en toda la inspección? Una cancelada o sin ejecutar no la tiene. */
export function hasAnyAnswer(
  sections: readonly Pick<SectionInfo, "id" | "items">[],
  drafts: Readonly<Record<string, Pick<Draft, "result" | "value">>>,
): boolean {
  return sections.some((section) => section.items.some((item) => {
    const draft = drafts[draftKey(section.id, item.id)]
    return !!draft && (draft.result !== "" || draft.value.trim() !== "")
  }))
}
