/**
 * Resolver de folios de Mantención (`/mantencion/ir?folio=…`).
 *
 * La base se simula: el doble recibe la consulta que arma el resolvedor, lee de su SQL la tabla, la columna y el
 * folio buscado (con el dialecto real de drizzle) y contesta con las filas del folio. Lo que se prueba con las
 * reglas REALES es el alcance: `canSeeWorkOrder`, `canSeeRecord` y `canSeeNote` (las mismas que usan los detalles).
 * Un folio fuera del alcance tiene que dar lo mismo que un folio que no existe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MantViewer } from "@/lib/services/mantencion/access"

type Row = Record<string, unknown> & { folio: string }

/** Filas de cada tabla; las pruebas las reemplazan. Cada una trae el folio (o código) por el que se la busca. */
const tables = vi.hoisted(() => ({ ot: [] as Row[], registro: [] as Row[], nota: [] as Row[] }))
/** Una entrada por consulta: la tabla, la columna del WHERE y el valor buscado. */
const queries = vi.hoisted(() => [] as Array<{ table: string; where: string; value: unknown }>)

vi.mock("@/db", async () => {
  const schema = await import("@/db/schema")
  const { PgDialect: Dialect } = await import("drizzle-orm/pg-core")
  const dialect = new Dialect()
  const keyOf = (table: unknown) => table === schema.mantWorkOrders ? "ot" : table === schema.mantRecords ? "registro" : table === schema.mantPartsNotes ? "nota" : "otra"
  return {
    db: {
      select: () => {
        let table = "otra"
        const chain = {
          from: (source: unknown) => { table = keyOf(source); return chain },
          innerJoin: () => chain,
          leftJoin: () => chain,
          where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
            const { sql, params } = dialect.sqlToQuery(condition)
            queries.push({ table, where: sql, value: params[0] })
            return chain
          },
          limit: async () => {
            const query = queries.at(-1)!
            return (tables[table as keyof typeof tables] ?? []).filter((row) => row.folio === query.value).slice(0, 1)
          },
        }
        return chain
      },
    },
  }
})

import { FOLIO_KINDS, FOLIO_VIEW_PERMISSIONS, canOpenKind, folioKindsFor, listFor, normalizeFolio, resolveFolio } from "./resolve-folio"

const viewer = (permissions: string[], overrides: Partial<MantViewer> = {}): MantViewer => ({
  userId: "u-1", email: null, permissions, worksiteIds: ["ws-1"], isGlobal: false, ...overrides,
})

const ot = (overrides: Record<string, unknown> = {}): Row => ({
  folio: "OT-BIO-0001", id: "ot-1", status: "solicitada", worksiteId: "ws-1", requestedByUserId: "u-9", assignedToUserId: null, vehicleWorksiteId: "ws-1", ...overrides,
})
const registro = (overrides: Record<string, unknown> = {}): Row => ({
  folio: "MP-BIO-0001", id: "reg-1", worksiteId: "ws-1", registeredBy: "u-9", executorUserId: null, vehicleWorksiteId: "ws-1", ...overrides,
})
const nota = (overrides: Record<string, unknown> = {}): Row => ({
  folio: "NP-2026-0001", id: "np-1", worksiteId: "ws-1", vehicleWorksiteId: "ws-1", ...overrides,
})

beforeEach(() => {
  tables.ot = [ot()]
  tables.registro = [registro()]
  tables.nota = [nota()]
})
afterEach(() => {
  queries.length = 0
  vi.clearAllMocks()
})

describe("normalizeFolio", () => {
  it("quita los espacios de los lados y pasa a mayúsculas", () => {
    expect(normalizeFolio("  ot-bio-0001 ")).toBe("OT-BIO-0001")
    expect(normalizeFolio("Mp-stf-0147\n")).toBe("MP-STF-0147")
  })

  it("acepta el valor crudo de searchParams: un arreglo toma el primero; ausente, vacío", () => {
    expect(normalizeFolio(["np-2026-0001", "otro"])).toBe("NP-2026-0001")
    expect(normalizeFolio(undefined)).toBe("")
    expect(normalizeFolio(null)).toBe("")
    expect(normalizeFolio([])).toBe("")
    expect(normalizeFolio("   ")).toBe("")
  })

  it("acota el largo: un valor desmedido no llega a la consulta entero", () => {
    expect(normalizeFolio("x".repeat(500))).toHaveLength(64)
  })
})

describe("folioKindsFor", () => {
  it("el prefijo dice de qué tipo es", () => {
    expect(folioKindsFor("OT-BIO-0001")).toEqual(["ot"])
    expect(folioKindsFor("MP-BIO-0001")).toEqual(["registro"])
    expect(folioKindsFor("MC-BIO-0001")).toEqual(["registro"])
    expect(folioKindsFor("NP-2026-0001")).toEqual(["nota"])
  })

  it("sin un prefijo conocido se prueban los tres; sin folio, ninguno", () => {
    expect(folioKindsFor("BIO-0001")).toEqual(["ot", "registro", "nota"])
    expect(folioKindsFor("")).toEqual([])
  })
})

describe("resolveFolio · orden de trabajo", () => {
  it("lleva a la ficha de la OT de su faena, buscando por mant_work_orders.folio", async () => {
    const found = await resolveFolio(viewer(["mant:ot:view_worksite"]), "OT-BIO-0001")
    expect(found).toEqual({ kind: "ot", href: "/mantencion/ot/ot-1" })
    expect(queries).toEqual([{ table: "ot", where: expect.stringContaining('"mant_work_orders"."folio" = $1'), value: "OT-BIO-0001" }])
  })

  it("una OT de otra faena da lo mismo que una que no existe", async () => {
    tables.ot = [ot({ worksiteId: "ws-2", vehicleWorksiteId: "ws-2" })]
    const ajena = await resolveFolio(viewer(["mant:ot:view_worksite"]), "OT-BIO-0001")
    const inexistente = await resolveFolio(viewer(["mant:ot:view_worksite"]), "OT-BIO-9999")
    expect(ajena).toBeNull()
    expect(inexistente).toBeNull()
    expect(ajena).toEqual(inexistente)
  })

  it("la OT sigue al equipo: una de otra faena cuyo equipo está hoy en la de la persona se encuentra", async () => {
    tables.ot = [ot({ worksiteId: "ws-2", vehicleWorksiteId: "ws-1" })]
    expect(await resolveFolio(viewer(["mant:ot:view_worksite"]), "OT-BIO-0001")).toEqual({ kind: "ot", href: "/mantencion/ot/ot-1" })
  })

  it("lo propio se ve aunque sea de otra faena: la que creó y la que tiene asignada", async () => {
    tables.ot = [ot({ worksiteId: "ws-2", vehicleWorksiteId: "ws-2", assignedToUserId: "u-1" })]
    expect(await resolveFolio(viewer(["mant:ot:execute"], { worksiteIds: [] }), "OT-BIO-0001")).toEqual({ kind: "ot", href: "/mantencion/ot/ot-1" })
    tables.ot = [ot({ worksiteId: "ws-2", vehicleWorksiteId: "ws-2", assignedToUserId: "u-7" })]
    expect(await resolveFolio(viewer(["mant:ot:execute"], { worksiteIds: [] }), "OT-BIO-0001")).toBeNull()
  })

  it("view_all y un rol global con view_worksite ven las de todas las faenas", async () => {
    tables.ot = [ot({ worksiteId: "ws-2", vehicleWorksiteId: "ws-2" })]
    expect(await resolveFolio(viewer(["mant:ot:view_all"]), "OT-BIO-0001")).not.toBeNull()
    expect(await resolveFolio(viewer(["mant:ot:view_worksite"], { isGlobal: true, worksiteIds: [] }), "OT-BIO-0001")).not.toBeNull()
  })
})

describe("resolveFolio · registro firmado", () => {
  it("MP- y MC- llevan a la ficha del registro, buscando por mant_records.folio", async () => {
    tables.registro = [registro(), registro({ folio: "MC-BIO-0002", id: "reg-2" })]
    expect(await resolveFolio(viewer(["mant:records:view_worksite"]), "MP-BIO-0001")).toEqual({ kind: "registro", href: "/mantencion/registros/reg-1" })
    expect(await resolveFolio(viewer(["mant:records:view_worksite"]), "MC-BIO-0002")).toEqual({ kind: "registro", href: "/mantencion/registros/reg-2" })
    expect(queries.map((query) => [query.table, query.where.includes('"mant_records"."folio" = $1')])).toEqual([["registro", true], ["registro", true]])
  })

  it("un registro de otra faena (y de un equipo que no está en la suya) no se encuentra", async () => {
    tables.registro = [registro({ worksiteId: "ws-2", vehicleWorksiteId: "ws-2" })]
    expect(await resolveFolio(viewer(["mant:records:view_worksite"]), "MP-BIO-0001")).toBeNull()
  })

  it("la hoja de vida sigue al equipo: el registro de otra faena de un equipo que hoy está en la suya se encuentra", async () => {
    tables.registro = [registro({ worksiteId: "ws-2", vehicleWorksiteId: "ws-1" })]
    expect(await resolveFolio(viewer(["mant:records:view_worksite"]), "MP-BIO-0001")).toEqual({ kind: "registro", href: "/mantencion/registros/reg-1" })
  })

  it("quien sólo ve lo propio encuentra sus registros y no los de otros", async () => {
    const soloPropio = viewer(["mant:records:view_own"], { worksiteIds: [] })
    tables.registro = [registro({ registeredBy: "u-1" })]
    expect(await resolveFolio(soloPropio, "MP-BIO-0001")).not.toBeNull()
    tables.registro = [registro({ registeredBy: "u-9", executorUserId: "u-8" })]
    expect(await resolveFolio(soloPropio, "MP-BIO-0001")).toBeNull()
  })
})

describe("resolveFolio · nota de pedido", () => {
  it("lleva a la ficha de la nota, buscando por mant_parts_notes.code", async () => {
    expect(await resolveFolio(viewer(["mant:np:view_worksite"]), "NP-2026-0001")).toEqual({ kind: "nota", href: "/mantencion/notas-pedido/np-1" })
    expect(queries).toEqual([{ table: "nota", where: expect.stringContaining('"mant_parts_notes"."code" = $1'), value: "NP-2026-0001" }])
  })

  it("una nota de otra faena no se encuentra; con mant:np:manage y un rol global, sí", async () => {
    tables.nota = [nota({ worksiteId: "ws-2", vehicleWorksiteId: "ws-2" })]
    expect(await resolveFolio(viewer(["mant:np:view_worksite"]), "NP-2026-0001")).toBeNull()
    expect(await resolveFolio(viewer(["mant:np:manage"], { isGlobal: true, worksiteIds: [] }), "NP-2026-0001")).not.toBeNull()
  })
})

describe("resolveFolio · permisos y prefijos", () => {
  it("sin el permiso de ese tipo ni se consulta: el folio de una OT no se busca con permisos de registros", async () => {
    expect(await resolveFolio(viewer(["mant:records:view_all"]), "OT-BIO-0001")).toBeNull()
    expect(await resolveFolio(viewer(["mant:ot:view_all"]), "MP-BIO-0001")).toBeNull()
    expect(await resolveFolio(viewer(["mant:ot:view_all"]), "NP-2026-0001")).toBeNull()
    expect(await resolveFolio(viewer([]), "OT-BIO-0001")).toBeNull()
    expect(queries).toEqual([])
  })

  it("el prefijo acota las consultas: un OT- sólo toca la tabla de OT", async () => {
    await resolveFolio(viewer(["mant:ot:view_all", "mant:records:view_all", "mant:np:manage"]), "OT-BIO-0001")
    expect(queries.map((query) => query.table)).toEqual(["ot"])
  })

  it("sin un prefijo conocido prueba los tipos que la persona puede abrir, en orden, y se queda con el primero que encuentra", async () => {
    tables.ot = []
    tables.registro = [registro({ folio: "BIO-0001" })]
    const found = await resolveFolio(viewer(["mant:ot:view_all", "mant:records:view_all", "mant:np:manage"]), "BIO-0001")
    expect(found).toEqual({ kind: "registro", href: "/mantencion/registros/reg-1" })
    expect(queries.map((query) => query.table)).toEqual(["ot", "registro"])
  })

  it("sin folio no hay nada que buscar", async () => {
    expect(await resolveFolio(viewer(["mant:ot:view_all"]), "")).toBeNull()
    expect(queries).toEqual([])
  })

  it("el id va codificado en el destino", async () => {
    tables.ot = [ot({ id: "a/b c" })]
    expect(await resolveFolio(viewer(["mant:ot:view_all"]), "OT-BIO-0001")).toEqual({ kind: "ot", href: "/mantencion/ot/a%2Fb%20c" })
  })
})

describe("permisos del resolvedor", () => {
  it("cada tipo pide los mismos permisos que la página de su ficha", () => {
    expect(FOLIO_KINDS.ot.permissions).toEqual(["mant:ot:view_worksite", "mant:ot:view_all", "mant:ot:execute"])
    expect(FOLIO_KINDS.registro.permissions).toEqual(["mant:records:view_own", "mant:records:view_worksite", "mant:records:view_all"])
    expect(FOLIO_KINDS.nota.permissions).toEqual(["mant:np:view_worksite", "mant:np:manage"])
    expect(FOLIO_VIEW_PERMISSIONS).toEqual([...FOLIO_KINDS.ot.permissions, ...FOLIO_KINDS.registro.permissions, ...FOLIO_KINDS.nota.permissions])
  })

  it("canOpenKind: basta cualquiera de los permisos del tipo", () => {
    expect(canOpenKind(viewer(["mant:ot:execute"]), "ot")).toBe(true)
    expect(canOpenKind(viewer(["mant:ot:execute"]), "registro")).toBe(false)
    expect(canOpenKind(viewer(["mant:np:manage"]), "nota")).toBe(true)
  })
})

describe("listFor · a qué lista llevar cuando no se encuentra", () => {
  it("la que sugiere el prefijo, si la persona puede abrirla", () => {
    const todo = viewer(["mant:ot:view_all", "mant:records:view_all", "mant:np:manage"])
    expect(listFor(todo, "OT-BIO-0001")).toEqual({ href: "/mantencion/ot", label: "Órdenes de trabajo" })
    expect(listFor(todo, "MP-BIO-0001")).toEqual({ href: "/mantencion/registros", label: "Registros firmados" })
    expect(listFor(todo, "MC-BIO-0001")).toEqual({ href: "/mantencion/registros", label: "Registros firmados" })
    expect(listFor(todo, "NP-2026-0001")).toEqual({ href: "/mantencion/notas-pedido", label: "Notas de pedido" })
  })

  it("si no puede abrir esa, la primera de Mantención que sí puede; sin prefijo, también", () => {
    expect(listFor(viewer(["mant:records:view_own"]), "OT-BIO-0001")).toEqual({ href: "/mantencion/registros", label: "Registros firmados" })
    expect(listFor(viewer(["mant:np:view_worksite"]), "")).toEqual({ href: "/mantencion/notas-pedido", label: "Notas de pedido" })
    expect(listFor(viewer(["mant:ot:execute", "mant:np:view_worksite"]), "XYZ-1")).toEqual({ href: "/mantencion/ot", label: "Órdenes de trabajo" })
  })

  it("sin ningún permiso de vista no hay lista", () => {
    expect(listFor(viewer([]), "OT-BIO-0001")).toBeNull()
  })
})
