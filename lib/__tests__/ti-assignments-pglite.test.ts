import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq, and, isNull } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { seedTiBase, seedAssetType } from "./helpers/ti-seeds"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

import {
  createAssignment, recordAssignmentAcceptance, returnAssignment, transferAssignment,
  listAssignments, getAssignmentById, getAssignmentAccessories, getAssignmentPhotos,
} from "@/lib/services/ti/assignments"
import { createAsset } from "@/lib/services/ti/assets"
import { getAssetHistory } from "@/lib/services/ti/history"
import { cleanupOrphanPhotos, deletePendingPhoto, persistPendingPhoto } from "@/lib/services/ti/assignment-photos"

describe("módulo TI — asignaciones (custodia)", () => {
  let typeId: string
  const actor = { userId: "user-ti-tecnico", userEmail: "tecnico@ti.cl" }

  async function makeAsset(code: string, worksiteId = "ws-ti-norte") {
    return createAsset({ code, assetTypeId: typeId, worksiteId }, actor)
  }

  async function preuploadPhoto(id: string, stage: "delivery" | "return") {
    await testDb.insert(schema.itAssignmentPhotos).values({
      id,
      assignmentId: null,
      stage,
      fileName: `${id}.jpg`,
      filePath: `storage/ti/${id}.jpg`,
      fileSize: 1024,
      mimeType: "image/jpeg",
      uploadedByUserId: actor.userId,
    })
  }

  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await seedTiBase(testDb)
    typeId = await seedAssetType(testDb)
  })

  afterAll(async () => pg.close())

  it("entrega un activo, lo deja 'asignado' y ancla las fotos pre-subidas", async () => {
    const assetId = await makeAsset("TI-A-0001")
    await preuploadPhoto("ph-entrega-1", "delivery")

    const assignmentId = await createAssignment({
      assetId,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      kind: "delivery",
      deliveredAt: "2026-09-01T10:00",
      physicalState: "bueno",
      observations: "Entrega inicial",
      accessoryNames: ["Cargador", "Bolso"],
      photoIds: ["ph-entrega-1"],
    }, actor)

    expect(assignmentId).toBeTruthy()

    const assignment = await getAssignmentById(assignmentId)
    expect(assignment?.code).toMatch(/^ACT-\d{4}-\d{4}$/)
    expect(assignment?.workerName).toBe("Juan Pérez")
    /*
     * TIA-001 (auditoría 2026-09-14): esta prueba afirmaba lo CONTRARIO
     * —`expect(assignment?.acceptedByName).toBe("Técnico TI")`—, es decir,
     * consagraba que el acta naciera aceptada y firmada por el mismo técnico
     * que la emitía. El acta de entrega de un notebook registraba como
     * aceptante a quien lo entrega. Ahora nace pendiente de acuse.
     */
    expect(assignment?.acceptanceStatus).toBe("pendiente")
    expect(assignment?.acceptedByUserId).toBeNull()
    expect(assignment?.acceptedAt).toBeNull()

    const asset = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
    expect(asset[0]?.status).toBe("asignado")
    expect(asset[0]?.workerId).toBe("wk-ti-juan")

    const accessories = await getAssignmentAccessories(assignmentId)
    expect(accessories.map((a) => a.name).sort()).toEqual(["Bolso", "Cargador"])

    // La foto pre-subida quedó anclada a la asignación (stage delivery).
    const photos = await getAssignmentPhotos(assignmentId)
    expect(photos).toHaveLength(1)
    expect(photos[0]?.stage).toBe("delivery")
  })

  it("impide entregar un activo ya asignado (invariante: una asignación abierta por activo)", async () => {
    const assetId = await makeAsset("TI-A-0002")
    await createAssignment({
      assetId,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      deliveredAt: "2026-09-01T10:00",
      physicalState: "bueno",
      accessoryNames: [],
      photoIds: [],
    }, actor)

    await expect(createAssignment({
      assetId,
      workerId: "wk-ti-maria",
      worksiteId: "ws-ti-sur",
      deliveredAt: "2026-09-02T10:00",
      physicalState: "bueno",
      accessoryNames: [],
      photoIds: [],
    }, actor)).rejects.toThrow(/no puede entregarse/)

    // Invariante de custodia a nivel de BD: el índice único parcial sobre
    // (asset_id) WHERE returned_at IS NULL rechaza una segunda asignación
    // abierta aunque el servicio no la atrapara.
    await expect(testDb.insert(schema.itAssetAssignments).values({
      id: "asg-duplicada-db",
      code: "ACT-2099-0002",
      assetId,
      workerId: "wk-ti-maria",
      worksiteId: "ws-ti-sur",
      kind: "delivery",
      deliveredAt: new Date().toISOString(),
      deliveredByUserId: actor.userId,
      physicalState: "bueno",
    })).rejects.toThrow()
  })

  it("impide entregar un activo en reparación o dado de baja", async () => {
    const assetId = await makeAsset("TI-A-0003")
    await testDb.update(schema.itAssets).set({ status: "en_reparacion" }).where(eq(schema.itAssets.id, assetId))

    await expect(createAssignment({
      assetId,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      deliveredAt: "2026-09-01T10:00",
      physicalState: "bueno",
      accessoryNames: [],
      photoIds: [],
    }, actor)).rejects.toThrow(/no puede entregarse/)
  })

  it("rechaza la entrega fuera de la faena permitida por scope", async () => {
    const assetId = await makeAsset("TI-A-0004", "ws-ti-sur")
    await expect(createAssignment({
      assetId,
      workerId: "wk-ti-maria",
      worksiteId: "ws-ti-sur",
      deliveredAt: "2026-09-01T10:00",
      physicalState: "bueno",
      accessoryNames: [],
      photoIds: [],
    }, actor, ["ws-ti-norte"])).rejects.toThrow(/No tienes acceso a esta faena/)
  })

  it("no permite que una faena tome un activo que pertenece a otra faena", async () => {
    const assetId = await makeAsset("TI-A-SCOPE-ORIGEN", "ws-ti-norte")
    await expect(createAssignment({
      assetId,
      workerId: "wk-ti-maria",
      worksiteId: "ws-ti-sur",
      deliveredAt: "2026-09-01T10:00",
      physicalState: "bueno",
      accessoryNames: [],
      photoIds: [],
    }, actor, ["ws-ti-sur"])).rejects.toThrow(/No tienes acceso a esta faena/)
  })

  it("exige que la faena de la asignación coincida con la del trabajador", async () => {
    const assetId = await makeAsset("TI-A-FAENA-TRABAJADOR")

    await expect(createAssignment({
      assetId,
      workerId: "wk-ti-maria",
      worksiteId: "ws-ti-norte",
      deliveredAt: "2026-09-03T10:00",
      physicalState: "bueno",
      accessoryNames: [],
      photoIds: [],
    }, actor)).rejects.toThrow(/trabajador.*faena/i)
  })

  it("solo ancla a la entrega una foto pendiente subida por el técnico que la registra", async () => {
    const assetId = await makeAsset("TI-A-FOTO-OTRO-TECNICO")
    await testDb.insert(schema.itAssignmentPhotos).values({
      id: "ph-entrega-otro-tecnico",
      assignmentId: null,
      stage: "delivery",
      fileName: "otro-tecnico.jpg",
      filePath: "storage/ti/otro-tecnico.jpg",
      fileSize: 1024,
      mimeType: "image/jpeg",
      uploadedByUserId: "user-ti-gestor",
    })

    await expect(createAssignment({
      assetId,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      deliveredAt: "2026-09-03T10:00",
      physicalState: "bueno",
      accessoryNames: [],
      photoIds: ["ph-entrega-otro-tecnico"],
    }, actor)).rejects.toThrow(/fotografías.*técnico/i)
  })

  it("no permite anclar una foto que ya pertenece a otra asignación", async () => {
    const assetA = await makeAsset("TI-A-0005")
    const assetB = await makeAsset("TI-A-0006")
    await preuploadPhoto("ph-compartida", "delivery")

    await createAssignment({
      assetId: assetA,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      deliveredAt: "2026-09-01T10:00",
      physicalState: "bueno",
      accessoryNames: [],
      photoIds: ["ph-compartida"],
    }, actor)

    await expect(createAssignment({
      assetId: assetB,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      deliveredAt: "2026-09-02T10:00",
      physicalState: "bueno",
      accessoryNames: [],
      photoIds: ["ph-compartida"],
    }, actor)).rejects.toThrow(/fotografías.*(pendientes|asignación)/i)
  })

  it("permite descartar una carga pendiente antes de confirmar el acta", async () => {
    const photoId = await persistPendingPhoto({
      stage: "delivery",
      fileName: "pendiente.jpg",
      filePath: "storage/ti/pendiente.jpg",
      fileSize: 1024,
      mimeType: "image/jpeg",
      uploadedByUserId: actor.userId,
    })

    await expect(deletePendingPhoto(photoId, actor.userId)).resolves.toBe("storage/ti/pendiente.jpg")
    const remaining = await testDb.select({ id: schema.itAssignmentPhotos.id })
      .from(schema.itAssignmentPhotos)
      .where(eq(schema.itAssignmentPhotos.id, photoId))
    expect(remaining).toEqual([])
  })

  it("conserva las fotos de devolución pendientes durante la limpieza de huérfanos", async () => {
    const assetId = await makeAsset("TI-A-FOTO-PENDIENTE")
    const assignmentId = await createAssignment({
      assetId,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      deliveredAt: "2026-09-01T10:00",
      physicalState: "bueno",
      accessoryNames: [],
      photoIds: [],
    }, actor)
    await testDb.insert(schema.itAssignmentPhotos).values({
      id: "ph-devol-pendiente-antigua",
      assignmentId: null,
      pendingAssignmentId: assignmentId,
      stage: "return",
      fileName: "devolucion.jpg",
      filePath: "storage/ti/devolucion.jpg",
      fileSize: 1024,
      mimeType: "image/jpeg",
      uploadedByUserId: actor.userId,
      createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    })

    expect(await cleanupOrphanPhotos(60)).toBe(0)
    expect((await testDb.select({ id: schema.itAssignmentPhotos.id }).from(schema.itAssignmentPhotos)
      .where(eq(schema.itAssignmentPhotos.id, "ph-devol-pendiente-antigua")))).toHaveLength(1)
  })

  it("no permite preparar evidencia de devolución fuera del scope de la faena", async () => {
    const assetId = await makeAsset("TI-A-FOTO-SCOPE", "ws-ti-sur")
    const assignmentId = await createAssignment({
      assetId,
      workerId: "wk-ti-maria",
      worksiteId: "ws-ti-sur",
      deliveredAt: "2026-09-01T10:00",
      physicalState: "bueno",
      accessoryNames: [],
      photoIds: [],
    }, actor)

    await expect(persistPendingPhoto({
      stage: "return",
      pendingAssignmentId: assignmentId,
      fileName: "fuera-scope.jpg",
      filePath: "storage/ti/fuera-scope.jpg",
      fileSize: 1024,
      mimeType: "image/jpeg",
      uploadedByUserId: actor.userId,
    }, ["ws-ti-norte"])).rejects.toThrow(/No tienes acceso a esta faena/)
  })

  it("devuelve el activo, restaura 'disponible' y conserva fotos de devolución", async () => {
    const assetId = await makeAsset("TI-A-0007")
    const assignmentId = await createAssignment({
      assetId,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      deliveredAt: "2026-09-01T10:00",
      physicalState: "bueno",
      accessoryNames: ["Cargador"],
      photoIds: [],
    }, actor)

    // La foto de devolución queda pendiente para esta asignación hasta que el
    // acta se confirma; todavía no aparece como evidencia en la ficha.
    await testDb.insert(schema.itAssignmentPhotos).values({
      id: "ph-entrega-7",
      assignmentId,
      stage: "delivery",
      fileName: "ph-entrega-7.jpg",
      filePath: "storage/ti/ph-entrega-7.jpg",
      fileSize: 1024,
      mimeType: "image/jpeg",
      uploadedByUserId: actor.userId,
    })
    await testDb.insert(schema.itAssignmentPhotos).values({
      id: "ph-devol-1",
      assignmentId: null,
      pendingAssignmentId: assignmentId,
      stage: "return",
      fileName: "ph-devol-1.jpg",
      filePath: "storage/ti/ph-devol-1.jpg",
      fileSize: 2048,
      mimeType: "image/jpeg",
      uploadedByUserId: actor.userId,
    })

    expect((await getAssignmentPhotos(assignmentId)).map((photo) => photo.stage)).toEqual(["delivery"])

    await returnAssignment({
      assignmentId,
      returnedAt: "2026-09-10T17:00",
      returnPhysicalState: "regular",
      returnObservations: "Rayón en la tapa",
      returnedAccessoryNames: ["Cargador"],
      nextStatus: "disponible",
      photoIds: ["ph-devol-1"],
    }, actor)

    const asset = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
    expect(asset[0]?.status).toBe("disponible")
    expect(asset[0]?.workerId).toBeNull()

    const assignment = await getAssignmentById(assignmentId)
    expect(assignment?.returnedAt).toBeTruthy()
    expect(assignment?.returnPhysicalState).toBe("regular")

    // Invariante fotográfico: las fotos de entrega y devolución conviven (nunca se borran).
    const photos = await getAssignmentPhotos(assignmentId)
    expect(photos.map((p) => p.stage).sort()).toEqual(["delivery", "return"])

    const accessories = await getAssignmentAccessories(assignmentId)
    expect(accessories.find((a) => a.name === "Cargador")?.returnedAt).toBeTruthy()

    const history = await getAssetHistory(assetId)
    expect(history.some((h) => h.action === "returned")).toBe(true)
  })

  it("rechaza devolver dos veces la misma asignación", async () => {
    const assetId = await makeAsset("TI-A-0008")
    const assignmentId = await createAssignment({
      assetId,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      deliveredAt: "2026-09-01T10:00",
      physicalState: "bueno",
      accessoryNames: [],
      photoIds: [],
    }, actor)

    await returnAssignment({
      assignmentId,
      returnedAt: "2026-09-05T17:00",
      returnPhysicalState: "bueno",
      returnedAccessoryNames: [],
      nextStatus: "disponible",
      photoIds: [],
    }, actor)

    await expect(returnAssignment({
      assignmentId,
      returnedAt: "2026-09-06T17:00",
      returnPhysicalState: "bueno",
      returnedAccessoryNames: [],
      nextStatus: "disponible",
      photoIds: [],
    }, actor)).rejects.toThrow(/ya fue devuelta/)
  })

  it("no incorpora a una devolución evidencia subida por otro técnico", async () => {
    const assetId = await makeAsset("TI-A-DEVOL-FOTO-OTRO")
    const assignmentId = await createAssignment({
      assetId,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      deliveredAt: "2026-09-01T10:00",
      physicalState: "bueno",
      accessoryNames: [],
      photoIds: [],
    }, actor)
    await testDb.insert(schema.itAssignmentPhotos).values({
      id: "ph-devol-otro-tecnico",
      assignmentId: null,
      pendingAssignmentId: assignmentId,
      stage: "return",
      fileName: "devol-otro-tecnico.jpg",
      filePath: "storage/ti/devol-otro-tecnico.jpg",
      fileSize: 1024,
      mimeType: "image/jpeg",
      uploadedByUserId: "user-ti-gestor",
    })

    await expect(returnAssignment({
      assignmentId,
      returnedAt: "2026-09-04T17:00",
      returnPhysicalState: "bueno",
      returnedAccessoryNames: [],
      nextStatus: "disponible",
      photoIds: ["ph-devol-otro-tecnico"],
    }, actor)).rejects.toThrow(/fotografías.*técnico/i)
  })

  it("transfiere en una sola transacción: cierra la anterior y abre la nueva con el custodio nuevo", async () => {
    const assetId = await makeAsset("TI-A-0009")
    const firstId = await createAssignment({
      assetId,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      deliveredAt: "2026-09-01T10:00",
      physicalState: "bueno",
      accessoryNames: ["Cargador"],
      photoIds: [],
    }, actor)

    const secondId = await transferAssignment({
      assignmentId: firstId,
      returnedAt: "2026-09-15T09:00",
      returnPhysicalState: "bueno",
      newWorkerId: "wk-ti-maria",
      newWorksiteId: "ws-ti-sur",
      newDeliveredAt: "2026-09-15T10:00",
      newPhysicalState: "bueno",
      newObservations: "Transferencia entre faenas",
      newAccessoryNames: [],
      photoIds: [],
    }, actor)

    expect(secondId).not.toBe(firstId)

    const oldAssignment = await getAssignmentById(firstId)
    expect(oldAssignment?.returnedAt).toBeTruthy()
    const newAssignment = await getAssignmentById(secondId)
    expect(newAssignment?.workerName).toBe("María Gómez")
    expect(newAssignment?.kind).toBe("transfer")
    expect(newAssignment?.code).toMatch(/^ACT-\d{4}-\d{4}$/)

    const asset = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
    expect(asset[0]?.status).toBe("asignado")
    expect(asset[0]?.workerId).toBe("wk-ti-maria")

    const active = await testDb.select().from(schema.itAssetAssignments)
      .where(and(eq(schema.itAssetAssignments.assetId, assetId), isNull(schema.itAssetAssignments.returnedAt)))
    expect(active).toHaveLength(1)
    expect(active[0]?.id).toBe(secondId)
    expect((await getAssignmentAccessories(firstId))[0]?.returnedAt).toBeTruthy()
    expect((await getAssignmentAccessories(secondId)).map((accessory) => accessory.name)).toEqual(["Cargador"])
  })

  it("lista asignaciones activas y devueltas", async () => {
    const active = await listAssignments({ status: "active" })
    expect(active.length).toBeGreaterThan(0)
    const returned = await listAssignments({ status: "returned" })
    expect(returned.length).toBeGreaterThan(0)
  })

  it("un préstamo (kind: loan) deja el activo en 'en_prestamo', no en 'asignado'", async () => {
    const assetId = await makeAsset("TI-A-LOAN-01")
    const assignmentId = await createAssignment({
      assetId,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      kind: "loan",
      deliveredAt: "2026-09-01T10:00",
      physicalState: "bueno",
      accessoryNames: [],
      photoIds: [],
    }, actor)

    const [asset] = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
    expect(asset?.status).toBe("en_prestamo")
    expect(asset?.workerId).toBe("wk-ti-juan")

    // Antes de este cambio, `en_prestamo` nunca coexistía con una asignación
    // abierta y esta rama de `returnAssignment` era código inalcanzable.
    await returnAssignment({
      assignmentId,
      returnedAt: "2026-09-05T09:00",
      returnPhysicalState: "bueno",
      returnedAccessoryNames: [],
      nextStatus: "disponible",
      photoIds: [],
    }, actor)

    const [returnedAsset] = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
    expect(returnedAsset?.status).toBe("disponible")
    expect(returnedAsset?.workerId).toBeNull()
  })

  it("una salida a reparación (kind: repair_exit) deja el activo en 'en_reparacion' y se puede devolver", async () => {
    const assetId = await makeAsset("TI-A-REPAIR-01")
    const assignmentId = await createAssignment({
      assetId,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      kind: "repair_exit",
      deliveredAt: "2026-09-01T10:00",
      physicalState: "malo",
      accessoryNames: [],
      photoIds: [],
    }, actor)

    const [asset] = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
    expect(asset?.status).toBe("en_reparacion")

    await returnAssignment({
      assignmentId,
      returnedAt: "2026-09-08T09:00",
      returnPhysicalState: "bueno",
      returnedAccessoryNames: [],
      nextStatus: "en_bodega",
      photoIds: [],
    }, actor)

    const [returnedAsset] = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
    expect(returnedAsset?.status).toBe("en_bodega")
  })

  it("una transferencia (kind: transfer) sigue dejando el activo 'asignado'", async () => {
    const assetId = await makeAsset("TI-A-TRANSFER-01")
    const firstAssignmentId = await createAssignment({
      assetId,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      kind: "delivery",
      deliveredAt: "2026-09-01T10:00",
      physicalState: "bueno",
      accessoryNames: [],
      photoIds: [],
    }, actor)

    await transferAssignment({
      assignmentId: firstAssignmentId,
      returnedAt: "2026-09-03T10:00",
      returnPhysicalState: "bueno",
      newWorkerId: "wk-ti-maria",
      newWorksiteId: "ws-ti-sur",
      newDeliveredAt: "2026-09-03T10:00",
      newPhysicalState: "bueno",
      newAccessoryNames: [],
      photoIds: [],
    }, actor)

    const [asset] = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
    expect(asset?.status).toBe("asignado")
    expect(asset?.workerId).toBe("wk-ti-maria")
  })

  it("una transferencia con newKind: loan deriva el estado igual que una entrega en préstamo", async () => {
    // El test de arriba no distingue el código nuevo del viejo (sin `newKind`,
    // ambos dejan "asignado"). Este ejercita la derivación real: es la única
    // cobertura de la rama `assignmentTargetStatus(input.newKind)` de
    // `transferAssignment`, y también fija que la auditoría guarde el `kind`
    // realmente insertado y no "transfer" fijo.
    const assetId = await makeAsset("TI-A-TRANSFER-02")
    const firstAssignmentId = await createAssignment({
      assetId,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      kind: "delivery",
      deliveredAt: "2026-09-01T10:00",
      physicalState: "bueno",
      accessoryNames: [],
      photoIds: [],
    }, actor)

    await transferAssignment({
      assignmentId: firstAssignmentId,
      returnedAt: "2026-09-03T10:00",
      returnPhysicalState: "bueno",
      newWorkerId: "wk-ti-maria",
      newWorksiteId: "ws-ti-sur",
      newKind: "loan",
      newDeliveredAt: "2026-09-03T10:00",
      newPhysicalState: "bueno",
      newAccessoryNames: [],
      photoIds: [],
    }, actor)

    const [asset] = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
    expect(asset?.status).toBe("en_prestamo")
    expect(asset?.workerId).toBe("wk-ti-maria")

    const [nueva] = await testDb.select().from(schema.itAssetAssignments)
      .where(and(eq(schema.itAssetAssignments.assetId, assetId), isNull(schema.itAssetAssignments.returnedAt)))
    expect(nueva?.kind).toBe("loan")
  })

  /* ── TIA-001 y TIA-002 · el acuse del acta de entrega ───────────────────── */

  describe("acuse del acta (TIA-001 / TIA-002)", () => {
    const gestor = { userId: "user-ti-gestor", userEmail: "gestor@ti.cl" }

    async function entrega(code: string) {
      const assetId = await makeAsset(code)
      return createAssignment({
        assetId,
        workerId: "wk-ti-juan",
        worksiteId: "ws-ti-norte",
        kind: "delivery",
        deliveredAt: "2026-09-01T10:00",
        physicalState: "bueno",
        accessoryNames: [],
        photoIds: [],
      }, actor)
    }

    it("no deja que el acuse lo registre el mismo técnico que entregó el equipo", async () => {
      // TIA-001: era exactamente lo que hacía el código anterior, y sin
      // pedirlo: el acta nacía aceptada con `acceptedByUserId = actor.userId`.
      const assignmentId = await entrega("TI-A-ACUSE-01")
      await expect(
        recordAssignmentAcceptance({ assignmentId, outcome: "aceptada" }, actor),
      ).rejects.toThrow(/persona distinta/i)

      const acta = await getAssignmentById(assignmentId)
      expect(acta?.acceptanceStatus).toBe("pendiente")
    })

    it("acepta el acuse cuando lo registra alguien distinto del entregador", async () => {
      const assignmentId = await entrega("TI-A-ACUSE-02")
      await recordAssignmentAcceptance(
        { assignmentId, outcome: "aceptada", note: "Firma en papel archivada en la faena" },
        gestor,
      )

      const acta = await getAssignmentById(assignmentId)
      expect(acta?.acceptanceStatus).toBe("aceptada")
      expect(acta?.acceptedByUserId).toBe("user-ti-gestor")
      expect(acta?.acceptedAt).toBeTruthy()
    })

    it("distingue «no hubo acuse» de «aceptada» y exige el motivo (TIA-002)", async () => {
      // Antes, la única forma de no marcar el acta como aceptada dejaba dos
      // columnas nulas: un acta sin acuse era indistinguible de una entrega
      // migrada o de un registro incompleto.
      const assignmentId = await entrega("TI-A-ACUSE-03")
      await expect(
        recordAssignmentAcceptance({ assignmentId, outcome: "sin_acuse", note: "no" }, gestor),
      ).rejects.toThrow(/Explica/i)

      await recordAssignmentAcceptance(
        { assignmentId, outcome: "sin_acuse", note: "El trabajador salió de turno antes de firmar" },
        gestor,
      )
      const acta = await getAssignmentById(assignmentId)
      expect(acta?.acceptanceStatus).toBe("sin_acuse")
      expect(acta?.acceptedAt).toBeNull()
      expect(acta?.acceptanceNote).toMatch(/salió de turno/)
    })

    it("una transferencia también nace pendiente de acuse", async () => {
      // TIA-001: la transferencia era peor que la entrega —marcaba el acta
      // nueva como aceptada por el técnico sin ofrecer siquiera la opción de
      // dejarla sin aceptar—.
      const assetId = await makeAsset("TI-A-ACUSE-04")
      const first = await createAssignment({
        assetId, workerId: "wk-ti-juan", worksiteId: "ws-ti-norte", kind: "delivery",
        deliveredAt: "2026-09-01T10:00", physicalState: "bueno", accessoryNames: [], photoIds: [],
      }, actor)
      const nuevo = await transferAssignment({
        assignmentId: first,
        returnedAt: "2026-09-03T10:00",
        returnPhysicalState: "bueno",
        newWorkerId: "wk-ti-maria",
        newWorksiteId: "ws-ti-sur",
        newDeliveredAt: "2026-09-03T10:00",
        newPhysicalState: "bueno",
        newAccessoryNames: [],
        photoIds: [],
      }, actor)

      const acta = await getAssignmentById(nuevo)
      expect(acta?.acceptanceStatus).toBe("pendiente")
      expect(acta?.acceptedByUserId).toBeNull()
    })
  })
})
