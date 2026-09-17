// @vitest-environment jsdom

/**
 * Fase 0 (baseline): fija el render actual de `PdtpIndicatorsPanel` — cabecera
 * compacta siempre visible (integral + anual + meta) y desglose mensual/
 * trimestral dentro de un `<details>` colapsado por defecto — como línea base
 * antes de que Fase 6 (H-21) compacte controles y ajuste responsive/A11y.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { PdtpIndicatorsPanel } from "./pdtp-indicators-panel"
import type { PdtpComplianceIndicators, PdtpIntegralCompliance } from "@/lib/services/prevention-pdtp"

afterEach(cleanup)

const DATA: PdtpComplianceIndicators = {
  programId: "prog-1",
  year: 2026,
  target: 0.85,
  monthly: Array.from({ length: 12 }, (_, i) => {
    if (i === 0) return { month: 1, planned: 10, executed: 9, percent: 0.9, zeroActivities: 0, zeroActivityIds: [], declaredNotPerformed: 0 }
    // Febrero: dos actividades planificadas sin ninguna ejecución aprobada —
    // el caso que esta columna existe para exponer.
    if (i === 1) return { month: 2, planned: 10, executed: 0, percent: 0, zeroActivities: 2, zeroActivityIds: ["act-1", "act-2"], declaredNotPerformed: 1 }
    return { month: i + 1, planned: 0, executed: 0, percent: null, zeroActivities: 0, zeroActivityIds: [], declaredNotPerformed: 0 }
  }),
  quarterly: [
    { quarter: 1, planned: 20, executed: 9, percent: 0.45 },
    { quarter: 2, planned: 0, executed: 0, percent: null },
    { quarter: 3, planned: 0, executed: 0, percent: null },
    { quarter: 4, planned: 0, executed: 0, percent: null },
  ],
  annual: { planned: 20, executed: 9, percent: 0.45, zeroActivityMonths: 1, zeroActivityIds: ["act-1", "act-2"] },
  lastExecutionUpdatedAt: "2026-01-15T10:30:00.000Z",
  subjectRosterIssues: [],
}

const INTEGRAL: PdtpIntegralCompliance = {
  programId: "prog-1",
  year: 2026,
  integral: 62,
  ejecucion: 0.45,
  verificacion: 80,
  cierre: 50,
  pesos: { ejecucion: 0.5, verificacion: 0.3, cierre: 0.2 },
}

describe("PdtpIndicatorsPanel — render compacto actual", () => {
  it("separa el índice de gestión del cumplimiento anual basado en ejecuciones", () => {
    render(<PdtpIndicatorsPanel data={DATA} integral={INTEGRAL} />)

    expect(screen.getByText("Índice de gestión preventiva")).toBeInTheDocument()
    expect(screen.queryByText("Cumplimiento integral")).not.toBeInTheDocument()
    expect(screen.getByText("62%")).toBeInTheDocument()
    expect(screen.getByText(/Ejecución/).parentElement).toHaveTextContent("Ejecución 45%")
    expect(screen.getByText(/Verificación/).parentElement).toHaveTextContent("Verificación 80%")
    expect(screen.getByText(/Cierre/).parentElement).toHaveTextContent("Cierre 50%")

    const annualTile = screen.getByText("Cumplimiento anual").closest("div")!.parentElement!
    expect(annualTile).toHaveTextContent("45%")
    expect(annualTile).toHaveTextContent("9/20")

    const metaTile = screen.getByText("Meta anual").closest("div")!.parentElement!
    expect(metaTile).toHaveTextContent("85%")
  })

  it("renderiza sin el tile de integral cuando no se pasa la prop", () => {
    render(<PdtpIndicatorsPanel data={DATA} />)
    expect(screen.queryByText("Índice de gestión preventiva")).not.toBeInTheDocument()
  })

  it("el desglose mensual/trimestral vive en un <details> colapsado por defecto", () => {
    const { container } = render(<PdtpIndicatorsPanel data={DATA} integral={INTEGRAL} />)

    const details = container.querySelector("details")
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute("open")
    expect(screen.getByText("Ver desglose mensual y trimestral")).toBeInTheDocument()

    // El contenido del desglose (tabla mensual y tiles trimestrales) ya está
    // en el DOM aunque el <details> esté cerrado — no se monta on-demand.
    expect(within(details as HTMLElement).getByText("Trim. 1")).toBeInTheDocument()
    expect(within(details as HTMLElement).getByText("Ene")).toBeInTheDocument()
  })

  it("al abrir el <details> se ve el desglose trimestral y mensual con los valores actuales", () => {
    const { container } = render(<PdtpIndicatorsPanel data={DATA} integral={INTEGRAL} />)
    const details = container.querySelector("details") as HTMLDetailsElement
    const summary = screen.getByText("Ver desglose mensual y trimestral")

    fireEvent.click(summary)
    expect(details.open).toBe(true)

    // Trimestre 1: 9/20 -> 45%, resto sin datos.
    const q1Tile = within(details).getByText("Trim. 1").closest("div")!
    expect(q1Tile).toHaveTextContent("45%")

    // Fila de enero: 10 programado, 9 ejecutado, 90% (cumple meta -> icono check).
    const eneroRow = within(details).getByText("Ene").closest("tr")!
    expect(within(eneroRow).getByText("10")).toBeInTheDocument()
    expect(within(eneroRow).getByText("9")).toBeInTheDocument()
    expect(within(eneroRow).getByText("90%")).toBeInTheDocument()

    // Fila de febrero: 10 programado, 0 ejecutado, 0% (no cumple meta).
    const febRow = within(details).getByText("Feb").closest("tr")!
    expect(within(febRow).getByText("0%")).toBeInTheDocument()

    // Fila de marzo: sin datos -> "—".
    const marRow = within(details).getByText("Mar").closest("tr")!
    expect(within(marRow).getByText("—")).toBeInTheDocument()
  })

  it("muestra el corte temporal y la última ejecución aprobada, y enlaza el KPI anual a los registros", () => {
    render(<PdtpIndicatorsPanel data={DATA} integral={INTEGRAL} asOf="2026-02-01T09:00:00.000Z" />)

    expect(screen.getByText(/Datos al/)).toBeInTheDocument()
    expect(screen.getByText(/Última ejecución aprobada/)).toBeInTheDocument()

    const annualLink = screen.getByText("Cumplimiento anual").closest("a")!
    expect(annualLink).toHaveAttribute("href", "#registros-pdtp")
  })

  it("no muestra el corte temporal ni la última ejecución cuando no hay dato disponible", () => {
    const dataWithoutLastExecution: PdtpComplianceIndicators = { ...DATA, lastExecutionUpdatedAt: null }
    render(<PdtpIndicatorsPanel data={dataWithoutLastExecution} integral={INTEGRAL} />)

    expect(screen.queryByText(/Datos al/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Última ejecución aprobada/)).not.toBeInTheDocument()
  })

  it("cada fila mensual del desglose enlaza a los registros que la componen", () => {
    const { container } = render(<PdtpIndicatorsPanel data={DATA} integral={INTEGRAL} />)
    const details = container.querySelector("details") as HTMLDetailsElement
    const eneroLink = within(details).getByText("Ene").closest("a")!
    expect(eneroLink).toHaveAttribute("href", "#registros-pdtp")
  })

  it("muestra la columna 'En cero' con el conteo mensual y enlaza al visor de actividades ya filtrado", () => {
    const { container } = render(<PdtpIndicatorsPanel data={DATA} integral={INTEGRAL} worksiteId="ws-1" />)
    const details = container.querySelector("details") as HTMLDetailsElement

    const header = within(details).getByText("En cero")
    expect(header).toHaveAttribute(
      "title",
      "Actividades con planificación en el mes y ninguna ejecución aprobada. El % mensual puede llegar a 100 % por compensación entre actividades.",
    )

    // Febrero: 2 actividades en cero, enlazadas con el helper existente (no
    // una URL armada a mano) preservando programa, faena, mes y año. El
    // destino usa el filtro compuesto "en_cero" (pending ∪ overdue, sin
    // coverage/closed_on_time) y la vista anual — no "overdue" a secas, que
    // escondería el caso más común (pending sin mes anterior en cero), ni
    // "semana", que filtraría además por la semana de HOY.
    //
    // La URL se afirma literal (no reconstruida con `buildPdtpActivitiesHref`
    // en el propio test): así el test no depende de que el helper serialice
    // los parámetros de la misma forma que espera esta aserción — un test
    // complementario (`pdtp-sheet-table.test.tsx`, describe "filtro 'En
    // cero'") ya verifica el destino real (qué muestra el visor).
    const febRow = within(details).getByText("Feb").closest("tr")!
    const zeroLink = within(febRow).getByText("2").closest("a")!
    expect(zeroLink).toHaveAttribute(
      "href",
      "/prevencion/pdtp/actividades?programa=prog-1&faena=ws-1&vista=anual&anio=2026&estado=en_cero&mes=2",
    )

    // Enero no tiene actividades en cero: se muestra "0" sin enlace.
    const eneroRow = within(details).getByText("Ene").closest("tr")!
    expect(within(eneroRow).getByText("0")).toBeInTheDocument()
    expect(within(eneroRow).queryByText("0")?.closest("a")).toBeNull()

    // Marzo no tiene planificación (Prog./Ejec. también en "0"): la columna
    // "En cero" (5ª celda: Mes, Prog., Ejec., %, En cero, Meta) también
    // muestra "0", no un guion confuso como el de "%".
    const marRow = within(details).getByText("Mar").closest("tr")!
    const marCells = marRow.querySelectorAll("td")
    expect(marCells[4]).toHaveTextContent("0")
  })
})
