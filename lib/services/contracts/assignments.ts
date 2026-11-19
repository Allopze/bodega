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

    const existing = await tx.select().from(contractVehicleAssignments)
      .where(inArray(contractVehicleAssignments.vehicleId, vehicleIds))
      .orderBy(asc(contractVehicleAssignments.vehicleId), asc(contractVehicleAssignments.validFrom))
    const existingByVehicle = new Map<string, AssignmentRow[]>()
    for (const row of existing) existingByVehicle.set(row.vehicleId, [...(existingByVehicle.get(row.vehicleId) ?? []), row])

    // Primera pasada: sólo valida y decide; nada se escribe hasta que todo el lote pasa.
    type Plan =
      | { kind: "skip" }
      | { kind: "insert"; closeOpen: AssignmentRow | null }
      | { kind: "correct"; row: AssignmentRow }
    const plans = new Map<string, Plan>()
    for (const id of vehicleIds) {
      const rows = existingByVehicle.get(id) ?? []
      const blocking = rows.find((row) => row.validFrom > validFrom || (row.validTo !== null && covers(row, validFrom)))
      if (blocking) {
        return { ok: false, message: `${vehicleLabel(byId.get(id)!)} ya tiene una asignación desde ${blocking.validFrom}; corrígela desde su ficha` }
      }
      const open = rows.find((row) => row.validTo === null) ?? null
      if (open && open.contractId === contractId) plans.set(id, { kind: "skip" })
      else if (open && open.validFrom === validFrom) plans.set(id, { kind: "correct", row: open })
      else plans.set(id, { kind: "insert", closeOpen: open })
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
        // Primero se cierra la vigente: el índice único admite una sola abierta por equipo.
        const closedTo = addDaysToPlainDate(validFrom, -1)
        await tx.update(contractVehicleAssignments)
          .set({ validTo: closedTo, updatedAt: new Date().toISOString() })
          .where(eq(contractVehicleAssignments.id, plan.closeOpen.id))
        await recordAudit({
          userId: actor.userId, userEmail: actor.email ?? undefined, action: "update", entityType: ENTITY, entityId: plan.closeOpen.id,
          entityCode: vehicleLabel(vehicle), worksiteId,
          oldState: { validTo: null }, newState: { validTo: closedTo },
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
 * Quita un equipo de su contrato: la asignación que cubre `lastDay` (o la
 * vigente) termina ese día, inclusive. Funciona también con una asignación que
 * heredó el término del contrato.
 */
export async function endVehicleAssignment(actor: AssignmentActor, input: unknown, client: DB = db): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = endAssignmentSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const { vehicleId, lastDay, reason } = parsed.data

  return client.transaction(async (tx): Promise<{ ok: true } | { ok: false; message: string }> => {
    const [vehicle] = await tx.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate })
      .from(fuelVehicles).where(eq(fuelVehicles.id, vehicleId)).limit(1).for("update")
    if (!vehicle) return { ok: false, message: "El equipo no existe" }
    const [current] = await tx.select({ assignment: contractVehicleAssignments, worksiteId: contracts.worksiteId })
      .from(contractVehicleAssignments)
      .innerJoin(contracts, eq(contracts.id, contractVehicleAssignments.contractId))
      .where(and(
        eq(contractVehicleAssignments.vehicleId, vehicleId),
        lte(contractVehicleAssignments.validFrom, lastDay),
        or(isNull(contractVehicleAssignments.validTo), gte(contractVehicleAssignments.validTo, lastDay)),
      ))
      .orderBy(desc(contractVehicleAssignments.validFrom))
      .limit(1)
    if (!current) {
      return { ok: false, message: `${vehicleLabel(vehicle)} no tiene una asignación de contrato que cubra el ${lastDay}` }
    }
    if (current.assignment.validTo === lastDay) return { ok: true }
    await tx.update(contractVehicleAssignments)
      .set({ validTo: lastDay, updatedAt: new Date().toISOString() })
      .where(eq(contractVehicleAssignments.id, current.assignment.id))
    await recordAudit({
      userId: actor.userId, userEmail: actor.email ?? undefined, action: "update", entityType: ENTITY, entityId: current.assignment.id,
      entityCode: vehicleLabel(vehicle), worksiteId: current.worksiteId ?? undefined,
      oldState: { validTo: current.assignment.validTo }, newState: { validTo: lastDay },
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
  // El estado se evalúa DESPUÉS de acotar: con término, ya no quedan asignaciones abiertas.
  const openAfterCap = next.endDate === null && assignments.some((row) => row.validTo === null)
  if (next.status !== contract.status && next.status !== "active" && openAfterCap) {
    return `${label} vigentes: quítalos o fija el término antes de ${next.status === "closed" ? "cerrar" : "suspender"} el contrato`
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

/**
 * Ventanas de asignación de los equipos que tocan el rango que va desde el
 * primer día del mes de `from` hasta `to`. Se parte del mes porque el consumo de
 * proveedor llega como agregado mensual fechado el día 1.
 */
export async function listAssignmentWindows(vehicleIds: readonly string[], from: string, to: string, client: DB = db): Promise<AssignmentWindow[]> {
  if (vehicleIds.length === 0) return []
  const monthStart = `${from.slice(0, 7)}-01`
  const found = await client.select({
    vehicleId: contractVehicleAssignments.vehicleId, contractId: contractVehicleAssignments.contractId, worksiteId: contracts.worksiteId,
    validFrom: contractVehicleAssignments.validFrom, validTo: contractVehicleAssignments.validTo,
  }).from(contractVehicleAssignments)
    .innerJoin(contracts, eq(contracts.id, contractVehicleAssignments.contractId))
    .where(and(
      inArray(contractVehicleAssignments.vehicleId, [...vehicleIds]),
      isNotNull(contracts.worksiteId),
      lte(contractVehicleAssignments.validFrom, to),
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
  validFrom: string
  validTo: string | null
  reason: string | null
}

/** Historia de contratos de un equipo, la más reciente primero. */
export async function listVehicleAssignmentHistory(vehicleId: string, client: DB = db): Promise<VehicleAssignmentRow[]> {
  return client.select({
    id: contractVehicleAssignments.id, contractId: contractVehicleAssignments.contractId,
    contractName: contracts.name, contractCode: contracts.code,
    validFrom: contractVehicleAssignments.validFrom, validTo: contractVehicleAssignments.validTo, reason: contractVehicleAssignments.reason,
  }).from(contractVehicleAssignments)
    .innerJoin(contracts, eq(contracts.id, contractVehicleAssignments.contractId))
    .where(eq(contractVehicleAssignments.vehicleId, vehicleId))
    .orderBy(desc(contractVehicleAssignments.validFrom))
}
