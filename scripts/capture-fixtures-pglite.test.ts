import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { itAssignmentCaptureFixture } from "./capture-all-routes"

/**
 * Los fixtures de captura sólo se ejercitaban ejecutando `npm run ss` completo:
 * ninguna puerta determinista insertaba sus filas, así que una migración podía
 * invalidarlas y el repo no lo sabía hasta que alguien corría la auditoría y la
 * veía morir en el sembrado sin un solo PNG.
 *
 * Le pasó el 2026-09-15 con la migración 0281 (TIA-001): el acta de entrega de
 * TI nacía con `accepted_by_user_id` del mismo técnico que la entregaba y
 * `acceptance_status` en su DEFAULT 'pendiente', así que violaba
 * `it_asset_assignments_acceptance_coherent` y `prepareDatabase` abortaba la
 * corrida completa. Esta prueba inserta el fixture contra las migraciones
 * reales: si una restricción futura lo invalida, falla acá y no en una
 * auditoría.
 */
const pg = new PGlite()
const db = drizzle(pg, { schema })

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  await pg.close()
})

const now = "2026-06-09T12:00:00.000Z"
const worksiteId = "ws-audit-1"
const deliveredByUserId = "user-audit-admin"

describe("fixtures de captura frente a las restricciones de la base", () => {
  beforeAll(async () => {
    await db.insert(schema.users).values([
      { id: deliveredByUserId, name: "Admin Auditoría", email: "admin.audit@chome.cl", hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now },
      { id: "user-audit-jefa", name: "Jefa Operaciones", email: "jefa.audit@chome.cl", hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now },
    ])
    await db.insert(schema.worksites).values({
      id: worksiteId, name: "Faena Auditoría", code: "WS-AUD-1", isActive: true, createdAt: now, updatedAt: now,
    })
    await db.insert(schema.workers).values({
      id: "worker-audit-1", rut: "18.111.222-3", firstName: "Daniela", lastName: "Fuentes", position: "Operadora", worksiteId, isActive: true, createdAt: now,
    })
    await db.insert(schema.itAssetTypes).values({
      id: "it-asset-type-audit-1", name: "Notebook corporativo", category: "computacion", hasSpecs: true, isActive: true, createdAt: now, updatedAt: now,
    })
    await db.insert(schema.itAssets).values({
      id: "it-asset-audit-1", code: "TI-NB-0001", assetTypeId: "it-asset-type-audit-1", brand: "Lenovo", model: "ThinkPad T14",
      serialNumber: "CAPTURE-TI-0001", status: "asignado", workerId: "worker-audit-1", worksiteId, location: "Oficina de operaciones", createdAt: now, updatedAt: now,
    })
  })

  it("el acta de entrega de TI se siembra sin violar el CHECK de acuse (TIA-001)", async () => {
    const [assignment] = await db
      .insert(schema.itAssetAssignments)
      .values(itAssignmentCaptureFixture({ now, worksiteId, deliveredByUserId }))
      .returning()

    expect(assignment?.acceptanceStatus).toBe("aceptada")
    expect(assignment?.acceptedAt).not.toBeNull()
    // TIA-001: el acta no puede figurar aceptada por quien la entregó.
    expect(assignment?.acceptedByUserId).not.toBe(deliveredByUserId)
  })

  it("sigue rechazando el acuse que el fixture declaraba antes (pendiente con aceptante)", async () => {
    // La forma exacta que rompió la corrida: `acceptance_status` queda en su
    // DEFAULT 'pendiente' mientras las dos columnas del acuse vienen firmadas.
    // El nombre del CHECK viaja en `cause`: Drizzle envuelve el error de
    // Postgres y el mensaje de arriba sólo contiene el SQL.
    let thrown: unknown = null
    try {
      await db.insert(schema.itAssetAssignments).values({
        id: "it-assignment-audit-2", code: "ACT-2026-0002", assetId: "it-asset-audit-1",
        workerId: "worker-audit-1", worksiteId, kind: "delivery", deliveredAt: now,
        deliveredByUserId, physicalState: "bueno", acceptedAt: now, acceptedByUserId: deliveredByUserId,
        createdAt: now, updatedAt: now,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeTruthy()
    const cause = (thrown as { cause?: { message?: string } }).cause
    expect(`${(thrown as Error).message}\n${cause?.message ?? ""}`)
      .toMatch(/it_asset_assignments_acceptance_coherent/)
  })
})
