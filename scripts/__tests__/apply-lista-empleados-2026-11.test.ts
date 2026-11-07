import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import ExcelJS from "exceljs"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { computeRutDv } from "@/lib/rut"
import * as schema from "@/db/schema"

// El script importa `@/db` estáticamente: se importa dinámicamente dentro de
// cada test, una vez asignado `testGlobal.__db`.

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const dotacion = vi.hoisted(() => ({ entered: vi.fn(async () => ({})), organization: vi.fn(async () => ({})) }))
vi.mock("@/lib/services/pdtp-adapters/worker-lifecycle-connector", () => ({ onWorkerEnteredDotacion: dotacion.entered }))
vi.mock("@/lib/services/pdtp-adapters/preventive-organization-connector", () => ({ evaluateWorksitePreventiveOrganization: dotacion.organization }))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const ACTOR = "jefatura@chome.test"
const UNCLASSIFIED = "worker-position-unclassified"

/* ── Nómina sintética ─────────────────────────────────────────────────────── */
// Todo inventado: RUT (con dígito verificador válido) y nombres no
// corresponden a nadie. La nómina real no entra al repositorio.

const rut = (body: string) => `${body}-${computeRutDv(body)}`
const R = {
  jefe: rut("90000001"), keep: rut("90000002"), fix: rut("90000003"), move: rut("90000004"),
  back: rut("90000005"), hand: rut("90000006"), gone: rut("90000007"), fresh: rut("90000008"),
  boss: rut("90000009"),
}

const HEADERS = ["RUT", "Nombre", "Apellido Paterno", "Apellido Materno", "Fecha nacimiento", "Sexo", "Profesión", "Cargo",
  "Nombre Centro Costo 1", "Nombre Centro Costo 2", "Sucursal", "Jefe", "Rut Jefe"]
type Row = [rut: string, nombre: string, paterno: string, materno: string, sexo: string, cargo: string | null, area: string, jefe: string | null, jefeRut: string | null]

const ROWS: Row[] = [
  [R.jefe, "Juana", "Jefa", "Prueba", "F", "ADMINISTRADOR DE CONTRATO", "BIODIVERSA", "GERENTE PRUEBA", R.boss],
  // Chome tiene el segundo nombre: se conserva.
  [R.keep, "Uno", "Prueba", "Soto", "M", "OPERADOR", "BIODIVERSA", "JUANA JEFA", R.jefe],
  // Ortografía distinta en nombre y apellidos en otro orden: manda la nómina.
  [R.fix, "Cristian", "Mendoza", "Salgado", "M", "chofer", "BIODIVERSA", "JUANA JEFA", R.jefe],
  [R.move, "Tres", "Prueba", "Soto", "M", "CONDUCTOR", "MASISA TABLEROS", "JUANA JEFA", R.jefe],
  [R.back, "Cuatro", "Prueba", "Soto", "F", "SOLDADOR", "BIODIVERSA", "JUANA JEFA", R.jefe],
  [R.hand, "Cinco", "Prueba", "Soto", "M", "SUPERVISOR DE FAENA", "BIODIVERSA", "JUANA JEFA", R.jefe],
  [R.fresh, "Ana María", "de la Prueba", "Muestra", "F", "GERENTE GENERAL", "ADMINISTRACION", null, null],
  [rut("91000001"), "Sin", "Faena", "Prueba", "M", "OPERADOR", "OTRA COSA", null, null],
]

async function buildNomina(rows: Row[] = ROWS): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Empleados")
  sheet.addRow(HEADERS)
  for (const [r, nombre, paterno, materno, sexo, cargo, area, jefe, jefeRut] of rows) {
    sheet.addRow([r, nombre, paterno, materno, new Date("1990-01-01T00:00:00Z"), sexo, null, cargo, "GERENCIA", area, area, jefe, jefeRut])
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

const script = () => import("../apply-lista-empleados-2026-11")

async function run(apply: boolean, buffer?: Buffer) {
  const { applyListaEmpleados202611 } = await script()
  return applyListaEmpleados202611({ actorEmail: ACTOR, apply, buffer: buffer ?? await buildNomina() })
}

async function one<T>(rows: PromiseLike<T[]>): Promise<T> {
  const [row] = await rows
  if (!row) throw new Error("fila esperada")
  return row
}
const byRut = (value: string) => one(inMemoryDb.select().from(schema.workers).where(eq(schema.workers.rut, value)))
const positionNamed = (name: string) => one(inMemoryDb.select().from(schema.workerPositions).where(eq(schema.workerPositions.name, name)))

/** Catálogo que deja la planilla de vencimientos (paso 5), sin los cargos de gerencia. */
const CATALOG = [
  "Conductor de camión", "Operador de maquinaria", "Prevencionista de riesgos", "Soldador", "Administrador de contrato",
  "Supervisor", "Auxiliar", "Mecánico", "Ayudante mecánico", "Jefe de terreno",
]

beforeEach(async () => {
  dotacion.entered.mockClear()
  dotacion.organization.mockClear()
  await pg.exec("TRUNCATE audit_log, worker_position_history, worker_position_aliases, worker_position_capabilities, workers, worksites, users CASCADE")
  await pg.exec("DELETE FROM worker_positions WHERE is_system = false")

  await inMemoryDb.insert(schema.users).values({ id: "u-actor", name: "Jefatura", email: ACTOR, hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "w-bio", name: "Biodiversa", code: "BIODIVERSA", isActive: true },
    { id: "w-mas", name: "Masisa", code: "MASISA", isActive: true },
    { id: "w-ofi", name: "Oficina Central", code: "OFICINA-CENTRAL", isActive: true },
  ])
  const { normalizeWorkerPositionKey } = await import("@/lib/services/worker-positions/normalization")
  await inMemoryDb.insert(schema.workerPositions).values(CATALOG.map((name, index) => ({
    id: `pos-${index}`, code: `TEST-${index}`, name, normalizedKey: normalizeWorkerPositionKey(name), needsReview: false,
  })))
  const base = { isActive: true, positionId: UNCLASSIFIED, position: "Sin clasificar", worksiteId: "w-bio" }
  await inMemoryDb.insert(schema.workers).values([
    { id: "wk-jefe", rut: R.jefe, firstName: "Juana Inés", lastName: "Jefa Prueba", ...base },
    { id: "wk-keep", rut: R.keep, firstName: "Uno Segundo", lastName: "Prueba Soto", ...base },
    { id: "wk-fix", rut: R.fix, firstName: "Christian", lastName: "Salgado Mendoza", ...base },
    { id: "wk-move", rut: R.move, firstName: "Tres", lastName: "Prueba Soto", ...base },
    { id: "wk-back", rut: R.back, firstName: "Cuatro", lastName: "Prueba Soto", ...base, isActive: false },
    { id: "wk-hand", rut: R.hand, firstName: "Cinco", lastName: "Prueba Soto", ...base, positionId: "pos-9", position: "Jefe de terreno" },
    { id: "wk-gone", rut: R.gone, firstName: "Seis", lastName: "Prueba Soto", ...base },
    { id: "wk-old", rut: rut("90000010"), firstName: "Siete", lastName: "Prueba Soto", ...base, isActive: false },
  ])
})

describe("reconcileName", () => {
  it("conserva el segundo nombre de Chome y no cuenta tildes ni mayúsculas como diferencia", async () => {
    const { reconcileName } = await script()
    expect(reconcileName({ firstName: "Verónica del Pilar", lastName: "Puentes Puentes" }, { firstName: "VERONICA", lastName: "Puentes Puentes" })).toBeNull()
    expect(reconcileName({ firstName: "David", lastName: "Huaiquil Muñoz" }, { firstName: "David", lastName: "Huaiquil Munoz" })).toBeNull()
  })

  it("toma la ortografía de la nómina cuando las palabras difieren", async () => {
    const { reconcileName } = await script()
    expect(reconcileName({ firstName: "Luis Alejando", lastName: "Montanares Sánchez" }, { firstName: "Luis Alejandro", lastName: "Montanares Sánchez" }))
      .toEqual({ firstName: "Luis Alejandro", lastName: "Montanares Sánchez" })
    expect(reconcileName({ firstName: "Jesús", lastName: "Salgado Mendoza" }, { firstName: "Jesús", lastName: "MENDOZA SALGADO" }))
      .toEqual({ firstName: "Jesús", lastName: "Mendoza Salgado" })
  })
})

describe("nómina de remuneraciones 2026-11", () => {
  it("en dry-run informa el plan y no escribe nada", async () => {
    const report = await run(false)

    expect(report.outcomes.filter((o) => o.result === "aplicado")).toEqual([])
    expect(report.outcomes.find((o) => o.item === "Gerente general")).toMatchObject({ result: "dry-run" })
    expect(report.outcomes.find((o) => o.action === "alta en «Oficina Central»")).toMatchObject({ item: "A.M.D.L.P.M. · fila 8", result: "dry-run" })
    expect(report.outcomes.find((o) => o.action === "baja")).toMatchObject({ item: "S.P.S. · Biodiversa", result: "dry-run" })
    expect(report.review.filter((n) => n.kind === "catalogo_faltante")).toEqual([])

    expect(await inMemoryDb.select().from(schema.auditLog)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.workers)).toHaveLength(8)
    expect((await byRut(R.gone)).isActive).toBe(true)
    expect(dotacion.entered).not.toHaveBeenCalled()
  }, 60_000)

  it("pone al día la dotación: altas, bajas, traslados, reactivaciones, sexo, jefe, nombre y cargo", async () => {
    const report = await run(true)

    // Alta, con su cargo nuevo, sexo y sin jefe (la nómina no lo trae).
    const fresh = await byRut(R.fresh)
    expect(fresh).toMatchObject({ firstName: "Ana María", lastName: "De la Prueba Muestra", sex: "female", worksiteId: "w-ofi", isActive: true, supervisor: null })
    expect(fresh.positionId).toBe((await positionNamed("Gerente general")).id)

    // Conserva el segundo nombre; clasifica a quien estaba sin clasificar; el jefe sale de la ficha del jefe.
    const keep = await byRut(R.keep)
    expect(keep).toMatchObject({ firstName: "Uno Segundo", lastName: "Prueba Soto", sex: "male", supervisor: "Juana Inés Jefa Prueba" })
    expect(keep.positionId).toBe((await positionNamed("Operador de maquinaria")).id)

    // Corrige la ortografía con la nómina; «chofer» es «Conductor de camión».
    const fix = await byRut(R.fix)
    expect(fix).toMatchObject({ firstName: "Cristian", lastName: "Mendoza Salgado" })
    expect(fix.positionId).toBe((await positionNamed("Conductor de camión")).id)

    expect((await byRut(R.move)).worksiteId).toBe("w-mas")
    expect((await byRut(R.back)).isActive).toBe(true)
    expect((await byRut(R.gone)).isActive).toBe(false)
    // Un inactivo que tampoco está en la nómina sigue igual.
    expect((await byRut(rut("90000010"))).isActive).toBe(false)

    // Un cargo ya puesto no se pisa: se informa.
    expect((await byRut(R.hand)).position).toBe("Jefe de terreno")
    expect(report.review.find((n) => n.kind === "cargo_distinto")).toMatchObject({ item: "C.P.S. · fila 7" })
    expect(report.review.find((n) => n.kind === "fila_omitida")?.detail).toContain("OTRA COSA")

    // Eventos de dotación: alta, traslado y reactivación, nunca la baja.
    const kinds = (dotacion.entered.mock.calls[0] as unknown as [Array<{ kind: string }>])[0].map((event) => event.kind).sort()
    expect(kinds).toEqual(["alta", "reactivacion", "traslado"])

    // Bitácora: el sexo se registra como hecho, nunca como valor.
    const audits = await inMemoryDb.select().from(schema.auditLog)
    expect(audits.length).toBeGreaterThan(0)
    expect(audits.every((audit) => !String(audit.newState ?? "").includes("female") && !String(audit.newState ?? "").includes("\"male\""))).toBe(true)
    expect(await inMemoryDb.select().from(schema.workerPositionHistory).where(eq(schema.workerPositionHistory.workerId, "wk-keep"))).toHaveLength(1)
  }, 60_000)

  it("una segunda corrida no escribe nada", async () => {
    await run(true)
    const audits = (await inMemoryDb.select().from(schema.auditLog)).length
    const report = await run(true)
    expect(report.outcomes.filter((o) => o.result === "aplicado")).toEqual([])
    expect(await inMemoryDb.select().from(schema.auditLog)).toHaveLength(audits)
  }, 60_000)

  it("el informe no lleva RUT ni nombres", async () => {
    const report = await run(false)
    const text = JSON.stringify(report)
    for (const value of Object.values(R)) expect(text).not.toContain(value)
    for (const name of ["Juana", "Cristian", "Christian", "Mendoza", "Ana María", "Seis"]) expect(text).not.toContain(name)
  }, 60_000)

  it("sin el catálogo de la planilla de vencimientos, el dry-run lo dice y el apply se niega", async () => {
    await pg.exec("DELETE FROM worker_positions WHERE name = 'Operador de maquinaria'")
    const report = await run(false)
    expect(report.review.filter((n) => n.kind === "catalogo_faltante").map((n) => n.item)).toEqual(["Operador de maquinaria"])
    await expect(run(true)).rejects.toThrow(/apply-vencimientos-planilla-2026-11/)
    expect(await inMemoryDb.select().from(schema.auditLog)).toHaveLength(0)
  }, 60_000)

  it("exige un responsable activo", async () => {
    const { applyListaEmpleados202611 } = await script()
    await expect(applyListaEmpleados202611({ actorEmail: "nadie@chome.test", buffer: await buildNomina() })).rejects.toThrow(/responsable/)
  })
})
