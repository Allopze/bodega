/**
 * REQ-003 (auditoría 2026-09-14), última instancia del patrón P8: el Excel de
 * Solicitudes no reproducía el recorte de la pantalla. Exportar la pestaña «En
 * aprobación» —que agrupa dos estados— comparaba el estado con la cadena
 * `"submitted,in_review"` y devolvía **cero filas** con la lista llena.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const { solicitudesList } = await import("./solicitudes")
const { parseEstadosParam } = await import("@/lib/adquisiciones/solicitudes-filter")

const USER = "user-exp-1"
const WS = "ws-exp-1"

const session = {
  expires: "2099-01-01T00:00:00.000Z",
  user: {
    id: USER, email: "exp@test.cl", roles: ["administrador"], isGlobal: true,
    worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true,
    permissions: ["requests:view_all"],
  },
} as Session

async function seedRequest(options: {
  code: string
  status: string
  createdAt?: string
  productName?: string
}) {
  const id = nanoid()
  await testDb.insert(schema.purchaseRequests).values({
    id, code: options.code, worksiteId: WS, requesterId: USER,
    requestType: "epp", urgency: "normal", status: options.status,
    createdAt: options.createdAt ?? "2026-08-15T12:00:00.000Z",
    updatedAt: options.createdAt ?? "2026-08-15T12:00:00.000Z",
  })
  await testDb.insert(schema.purchaseRequestItems).values({
    id: nanoid(), requestId: id, productNameFree: options.productName ?? "Casco",
    quantity: 1, unitOfMeasure: "unidad", status: "requested", sortOrder: 0,
  })
  return id
}

const codes = async (filters: Record<string, unknown>) => {
  const report = await solicitudesList(session, filters as never, 1000)
  const codeIndex = report.headers.indexOf("Código")
  return report.rows.map((row) => String(row[codeIndex]))
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values({
    id: USER, name: "Export", email: "exp@test.cl", hashedPassword: "x", isActive: true,
  })
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena Export", code: "EXP", isActive: true })
})

beforeEach(async () => {
  await testDb.delete(schema.purchaseRequestItems)
  await testDb.delete(schema.purchaseRequests)
})

describe("parseEstadosParam", () => {
  it("convierte la lista de la barra de pestañas en un arreglo", () => {
    expect(parseEstadosParam("submitted,in_review")).toEqual(["submitted", "in_review"])
    expect(parseEstadosParam(" submitted , in_review ")).toEqual(["submitted", "in_review"])
  })

  it("sin filtro no restringe nada", () => {
    expect(parseEstadosParam(null)).toEqual([])
    expect(parseEstadosParam("")).toEqual([])
    expect(parseEstadosParam(",,")).toEqual([])
  })
})

describe("REQ-003 — el Excel reproduce el recorte de la pantalla", () => {
  it("una pestaña que agrupa dos estados exporta ambos, no cero filas", async () => {
    await seedRequest({ code: "SOL-1", status: "submitted" })
    await seedRequest({ code: "SOL-2", status: "in_review" })
    await seedRequest({ code: "SOL-3", status: "approved" })

    // Exactamente lo que el enlace de la pantalla pone en `status`.
    const resultado = await codes({ status: "submitted,in_review" })
    expect(resultado.sort()).toEqual(["SOL-1", "SOL-2"])
  })

  it("un solo estado sigue funcionando", async () => {
    await seedRequest({ code: "SOL-4", status: "approved" })
    await seedRequest({ code: "SOL-5", status: "submitted" })
    expect(await codes({ status: "approved" })).toEqual(["SOL-4"])
  })

  it("sin filtro de estado salen todas", async () => {
    await seedRequest({ code: "SOL-6", status: "approved" })
    await seedRequest({ code: "SOL-7", status: "submitted" })
    expect((await codes({})).sort()).toEqual(["SOL-6", "SOL-7"])
  })

  it("respeta el período que la pantalla estaba mostrando", async () => {
    await seedRequest({ code: "SOL-JUL", status: "approved", createdAt: "2026-07-10T12:00:00.000Z" })
    await seedRequest({ code: "SOL-AGO", status: "approved", createdAt: "2026-08-10T12:00:00.000Z" })

    expect(await codes({ fromDate: "2026-08-01", toDate: "2026-08-31" })).toEqual(["SOL-AGO"])
  })

  it("busca por nombre de producto, no sólo por código", async () => {
    await seedRequest({ code: "SOL-A", status: "approved", productName: "Guantes de nitrilo" })
    await seedRequest({ code: "SOL-B", status: "approved", productName: "Casco" })

    expect(await codes({ q: "nitrilo" })).toEqual(["SOL-A"])
    // Y el código sigue encontrándose.
    expect(await codes({ q: "SOL-B" })).toEqual(["SOL-B"])
  })

  it("combina estado, período y texto como lo hace la pantalla", async () => {
    await seedRequest({ code: "SOL-OK", status: "in_review", createdAt: "2026-08-10T12:00:00.000Z", productName: "Botas" })
    await seedRequest({ code: "SOL-FUERA-ESTADO", status: "approved", createdAt: "2026-08-10T12:00:00.000Z", productName: "Botas" })
    await seedRequest({ code: "SOL-FUERA-FECHA", status: "in_review", createdAt: "2026-07-10T12:00:00.000Z", productName: "Botas" })
    await seedRequest({ code: "SOL-FUERA-TEXTO", status: "in_review", createdAt: "2026-08-10T12:00:00.000Z", productName: "Casco" })

    const resultado = await codes({
      status: "submitted,in_review", fromDate: "2026-08-01", toDate: "2026-08-31", q: "Botas",
    })
    expect(resultado).toEqual(["SOL-OK"])
  })
})
