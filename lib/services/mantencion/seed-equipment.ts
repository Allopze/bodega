import { and, eq, isNull } from "drizzle-orm"
import {
  fuelEquipmentTypes, fuelVehicles, mantEquipmentHistory, mantEquipmentProfiles, roles, userInvitations, userRoles,
  users, worksiteUsers, type MantFieldChanges,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { plateMatchKey } from "@/lib/combustibles/xlsx-utils"
import { cleanName, nameKey, normalizeCode, resolvePlate } from "@/lib/mantencion/normalize"
import type { SeedContext, SeededType, WorksiteMap } from "./seed"
import type { SeededSchedule } from "./seed-schedules"
import { unitFromMeter } from "./fleet"

/**
 * Carga de los 120 equipos y de los mecánicos (§13).
 *
 * Equipos: se concilian con la flota (`fuel_vehicles`) por código normalizado y
 * luego por patente. Uno existente NO se sobrescribe: se le crea el perfil de
 * mantención si falta, se completan sus campos nulos (código, marca, modelo,
 * año) y las demás diferencias con la planilla se REPORTAN. Uno nuevo se inserta
 * como equipo de flota con su perfil. Nunca duplica.
 */

type Vehicle = typeof fuelVehicles.$inferSelect
type VehicleInsert = typeof fuelVehicles.$inferInsert
type HistoryInsert = typeof mantEquipmentHistory.$inferInsert

export async function seedEquipment(
  ctx: SeedContext,
  lookups: {
    types: Map<string, SeededType>
    brands: Map<string, { id: string; name: string }>
    schedules: Map<string, SeededSchedule>
    worksites: WorksiteMap
  },
): Promise<void> {
  const { tx, data, report, actorUserId } = ctx
  const stats = report.equipment

  const fleetTypes = await tx.select().from(fuelEquipmentTypes)
  const typeById = new Map(fleetTypes.map((type) => [type.id, type]))
  const worksiteName = new Map([...lookups.worksites.values()].map((worksite) => [worksite.id, worksite.name]))

  const vehicles = await tx.select().from(fuelVehicles)
  const byCode = new Map<string, Vehicle[]>()
  const byPlate = new Map<string, Vehicle[]>()
  const index = (vehicle: Vehicle) => {
    if (vehicle.code) push(byCode, normalizeCode(vehicle.code), vehicle)
    push(byPlate, plateMatchKey(vehicle.plate), vehicle)
  }
  vehicles.forEach(index)
  const withProfile = new Set((await tx.select({ id: mantEquipmentProfiles.vehicleId }).from(mantEquipmentProfiles)).map((row) => row.id))

  const newVehicles: VehicleInsert[] = []
  const newProfiles: Array<typeof mantEquipmentProfiles.$inferInsert> = []
  const history: HistoryInsert[] = []
  const fills: Array<{ id: string; values: Partial<VehicleInsert> }> = []

  for (const equipo of data.equipos) {
    const code = normalizeCode(equipo.codigo)
    const skip = (reason: string) => stats.skipped.push({ code, reason })
    const type = lookups.types.get(nameKey(equipo.tipo))
    const brand = lookups.brands.get(nameKey(equipo.marca))
    const schedule = lookups.schedules.get(equipo.pautaId)
    const worksite = lookups.worksites.get(nameKey(equipo.faena))
    if (!type) { skip(`el tipo «${equipo.tipo}» no está disponible (ver problemas de tipos)`); continue }
    if (!brand || !schedule || !worksite) { skip("falta la marca, la pauta o la faena en la carga"); continue }

    // «Sin patente» (§16-16): la planilla repite el código en la columna de patente.
    const noPlate = normalizeCode(equipo.patente) === code
    const plate = resolvePlate(equipo.patente, code, noPlate)
    if (!plate.ok) { skip(plate.message); continue }
    const plateKey = plateMatchKey(plate.plate)

    const byCodeRows = byCode.get(code) ?? []
    const byPlateRows = byPlate.get(plateKey) ?? []
    const matches = byCodeRows.length > 0 ? byCodeRows : byPlateRows
    if (matches.length > 1) { skip(`hay ${matches.length} equipos en la flota con ese ${byCodeRows.length > 0 ? "código" : "número de patente"}; no se eligió ninguno`); continue }
    const found = matches[0]

    let vehicleId: string
    let vehicleUnit = type.unit
    if (found) {
      vehicleId = found.id
      stats.existing++
      const foundType = typeById.get(found.equipmentTypeId)
      vehicleUnit = unitFromMeter(foundType?.defaultMeterType ?? "none") ?? type.unit
      const fill: Partial<VehicleInsert> = {}
      const changes: MantFieldChanges = {}
      const diff = (field: string, fleet: string, seed: string) => stats.differences.push({ code, field, fleet, seed })

      if (byCodeRows.length === 0) {
        if (!found.code) { fill.code = code; changes["código"] = { from: null, to: code } }
        else diff("código", found.code, code)
      }
      if (found.equipmentTypeId !== type.id) diff("tipo", foundType?.name ?? found.type, type.name)
      if (nameKey(found.brand ?? "") && nameKey(found.brand ?? "") !== nameKey(brand.name)) diff("marca", found.brand ?? "", brand.name)
      else if (!nameKey(found.brand ?? "")) { fill.brand = brand.name; changes["marca"] = { from: null, to: brand.name } }
      const model = cleanName(equipo.modelo)
      if (model) {
        if (nameKey(found.model ?? "") && nameKey(found.model ?? "") !== nameKey(model)) diff("modelo", found.model ?? "", model)
        else if (!nameKey(found.model ?? "")) { fill.model = model; changes["modelo"] = { from: null, to: model } }
      }
      if (equipo.anio != null) {
        if (found.year != null && found.year !== equipo.anio) diff("año", String(found.year), String(equipo.anio))
        else if (found.year == null) { fill.year = equipo.anio; changes["año"] = { from: null, to: equipo.anio } }
      }
      if (found.worksiteId !== worksite.id) diff("faena", worksiteName.get(found.worksiteId) ?? found.worksiteId, worksite.name)
      if (plateMatchKey(found.plate) !== plateKey) {
        const holder = byPlateRows.find((other) => other.id !== found.id)
        diff("patente", holder ? `${found.plate} (y la patente de la planilla la tiene otro equipo de la flota)` : found.plate, plate.plate)
      }
      if (!found.isActive) diff("estado", "inactivo en la flota", "activo")

      if (Object.keys(fill).length > 0) {
        fills.push({ id: found.id, values: fill })
        stats.filledFromSeed++
        history.push({ id: nanoid(), vehicleId, action: "import", summary: "Carga inicial: se completaron datos vacíos de la ficha con la planilla de inventario.", changes, userId: actorUserId })
      }
    } else {
      vehicleId = nanoid()
      stats.created++
      const row: VehicleInsert = {
        id: vehicleId, plate: plate.plate, code, type: type.name, equipmentTypeId: type.id,
        meterType: type.meterType, performanceUnit: type.performanceUnit,
        brand: brand.name, model: cleanName(equipo.modelo) || null, year: equipo.anio, worksiteId: worksite.id, isActive: true,
      }
      newVehicles.push(row)
      // Se indexa para que una repetición dentro del mismo archivo no inserte dos veces.
      index(row as Vehicle)
    }

    if (withProfile.has(vehicleId)) { stats.profilesExisting++; continue }
    withProfile.add(vehicleId)
    // Una pauta en km sobre un equipo cuyo tipo en flota se mide en h rompería el estado: se deja sin pauta y se avisa.
    const scheduleFits = schedule.unit === vehicleUnit
    if (!scheduleFits) stats.differences.push({ code, field: "pauta", fleet: `su tipo en flota se mide en ${vehicleUnit}`, seed: `${schedule.name} (${schedule.unit}); queda sin pauta` })
    newProfiles.push({ vehicleId, brandId: brand.id, scheduleId: scheduleFits ? schedule.id : null, noPlate: plate.noPlate, updatedBy: actorUserId })
    stats.profilesCreated++
    history.push({
      id: nanoid(), vehicleId, action: "import", userId: actorUserId, changes: {},
      summary: found
        ? "Carga inicial: se agregó el perfil de mantención al equipo existente de la flota."
        : "Alta en la carga inicial de mantención (planilla de inventario del 21-08-2026).",
    })
  }

  if (newVehicles.length > 0) await tx.insert(fuelVehicles).values(newVehicles)
  for (const fill of fills) await tx.update(fuelVehicles).set({ ...fill.values, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, fill.id))
  if (newProfiles.length > 0) await tx.insert(mantEquipmentProfiles).values(newProfiles)
  if (history.length > 0) await tx.insert(mantEquipmentHistory).values(history)
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/**
 * Mecánicos (§13): cuentas con el rol `mecanico` y su faena. Se busca el usuario
 * por nombre normalizado (o por el correo que dio quien corre la carga); si
 * existe se le asegura rol y faena. Si NO existe NO se crea nada: la
 * invitación es una acción de sesión de Administración que además envía el
 * correo, y duplicar esa lógica aquí dejaría un token que nadie recibe. Queda
 * en el reporte como pendiente, y nunca se escribe una contraseña.
 */
export async function seedMechanics(ctx: SeedContext, worksiteMap: WorksiteMap, invitationEmails: Record<string, string>): Promise<void> {
  const { tx, data, report } = ctx
  const out = report.mechanics
  const emailByName = new Map(Object.entries(invitationEmails).map(([name, email]) => [nameKey(name), email.trim().toLowerCase()]))

  const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.name, "mecanico"))
  const people = await tx.select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive }).from(users)
  const byName = new Map<string, typeof people>()
  for (const person of people) push(byName, nameKey(person.name), person)
  const byEmail = new Map(people.map((person) => [person.email.toLowerCase(), person]))

  if (!role) report.warnings.push("El rol «mecanico» no existe todavía: lo crea sync-rbac (npm run db:sync-rbac). Los mecánicos quedan pendientes.")

  for (const mecanico of data.mecanicos) {
    const worksite = worksiteMap.get(nameKey(mecanico.faena))
    const email = emailByName.get(nameKey(mecanico.nombre))
    const pending = (action: string) => out.pending.push({ name: mecanico.nombre, worksite: mecanico.faena, hasEmail: !!email, action })
    if (!role || !worksite) { pending("crear invitación desde /admin/usuarios con el rol Mecánico y su faena (el rol aún no existe)"); continue }

    const sameName = byName.get(nameKey(mecanico.nombre)) ?? []
    if (sameName.length > 1) { pending("hay varias cuentas con ese nombre; elegir cuál es y asignarle el rol Mecánico desde /admin/usuarios"); continue }
    const user = sameName[0] ?? (email ? byEmail.get(email) : undefined)
    if (!user) {
      if (email) {
        const [open] = await tx.select({ id: userInvitations.id }).from(userInvitations).where(and(
          eq(userInvitations.email, email), isNull(userInvitations.acceptedAt), isNull(userInvitations.cancelledAt), isNull(userInvitations.replacedAt),
        ))
        pending(open ? "tiene una invitación pendiente; falta que la acepte" : `crear invitación desde /admin/usuarios (rol Mecánico, faena ${mecanico.faena})`)
      } else pending(`sin correo: crear invitación desde /admin/usuarios (rol Mecánico, faena ${mecanico.faena}) cuando se conozca`)
      continue
    }
    if (!user.isActive) { pending("la cuenta existe pero está inactiva"); continue }

    const roleLink = await tx.insert(userRoles).values({ userId: user.id, roleId: role.id }).onConflictDoNothing().returning({ userId: userRoles.userId })
    const hasWorksites = (await tx.select({ id: worksiteUsers.worksiteId }).from(worksiteUsers).where(eq(worksiteUsers.userId, user.id))).length > 0
    const worksiteLink = await tx.insert(worksiteUsers)
      .values({ userId: user.id, worksiteId: worksite.id, isPrimary: !hasWorksites })
      .onConflictDoNothing().returning({ userId: worksiteUsers.userId })
    if (roleLink.length > 0 || worksiteLink.length > 0) out.linked++
    else out.alreadyLinked++
  }
}
