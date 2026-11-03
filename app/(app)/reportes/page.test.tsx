// @vitest-environment jsdom
/**
 * Fase 0 · 0.3 (AUDITORIA_VISUALIZACIONES_CHOME.md, CHART-032). Cinco defectos de
 * cifras en /reportes, todos verificados con datos de producción:
 *
 *  a) «OC pendientes de recepción» salía tres veces (detalle de «Recepciones»,
 *     tile «OC pendientes» y total del panel «OC pendientes por faena»);
 *  b) «Recepciones» contaba también las anuladas (`status = 'voided'`);
 *  c) una faena inactiva aparecía como UUID en los desgloses;
 *  d) las listas de estado iban ordenadas por conteo, no por ciclo de vida;
 *  e) la grilla de tiles tenía `xl:grid-cols-5` para 4 tiles.
 *
 * La página es un Server Component: se la renderiza con una base simulada que
 * registra a qué tabla y con qué predicado se pregunta, y se lee el DOM que
 * recibiría el usuario.
 */
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"

type Row = Record<string, unknown>
type Call = { table: string; keys: string[]; where: unknown }

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  data: {} as Record<string, Row[]>,
}))

/**
 * Qué devolver para cada consulta, según la tabla y los nombres de columna que
 * pide. Sólo depende del contrato de la página con los datos, no de cómo arma
 * el SQL.
 */
function rowsFor(call: Call): Row[] {
  const has = (key: string) => call.keys.includes(key)
  switch (call.table) {
    case "worksites": return state.data.worksites ?? []
    case "receipts": return state.data.receipts ?? []
    case "purchase_requests":
      return has("inReview") ? state.data.requestSummary ?? [] : state.data.requestStatus ?? []
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
              .then(() => {
                const rows = rowsFor(call)
                // Una consulta de faenas con `is_active` en su predicado las
                // filtra de verdad, como haría la base.
                const sqlText = call.where ? new PgDialect().sqlToQuery(call.where as SQL).sql : ""
                return call.table === "worksites" && /"is_active"/.test(sqlText)
                  ? rows.filter((row) => row.isActive === true)
                  : rows
              })
              .then(resolve, reject),
        }
        return chain
      },
    }),
  },
}))
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT") }) }))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: () => Promise.resolve({ user: { id: "u-1" } }),
  isGlobalRole: () => true,
  visibleWorksiteIds: () => [],
  can: () => true,
}))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("@/components/ui/page-container", () => ({
  PageContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock("./reports-export-menu", () => ({ ReportsExportMenu: () => null }))

import Page from "./page"

const dialect = new PgDialect()
const toSql = (condition: unknown) =>
  condition ? dialect.sqlToQuery(condition as SQL) : { sql: "", params: [] as unknown[] }

async function renderPage() {
  const tree = await Page()
  return render(tree)
}

/** Etiquetas de una lista de «Estados principales», en el orden en que se leen. */
function statusLabels(container: HTMLElement, title: string): string[] {
  const heading = Array.from(container.querySelectorAll("p")).find((p) => p.textContent === title)
  expect(heading, `grupo de estados «${title}»`).toBeDefined()
  const group = heading!.parentElement!
  return Array.from(group.querySelectorAll(".divide-y > div")).map((row) => row.querySelector("span")!.textContent ?? "")
}

function metricTiles(container: HTMLElement) {
  return Array.from(container.querySelectorAll("a")).filter((link) => link.querySelector("h2"))
}

beforeEach(() => {
  state.calls.length = 0
  state.data = {
    worksites: [
      { id: "ws-activa", name: "Faena Norte", isActive: true },
      { id: "ws-cerrada-3f2a9c1e-77b0-4d52", name: "Faena Cerrada", isActive: false },
    ],
    requestSummary: [{ total: 13, inReview: 2 }],
    orderSummary: [{ total: 20, totalAmount: 1_500_000, pendingReceipt: 7 }],
    receipts: [{ total: 11 }],
    requestStatus: [
      { status: "closed", total: 9 },
      { status: "submitted", total: 5 },
      { status: "draft", total: 1 },
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
  it("«OC pendientes de recepción» se muestra en un solo lugar: el panel por faena", async () => {
    const { container } = await renderPage()

    // Dos tiles de resumen ya no repiten la cifra: ni el tile propio ni el
    // detalle de «Recepciones».
    expect(metricTiles(container).map((tile) => tile.querySelector("h2")!.textContent)).not.toContain("OC pendientes")
    const receptionsTile = metricTiles(container).find((tile) => tile.querySelector("h2")!.textContent === "Recepciones")!
    expect(receptionsTile.textContent).not.toMatch(/pendientes de recepci[oó]n/i)

    // El 7 (4 + 3 por faena) aparece una vez: el total del panel, que es su dueño.
    expect(screen.getAllByText("7")).toHaveLength(1)
    const panel = screen.getByRole("heading", { name: "OC pendientes por faena" }).closest("section")!
    expect(panel.textContent).toContain("7")
  })

  it("no pierde información: el panel conserva el desglose y el enlace a Recepción", async () => {
    await renderPage()

    const panel = screen.getByRole("heading", { name: "OC pendientes por faena" }).closest("section")!
    expect(panel.querySelector('a[href="/recepcion"]')).not.toBeNull()
    expect(panel.textContent).toContain("Faena Norte")
  })
})

describe("Reportes · grilla de tiles (0.3e)", () => {
  it("las columnas de la grilla no superan el número de tiles", async () => {
    const { container } = await renderPage()

    const tiles = metricTiles(container)
    expect(tiles.length).toBeGreaterThan(0)
    const grid = tiles[0]!.parentElement!
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
    // Una en cada desglose (ítems sin OC y OC pendientes), distinguida como inactiva.
    expect(screen.getAllByText("Faena Cerrada (inactiva)")).toHaveLength(2)
    expect(screen.getAllByText("Faena Norte")).toHaveLength(2)
  })

  it("una faena que no existe en el catálogo cae en un rótulo legible, no en su id", async () => {
    state.data.itemsSinOc = [{ worksiteId: "ws-fantasma-9d8c", total: 2 }]
    await renderPage()

    expect(document.body.textContent).not.toContain("ws-fantasma-9d8c")
    expect(screen.getByText("Faena desconocida")).toBeInTheDocument()
  })

  it("las faenas inactivas no entran al selector de exportación (sólo cambia el rótulo)", async () => {
    // La lista de faenas del menú de exportación sigue siendo la de activas.
    const tree = await Page()
    const worksites = findWorksitesProp(tree)
    expect(worksites?.map((w) => w.id)).toEqual(["ws-activa"])
  })
})

describe("Reportes · estados en orden de ciclo de vida (0.3d)", () => {
  it("solicitudes, ítems y OC se leen de borrador a cierre, no por cantidad", async () => {
    const { container } = await renderPage()

    expect(statusLabels(container, "Solicitudes")).toEqual(["Borrador", "Enviada", "Cerrada"])
    expect(statusLabels(container, "Ítems")).toEqual([
      "Solicitado", "Aprobado", "Pendiente compra", "Pendiente de recepción", "Entregado", "Rechazado",
    ])
    expect(statusLabels(container, "OC")).toEqual([
      "Borrador", "Pendiente de recepción", "Recibido en faena (parcial)", "Completada", "Anulada",
    ])
  })
})

/** El menú de exportación recibe las faenas activas por la prop `worksites`. */
function findWorksitesProp(node: unknown): Array<{ id: string }> | null {
  if (!node || typeof node !== "object") return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findWorksitesProp(child)
      if (found) return found
    }
    return null
  }
  const props = (node as { props?: Record<string, unknown> }).props
  if (!props) return null
  if (Array.isArray(props.worksites)) return props.worksites as Array<{ id: string }>
  for (const value of Object.values(props)) {
    const found = findWorksitesProp(value)
    if (found) return found
  }
  return null
}
