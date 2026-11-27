/**
 * Ficha de una nota de pedido: se prueba el cableado de la página (qué permiso decide el enlace a Bodega), no el
 * componente (eso lo cubre `parts-note-detail.test.tsx`). Mostrar el enlace no es autorización: Bodega valida igual.
 */
import type { ReactNode } from "react"
import { isValidElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { noteDetail } from "@/components/mantencion/jefatura/notas-pedido/notas-pedido-fixtures"

const session = vi.hoisted(() => ({ permissions: ["mant:np:view_worksite"] as string[] }))
const getNote = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(`redirect:${href}`) },
  notFound: () => { throw new Error("not-found") },
}))
vi.mock("@/lib/auth/can", () => ({
  requireAnyPermission: async (permissions: string[]) => {
    if (!permissions.some((permission) => session.permissions.includes(permission))) throw new Error("forbidden")
    return { user: { id: "u-1", permissions: session.permissions } }
  },
  can: (current: { user?: { permissions?: string[] } } | null, permission: string) => Boolean(current?.user?.permissions?.includes(permission)),
  canAny: (current: { user?: { permissions?: string[] } } | null, ...permissions: string[]) => permissions.some((permission) => Boolean(current?.user?.permissions?.includes(permission))),
}))
vi.mock("@/lib/services/mantencion/access", () => ({ viewerFromSession: () => ({ userId: "u-1", email: null, permissions: session.permissions, worksiteIds: ["ws-1"], isGlobal: false }) }))
vi.mock("@/lib/services/mantencion/parts-notes/query", () => ({ getPartsNote: getNote }))
vi.mock("@/app/(app)/mantencion/notas-pedido/actions", () => ({}))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null }))

import PartsNoteDetailPage from "./page"
import { NoteHeaderActions } from "@/components/mantencion/jefatura/notas-pedido/note-header-actions"
import { PartsNoteDetailView } from "@/components/mantencion/jefatura/notas-pedido/parts-note-detail"
import { PageHeader } from "@/components/ui/page-header"

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

const page = () => PartsNoteDetailPage({ params: Promise.resolve({ id: "n1" }) })

beforeEach(() => {
  session.permissions = ["mant:np:view_worksite"]
  getNote.mockResolvedValue(noteDetail())
})
afterEach(() => vi.clearAllMocks())

describe("/mantencion/notas-pedido/[id] · enlace a Bodega", () => {
  it("el permiso de Bodega (warehouse:view_stock) decide si la ficha ofrece «Ver en bodega»", async () => {
    session.permissions = ["mant:np:view_worksite", "warehouse:view_stock"]
    expect(findElement(await page(), PartsNoteDetailView)!.props.canOpenBodega).toBe(true)
  })

  it("un mecánico o un administrador de contrato, sin ese permiso, no ven el enlace", async () => {
    // Puede abrir la nota, pero no Bodega: el enlace llevaría a /forbidden.
    session.permissions = ["mant:np:view_worksite", "mant:ot:view_worksite", "repuestos:view_all"]
    expect(findElement(await page(), PartsNoteDetailView)!.props.canOpenBodega).toBe(false)
  })

  it("los demás permisos de Bodega no lo habilitan: /bodega exige ver el stock", async () => {
    session.permissions = ["mant:np:view_worksite", "warehouse:view_guides", "warehouse:export", "receiving:view"]
    expect(findElement(await page(), PartsNoteDetailView)!.props.canOpenBodega).toBe(false)
  })
})

describe("/mantencion/notas-pedido/[id] · acceso", () => {
  it.each(["mant:np:view_worksite", "mant:np:manage", "mant:np:purchase", "mant:np:view_own"])("%s abre la ficha; el alcance de cada uno lo aplica getPartsNote", async (permission) => {
    session.permissions = [permission]
    await expect(page()).resolves.toBeTruthy()
    expect(getNote).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-1", permissions: [permission] }), "n1")
  })

  it("sin ningún permiso de notas va a /forbidden sin consultar nada", async () => {
    session.permissions = ["mant:ot:view_all"]
    await expect(page()).rejects.toThrow("redirect:/forbidden")
    expect(getNote).not.toHaveBeenCalled()
  })

  it("una nota que no es de quien mira (con view_own sólo ve las suyas) o que no existe es un 404 idéntico", async () => {
    session.permissions = ["mant:np:view_own"]
    getNote.mockResolvedValue(null)
    await expect(page()).rejects.toThrow("not-found")
  })
})

describe("/mantencion/notas-pedido/[id] · encabezado y modo lectura", () => {
  const header = async () => findElement(await page(), PageHeader)!.props

  it("las acciones de cabecera son las que el servidor dijo que valen para quien mira, ni una más", async () => {
    getNote.mockResolvedValue(noteDetail({ actions: ["aceptar", "en_espera", "rechazar", "anular"] }))
    const actions = (await header()).actions as ReactNode
    expect(findElement(actions, NoteHeaderActions)!.props).toMatchObject({ noteId: "n1", code: "NP-2026-0001", actions: ["aceptar", "en_espera", "rechazar", "anular"] })
  })

  it("quien sólo ve su propia nota (view_own) no recibe acciones: sin botones de cabecera ni «Comprar»", async () => {
    session.permissions = ["mant:np:view_own", "repuestos:create"]
    getNote.mockResolvedValue(noteDetail({ actions: [], canManage: false, canBuy: false }))
    const tree = await page()
    expect((await header()).actions).toBeUndefined()
    expect(findElement(tree, PartsNoteDetailView)!.props.buyHref).toBeNull()
  })

  it("«Comprar» sólo con permiso de solicitar repuestos y de comprar esa nota", async () => {
    session.permissions = ["mant:np:purchase", "repuestos:create"]
    getNote.mockResolvedValue(noteDetail({ canManage: false, canBuy: true }))
    expect(findElement(await page(), PartsNoteDetailView)!.props.buyHref).toBe("/solicitudes/nueva?tipo=repuestos&np=n1")
    session.permissions = ["mant:np:purchase"]
    expect(findElement(await page(), PartsNoteDetailView)!.props.buyHref).toBeNull()
  })

  it("una nota sin OT ni equipo titula con su código y dice «Sin OT» en la bajada", async () => {
    getNote.mockResolvedValue(noteDetail({ workOrderId: null, workOrderFolio: null, equipmentCode: "", equipmentPlate: "" }))
    expect(await header()).toMatchObject({ title: "NP-2026-0001", description: "Sin OT · Biodiversa" })
    getNote.mockResolvedValue(noteDetail())
    expect(await header()).toMatchObject({ title: "NP-2026-0001 · KA-135", description: "OT-BIO-0001 · Biodiversa" })
  })
})
