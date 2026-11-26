/**
 * Bandeja de notas de pedido: se prueba el cableado de la página (permiso, pestañas, qué se consulta según quien
 * mira y qué se pinta), no cada componente (eso lo cubren las pruebas de `components/mantencion/jefatura/notas-pedido`).
 */
import type { ReactNode } from "react"
import { isValidElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { noteRow, pendingRow } from "@/components/mantencion/jefatura/notas-pedido/notas-pedido-fixtures"

const session = vi.hoisted(() => ({ permissions: ["mant:np:view_worksite"] as string[], isGlobal: false, worksiteIds: ["ws-1", "ws-2"] as string[] }))
const listNotes = vi.hoisted(() => vi.fn())
const listConciliation = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/lib/auth/can", () => ({
  requireAnyPermission: async (permissions: string[]) => {
    if (!permissions.some((permission) => session.permissions.includes(permission))) throw new Error("forbidden")
    return { user: { id: "u-1", permissions: session.permissions } }
  },
  can: (current: { user?: { permissions?: string[] } } | null, permission: string) => Boolean(current?.user?.permissions?.includes(permission)),
}))
vi.mock("@/lib/services/mantencion/access", () => ({
  viewerFromSession: () => ({ userId: "u-1", email: null, permissions: session.permissions, worksiteIds: session.worksiteIds, isGlobal: session.isGlobal }),
}))
vi.mock("@/lib/services/mantencion/parts-notes/query", () => ({ listPartsNotes: listNotes }))
vi.mock("@/lib/services/mantencion/parts/conciliation", () => ({ listPendingConciliation: listConciliation }))
vi.mock("@/lib/services/mantencion/work-orders/query", () => ({
  listExecutionWorksiteOptions: async () => [{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Santa Fe" }, { id: "ws-3", name: "Cholguán" }],
}))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null }))

import PartsNotesPage from "./page"
import { ConciliationList } from "@/components/mantencion/jefatura/notas-pedido/conciliation-list"
import { PartsNotesFilters } from "@/components/mantencion/jefatura/notas-pedido/parts-notes-filters"
import { PartsNotesTable } from "@/components/mantencion/jefatura/notas-pedido/parts-notes-table"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { StageTabs } from "@/components/ui/stage-tabs"

type Found = { props: Record<string, unknown> }
function findElement(node: ReactNode, type: unknown): Found | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child as ReactNode, type)
      if (found) return found
    }
    return null
  }
  if (!isValidElement(node)) return null
  if (node.type === type) return node as unknown as Found
  return findElement((node.props as { children?: ReactNode }).children, type)
}

const COUNTS = { pendientes: 4, en_gestion: 2, cerradas: 17 }
const page = (searchParams: Record<string, string> = { estado: "pendientes" }) => PartsNotesPage({ searchParams: Promise.resolve(searchParams) })
const redirectTarget = async (searchParams: Record<string, string>) => {
  try { await page(searchParams) } catch (error) { return (error as Error).message }
  return null
}

beforeEach(() => {
  session.permissions = ["mant:np:view_worksite"]
  session.isGlobal = false
  session.worksiteIds = ["ws-1", "ws-2"]
  listNotes.mockResolvedValue({ rows: [noteRow()], total: 1, counts: COUNTS })
  listConciliation.mockResolvedValue({ rows: [pendingRow()], total: 3 })
})
afterEach(() => vi.clearAllMocks())

describe("/mantencion/notas-pedido · acceso", () => {
  it("sin permiso de notas de pedido va a /forbidden, sin consultar nada", async () => {
    session.permissions = ["mant:ot:view_all"]
    expect(await redirectTarget({ estado: "pendientes" })).toBe("redirect:/forbidden")
    expect(listNotes).not.toHaveBeenCalled()
  })

  it("sin pestaña en la URL redirige a «Pendientes» conservando la faena y la búsqueda", async () => {
    expect(await redirectTarget({})).toBe("redirect:/mantencion/notas-pedido?estado=pendientes")
    expect(await redirectTarget({ faena: "ws-2", q: "KA-135" })).toBe("redirect:/mantencion/notas-pedido?faena=ws-2&q=KA-135&estado=pendientes")
  })

  it("«Por conciliar» sin mant:np:manage se trata como pestaña ausente", async () => {
    expect(await redirectTarget({ estado: "por_conciliar" })).toBe("redirect:/mantencion/notas-pedido?estado=pendientes")
    expect(listConciliation).not.toHaveBeenCalled()
  })
})

describe("/mantencion/notas-pedido · pestañas", () => {
  it("quien sólo ve: tres pestañas con su conteo y sin consultar la conciliación", async () => {
    const tree = await page()
    const tabs = findElement(tree, StageTabs)!.props.tabs as Array<{ label: string; count: number }>
    expect(tabs.map((tab) => [tab.label, tab.count])).toEqual([["Pendientes", 4], ["En gestión", 2], ["Cerradas", 17]])
    expect(listConciliation).not.toHaveBeenCalled()
    expect(findElement(tree, PartsNotesTable)!.props.rows).toEqual([noteRow()])
    expect(listNotes).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-1" }), expect.objectContaining({ tab: "pendientes", page: 1, pageSize: 50 }))
  })

  it("quien administra suma «Por conciliar» con su conteo", async () => {
    session.permissions = ["mant:np:view_worksite", "mant:np:manage"]
    const tabs = findElement(await page(), StageTabs)!.props.tabs as Array<{ label: string; count: number }>
    expect(tabs.map((tab) => [tab.label, tab.count])).toEqual([["Pendientes", 4], ["En gestión", 2], ["Cerradas", 17], ["Por conciliar", 3]])
    // Fuera de esa pestaña la conciliación sólo se pide para contar.
    expect(listConciliation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ page: 1, pageSize: 1 }))
  })

  it("«Por conciliar» pinta la lista de conciliación y pide las notas sólo para los conteos", async () => {
    session.permissions = ["mant:np:manage"]
    const tree = await page({ estado: "por_conciliar" })
    expect(findElement(tree, ConciliationList)!.props.rows).toEqual([pendingRow()])
    expect(findElement(tree, PartsNotesTable)).toBeNull()
    expect(listNotes).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tab: "pendientes", pageSize: 1 }))
    expect(listConciliation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pageSize: 50 }))
  })

  it("la faena elegida acota las consultas; una faena fuera del alcance se ignora", async () => {
    await page({ estado: "cerradas", faena: "ws-2" })
    expect(listNotes).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ tab: "cerradas", worksiteId: "ws-2" }))
    await page({ estado: "cerradas", faena: "ws-3" })
    expect(listNotes).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ tab: "cerradas", worksiteId: undefined }))
  })

  it("el filtro de faena ofrece sólo las del alcance de quien mira", async () => {
    const filters = findElement(await page(), PartsNotesFilters)!.props
    expect(filters.worksites).toEqual([{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Santa Fe" }])
    expect(filters.allWorksitesLabel).toBe("Todas tus faenas")
    session.isGlobal = true
    const global = findElement(await page(), PartsNotesFilters)!.props
    expect((global.worksites as unknown[]).length).toBe(3)
    expect(global.allWorksitesLabel).toBe("Todas las faenas")
  })
})

describe("/mantencion/notas-pedido · vacíos y encabezado", () => {
  it("una pestaña vacía dice qué significa y qué hacer, no una tabla vacía", async () => {
    listNotes.mockResolvedValue({ rows: [], total: 0, counts: { pendientes: 0, en_gestion: 0, cerradas: 0 } })
    const tree = await page()
    expect(findElement(tree, PartsNotesTable)).toBeNull()
    const empty = findElement(tree, EmptyState)!.props
    expect(empty.title).toBe("No hay notas por resolver")
    expect(String(empty.description)).toMatch(/mecánico/)
  })

  it("con filtros activos el vacío ofrece quitarlos", async () => {
    listNotes.mockResolvedValue({ rows: [], total: 0, counts: COUNTS })
    const empty = findElement(await page({ estado: "pendientes", faena: "ws-2" }), EmptyState)!.props
    expect(empty.title).toBe("Ninguna nota coincide con los filtros")
    expect(empty.action).toBeTruthy()
  })

  it("el encabezado es «Notas de pedido» con una descripción corta y el camino Control operacional › Mantención", async () => {
    const header = findElement(await page(), PageHeader)!.props
    expect(header.title).toBe("Notas de pedido")
    expect(String(header.description).length).toBeLessThanOrEqual(90)
    expect(header.breadcrumb).toEqual([{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Notas de pedido" }])
  })
})
