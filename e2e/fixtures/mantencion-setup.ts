import { readFileSync } from "node:fs"
import path from "node:path"
import { and, asc, eq, inArray } from "drizzle-orm"
import * as schema from "../../db/schema"
import type { DB } from "../../db"
import { SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } from "../../lib/auth/system-rbac"
import { seedMantencion } from "../../lib/services/mantencion/seed"

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
 *   `supervisor@e2e.chome.cl` (Biodiversa), `jefe.mant@e2e.chome.cl` (global).
 * - Lecturas iniciales que dejan tres equipos de Biodiversa medidos en km
 *   «Próximos» (39.900 km → toca la de 40.000), para que «Le toca mantención»
 *   tenga qué mostrar sin depender de registros previos.
 */

export const MANT_E2E_USERS = {
  mecanico1: { id: "user-mant-mec1-e2e", email: "mecanico1@e2e.chome.cl", name: "Mecánico Uno E2E", role: "mecanico" },
  mecanico2: { id: "user-mant-mec2-e2e", email: "mecanico2@e2e.chome.cl", name: "Mecánico Dos E2E", role: "mecanico" },
  supervisor: { id: "user-mant-sup-e2e", email: "supervisor@e2e.chome.cl", name: "Supervisor Biodiversa E2E", role: "supervisor_mantencion" },
  jefe: { id: "user-mant-jefe-e2e", email: "jefe.mant@e2e.chome.cl", name: "Jefatura Mantención E2E", role: "jefe_mantencion" },
} as const

const MODULE_ROLES = ["mecanico", "supervisor_mantencion", "jefe_mantencion"] as const

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
  const names = [...new Set([...data.faenas.map((faena) => faena.nombre), ...data.equipos.map((equipo) => equipo.faena)])]
  const dormant = names.filter((name) => !ACTIVE.has(name))
  if (dormant.length) {
    await db.insert(schema.worksites).values(dormant.map((name, index) => ({
      id: `ws-mant-e2e-${index + 1}`, name, code: `MANT-E2E-${String(index + 1).padStart(2, "0")}`,
      isActive: false, deactivatedAt: options.now, createdAt: options.now, updatedAt: options.now,
    })))
  }
  await seedMantencion(db, data as Parameters<typeof seedMantencion>[1], { actorUserId: "user-admin-e2e" })

  const [biodiversa] = await db.select({ id: schema.worksites.id }).from(schema.worksites)
    .where(eq(schema.worksites.name, "Biodiversa")).limit(1)
  if (!biodiversa) throw new Error("La carga inicial no creó la faena Biodiversa")

  const roleIdByName = new Map(roleRows.map((role) => [role.name, role.id]))
  for (const user of Object.values(MANT_E2E_USERS)) {
    await db.insert(schema.users).values({
      id: user.id, name: user.name, email: user.email, hashedPassword: options.hashedPassword,
      avatarColor: "150", isActive: true, createdAt: options.now, updatedAt: options.now,
    })
    await db.insert(schema.userRoles).values({ userId: user.id, roleId: roleIdByName.get(user.role)! })
    if (user.role !== "jefe_mantencion") {
      await db.insert(schema.worksiteUsers).values({ userId: user.id, worksiteId: biodiversa.id, isPrimary: true })
    }
  }

  // Tres equipos km de Biodiversa quedan «Próximos» (falta 100 km para 40.000).
  const kmVehicles = await db
    .select({ vehicleId: schema.fuelVehicles.id })
    .from(schema.mantEquipmentProfiles)
    .innerJoin(schema.fuelVehicles, eq(schema.fuelVehicles.id, schema.mantEquipmentProfiles.vehicleId))
    .innerJoin(schema.fuelEquipmentTypes, eq(schema.fuelEquipmentTypes.id, schema.fuelVehicles.equipmentTypeId))
    .where(and(
      eq(schema.fuelVehicles.worksiteId, biodiversa.id),
      eq(schema.fuelEquipmentTypes.defaultMeterType, "odometer"),
    ))
    .orderBy(asc(schema.fuelVehicles.code))
    .limit(3)
  // Treinta días atrás: lejos de la medianoche UTC/Chile, la lectura inicial
  // nunca queda «después» del trabajo que registra la prueba hoy.
  const initialDate = new Date(Date.parse(options.now) - 30 * 86_400_000).toISOString().slice(0, 10)
  if (kmVehicles.length) {
    await db.update(schema.mantEquipmentProfiles)
      .set({ initialReading: 39_900, initialReadingDate: initialDate })
      .where(inArray(schema.mantEquipmentProfiles.vehicleId, kmVehicles.map((row) => row.vehicleId)))
  }
}
