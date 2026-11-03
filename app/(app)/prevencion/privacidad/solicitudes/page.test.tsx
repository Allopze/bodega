/**
 * Regresión: la página calculaba el desplazamiento de la lista con
 * `resolvePagination({ totalItems: 0 })`. Con total 0 la página se recorta a la 1,
 * así que `?page=2` (y cualquier otra) mostraba siempre las primeras 50 solicitudes
 * mientras el paginador decía «Página 2». El total real sólo se conoce DESPUÉS de
 * pedir la lista: el desplazamiento sale del parámetro y la paginación del paginador
 * se resuelve con el total que devuelve el servicio.
 */
import type { ReactNode } from "react"
import { isValidElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/auth/can", () => ({
  requireAuth: async () => ({ user: { id: "u-1", permissions: ["prevention:privacy:manage_requests"] } }),
  can: () => true,
}))
// `none` evita la consulta de trabajadores (no es lo que se prueba aquí).
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "none" }) }))
vi.mock("@/lib/services/prevention-privacy", () => ({ listPreventionPrivacyRequestsPage: mocks.list }))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("./privacy-request-create-button", () => ({ PrivacyRequestCreateButton: () => null }))
vi.mock("./privacy-requests-workbench", () => ({ PrivacyRequestsWorkbench: () => null }))

import PreventionPrivacyRequestsPage from "./page"
import { PrivacyRequestsWorkbench } from "./privacy-requests-workbench"

beforeEach(() => {
  mocks.list.mockResolvedValue({ rows: [], total: 120, limit: 50, offset: 0 })
})
afterEach(() => vi.clearAllMocks())

function findElement(node: ReactNode, type: unknown): { props: Record<string, unknown> } | null {
  if (!isValidElement(node)) return null
  if (node.type === type) return node as unknown as { props: Record<string, unknown> }
  const children = (node.props as { children?: ReactNode }).children
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child as ReactNode, type)
    if (found) return found
  }
  return null
}

async function renderPage(searchParams: Record<string, string> = {}) {
  const tree = await PreventionPrivacyRequestsPage({ searchParams: Promise.resolve(searchParams) })
  const workbench = findElement(tree, PrivacyRequestsWorkbench)
  if (!workbench) throw new Error("no se encontró el listado de solicitudes")
  return {
    listArgs: mocks.list.mock.calls[0]![1] as { limit: number; offset: number },
    pagination: workbench.props.pagination as { page: number; totalPages: number; totalItems: number },
  }
}

describe("página de solicitudes de derechos del titular — paginación", () => {
  it("sin ?page= pide la primera página", async () => {
    const { listArgs, pagination } = await renderPage()

    expect(listArgs).toMatchObject({ limit: 50, offset: 0 })
    expect(pagination).toMatchObject({ page: 1, totalPages: 3, totalItems: 120 })
  })

  it("?page=2 pide el desplazamiento de la segunda página y no la primera", async () => {
    const { listArgs, pagination } = await renderPage({ page: "2" })

    expect(listArgs.offset).toBe(50)
    expect(pagination.page).toBe(2)
  })

  it("?page=3 pide las filas 101 a 120", async () => {
    const { listArgs, pagination } = await renderPage({ page: "3" })

    expect(listArgs.offset).toBe(100)
    expect(pagination.page).toBe(3)
  })

  it("un parámetro inválido o menor que 1 cae en la primera página", async () => {
    for (const page of ["x", "0", "-4"]) {
      mocks.list.mockClear()
      const { listArgs } = await renderPage({ page })
      expect(listArgs.offset).toBe(0)
    }
  })

  it("una página fuera de rango se muestra como la última en el paginador", async () => {
    const { pagination } = await renderPage({ page: "99" })

    expect(pagination).toMatchObject({ page: 3, totalPages: 3 })
  })
})
