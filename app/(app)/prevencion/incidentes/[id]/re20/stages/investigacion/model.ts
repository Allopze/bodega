import {
  deriveRe20RootCauses,
  deriveRe20Trajectories,
  re20CausalGraphCompletenessIssues,
} from "@/lib/prevention/incidents"
import type { Re20Data } from "../../types"

/* Lógica pura del árbol de causas (RE-20-05): construcción guiada, tipo de
 * relación derivado de la topología, distribución del diagrama y textos humanos.
 * Sin React: lo prueba `model.test.ts`. */

export type Re20Tree = Re20Data["causalTree"]
export type Re20Event = Re20Tree["events"][number]
export type Re20Relation = Re20Tree["relations"][number]
export type Re20RelationType = Re20Relation["type"]

/** ÁRBOL DE CAUSAS!B9: H1 es el hecho final. */
export const FINAL_EVENT_ID = "H1"
/** ÁRBOL DE CAUSAS!B11:B30 — el formato admite H1…H20. */
export const MAX_EVENTS = 20

/** B9, literal. */
export const VALID_FACT_HELP = "Un hecho válido es breve, verificable y afirmativo, y cada frase contiene un solo hecho. Ejemplo adecuado: «El resguardo fijo de la transmisión estaba retirado». Ejemplo inadecuado: «El trabajador actuó irresponsablemente»."

/** B44, por tipo. */
export const RELATION_LABELS: Record<Re20RelationType, string> = { chain: "Cadena", conjunction: "Conjunción", independent: "Independiente" }
export const RELATION_EXPLANATIONS: Record<Re20RelationType, string> = {
  chain: "Un hecho tiene un único antecedente.",
  conjunction: "Dos o más hechos debieron concurrir para producir el mismo hecho.",
  independent: "Un mismo hecho origina dos o más consecuencias.",
}

/* ── Grafo ───────────────────────────────────────────────────────────────── */

export interface CausalIndex {
  ids: Set<string>
  /** Antecedentes de cada hecho. */
  into: Map<string, string[]>
  /** Consecuencias de cada hecho. */
  out: Map<string, string[]>
}

/** Índice sobre las relaciones cuyos dos extremos existen (las dañadas ya las rechaza el servidor). */
export function causalIndex(tree: Re20Tree): CausalIndex {
  const ids = new Set(tree.events.map((event) => event.id))
  const into = new Map<string, string[]>()
  const out = new Map<string, string[]>()
  for (const id of ids) { into.set(id, []); out.set(id, []) }
  for (const relation of tree.relations) {
    if (!ids.has(relation.from) || !ids.has(relation.to) || relation.from === relation.to) continue
    into.get(relation.to)?.push(relation.from)
    out.get(relation.from)?.push(relation.to)
  }
  return { ids, into, out }
}

/**
 * El tipo NO se elige: sale de la forma del grafo. Si la consecuencia tiene dos o
 * más antecedentes concurren (conjunción); si no, y el antecedente origina dos o
 * más consecuencias, son independientes; si no, es una cadena. Siempre cumple lo
 * que el servidor exige (`re20CausalGraphCompletenessIssues`).
 */
export function derivedRelationType(index: Pick<CausalIndex, "into" | "out">, from: string, to: string): Re20RelationType {
  if ((index.into.get(to)?.length ?? 0) >= 2) return "conjunction"
  if ((index.out.get(from)?.length ?? 0) >= 2) return "independent"
  return "chain"
}

/** Vuelve a calcular el tipo de todas las relaciones; se llama tras cada cambio de estructura. */
export function withDerivedTypes(tree: Re20Tree): Re20Tree {
  const index = causalIndex(tree)
  return { ...tree, relations: tree.relations.map((relation) => ({ ...relation, type: derivedRelationType(index, relation.from, relation.to) })) }
}

export function nextEventId(events: ReadonlyArray<Pick<Re20Event, "id">>): string | null {
  const used = new Set(events.map((event) => event.id))
  for (let n = 2; n <= MAX_EVENTS; n++) if (!used.has(`H${n}`)) return `H${n}`
  return null
}

/** `true` si agregar la relación `from → to` cerraría un ciclo (ya se llega de `to` a `from`). */
export function wouldCreateCycle(tree: Re20Tree, from: string, to: string): boolean {
  if (from === to) return true
  const { out } = causalIndex(tree)
  const seen = new Set<string>()
  const stack = [to]
  while (stack.length) {
    const id = stack.pop() as string
    if (id === from) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(out.get(id) ?? []))
  }
  return false
}

const hasRelation = (tree: Re20Tree, from: string, to: string) => tree.relations.some((relation) => relation.from === from && relation.to === to)

export function createFinalEvent(tree: Re20Tree, description: string): Re20Tree {
  if (tree.events.some((event) => event.id === FINAL_EVENT_ID)) return tree
  const event: Re20Event = { id: FINAL_EVENT_ID, description: description.trim(), verified: false, source: null, causal: true, requiresVerification: false }
  return withDerivedTypes({ ...tree, events: [event, ...tree.events] })
}

/** Crea el hecho antecedente y su relación con `toId` en un solo paso. */
export function addAntecedent(tree: Re20Tree, toId: string, input: { description: string; justification?: string; source?: string }): { tree: Re20Tree; id: string | null } {
  const id = nextEventId(tree.events)
  if (!id || !tree.events.some((event) => event.id === toId)) return { tree, id: null }
  const source = input.source?.trim() || null
  const event: Re20Event = { id, description: input.description.trim(), verified: false, source, causal: true, requiresVerification: false }
  const relation: Re20Relation = { from: id, to: toId, type: "chain", justification: input.justification?.trim() || null }
  return { tree: withDerivedTypes({ events: [...tree.events, event], relations: [...tree.relations, relation] }), id }
}

/** Une dos hechos que ya existen; devuelve el mismo árbol si no se puede (ciclo, duplicado, tope). */
export function linkEvents(tree: Re20Tree, from: string, to: string, justification?: string): Re20Tree {
  if (hasRelation(tree, from, to) || wouldCreateCycle(tree, from, to)) return tree
  const relation: Re20Relation = { from, to, type: "chain", justification: justification?.trim() || null }
  return withDerivedTypes({ ...tree, relations: [...tree.relations, relation] })
}

export function unlinkEvents(tree: Re20Tree, from: string, to: string): Re20Tree {
  return withDerivedTypes({ ...tree, relations: tree.relations.filter((relation) => !(relation.from === from && relation.to === to)) })
}

export function removeEvent(tree: Re20Tree, id: string): Re20Tree {
  return withDerivedTypes({
    events: tree.events.filter((event) => event.id !== id),
    relations: tree.relations.filter((relation) => relation.from !== id && relation.to !== id),
  })
}

/** Un hecho con fuente y sin marca de verificación pendiente se da por verificado. */
export function withEventPatch(tree: Re20Tree, id: string, patch: Partial<Re20Event>): Re20Tree {
  return {
    ...tree,
    events: tree.events.map((event) => {
      if (event.id !== id) return event
      const next = { ...event, ...patch }
      return { ...next, verified: Boolean(next.source?.trim()) && next.requiresVerification !== true }
    }),
  }
}

export type FactRole = "final" | "root" | "link" | "context" | "loose"

/** Qué es cada hecho en el árbol: lo que muestran las insignias y el diagrama. */
export function factRole(tree: Re20Tree, id: string): FactRole {
  const event = tree.events.find((item) => item.id === id)
  const { into, out } = causalIndex(tree)
  if (id === FINAL_EVENT_ID) return "final"
  if (event?.causal === false) return "context"
  const hasIn = (into.get(id)?.length ?? 0) > 0
  const hasOut = (out.get(id)?.length ?? 0) > 0
  if (!hasIn && !hasOut) return "loose"
  if (!hasIn) return "root"
  return "link"
}

export const FACT_ROLE_LABELS: Record<FactRole, string> = {
  final: "Hecho final", root: "Causa raíz", link: "Antecedente", context: "Contexto", loose: "Sin conectar",
}

export function rootCauses(tree: Re20Tree) { return deriveRe20RootCauses(tree) }
export function trajectories(tree: Re20Tree) { return deriveRe20Trajectories(tree) }

/* ── Pendientes del árbol, en palabras de terreno ────────────────────────── */

export interface HumanIssue { text: string; fieldId: string }

export const TREE_FIELD = {
  builder: "re20-investigacion-arbol",
  finalFact: "re20-investigacion-hecho-final",
  fact: (id: string) => `re20-investigacion-hecho-${id}-description`,
}

/** Traduce los mensajes de `re20CausalGraphCompletenessIssues` a una frase y al campo donde se corrige. */
export function humanizeCausalIssue(issue: string): HumanIssue {
  if (issue.startsWith("Falta el hecho final")) return { text: "Falta escribir el hecho final H1: la lesión o el daño con que termina el evento.", fieldId: TREE_FIELD.finalFact }
  const final = issue.match(/^H1 es el hecho final/)
  if (final) return { text: "H1 es el hecho final y no puede ser causa de otro hecho. Quita esa relación.", fieldId: TREE_FIELD.builder }
  const reach = issue.match(/^(H\d+): el hecho causal no conduce/)
  if (reach) return { text: `${reach[1]} no llega hasta H1. Conéctalo con el hecho que provocó o márcalo como contexto (no causal).`, fieldId: TREE_FIELD.fact(reach[1]!) }
  if (issue.includes("ninguna causa raíz")) return { text: "Todavía no hay causa raíz. Sigue preguntando «¿qué fue necesario?» hasta llegar a un hecho sin antecedentes.", fieldId: TREE_FIELD.builder }
  const typed = issue.match(/^(H\d+):/)
  if (typed) return { text: `${typed[1]}: la relación no es consistente. Revisa sus antecedentes.`, fieldId: TREE_FIELD.fact(typed[1]!) }
  return { text: issue, fieldId: TREE_FIELD.builder }
}

/** Pendientes humanos: los del dominio más hechos sin texto. */
export function treeIssues(tree: Re20Tree): HumanIssue[] {
  const issues = re20CausalGraphCompletenessIssues(tree).map(humanizeCausalIssue)
  for (const event of tree.events) {
    if (!event.description.trim()) {
      issues.push({ text: `${event.id} no tiene descripción: escribe el hecho en una frase breve y verificable.`, fieldId: event.id === FINAL_EVENT_ID ? TREE_FIELD.finalFact : TREE_FIELD.fact(event.id) })
    }
  }
  const seen = new Set<string>()
  return issues.filter((issue) => (seen.has(issue.text) ? false : (seen.add(issue.text), true)))
}

/* ── Texto equivalente al diagrama ───────────────────────────────────────── */

const shortText = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

/** Una frase por hecho: lo que dice el diagrama para quien no lo ve. */
export function describeTreeAsText(tree: Re20Tree): string[] {
  const index = causalIndex(tree)
  const roots = new Set(deriveRe20RootCauses(tree))
  const label = (id: string) => {
    const event = tree.events.find((item) => item.id === id)
    return event?.description.trim() ? `${id} («${shortText(event.description.trim())}»)` : id
  }
  return tree.events.map((event) => {
    const antecedents = index.into.get(event.id) ?? []
    const consequences = index.out.get(event.id) ?? []
    const role = roots.has(event.id) ? "Causa raíz. " : event.id === FINAL_EVENT_ID ? "Hecho final. " : event.causal === false ? "Contexto, no causal. " : ""
    const head = `${label(event.id)}: ${role}`
    if (antecedents.length === 0) {
      return consequences.length === 0 ? `${head}Sin conexiones.` : `${head}Sin antecedentes; origina ${consequences.join(", ")}.`
    }
    const type = derivedRelationType(index, antecedents[0]!, event.id)
    const how = antecedents.length >= 2 ? `Ocurrió porque concurrieron ${antecedents.join(" y ")} (conjunción).` : `Ocurrió por ${antecedents[0]} (${RELATION_LABELS[type].toLowerCase()}).`
    return `${head}${how}${consequences.length > 0 ? ` Origina ${consequences.join(", ")}.` : ""}`
  })
}

/* ── Distribución del diagrama ───────────────────────────────────────────── */

export const NODE_W = 184
export const NODE_H = 84
export const GAP_X = 76
export const GAP_Y = 20
export const PAD = 16
const LOOSE_GAP = 36

export interface LayoutNode { id: string; role: FactRole; x: number; y: number; description: string; col: number }
export interface LayoutEdge {
  from: string
  to: string
  type: Re20RelationType
  /** Salida (borde derecho del antecedente). */
  x1: number
  y1: number
  /** Llegada (borde izquierdo de la consecuencia) o la compuerta de conjunción. */
  x2: number
  y2: number
  /** Llegada final cuando hay compuerta. */
  gate: boolean
}
export interface LayoutGate { to: string; x: number; y: number }
export interface TreeLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  gates: LayoutGate[]
  /** Hechos con ramas hacia varias consecuencias (relación independiente). */
  splits: Array<{ id: string; x: number; y: number }>
  width: number
  height: number
  /** Dónde empieza la franja de hechos sin conectar (alto), o null. */
  looseTop: number | null
}

/**
 * Izquierda → derecha: la columna de un hecho es lo que le falta para llegar a un
 * extremo final, así las causas raíz quedan a la izquierda y H1 a la derecha. Las
 * columnas se ordenan por baricentro para reducir cruces. Los hechos sin ninguna
 * relación van en una franja aparte debajo.
 */
export function layoutCausalTree(tree: Re20Tree): TreeLayout {
  const index = causalIndex(tree)
  const connected = tree.events.filter((event) => (index.into.get(event.id)?.length ?? 0) + (index.out.get(event.id)?.length ?? 0) > 0 || event.id === FINAL_EVENT_ID)
  const loose = tree.events.filter((event) => !connected.includes(event))

  const level = new Map<string, number>()
  const visiting = new Set<string>()
  const levelOf = (id: string): number => {
    const known = level.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0
    visiting.add(id)
    const outs = index.out.get(id) ?? []
    const value = outs.length === 0 ? 0 : 1 + Math.max(...outs.map(levelOf))
    visiting.delete(id)
    level.set(id, value)
    return value
  }
  for (const event of connected) levelOf(event.id)
  const maxLevel = connected.length === 0 ? 0 : Math.max(...connected.map((event) => level.get(event.id) ?? 0))
  const colOf = (id: string) => maxLevel - (level.get(id) ?? 0)

  const columns: string[][] = Array.from({ length: maxLevel + 1 }, () => [])
  for (const event of connected) columns[colOf(event.id)]!.push(event.id)

  const position = new Map<string, number>()
  const reindex = () => columns.forEach((column) => column.forEach((id, i) => position.set(id, i)))
  reindex()
  const bary = (id: string, neighbours: string[]) => neighbours.length === 0 ? position.get(id) ?? 0 : neighbours.reduce((sum, n) => sum + (position.get(n) ?? 0), 0) / neighbours.length
  for (let pass = 0; pass < 4; pass++) {
    for (let c = 1; c < columns.length; c++) {
      const column = columns[c]!
      const keyed = column.map((id, i) => ({ id, key: bary(id, index.into.get(id) ?? []), i }))
      keyed.sort((a, b) => a.key - b.key || a.i - b.i)
      columns[c] = keyed.map((item) => item.id)
      reindex()
    }
    for (let c = columns.length - 2; c >= 0; c--) {
      const column = columns[c]!
      const keyed = column.map((id, i) => ({ id, key: bary(id, index.out.get(id) ?? []), i }))
      keyed.sort((a, b) => a.key - b.key || a.i - b.i)
      columns[c] = keyed.map((item) => item.id)
      reindex()
    }
  }

  const tallest = Math.max(1, ...columns.map((column) => column.length))
  const mainHeight = tallest * NODE_H + (tallest - 1) * GAP_Y
  const byId = new Map(tree.events.map((event) => [event.id, event]))
  const placed = new Map<string, LayoutNode>()
  columns.forEach((column, c) => {
    const height = column.length * NODE_H + (column.length - 1) * GAP_Y
    const offset = (mainHeight - height) / 2
    column.forEach((id, row) => {
      placed.set(id, {
        id, col: c, role: factRole(tree, id),
        x: PAD + c * (NODE_W + GAP_X),
        y: PAD + offset + row * (NODE_H + GAP_Y),
        description: byId.get(id)?.description ?? "",
      })
    })
  })
  const colCount = Math.max(columns.length, 2)
  const looseTop = loose.length > 0 ? PAD + mainHeight + LOOSE_GAP : null
  const looseRows = loose.length === 0 ? 0 : Math.ceil(loose.length / colCount)
  loose.forEach((event, i) => {
    placed.set(event.id, {
      id: event.id, col: i % colCount, role: factRole(tree, event.id),
      x: PAD + (i % colCount) * (NODE_W + GAP_X),
      y: (looseTop as number) + Math.floor(i / colCount) * (NODE_H + GAP_Y),
      description: event.description,
    })
  })

  const edges: LayoutEdge[] = []
  const gates: LayoutGate[] = []
  const gated = new Set<string>()
  for (const relation of tree.relations) {
    const from = placed.get(relation.from)
    const to = placed.get(relation.to)
    if (!from || !to || relation.from === relation.to) continue
    const type = derivedRelationType(index, relation.from, relation.to)
    const gate = (index.into.get(relation.to)?.length ?? 0) >= 2
    const gx = to.x - 30
    const gy = to.y + NODE_H / 2
    if (gate && !gated.has(relation.to)) { gated.add(relation.to); gates.push({ to: relation.to, x: gx, y: gy }) }
    edges.push({
      from: relation.from, to: relation.to, type, gate,
      x1: from.x + NODE_W, y1: from.y + NODE_H / 2,
      x2: gate ? gx : to.x, y2: gy,
    })
  }
  const splits = [...index.out.entries()]
    .filter(([id, outs]) => outs.length >= 2 && placed.has(id))
    .map(([id]) => ({ id, x: (placed.get(id) as LayoutNode).x + NODE_W, y: (placed.get(id) as LayoutNode).y + NODE_H / 2 }))

  const width = PAD * 2 + columns.length * NODE_W + (columns.length - 1) * GAP_X
  const looseWidth = loose.length === 0 ? 0 : PAD * 2 + Math.min(loose.length, colCount) * NODE_W + (Math.min(loose.length, colCount) - 1) * GAP_X
  const height = looseTop === null ? PAD * 2 + mainHeight : looseTop + looseRows * NODE_H + (looseRows - 1) * GAP_Y + PAD
  return { nodes: [...placed.values()], edges, gates, splits, width: Math.max(width, looseWidth, PAD * 2 + NODE_W), height: Math.max(height, PAD * 2 + NODE_H), looseTop }
}

/** Parte un texto en hasta `maxLines` líneas de `maxChars`, con «…» si no cabe. */
export function wrapLabel(text: string, maxChars = 25, maxLines = 3): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  let truncated = false
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxChars) { current = candidate; continue }
    if (current) lines.push(current)
    current = word.length > maxChars ? `${word.slice(0, maxChars - 1)}…` : word
    if (lines.length === maxLines) { truncated = true; current = ""; break }
  }
  if (current && lines.length < maxLines) lines.push(current)
  else if (current) truncated = true
  if (truncated && lines.length > 0) {
    const last = lines[maxLines - 1] ?? lines[lines.length - 1]!
    lines[Math.min(lines.length, maxLines) - 1] = last.endsWith("…") ? last : `${last.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
  }
  return lines.slice(0, maxLines)
}
