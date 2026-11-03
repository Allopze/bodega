/**
 * Fase 0 · 0.6 (AUDITORIA_VISUALIZACIONES_CHOME.md). El detalle del tile
 * «Vencido» pintaba «… al <hoy>» con `new Date().toLocaleDateString("es-CL")`:
 * el formato salía del ICU del runtime (en ICU antiguos es «5-3-2026», en los
 * nuevos «05-03-2026») y se apartaba de `formatDate`, que es el único formato de
 * fecha del producto (dd-mm-aaaa, día civil de Chile).
 *
 * En este Node los dos caminos dan el mismo texto, así que la prueba no compara
 * valores: sustituye `Date#toLocaleDateString` por un centinela y exige que la
 * página no dependa de él.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const summary = vi.hoisted(() => ({
  invoiceCount: 3,
  invoicedByCurrency: [{ currency: "CLP", amount: 1_000_000 }],
  collectedByCurrency: [],
  outstandingByCurrency: [{ currency: "CLP", amount: 400_000 }],
  overdueByCurrency: [{ currency: "CLP", amount: 150_000 }],
  overdueCount: 2,
  providerStatus: [],
  aging: [],
  averageDaysToPay: null,
  topClients: [],
  byWorksite: [],
  monthly: [],
  generatedAt: "2026-03-06T02:30:00.000Z",
}))

vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT") }) }))
vi.mock("@/lib/auth/auth", () => ({ auth: () => Promise.resolve({ user: { id: "u-1" } }) }))
vi.mock("@/lib/auth/can", () => ({ can: () => true }))
vi.mock("@/lib/services/billing/queries", () => ({
  getBillingSummary: () => Promise.resolve(summary),
  listUnlinkedInvoices: () => Promise.resolve([]),
  todayIso: () => "2026-03-05",
}))

import { formatDate, todayInChile } from "@/lib/utils"
import BillingSummaryPage from "./page"

function collectElements(node: unknown, result: Array<{ type: unknown; props: Record<string, unknown> }> = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => collectElements(child, result))
    return result
  }
  if (!node || typeof node !== "object" || !("props" in node)) return result
  const element = node as { type: unknown; props: Record<string, unknown> }
  result.push(element)
  Object.values(element.props).forEach((value) => collectElements(value, result))
  return result
}

describe("Facturación · fecha del tile «Vencido» (0.6)", () => {
  beforeEach(() => {
    // 23:30 del 5 de marzo en Chile (UTC-3): en UTC ya es 6 de marzo.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-03-06T02:30:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("«al <hoy>» sale de formatDate(todayInChile()), no del locale del runtime", async () => {
    vi.spyOn(Date.prototype, "toLocaleDateString").mockReturnValue("FECHA-DEL-RUNTIME")

    const page = await BillingSummaryPage({ searchParams: Promise.resolve({}) })
    const overdue = collectElements(page).find(
      (element) => typeof element.props.label === "string" && element.props.label === "Vencido",
    )

    expect(overdue, "el tile «Vencido» debe existir").toBeDefined()
    expect(String(overdue!.props.detail)).not.toContain("FECHA-DEL-RUNTIME")
    expect(overdue!.props.detail).toBe(`2 facturas vencidas al ${formatDate(todayInChile())}`)
    // El día civil de Chile, no el de UTC (6 de marzo).
    expect(overdue!.props.detail).toBe("2 facturas vencidas al 05-03-2026")
  })
})
