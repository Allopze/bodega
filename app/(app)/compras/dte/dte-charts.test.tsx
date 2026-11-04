// @vitest-environment jsdom
/**
 * CHART-034 · las dos secciones de `/compras/dte`. recharts no mide en jsdom, así que
 * el trazado se sustituye: lo que se verifica es lo que las secciones deciden (frase,
 * alternativa en datos, estado vacío con salida, y qué ve quien no tiene la empresa entera).
 */
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  reconciliationMonths,
  shapeDteCoverage,
  shapeReconciliationMonths,
  type DteCoverageRow,
  type ReconciliationRow,
} from "@/lib/purchasing/reconciliation-charts"

vi.mock("./reconciliation-charts-lazy", () => ({
  ReconciliationChart: () => <div data-testid="trazado-oc" />,
  DteCoverageChart: () => <div data-testid="trazado-dte" />,
}))

import { DteCharts } from "./dte-charts"

afterEach(cleanup)

const TODAY = "2026-11-03"
const months = reconciliationMonths(TODAY, 3)
const orderRow = (month: string, status: string, count: number, toInvoice = 0): ReconciliationRow => ({ month, status, count, toInvoice, withBalance: toInvoice > 0 ? count : 0 })
const dteRow = (periodo: string, link: string, count: number, amount = 0): DteCoverageRow => ({ periodo, link, count, amount })

const orders = shapeReconciliationMonths([orderRow("2026-10", "needs_review", 2, 500_000), orderRow("2026-09", "matched", 4)], months, TODAY)
const dte = shapeDteCoverage([dteRow("2026-10", "oc", 40), dteRow("2026-10", "none", 10, 2_500_000)], months, TODAY)

describe("DteCharts", () => {
  it("responde cuánto queda por facturar y qué parte de los DTE sigue sin vincular, con su n", () => {
    render(<DteCharts orders={orders} dte={dte} periodo="2026-10" />)

    expect(screen.getByRole("heading", { name: "Conciliación de las OC emitidas" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Cobertura de los DTE recibidos" })).toBeTruthy()
    expect(screen.getByText(/Quedan \$500\.000 por facturar en 2 de 6 OC emitidas en los últimos 3 meses\. 2 requieren revisión\./)).toBeTruthy()
    expect(screen.getByText(/10 de 50 DTE \(20%\) de los últimos 3 meses no están vinculados/)).toBeTruthy()
    expect(screen.getByTestId("trazado-oc")).toBeTruthy()
    expect(screen.getByTestId("trazado-dte")).toBeTruthy()
  })

  it("deja una alternativa en datos para cada gráfico", () => {
    render(<DteCharts orders={orders} dte={dte} periodo="2026-10" />)
    expect(screen.getAllByText("Ver datos")).toHaveLength(2)
  })

  it("el enlace de teclado lleva a la lista del período a la vista, sin vincular", () => {
    render(<DteCharts orders={orders} dte={dte} periodo="2026-10" />)
    expect(screen.getByRole("link", { name: /Ver los DTE sin vincular de octubre 2026/ }).getAttribute("href")).toBe("/compras/dte?periodo=2026-10&vinculo=sin_oc")
    expect(screen.getByRole("link", { name: /Ver las OC con factura pendiente/ }).getAttribute("href")).toBe("/compras?factura=pendiente")
  })

  it("quien no ve la empresa entera (sin faenas globales) no recibe la cobertura de DTE, sólo la de OC", () => {
    render(<DteCharts orders={orders} dte={null} periodo="2026-10" />)
    expect(screen.getByRole("heading", { name: "Conciliación de las OC emitidas" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Cobertura de los DTE recibidos" })).toBeNull()
    expect(screen.queryByTestId("trazado-dte")).toBeNull()
  })

  it("sin OC explica el vacío y manda a Compras (A4); sin DTE manda a la sincronización si se puede", () => {
    const empty = shapeReconciliationMonths([], months, TODAY)
    const noDte = shapeDteCoverage([], months, TODAY)
    render(<DteCharts orders={empty} dte={noDte} periodo="2026-10" syncHref="/admin/dte" />)

    expect(screen.getByText("Sin OC emitidas en los últimos 3 meses")).toBeTruthy()
    expect(screen.getByRole("link", { name: /Ir a Compras/ }).getAttribute("href")).toBe("/compras")
    expect(screen.getByText("Sin DTE sincronizados en los últimos 3 meses")).toBeTruthy()
    expect(screen.getByRole("link", { name: /Ir a la sincronización DTE/ }).getAttribute("href")).toBe("/admin/dte")
    expect(screen.queryByTestId("trazado-oc")).toBeNull()
  })

  it("sin permiso de sincronización el vacío de DTE no ofrece un enlace que daría 403", () => {
    render(<DteCharts orders={orders} dte={shapeDteCoverage([], months, TODAY)} periodo="2026-10" />)
    expect(screen.queryByRole("link", { name: /sincronización DTE/ })).toBeNull()
  })

  it("con pocos documentos la frase no da un porcentaje", () => {
    render(<DteCharts orders={orders} dte={shapeDteCoverage([dteRow("2026-10", "oc", 3), dteRow("2026-10", "none", 2, 90_000)], months, TODAY)} periodo="2026-10" />)
    expect(screen.getByText(/datos insuficientes para un porcentaje \(n = 5\)/)).toBeTruthy()
  })
})
