import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { seedTiBase, seedAssetType, plainDateIn } from "./helpers/ti-seeds"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

import { createMaintenance, updateMaintenance, voidMaintenance, listMaintenances, maintenanceCostByAsset } from "@/lib/services/ti/maintenance"
import { getMaintenanceCostByMonth } from "@/lib/services/ti/queries"
import { getAssetHistory } from "@/lib/services/ti/history"
import { retireAsset, reverseRetirement, retirementTargetStatus, listRetirements } from "@/lib/services/ti/retirements"
import { createSupplierLink, deleteSupplierLink, listSupplierLinks, listAssetsByWarranty } from "@/lib/services/ti/supplier-links"
import { createAsset, softDeleteAsset, changeAssetStatus } from "@/lib/services/ti/assets"
import { createAssignment } from "@/lib/services/ti/assignments"

describe("módulo TI — mantenciones, bajas, proveedores y garantías", () => {
  let typeId: string
  const actor = { userId: "user-ti-tecnico", userEmail: "tecnico@ti.cl" }
  /** Doble control de la baja: el autorizante nunca puede ser el responsable. */
  const AUTHORIZER = "user-ti-gestor"

  async function makeAsset(code: string, worksiteId = "ws-ti-norte") {
    return createAsset({ code, assetTypeId: typeId, worksiteId, cost: 500_000 }, actor)
  }

  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await seedTiBase(testDb)
    typeId = await seedAssetType(testDb)
  })

  afterAll(async () => pg.close())

  describe("mantenciones", () => {
    it("registra una mantención y la acumula en el costo por activo", async () => {
      const assetId = await makeAsset("TI-M-0001")

      await createMaintenance({
        assetId,
        type: "reparacion",
        date: "2026-08-01",
        reportedIssue: "Pantalla rota",
        diagnosis: "LCD dañado",
        workDone: "Cambio de pantalla",
        supplierId: "sup-ti-repuestos",
        cost: 150_000,
      }, actor)

      const rows = await listMaintenances({ assetId })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.assetCode).toBe("TI-M-0001")
      expect(rows[0]?.supplierName).toBe("Repuestos TI Ltda.")

      const ranking = await maintenanceCostByAsset()
      const row = ranking.find((r) => r.assetId === assetId)
      expect(row?.totalCost).toBe(150_000)
      expect(row?.count).toBe(1)
    })

    it("actualiza el costo de una mantención", async () => {
      const assetId = await makeAsset("TI-M-0002")
      const id = await createMaintenance({
        assetId, type: "preventiva", date: "2026-07-01", workDone: "Limpieza", cost: 10_000,
      }, actor)

      await updateMaintenance({
        id, assetId, type: "preventiva", date: "2026-07-01", workDone: "Limpieza y pasta térmica", cost: 25_000,
      }, actor)

      const rows = await listMaintenances({ assetId })
      expect(rows.find((r) => r.id === id)?.cost).toBe(25_000)
    })

    it("rechaza la mantención de un activo de otra faena cuando hay scope", async () => {
      const assetId = await makeAsset("TI-M-0003", "ws-ti-sur")
      await expect(createMaintenance({
        assetId, type: "revision", date: "2026-07-01", workDone: "Revisión",
      }, actor, ["ws-ti-norte"])).rejects.toThrow(/No tienes acceso a esta faena/)
    })

    it("mantiene el scope al editar una mantención existente", async () => {
      const assetId = await makeAsset("TI-M-0004", "ws-ti-sur")
      const id = await createMaintenance({
        assetId, type: "revision", date: "2026-07-01", workDone: "Revisión inicial",
      }, actor)

      await expect(updateMaintenance({
        id, assetId, type: "revision", date: "2026-07-02", workDone: "Revisión actualizada",
      }, actor, ["ws-ti-norte"])).rejects.toThrow(/No tienes acceso a esta faena/)
    })

    it("excluye del historial operativo los activos eliminados lógicamente", async () => {
      const assetId = await makeAsset("TI-M-0005")
      await createMaintenance({
        assetId, type: "revision", date: "2026-07-01", workDone: "Revisión histórica", cost: 40_000,
      }, actor)
      await softDeleteAsset(assetId, actor)

      expect(await listMaintenances({ assetId })).toHaveLength(0)
      expect((await maintenanceCostByAsset()).some((row) => row.assetId === assetId)).toBe(false)
    })

    it("anula una mantención: sigue en listMaintenances pero sale de los agregados de costo", async () => {
      const assetId = await makeAsset("TI-M-0006")
      // Fecha relativa al reloj, no fija: `getMaintenanceCostByMonth` acota a
      // los últimos 12 meses, así que una fecha fija terminaría cayendo fuera
      // de la ventana y la aserción de abajo pasaría con o sin el filtro de
      // anuladas (dejaría de probar la regresión sin que nadie lo note).
      const date = plainDateIn(-5)
      const month = date.slice(0, 7)
      const id = await createMaintenance({
        assetId, type: "reparacion", date, workDone: "Cambio de teclado", cost: 60_000,
      }, actor)

      // El valor previo se afirma explícitamente: si la query se rompiera y
      // devolviera vacío siempre, el `toBe(0)` de después no lo detectaría.
      const costOf = async (): Promise<number> => {
        const rows = await getMaintenanceCostByMonth(eq(schema.itAssets.id, assetId))
        return rows.find((r) => r.month === month)?.cost ?? 0
      }
      expect(await costOf()).toBe(60_000)

      const { assetId: returnedAssetId } = await voidMaintenance(id, "Se registró en el equipo equivocado", actor)
      expect(returnedAssetId).toBe(assetId)

      const rows = await listMaintenances({ assetId })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.voidedAt).toBeTruthy()
      expect(rows[0]?.voidReason).toBe("Se registró en el equipo equivocado")
      expect(rows[0]?.voidedByUserName).toBe("Técnico TI")

      // Agregados: la excluyen.
      expect((await maintenanceCostByAsset()).find((r) => r.assetId === assetId)).toBeUndefined()
      expect(await costOf()).toBe(0)

      const history = await getAssetHistory(assetId)
      expect(history.some((h) => h.action === "maintenance_voided")).toBe(true)
    })

    it("rechaza anular con un motivo corto y rechaza anular dos veces", async () => {
      const assetId = await makeAsset("TI-M-0007")
      const id = await createMaintenance({
        assetId, type: "reparacion", date: "2026-08-05", workDone: "Cambio de batería", cost: 30_000,
      }, actor)

      await expect(voidMaintenance(id, "corto", actor)).rejects.toThrow(/al menos 10 caracteres/)
      await voidMaintenance(id, "Motivo válido de anulación", actor)
      await expect(voidMaintenance(id, "Otro motivo válido", actor)).rejects.toThrow(/ya fue anulada/)
    })

    it("impide editar una mantención anulada", async () => {
      const assetId = await makeAsset("TI-M-0008")
      const id = await createMaintenance({
        assetId, type: "reparacion", date: "2026-08-05", workDone: "Cambio de disco", cost: 45_000,
      }, actor)
      await voidMaintenance(id, "Duplicada por error de tipeo", actor)

      await expect(updateMaintenance({
        id, assetId, type: "reparacion", date: "2026-08-06", workDone: "Intento de edición", cost: 1,
      }, actor)).rejects.toThrow(/está anulada/)
    })
  })

  describe("bajas", () => {
    it("bloquea la baja con asignación abierta salvo pérdida/robo", async () => {
      const assetId = await makeAsset("TI-R-0001")
      await testDb.insert(schema.itAssetAssignments).values({
        id: "asg-retire-1",
        code: "ACT-2098-0001",
        assetId,
        workerId: "wk-ti-juan",
        worksiteId: "ws-ti-norte",
        kind: "delivery",
        deliveredAt: new Date().toISOString(),
        deliveredByUserId: actor.userId,
        physicalState: "bueno",
      })

      await expect(retireAsset({
        assetId, date: "2026-09-01", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)).rejects.toThrow(/devuélvelo antes de dar de baja/)

      // Pérdida/robo no requieren devolución previa.
      const retirementId = await retireAsset({
        assetId, date: "2026-09-01", reason: "perdida",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)
      const asset = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
      expect(asset[0]?.status).toBe("perdido")
      const assignment = await testDb.select().from(schema.itAssetAssignments)
        .where(eq(schema.itAssetAssignments.assetId, assetId))
      expect(assignment[0]?.returnedAt).toBeTruthy()
      expect(assignment[0]?.returnObservations).toMatch(/pérdida/i)

      // La baja guarda lo necesario para poder revertirse después. La
      // asignación se insertó directo en la tabla (sin pasar por el
      // servicio), así que `it_assets.status`/`workerId` nunca se movieron
      // de sus valores por defecto — `previousStatus`/`previousWorkerId`
      // reflejan fielmente esas columnas, no si había o no una asignación
      // abierta. `closedAssignmentId` sí depende de la asignación abierta
      // en sí, no de las columnas del activo.
      const [retirementRow] = await testDb.select().from(schema.itAssetRetirements)
        .where(eq(schema.itAssetRetirements.id, retirementId))
      expect(retirementRow?.previousStatus).toBe("disponible")
      expect(retirementRow?.previousWorkerId).toBeNull()
      expect(retirementRow?.closedAssignmentId).toBe("asg-retire-1")
    })

    it("da de baja un activo sin custodio y deja la auditoría en el historial", async () => {
      const assetId = await makeAsset("TI-R-0002")
      const retirementId = await retireAsset({
        assetId, date: "2026-09-01", reason: "reciclaje",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
        destination: "Recicladora Norte",
      }, actor)

      const asset = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
      expect(asset[0]?.status).toBe("dado_de_baja")
      expect(asset[0]?.workerId).toBeNull()

      const retirements = await listRetirements({ assetId })
      const row = retirements.find((r) => r.id === retirementId)
      expect(row?.reason).toBe("reciclaje")
      expect(row?.destination).toBe("Recicladora Norte")

      // Sin custodio previo: previousWorkerId y closedAssignmentId quedan null.
      const [retirementRow] = await testDb.select().from(schema.itAssetRetirements)
        .where(eq(schema.itAssetRetirements.id, retirementId))
      expect(retirementRow?.previousStatus).toBe("disponible")
      expect(retirementRow?.previousWorkerId).toBeNull()
      expect(retirementRow?.closedAssignmentId).toBeNull()
    })

    it("no permite dar de baja dos veces el mismo activo", async () => {
      const assetId = await makeAsset("TI-R-0003")
      await retireAsset({
        assetId, date: "2026-09-01", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)

      await expect(retireAsset({
        assetId, date: "2026-09-02", reason: "donacion",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)).rejects.toThrow(/ya está en estado 'dado_de_baja'/)
    })

    it("mapea la razón de baja al estado objetivo", () => {
      expect(retirementTargetStatus("perdida")).toBe("perdido")
      expect(retirementTargetStatus("robo")).toBe("robado")
      expect(retirementTargetStatus("venta")).toBe("dado_de_baja")
    })

    it("exige doble control: el autorizante debe ser otro usuario activo", async () => {
      const assetId = await makeAsset("TI-R-0004")

      // Misma persona como responsable y autorizante: la baja es irreversible
      // y el modelo separa ambos roles a propósito.
      await expect(retireAsset({
        assetId, date: "2026-09-01", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: actor.userId,
      }, actor)).rejects.toThrow(/distinto del responsable/i)

      await expect(retireAsset({
        assetId, date: "2026-09-01", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: "user-inexistente",
      }, actor)).rejects.toThrow(/no encontrado/i)

      // El activo sigue vigente: ninguna de las dos intentonas lo tocó.
      const asset = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
      expect(asset[0]?.status).toBe("disponible")
    })
  })

  describe("reversión de bajas", () => {
    it("revierte una baja simple (venta) y devuelve el activo a disponible", async () => {
      const assetId = await makeAsset("TI-RV-0001")
      const retirementId = await retireAsset({
        assetId, date: "2026-09-01", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)

      const { assetId: returnedAssetId, restoredStatus } = await reverseRetirement(
        retirementId, "Se dio de baja el activo equivocado", actor,
      )
      expect(returnedAssetId).toBe(assetId)
      expect(restoredStatus).toBe("disponible")

      const [asset] = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
      expect(asset?.status).toBe("disponible")
      expect(asset?.workerId).toBeNull()

      const [retirementRow] = await testDb.select().from(schema.itAssetRetirements)
        .where(eq(schema.itAssetRetirements.id, retirementId))
      expect(retirementRow?.reversedAt).toBeTruthy()
      expect(retirementRow?.reverseReason).toBe("Se dio de baja el activo equivocado")

      const history = await getAssetHistory(assetId)
      expect(history.some((h) => h.action === "retirement_reversed")).toBe(true)
      const statusHistory = await testDb.select().from(schema.statusHistory)
        .where(eq(schema.statusHistory.entityId, assetId))
      expect(statusHistory.some((h) => h.toStatus === "disponible" && h.fromStatus === "dado_de_baja")).toBe(true)
    })

    it("revierte una baja por pérdida y reabre la asignación que cerró", async () => {
      const assetId = await makeAsset("TI-RV-0002")
      await createAssignment({
        assetId, workerId: "wk-ti-juan", worksiteId: "ws-ti-norte", kind: "delivery",
        deliveredAt: "2026-08-01T10:00", physicalState: "bueno", accessoryNames: [], photoIds: [],
      }, actor)
      const retirementId = await retireAsset({
        assetId, date: "2026-09-01", reason: "perdida",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)

      await reverseRetirement(retirementId, "El equipo perdido era otro notebook", actor)

      const [asset] = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
      expect(asset?.status).toBe("asignado")
      expect(asset?.workerId).toBe("wk-ti-juan")

      const [assignment] = await testDb.select().from(schema.itAssetAssignments)
        .where(eq(schema.itAssetAssignments.assetId, assetId))
      expect(assignment?.returnedAt).toBeNull()
      expect(assignment?.returnedByUserId).toBeNull()
      expect(assignment?.returnObservations).toBeNull()
    })

    it("no reabre si la asignación registra una devolución física real posterior", async () => {
      const assetId = await makeAsset("TI-RV-0003")
      const assignmentId = await createAssignment({
        assetId, workerId: "wk-ti-juan", worksiteId: "ws-ti-norte", kind: "delivery",
        deliveredAt: "2026-08-01T10:00", physicalState: "bueno", accessoryNames: [], photoIds: [],
      }, actor)
      const retirementId = await retireAsset({
        assetId, date: "2026-09-01", reason: "perdida",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)

      // `retireAsset` nunca escribe `returnPhysicalState`: un valor no nulo
      // prueba que una `returnAssignment` real pasó encima de esta fila.
      await testDb.update(schema.itAssetAssignments).set({ returnPhysicalState: "bueno" })
        .where(eq(schema.itAssetAssignments.id, assignmentId))

      await expect(reverseRetirement(retirementId, "Intento de revertir sobre una fila ya cerrada de verdad", actor))
        .rejects.toThrow(/devolución física posterior/)
    })

    it("rechaza revertir dos veces", async () => {
      const assetId = await makeAsset("TI-RV-0004")
      const retirementId = await retireAsset({
        assetId, date: "2026-09-01", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)
      await reverseRetirement(retirementId, "Primera reversión válida", actor)

      await expect(reverseRetirement(retirementId, "Segundo intento sobre la misma baja", actor))
        .rejects.toThrow(/ya fue revertida/)
    })

    it("rechaza un motivo de menos de 10 caracteres", async () => {
      const assetId = await makeAsset("TI-RV-0005")
      const retirementId = await retireAsset({
        assetId, date: "2026-09-01", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)

      await expect(reverseRetirement(retirementId, "corto", actor)).rejects.toThrow(/al menos 10 caracteres/)
    })

    it("rechaza revertir si el estado del activo ya fue sobrescrito manualmente", async () => {
      const assetId = await makeAsset("TI-RV-0006")
      const retirementId = await retireAsset({
        assetId, date: "2026-09-01", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)

      // Hueco real y documentado del módulo: `changeAssetStatus` permite
      // "resucitar" un activo dado de baja sin pasar por `reverseRetirement`.
      await changeAssetStatus({ assetId, status: "disponible", reason: "Reactivado a mano" }, actor)

      await expect(reverseRetirement(retirementId, "Intento de revertir sobre un estado ya cambiado", actor))
        .rejects.toThrow(/ya fue sobrescrito/)
    })

    it("rechaza revertir si existe una baja posterior para el mismo activo", async () => {
      const assetId = await makeAsset("TI-RV-0007")
      const firstRetirementId = await retireAsset({
        assetId, date: "2026-09-01", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)
      await changeAssetStatus({ assetId, status: "disponible", reason: "Reactivado a mano" }, actor)
      await retireAsset({
        assetId, date: "2026-09-05", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)

      await expect(reverseRetirement(firstRetirementId, "Intento de revertir la baja más antigua", actor))
        .rejects.toThrow(/baja posterior/)
    })

    it("rechaza revertir si el activo fue eliminado del inventario", async () => {
      const assetId = await makeAsset("TI-RV-0008")
      const retirementId = await retireAsset({
        assetId, date: "2026-09-01", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)
      await softDeleteAsset(assetId, actor)

      await expect(reverseRetirement(retirementId, "Intento sobre un activo ya eliminado", actor))
        .rejects.toThrow(/eliminado del inventario/)
    })

    it("rechaza una baja anterior a esta función (sin previousStatus registrado)", async () => {
      const assetId = await makeAsset("TI-RV-0009")
      const retirementId = await retireAsset({
        assetId, date: "2026-09-01", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)
      // Simula una baja histórica anterior a la migración que agregó estas columnas.
      await testDb.update(schema.itAssetRetirements).set({ previousStatus: null })
        .where(eq(schema.itAssetRetirements.id, retirementId))

      await expect(reverseRetirement(retirementId, "Intento sobre una baja histórica", actor))
        .rejects.toThrow(/anterior a esta función/)
    })

    it("respeta el scope de faena al revertir", async () => {
      const assetId = await makeAsset("TI-RV-0010")
      const retirementId = await retireAsset({
        assetId, date: "2026-09-01", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)

      await expect(reverseRetirement(retirementId, "Intento fuera del scope de faena", actor, ["ws-ti-sur"]))
        .rejects.toThrow(/No tienes acceso a esta faena/)
    })

    it("permite dar de baja de nuevo después de revertir (el ciclo de uso real)", async () => {
      const assetId = await makeAsset("TI-RV-0011")
      const firstRetirementId = await retireAsset({
        assetId, date: "2026-09-01", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)
      await reverseRetirement(firstRetirementId, "Baja registrada por error, activo sigue en uso", actor)

      const secondRetirementId = await retireAsset({
        assetId, date: "2026-09-10", reason: "reciclaje",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)

      const [asset] = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
      expect(asset?.status).toBe("dado_de_baja")

      // Lo que hace valioso el ciclo: la segunda baja captura el estado al que
      // la reversión dejó el activo, y es a su vez reversible. La primera, ya
      // revertida, queda bloqueada para siempre.
      const listed = await listRetirements({ assetId })
      const second = listed.find((r) => r.id === secondRetirementId)
      expect(second?.previousStatus).toBe("disponible")
      expect(second?.canReverse).toBe(true)
      expect(listed.find((r) => r.id === firstRetirementId)?.canReverse).toBe(false)
    })

    it("rechaza revertir si el activo registra un movimiento posterior a la baja", async () => {
      const assetId = await makeAsset("TI-RV-0013")
      const retirementId = await retireAsset({
        assetId, date: "2026-09-01", reason: "perdida",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)

      // Movimiento posterior que NO cambia el estado del activo, así que no
      // dispara C3 (estado sobrescrito) ni C4 (baja posterior): aísla el
      // predicado de "algo se movió desde entonces", el único que depende de
      // que `now()` sea el timestamp de transacción en Postgres.
      await testDb.insert(schema.itAssetHistory).values({
        id: "hist-rv-0013",
        assetId,
        action: "status_changed",
        detail: "Movimiento posterior a la baja",
        actorUserId: actor.userId,
        createdAt: new Date(Date.now() + 60_000).toISOString(),
      })

      const listed = (await listRetirements({ assetId })).find((r) => r.id === retirementId)
      expect(listed?.canReverse).toBe(false)
      expect(listed?.reverseBlockedReason).toMatch(/movimientos posteriores/)

      await expect(reverseRetirement(retirementId, "Intento sobre una baja con movimientos posteriores", actor))
        .rejects.toThrow(/movimientos posteriores/)
    })

    it("listRetirements marca canReverse y el motivo de bloqueo", async () => {
      const assetId = await makeAsset("TI-RV-0012")
      const retirementId = await retireAsset({
        assetId, date: "2026-09-01", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: AUTHORIZER,
      }, actor)

      const before = (await listRetirements({ assetId })).find((r) => r.id === retirementId)
      expect(before?.canReverse).toBe(true)
      expect(before?.reverseBlockedReason).toBeNull()

      await reverseRetirement(retirementId, "Motivo de reversión válido", actor)

      const after = (await listRetirements({ assetId })).find((r) => r.id === retirementId)
      expect(after?.canReverse).toBe(false)
      expect(after?.reverseBlockedReason).toMatch(/ya fue revertida/)
    })
  })

  describe("proveedores TI y garantías", () => {
    it("vincula un proveedor con categoría y agrega conteos", async () => {
      await createSupplierLink({ supplierId: "sup-ti-repuestos", category: "reparacion" }, actor)
      const links = await listSupplierLinks()
      const link = links.find((l) => l.supplierId === "sup-ti-repuestos")
      expect(link?.supplierName).toBe("Repuestos TI Ltda.")
      expect(link?.category).toBe("reparacion")
    })

    it("impide duplicar el vínculo (proveedor, categoría)", async () => {
      await expect(createSupplierLink({ supplierId: "sup-ti-repuestos", category: "reparacion" }, actor))
        .rejects.toThrow()
    })

    it("elimina un vínculo", async () => {
      const id = await createSupplierLink({ supplierId: "sup-ti-repuestos", category: "licencias" }, actor)
      await deleteSupplierLink(id, actor)
      expect((await listSupplierLinks()).some((l) => l.id === id)).toBe(false)
    })

    it("filtra garantías por ventana de vencimiento", async () => {
      const porVencer = await makeAsset("TI-W-0001")
      const vencida = await makeAsset("TI-W-0002")
      const activa = await makeAsset("TI-W-0003")
      await testDb.update(schema.itAssets).set({ warrantyEndDate: plainDateIn(10) }).where(eq(schema.itAssets.id, porVencer))
      await testDb.update(schema.itAssets).set({ warrantyEndDate: plainDateIn(-5) }).where(eq(schema.itAssets.id, vencida))
      await testDb.update(schema.itAssets).set({ warrantyEndDate: plainDateIn(120) }).where(eq(schema.itAssets.id, activa))

      const en30 = await listAssetsByWarranty({ window: "expiring_30" })
      expect(en30.map((a) => a.id)).toContain(porVencer)
      expect(en30.map((a) => a.id)).not.toContain(vencida)
      expect(en30.map((a) => a.id)).not.toContain(activa)

      const vencidas = await listAssetsByWarranty({ window: "expired" })
      expect(vencidas.map((a) => a.id)).toContain(vencida)
    })
  })
})
