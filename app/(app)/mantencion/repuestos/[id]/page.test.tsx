/**
 * Ficha de un repuesto: se prueba el cableado de la página (qué permiso y qué destino lleva «Ver existencias en
 * bodega»), no la tarjeta (eso lo cubre `spare-part-detail-sections.test.tsx`). Mostrar el enlace no es
 * autorización: Bodega valida igual.
 */
import type { ReactNode } from "react"
import { isValidElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({ permissions: ["repuestos:catalog"] as string[] }))
const getDetail = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(`redirect:${href}`) },
  notFound: () => { throw new Error("not-found") },
}))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: async (permission: string) => {
    if (!session.permissions.includes(permission)) throw new Error("forbidden")
    return { user: { id: "u-1", permissions: session.permissions } }
  },
  can: (current: { user?: { permissions?: string[] } } | null, permission: string) => Boolean(current?.user?.permissions?.includes(permission)),
}))
vi.mock("@/lib/services/spare-parts-catalog", () => ({ getSparePartDetail: getDetail }))
vi.mock("@/app/(app)/mantencion/repuestos/actions", () => ({}))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null }))

import SparePartDetailPage from "./page"
import { SparePartDataCard } from "@/components/mantencion/repuestos/spare-part-detail-sections"

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

const DETAIL = {
  part: { id: "rep-1", sku: "RPT-001", name: "Filtro de combustible primario", partNumber: null, partBrand: null, unitOfMeasure: "unidad", notes: null, referencePrice: null, isActive: true, createdAt: "2026-10-01T12:00:00.000Z", updatedAt: "2026-11-01T12:00:00.000Z" },
  suppliers: [], priceHistory: [], purchasedFor: [], recentLines: [],
}
const page = () => SparePartDetailPage({ params: Promise.resolve({ id: "rep-1" }) })

beforeEach(() => {
  session.permissions = ["repuestos:catalog"]
  getDetail.mockResolvedValue(DETAIL)
})
afterEach(() => vi.clearAllMocks())

describe("/mantencion/repuestos/[id] · existencias en Bodega", () => {
  it("con warehouse:view_stock la tarjeta de datos recibe el kárdex del producto en todas las faenas", async () => {
    session.permissions = ["repuestos:catalog", "warehouse:view_stock"]
    expect(findElement(await page(), SparePartDataCard)!.props.bodegaHref).toBe("/bodega?vista=kardex&producto=rep-1&faena=todas")
  })

  it("sin ese permiso (un mecánico, un administrador de contrato) la tarjeta no recibe destino", async () => {
    session.permissions = ["repuestos:catalog", "mant:ot:view_worksite", "warehouse:view_guides"]
    expect(findElement(await page(), SparePartDataCard)!.props.bodegaHref).toBeNull()
  })
})
