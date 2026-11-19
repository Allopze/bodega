import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { contractVehicleAssignments, contracts, fuelProviderMappings, fuelVehicles } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import type { AssignmentWindow } from "@/lib/contracts/cost-attribution"
import { nanoid } from "@/lib/id"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { contractAssignmentSchema, endAssignmentSchema } from "@/lib/validation/contracts"

/**
 * Asignaciones equipo → contrato (diseño: docs/superpowers/specs/2026-11-18-contratos-por-faena-design.md § 6).
 *
 * Un equipo pertenece a un contrato a la vez; la historia se conserva con
 * vigencias por día (`valid_from`/`valid_to`, ambos inclusivos) para que el costo
 * de un mes no cambie cuando el equipo se reasigna después. Este servicio NO
 * revisa permisos: eso es de las actions (`mant:equipment:manage`, y
 * `canAccessWorksite` sobre la faena del contrato).
 *
 * Lo que la base no expresa sola lo sostiene este archivo, siempre bajo bloqueo
 * de la fila del contrato y de las de los equipos: sin traslapes por equipo y
 * faena del contrato = faena del equipo.
 */

export interface AssignmentActor { userId: string; email?: string | null }

export type AssignmentResult =
  | { ok: true; assigned: number; warnings: string[] }
  | { ok: false; message: string }

const ENTITY = "contract_vehicle_assignment"

function firstIssue(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Datos inválidos"
}

/** Cómo se nombra un equipo en los mensajes: su código interno y, si no tiene, la patente. */
function vehicleLabel(vehicle: { code: string | null; plate: string }): string {
  return vehicle.code ?? vehicle.plate
}

type AssignmentRow = typeof contractVehicleAssignments.$inferSelect

/** ¿El día cae dentro de la asignación? (ambos extremos inclusivos; `validTo` nulo = sin término) */
function covers(row: { validFrom: string; validTo: string | null }, day: string): boolean {
  return row.validFrom <= day && (row.validTo === null || row.validTo >= day)
}

/** Una asignación con la faena de su contrato. */
type RowWithWorksite = AssignmentRow & { worksiteId: string | null }

/**
 * Regla única de «a partir del día X el equipo cambia» (de contrato o a «Sin
 * contrato»). La comparten `assignVehiclesToContract` y `endVehicleAssignment`
 * para que la ficha y la faena se comporten igual:
 *
 * - la asignación que cubre X y empezó antes —abierta o con el término que
 *   heredó del contrato— se acorta al día anterior (`covering`);
 * - la que empieza justo en X se corrige o se borra (`sameDay`): así un error de
 *   fecha se deshace;
 * - una que empieza después de X se rechaza: reescribir historia posterior en
 *   silencio no es lo que pidió quien eligió X;
 * - nunca se toca una asignación de un contrato de otra faena (la del equipo
 *   antes de un traslado): esa historia es de otra faena y de otro alcance.
 */
function planChangeFrom(
  rows: readonly RowWithWorksite[],
  day: string,
  worksiteId: string,
  label: string,
): { ok: true; sameDay: RowWithWorksite | null; covering: RowWithWorksite | null } | { ok: false; message: string } {
  const later = rows.find((row) => row.validFrom > day)
  if (later) {
    return { ok: false, message: `${label} ya tiene una asignación desde ${later.validFrom}: quítala primero desde su ficha («Sin contrato» desde esa fecha)` }
  }
  const sameDay = rows.find((row) => row.validFrom === day) ?? null
  const covering = rows.find((row) => row.validFrom < day && covers(row, day)) ?? null
  for (const row of [sameDay, covering]) {
    if (row && row.worksiteId !== worksiteId) {
      return { ok: false, message: `${label}: el ${day} trabajaba para un contrato de otra faena (antes de su traslado); ese período no se cambia desde aquí` }
    }
  }
  return { ok: true, sameDay, covering }
}

async function vehicleRowsWithWorksite(tx: Tx, vehicleIds: readonly string[]): Promise<Map<string, RowWithWorksite[]>> {
  const found = await tx.select({ assignment: contractVehicleAssignments, worksiteId: contracts.worksiteId })
    .from(contractVehicleAssignments)
    .innerJoin(contracts, eq(contracts.id, contractVehicleAssignments.contractId))
    .where(inArray(contractVehicleAssignments.vehicleId, [...vehicleIds]))
    .orderBy(asc(contractVehicleAssignments.vehicleId), asc(contractVehicleAssignments.validFrom))
  const byVehicle = new Map<string, RowWithWorksite[]>()
  for (const { assignment, worksiteId } of found) {
    byVehicle.set(assignment.vehicleId, [...(byVehicle.get(assignment.vehicleId) ?? []), { ...assignment, worksiteId }])
  }
  return byVehicle
}

/**
 * Asigna uno o varios equipos a un contrato desde `validFrom` (inclusive).
 *
 * Todo o nada: se valida el lote entero antes de escribir, así un equipo con
 * conflicto no deja a los demás a medio asignar.
 */
export async function assignVehiclesToContract(actor: AssignmentActor, input: unknown, client: DB = db): Promise<AssignmentResult> {
  const parsed = contractAssignmentSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const { contractId, validFrom, reason } = parsed.data
  const vehicleIds = [...new Set(parsed.data.vehicleIds)].sort()

  return client.transaction(async (tx): Promise<AssignmentResult> => {
    const [contract] = await tx.select().from(contracts).where(eq(contracts.id, contractId)).limit(1).for("update")
    if (!contract) return { ok: false, message: "El contrato no existe" }
    if (contract.status !== "active") return { ok: false, message: `El contrato ${contract.code} no está vigente: sólo se asignan equipos a contratos vigentes` }
    const worksiteId = contract.worksiteId
    if (!worksiteId) return { ok: false, message: `El contrato ${contract.code} no tiene faena: indícala antes de asignarle equipos` }
    if (contract.startDate && validFrom < contract.startDate) {
      return { ok: false, message: `El contrato ${contract.code} empieza el ${contract.startDate}: la asignación no puede partir antes` }
    }
    if (contract.endDate && validFrom > contract.endDate) {
      return { ok: false, message: `El contrato ${contract.code} termina el ${contract.endDate}: la asignación no puede partir después` }
    }

    const vehicles = await tx.select({
      id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, worksiteId: fuelVehicles.worksiteId, isActive: fuelVehicles.isActive,
    }).from(fuelVehicles).where(inArray(fuelVehicles.id, vehicleIds)).orderBy(asc(fuelVehicles.id)).for("update")
    const byId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))
    for (const id of vehicleIds) {
      const vehicle = byId.get(id)
      if (!vehicle) return { ok: false, message: "Uno de los equipos elegidos no existe" }
      if (!vehicle.isActive) return { ok: false, message: `${vehicleLabel(vehicle)} está inactivo: sólo se asignan equipos activos` }
      if (vehicle.worksiteId !== worksiteId) {
        return { ok: false, message: `${vehicleLabel(vehicle)} pertenece a otra faena que el contrato ${contract.code}: trasládalo primero` }
      }
    }

    const existingByVehicle = await vehicleRowsWithWorksite(tx, vehicleIds)

    // Primera pasada: sólo valida y decide; nada se escribe hasta que todo el lote pasa.
    type Plan =
      | { kind: "skip" }
      | { kind: "insert"; closeOpen: AssignmentRow | null }
      | { kind: "correct"; row: AssignmentRow }
    const plans = new Map<string, Plan>()
    for (const id of vehicleIds) {
      const decided = planChangeFrom(existingByVehicle.get(id) ?? [], validFrom, worksiteId, vehicleLabel(byId.get(id)!))
      if (!decided.ok) return { ok: false, message: decided.message }
      const { sameDay, covering } = decided
      if (sameDay) plans.set(id, sameDay.contractId === contractId ? { kind: "skip" } : { kind: "correct", row: sameDay })
      else if (covering && covering.contractId === contractId) plans.set(id, { kind: "skip" })
      else plans.set(id, { kind: "insert", closeOpen: covering })
    }

    const validTo = contract.endDate ?? null
    let assigned = 0
    const touched: string[] = []
    for (const id of vehicleIds) {
      const plan = plans.get(id)!
      if (plan.kind === "skip") continue
      const vehicle = byId.get(id)!
      assigned++
      touched.push(id)
      if (plan.kind === "correct") {
        await tx.update(contractVehicleAssignments)
          .set({ contractId, validTo, reason: reason ?? plan.row.reason, updatedAt: new Date().toISOString() })
          .where(eq(contractVehicleAssignments.id, plan.row.id))
        await recordAudit({
          userId: actor.userId, userEmail: actor.email ?? undefined, action: "update", entityType: ENTITY, entityId: plan.row.id,
          entityCode: vehicleLabel(vehicle), worksiteId,
          oldState: { contractId: plan.row.contractId, validFrom: plan.row.validFrom, validTo: plan.row.validTo },
          newState: { contractId, validFrom, validTo },
          reason: reason ?? "Corrección del contrato del equipo",
        }, tx)
        continue
      }
      if (plan.closeOpen) {
        // Primero se acorta la que cubría el día (abierta o con el término que
        // heredó del contrato): el índice único admite una sola abierta por equipo.
        const closedTo = addDaysToPlainDate(validFrom, -1)
        await tx.update(contractVehicleAssignments)
          .set({ validTo: closedTo, updatedAt: new Date().toISOString() })
          .where(eq(contractVehicleAssignments.id, plan.closeOpen.id))
        await recordAudit({
          userId: actor.userId, userEmail: actor.email ?? undefined, action: "update", entityType: ENTITY, entityId: plan.closeOpen.id,
          entityCode: vehicleLabel(vehicle), worksiteId,
          oldState: { validTo: plan.closeOpen.validTo }, newState: { validTo: closedTo },
          reason: reason ?? "Reasignación a otro contrato",
        }, tx)
      }
      const row = { id: nanoid(), contractId, vehicleId: id, validFrom, validTo, reason: reason ?? null, createdByUserId: actor.userId }
      await tx.insert(contractVehicleAssignments).values(row)
      await recordAudit({
        userId: actor.userId, userEmail: actor.email ?? undefined, action: "create", entityType: ENTITY, entityId: row.id,
        entityCode: vehicleLabel(vehicle), worksiteId, reason,
        newState: { contractId, vehicleId: id, validFrom, validTo },
      }, tx)
    }

    return { ok: true, assigned, warnings: await fuelMappingWarnings(tx, touched.map((id) => byId.get(id)!), worksiteId, validFrom) }
  })
}

/**
 * Avisa, sin bloquear, de los equipos cuyo mapeo de combustible (patente →
 * faena, con fechas) los ubicó en otra faena dentro de la vigencia que se
 * está abriendo: ese consumo no va a caer en este contrato.
 */
async function fuelMappingWarnings(
  tx: Tx,
  vehicles: Array<{ id: string; code: string | null; plate: string }>,
  worksiteId: string,
  validFrom: string,
): Promise<string[]> {
  if (vehicles.length === 0) return []
  const today = todayInChile()
  const mappings = await tx.select({
    vehicleId: fuelProviderMappings.vehicleId, from: fuelProviderMappings.effectiveFrom, to: fuelProviderMappings.effectiveTo,
    isActive: fuelProviderMappings.isActive, worksiteId: fuelProviderMappings.worksiteId,
  }).from(fuelProviderMappings).where(inArray(fuelProviderMappings.vehicleId, vehicles.map((vehicle) => vehicle.id)))
  const warnings: string[] = []
  for (const vehicle of vehicles) {
    let desde: string | null = null
    let hasta: string | null = null
    for (const mapping of mappings) {
      if (mapping.vehicleId !== vehicle.id || mapping.worksiteId === worksiteId) continue
      // Una asignación dada de baja sin fecha de término no dice cuándo dejó de regir: no se acusa.
      if (!mapping.isActive && mapping.to === null) continue
      const start = mapping.from > validFrom ? mapping.from : validFrom
      const end = mapping.to !== null && mapping.to < today ? mapping.to : today
      if (start > end) continue
      if (desde === null || start < desde) desde = start
      if (hasta === null || end > hasta) hasta = end
    }
    if (desde !== null && hasta !== null) {
      warnings.push(`${vehicleLabel(vehicle)}: el mapeo de combustible lo ubica en otra faena entre ${desde} y ${hasta}`)
    }
  }
  return warnings
}

/**
 * «Sin contrato» desde el día siguiente a `lastDay`, con la misma regla que una
 * reasignación (`planChangeFrom`): la asignación que cubría ese día termina el
 * `lastDay`; la que empezaba justo ese día se borra (deshace una asignación hecha
 * con la fecha equivocada); una posterior se rechaza en vez de quedar viva sin
 * que nadie lo note; y la historia de otra faena no se toca.
 */
export async function endVehicleAssignment(actor: AssignmentActor, input: unknown, client: DB = db): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = endAssignmentSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const { vehicleId, lastDay, reason } = parsed.data
  const fromDay = addDaysToPlainDate(lastDay, 1)

  return client.transaction(async (tx): Promise<{ ok: true } | { ok: false; message: string }> => {
    const [vehicle] = await tx.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, worksiteId: fuelVehicles.worksiteId })
      .from(fuelVehicles).where(eq(fuelVehicles.id, vehicleId)).limit(1).for("update")
    if (!vehicle) return { ok: false, message: "El equipo no existe" }
    const label = vehicleLabel(vehicle)
    const rows = (await vehicleRowsWithWorksite(tx, [vehicleId])).get(vehicleId) ?? []
    const decided = planChangeFrom(rows, fromDay, vehicle.worksiteId, label)
    if (!decided.ok) return decided
    const { sameDay, covering } = decided
    const base = { userId: actor.userId, userEmail: actor.email ?? undefined, entityType: ENTITY, entityCode: label }

    if (sameDay) {
      await tx.delete(contractVehicleAssignments).where(eq(contractVehicleAssignments.id, sameDay.id))
      await recordAudit({
        ...base, action: "delete", entityId: sameDay.id, worksiteId: sameDay.worksiteId ?? undefined,
        oldState: { contractId: sameDay.contractId, validFrom: sameDay.validFrom, validTo: sameDay.validTo },
        reason: reason ?? "Asignación deshecha: el equipo queda sin contrato desde su inicio",
      }, tx)
      return { ok: true }
    }
    if (!covering) return { ok: false, message: `${label} no tiene contrato el ${fromDay}` }
    if (covering.validTo === lastDay) return { ok: true }
    await tx.update(contractVehicleAssignments)
      .set({ validTo: lastDay, updatedAt: new Date().toISOString() })
      .where(eq(contractVehicleAssignments.id, covering.id))
    await recordAudit({
      ...base, action: "update", entityId: covering.id, worksiteId: covering.worksiteId ?? undefined,
      oldState: { validTo: covering.validTo }, newState: { validTo: lastDay },
      reason: reason ?? "Equipo retirado del contrato",
    }, tx)
    return { ok: true }
  })
}

/**
 * El equipo cambia de faena desde `effectiveFrom`: sus asignaciones dejan de
 * regir ese día. Las que cubren el día se cierran el día anterior (también las
 * que ya traían término del contrato) y las que empiezan ese día o después se
 * borran, porque cerrarlas dejaría `valid_to < valid_from`. Corre dentro de la
 * transacción de quien traslada el equipo; devuelve cuántas asignaciones tocó.
 */
export async function closeContractAssignmentsOnRelocationTx(
  tx: Tx,
  input: { vehicleId: string; effectiveFrom: string; actorUserId: string; actorEmail?: string | null },
): Promise<number> {
  const affected = await tx.select({ assignment: contractVehicleAssignments, worksiteId: contracts.worksiteId })
    .from(contractVehicleAssignments)
    .innerJoin(contracts, eq(contracts.id, contractVehicleAssignments.contractId))
    .where(and(
      eq(contractVehicleAssignments.vehicleId, input.vehicleId),
      or(isNull(contractVehicleAssignments.validTo), gte(contractVehicleAssignments.validTo, input.effectiveFrom)),
    ))
    .orderBy(asc(contractVehicleAssignments.validFrom))
  const reason = "Traslado del equipo a otra faena: su contrato deja de regir"
  const closedTo = addDaysToPlainDate(input.effectiveFrom, -1)
  for (const { assignment, worksiteId } of affected) {
    const base = {
      userId: input.actorUserId, userEmail: input.actorEmail ?? undefined, entityType: ENTITY, entityId: assignment.id,
      worksiteId: worksiteId ?? undefined, reason,
    }
    if (assignment.validFrom >= input.effectiveFrom) {
      await tx.delete(contractVehicleAssignments).where(eq(contractVehicleAssignments.id, assignment.id))
      await recordAudit({
        ...base, action: "delete",
        oldState: { contractId: assignment.contractId, validFrom: assignment.validFrom, validTo: assignment.validTo },
      }, tx)
      continue
    }
    await tx.update(contractVehicleAssignments)
      .set({ validTo: closedTo, updatedAt: new Date().toISOString() })
      .where(eq(contractVehicleAssignments.id, assignment.id))
    await recordAudit({
      ...base, action: "update", oldState: { validTo: assignment.validTo }, newState: { validTo: closedTo },
    }, tx)
  }
  return affected.length
}

/**
 * ¿Puede cambiarse el contrato sin dejar equipos colgando? Devuelve `null` si sí,
 * o el mensaje que ve quien edita. Lo usan Facturación y la faena antes de
 * guardar un contrato con equipos asignados.
 *
 * Fijar o adelantar el término NO se rechaza por tener equipos abiertos: es el
 * caso normal («este contrato termina el 31-12»). Quien guarda llama después a
 * `capContractAssignmentsTx` en la misma transacción y las asignaciones que
 * pasaban de esa fecha terminan con el contrato. Sólo se rechaza un término
 * anterior al inicio de alguna asignación, porque acotarla dejaría
 * `valid_to < valid_from`.
 */
export async function assertContractChangeKeepsAssignmentsTx(
  tx: Tx,
  contractId: string,
  next: { worksiteId: string | null; startDate: string | null; endDate: string | null; status: "active" | "suspended" | "closed" },
): Promise<string | null> {
  const assignments = await tx.select().from(contractVehicleAssignments).where(eq(contractVehicleAssignments.contractId, contractId))
  if (assignments.length === 0) return null
  const [contract] = await tx.select({ code: contracts.code, worksiteId: contracts.worksiteId, status: contracts.status })
    .from(contracts).where(eq(contracts.id, contractId)).limit(1)
  if (!contract) return null

  const label = `El contrato ${contract.code} tiene equipos asignados`
  if (next.worksiteId !== contract.worksiteId) {
    return `${label}: no se puede cambiar su faena. Quita o traslada los equipos primero`
  }
  const firstFrom = assignments.reduce((min, row) => (row.validFrom < min ? row.validFrom : min), assignments[0]!.validFrom)
  if (next.startDate !== null && next.startDate > firstFrom) {
    return `${label} desde el ${firstFrom}: el contrato no puede empezar después`
  }
  if (next.endDate !== null) {
    const lastFrom = assignments.reduce((max, row) => (row.validFrom > max ? row.validFrom : max), assignments[0]!.validFrom)
    if (next.endDate < lastFrom) return `${label} desde el ${lastFrom}: el contrato no puede terminar antes de esa fecha`
  }
  // El estado se evalúa DESPUÉS de acotar: cuenta el término efectivo de cada
  // asignación (el suyo o el del contrato, el menor). Una asignación que sigue
  // más allá de hoy —abierta o con un término futuro heredado— seguiría sumando
  // costo a un contrato cerrado o suspendido.
  const today = todayInChile()
  let openEnded = false
  let lastInForce: string | null = null
  for (const row of assignments) {
    const effective = next.endDate !== null && (row.validTo === null || row.validTo > next.endDate) ? next.endDate : row.validTo
    if (effective === null) openEnded = true
    else if (effective > today && (lastInForce === null || effective > lastInForce)) lastInForce = effective
  }
  if (next.status !== contract.status && next.status !== "active" && (openEnded || lastInForce !== null)) {
    const verb = next.status === "closed" ? "cerrar" : "suspender"
    return openEnded
      ? `${label} sin término: fija el término (hoy o antes) o quítalos antes de ${verb} el contrato`
      : `${label} hasta el ${lastInForce}: fija el término en hoy o antes, o quítalos, antes de ${verb} el contrato`
  }
  return null
}

/**
 * El contrato termina el `endDate` (inclusive): toda asignación suya que seguía
 * abierta o pasaba de ese día termina con él. Va en la misma transacción que el
 * guardado del contrato, después de `assertContractChangeKeepsAssignmentsTx`.
 * Devuelve cuántas asignaciones cambió.
 */
export async function capContractAssignmentsTx(tx: Tx, contractId: string, endDate: string, actor: AssignmentActor): Promise<number> {
  const affected = await tx.select({
    assignment: contractVehicleAssignments, code: fuelVehicles.code, plate: fuelVehicles.plate, worksiteId: contracts.worksiteId,
  }).from(contractVehicleAssignments)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, contractVehicleAssignments.vehicleId))
    .innerJoin(contracts, eq(contracts.id, contractVehicleAssignments.contractId))
    .where(and(
      eq(contractVehicleAssignments.contractId, contractId),
      or(isNull(contractVehicleAssignments.validTo), gt(contractVehicleAssignments.validTo, endDate)),
    ))
    .orderBy(asc(contractVehicleAssignments.vehicleId))
  for (const { assignment, code, plate, worksiteId } of affected) {
    await tx.update(contractVehicleAssignments)
      .set({ validTo: endDate, updatedAt: new Date().toISOString() })
      .where(eq(contractVehicleAssignments.id, assignment.id))
    await recordAudit({
      userId: actor.userId, userEmail: actor.email ?? undefined, action: "update", entityType: ENTITY, entityId: assignment.id,
      entityCode: vehicleLabel({ code, plate }), worksiteId: worksiteId ?? undefined,
      oldState: { validTo: assignment.validTo }, newState: { validTo: endDate },
      reason: "Término del contrato",
    }, tx)
  }
  return affected.length
}

/** Último día civil del mes de `day` (`YYYY-MM-DD`). */
function lastDayOfMonth(day: string): string {
  const last = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate()
  return `${day.slice(0, 7)}-${String(last).padStart(2, "0")}`
}

/**
 * Ventanas de asignación de los equipos que tocan los meses completos de `from`
 * a `to`. Se toman meses enteros porque el consumo de proveedor llega como
 * agregado mensual fechado el día 1 y su reparto mira el mes completo: una
 * ventana que empieza después de `to` pero dentro de su mes lo vuelve
 * «Por repartir».
 */
export async function listAssignmentWindows(vehicleIds: readonly string[], from: string, to: string, client: DB = db): Promise<AssignmentWindow[]> {
  if (vehicleIds.length === 0) return []
  const monthStart = `${from.slice(0, 7)}-01`
  const monthEnd = lastDayOfMonth(to)
  const found = await client.select({
    vehicleId: contractVehicleAssignments.vehicleId, contractId: contractVehicleAssignments.contractId, worksiteId: contracts.worksiteId,
    validFrom: contractVehicleAssignments.validFrom, validTo: contractVehicleAssignments.validTo,
  }).from(contractVehicleAssignments)
    .innerJoin(contracts, eq(contracts.id, contractVehicleAssignments.contractId))
    .where(and(
      inArray(contractVehicleAssignments.vehicleId, [...vehicleIds]),
      isNotNull(contracts.worksiteId),
      lte(contractVehicleAssignments.validFrom, monthEnd),
      or(isNull(contractVehicleAssignments.validTo), gte(contractVehicleAssignments.validTo, monthStart)),
    ))
    .orderBy(asc(contractVehicleAssignments.vehicleId), asc(contractVehicleAssignments.validFrom))
  return found.flatMap((row) => (row.worksiteId ? [{ ...row, worksiteId: row.worksiteId }] : []))
}

export interface VehicleAssignmentRow {
  id: string
  contractId: string
  contractName: string
  contractCode: string
  contractStatus: "active" | "suspended" | "closed"
  validFrom: string
  validTo: string | null
  reason: string | null
}

/** Historia de contratos de un equipo, la más reciente primero. */
export async function listVehicleAssignmentHistory(vehicleId: string, client: DB = db): Promise<VehicleAssignmentRow[]> {
  return client.select({
    id: contractVehicleAssignments.id, contractId: contractVehicleAssignments.contractId,
    contractName: contracts.name, contractCode: contracts.code, contractStatus: contracts.status,
    validFrom: contractVehicleAssignments.validFrom, validTo: contractVehicleAssignments.validTo, reason: contractVehicleAssignments.reason,
  }).from(contractVehicleAssignments)
    .innerJoin(contracts, eq(contracts.id, contractVehicleAssignments.contractId))
    .where(eq(contractVehicleAssignments.vehicleId, vehicleId))
    .orderBy(desc(contractVehicleAssignments.validFrom))
}
