/**
 * CO-021: el "próximo vencimiento" salía de un `MIN` sobre TODOS los documentos
 * del equipo, así que la póliza del año pasado —ya reemplazada— dejaba al
 * vehículo en atraso perpetuo por más que se subiera la nueva. Ahora cada tipo
 * tiene una sola versión vigente, la historia se conserva como `replaced`, y la
 * columna declarada del equipo es la fuente canónica cuando existe.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { uploadFleetDocument, deleteFleetDocument, getFleetOverview, getFleetOverviewPage } = await import("@/lib/services/fleet")

const worksiteId = nanoid()
const equipmentTypeId = nanoid()
const vehicleId = nanoid()
const userId = nanoid()

function session(): Session {
  return {
    user: {
      id: userId, name: "Jefe de flota", email: "flota@example.com", roles: ["administrador"],
      permissions: ["flota:view", "flota:manage_documents"],
      worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: true,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as unknown as Session
}

const upload = (documentType: string, expiresAt: string | null, fileName = `${documentType}.pdf`) =>
  uploadFleetDocument({
    vehicleId, documentType, fileName,
    filePath: `flota/${nanoid()}.pdf`, fileSize: 1024, mimeType: "application/pdf", expiresAt,
  }, session(), "all")

const currentDocs = () => inMemoryDb.select().from(schema.fleetVehicleDocuments)
  .where(and(eq(schema.fleetVehicleDocuments.vehicleId, vehicleId), eq(schema.fleetVehicleDocuments.status, "current")))

describe("versionado de documentos de flota", () => {
  beforeEach(async () => {
    await inMemoryDb.delete(schema.fleetVehicleDocuments)
    await inMemoryDb.delete(schema.auditLog)
    await inMemoryDb.delete(schema.fuelVehicles)
    await inMemoryDb.delete(schema.fuelEquipmentTypes)
    await inMemoryDb.delete(schema.users)
    await inMemoryDb.delete(schema.worksites)

    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena A", code: `FA-${nanoid().slice(0, 8)}` })
    await inMemoryDb.insert(schema.users).values({ id: userId, name: "Jefe", email: `jefe-${nanoid()}@example.com`, hashedPassword: "x" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId, slug: `camion-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehicleId, plate: `AA${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId, worksiteId, isActive: true,
    })
  })

  it("subir una versión nueva retira la anterior sin borrarla", async () => {
    const oldId = await upload("Seguro", "2025-06-30", "poliza-2024.pdf")
    const newId = await upload("Seguro", "2027-06-30", "poliza-2026.pdf")

    const current = await currentDocs()
    expect(current.map((doc) => doc.id)).toEqual([newId])

    const [replaced] = await inMemoryDb.select().from(schema.fleetVehicleDocuments)
      .where(eq(schema.fleetVehicleDocuments.id, oldId))
    expect(replaced?.status).toBe("replaced")
    expect(replaced?.supersededBy).toBe(newId)
    expect(replaced?.supersededAt).toBeTruthy()
  })

  it("la póliza reemplazada deja de decidir el próximo vencimiento", async () => {
    await upload("Seguro", "2025-06-30", "poliza-2024.pdf")
    const overdue = await getFleetOverview(session())
    expect(overdue.find((row) => row.id === vehicleId)?.nextExpiryDate).toBe("2025-06-30")

    await upload("Seguro", "2027-06-30", "poliza-2026.pdf")
    const renewed = await getFleetOverview(session())
    expect(renewed.find((row) => row.id === vehicleId)?.nextExpiryDate).toBe("2027-06-30")
  })

  it("la columna declarada del equipo manda sobre el documento del mismo tipo", async () => {
    await inMemoryDb.update(schema.fuelVehicles)
      .set({ insuranceExpiresAt: "2028-01-31" })
      .where(eq(schema.fuelVehicles.id, vehicleId))
    await upload("Seguro", "2026-01-31", "poliza.pdf")

    const fleet = await getFleetOverview(session())
    // El documento no aporta su fecha porque el tipo tiene columna declarada.
    expect(fleet.find((row) => row.id === vehicleId)?.nextExpiryDate).toBe("2028-01-31")
  })

  it("un tipo sin columna propia sí aporta su vencimiento", async () => {
    await upload("Certificado de emisiones", "2026-09-30")

    const fleet = await getFleetOverview(session())
    expect(fleet.find((row) => row.id === vehicleId)?.nextExpiryDate).toBe("2026-09-30")
  })

  it("limita los detalles de la flota a los IDs de la página sin perder el total", async () => {
    const secondVehicleId = nanoid()
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: secondVehicleId, plate: `ZZ${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId, worksiteId, isActive: true,
    })

    const page = await getFleetOverviewPage(
      session(),
      {},
      { today: "2026-08-22", warningWindowEnd: "2026-09-21" },
      { offset: 0, limit: 1 },
    )

    expect(page.total).toBe(2)
    expect(page.index).toHaveLength(2)
    expect(page.rows).toHaveLength(1)
  })

  it("borrar el vigente devuelve la vigencia a la versión anterior", async () => {
    await upload("Seguro", "2025-06-30", "poliza-2024.pdf")
    const newId = await upload("Seguro", "2027-06-30", "poliza-2026.pdf")

    await deleteFleetDocument(newId, session(), "all")

    const current = await currentDocs()
    expect(current).toHaveLength(1)
    expect(current[0]?.expiresAt).toBe("2025-06-30")
    expect(current[0]?.supersededBy).toBeNull()
  })
})
