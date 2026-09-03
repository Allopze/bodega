import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { seedTiBase } from "./helpers/ti-seeds"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

import {
  createLicense, updateLicense, assignLicense, revokeLicenseAssignment, listLicenses, getLicenseAssignments,
} from "@/lib/services/ti/licenses"
import {
  createAccessSystem, toggleAccessSystem, listAccessSystems,
  upsertSystemAccess, listWorkerAccess,
  createChecklist, toggleChecklistTask, listChecklists, getChecklistTasks,
} from "@/lib/services/ti/access"
import { ONBOARDING_CHECKLIST_TEMPLATE } from "@/lib/services/ti/constants"

describe("módulo TI — licencias, accesos y checklists", () => {
  const actor = { userId: "user-ti-tecnico", userEmail: "tecnico@ti.cl" }

  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await seedTiBase(testDb)
  })

  afterAll(async () => pg.close())

  describe("licencias", () => {
    it("crea una licencia y la lista con asignaciones en cero", async () => {
      const id = await createLicense({
        name: "Microsoft 365 Business",
        supplierId: "sup-ti-repuestos",
        purchasedQuantity: 2,
        cost: 12_000,
        periodicity: "mensual",
        renewalDate: "2026-10-01",
      }, actor)

      const rows = await listLicenses()
      const row = rows.find((l) => l.id === id)
      expect(row?.assignedQuantity).toBe(0)
      expect(row?.supplierName).toBe("Repuestos TI Ltda.")
    })

    it("respeta la capacidad comprada y libera el cupo al revocar", async () => {
      const id = await createLicense({ name: "Adobe CC", purchasedQuantity: 1, periodicity: "anual" }, actor)

      const a1 = await assignLicense({ licenseId: id, workerId: "wk-ti-juan" }, actor)
      // Segundo intento: el único cupo ya está usado.
      await expect(assignLicense({ licenseId: id, workerId: "wk-ti-maria" }, actor))
        .rejects.toThrow(/1 asignaciones usadas/)

      await revokeLicenseAssignment(a1, actor)
      const a2 = await assignLicense({ licenseId: id, workerId: "wk-ti-maria" }, actor)
      expect(a2).toBeTruthy()

      const rows = await listLicenses()
      expect(rows.find((l) => l.id === id)?.assignedQuantity).toBe(1)
    })

    it("no permite reducir la compra por debajo de las asignaciones vigentes", async () => {
      const id = await createLicense({ name: "Licencia con cupos", purchasedQuantity: 2, periodicity: "anual" }, actor)
      await assignLicense({ licenseId: id, workerId: "wk-ti-juan" }, actor)
      await assignLicense({ licenseId: id, workerId: "wk-ti-maria" }, actor)

      await expect(updateLicense({
        id, name: "Licencia con cupos", purchasedQuantity: 1, periodicity: "anual", isActive: true,
      }, actor)).rejects.toThrow(/asignaciones vigentes/)
    })

    it("no asigna sobre una licencia inactiva", async () => {
      const id = await createLicense({ name: "Antivirus", purchasedQuantity: 5, periodicity: "anual" }, actor)
      await updateLicense({
        id, name: "Antivirus", purchasedQuantity: 5, periodicity: "anual", isActive: false,
      }, actor)

      await expect(assignLicense({ licenseId: id, assetId: "as-cualquiera" }, actor))
        .rejects.toThrow(/licencia está inactiva/)
    })

    it("rechaza asignar una licencia a un trabajador fuera del scope", async () => {
      const id = await createLicense({ name: "Licencia acotada", purchasedQuantity: 2, periodicity: "anual" }, actor)

      await expect(assignLicense({ licenseId: id, workerId: "wk-ti-maria" }, actor, ["ws-ti-norte"]))
        .rejects.toThrow(/No tienes acceso a esta faena/)
    })

    it("limita el contador visible de asignaciones a la faena del usuario", async () => {
      const id = await createLicense({ name: "Licencia con alcance", purchasedQuantity: 3, periodicity: "anual" }, actor)
      await assignLicense({ licenseId: id, workerId: "wk-ti-juan" }, actor)
      await assignLicense({ licenseId: id, workerId: "wk-ti-maria" }, actor)

      const scoped = await listLicenses(undefined, ["ws-ti-norte"])
      expect(scoped.find((license) => license.id === id)?.assignedQuantity).toBe(1)
    })

    it("exige al menos un destino en la asignación (check de BD)", async () => {
      const id = await createLicense({ name: "ERP", purchasedQuantity: 10, periodicity: "anual" }, actor)
      await expect(
        testDb.insert(schema.itLicenseAssignments).values({
          id: "asg-sin-destino",
          licenseId: id,
          workerId: null,
          assetId: null,
          area: null,
          worksiteId: null,
        }),
      ).rejects.toThrow()
    })

    it("lista las asignaciones de una licencia con su destino", async () => {
      const id = await createLicense({ name: "Figma", purchasedQuantity: 3, periodicity: "mensual" }, actor)
      await assignLicense({ licenseId: id, workerId: "wk-ti-juan" }, actor)

      const assignments = await getLicenseAssignments(id)
      expect(assignments.some((a) => a.workerName === "Juan Pérez")).toBe(true)
    })
  })

  describe("sistemas y accesos", () => {
    it("crea sistemas y cuenta accesos activos", async () => {
      await createAccessSystem({ name: "Microsoft 365", description: "Correo y Office" }, actor)
      const systemId = await createAccessSystem({ name: "VPN CHOME" }, actor)

      await upsertSystemAccess({ systemId, workerId: "wk-ti-juan", status: "activo", responsibleUserId: actor.userId }, actor)
      await upsertSystemAccess({ systemId, workerId: "wk-ti-maria", status: "activo", responsibleUserId: actor.userId }, actor)

      const systems = await listAccessSystems()
      const vpn = systems.find((s) => s.id === systemId)
      expect(vpn?.accessCount).toBe(2)
      expect(vpn?.name).toBe("VPN CHOME")
    })

    it("rechaza nombres de sistema duplicados sin distinguir mayúsculas", async () => {
      await createAccessSystem({ name: "Sistema Único" }, actor)

      await expect(createAccessSystem({ name: " sistema único " }, actor)).rejects.toThrow()
    })

    it("reserva el catálogo global de sistemas para sesiones con alcance global", async () => {
      await expect(createAccessSystem({ name: "Sistema global protegido" }, actor, ["ws-ti-norte"]))
        .rejects.toThrow(/alcance global/)
    })

    it("hace upsert sobre el par (sistema, trabajador) y revoca con 'baja'", async () => {
      const systemId = await createAccessSystem({ name: "SAP" }, actor)

      await upsertSystemAccess({ systemId, workerId: "wk-ti-juan", status: "activo" }, actor)
      const accessId = await upsertSystemAccess({ systemId, workerId: "wk-ti-juan", status: "suspendido" }, actor)
      const accessId2 = await upsertSystemAccess({ systemId, workerId: "wk-ti-juan", status: "activo" }, actor)
      expect(accessId).toBe(accessId2)

      await upsertSystemAccess({ systemId, workerId: "wk-ti-juan", status: "baja" }, actor)
      const workerAccess = await listWorkerAccess("wk-ti-juan")
      const row = workerAccess.find((a) => a.systemId === systemId)
      expect(row?.status).toBe("baja")
      expect(row?.revokedAt).toBeTruthy()
    })

    it("limpia la revocación y conserva las notas al reactivar un acceso", async () => {
      const systemId = await createAccessSystem({ name: "Sistema Reactivación" }, actor)
      await upsertSystemAccess({ systemId, workerId: "wk-ti-juan", status: "baja", notes: "Ticket de salida" }, actor)
      await upsertSystemAccess({ systemId, workerId: "wk-ti-juan", status: "activo" }, actor)

      const row = (await listWorkerAccess("wk-ti-juan")).find((a) => a.systemId === systemId)
      expect(row?.status).toBe("activo")
      expect(row?.revokedAt).toBeNull()
      expect(row?.notes).toBe("Ticket de salida")
    })

    it("oculta los sistemas inactivos del listado por defecto", async () => {
      const systemId = await createAccessSystem({ name: "Sistema Legacy" }, actor)
      await toggleAccessSystem(systemId, false, actor)

      expect((await listAccessSystems()).some((s) => s.id === systemId)).toBe(false)
      expect((await listAccessSystems({ includeInactive: true })).some((s) => s.id === systemId)).toBe(true)
    })
  })

  describe("checklists de alta/baja", () => {
    it("instancia las tareas desde la plantilla al crear el checklist", async () => {
      const id = await createChecklist({ workerId: "wk-ti-juan", kind: "onboarding" }, actor)

      const tasks = await getChecklistTasks(id)
      expect(tasks).toHaveLength(ONBOARDING_CHECKLIST_TEMPLATE.length)
      expect(tasks.map((t) => t.name).sort()).toEqual([...ONBOARDING_CHECKLIST_TEMPLATE].sort())

      const rows = await listChecklists({ kind: "onboarding" })
      const row = rows.find((c) => c.id === id)
      expect(row?.workerName).toBe("Juan Pérez")
      expect(row?.totalTasks).toBe(ONBOARDING_CHECKLIST_TEMPLATE.length)
      expect(row?.doneTasks).toBe(0)
      expect(row?.completedAt).toBeNull()
    })

    it("completa el checklist cuando se marcan todas las tareas", async () => {
      const id = await createChecklist({ workerId: "wk-ti-maria", kind: "offboarding" }, actor)
      const tasks = await getChecklistTasks(id)

      for (const task of tasks) {
        await toggleChecklistTask({ taskId: task.id, done: true }, actor)
      }

      const rows = await listChecklists({})
      const row = rows.find((c) => c.id === id)
      expect(row?.doneTasks).toBe(row?.totalTasks)
      expect(row?.completedAt).toBeTruthy()

      await toggleChecklistTask({ taskId: tasks[0]!.id, done: false }, actor)
      const reopened = (await listChecklists({})).find((c) => c.id === id)
      expect(reopened?.completedAt).toBeNull()
    })
  })
})
