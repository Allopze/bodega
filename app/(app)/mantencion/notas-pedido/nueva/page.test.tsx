/**
 * «Nueva nota de pedido»: se prueba el cableado de la página (permiso en el servidor, qué opciones se piden y a quién, qué se
 * pinta), no el formulario (eso lo cubre `new-note-form.test.tsx`).
 */
import type { ReactNode } from "react"
import { isValidElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NEW_NOTE_OPTIONS } from "@/components/mantencion/jefatura/notas-pedido/new-note-fixtures"

const session = vi.hoisted(() => ({ permissions: ["mant:np:create"] as string[] }))
const loadOptions = vi.hoisted(() => vi.fn())
const requireAnyPermission = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/lib/auth/can", () => ({
  requireAnyPermission: async (permissions: string[], pathname?: string) => {
    requireAnyPermission(permissions, pathname)
    if (!permissions.some((permission) => session.permissions.includes(permission))) throw new Error("forbidden")
    return { user: { id: "u-mec", permissions: session.permissions } }
  },
}))
vi.mock("@/lib/services/mantencion/access", () => ({
  viewerFromSession: () => ({ userId: "u-mec", email: null, permissions: session.permissions, worksiteIds: ["ws-1"], isGlobal: false }),
}))
vi.mock("@/lib/services/mantencion/parts-notes/new-note-options", () => ({ loadNewNoteOptions: loadOptions }))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null }))

import NewPartsNotePage from "./page"
import { NewNoteForm } from "@/components/mantencion/jefatura/notas-pedido/new-note-form"
import { EmptyState } from "@/components/ui/empty-state"

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

const page = (searchParams: Record<string, string> = {}) => NewPartsNotePage({ searchParams: Promise.resolve(searchParams) })

beforeEach(() => {
  session.permissions = ["mant:np:create"]
  loadOptions.mockResolvedValue(NEW_NOTE_OPTIONS)
})
afterEach(() => vi.clearAllMocks())

describe("/mantencion/notas-pedido/nueva", () => {
  it("exige mant:np:create en el servidor: sin él redirige a /forbidden y no lee ninguna opción", async () => {
    session.permissions = ["mant:np:view_worksite", "mant:np:manage"]
    await expect(page()).rejects.toThrow("redirect:/forbidden")
    expect(requireAnyPermission).toHaveBeenCalledWith(["mant:np:create"], "/mantencion/notas-pedido")
    expect(loadOptions).not.toHaveBeenCalled()
  })

  it("pide las opciones con el alcance de quien mira y pinta el formulario con su id (el borrador es de cada persona)", async () => {
    const form = findElement(await page(), NewNoteForm)
    expect(loadOptions).toHaveBeenCalledWith({ userId: "u-mec", email: null, permissions: ["mant:np:create"], worksiteIds: ["ws-1"], isGlobal: false })
    expect(form?.props).toMatchObject({ userId: "u-mec", options: NEW_NOTE_OPTIONS, initial: { workOrderId: "", worksiteId: "" } })
  })

  it("`?ot=` llega al formulario como OT inicial (el formulario descarta la que no sea de sus opciones)", async () => {
    const form = findElement(await page({ ot: "ot-1" }), NewNoteForm)
    expect(form?.props.initial).toEqual({ workOrderId: "ot-1", worksiteId: "" })
  })

  it("sin ninguna faena en el alcance no hay formulario: explica qué pasa y ofrece una salida", async () => {
    loadOptions.mockResolvedValue({ worksites: [], vehicles: [], costCenters: [], workOrders: [], suppliers: [] })
    const tree = await page()
    expect(findElement(tree, NewNoteForm)).toBeNull()
    expect(findElement(tree, EmptyState)?.props.title).toBe("No tienes una faena para pedir repuestos")
  })
})
