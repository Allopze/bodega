// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { PdtpCoverageReport } from "@/lib/services/prevention-pdtp"
import { CoverageSummaryCard } from "./coverage-summary-card"

function issue(n: number, status: PdtpCoverageReport["groups"][number]["status"]) {
  return { activityId: `act-${n}`, n, activity: `Actividad ${n}`, status, reason: "motivo" }
}

function report(over: Partial<PdtpCoverageReport> = {}): PdtpCoverageReport {
  return { total: 81, ready: 67, groups: [], ...over }
}

afterEach(cleanup)

describe("CoverageSummaryCard", () => {
  it("sin actividades activas no se pinta: la página ya tiene su estado vacío", () => {
    const { container } = render(<CoverageSummaryCard report={report({ total: 0, ready: 0 })} programId="p-1" />)
    expect(container.firstChild).toBeNull()
  })

  it("la métrica se lee como número, no como fracción en monoespaciada", () => {
    // Antes era `67/81 listas` en `font-mono text-xs`, alineado a la derecha a
    // un ancho de pantalla del título. En este repo `font-mono` es para código.
    render(<CoverageSummaryCard
      report={report({ groups: [{ status: "instrument_required", blocks: false, issues: [issue(24, "instrument_required")] }] })}
      programId="p-1"
    />)
    expect(screen.getByText("67")).toBeDefined()
    expect(screen.getByText(/de 81 actividades del programa/)).toBeDefined()
    expect(screen.queryByText("67/81 listas")).toBeNull()
  })

  it("la barra anuncia el avance con su escala real, no en porcentaje", () => {
    render(<CoverageSummaryCard
      report={report({ groups: [{ status: "code_gap", blocks: true, issues: [issue(12, "code_gap")] }] })}
      programId="p-1"
    />)
    const bar = screen.getByRole("progressbar")
    expect(bar.getAttribute("aria-label")).toBe("67 de 81 actividades listas para ejecutar")
    expect(bar.getAttribute("aria-valuemax")).toBe("81")
    expect(bar.getAttribute("aria-valuenow")).toBe("67")
  })

  it("el CTA lleva a la bandeja de este programa", () => {
    render(<CoverageSummaryCard
      report={report({ groups: [{ status: "instrument_required", blocks: false, issues: [issue(24, "instrument_required")] }] })}
      programId="pdtp-2026"
    />)
    expect(screen.getByRole("link", { name: /Resolver lo que falta/ }).getAttribute("href"))
      .toBe("/prevencion/pdtp/pdtp-2026/habilitacion")
  })

  it("sólo se desglosan los buckets que traen algo", () => {
    render(<CoverageSummaryCard
      report={report({
        groups: [
          { status: "code_gap", blocks: true, issues: [issue(12, "code_gap"), issue(13, "code_gap")] },
          { status: "segregated_valid", blocks: false, issues: [issue(83, "segregated_valid")] },
        ],
      })}
      programId="p-1"
    />)
    expect(screen.getByText(/frenan la firma del programa/)).toBeDefined()
    expect(screen.getByText(/las acredita un tercero/)).toBeDefined()
    // Nada pendiente no bloqueante: no se pinta un "0 no acreditan todavía".
    expect(screen.queryByText(/no acreditan todav/)).toBeNull()
  })

  it("sin nada que resolver colapsa a una línea, sin barra ni CTA", () => {
    // Una tarjeta verde con barra llena y un botón que no lleva a ningún
    // trabajo es ruido en una página que ya apila seis secciones.
    render(<CoverageSummaryCard
      report={report({
        total: 81, ready: 81,
        groups: [{ status: "segregated_valid", blocks: false, issues: [issue(83, "segregated_valid")] }],
      })}
      programId="p-1"
    />)
    expect(screen.getByText(/Las 81 actividades tienen dónde ejecutarse/)).toBeDefined()
    expect(screen.queryByRole("progressbar")).toBeNull()
    expect(screen.queryByRole("link")).toBeNull()
  })
})
