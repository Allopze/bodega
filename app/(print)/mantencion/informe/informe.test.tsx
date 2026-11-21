// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PanelReportData } from "./report-data"

afterEach(cleanup)

const report = (over: Partial<PanelReportData> = {}): PanelReportData => ({
  today: "2026-11-13",
  issuedOn: "13-11-2026",
  period: {
    from: "2026-10-01", to: "2026-10-31", granularity: "day", previous: { from: "2026-09-01", to: "2026-09-30" },
    requested: { from: "2026-10-01", to: "2026-10-31" }, chart: { from: "2026-05-01", to: "2026-10-31", granularity: "month", isHistory: true }, isDefault: false, invalid: false,
  },
  periodLabel: "Octubre 2026",
  worksiteName: "Biodiversa",
  worksiteId: "ws-1",
  equipment: null,
  work: {
    includesOrders: true,
    summary: {
      total: 10, byType: { preventiva: 4, correctiva: 4, predictiva: 1, sin_clasificar: 1 }, classified: 9, correctivePercent: (4 / 9) * 100,
      bySource: { historial: 7, ot: 3 }, workshopDays: { total: 15, withData: 3, withoutData: 7, inWorkshop: 1 }, laborHours: { total: 20, withData: 3, withoutData: 7 }, external: 1,
      series: [{ key: "2026-10", partial: false, preventiva: 4, correctiva: 4, predictiva: 1, sin_clasificar: 1 }],
      byWorksite: [{ key: "ws-1", name: "Biodiversa", worksiteId: "ws-1", count: 10, correctives: 4, workshopDays: 15, laborHours: 20 }],
      topCorrective: [{ vehicleId: "v-1", label: "KA-1 · AAAA-01", count: 3 }],
    },
  },
  pautas: { counts: { vencida: 0, proxima: 0, sin_preventiva: 0, al_dia: 0, sin_lecturas: 0, sin_pauta: 2, baja: 0 }, total: 2, inWorkshop: 0, inWorkshopByOrder: 0 },
  compliance: { checks: 4, withCompliance: 3, averagePercent: 76.7 },
  findings: { days: 7, total: 6, withWork: 2, withoutWork: 3, inWindow: 1, unlinked: 1, byEquipment: [{ vehicleId: "v-2", label: "KA-2 · AAAA-02", worksiteName: "Biodiversa", count: 3, firstFoundOn: "2026-10-12", items: ["Frenos: Freno de servicio"] }] },
  outOfService: { points: [], total: 8.5, totalPrevious: 2 },
  orderStats: { closed: 3, closedPrevious: 1, mttrHours: null, repairClosed: 0 },
  openOrders: [{ status: "solicitada", count: 2 }],
  canViewOrders: true,
  chartCaption: "Últimos 6 meses, hasta octubre de 2026",
  degraded: [],
  filenameBase: "panel-mantencion-biodiversa-2026-10-01_2026-10-31",
  ...over,
})

describe("informe del Panel de mantención (PDF)", () => {
  it("la portada trae faena, período y fecha de emisión, y la fuente va rotulada", async () => {
    const { InformeDocument } = await import("./informe-document")
    render(<InformeDocument data={report()} logoSrc="/chome_logo.svg" />)
    const cover = screen.getByRole("main").querySelector("header")!
    expect(cover.textContent).toContain("Biodiversa")
    expect(cover.textContent).toContain("Octubre 2026")
    expect(cover.textContent).toContain("13-11-2026")
    expect(screen.getByText(/Fuente: historial de formularios y órdenes de trabajo no anuladas/)).toBeTruthy()
    expect(screen.getByRole("main").hasAttribute("data-print-ready")).toBe(true)
  })

  it("dice los «sin clasificar» aparte, «Sin pauta definida» como estado y el checklist rotulado", async () => {
    const { InformeDocument } = await import("./informe-document")
    render(<InformeDocument data={report()} logoSrc="/chome_logo.svg" />)
    expect(screen.getByText(/4 de 9 clasificados · 1 sin clasificar aparte/)).toBeTruthy()
    expect(screen.getByRole("cell", { name: "Sin pauta definida" }).nextElementSibling?.textContent).toBe("2")
    expect(screen.getByText(/no hay porcentaje al día que informar|Aún no hay equipos con pauta/)).toBeTruthy()
    expect(screen.getByText(/Checklist de pauta \(formularios\)/)).toBeTruthy()
    expect(screen.getByText(/no es el semáforo de la plataforma/i)).toBeTruthy()
  })

  it("«Sin información de preventiva» sale como estado propio y con su aviso, sin contarse como al día", async () => {
    const { InformeDocument } = await import("./informe-document")
    const base = report()
    render(<InformeDocument data={report({ pautas: { ...base.pautas!, counts: { ...base.pautas!.counts, sin_preventiva: 3, al_dia: 1 } } })} logoSrc="/chome_logo.svg" />)
    expect(screen.getByRole("cell", { name: "Sin información de preventiva" }).nextElementSibling?.textContent).toBe("3")
    expect(screen.getByText(/3 equipos están sin información de preventiva/)).toBeTruthy()
  })

  it("una consulta caída se imprime como «no disponible», nunca como cero", async () => {
    const { InformeDocument } = await import("./informe-document")
    render(<InformeDocument data={report({ work: null, findings: null, degraded: ["trabajos de mantención"] })} logoSrc="/chome_logo.svg" />)
    expect(screen.getByText(/Trabajos de mantención: no disponible/)).toBeTruthy()
    expect(screen.getByText(/Hallazgos en mal estado sin trabajo: no disponible/)).toBeTruthy()
    expect(screen.getByText(/No se pudieron calcular: trabajos de mantención/)).toBeTruthy()
  })

  it("quien no ve las órdenes de trabajo no recibe su sección y la fuente lo dice", async () => {
    const { InformeDocument } = await import("./informe-document")
    const base = report()
    render(<InformeDocument data={report({ canViewOrders: false, orderStats: null, openOrders: null, work: { ...base.work!, includesOrders: false } })} logoSrc="/chome_logo.svg" />)
    expect(screen.queryByRole("heading", { name: "Órdenes de trabajo" })).toBeNull()
    expect(screen.getByText(/este perfil no ve todas las órdenes de trabajo de su alcance/)).toBeTruthy()
  })
})

const mocks = vi.hoisted(() => ({
  requireAny: vi.fn(),
  can: vi.fn(),
  render: vi.fn(async (..._args: unknown[]) => Buffer.from("%PDF-1.7 prueba")),
  report: vi.fn(),
  audit: vi.fn(async () => undefined),
}))

describe("ruta del PDF", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.requireAny.mockResolvedValue({ user: { id: "u1", email: "jefe@chome.cl", permissions: ["mant:records:view_all", "mant:export"] } })
    mocks.can.mockImplementation((_session: unknown, permission: string) => permission === "mant:export")
    mocks.report.mockResolvedValue({ worksiteId: "ws-1", period: { from: "2026-10-01", to: "2026-10-31" }, equipment: null, filenameBase: "panel-mantencion-biodiversa-2026-10-01_2026-10-31" })
    vi.doMock("@/lib/auth/can", () => ({ requireAnyPermission: mocks.requireAny, can: mocks.can }))
    vi.doMock("@/lib/audit", () => ({ recordAudit: mocks.audit }))
    vi.doMock("@/lib/pdf/render-origin", () => ({ resolvePdfRenderOrigin: () => "http://127.0.0.1:3000" }))
    vi.doMock("@/lib/pdf/render-print-page", () => ({
      PrintRenderError: class PrintRenderError extends Error {},
      printCredentialFromCookieHeader: () => null,
      renderPrintPageToPdf: mocks.render,
    }))
    vi.doMock("./report-data", () => ({ REPORT_PERMISSION: "mant:export", loadPanelReport: mocks.report }))
  })

  const call = async (query: string) => (await import("./pdf/route")).GET(new Request(`http://localhost/mantencion/informe/pdf${query}`))

  it("exige `mant:export`: sin él no se arma el informe ni se lanza el navegador", async () => {
    mocks.can.mockReturnValue(false)
    expect((await call("?faena=ws-1")).status).toBe(403)
    expect(mocks.report).not.toHaveBeenCalled()
    expect(mocks.render).not.toHaveBeenCalled()
  })

  it("sin permiso de leer el Panel responde 403", async () => {
    mocks.requireAny.mockRejectedValue(new Error("Forbidden"))
    expect((await call("")).status).toBe(403)
    expect(mocks.render).not.toHaveBeenCalled()
  })

  it("imprime la hoja con sólo los cuatro filtros, devuelve el PDF y deja la auditoría", async () => {
    const response = await call("?desde=2026-10-01&hasta=2026-10-31&faena=ws-1&equipo=v-1&otro=1")
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("application/pdf")
    expect(response.headers.get("Content-Disposition")).toContain("panel-mantencion-biodiversa-2026-10-01_2026-10-31.pdf")
    const args = mocks.render.mock.calls[0]![0] as { query: string; spec: { path: (id: string) => string } }
    expect(new URLSearchParams(args.query).get("faena")).toBe("ws-1")
    expect(new URLSearchParams(args.query).get("equipo")).toBe("v-1")
    expect(new URLSearchParams(args.query).has("otro")).toBe(false)
    expect(args.spec.path("")).toBe("/mantencion/informe")
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "export", entityType: "mant_panel_pdf", worksiteId: "ws-1" }))
  })
})

describe("página del informe", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.doMock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
    vi.doMock("@/lib/auth/can", () => ({ requireAnyPermission: mocks.requireAny, can: mocks.can }))
    vi.doMock("./report-data", () => ({ REPORT_PERMISSION: "mant:export", loadPanelReport: mocks.report }))
  })

  it("sin `mant:export` redirige a /forbidden y no arma el informe", async () => {
    mocks.requireAny.mockResolvedValue({ user: { id: "u1" } })
    mocks.can.mockReturnValue(false)
    const page = (await import("./page")).default
    await expect(page({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/forbidden")
    expect(mocks.report).not.toHaveBeenCalled()
  })

  it("sin permiso de leer el Panel también va a /forbidden, y el submódulo Panel gobierna el acceso", async () => {
    mocks.requireAny.mockRejectedValue(new Error("Forbidden"))
    const page = (await import("./page")).default
    await expect(page({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/forbidden")
    expect(mocks.requireAny).toHaveBeenCalledWith(expect.any(Array), "/mantencion/panel")
  })
})
