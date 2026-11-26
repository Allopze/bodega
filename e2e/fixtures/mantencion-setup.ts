import { readFileSync } from "node:fs"
import path from "node:path"
import { and, asc, eq, inArray, isNull, isNotNull } from "drizzle-orm"
import * as schema from "../../db/schema"
import type { DB } from "../../db"
import { SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } from "../../lib/auth/system-rbac"
import { ODOMETER_TRUCK_WORKSITE_CODE, TRUCK_PERFORMANCE_FAMILY } from "../../lib/mantencion/equipment-unit"
import { seedMantencion } from "../../lib/services/mantencion/seed"
import { createWorksiteTx } from "../../lib/services/worksite-create"

/**
 * Fixtures del módulo de mantención de equipos para las E2E
 * (`e2e/mantencion-*.spec.ts`, que corren en ese orden y con estado).
 *
 * - Roles reales del módulo (`mecanico`, `supervisor_mantencion`,
 *   `jefe_mantencion`) con sus grants del manifest: las pruebas de permisos
 *   (§16 E2E 8) tienen que ejercer la matriz verdadera, no una inventada.
 * - La carga inicial completa (`db/seed/mantencion-seed.json`) con el mismo
 *   servicio que usa producción.
 * - Usuarios (contraseña `chome2026`):
 *   `mecanico1@e2e.chome.cl` y `mecanico2@e2e.chome.cl` (Biodiversa),
 *   `supervisor@e2e.chome.cl` (Biodiversa), `jefe.mant@e2e.chome.cl` (global);
 *   para las órdenes de trabajo (`mantencion-5-ot.spec.ts`): `admin.contrato@e2e.chome.cl`
 *   (administrador de contrato de Biodiversa), `admin.contrato.cho@e2e.chome.cl` (el de
 *   Cholguan, que prueba el alcance) y `mecanico.cho@e2e.chome.cl` (mecánico de Cholguan,
 *   que prueba que una OT de Biodiversa se ejecuta desde otra faena).
 * - La unidad de medida es del equipo (`mant_equipment_profiles.unit`, 2026-11-25) y el fixture la deja
 *   como en producción: los camiones y tractos de Biodiversa miden en km con la pauta «Camiones y
 *   tractos»; los de cualquier otra faena, en horas con «Maquinaria pesada» (la que eligió el usuario
 *   al moverlos); la maquinaria ya mide en horas por su tipo. La regla de alta mira el CÓDIGO de la
 *   faena (`BIODIVERSA`), así que la faena se crea aquí con ese código y no con el `MANT-<folio>` que
 *   le pondría la carga inicial. Consecuencia para las specs: todos los equipos de Cholguan y de Teno
 *   miden en horas; sólo los 8 de Biodiversa miden en km.
 * - Lecturas iniciales que dejan tres equipos de Biodiversa medidos en km
 *   «Próximos» (39.900 km → toca la de 40.000), para que «Le toca mantención»
 *   tenga qué mostrar sin depender de registros previos. Desde 2026-11-22 un
 *   equipo sin ninguna preventiva queda «Sin información de preventiva» (ya no
 *   se supone la última en el múltiplo anterior): por eso llevan también una
 *   preventiva DECLARADA anterior a la plataforma a los 30.000 km, con respaldo.
 */

export const MANT_E2E_USERS = {
  mecanico1: { id: "user-mant-mec1-e2e", email: "mecanico1@e2e.chome.cl", name: "Mecánico Uno E2E", role: "mecanico" },
  mecanico2: { id: "user-mant-mec2-e2e", email: "mecanico2@e2e.chome.cl", name: "Mecánico Dos E2E", role: "mecanico" },
  supervisor: { id: "user-mant-sup-e2e", email: "supervisor@e2e.chome.cl", name: "Supervisor Biodiversa E2E", role: "supervisor_mantencion" },
  jefe: { id: "user-mant-jefe-e2e", email: "jefe.mant@e2e.chome.cl", name: "Jefatura Mantención E2E", role: "jefe_mantencion" },
  adminContrato: { id: "user-mant-admc-e2e", email: "admin.contrato@e2e.chome.cl", name: "Admin Contrato Biodiversa E2E", role: "admin_contrato" },
  adminContratoCho: { id: "user-mant-admc-cho-e2e", email: "admin.contrato.cho@e2e.chome.cl", name: "Admin Contrato Cholguan E2E", role: "admin_contrato", worksite: "Cholguan" },
  mecanicoCho: { id: "user-mant-mec-cho-e2e", email: "mecanico.cho@e2e.chome.cl", name: "Mecánico Cholguan E2E", role: "mecanico", worksite: "Cholguan" },
} as const

const MODULE_ROLES = ["mecanico", "supervisor_mantencion", "jefe_mantencion", "admin_contrato"] as const

export async function seedMantencionE2E(db: DB, options: { hashedPassword: string; now: string }) {
  // Roles del módulo con los grants derivados de los manifests.
  const roleRows = SYSTEM_ROLES.filter((role) => (MODULE_ROLES as readonly string[]).includes(role.name))
  for (const role of roleRows) {
    await db.insert(schema.roles).values(role).onConflictDoNothing()
  }
  const roleIds = roleRows.map((role) => role.id)
  const grants = SYSTEM_ROLE_PERMISSIONS.filter((grant) => roleIds.includes(grant.roleId))
  if (grants.length) await db.insert(schema.rolePermissions).values(grants).onConflictDoNothing()

  const data = JSON.parse(readFileSync(path.resolve(process.cwd(), "db/seed/mantencion-seed.json"), "utf8")) as {
    faenas: Array<{ nombre: string }>
    equipos: Array<{ faena: string }>
  }

  // Las faenas que estas specs no usan se crean antes y DADAS DE BAJA, para que la carga
  // inicial las reutilice (conserva los 120 equipos) sin abrirlas como faenas activas: cada
  // faena activa genera su programa de Prevención y agranda pantallas de otras suites
  // (capacitación, el selector de faena de MIPER), que dejaban de pasar sólo por eso.
  const ACTIVE = new Set(["Biodiversa", "Cholguan", "Teno"])
  // Biodiversa nace con el código de producción (`BIODIVERSA`): de él depende que sus camiones y tractos
  // midan en km. La carga la reutiliza por nombre y sólo le asigna el folio.
  await db.transaction((tx) => createWorksiteTx(
    tx, { name: "Biodiversa", code: ODOMETER_TRUCK_WORKSITE_CODE, isActive: true }, { userId: "user-admin-e2e" },
  ))
  const names = [...new Set([...data.faenas.map((faena) => faena.nombre), ...data.equipos.map((equipo) => equipo.faena)])]
  const dormant = names.filter((name) => !ACTIVE.has(name))
  if (dormant.length) {
    await db.insert(schema.worksites).values(dormant.map((name, index) => ({
      id: `ws-mant-e2e-${index + 1}`, name, code: `MANT-E2E-${String(index + 1).padStart(2, "0")}`,
      isActive: false, deactivatedAt: options.now, createdAt: options.now, updatedAt: options.now,
    })))
  }
  // La carga ya no crea faenas en silencio: las tres activas que usan estas specs se
  // autorizan aquí; las demás ya existen (dadas de baja) y se reutilizan por nombre.
  await seedMantencion(db, data as Parameters<typeof seedMantencion>[1], {
    actorUserId: "user-admin-e2e",
    faenas: { equivalencias: {}, crear: [...ACTIVE].filter((name) => name !== "Biodiversa"), crearDesactivadas: [] },
  })

  const [biodiversa] = await db.select({ id: schema.worksites.id }).from(schema.worksites)
    .where(eq(schema.worksites.name, "Biodiversa")).limit(1)
  if (!biodiversa) throw new Error("La carga inicial no creó la faena Biodiversa")

  const [cholguana] = await db.select({ id: schema.worksites.id }).from(schema.worksites)
    .where(eq(schema.worksites.name, "Cholguan")).limit(1)
  if (!cholguana) throw new Error("La carga inicial no creó la faena Cholguan")
  const worksiteIdByName = new Map([["Biodiversa", biodiversa.id], ["Cholguan", cholguana.id]])

  const roleIdByName = new Map(roleRows.map((role) => [role.name, role.id]))
  for (const user of Object.values(MANT_E2E_USERS)) {
    await db.insert(schema.users).values({
      id: user.id, name: user.name, email: user.email, hashedPassword: options.hashedPassword,
      avatarColor: "150", isActive: true, createdAt: options.now, updatedAt: options.now,
    })
    await db.insert(schema.userRoles).values({ userId: user.id, roleId: roleIdByName.get(user.role)! })
    if (user.role !== "jefe_mantencion") {
      const worksiteName = "worksite" in user ? user.worksite : "Biodiversa"
      await db.insert(schema.worksiteUsers).values({ userId: user.id, worksiteId: worksiteIdByName.get(worksiteName)!, isPrimary: true })
    }
  }

  // Los camiones y tractos que miden en horas (todos los de fuera de Biodiversa) quedan con «Maquinaria pesada»,
  // la pauta en horas que eligió el usuario al moverlos (la carga inicial los deja sin pauta porque la de camiones es en km).
  const [hoursSchedule] = await db.select({ id: schema.mantSchedules.id }).from(schema.mantSchedules)
    .where(and(eq(schema.mantSchedules.name, "Maquinaria pesada"), eq(schema.mantSchedules.unit, "h"), isNull(schema.mantSchedules.deletedAt)))
    .limit(1)
  if (!hoursSchedule) throw new Error("La carga inicial no creó la pauta «Maquinaria pesada»")
  const trucksInHours = await db
    .select({ vehicleId: schema.mantEquipmentProfiles.vehicleId })
    .from(schema.mantEquipmentProfiles)
    .innerJoin(schema.fuelVehicles, eq(schema.fuelVehicles.id, schema.mantEquipmentProfiles.vehicleId))
    .innerJoin(schema.fuelEquipmentTypes, eq(schema.fuelEquipmentTypes.id, schema.fuelVehicles.equipmentTypeId))
    .where(and(
      eq(schema.fuelEquipmentTypes.performanceFamily, TRUCK_PERFORMANCE_FAMILY),
      eq(schema.mantEquipmentProfiles.unit, "h"),
      isNull(schema.mantEquipmentProfiles.scheduleId),
    ))
  if (trucksInHours.length) {
    await db.update(schema.mantEquipmentProfiles)
      .set({ scheduleId: hoursSchedule.id })
      .where(inArray(schema.mantEquipmentProfiles.vehicleId, trucksInHours.map((row) => row.vehicleId)))
  }

  // Tres equipos km de Biodiversa quedan «Próximos» (falta 100 km para 40.000).
  const kmVehicles = await db
    .select({ vehicleId: schema.fuelVehicles.id })
    .from(schema.mantEquipmentProfiles)
    .innerJoin(schema.fuelVehicles, eq(schema.fuelVehicles.id, schema.mantEquipmentProfiles.vehicleId))
    .where(and(
      eq(schema.fuelVehicles.worksiteId, biodiversa.id),
      eq(schema.mantEquipmentProfiles.unit, "km"),
      isNotNull(schema.mantEquipmentProfiles.scheduleId),
    ))
    .orderBy(asc(schema.fuelVehicles.code))
    .limit(3)
  if (kmVehicles.length < 3) throw new Error(`Biodiversa debe tener 3 equipos en km con pauta y tiene ${kmVehicles.length}`)
  // Treinta días atrás: lejos de la medianoche UTC/Chile, la lectura inicial
  // nunca queda «después» del trabajo que registra la prueba hoy.
  const initialDate = new Date(Date.parse(options.now) - 30 * 86_400_000).toISOString().slice(0, 10)
  const priorDate = new Date(Date.parse(options.now) - 90 * 86_400_000).toISOString().slice(0, 10)
  if (kmVehicles.length) {
    await db.update(schema.mantEquipmentProfiles)
      .set({
        initialReading: 39_900, initialReadingDate: initialDate,
        priorPreventiveDate: priorDate, priorPreventiveReading: 30_000, priorPreventiveInterval: 10_000,
        priorPreventiveEvidence: "OT E2E-30000", priorPreventiveSource: "Carga inicial E2E",
      })
      .where(inArray(schema.mantEquipmentProfiles.vehicleId, kmVehicles.map((row) => row.vehicleId)))
  }
}
