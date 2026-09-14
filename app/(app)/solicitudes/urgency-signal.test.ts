/**
 * REQ-004 (auditoría 2026-09-14) — "La señal de urgencia crítica cuenta un
 * conjunto distinto y su CTA no aplica el filtro".
 *
 * Dos defectos en la misma señal:
 *  a) `?urgencia=critical` se parseaba pero NUNCA entraba al predicado de la
 *     lista: pulsar la señal devolvía la lista completa.
 *  b) el href era la cadena fija `/solicitudes?urgencia=critical`, así que el
 *     salto tiraba faena, período, búsqueda y pestaña; y una vez puesto el
 *     filtro no había forma de quitarlo.
 *
 * Este archivo cubre (b) sobre el helper puro y (a) sobre la página, mirando
 * el SQL que efectivamente llega a la consulta.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"

import { buildUrgencySignal } from "./urgency-signal"

describe("buildUrgencySignal (REQ-004 · destino de la señal)", () => {
  it("conserva el contexto en pantalla en vez de saltar a un href fijo", () => {
    const { href, active } = buildUrgencySignal({
      q: "filtro",
      faena: "ws-1",
      estado: "submitted,in_review",
      desde: "2026-09-01",
      hasta: "2026-09-30",
      page: "3",
    })

    const params = new URLSearchParams(href.split("?")[1])
    expect(params.get("q")).toBe("filtro")
    expect(params.get("faena")).toBe("ws-1")
    expect(params.get("estado")).toBe("submitted,in_review")
    expect(params.get("desde")).toBe("2026-09-01")
    expect(params.get("hasta")).toBe("2026-09-30")
    expect(params.get("urgencia")).toBe("critical")
    // La página se descarta: el conjunto cambia y el número deja de significar
    // lo mismo, igual que hace ServerListFilters al aplicar cualquier filtro.
    expect(params.get("page")).toBeNull()
    expect(active).toBe(false)
  })

  it("con el filtro ya puesto la señal es la salida, no un enlace a sí misma", () => {
    const { href, active } = buildUrgencySignal({ urgencia: "critical", faena: "ws-1" })
    expect(active).toBe(true)
    expect(href).toBe("/solicitudes?faena=ws-1")
  })

  it("otra urgencia en la URL no marca activa la señal de crítica", () => {
    expect(buildUrgencySignal({ urgencia: "high" }).active).toBe(false)
    expect(buildUrgencySignal({}).href).toBe("/solicitudes?urgencia=critical")
  })
})

// ── La página: que el parámetro llegue al predicado ───────────────────────────

const capturedWheres = vi.hoisted(() => [] as unknown[])

vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT") }) }))
vi.mock("@/lib/auth/can", () => ({
  requireAuth: () => Promise.resolve({ user: { id: "u-1" } }),
  can: () => true,
  canAccessWorksite: () => true,
}))
// El eje de faena es REQ-001 y tiene sus propias pruebas; acá interesa la urgencia.
vi.mock("@/lib/auth/scope", () => ({ worksiteScopeSql: () => undefined }))
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => {
        const chain: Record<string, unknown> = {
          where: vi.fn((condition: unknown) => { capturedWheres.push(condition); return chain }),
          orderBy: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          offset: vi.fn(() => chain),
          groupBy: vi.fn(() => chain),
        }
        chain.then = (fn: (rows: unknown[]) => unknown) => Promise.resolve().then(() => fn([]))
        return chain
      }),
    })),
  },
}))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("@/components/ui/page-container", () => ({ PageContainer: () => null }))
vi.mock("@/components/ui/server-pagination", () => ({ ServerPagination: () => null }))
vi.mock("./request-list", () => ({ RequestList: () => null }))
vi.mock("./solicitudes-actions", () => ({ SolicitudesActions: () => null }))

/**
 * La página es un Server Component: devuelve el árbol de elementos sin
 * renderizarlo. `HeaderSignals` viaja dentro de `headerActions`, así que las
 * señales se leen recorriendo ese árbol.
 */
function findSignals(node: unknown): Array<{ href?: string; active?: boolean }> | null {
  if (!node || typeof node !== "object") return null
  const element = node as { props?: Record<string, unknown> }
  const props = element.props
  if (!props) return Array.isArray(node) ? node.reduce<ReturnType<typeof findSignals>>((found, child) => found ?? findSignals(child), null) : null
  if (Array.isArray((props as { signals?: unknown }).signals)) {
    return (props as { signals: Array<{ href?: string; active?: boolean }> }).signals
  }
  for (const value of Object.values(props)) {
    const found = Array.isArray(value)
      ? value.reduce<ReturnType<typeof findSignals>>((acc, child) => acc ?? findSignals(child), null)
      : findSignals(value)
    if (found) return found
  }
  return null
}

const dialect = new PgDialect()
const toSql = (condition: unknown) =>
  condition ? dialect.sqlToQuery(condition as SQL) : { sql: "", params: [] as unknown[] }

describe("página de Solicitudes (REQ-004 · el filtro llega al predicado)", () => {
  beforeEach(() => {
    capturedWheres.length = 0
  })

  it("aplica `?urgencia=critical` a la lista y a las pestañas de etapa", async () => {
    const { default: SolicitudesPage } = await import("./page")
    await SolicitudesPage({ searchParams: Promise.resolve({ urgencia: "critical" }) })

    const queries = capturedWheres.map(toSql)
    // Antes de la corrección ninguna consulta mencionaba `urgency`: el parámetro
    // se parseaba y se tiraba.
    const withUrgency = queries.filter((q) => /"urgency"/.test(q.sql) && q.params.includes("critical"))
    // Total de la lista, conteo por etapa y página de resultados.
    expect(withUrgency.length).toBeGreaterThanOrEqual(3)
  })

  it("no filtra por urgencia cuando el parámetro no viene", async () => {
    const { default: SolicitudesPage } = await import("./page")
    await SolicitudesPage({ searchParams: Promise.resolve({}) })

    const listQueries = capturedWheres.map(toSql).filter((q) => /"urgency" =/.test(q.sql))
    expect(listQueries).toEqual([])
  })

  it("cuenta la señal sobre el contexto en pantalla, no sólo sobre el filtro de propietario", async () => {
    const { default: SolicitudesPage } = await import("./page")
    const tree = await SolicitudesPage({ searchParams: Promise.resolve({ q: "bomba", urgencia: "critical" }) })

    /*
     * El conteo de críticas es la única consulta que lleva el contexto (la
     * búsqueda) SIN el filtro de urgencia: la lista y las pestañas sí lo
     * llevan. Antes de la corrección esa consulta iba con `filterConditions`
     * a secas y no mencionaba la búsqueda en absoluto.
     */
    const queries = capturedWheres.map(toSql)
    const contextOnly = queries.filter((q) => q.params.includes("%bomba%") && !/"urgency" =/.test(q.sql))
    expect(contextOnly).toHaveLength(1)
    // Y el resto sí acota por urgencia: la lista no mezcla poblaciones.
    expect(queries.filter((q) => /"urgency" =/.test(q.sql)).length).toBeGreaterThanOrEqual(3)

    // Y el href de la señal conserva la búsqueda activa; antes era fijo.
    const signals = findSignals(tree)!
    expect(signals[0]!.active).toBe(true)
    expect(signals[0]!.href).toBe("/solicitudes?q=bomba")
  })
})
