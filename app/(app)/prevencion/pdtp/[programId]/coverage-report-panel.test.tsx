// @vitest-environment jsdom

/**
 * El panel agrupa la compuerta de cobertura en dos niveles: lo que frena el
 * ciclo de vida y lo que no. Lo que se fija acá es que el texto diga la verdad
 * para las CUATRO clasificaciones que no frenan, no sólo para las dos que
 * hablan de un instrumento: `decision_required` y `destination_review` caen en
 * el mismo bucket y no tienen curso, plantilla, plan ni mapa que crear.
 */

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { CoverageReportPanel } from "./coverage-report-panel"
import type { PdtpCoverageReport } from "@/lib/services/prevention-pdtp"

function report(groups: PdtpCoverageReport["groups"], total = 3, ready = 0): PdtpCoverageReport {
  return { total, ready, groups }
}

const sinPadron: PdtpCoverageReport["groups"][number] = {
  status: "decision_required",
  label: "Midiéndose por cobertura sin padrón declarado",
  blocks: false,
  issues: [{ n: 54, activity: "Evaluar exposición", status: "decision_required", reason: "Falta padrón manual en: Faena A." }],
}

const sinInstrumento: PdtpCoverageReport["groups"][number] = {
  status: "instrument_required",
  label: "Con instrumento declarado pero no vigente",
  blocks: false,
  issues: [{ n: 63, activity: "Inducción del trabajador", status: "instrument_required", reason: "Su curso no tiene versión publicada." }],
}

const sinMecanismo: PdtpCoverageReport["groups"][number] = {
  status: "code_gap",
  label: "Sin mecanismo de acreditación clasificado",
  blocks: true,
  issues: [{ n: 12, activity: "Actividad sin clasificar", status: "code_gap", reason: "Sin mecanismo de acreditación clasificado." }],
}

describe("CoverageReportPanel", () => {
  it("no describe como instrumento faltante a un grupo que no lo es", () => {
    render(<CoverageReportPanel report={report([sinPadron])} />)

    // El resumen del bucket no bloqueante tiene que valer para las cuatro
    // clasificaciones que contiene, no sólo para las dos de instrumento.
    expect(screen.queryByText(/curso, plantilla, plan o mapa/i)).toBeNull()
    expect(screen.getByText(/no acreditan cumplimiento/i)).toBeInTheDocument()
  })

  it("dice que el programa se firma y se activa igual con lo que no frena", () => {
    render(<CoverageReportPanel report={report([sinInstrumento])} />)

    expect(screen.getByText(/se firma y se activa igual/i)).toBeInTheDocument()
    expect(screen.getByText("N°63")).toBeInTheDocument()
  })

  it("separa lo que frena el ciclo de vida de lo que no", () => {
    render(<CoverageReportPanel report={report([sinMecanismo, sinInstrumento])} />)

    expect(screen.getByText(/frenan el envío a revisión y la activación/i)).toBeInTheDocument()
    expect(screen.getAllByText(/no frena; no acredita hasta resolverse/i)).toHaveLength(1)
  })

  it("no afirma que algo frena cuando no hay ningún grupo bloqueante", () => {
    render(<CoverageReportPanel report={report([sinInstrumento])} />)

    expect(screen.queryByText(/frenan el envío a revisión y la activación/i)).toBeNull()
    expect(screen.getByText(/declaran dónde se registra su cumplimiento/i)).toBeInTheDocument()
  })

  it("no se dibuja cuando el programa no tiene actividades activas", () => {
    const { container } = render(<CoverageReportPanel report={report([], 0, 0)} />)
    expect(container).toBeEmptyDOMElement()
  })
})
