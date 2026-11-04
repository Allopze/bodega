// @vitest-environment jsdom
/**
 * CHART-032 (AUDITORIA_VISUALIZACIONES_CHOME.md): /reportes rehecha con período, comparación, estados en
 * orden de ciclo y pendientes por faena en barras agrupadas. Además conserva la guarda de la Fase 0 · 0.3
 * sobre cinco defectos de cifras, todos verificados con datos de producción:
 *
 *  a) «OC pendientes de recepción» salía tres veces (detalle de «Recepciones», tile propio y total del panel);
 *  b) «Recepciones» contaba también las anuladas (`status = 'voided'`);
 *  c) una faena inactiva aparecía como UUID en los desgloses;
 *  d) las listas de estado iban ordenadas por conteo, no por ciclo de vida;
 *  e) la grilla de tiles tenía `xl:grid-cols-5` para 4 tiles.
 *
 * La página es un Server Component: se la renderiza con una base simulada que registra a qué tabla y con
 * qué predicado se pregunta, y se lee el DOM que recibiría el usuario.
 */
import { render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"

type Row = Record<string, unknown>
type Call = { table: string; keys: string[]; where: unknown }

const state = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; keys: string[]; where: unknown }>,
  data: {} as Record<string, Array<Record<string, unknown>>>,
  scope: { global: true, ids: [] as string[] },
}))

/**
 * Qué devolver para cada consulta, según la tabla y los nombres de columna que pide. Sólo depende del
 * contrato de la página con los datos, no de cómo arma el SQL.
 */
function rowsFor(call: Call): Row[] {
  const has = (key: string) => call.keys.includes(key)
  switch (call.table) {
    case "worksites": return state.data.worksites ?? []
    case "receipts": return state.data.receiptSummary ?? []
    case "purchase_requests": return state.data.requestStatus ?? []
    case "purchase_request_items":
      return has("worksiteId") ? state.data.itemsSinOc ?? [] : state.data.itemStatus ?? []
    case "purchase_orders":
      if (has("totalAmount")) return state.data.orderSummary ?? []
      return has("worksiteId") ? state.data.ocPending ?? [] : state.data.orderStatus ?? []
    default: return []
  }
}

vi.mock("@/db", () => ({
  db: {
    select: (shape: Record<string, unknown>) => ({
      from: (table: Record<symbol, unknown>) => {
        const call: Call = {
          table: String(table[Symbol.for("drizzle:Name")]),
          keys: Object.keys(shape),
          where: undefined,
        }
        state.calls.push(call)
        const chain: Record<string, unknown> = {
          innerJoin: () => chain,
          where: (condition: unknown) => { call.where = condition; return chain },
          groupBy: () => chain,
          orderBy: () => chain,
          then: (resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) =>
            Promise.resolve()
              .then(() => rowsFor(call))
              .then(resolve, reject),
        }
        return chain
      },
    }),
  },
}))
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT") }), useRouter: () => ({ replace: vi.fn() }) }))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: () => Promise.resolve({ user: { id: "u-1" } }),
  isGlobalRole: () => state.scope.global,
  visibleWorksiteIds: () => state.scope.ids,
  can: () => true,
}))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("@/components/ui/page-container", () => ({
  PageContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock("./reports-export-menu", () => ({ ReportsExportMenu: () => null }))
// El control es de cliente (router, contexto del encabezado): acá sólo importa qué le entrega la página.
vi.mock("./reports-scope-controls", () => ({ ReportsScopeControls: () => null }))

import Page from "./page"

const dialect = new PgDialect()
const toSql = (condition: unknown) =>
  condition ? dialect.sqlToQuery(condition as SQL) : { sql: "", params: [] as unknown[] }

async function renderPage(searchParams: Record<string, string> = {}) {
  const tree = await Page({ searchParams: Promise.resolve(searchParams) })
  return render(tree)
}

/** Etiquetas de una lista de estados, en el orden en que se leen. */
function statusLabels(title: string): string[] {
  const list = screen.getByRole("list", { name: title })
  return Array.from(list.querySelectorAll(":scope > li")).map((row) => row.querySelector("span[title]")?.getAttribute("title") ?? "")
}

function metricTiles(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[data-kpi-card]"))
}

const tileLabel = (tile: Element) => tile.querySelector("p")?.textContent ?? ""

const callOf = (table: string, ...keys: string[]) =>
  state.calls.find((call) => call.table === table && keys.every((key) => call.keys.includes(key)))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-03T15:00:00Z"))
  state.calls.length = 0
  state.scope = { global: true, ids: [] }
  state.data = {
    worksites: [
      { id: "ws-activa", name: "Faena Norte", isActive: true },
      { id: "ws-cerrada-3f2a9c1e-77b0-4d52", name: "Faena Cerrada", isActive: false },
    ],
    requestStatus: [
      { status: "closed", total: 9, previous: 6 },
      { status: "submitted", total: 5, previous: 2 },
      { status: "draft", total: 1, previous: 0 },
    ],
    itemStatus: [
      { status: "delivered", total: 8 },
      { status: "requested", total: 3 },
      { status: "approved", total: 2 },
      { status: "pending_purchase", total: 6 },
      { status: "purchased", total: 4 },
      { status: "rejected", total: 1 },
    ],
    orderStatus: [
      { status: "closed", total: 10 },
      { status: "sent", total: 6 },
      { status: "draft", total: 2 },
      { status: "cancelled", total: 1 },
      { status: "partially_received", total: 3 },
    ],
    orderSummary: [{ total: 20, totalAmount: 1_500_000, previous: 10 }],
    receiptSummary: [{ total: 11, previous: 11 }],
    itemsSinOc: [
      { worksiteId: "ws-activa", total: 12 },
      { worksiteId: "ws-cerrada-3f2a9c1e-77b0-4d52", total: 15 },
    ],
    ocPending: [
      { worksiteId: "ws-activa", total: 4 },
      { worksiteId: "ws-cerrada-3f2a9c1e-77b0-4d52", total: 3 },
    ],
  }
})

afterEach(() => { vi.useRealTimers() })

describe("Reportes · recepciones anuladas (0.3b)", () => {
  it("la cifra de «Recepciones» excluye las recepciones anuladas", async () => {
    await renderPage()

    const receiptCalls = state.calls.filter((call) => call.table === "receipts")
    expect(receiptCalls).toHaveLength(1)
    const { sql, params } = toSql(receiptCalls[0]!.where)
    // Antes de la corrección la consulta no tenía predicado alguno (ámbito
    // global): contaba las anuladas como recepciones registradas.
    expect(sql).toMatch(/"receipts"\."status"/)
    expect(sql).toMatch(/<>|not in|!=/i)
    expect(params).toContain("voided")
  })
})

describe("Reportes · una cifra, una representación (0.3a)", () => {
  it("«OC por recibir» no es un tile: su total vive en el gráfico por faena, que es su dueño", async () => {
    const { container } = await renderPage()

    expect(metricTiles(container).map(tileLabel)).toEqual(["Solicitudes creadas", "OC emitidas", "Recepciones registradas"])
    const receptions = metricTiles(container).find((tile) => tileLabel(tile) === "Recepciones registradas")!
    expect(receptions.textContent).not.toMatch(/pendientes de recepci[oó]n|por recibir/i)

    // El 7 (4 + 3 por faena) está una sola vez, dicho en la frase del gráfico.
    const section = screen.getByRole("figure", { name: "Pendiente de abastecimiento por faena" })
    expect(section.textContent).toContain("7 OC esperan recepción")
    expect(screen.getAllByText(/7 OC esperan recepción/)).toHaveLength(1)
  })

  it("no pierde información: conserva el desglose por faena y los enlaces a Compras y Recepción", async () => {
    await renderPage()

    const section = screen.getByRole("figure", { name: "Pendiente de abastecimiento por faena" })
    expect(section.querySelector('a[href="/recepcion"]')).not.toBeNull()
    expect(section.querySelector('a[href="/compras/nueva"]')).not.toBeNull()
    expect(section.textContent).toContain("Faena Norte")
  })

  it("una faena aparece UNA vez en el gráfico, con sus dos cifras juntas, y las más cargadas primero", async () => {
    await renderPage()

    const rows = within(screen.getByRole("list", { name: "Pendiente de abastecimiento por faena" })).getAllByRole("listitem")
    expect(rows.map((row) => row.querySelector("p")!.textContent)).toEqual(["Faena Cerrada (inactiva)", "Faena Norte"])
    expect(rows[1]!.textContent).toContain("12")
    expect(rows[1]!.textContent).toContain("4")
  })
})

describe("Reportes · grilla de tiles (0.3e)", () => {
  it("las columnas de la grilla no superan el número de tiles", async () => {
    const { container } = await renderPage()

    const tiles = metricTiles(container)
    expect(tiles).toHaveLength(3)
    const grid = container.querySelector("section[aria-label='Resumen del período']")!
    const columns = Array.from(grid.className.matchAll(/grid-cols-(\d+)/g), (match) => Number(match[1]))
    // Antes: `xl:grid-cols-5` con 4 tiles dejaba una columna vacía.
    expect(Math.max(...columns)).toBe(tiles.length)
  })
})

describe("Reportes · faenas en los desgloses (0.3c)", () => {
  it("una faena inactiva se muestra por su nombre, nunca por su UUID", async () => {
    await renderPage()

    expect(screen.queryByText("ws-cerrada-3f2a9c1e-77b0-4d52")).toBeNull()
    expect(document.body.textContent).not.toContain("ws-cerrada-3f2a9c1e-77b0-4d52")
    // En el gráfico y en «Ver datos», distinguida como inactiva.
    expect(screen.getAllByText("Faena Cerrada (inactiva)")).toHaveLength(2)
    expect(screen.getAllByText("Faena Norte")).toHaveLength(2)
  })

  it("una faena que no existe en el catálogo cae en un rótulo legible, no en su id", async () => {
    state.data.itemsSinOc = [{ worksiteId: "ws-fantasma-9d8c", total: 2 }]
    state.data.ocPending = []
    await renderPage()

    expect(document.body.textContent).not.toContain("ws-fantasma-9d8c")
    expect(screen.getAllByText("Faena desconocida").length).toBeGreaterThan(0)
  })

  it("las faenas inactivas no entran a los selectores (sólo cambia el rótulo en los desgloses)", async () => {
    const tree = await Page({ searchParams: Promise.resolve({}) })

    expect(findWorksitesProps(tree).flat().map((worksite) => worksite.id)).toEqual(["ws-activa", "ws-activa"])
  })
})

describe("Reportes · estados en orden de ciclo de vida (0.3d)", () => {
  it("solicitudes, ítems y OC se leen de borrador a cierre, no por cantidad", async () => {
    await renderPage()

    expect(statusLabels("Solicitudes por estado")).toEqual(["Borrador", "Enviada", "Cerrada"])
    expect(statusLabels("Ítems por estado")).toEqual([
      "Solicitado", "Aprobado", "Pendiente compra", "Pendiente de recepción", "Entregado", "Rechazado",
    ])
    expect(statusLabels("OC por estado")).toEqual([
      "Borrador", "Pendiente de recepción", "Recibido en faena (parcial)", "Completada", "Anulada",
    ])
  })

  it("cada gráfico dice lo más frecuente de SUS datos", async () => {
    await renderPage()

    expect(screen.getByText("Lo más frecuente: Cerrada (9 de 15 solicitudes, 60%).")).toBeInTheDocument()
  })

  it("los estados de solicitud llevan a su lista con el mismo período y estado; los de ítem y OC no tienen lista que los explique", async () => {
    await renderPage()

    const requestList = screen.getByRole("list", { name: "Solicitudes por estado" })
    expect(Array.from(requestList.querySelectorAll("a")).map((link) => link.getAttribute("href"))).toEqual([
      "/solicitudes?desde=2026-11-01&hasta=2026-11-30&estado=draft",
      "/solicitudes?desde=2026-11-01&hasta=2026-11-30&estado=submitted",
      "/solicitudes?desde=2026-11-01&hasta=2026-11-30&estado=closed",
    ])
    expect(screen.getByRole("list", { name: "Ítems por estado" }).querySelectorAll("a")).toHaveLength(0)
    expect(screen.getByRole("list", { name: "OC por estado" }).querySelectorAll("a")).toHaveLength(0)
  })
})

describe("Reportes · período y comparación (CHART-032)", () => {
  it("por omisión mide el mes en curso y compara con el mes anterior, con la misma ventana del tablero", async () => {
    await renderPage()

    const { sql, params } = toSql(callOf("purchase_requests", "previous")!.where)
    expect(sql).toMatch(/"created_at"/)
    expect(params).toEqual(expect.arrayContaining(["2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"]))
  })

  it("«OC emitidas» usa la definición y la fecha del tablero: emitidas, por `issuedAt` en claves de día", async () => {
    await renderPage()

    const { sql, params } = toSql(callOf("purchase_orders", "totalAmount")!.where)
    expect(sql).toMatch(/"issued_at" is not null/i)
    expect(sql).toMatch(/"deleted_at" is null/i)
    expect(params).toEqual(expect.arrayContaining(["2026-11-01", "2026-12-01", "2026-10-01"]))
    // Un borrador o una OC anulada no es una OC emitida.
    expect(params).toEqual(expect.arrayContaining(["sent", "received", "closed"]))
    expect(params).not.toContain("draft")
    expect(params).not.toContain("cancelled")
  })

  it("muestra la variación contra el período anterior y declara contra cuál (un volumen de trabajo no se pinta bueno ni malo)", async () => {
    const { container } = await renderPage()

    const tiles = metricTiles(container)
    // 15 contra 8 solicitudes (+87,5 %); 20 contra 10 OC (+100 %); 11 contra 11 recepciones (0 %).
    expect(tiles[0]!.textContent).toContain("87,5%")
    expect(tiles[0]!.textContent).toContain("vs. oct")
    expect(tiles[1]!.textContent).toContain("100%")
    // Sin color de éxito ni de error: la variación es neutra.
    expect(container.querySelectorAll("[data-kpi-card] .bg-\\[var\\(--color-success-tint\\)\\], [data-kpi-card] .bg-\\[var\\(--color-danger-tint\\)\\]")).toHaveLength(0)
  })

  it("con un período anterior en cero no inventa una variación", async () => {
    state.data.requestStatus = [{ status: "closed", total: 4, previous: 0 }]
    const { container } = await renderPage()

    expect(metricTiles(container)[0]!.textContent).not.toMatch(/%/)
  })

  it("«Todo» es el histórico de antes: sin fechas en las consultas y sin comparación", async () => {
    const { container } = await renderPage({ periodo: "todo" })

    expect(toSql(callOf("purchase_requests", "previous")!.where).params).toEqual([])
    expect(toSql(callOf("purchase_orders", "totalAmount")!.where).params).not.toEqual(expect.arrayContaining(["2026-11-01"]))
    expect(container.textContent).not.toContain("vs. ")
    expect(screen.getByText("todo el historial")).toBeInTheDocument()
    const listLink = metricTiles(container)[0]!.closest("a")!
    expect(listLink.getAttribute("href")).toBe("/solicitudes")
  })

  it("las cifras por estado y las de lo pendiente tienen bases distintas, y la pantalla lo dice", async () => {
    await renderPage()

    expect(document.body.textContent).toMatch(/son los creados en el período/)
    expect(document.body.textContent).toMatch(/Lo pendiente por faena es la foto de hoy/)
    // Lo pendiente NO se acota por período: un ítem de hace tres meses sin OC es justo lo que importa.
    const pending = callOf("purchase_request_items", "worksiteId")!
    expect(toSql(pending.where).params).not.toEqual(expect.arrayContaining(["2026-11-01T00:00:00.000Z"]))
  })
})

describe("Reportes · alcance de faenas (el filtro nunca amplía el permiso)", () => {
  it("una faena elegida acota las consultas", async () => {
    await renderPage({ faena: "ws-activa" })

    expect(toSql(callOf("purchase_requests", "previous")!.where).params).toContain("ws-activa")
    expect(toSql(callOf("receipts")!.where).params).toContain("ws-activa")
  })

  it("un usuario de la faena A que pide la B no la ve: se ignora y se queda con la suya", async () => {
    state.scope = { global: false, ids: ["ws-activa"] }
    await renderPage({ faena: "ws-cerrada-3f2a9c1e-77b0-4d52" })

    const { params } = toSql(callOf("purchase_requests", "previous")!.where)
    expect(params).toContain("ws-activa")
    expect(params).not.toContain("ws-cerrada-3f2a9c1e-77b0-4d52")
  })

  it("sin faenas asignadas no ve nada (una lista vacía no es «sin filtro»)", async () => {
    state.scope = { global: false, ids: [] }
    await renderPage()

    expect(toSql(callOf("purchase_requests", "previous")!.where).sql).toMatch(/false/)
    expect(toSql(callOf("receipts")!.where).sql).toMatch(/false/)
  })
})

/** Las faenas que recibe cada componente cliente de la página (selector de faena y menú de exportación). */
function findWorksitesProps(node: unknown, found: Array<Array<{ id: string }>> = []): Array<Array<{ id: string }>> {
  if (!node || typeof node !== "object") return found
  if (Array.isArray(node)) {
    node.forEach((child) => findWorksitesProps(child, found))
    return found
  }
  const props = (node as { props?: Record<string, unknown> }).props
  if (!props) return found
  if (Array.isArray(props.worksites)) found.push(props.worksites as Array<{ id: string }>)
  for (const value of Object.values(props)) findWorksitesProps(value, found)
  return found
}
