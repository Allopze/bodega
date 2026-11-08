/**
 * Planificador de la sincronización con Talana: decide, persona por persona,
 * qué cambiar en Chome. Función pura (sin base de datos) para poder probar cada
 * regla con datos de mentira.
 *
 * Reglas (Talana no se gestiona al día: lo viejo o faltante allá no debe mover
 * nada acá):
 *
 * 1. Si un dato falta en Talana, no se hace nada. No figurar en Talana nunca es
 *    baja, ni un contrato a plazo vencido sin finiquito.
 * 2. Sólo una señal positiva cambia el estado:
 *    - alta/reactivación: un contrato activo que una corrida que aplica ve por
 *      primera vez (`activationProcessedAt` nulo);
 *    - baja: todos los contratos finiquitados, el último término ya pasó, la
 *      ficha no nació después de ese término y no hay actividad en Chome
 *      posterior a él.
 * 3. No se pisa lo que Chome hizo a mano: sexo, jefe y cargo se completan si
 *    están vacíos; los cambios de cargo, faena y jefe se siguen con un merge a
 *    tres bandas contra la base (lo último que se tomó de Talana).
 */
import { normalizeWorkerPositionKey } from "@/lib/services/worker-positions/normalization"
import { daysBetween, primaryActiveContract } from "./contract-utils"
import { AREA_TO_WORKSITE, CARGO_MAP, isChomeEmployer, mapTalanaSex, textKey, titleCase } from "./mapping"

export { daysBetween, primaryActiveContract }

/** Un alta o reactivación abre la inducción del PDTP sólo si el ingreso en Talana es de los últimos 30 días. */
export const RECENT_HIRE_DAYS = 30

/* ── Entradas ─────────────────────────────────────────────────────────────── */

export interface PlannerContract {
  id: number
  rut: string
  rutValid: boolean
  firstName: string | null
  lastNamePaternal: string | null
  lastNameMaternal: string | null
  sex: "M" | "F" | "N" | null
  employerName: string | null
  contractType: string | null
  cargo: string | null
  costCenterId: number | null
  costCenterName: string | null
  jefeRut: string | null
  jefeName: string | null
  hiredOn: string | null
  startsOn: string | null
  endsOn: string | null
  finiquitado: boolean
  listedActive: boolean
  activationProcessedAt: string | null
  finiquitoProcessedAt: string | null
}

export interface PlannerWorker {
  id: string
  /** Canónico (`cleanRut`) o nulo. */
  rut: string | null
  firstName: string
  lastName: string
  sex: string | null
  positionId: string | null
  supervisor: string | null
  worksiteId: string
  isActive: boolean
  /** Día (Chile) en que se creó la ficha. */
  createdOn: string
}

export interface PlannerPosition {
  id: string
  name: string
  isSystem: boolean
  isActive: boolean
  /** `normalizeWorkerPositionKey` del nombre y de cada alias. */
  keys: string[]
}

export interface PlannerWorksite { id: string; name: string; isActive: boolean }

/** Base del merge a tres bandas: lo último que se tomó de Talana para la persona. */
export interface PlannerBase {
  cargoKey: string | null
  positionId: string | null
  costCenterId: number | null
  worksiteId: string | null
  jefeKey: string | null
  supervisor: string | null
}

export interface PlannerInput {
  /** `YYYY-MM-DD` en Chile. */
  today: string
  contracts: PlannerContract[]
  workers: PlannerWorker[]
  positions: PlannerPosition[]
  worksites: PlannerWorksite[]
  bases: Map<string, PlannerBase>
  /** Último día (Chile) con actividad en Chome, sólo de los candidatos a baja. */
  lastActivityByWorker: Map<string, string>
  unclassifiedPositionId: string | null
}

/* ── Salidas ──────────────────────────────────────────────────────────────── */

export type PlanItemKind = "alta" | "reactivacion" | "baja" | "traslado" | "cargo" | "jefe" | "sexo"

export interface PlanItem {
  kind: PlanItemKind
  outcome: "planned" | "skipped"
  reasonCode: string | null
  before: string | null
  after: string | null
}

export interface WorkerCreate {
  firstName: string
  lastName: string
  sex: "male" | "female" | null
  positionId: string
  positionName: string
  supervisor: string | null
  worksiteId: string
}

export interface WorkerChanges {
  worksiteId?: string
  positionId?: string
  supervisor?: string
  sex?: "male" | "female"
}

export interface PersonPlan {
  rut: string
  workerId: string | null
  primaryContractId: number | null
  /** Campos de la ficha sobre los que se calculó el plan: si cambian antes de aplicar, se omite. */
  expected: Pick<PlannerWorker, "isActive" | "worksiteId" | "positionId" | "supervisor" | "sex"> | null
  create: WorkerCreate | null
  reactivate: { worksiteId: string } | null
  deactivate: { endsOn: string } | null
  changes: WorkerChanges
  /** Base nueva; `null` = no se toca. */
  nextBase: PlannerBase | null
  markActivation: number[]
  markFiniquito: number[]
  resetActivation: number[]
  /** El alta o reactivación corresponde a un ingreso reciente (abre la inducción del PDTP). */
  recentHire: boolean
  items: PlanItem[]
}

export interface PlanResult {
  persons: PersonPlan[]
  plannedAltas: number
}

/* ── Utilidades ───────────────────────────────────────────────────────────── */

const sameText = (a: string | null | undefined, b: string | null | undefined) => textKey(a) === textKey(b)

function nameTokens(firstName: string, lastName: string): string[] {
  return textKey(`${firstName} ${lastName}`).split(" ").filter(Boolean)
}

type CargoResolution =
  | { kind: "empty" }
  | { kind: "ok"; key: string; position: PlannerPosition }
  | { kind: "missing_catalog"; key: string; target: string }
  | { kind: "unmapped"; key: string }

export interface PlannerLookups {
  workersByRut: Map<string, PlannerWorker[]>
  positionById: Map<string, PlannerPosition>
  worksiteById: Map<string, PlannerWorksite>
  resolveCargo(cargo: string | null): CargoResolution
  resolveWorksite(costCenterName: string | null): PlannerWorksite | null
  resolveJefe(contract: PlannerContract): { key: string; name: string } | null
  personsByRut: Map<string, PlannerContract[]>
}

/** Contratos de Chome agrupados por RUT (los de otras razones sociales se ignoran). */
export function groupChomeContracts(contracts: PlannerContract[]): Map<string, PlannerContract[]> {
  const byRut = new Map<string, PlannerContract[]>()
  for (const contract of contracts) {
    if (!isChomeEmployer(contract.employerName)) continue
    byRut.set(contract.rut, [...(byRut.get(contract.rut) ?? []), contract])
  }
  return byRut
}

export function buildPlannerLookups(input: Pick<PlannerInput, "contracts" | "workers" | "positions" | "worksites">): PlannerLookups {
  const workersByRut = new Map<string, PlannerWorker[]>()
  for (const worker of input.workers) {
    if (!worker.rut) continue
    workersByRut.set(worker.rut, [...(workersByRut.get(worker.rut) ?? []), worker])
  }
  const positionById = new Map(input.positions.map((position) => [position.id, position]))
  const positionByKey = new Map<string, PlannerPosition>()
  for (const position of input.positions) {
    if (!position.isActive || position.isSystem) continue
    for (const key of position.keys) if (!positionByKey.has(key)) positionByKey.set(key, position)
  }
  const worksiteById = new Map(input.worksites.map((worksite) => [worksite.id, worksite]))
  const worksitesByKey = new Map<string, PlannerWorksite[]>()
  for (const worksite of input.worksites) {
    if (!worksite.isActive) continue
    const key = textKey(worksite.name)
    worksitesByKey.set(key, [...(worksitesByKey.get(key) ?? []), worksite])
  }
  const personsByRut = groupChomeContracts(input.contracts)
  const talanaNameByRut = new Map<string, string>()
  for (const [rut, contracts] of personsByRut) {
    const named = contracts.find((contract) => contract.firstName && contract.lastNamePaternal)
    if (named) talanaNameByRut.set(rut, `${titleCase(named.firstName!)} ${titleCase([named.lastNamePaternal, named.lastNameMaternal].filter(Boolean).join(" "))}`)
  }

  return {
    workersByRut,
    positionById,
    worksiteById,
    personsByRut,
    resolveCargo(cargo) {
      if (!cargo?.trim()) return { kind: "empty" }
      const key = textKey(cargo)
      const target = CARGO_MAP.get(key)
      if (target) {
        const position = positionByKey.get(normalizeWorkerPositionKey(target))
        return position ? { kind: "ok", key, position } : { kind: "missing_catalog", key, target }
      }
      // Un cargo nuevo de Talana se resuelve agregando un alias en Administración › Cargos.
      const direct = positionByKey.get(normalizeWorkerPositionKey(cargo))
      return direct ? { kind: "ok", key, position: direct } : { kind: "unmapped", key }
    },
    resolveWorksite(costCenterName) {
      const target = AREA_TO_WORKSITE.get(textKey(costCenterName))
      if (!target) return null
      const matches = worksitesByKey.get(textKey(target)) ?? []
      return matches.length === 1 ? matches[0]! : null
    },
    resolveJefe(contract) {
      if (contract.jefeRut && contract.jefeRut === contract.rut) return null
      if (contract.jefeRut) {
        const inChome = workersByRut.get(contract.jefeRut) ?? []
        if (inChome.length === 1) return { key: contract.jefeRut, name: `${inChome[0]!.firstName.trim()} ${inChome[0]!.lastName.trim()}` }
        const inTalana = talanaNameByRut.get(contract.jefeRut)
        if (inTalana) return { key: contract.jefeRut, name: inTalana }
      }
      if (contract.jefeName) return { key: contract.jefeRut ?? `N:${textKey(contract.jefeName)}`, name: titleCase(contract.jefeName) }
      return null
    },
  }
}

/* ── Baja ─────────────────────────────────────────────────────────────────── */

type BajaEvaluation =
  | { status: "none" }
  /** Finiquito que no corresponde a nadie activo en Chome: sólo se marca como procesado. */
  | { status: "mark_only"; contractIds: number[] }
  | { status: "candidate"; worker: PlannerWorker; latestEnd: string; contractIds: number[] }

function evaluateBaja(contracts: PlannerContract[], workers: PlannerWorker[], today: string): BajaEvaluation {
  if (contracts.some((contract) => contract.listedActive)) return { status: "none" }
  if (!contracts.every((contract) => contract.finiquitado)) return { status: "none" }
  if (contracts.some((contract) => !contract.endsOn)) return { status: "none" }
  const latest = [...contracts].sort((a, b) => b.endsOn!.localeCompare(a.endsOn!) || b.id - a.id)[0]!
  if (latest.endsOn! >= today) return { status: "none" }
  if (latest.finiquitoProcessedAt) return { status: "none" }
  const contractIds = contracts.filter((contract) => !contract.finiquitoProcessedAt).map((contract) => contract.id)
  if (workers.length !== 1 || !workers[0]!.isActive) return workers.length > 1 ? { status: "none" } : { status: "mark_only", contractIds }
  return { status: "candidate", worker: workers[0]!, latestEnd: latest.endsOn!, contractIds }
}

/** Trabajadores para los que hay que averiguar la última actividad en Chome antes de planificar. */
export function findBajaCandidates(input: Pick<PlannerInput, "contracts" | "workers" | "today">): string[] {
  const lookups = buildPlannerLookups({ ...input, positions: [], worksites: [] })
  const ids: string[] = []
  for (const [rut, contracts] of lookups.personsByRut) {
    const evaluation = evaluateBaja(contracts, lookups.workersByRut.get(rut) ?? [], input.today)
    if (evaluation.status === "candidate") ids.push(evaluation.worker.id)
  }
  return ids
}

/* ── Merge a tres bandas ──────────────────────────────────────────────────── */

type MergeOutcome<V> =
  | { action: "none"; advance: boolean }
  | { action: "apply"; value: V; advance: true }
  | { action: "skip"; reason: string; advance: boolean }

/**
 * T = clave actual en Talana, Tm = valor de Chome que le corresponde, C = valor
 * actual en Chome, B/Bm = base (clave y valor tomados la última vez).
 */
function merge<K, V>(args: {
  field: string
  T: K | null
  Tm: V | null
  C: V | null
  cEmpty: boolean
  B: K | null
  Bm: V | null
  equals: (a: V | null, b: V | null) => boolean
}): MergeOutcome<V> {
  const { T, Tm, C, cEmpty, B, Bm, equals } = args
  if (T === null || Tm === null) return { action: "none", advance: false }
  if (equals(C, Tm)) return { action: "none", advance: true }
  if (B === null) {
    return cEmpty ? { action: "apply", value: Tm, advance: true } : { action: "skip", reason: `${args.field}_distinto`, advance: true }
  }
  if (T === B) {
    // Talana no cambió: si Chome difiere es porque alguien lo cambió a mano. Sólo se completa un vacío.
    return cEmpty ? { action: "apply", value: Tm, advance: true } : { action: "none", advance: false }
  }
  if (cEmpty || equals(C, Bm)) return { action: "apply", value: Tm, advance: true }
  return { action: "skip", reason: "cambio_manual_en_chome", advance: true }
}

const EMPTY_BASE: PlannerBase = { cargoKey: null, positionId: null, costCenterId: null, worksiteId: null, jefeKey: null, supervisor: null }

/* ── Plan por persona ─────────────────────────────────────────────────────── */

export function planPerson(rut: string, contracts: PlannerContract[], lookups: PlannerLookups, input: PlannerInput): PersonPlan | null {
  const plan: PersonPlan = {
    rut, workerId: null, primaryContractId: null, expected: null,
    create: null, reactivate: null, deactivate: null, changes: {},
    nextBase: null, markActivation: [], markFiniquito: [], resetActivation: [], recentHire: false, items: [],
  }
  // RUT inválido en Talana: no se cruza con nadie (queda en la lista de diferencias).
  if (contracts.some((contract) => !contract.rutValid)) return null
  const matches = lookups.workersByRut.get(rut) ?? []
  // RUT repetido en Chome: no se toca ninguna ficha (diferencia).
  if (matches.length > 1) return null
  const worker = matches[0] ?? null
  plan.workerId = worker?.id ?? null
  plan.expected = worker ? {
    isActive: worker.isActive, worksiteId: worker.worksiteId, positionId: worker.positionId,
    supervisor: worker.supervisor, sex: worker.sex,
  } : null

  const primary = primaryActiveContract(contracts)

  /* Sin contrato activo: lo único posible es una baja ─ */
  if (!primary) {
    const baja = evaluateBaja(contracts, matches, input.today)
    if (baja.status === "mark_only") {
      plan.markFiniquito = baja.contractIds
      return plan
    }
    if (baja.status !== "candidate") return plan.markFiniquito.length ? plan : null
    plan.markFiniquito = baja.contractIds
    const label = `término ${baja.latestEnd}`
    if (baja.worker.createdOn > baja.latestEnd) {
      plan.items.push({ kind: "baja", outcome: "skipped", reasonCode: "creado_despues_del_termino", before: null, after: label })
      return plan
    }
    const lastActivity = input.lastActivityByWorker.get(baja.worker.id)
    if (lastActivity && lastActivity > baja.latestEnd) {
      plan.items.push({ kind: "baja", outcome: "skipped", reasonCode: "actividad_posterior", before: null, after: `${label}; actividad ${lastActivity}` })
      return plan
    }
    plan.deactivate = { endsOn: baja.latestEnd }
    plan.resetActivation = contracts.map((contract) => contract.id)
    plan.items.push({ kind: "baja", outcome: "planned", reasonCode: null, before: null, after: label })
    return plan
  }

  plan.primaryContractId = primary.id
  const unprocessedActive = contracts.filter((contract) => contract.listedActive && !contract.activationProcessedAt).map((contract) => contract.id)
  const hireDate = primary.hiredOn ?? primary.startsOn
  const recentHire = hireDate ? daysBetween(hireDate, input.today) <= RECENT_HIRE_DAYS : false

  const worksite = lookups.resolveWorksite(primary.costCenterName)
  const activeFaenas = new Set(contracts.filter((contract) => contract.listedActive).map((contract) => lookups.resolveWorksite(contract.costCenterName)?.id ?? `cc:${contract.costCenterId}`))
  const ambiguousFaena = activeFaenas.size > 1
  const cargo = lookups.resolveCargo(primary.cargo)
  const jefe = lookups.resolveJefe(primary)
  const T = {
    cargoKey: cargo.kind === "empty" ? null : cargo.key,
    positionId: cargo.kind === "ok" ? cargo.position.id : null,
    costCenterId: primary.costCenterId,
    worksiteId: worksite?.id ?? null,
    jefeKey: jefe?.key ?? null,
    supervisor: jefe?.name ?? null,
  }
  const base = input.bases.get(rut) ?? null
  const B = base ?? EMPTY_BASE
  const next: PlannerBase = { ...B }
  let baseChanged = false
  const advance = (field: "cargo" | "faena" | "jefe") => {
    const before = JSON.stringify(next)
    if (field === "cargo") { next.cargoKey = T.cargoKey; next.positionId = T.positionId }
    if (field === "faena") { next.costCenterId = T.costCenterId; next.worksiteId = T.worksiteId }
    if (field === "jefe") { next.jefeKey = T.jefeKey; next.supervisor = T.supervisor }
    // Sólo cuenta si la base de verdad cambió: si no, cada corrida la reescribiría para todos.
    if (JSON.stringify(next) !== before || !base) baseChanged = true
  }
  const positionName = (id: string | null) => (id ? lookups.positionById.get(id)?.name ?? null : null)
  const worksiteName = (id: string | null) => (id ? lookups.worksiteById.get(id)?.name ?? null : null)

  /* Alta ─ */
  if (!worker) {
    if (unprocessedActive.length === 0) return null
    const firstName = primary.firstName ? titleCase(primary.firstName) : ""
    const lastName = titleCase([primary.lastNamePaternal, primary.lastNameMaternal].filter(Boolean).join(" "))
    const after = worksite?.name ?? primary.costCenterName ?? null
    if (!worksite) {
      plan.items.push({ kind: "alta", outcome: "skipped", reasonCode: "faena_sin_mapeo", before: null, after })
      return plan
    }
    if (!firstName || !lastName || firstName.length > 60 || lastName.length > 60) {
      plan.items.push({ kind: "alta", outcome: "skipped", reasonCode: "nombre_invalido", before: null, after })
      return plan
    }
    // Alguien de Chome con el mismo nombre y otro RUT (o sin RUT): crear otra ficha la duplicaría.
    const first = textKey(primary.firstName).split(" ")[0] ?? ""
    const paternal = textKey(primary.lastNamePaternal).split(" ").filter(Boolean)
    const homonym = first && paternal.length > 0 && input.workers.some((candidate) => {
      if (candidate.rut === rut) return false
      const tokens = nameTokens(candidate.firstName, candidate.lastName)
      return tokens.includes(first) && paternal.every((token) => tokens.includes(token))
    })
    if (homonym) {
      plan.items.push({ kind: "alta", outcome: "skipped", reasonCode: "posible_duplicado", before: null, after })
      return plan
    }
    const positionId = cargo.kind === "ok" ? cargo.position.id : input.unclassifiedPositionId
    if (!positionId) {
      plan.items.push({ kind: "alta", outcome: "skipped", reasonCode: "sin_cargo_de_sistema", before: null, after })
      return plan
    }
    plan.create = {
      firstName, lastName, sex: mapTalanaSex(primary.sex), positionId,
      positionName: positionName(positionId) ?? "Sin clasificar", supervisor: jefe?.name ?? null, worksiteId: worksite.id,
    }
    plan.markActivation = unprocessedActive
    plan.recentHire = recentHire
    advance("faena")
    if (T.positionId) advance("cargo")
    if (T.jefeKey) advance("jefe")
    plan.nextBase = next
    plan.items.push({ kind: "alta", outcome: "planned", reasonCode: null, before: null, after: `${worksite.name} · ${plan.create.positionName}` })
    return plan
  }

  /* Reactivación ─ */
  let becomesActive = worker.isActive
  if (!worker.isActive) {
    // Un contrato ya procesado no reactiva: si alguien desactivó la ficha a mano, Chome manda.
    if (unprocessedActive.length === 0) return null
    if (!worksite) {
      plan.items.push({ kind: "reactivacion", outcome: "skipped", reasonCode: "faena_sin_mapeo", before: null, after: primary.costCenterName })
      return plan
    }
    plan.reactivate = { worksiteId: worksite.id }
    plan.recentHire = recentHire
    becomesActive = true
    advance("faena")
    plan.items.push({ kind: "reactivacion", outcome: "planned", reasonCode: null, before: worksiteName(worker.worksiteId), after: worksite.name })
  }
  plan.markActivation = unprocessedActive
  if (!becomesActive) return plan

  /* Campos ─ */
  const positionIsEmpty = (id: string | null) => !id || lookups.positionById.get(id)?.isSystem === true

  // Cargo
  const cargoMerge = merge({
    field: "cargo", T: T.cargoKey, Tm: T.positionId, C: worker.positionId, cEmpty: positionIsEmpty(worker.positionId),
    B: B.cargoKey, Bm: B.positionId, equals: (a, b) => a === b,
  })
  if (cargoMerge.advance) advance("cargo")
  if (cargoMerge.action === "apply") {
    plan.changes.positionId = cargoMerge.value
    plan.items.push({ kind: "cargo", outcome: "planned", reasonCode: null, before: positionName(worker.positionId), after: positionName(cargoMerge.value) })
  } else if (cargoMerge.action === "skip") {
    plan.items.push({ kind: "cargo", outcome: "skipped", reasonCode: cargoMerge.reason, before: positionName(worker.positionId), after: positionName(T.positionId) })
  }

  // Faena (en una reactivación ya quedó puesta)
  if (!plan.reactivate) {
    if (ambiguousFaena) {
      // Varios contratos activos en faenas distintas: no se mueve a nadie (diferencia).
    } else {
      const faenaMerge = merge({
        field: "faena", T: T.costCenterId, Tm: T.worksiteId, C: worker.worksiteId, cEmpty: false,
        B: B.costCenterId, Bm: B.worksiteId, equals: (a, b) => a === b,
      })
      if (faenaMerge.advance) advance("faena")
      if (faenaMerge.action === "apply") {
        plan.changes.worksiteId = faenaMerge.value
        plan.items.push({ kind: "traslado", outcome: "planned", reasonCode: null, before: worksiteName(worker.worksiteId), after: worksiteName(faenaMerge.value) })
      } else if (faenaMerge.action === "skip") {
        plan.items.push({ kind: "traslado", outcome: "skipped", reasonCode: faenaMerge.reason.replace("faena_distinto", "faena_distinta"), before: worksiteName(worker.worksiteId), after: worksiteName(T.worksiteId) })
      }
    }
  }

  // Jefe directo
  const jefeMerge = merge({
    field: "jefe", T: T.jefeKey, Tm: T.supervisor, C: worker.supervisor?.trim() || null, cEmpty: !worker.supervisor?.trim(),
    B: B.jefeKey, Bm: B.supervisor, equals: sameText,
  })
  if (jefeMerge.advance) advance("jefe")
  if (jefeMerge.action === "apply") {
    plan.changes.supervisor = jefeMerge.value
    plan.items.push({ kind: "jefe", outcome: "planned", reasonCode: null, before: worker.supervisor?.trim() || null, after: jefeMerge.value })
  } else if (jefeMerge.action === "skip") {
    plan.items.push({ kind: "jefe", outcome: "skipped", reasonCode: jefeMerge.reason, before: worker.supervisor?.trim() || null, after: T.supervisor })
  }

  // Sexo: sólo se completa. El ítem no lleva el valor.
  const sex = mapTalanaSex(primary.sex)
  if (!worker.sex && sex) {
    plan.changes.sex = sex
    plan.items.push({ kind: "sexo", outcome: "planned", reasonCode: null, before: null, after: null })
  }

  if (baseChanged) plan.nextBase = next
  const hasWork = plan.reactivate || Object.keys(plan.changes).length > 0 || plan.items.length > 0 || plan.nextBase || plan.markActivation.length > 0
  return hasWork ? plan : null
}

export function planTalanaSync(input: PlannerInput): PlanResult {
  const lookups = buildPlannerLookups(input)
  const persons: PersonPlan[] = []
  for (const [rut, contracts] of lookups.personsByRut) {
    const plan = planPerson(rut, contracts, lookups, input)
    if (plan) persons.push(plan)
  }
  return { persons, plannedAltas: persons.filter((plan) => plan.create).length }
}
