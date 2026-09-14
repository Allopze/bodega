import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
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

    it("una licencia con cantidad comprada cero no admite asignaciones (TIL-002)", async () => {
      /*
       * Antes, el tope de asientos se aplicaba sólo cuando
       * `purchasedQuantity > 0`, con el argumento de que "los catálogos
       * abiertos no se limitan". El resultado era el contrario a lo que se
       * lee: una licencia con 0 comprados —el valor por omisión, admitido por
       * el check de BD— aceptaba asignaciones sin fin, o sea, cero se
       * comportaba como ilimitado.
       */
      const id = await createLicense({ name: "Licencia sin comprar", purchasedQuantity: 0, periodicity: "anual" }, actor)

      await expect(assignLicense({ licenseId: id, workerId: "wk-ti-juan" }, actor))
        .rejects.toThrow(/no tiene asientos comprados/i)

      const [asignadas] = await testDb.select().from(schema.itLicenseAssignments)
        .where(eq(schema.itLicenseAssignments.licenseId, id))
      expect(asignadas).toBeUndefined()
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
      const workerAccess = await listWorkerAccess("wk-ti-juan", "all")
      const row = workerAccess.find((a) => a.systemId === systemId)
      expect(row?.status).toBe("baja")
      expect(row?.revokedAt).toBeTruthy()
    })

    it("limpia la revocación y conserva las notas al reactivar un acceso", async () => {
      const systemId = await createAccessSystem({ name: "Sistema Reactivación" }, actor)
      await upsertSystemAccess({ systemId, workerId: "wk-ti-juan", status: "baja", notes: "Ticket de salida" }, actor)
      await upsertSystemAccess({ systemId, workerId: "wk-ti-juan", status: "activo" }, actor)

      const row = (await listWorkerAccess("wk-ti-juan", "all")).find((a) => a.systemId === systemId)
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
      // Orden de la plantilla, no alfabético: la secuencia es operativa
      // (crear correo → crear accesos → entregar equipo…) y ordenar por
      // nombre hacía que el alta empezara por "Asignar licencias".
      expect(tasks.map((t) => t.name)).toEqual([...ONBOARDING_CHECKLIST_TEMPLATE])

      const rows = await listChecklists({ kind: "onboarding", scope: undefined })
      const row = rows.find((c) => c.id === id)
      expect(row?.workerName).toBe("Juan Pérez")
      expect(row?.totalTasks).toBe(ONBOARDING_CHECKLIST_TEMPLATE.length)
      expect(row?.doneTasks).toBe(0)
      expect(row?.completedAt).toBeNull()
    })

    it("completa el checklist cuando se marcan todas las tareas", async () => {
      // Una persona sin nada abierto en TI: el cierre de una desvinculación
      // exige que la realidad esté limpia (ver el test siguiente), así que el
      // sujeto de este —que mide sólo la mecánica de completar— no puede ser
      // alguien con licencias o accesos vigentes.
      await testDb.insert(schema.workers).values({
        id: "wk-ti-limpio", rut: "33333333-3", firstName: "Ana", lastName: "Soto",
        worksiteId: "ws-ti-norte", isActive: true,
      })
      const id = await createChecklist({ workerId: "wk-ti-limpio", kind: "offboarding" }, actor)
      const tasks = await getChecklistTasks(id)

      for (const task of tasks) {
        await toggleChecklistTask({ taskId: task.id, done: true }, actor)
      }

      const rows = await listChecklists({ scope: undefined })
      const row = rows.find((c) => c.id === id)
      expect(row?.doneTasks).toBe(row?.totalTasks)
      expect(row?.completedAt).toBeTruthy()

      await toggleChecklistTask({ taskId: tasks[0]!.id, done: false }, actor)
      const reopened = (await listChecklists({ scope: undefined })).find((c) => c.id === id)
      expect(reopened?.completedAt).toBeNull()
    })

    /**
     * TIL-001 (auditoría 2026-09-14): el checklist de baja declaraba "Revocar
     * accesos" y "Cerrar licencias asignadas" como casillas que se marcaban de
     * memoria, sin consultar las tablas que tienen la verdad. Una
     * desvinculación podía quedar "completa" con la cuenta viva y el notebook
     * sin devolver.
     */
    it("no cierra la desvinculación mientras queden accesos o licencias vigentes", async () => {
      await testDb.delete(schema.itWorkerChecklists)
        .where(eq(schema.itWorkerChecklists.workerId, "wk-ti-maria"))
      const id = await createChecklist({ workerId: "wk-ti-maria", kind: "offboarding" }, actor)
      const tasks = await getChecklistTasks(id)

      // Todas menos la última: hasta ahí TI puede registrar su avance.
      for (const task of tasks.slice(0, -1)) {
        await toggleChecklistTask({ taskId: task.id, done: true }, actor)
      }
      const last = tasks.at(-1)!

      // María conserva accesos y licencias de los tests anteriores.
      await expect(toggleChecklistTask({ taskId: last.id, done: true }, actor))
        .rejects.toThrow(/No se puede cerrar la desvinculación/i)

      // Y el checklist sigue abierto: la transacción no dejó la casilla marcada.
      const blocked = (await listChecklists({ scope: undefined })).find((c) => c.id === id)
      expect(blocked?.completedAt).toBeNull()
      expect(blocked?.doneTasks).toBe(tasks.length - 1)

      // Cerrada la realidad, el checklist sí cierra.
      for (const access of await listWorkerAccess("wk-ti-maria", "all")) {
        await upsertSystemAccess({ systemId: access.systemId, workerId: "wk-ti-maria", status: "baja" }, actor)
      }
      await testDb.update(schema.itLicenseAssignments)
        .set({ revokedAt: new Date().toISOString() })
        .where(eq(schema.itLicenseAssignments.workerId, "wk-ti-maria"))

      await toggleChecklistTask({ taskId: last.id, done: true }, actor)
      expect((await listChecklists({ scope: undefined })).find((c) => c.id === id)?.completedAt).toBeTruthy()
    })

    it("marcar una tarea no borra su nota", async () => {
      const id = await createChecklist({ workerId: "wk-ti-juan", kind: "offboarding" }, actor)
      const [task] = await getChecklistTasks(id)

      await toggleChecklistTask({ taskId: task!.id, done: false, notes: "Pendiente: el trabajador vuelve el viernes" }, actor)
      expect((await getChecklistTasks(id))[0]?.notes).toMatch(/vuelve el viernes/)

      // El formulario de la tarea no envía el campo de nota: `undefined` debe
      // significar "sin cambio", no "borrar".
      await toggleChecklistTask({ taskId: task!.id, done: true }, actor)
      const afterToggle = (await getChecklistTasks(id))[0]
      expect(afterToggle?.done).toBe(true)
      expect(afterToggle?.notes).toMatch(/vuelve el viernes/)

      // Una cadena vacía sí borra explícitamente.
      await toggleChecklistTask({ taskId: task!.id, done: true, notes: "" }, actor)
      expect((await getChecklistTasks(id))[0]?.notes).toBeNull()
    })

    it("no permite dos checklists abiertos del mismo tipo para un trabajador", async () => {
      // Arrange propio: antes dependía de que el checklist `offboarding` del
      // test anterior siguiera abierto, así que aislado (o reordenado) el
      // `createChecklist` habría tenido éxito y el test habría fallado.
      await testDb.delete(schema.itWorkerChecklists)
        .where(eq(schema.itWorkerChecklists.workerId, "wk-ti-maria"))
      await createChecklist({ workerId: "wk-ti-maria", kind: "offboarding" }, actor)

      await expect(createChecklist({ workerId: "wk-ti-maria", kind: "offboarding" }, actor))
        .rejects.toThrow(/ya tiene un checklist de baja en curso/i)
    })
  })
})
