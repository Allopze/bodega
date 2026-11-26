/**
 * `/mantencion/ir?folio=…`: se prueba el cableado de la página (permiso, normalización, redirección y el estado
 * «no encontramos» sin revelar si el folio existe), no la consulta (eso lo cubre `resolve-folio.test.ts`).
 */
import type { ReactNode } from "react"
import { isValidElement } from "react"
import Link from "next/link"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({ permissions: ["mant:ot:view_worksite", "mant:records:view_worksite", "mant:np:view_worksite"] as string[] }))
const resolve = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/lib/auth/can", () => ({
  requireAnyPermission: async (permissions: string[]) => {
    if (!permissions.some((permission) => session.permissions.includes(permission))) throw new Error("forbidden")
    return { user: { id: "u-1", permissions: session.permissions } }
  },
}))
vi.mock("@/lib/services/mantencion/access", () => ({
  viewerFromSession: () => ({ userId: "u-1", email: null, permissions: session.permissions, worksiteIds: ["ws-1"], isGlobal: false }),
}))
// La consulta real toca la base: aquí sólo se simula `resolveFolio`; el resto del módulo (normalización, permisos, listas) es el real.
vi.mock("@/db", () => ({ db: {} }))
vi.mock("./resolve-folio", async (importOriginal) => ({ ...(await importOriginal<typeof import("./resolve-folio")>()), resolveFolio: resolve }))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null }))

import FolioJumpPage from "./page"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
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
  const props = node.props as { children?: ReactNode; action?: ReactNode }
  return findElement(props.children, type) ?? findElement(props.action, type)
}

const render = (folio?: string | string[]) => FolioJumpPage({ searchParams: Promise.resolve(folio === undefined ? {} : { folio }) })
const redirectTarget = async (folio?: string | string[]) => {
  try { await render(folio) } catch (error) { return (error as Error).message }
  return null
}

beforeEach(() => {
  session.permissions = ["mant:ot:view_worksite", "mant:records:view_worksite", "mant:np:view_worksite"]
  resolve.mockResolvedValue(null)
})
afterEach(() => vi.clearAllMocks())

describe("/mantencion/ir · acceso", () => {
  it("sin ningún permiso de vista de Mantención va a /forbidden, sin resolver nada", async () => {
    session.permissions = ["flota:view"]
    expect(await redirectTarget("OT-BIO-0001")).toBe("redirect:/forbidden")
    expect(resolve).not.toHaveBeenCalled()
  })

  it.each([
    ["mant:ot:execute"], ["mant:records:view_own"], ["mant:np:manage"],
  ])("basta con %s para entrar (cada tipo vuelve a pedir el suyo al buscar)", async (permission) => {
    session.permissions = [permission]
    expect(await redirectTarget("OT-BIO-0001")).toBeNull()
    expect(resolve).toHaveBeenCalledTimes(1)
  })
})

describe("/mantencion/ir · resolución", () => {
  it("normaliza el folio (sin espacios, en mayúsculas) y redirige a la ficha", async () => {
    resolve.mockResolvedValue({ kind: "ot", href: "/mantencion/ot/ot-1" })
    expect(await redirectTarget("  ot-bio-0001 ")).toBe("redirect:/mantencion/ot/ot-1")
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-1", permissions: session.permissions }), "OT-BIO-0001")
  })

  it("con el parámetro repetido toma el primero", async () => {
    resolve.mockResolvedValue({ kind: "nota", href: "/mantencion/notas-pedido/np-1" })
    expect(await redirectTarget(["np-2026-0001", "OT-BIO-0001"])).toBe("redirect:/mantencion/notas-pedido/np-1")
    expect(resolve).toHaveBeenCalledWith(expect.anything(), "NP-2026-0001")
  })

  it("sin folio no consulta nada y lo dice", async () => {
    const tree = await render()
    expect(resolve).not.toHaveBeenCalled()
    expect(findElement(tree, EmptyState)!.props.title).toBe("Escribe un folio para buscarlo")
  })
})

describe("/mantencion/ir · no encontrado", () => {
  it("dice «No encontramos el folio X» con un botón a la lista que corresponde", async () => {
    const tree = await render("mp-stf-0147")
    const empty = findElement(tree, EmptyState)!
    expect(empty.props.title).toBe("No encontramos el folio MP-STF-0147")
    const boton = findElement(empty.props.action as ReactNode, Button)!
    expect(findElement(boton as unknown as ReactNode, Link)!.props.href).toBe("/mantencion/registros")
    expect(findElement(tree, PageHeader)!.props.title).toBe("Buscar un folio")
  })

  it("un folio larguísimo se acota en el título, para que no desborde la pantalla", async () => {
    const empty = findElement(await render("x".repeat(200)), EmptyState)!
    expect(empty.props.title).toBe(`No encontramos el folio ${"X".repeat(32)}…`)
  })

  it("no revela si existe: el mensaje sólo depende del folio escrito, sin hablar de permisos ni de otras faenas", async () => {
    // `resolveFolio` ya da `null` tanto para un folio inexistente como para uno fuera del alcance (ver
    // `resolve-folio.test.ts`): la página no tiene con qué distinguirlos, y su texto no los menciona.
    const empty = findElement(await render("OT-BIO-0001"), EmptyState)!
    const texto = `${empty.props.title} ${empty.props.description}`.toLowerCase()
    for (const palabra of ["existe", "permiso", "ajena", "otra faena", "prohibido"]) expect(texto, palabra).not.toContain(palabra)
    expect(findElement(await render("OT-BIO-0001"), EmptyState)!.props).toMatchObject({ title: empty.props.title, description: empty.props.description })
  })

  it("el botón lleva a la lista del prefijo si la persona puede abrirla, y si no a la primera que sí", async () => {
    const hrefDelBoton = async (folio: string) => {
      const empty = findElement(await render(folio), EmptyState)!
      return findElement(findElement(empty.props.action as ReactNode, Button) as unknown as ReactNode, Link)!.props.href
    }
    expect(await hrefDelBoton("OT-BIO-0001")).toBe("/mantencion/ot")
    expect(await hrefDelBoton("NP-2026-0001")).toBe("/mantencion/notas-pedido")
    session.permissions = ["mant:np:view_worksite"]
    expect(await hrefDelBoton("OT-BIO-0001")).toBe("/mantencion/notas-pedido")
  })
})
