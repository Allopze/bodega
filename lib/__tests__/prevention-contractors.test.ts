import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible with the app DB shape in tests.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.contractorDocuments)
  await inMemoryDb.delete(schema.contractorWorkers)
  await inMemoryDb.delete(schema.contractors)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)

  await inMemoryDb.insert(schema.worksites).values({ id: "ws-1", name: "Faena A", code: "FA", isActive: true })
  await inMemoryDb.insert(schema.workers).values({
    id: "worker-1", firstName: "Juan", lastName: "Perez", rut: "11.111.111-1", worksiteId: "ws-1",
  })
})

describe("prevention contractors service (P3.19)", () => {
  it("creates a contractor, associates a worker and a document", async () => {
    const { createContractor, addContractorWorker, addContractorDocument, getContractor } = await import("@/lib/services/prevention-contractors")

    const contractor = await createContractor({
      rut: "76.123.456-7",
      name: "Contratista SPA",
      legalRepresentative: "Ana Soto",
      contact: "ana@contratista.cl",
      status: "activo",
    })
    expect(contractor.status).toBe("activo")

    await addContractorWorker({
      contractorId: contractor.id,
      workerId: "worker-1",
      position: "Soldador",
      startDate: "2026-01-01",
    })

    await addContractorDocument({
      contractorId: contractor.id,
      type: "certificado_antecedentes",
      status: "vigente",
      expiresAt: "2026-12-31",
    })

    const full = await getContractor(contractor.id)
    expect(full).not.toBeNull()
    expect(full!.workers).toHaveLength(1)
    expect(full!.documents).toHaveLength(1)
    expect(full!.documents[0]!.type).toBe("certificado_antecedentes")
  })

  it("upserts a contractor on conflicting RUT instead of creating a duplicate", async () => {
    const { createContractor, listContractors } = await import("@/lib/services/prevention-contractors")

    await createContractor({ rut: "76.999.999-9", name: "Nombre viejo", status: "activo" })
    await createContractor({ rut: "76.999.999-9", name: "Nombre nuevo", status: "inactivo" })

    const all = await listContractors()
    expect(all).toHaveLength(1)
    expect(all[0]!.name).toBe("Nombre nuevo")
    expect(all[0]!.status).toBe("inactivo")
  })

  it("flags documents expiring within the given horizon", async () => {
    const { createContractor, addContractorDocument, getExpiringContractorDocuments } = await import("@/lib/services/prevention-contractors")

    const contractor = await createContractor({ rut: "76.555.555-5", name: "Contratista B", status: "activo" })
    await addContractorDocument({ contractorId: contractor.id, type: "contrato_trabajo", status: "vigente", expiresAt: "2026-07-10" })
    await addContractorDocument({ contractorId: contractor.id, type: "epp_entregado", status: "vigente", expiresAt: "2027-01-01" })

    const expiring = await getExpiringContractorDocuments(30, "2026-07-01")
    expect(expiring).toHaveLength(1)
    expect(expiring[0]!.type).toBe("contrato_trabajo")
  })
})
