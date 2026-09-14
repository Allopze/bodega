/**
 * INC-001 (auditoría 2026-09-14) — No existía canal de reporte de incidentes
 * para el trabajador ni vía anónima.
 *
 * Reportar exigía `prevention:incidents:report`, concedido sólo a roles
 * internos: quien presenciaba un cuasi accidente dependía de que un mando lo
 * registrara. Tampoco había campo ni flujo para reportar sin dar el nombre.
 *
 * Lo que estas pruebas fijan, además de que el canal existe: que el anonimato
 * es real. La fila no puede guardar identidad cuando el reporte es anónimo —ni
 * aunque el cliente la mande—, y no hay columna de usuario, sesión, IP o user
 * agent por donde volver al denunciante.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const {
  submitPublicIncidentReport,
  listPublicIncidentReports,
  triagePublicIncidentReport,
} = await import("@/lib/services/prevention-incident-reports")

const WS = "ws-inc001"
const WS_OTRA = "ws-inc001-otra"
const TRIADOR = "inc001-triador"

const BASE = {
  worksiteId: WS,
  category: "cuasi_accidente" as const,
  occurredAt: "2026-09-10",
  location: "Acceso norte, pasillo de bombas",
  narrative: "Una carga quedó suspendida sobre el paso de personas y nadie la aseguró.",
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([
    { id: WS, name: "Faena Norte", code: "INC1", isActive: true },
    { id: WS_OTRA, name: "Faena Sur", code: "INC2", isActive: true },
  ])
  await testDb.insert(schema.users).values({
    id: TRIADOR, name: "Prevencionista", email: "prev@inc001.cl", hashedPassword: "x", isActive: true,
  })
})

describe("INC-001 — canal público de reporte", () => {
  it("acepta un reporte sin sesión y devuelve un folio con el que referirse a él", async () => {
    const { code } = await submitPublicIncidentReport({ ...BASE, isAnonymous: true })
    expect(code).toMatch(/^RPT-\d{4}-[A-Z0-9_-]{8}$/)
  })

  it("no guarda identidad en un reporte anónimo aunque el cliente la mande", async () => {
    // El anonimato no depende de que el formulario se porte bien.
    const { code } = await submitPublicIncidentReport({
      ...BASE, isAnonymous: true,
      reporterName: "Juan Pérez", reporterContact: "+56 9 1234 5678",
    })
    const [row] = await testDb.select().from(schema.preventionIncidentPublicReports)
      .where(eq(schema.preventionIncidentPublicReports.code, code))
    expect(row?.isAnonymous).toBe(true)
    expect(row?.reporterName).toBeNull()
    expect(row?.reporterContact).toBeNull()
  })

  it("la base rechaza un reporte anónimo con identidad, aunque el insert no pase por el servicio", async () => {
    const error = await testDb.insert(schema.preventionIncidentPublicReports).values({
      id: "incrpt-directo", code: "RPT-DIRECTO", worksiteId: WS, category: "otro",
      occurredAt: "2026-09-10", location: "x", narrative: "insert directo",
      isAnonymous: true, reporterName: "Juan Pérez",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).then(() => null, (err: unknown) => err)
    expect((error as { cause?: { constraint?: string } })?.cause?.constraint)
      .toBe("prevention_incident_public_report_anonymous_has_no_identity")
  })

  it("la tabla no tiene ninguna columna por donde rastrear al denunciante", async () => {
    // La promesa del canal, comprobada contra el esquema real: ni sesión, ni
    // usuario que reporta, ni IP, ni user agent.
    const columnas = Object.keys(schema.preventionIncidentPublicReports)
    for (const prohibida of ["ip", "ipAddress", "userAgent", "sessionId", "reportedByUserId", "createdByUserId"]) {
      expect(columnas).not.toContain(prohibida)
    }
  })

  it("guarda la identidad sólo cuando la persona decide identificarse", async () => {
    const { code } = await submitPublicIncidentReport({
      ...BASE, isAnonymous: false, reporterName: "Ana Soto", reporterContact: "ana@faena.cl",
    })
    const [row] = await testDb.select().from(schema.preventionIncidentPublicReports)
      .where(eq(schema.preventionIncidentPublicReports.code, code))
    expect(row?.reporterName).toBe("Ana Soto")
  })

  it("exige el nombre a quien elige no ser anónimo", async () => {
    await expect(submitPublicIncidentReport({ ...BASE, isAnonymous: false }))
      .rejects.toThrow()
  })

  it("rechaza una faena inexistente o inactiva", async () => {
    await expect(submitPublicIncidentReport({ ...BASE, worksiteId: "ws-fantasma", isAnonymous: true }))
      .rejects.toThrow(/no existe o está inactiva/i)
  })

  it("el buzón respeta el alcance de faenas de quien lo lee", async () => {
    await submitPublicIncidentReport({ ...BASE, worksiteId: WS_OTRA, isAnonymous: true })
    const soloNorte = await listPublicIncidentReports({ scope: { mode: "some", ids: [WS] } })
    expect(soloNorte.every((row) => row.worksiteId === WS)).toBe(true)
    const todas = await listPublicIncidentReports({ scope: { mode: "all", ids: [] } })
    expect(todas.some((row) => row.worksiteId === WS_OTRA)).toBe(true)
  })

  it("el triage cierra el reporte una sola vez y queda con responsable", async () => {
    const { code } = await submitPublicIncidentReport({ ...BASE, isAnonymous: true })
    const [row] = await testDb.select().from(schema.preventionIncidentPublicReports)
      .where(eq(schema.preventionIncidentPublicReports.code, code))
    const triado = await triagePublicIncidentReport({
      reportId: row!.id, status: "triaged", notes: "Se abrió el incidente formal.", actorUserId: TRIADOR,
    })
    expect(triado.status).toBe("triaged")
    expect(triado.triagedByUserId).toBe(TRIADOR)
    await expect(triagePublicIncidentReport({
      reportId: row!.id, status: "discarded", notes: "Repetido.", actorUserId: TRIADOR,
    })).rejects.toThrow(/ya fue triado/i)
  })
})
