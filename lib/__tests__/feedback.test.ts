import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import {
  createReport,
  getReport,
  listReports,
  updateReportStatus,
} from "@/lib/services/feedback"

describe("feedback service", () => {
  beforeEach(async () => {
    await inMemoryDb.delete(schema.feedbackReports)
    await inMemoryDb.delete(schema.users)
    // Setup test users
    await inMemoryDb.insert(schema.users).values([
      { id: "user-1", email: "user1@test.cl", name: "User One", hashedPassword: "dummy_hash", isActive: true },
      { id: "user-2", email: "user2@test.cl", name: "User Two", hashedPassword: "dummy_hash", isActive: true },
    ])
  })

  afterAll(async () => {
    const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
    delete testGlobal.__db
    await pg.close()
  })

  it("creates a report successfully", async () => {
    const input = {
      tipo: "bug" as const,
      titulo: "Error al exportar",
      descripcion: "El botón de exportar no responde",
      pagina: "/reportes",
    }
    const report = await createReport(input, "user-1")

    expect(report.id).toBeDefined()
    expect(report.tipo).toBe("bug")
    expect(report.titulo).toBe("Error al exportar")
    expect(report.estado).toBe("abierto")
    expect(report.createdBy).toBe("user-1")
    expect(report.pagina).toBe("/reportes")
  })

  it("throws validation error for invalid report input", async () => {
    const input = {
      tipo: "invalid-type" as any,
      titulo: "",
      descripcion: "",
    }
    await expect(createReport(input, "user-1")).rejects.toThrow()
  })

  it("retrieves a report with author details", async () => {
    const input = {
      tipo: "consulta" as const,
      titulo: "Duda sobre stock",
      descripcion: "Cómo se calcula?",
    }
    const created = await createReport(input, "user-1")
    const retrieved = await getReport(created.id)

    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe(created.id)
    expect(retrieved!.authorName).toBe("User One")
    expect(retrieved!.authorEmail).toBe("user1@test.cl")

    const nonexistent = await getReport("non-existent-id")
    expect(nonexistent).toBeNull()
  })

  it("lists reports with filters, limit, and offset", async () => {
    const report1 = await createReport({ tipo: "bug", titulo: "T1", descripcion: "D1" }, "user-1")
    const report2 = await createReport({ tipo: "consulta", titulo: "T2", descripcion: "D2" }, "user-2")

    // Filter own
    const own = await listReports({ mode: "own", userId: "user-1" })
    expect(own).toHaveLength(1)
    expect(own[0].id).toBe(report1.id)

    // Filter all
    const all = await listReports({ mode: "all", userId: "user-1" })
    expect(all).toHaveLength(2)

    // Pagination
    const page = await listReports({ mode: "all", userId: "user-1" }, 1, 1)
    expect(page).toHaveLength(1)
    expect(page[0].id).toBe(report1.id) // Ordered by desc createdAt
  })

  it("updates report status and sets terminal resolution details", async () => {
    const created = await createReport({ tipo: "sugerencia", titulo: "T", descripcion: "D" }, "user-1")

    // Update non-terminal status
    const mid = await updateReportStatus(created.id, { estado: "en_progreso", notaInterna: "Nota interna" }, "user-2")
    expect(mid.estado).toBe("en_progreso")
    expect(mid.notaInterna).toBe("Nota interna")
    expect(mid.resolvedBy).toBeNull()

    // Update terminal status
    const resolved = await updateReportStatus(created.id, { estado: "resuelto" }, "user-2")
    expect(resolved.estado).toBe("resuelto")
    expect(resolved.resolvedBy).toBe("user-2")
    expect(resolved.resolvedAt).not.toBeNull()

    await expect(updateReportStatus("non-existent", { estado: "resuelto" }, "user-2")).rejects.toThrow("Reporte no encontrado")
  })
})
