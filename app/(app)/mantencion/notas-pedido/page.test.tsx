/**
 * Bandeja de notas de pedido: se prueba el cableado de la página (permiso, pestañas, qué se consulta según quien
 * mira y qué se pinta), no cada componente (eso lo cubren las pruebas de `components/mantencion/jefatura/notas-pedido`).
 */
import Link from "next/link"
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
import { PartsNotesAgeChart } from "@/components/mantencion/jefatura/notas-pedido/parts-notes-age-chart"
import { PartsNotesExportButton } from "@/components/mantencion/jefatura/notas-pedido/parts-notes-export-button"
import { PartsNotesFilters } from "@/components/mantencion/jefatura/notas-pedido/parts-notes-filters"
import { PartsNotesTable } from "@/components/mantencion/jefatura/notas-pedido/parts-notes-table"
import { EmptyState } from "@/components/ui/empty-state"
import { HeaderSignals } from "@/components/ui/header-signals"
import { PageHeader } from "@/components/ui/page-header"
import { ServerPagination } from "@/components/ui/server-pagination"
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

const COUNTS = { por_revisar: 4, en_compra: 2, en_recepcion: 3, cerradas: 17 }
const AGE_COUNTS = { "0-2": 2, "3-6": 1, "7-13": 0, "14+": 1 }
const NO_URGENT = { por_revisar: 0, en_compra: 0, en_recepcion: 0, cerradas: 0 }
const listResult = (overrides: Record<string, unknown> = {}) => ({
  rows: [noteRow()], total: 1, counts: COUNTS, ageCounts: AGE_COUNTS, urgentOpen: 0, urgentByTab: NO_URGENT, ...overrides,
})
const page = (searchParams: Record<string, string> = { estado: "por_revisar" }) => PartsNotesPage({ searchParams: Promise.resolve(searchParams) })
const redirectTarget = async (searchParams: Record<string, string>) => {
  try { await page(searchParams) } catch (error) { return (error as Error).message }
  return null
}

beforeEach(() => {
  session.permissions = ["mant:np:view_worksite"]
  session.isGlobal = false
  session.worksiteIds = ["ws-1", "ws-2"]
  listNotes.mockResolvedValue(listResult())
  listConciliation.mockResolvedValue({ rows: [pendingRow()], total: 3 })
})
afterEach(() => vi.clearAllMocks())

describe("/mantencion/notas-pedido · acceso", () => {
  it("sin permiso de notas de pedido va a /forbidden, sin consultar nada", async () => {
    session.permissions = ["mant:ot:view_all"]
    expect(await redirectTarget({ estado: "por_revisar" })).toBe("redirect:/forbidden")
    expect(listNotes).not.toHaveBeenCalled()
  })

  it("sin pestaña en la URL redirige a «Por revisar» conservando la faena y la búsqueda", async () => {
    expect(await redirectTarget({})).toBe("redirect:/mantencion/notas-pedido?estado=por_revisar")
    expect(await redirectTarget({ faena: "ws-2", q: "KA-135" })).toBe("redirect:/mantencion/notas-pedido?faena=ws-2&q=KA-135&estado=por_revisar")
  })

  it("quien sólo compra (purchase sin manage) abre en «En compra»; quien administra, en «Por revisar»", async () => {
    session.permissions = ["mant:np:purchase"]
    expect(await redirectTarget({})).toBe("redirect:/mantencion/notas-pedido?estado=en_compra")
    session.permissions = ["mant:np:purchase", "mant:np:manage"]
    expect(await redirectTarget({})).toBe("redirect:/mantencion/notas-pedido?estado=por_revisar")
    session.permissions = ["mant:np:view_own"]
    expect(await redirectTarget({})).toBe("redirect:/mantencion/notas-pedido?estado=por_revisar")
  })

  it("un enlace guardado con las pestañas de antes redirige a las de hoy, con sus filtros", async () => {
    expect(await redirectTarget({ estado: "pendientes", faena: "ws-2" })).toBe("redirect:/mantencion/notas-pedido?estado=por_revisar&faena=ws-2")
    expect(await redirectTarget({ estado: "en_gestion" })).toBe("redirect:/mantencion/notas-pedido?estado=en_compra")
  })

  it("«Por conciliar» sin mant:np:manage se trata como pestaña ausente", async () => {
    expect(await redirectTarget({ estado: "por_conciliar" })).toBe("redirect:/mantencion/notas-pedido?estado=por_revisar")
    expect(listConciliation).not.toHaveBeenCalled()
  })
})

describe("/mantencion/notas-pedido · pestañas", () => {
  it("quien sólo ve: cuatro pestañas con su conteo y sin consultar la conciliación", async () => {
    const tree = await page()
    const tabs = findElement(tree, StageTabs)!.props.tabs as Array<{ label: string; count: number }>
    expect(tabs.map((tab) => [tab.label, tab.count])).toEqual([["Por revisar", 4], ["En compra", 2], ["En recepción", 3], ["Cerradas", 17]])
    expect(listConciliation).not.toHaveBeenCalled()
    expect(findElement(tree, PartsNotesTable)!.props.rows).toEqual([noteRow()])
    expect(listNotes).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-1" }), expect.objectContaining({ tab: "por_revisar", page: 1, pageSize: 50 }))
  })

  it("quien administra suma «Por conciliar» con su conteo", async () => {
    session.permissions = ["mant:np:view_worksite", "mant:np:manage"]
    const tabs = findElement(await page(), StageTabs)!.props.tabs as Array<{ label: string; count: number }>
    expect(tabs.map((tab) => [tab.label, tab.count])).toEqual([["Por revisar", 4], ["En compra", 2], ["En recepción", 3], ["Cerradas", 17], ["Por conciliar", 3]])
    // Fuera de esa pestaña la conciliación sólo se pide para contar.
    expect(listConciliation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ page: 1, pageSize: 1 }))
  })

  it("«Por conciliar» pinta la lista de conciliación y pide las notas sólo para los conteos", async () => {
    session.permissions = ["mant:np:manage"]
    const tree = await page({ estado: "por_conciliar" })
    expect(findElement(tree, ConciliationList)!.props.rows).toEqual([pendingRow()])
    expect(findElement(tree, PartsNotesTable)).toBeNull()
    expect(listNotes).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tab: "por_revisar", pageSize: 1 }))
    expect(listConciliation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pageSize: 50 }))
  })

  it("la faena elegida acota las consultas; una faena fuera del alcance se ignora", async () => {
    await page({ estado: "cerradas", faena: "ws-2" })
    expect(listNotes).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ tab: "cerradas", worksiteId: "ws-2" }))
    await page({ estado: "cerradas", faena: "ws-3" })
    expect(listNotes).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ tab: "cerradas" }))
    expect((listNotes.mock.lastCall![1] as { worksiteId?: string }).worksiteId).toBeUndefined()
  })

  it("los filtros de la URL (estado exacto, urgencia, fechas, solicitante, equipo y repuesto) llegan al servicio ya validados", async () => {
    await page({
      estado: "por_revisar", situacion: "aceptada", urgencia: "urgente", antiguedad: "7-13", desde: "2026-11-01", hasta: "2026-11-27",
      solicitante: "Javier", equipo: "KA-135", articulo: "filtro", q: "NP-2026",
    })
    expect(listNotes).toHaveBeenLastCalledWith(expect.anything(), {
      tab: "por_revisar", status: "aceptada", urgent: true, age: "7-13", from: "2026-11-01", to: "2026-11-27",
      requester: "Javier", equipment: "KA-135", article: "filtro", q: "NP-2026", page: 1, pageSize: 50,
    })
    // `?urgente=1` es un atajo de la urgencia.
    await page({ estado: "en_compra", urgente: "1" })
    expect(listNotes).toHaveBeenLastCalledWith(expect.anything(), { tab: "en_compra", urgent: true, page: 1, pageSize: 50 })
    // Un valor mal formado no llega a la consulta.
    await page({ estado: "por_revisar", situacion: "inventado", urgencia: "tal", antiguedad: "30", desde: "27-11-2026", hasta: "2026-02-30" })
    expect(listNotes).toHaveBeenLastCalledWith(expect.anything(), { tab: "por_revisar", page: 1, pageSize: 50 })
  })

  it("la paginación cuenta lo que devuelve el servicio con el filtro (no el conteo de la pestaña)", async () => {
    listNotes.mockResolvedValue(listResult({ total: 120 }))
    const pagination = findElement(await page({ estado: "por_revisar", situacion: "aceptada" }), ServerPagination)!.props.pagination as { totalItems: number; totalPages: number }
    expect(pagination.totalItems).toBe(120)
    expect(pagination.totalPages).toBe(3)
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
    listNotes.mockResolvedValue(listResult({ rows: [], total: 0, counts: { por_revisar: 0, en_compra: 0, en_recepcion: 0, cerradas: 0 }, ageCounts: { "0-2": 0, "3-6": 0, "7-13": 0, "14+": 0 } }))
    const tree = await page()
    expect(findElement(tree, PartsNotesTable)).toBeNull()
    const empty = findElement(tree, EmptyState)!.props
    expect(empty.title).toBe("No hay notas por revisar")
    expect(String(empty.description)).toMatch(/repuestos/)
    // Cada pestaña dice qué significa su vacío con sus propias palabras.
    const titles = new Map<string, string>()
    for (const estado of ["en_compra", "en_recepcion", "cerradas"]) titles.set(estado, String(findElement(await page({ estado }), EmptyState)!.props.title))
    expect(Object.fromEntries(titles)).toEqual({
      en_compra: "No hay notas esperando su orden de compra",
      en_recepcion: "No hay notas esperando su recepción",
      cerradas: "Aún no hay notas cerradas",
    })
  })

  it("con filtros activos el vacío ofrece quitarlos", async () => {
    listNotes.mockResolvedValue(listResult({ rows: [], total: 0 }))
    const empty = findElement(await page({ estado: "por_revisar", faena: "ws-2" }), EmptyState)!.props
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

describe("/mantencion/notas-pedido · acceso por permiso", () => {
  it.each(["mant:np:view_worksite", "mant:np:manage", "mant:np:purchase", "mant:np:view_own"])("%s abre la bandeja (el alcance lo pone el servicio)", async (permission) => {
    session.permissions = [permission]
    expect(await redirectTarget({ estado: "por_revisar" })).toBeNull()
    expect(listNotes).toHaveBeenCalledTimes(1)
  })

  it("el filtro de la barra conoce la pestaña activa, para ofrecer sólo sus estados", async () => {
    expect(findElement(await page({ estado: "en_recepcion" }), PartsNotesFilters)!.props.tab).toBe("en_recepcion")
  })
})

describe("/mantencion/notas-pedido · acciones del encabezado", () => {
  const headerActions = async (searchParams?: Record<string, string>) => {
    const header = findElement(await page(searchParams), PageHeader)!.props.actions as ReactNode
    return {
      create: findElement(header, Link),
      exporter: findElement(header, PartsNotesExportButton),
    }
  }

  it("«Nueva nota» sólo con mant:np:create y lleva a /mantencion/notas-pedido/nueva", async () => {
    expect((await headerActions()).create).toBeNull()
    session.permissions = ["mant:np:view_worksite", "mant:np:create"]
    const { create } = await headerActions()
    expect(create!.props.href).toBe("/mantencion/notas-pedido/nueva")
  })

  it("«Exportar» sólo con mant:np:export, lleva la pestaña y los filtros de la URL, y no se ofrece en «Por conciliar»", async () => {
    expect((await headerActions()).exporter).toBeNull()
    session.permissions = ["mant:np:view_worksite", "mant:np:manage", "mant:np:export"]
    const { exporter } = await headerActions({ estado: "cerradas", faena: "ws-2", urgencia: "urgente", situacion: "anulada" })
    expect(exporter!.props.params).toMatchObject({ estado: "cerradas", faena: "ws-2", urgencia: "urgente", situacion: "anulada" })
    expect(exporter!.props.tabLabel).toBe("Cerradas")
    expect((await headerActions({ estado: "por_conciliar" })).exporter).toBeNull()
  })
})

describe("/mantencion/notas-pedido · antigüedad y urgentes", () => {
  const signalsOf = async (searchParams: Record<string, string>) => {
    const header = findElement(await page(searchParams), PageHeader)!.props.headerActions as ReactNode
    return (findElement(header, HeaderSignals)?.props.signals ?? null) as Array<{ value: number; label: string; href: string; active: boolean; tone: string }> | null
  }

  it("el gráfico de antigüedad va sobre la tabla en las tres pestañas abiertas, con los tramos del servicio y la URL actual", async () => {
    for (const estado of ["por_revisar", "en_compra", "en_recepcion"]) {
      const chart = findElement(await page({ estado, faena: "ws-2" }), PartsNotesAgeChart)!.props
      expect(chart.counts).toEqual(AGE_COUNTS)
      expect(chart.path).toBe("/mantencion/notas-pedido")
      expect(chart.raw).toEqual({ estado, faena: "ws-2" })
      expect(chart.active).toBeUndefined()
    }
    expect(findElement(await page({ estado: "por_revisar", antiguedad: "14+" }), PartsNotesAgeChart)!.props.active).toBe("14+")
  })

  it("en «Cerradas» y en «Por conciliar» no hay gráfico de antigüedad", async () => {
    expect(findElement(await page({ estado: "cerradas" }), PartsNotesAgeChart)).toBeNull()
    session.permissions = ["mant:np:manage"]
    expect(findElement(await page({ estado: "por_conciliar" }), PartsNotesAgeChart)).toBeNull()
  })

  it("«N urgentes» cuenta las abiertas del alcance y lleva a la pestaña actual con el filtro de urgencia", async () => {
    listNotes.mockResolvedValue(listResult({ urgentOpen: 3, urgentByTab: { por_revisar: 2, en_compra: 1, en_recepcion: 0, cerradas: 0 } }))
    const [signal] = (await signalsOf({ estado: "por_revisar", faena: "ws-2", pagina: "2" }))!
    expect(signal).toMatchObject({ value: 3, label: "urgentes", tone: "signal", active: false })
    expect(signal!.href).toBe("/mantencion/notas-pedido?estado=por_revisar&faena=ws-2&urgencia=urgente")
  })

  it("si en la pestaña actual no hay urgentes, el enlace va a la primera pestaña que sí, sin el estado ni el tramo de esta", async () => {
    listNotes.mockResolvedValue(listResult({ urgentOpen: 1, urgentByTab: { por_revisar: 0, en_compra: 0, en_recepcion: 1, cerradas: 0 } }))
    const [signal] = (await signalsOf({ estado: "por_revisar", situacion: "aceptada", antiguedad: "3-6" }))!
    expect(signal).toMatchObject({ value: 1, label: "urgente" })
    expect(signal!.href).toBe("/mantencion/notas-pedido?estado=en_recepcion&urgencia=urgente")
  })

  it("con el filtro de urgencia activo el chip se marca y su enlace es la salida (urgencia y atajo urgente=1)", async () => {
    listNotes.mockResolvedValue(listResult({ urgentOpen: 2, urgentByTab: { por_revisar: 2, en_compra: 0, en_recepcion: 0, cerradas: 0 } }))
    const exit = (await signalsOf({ estado: "por_revisar", urgencia: "urgente", faena: "ws-2" }))![0]!
    expect(exit).toMatchObject({ active: true, href: "/mantencion/notas-pedido?estado=por_revisar&faena=ws-2" })
    expect((await signalsOf({ estado: "por_revisar", urgente: "1" }))![0]).toMatchObject({ active: true, href: "/mantencion/notas-pedido?estado=por_revisar" })
  })

  it("«Por conciliar» no lleva la señal de urgentes (no es una lista de notas)", async () => {
    session.permissions = ["mant:np:manage"]
    expect(await signalsOf({ estado: "por_conciliar" })).toBeNull()
  })

  it("la tabla ofrece la selección sólo a quien administra y sólo en «Por revisar»", async () => {
    session.permissions = ["mant:np:view_worksite"]
    expect(findElement(await page({ estado: "por_revisar" }), PartsNotesTable)!.props.selectable).toBe(false)
    session.permissions = ["mant:np:view_worksite", "mant:np:manage"]
    expect(findElement(await page({ estado: "por_revisar" }), PartsNotesTable)!.props.selectable).toBe(true)
    for (const estado of ["en_compra", "en_recepcion", "cerradas"]) {
      expect(findElement(await page({ estado }), PartsNotesTable)!.props.selectable).toBe(false)
    }
  })
})
