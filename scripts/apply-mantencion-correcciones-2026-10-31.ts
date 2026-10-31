/**
 * scripts/apply-mantencion-correcciones-2026-10-31.ts
 *
 * Correcciones de datos del módulo de mantención sobre bases que ya cargaron el
 * seed. El seed sólo inserta —no corrige filas existentes—, así que lo que se
 * cambia en `db/seed/mantencion-seed.json` no llega a una base ya sembrada.
 *
 * - **(a) Descripción de las pautas.** Reemplaza `mant_schedules.origin` de las
 *   dos pautas sembradas (se identifican por nombre) cuando aún tiene el texto
 *   viejo, que nombraba el archivo de origen. Si alguien ya la editó, no se toca.
 * - **(b) Correcciones de equipos de P3.** `P3_APPROVED` va VACÍA: las casillas
 *   de `docs/mantencion/propuesta-correcciones-seed-2026-10-31.md` que Alexis
 *   marque «Sí» se cargan ahí. Sin aprobaciones no hace nada con los equipos.
 *
 * Idempotente: cada acción comprueba el estado esperado y se salta si ya no
 * coincide. Todo va en UNA transacción y deja `audit_log` a nombre de
 * `--actor-email`. Sin `--apply` sólo informa (la transacción se deshace).
 *
 *   npx tsx scripts/apply-mantencion-correcciones-2026-10-31.ts --actor-email <correo>            # dry-run
 *   npx tsx scripts/apply-mantencion-correcciones-2026-10-31.ts --actor-email <correo> --apply    # escribe
 *
 * Se aplica una vez, a mano; no forma parte del deploy.
 */
import { pathToFileURL } from "node:url"
import { and, count, eq, isNull } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  fuelEquipmentTypes, fuelMeterReadings, fuelVehicles, mantEquipmentHistory, mantEquipmentProfiles,
  mantRecords, mantSchedules, users, type MantFieldChanges,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { nameKey, normalizeCode } from "@/lib/mantencion/normalize"

const REASON = "Correcciones de datos de mantención (2026-10-31)"

/* ── (a) Descripción de las pautas ───────────────────────────────────────── */

export const SCHEDULE_ORIGIN_FIXES = [
  {
    name: "Camiones y tractos",
    oldOrigin: "Planilla «Diferencias actividades por equipo».",
    newOrigin: "Mantención preventiva por kilometraje de camiones y tractos, según la planilla de actividades de la jefatura.",
  },
  {
    name: "Maquinaria pesada",
    oldOrigin: "Formulario «PAUTA MANTENCION PREVENTIVA MAQUINARIA». Falta definir qué ítems van en cada intervalo: por ahora todos aparecen en todos.",
    newOrigin: "Mantención preventiva por horas de la maquinaria pesada, según el formulario de la jefatura. Mientras no se defina qué ítems van en cada intervalo, todos aparecen en todos.",
  },
] as const

/* ── (b) Equipos de P3: sólo lo que Alexis apruebe ───────────────────────── */

/**
 * - `renombrar-codigo`: cambia el código interno de la ficha. `plateExpected` es
 *   la patente que la ficha debe tener hoy; si no coincide, no se toca.
 * - `patente-real`: el identificador (que la planilla repite como patente) es una
 *   patente de verdad: se quita la marca «Sin patente» del perfil.
 * - `a-horas`: el equipo es de horas, no de km. Pasa al tipo indicado
 *   (p. ej. «Grúa horquilla») con horómetro y a la pauta indicada
 *   (p. ej. «Maquinaria pesada»). No se aplica si ya tiene lecturas o registros
 *   en km: eso se resuelve a mano.
 */
export type P3Correction =
  | { kind: "renombrar-codigo"; code: string; newCode: string; plateExpected: string }
  | { kind: "patente-real"; code: string }
  | { kind: "a-horas"; code: string; typeName: string; scheduleName: string }

/** Vacía hasta que Alexis responda la propuesta. Ver el documento para el contenido de cada caso. */
export const P3_APPROVED: readonly P3Correction[] = []

/* ── Informe ─────────────────────────────────────────────────────────────── */

type Result = "aplicado" | "dry-run" | "ya estaba" | "omitido"
export interface Outcome { item: string; action: string; result: Result; detail?: string }
type Actor = { userId: string; email: string }

class DryRunRollback extends Error {}

async function fixScheduleOrigins(tx: Tx, apply: boolean, actor: Actor, out: Outcome[]) {
  for (const fix of SCHEDULE_ORIGIN_FIXES) {
    const item = fix.name
    const [row] = await tx.select().from(mantSchedules)
      .where(and(eq(mantSchedules.nameKey, nameKey(fix.name)), isNull(mantSchedules.deletedAt)))
    if (!row) { out.push({ item, action: "descripción de la pauta", result: "omitido", detail: "no hay una pauta viva con ese nombre" }); continue }
    if (row.origin === fix.newOrigin) { out.push({ item, action: "descripción de la pauta", result: "ya estaba" }); continue }
    if (row.origin !== fix.oldOrigin) { out.push({ item, action: "descripción de la pauta", result: "omitido", detail: "ya fue editada a mano; no se pisa" }); continue }
    await tx.update(mantSchedules).set({ origin: fix.newOrigin }).where(eq(mantSchedules.id, row.id))
    await recordAudit({
      userId: actor.userId, userEmail: actor.email, action: "update", entityType: "mant_schedule", entityId: row.id,
      entityCode: row.name, oldState: { origin: row.origin }, newState: { origin: fix.newOrigin }, reason: REASON,
    }, tx)
    out.push({ item, action: "descripción de la pauta", result: apply ? "aplicado" : "dry-run" })
  }
}

async function history(tx: Tx, actor: Actor, vehicleId: string, action: "update" | "schedule_change", summary: string, changes: MantFieldChanges) {
  await tx.insert(mantEquipmentHistory).values({ id: nanoid(), vehicleId, action, summary, changes, userId: actor.userId })
}

async function applyP3(tx: Tx, apply: boolean, actor: Actor, approved: readonly P3Correction[], out: Outcome[]) {
  if (approved.length === 0) {
    out.push({ item: "equipos P3", action: "correcciones aprobadas", result: "omitido", detail: "P3_APPROVED está vacía: sin aprobaciones de Alexis no se toca ningún equipo" })
    return
  }
  const result = (): Result => (apply ? "aplicado" : "dry-run")
  for (const fix of approved) {
    const item = normalizeCode(fix.code)
    const label = fix.kind
    const rows = await tx.select().from(fuelVehicles).where(eq(fuelVehicles.code, item))
    if (fix.kind === "renombrar-codigo") {
      const already = await tx.select({ id: fuelVehicles.id }).from(fuelVehicles).where(eq(fuelVehicles.code, normalizeCode(fix.newCode)))
      if (rows.length === 0 && already.length > 0) { out.push({ item, action: label, result: "ya estaba", detail: `ya existe ${fix.newCode}` }); continue }
      if (rows.length !== 1) { out.push({ item, action: label, result: "omitido", detail: `hay ${rows.length} fichas con ese código` }); continue }
      if (already.length > 0) { out.push({ item, action: label, result: "omitido", detail: `${fix.newCode} ya lo usa otra ficha` }); continue }
      const v = rows[0]!
      if (normalizeCode(v.plate) !== normalizeCode(fix.plateExpected)) { out.push({ item, action: label, result: "omitido", detail: `la ficha tiene la patente ${v.plate}, no ${fix.plateExpected}` }); continue }
      const newCode = normalizeCode(fix.newCode)
      await tx.update(fuelVehicles).set({ code: newCode, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, v.id))
      await history(tx, actor, v.id, "update", `Corrección de datos: el código pasa de ${item} a ${newCode}.`, { "código": { from: item, to: newCode } })
      await recordAudit({ userId: actor.userId, userEmail: actor.email, action: "update", entityType: "fuel_vehicle", entityId: v.id, entityCode: newCode, oldState: { code: item }, newState: { code: newCode }, reason: REASON, worksiteId: v.worksiteId }, tx)
      out.push({ item, action: `${label} → ${newCode}`, result: result() })
      continue
    }
    if (rows.length !== 1) { out.push({ item, action: label, result: "omitido", detail: `hay ${rows.length} fichas con ese código` }); continue }
    const v = rows[0]!
    const [profile] = await tx.select().from(mantEquipmentProfiles).where(eq(mantEquipmentProfiles.vehicleId, v.id))
    if (!profile) { out.push({ item, action: label, result: "omitido", detail: "la ficha no tiene perfil de mantención" }); continue }

    if (fix.kind === "patente-real") {
      if (!profile.noPlate) { out.push({ item, action: label, result: "ya estaba" }); continue }
      await tx.update(mantEquipmentProfiles).set({ noPlate: false, updatedAt: new Date().toISOString(), updatedBy: actor.userId }).where(eq(mantEquipmentProfiles.vehicleId, v.id))
      await history(tx, actor, v.id, "update", `Corrección de datos: ${v.plate} es una patente real, se quita «Sin patente».`, { "sin patente": { from: true, to: false } })
      await recordAudit({ userId: actor.userId, userEmail: actor.email, action: "update", entityType: "mant_equipment_profile", entityId: v.id, entityCode: item, oldState: { noPlate: true }, newState: { noPlate: false }, reason: REASON, worksiteId: v.worksiteId }, tx)
      out.push({ item, action: label, result: result() })
      continue
    }

    // a-horas
    const [type] = await tx.select().from(fuelEquipmentTypes).where(eq(fuelEquipmentTypes.name, fix.typeName))
    const [schedule] = await tx.select().from(mantSchedules).where(and(eq(mantSchedules.nameKey, nameKey(fix.scheduleName)), isNull(mantSchedules.deletedAt)))
    if (!type || type.defaultMeterType !== "hour_meter") { out.push({ item, action: label, result: "omitido", detail: `el tipo «${fix.typeName}» no existe o no se mide en horas` }); continue }
    if (!schedule || schedule.unit !== "h") { out.push({ item, action: label, result: "omitido", detail: `la pauta «${fix.scheduleName}» no existe o no está en horas` }); continue }
    if (v.equipmentTypeId === type.id && v.meterType === "hour_meter" && profile.scheduleId === schedule.id) { out.push({ item, action: label, result: "ya estaba" }); continue }
    const [readings] = await tx.select({ n: count() }).from(fuelMeterReadings).where(eq(fuelMeterReadings.vehicleId, v.id))
    const [records] = await tx.select({ n: count() }).from(mantRecords).where(eq(mantRecords.vehicleId, v.id))
    if ((readings?.n ?? 0) > 0 || (records?.n ?? 0) > 0 || profile.initialReading != null) {
      out.push({ item, action: label, result: "omitido", detail: `ya tiene ${readings?.n ?? 0} lecturas, ${records?.n ?? 0} registros o lectura inicial en km: resolver a mano` })
      continue
    }
    await tx.update(fuelVehicles).set({
      type: type.name, equipmentTypeId: type.id, meterType: type.defaultMeterType, performanceUnit: type.defaultPerformanceUnit,
      updatedAt: new Date().toISOString(),
    }).where(eq(fuelVehicles.id, v.id))
    await tx.update(mantEquipmentProfiles).set({ scheduleId: schedule.id, updatedAt: new Date().toISOString(), updatedBy: actor.userId }).where(eq(mantEquipmentProfiles.vehicleId, v.id))
    await history(tx, actor, v.id, "schedule_change", `Corrección de datos: pasa de ${v.type} (km) a ${type.name} (horas), con la pauta ${schedule.name}.`, {
      tipo: { from: v.type, to: type.name }, unidad: { from: "km", to: "h" }, pauta: { from: profile.scheduleId, to: schedule.id },
    })
    await recordAudit({ userId: actor.userId, userEmail: actor.email, action: "update", entityType: "fuel_vehicle", entityId: v.id, entityCode: item, oldState: { type: v.type, meterType: v.meterType, scheduleId: profile.scheduleId }, newState: { type: type.name, meterType: type.defaultMeterType, scheduleId: schedule.id }, reason: REASON, worksiteId: v.worksiteId }, tx)
    out.push({ item, action: `${label} → ${type.name} / ${schedule.name}`, result: result() })
  }
}

/** Aplica las correcciones (o sólo informa, sin `apply`). `approved` existe para las pruebas. */
export async function applyMantencionCorrecciones20261031(
  options: { actorEmail: string; apply?: boolean; approved?: readonly P3Correction[] },
): Promise<Outcome[]> {
  const apply = options.apply ?? false
  const approved = options.approved ?? P3_APPROVED
  const actorRow = await db.query.users.findFirst({ where: and(eq(users.email, options.actorEmail), eq(users.isActive, true)), columns: { id: true, email: true } })
  if (!actorRow) throw new Error(`No hay un usuario activo con el correo ${options.actorEmail}: la bitácora necesita un responsable.`)
  const actor = { userId: actorRow.id, email: actorRow.email }
  const outcomes: Outcome[] = []
  try {
    await db.transaction(async (tx) => {
      await fixScheduleOrigins(tx, apply, actor, outcomes)
      await applyP3(tx, apply, actor, approved, outcomes)
      // El dry-run corre el mismo código y lo deshace: lo que informa es lo que `--apply` haría.
      if (!apply) throw new DryRunRollback()
    })
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error
  }
  return outcomes
}

export function printMantencionOutcomes(outcomes: Outcome[], apply: boolean) {
  for (const o of outcomes) console.log(`${o.item.padEnd(20)} ${o.action.padEnd(52)} ${o.result}${o.detail ? ` — ${o.detail}` : ""}`)
  const n = (result: Result) => outcomes.filter((o) => o.result === result).length
  console.log(`\n${apply ? `${n("aplicado")} aplicada(s)` : `${n("dry-run")} por aplicar (dry-run)`}, ${n("ya estaba")} ya estaban, ${n("omitido")} omitida(s).`)
}

export async function main(argv = process.argv) {
  const apply = argv.includes("--apply")
  const actorEmail = argv[argv.indexOf("--actor-email") + 1]
  if (!argv.includes("--actor-email") || !actorEmail || actorEmail.startsWith("--")) throw new Error("Falta --actor-email <correo>: la bitácora necesita un responsable.")
  console.log(`Correcciones de mantención 2026-10-31 — ${apply ? "escribiendo" : "dry-run"}\n`)
  printMantencionOutcomes(await applyMantencionCorrecciones20261031({ actorEmail, apply }), apply)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}
