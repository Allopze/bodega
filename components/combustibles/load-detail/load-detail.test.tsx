// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

const requestReviewAction = vi.fn()
const withdrawReviewRequestAction = vi.fn()
const refresh = vi.fn()

vi.mock("@/app/(app)/combustibles/bitacora/actions", () => ({
  requestReviewAction: (...args: unknown[]) => requestReviewAction(...args),
  withdrawReviewRequestAction: (...args: unknown[]) => withdrawReviewRequestAction(...args),
}))
vi.mock("@/app/(app)/combustibles/revisar/actions", () => ({ decideFlaggedLoadsAction: vi.fn(), reopenFlaggedDecisionAction: vi.fn() }))
// La ficha de terreno trae el diálogo de corrección de lectura, que importa esta acción.
vi.mock("@/app/(app)/combustibles/tae/actions", () => ({ updateTaeMeterReadingAction: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/combustibles/cargas" }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { ReviewRequestControl } from "./review-request-control"
import { FacturaLoadDetail } from "./factura-load-detail"
import { LoadReviewStatus, LoadTimeline, OpenCasesNotice } from "./load-sections"
import { PlanillaLoadDetail } from "./planilla-load-detail"
import { TerrenoLoadDetail } from "./terreno-load-detail"
import type {
  FacturaDetail,
  LoadOpenCase,
  LoadReviewState,
  OpenReviewRequest,
  PlanillaDetail,
  TerrenoDetail,
} from "@/lib/combustibles/fuel-log-detail"

beforeEach(() => {
  requestReviewAction.mockReset().mockResolvedValue({ ok: true, markId: "m-1" })
  withdrawReviewRequestAction.mockReset().mockResolvedValue({ ok: true, markId: "m-1" })
  refresh.mockClear()
})
afterEach(() => cleanup())

describe("«Pedir que la revisen»", () => {
  it("exige la nota de 10 caracteres antes de enviar y manda fuente, carga y nota", async () => {
    render(<ReviewRequestControl source="tae_pwa" entityId="tae-1" openRequest={null} canWithdraw={false} />)
    fireEvent.click(screen.getByRole("button", { name: "Pedir que la revisen" }))

    const submit = await screen.findByRole("button", { name: "Pedir revisión" })
    expect(submit).toBeDisabled()
    const note = screen.getByRole("textbox")
    fireEvent.change(note, { target: { value: "muy corta" } })
    expect(submit).toBeDisabled()
    expect(screen.getByText("Escribe al menos 10 caracteres.")).toBeInTheDocument()

    fireEvent.change(note, { target: { value: "Los litros parecen altos" } })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    await waitFor(() => expect(requestReviewAction).toHaveBeenCalledWith("tae_pwa", "tae-1", "Los litros parecen altos"))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("muestra el motivo del rechazo del servidor sin cerrar el diálogo", async () => {
    requestReviewAction.mockResolvedValue({ ok: false, message: "Esta carga ya tiene un pedido de revisión abierto." })
    render(<ReviewRequestControl source="invoiced" entityId="inv-1" openRequest={null} canWithdraw={false} />)
    fireEvent.click(screen.getByRole("button", { name: "Pedir que la revisen" }))
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Revisar la boleta, no cuadra" } })
    fireEvent.click(screen.getByRole("button", { name: "Pedir revisión" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("ya tiene un pedido de revisión abierto")
    expect(refresh).not.toHaveBeenCalled()
  })

  it("con un pedido abierto lo muestra y lo retira (sin confirmación) sólo quien puede", async () => {
    const open = { id: "m-1", note: "Revisar los litros", markedByName: "Pedro" }
    const { unmount } = render(<ReviewRequestControl source="tae_pwa" entityId="tae-1" openRequest={open} canWithdraw />)
    fireEvent.click(screen.getByRole("button", { name: "Revisión pedida" }))
    expect(await screen.findByText(/Pedro/)).toBeInTheDocument()
    expect(screen.getByText("Revisar los litros")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retirar el pedido" }))
    await waitFor(() => expect(withdrawReviewRequestAction).toHaveBeenCalledWith("m-1"))
    unmount()

    render(<ReviewRequestControl source="tae_pwa" entityId="tae-1" openRequest={open} canWithdraw={false} />)
    fireEvent.click(screen.getByRole("button", { name: "Revisión pedida" }))
    expect(await screen.findByText(/Sólo quien lo pidió/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Retirar el pedido" })).not.toBeInTheDocument()
  })
})

const review = (overrides: Partial<LoadReviewState> = {}): LoadReviewState => ({
  equipmentLoadId: "el-1", reviewStatus: "flagged", flagReasons: ["meter_regression"], reviewNote: null,
  reviewedByName: null, reviewedAt: null, performanceStatus: "meter_regression", createdAt: "2026-10-30T08:12:00.000Z", duplicateOfId: null,
  ...overrides,
})

describe("estado de revisión de la plataforma en la ficha", () => {
  it("por decidir: dice el motivo, el efecto y enlaza a la bandeja", () => {
    render(<LoadReviewStatus review={review()} search={{ periodo: "2026-10", faena: "w-1" }} />)
    expect(screen.getByText("Esta carga espera una decisión")).toBeInTheDocument()
    expect(screen.getByText("Lectura de medidor menor a la anterior")).toBeInTheDocument()
    expect(screen.getByText(/sus litros cuentan, pero la carga no entra al promedio/)).toBeInTheDocument()
    const link = screen.getByRole("link", { name: /Decidir en «Por revisar»/ })
    const href = link.getAttribute("href")!
    expect(href).toContain("/combustibles/revisar?")
    expect(href).toContain("tipo=carga")
    expect(href).toContain("item=carga%3Ael-1")
    expect(href).toContain("periodo=2026-10")
  })

  it("sólo ofrece decidir en la ficha a quien puede", () => {
    const { unmount } = render(<LoadReviewStatus review={review()} canDecide equipmentLabel="CA-14" />)
    expect(screen.getByRole("link", { name: /Verla en «Por revisar»/ })).toBeInTheDocument()
    unmount()
    render(<LoadReviewStatus review={review({ reviewStatus: "approved", reviewedByName: "Jefa", reviewNote: "Se cambió el tablero" })} canDecide equipmentLabel="CA-14" />)
    expect(screen.getByRole("button", { name: /Deshacer la decisión sobre CA-14/ })).toBeInTheDocument()
    expect(screen.getByText("Cuenta")).toBeInTheDocument()
    expect(screen.getByText(/Lo decidió Jefa/)).toBeInTheDocument()
  })

  it("decidida sin permiso de decidir no ofrece deshacer; sin observaciones lo dice", () => {
    const { unmount } = render(<LoadReviewStatus review={review({ reviewStatus: "rejected", reviewedByName: "Jefa" })} />)
    expect(screen.getByText("No cuenta")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Deshacer/ })).not.toBeInTheDocument()
    unmount()
    render(<LoadReviewStatus review={review({ reviewStatus: "ok", flagReasons: [] })} />)
    expect(screen.getByText(/Sin observaciones/)).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Por revisar/ })).not.toBeInTheDocument()
  })

  it("sin fila proyectada dice que la plataforma todavía no la revisa", () => {
    render(<LoadReviewStatus review={null} />)
    expect(screen.getByText("La plataforma todavía no revisa esta carga.")).toBeInTheDocument()
  })
})

describe("línea de tiempo en pantalla", () => {
  it("muestra la frase, la nota entre comillas y la hora", () => {
    render(<LoadTimeline events={[{ key: "a", at: "2026-10-30T12:00:00.000Z", actor: "Ana", text: "Ana validó la carga", note: "Todo en orden", tone: "success" }]} />)
    expect(screen.getByText("Ana validó la carga")).toBeInTheDocument()
    expect(screen.getByText("«Todo en orden»")).toBeInTheDocument()
  })

  it("sin hechos, lo dice en vez de dejar un hueco", () => {
    render(<LoadTimeline events={[]} />)
    expect(screen.getByText(/Todavía no hay movimientos/)).toBeInTheDocument()
  })
})

/* ── Casos abiertos sobre la carga ───────────────────────────────────────── */

const openCase = (overrides: Partial<LoadOpenCase> = {}): LoadOpenCase => ({
  id: "case-1", ruleCode: "kilometraje_regresivo", ruleName: "Kilometraje inferior al anterior", severity: "high", status: "open",
  detectedAt: "2026-10-30T09:00:00.000Z", ...overrides,
})

const TWO_CASES: LoadOpenCase[] = [
  openCase({ id: "case-crit", ruleCode: "litros_supera_capacidad", ruleName: "Litros superiores a capacidad del estanque", severity: "critical", status: "open" }),
  openCase({ id: "case-mid", ruleCode: "sello_repetido", ruleName: "Sello repetido", severity: "medium", status: "in_review" }),
]

describe("casos abiertos sobre la carga", () => {
  it("dice cuántos son y lista cada uno con su gravedad, su estado y un enlace a su hoja en «Por revisar»", () => {
    render(<OpenCasesNotice cases={TWO_CASES} search={{ periodo: "2026-10", faena: "w-1" }} />)

    expect(screen.getByRole("status")).toHaveTextContent("Hay 2 casos abiertos sobre esta carga")
    const [critical, medium] = screen.getAllByRole("listitem")

    const criticalLink = within(critical!).getByRole("link", { name: "Litros superiores a capacidad del estanque" })
    const href = criticalLink.getAttribute("href")!
    expect(href).toContain("/combustibles/revisar?")
    expect(href).toContain("tipo=caso")
    expect(href).toContain("item=caso%3Acase-crit")
    expect(href).toContain("periodo=2026-10")
    expect(href).toContain("faena=w-1")
    expect(within(critical!).getByText("Crítica")).toBeInTheDocument()
    expect(within(critical!).getByText("Abierto")).toBeInTheDocument()

    expect(within(medium!).getByRole("link", { name: "Sello repetido" }).getAttribute("href")).toContain("item=caso%3Acase-mid")
    expect(within(medium!).getByText("Media")).toBeInTheDocument()
    expect(within(medium!).getByText("Tomada")).toBeInTheDocument()
  })

  it("respeta el orden que trae el servidor (los más graves primero)", () => {
    render(<OpenCasesNotice cases={TWO_CASES} />)

    expect(screen.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "Litros superiores a capacidad del estanque",
      "Sello repetido",
    ])
  })

  it("con un solo caso, el título va en singular", () => {
    render(<OpenCasesNotice cases={[openCase({ status: "reopened" })]} />)

    expect(screen.getByRole("status")).toHaveTextContent("Hay 1 caso abierto sobre esta carga")
    expect(screen.queryByText(/casos abiertos/)).toBeNull()
    expect(screen.getByText("Reabierto")).toBeInTheDocument()
  })

  it("sin casos no pinta nada", () => {
    const { container } = render(<OpenCasesNotice cases={[]} />)

    expect(container).toBeEmptyDOMElement()
  })
})

const COMMON = {
  worksiteId: "w-1",
  worksiteName: "Faena Norte",
  vehicle: { id: "veh-1", code: "CA-14", plate: "KPRT14", typeName: "Camión", meterType: "odometer" },
  equipmentLabel: "CA-14 · KPRT14",
  review: null,
  timeline: [],
}

const OPEN_REQUEST: OpenReviewRequest = { id: "m-1", note: "Revisar los litros", markedById: "u-1", markedByName: "Luis Auditor", createdAt: "2026-10-30T08:00:00.000Z" }

function terrenoDetail(openCases: LoadOpenCase[], openRequest: OpenReviewRequest | null = null): TerrenoDetail {
  return {
    ...COMMON, origen: "terreno", id: "sub-1", openRequest, openCases,
    submission: { id: "sub-1", source: "internal_app", meterType: "odometer", status: "submitted", loadedAt: "2026-10-30T12:00:00.000Z", liters: 185, meterReading: 182310 },
    loadingPointName: null, productName: "Diésel", productUnit: "liter", supplyMediumName: null, importBatchFileName: null,
    alerts: [], previous: null, next: null, evidence: [], evidenceCount: 0, registeredByName: null, reviewedByName: null, driverName: null, supervisorName: null,
  } as unknown as TerrenoDetail
}

function planillaDetail(openCases: LoadOpenCase[], openRequest: OpenReviewRequest | null = null): PlanillaDetail {
  return {
    ...COMMON, origen: "planilla", id: "rec-1", openRequest, openCases,
    record: {
      fecha: "2026-10-10", horaCarga: "08:30", plate: "KPRT14", code: "CA-14", faenaNombre: "Faena Norte", tipo: null, marca: null, modelo: null, anio: null,
      horometro: 5000, medidoPor: "km", liters: 50, proveedorNombre: null, rendimiento: null, tipoRendimiento: null, createdAt: "2026-10-10T12:00:00.000Z",
    },
    costs: null, canViewPersonal: false, operador: null, supervisor: null, supplierName: null,
    batch: { id: "b-1", fileName: "consolidado.xlsx", importedAt: "2026-10-11T10:00:00.000Z", importedByName: null, status: "importado", periodoDesde: "2026-10-01", periodoHasta: "2026-10-31", totalFilas: 10, filasInvalidas: 0 },
    rawRow: [],
  }
}

function facturaDetail(openCases: LoadOpenCase[]): FacturaDetail {
  return {
    ...COMMON, origen: "factura", id: "inv-1", openRequest: null, openCases,
    load: { loadDate: "2026-10-08", liters: 120, odometerReading: 182000, hourMeterReading: null, status: "draft", receiptNumber: "B-1" },
    supplierName: "Copec", canViewCosts: false, createdByName: null,
  } as unknown as FacturaDetail
}

const NOTICE = /casos? abiertos? sobre esta carga/
const platformReview = () => screen.getByRole("region", { name: "Revisión de la plataforma" })

describe("casos abiertos en las tres fichas", () => {
  it("terreno: van en «Revisión de la plataforma», después del pedido de revisión", () => {
    render(<TerrenoLoadDetail detail={terrenoDetail(TWO_CASES, OPEN_REQUEST)} canTae={false} canReview={false} canAudit={false} canDecide={false} search={{ periodo: "2026-10" }} />)

    const section = platformReview()
    const notice = within(section).getByText("Hay 2 casos abiertos sobre esta carga")
    const request = within(section).getByText("Hay un pedido de revisión abierto")
    expect(request.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(section).getByRole("link", { name: "Sello repetido" })).toBeInTheDocument()
  })

  it("planilla: van en «Revisión de la plataforma»", () => {
    render(<PlanillaLoadDetail detail={planillaDetail([openCase()])} canOpenBatch={false} canAudit={false} canDecide={false} search={{}} />)

    expect(within(platformReview()).getByText("Hay 1 caso abierto sobre esta carga")).toBeInTheDocument()
  })

  it("factura: la sección «Revisión de la plataforma» aparece sólo cuando hay casos", () => {
    const { unmount } = render(<FacturaLoadDetail detail={facturaDetail(TWO_CASES)} canAudit={false} search={{}} form={<p>formulario de la factura</p>} />)

    expect(screen.getByRole("heading", { level: 2, name: "Revisión de la plataforma" })).toBeInTheDocument()
    expect(within(platformReview()).getByText("Hay 2 casos abiertos sobre esta carga")).toBeInTheDocument()
    unmount()

    render(<FacturaLoadDetail detail={facturaDetail([])} canAudit={false} search={{}} form={<p>formulario de la factura</p>} />)
    expect(screen.queryByRole("region", { name: "Revisión de la plataforma" })).toBeNull()
    expect(screen.queryByText(NOTICE)).toBeNull()
    expect(screen.getByText("formulario de la factura")).toBeInTheDocument()
  })

  it("sin casos no se pinta nada nuevo en terreno ni en planilla", () => {
    const { unmount } = render(<TerrenoLoadDetail detail={terrenoDetail([])} canTae={false} canReview={false} canAudit={false} canDecide={false} search={{}} />)
    expect(screen.queryByText(NOTICE)).toBeNull()
    expect(within(platformReview()).getByText("La plataforma todavía no revisa esta carga.")).toBeInTheDocument()
    unmount()

    render(<PlanillaLoadDetail detail={planillaDetail([])} canOpenBatch={false} canAudit={false} canDecide={false} search={{}} />)
    expect(screen.queryByText(NOTICE)).toBeNull()
  })
})
