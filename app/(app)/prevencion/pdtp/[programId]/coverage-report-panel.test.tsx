// @vitest-environment jsdom

/**
 * El panel agrupa la compuerta de cobertura en dos niveles: lo que frena el
 * ciclo de vida y lo que no. Lo que se fija acá es que el texto diga la verdad
 * para las CUATRO clasificaciones que no frenan, no sólo para las dos que
 * hablan de un instrumento: `decision_required` cae en el mismo bucket y no
 * tiene curso, plantilla, plan ni mapa que crear.
 */

import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CoverageReportPanel } from "./coverage-report-panel"
import type { PdtpCoverageReport } from "@/lib/services/prevention-pdtp"

// CreatePdtpRevisionButton (programa activo) usa useRouter; sin este mock,
// renderizarlo fuera de un app router monta y explota con "invariant expected
// app router to be mounted", igual que en create-pdtp-revision-button.test.tsx.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

function report(groups: PdtpCoverageReport["groups"], total = 3, ready = 0): PdtpCoverageReport {
  return { total, ready, groups }
}
const panelProps = { programId: "pdtp-test", programStatus: "draft", canManageProgram: true, canManageRoles: false }

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

// Formas tomadas de assertPdtpFulfillmentCoverage (lib/services/pdtp/fulfillment.ts
// ~1134-1157): "executor_required" cuando no hay ningún rol ejecutor asignado,
// "executor_permission_gap" cuando hay ejecutores pero ninguno tiene el permiso
// del destino. Las dos bloquean el ciclo de vida (BLOCKING_COVERAGE_LABELS en
// lib/services/pdtp/lifecycle.ts), a diferencia de decision_required/instrument_required.
const sinEjecutor: PdtpCoverageReport["groups"][number] = {
  status: "executor_required",
  label: "Sin ejecutor acreditador configurado",
  blocks: true,
  issues: [{
    n: 20,
    activity: "Charla de seguridad",
    status: "executor_required",
    reason: "Se acredita en Programa preventivo; falta asignar al menos un rol ejecutor para registrar ese hecho.",
    destinationModule: "pdtp",
    requiredPermission: "prevention:pdtp:execute",
    suggestedExecutorRoleIds: ["rol-prevencionista"],
  }],
}

// El mismo hueco de ejecutor pero con destino en otro módulo: fija que la
// línea "Destino: … · permiso para …" traduce código de módulo y permiso.
const sinEjecutorInspecciones: PdtpCoverageReport["groups"][number] = {
  status: "executor_required",
  label: "Sin ejecutor acreditador configurado",
  blocks: true,
  issues: [{
    n: 24,
    activity: "Inspección operacional",
    status: "executor_required",
    reason: "Falta asignar un rol ejecutor.",
    destinationModule: "inspecciones",
    requiredPermission: "prevention:inspections:execute",
  }],
}

const ejecutorSinPermiso: PdtpCoverageReport["groups"][number] = {
  status: "executor_permission_gap",
  label: "Con ejecutor sin permiso en el destino",
  blocks: true,
  issues: [{
    n: 21,
    activity: "Inducción de contratistas",
    status: "executor_permission_gap",
    reason: "Se acredita en Programa preventivo, pero ninguno de los ejecutores asignados puede registrar el hecho.",
    destinationModule: "pdtp",
    requiredPermission: "prevention:pdtp:execute",
    executorRoleLabels: ["Bodeguero"],
    suggestedExecutorRoleIds: ["rol-prevencionista"],
  }],
}

const flujoSegregado: PdtpCoverageReport["groups"][number] = {
  status: "segregated_valid",
  label: "Flujo segregado válido",
  blocks: false,
  issues: [{
    n: 83,
    activity: "Aprobar plan de emergencia",
    status: "segregated_valid",
    reason: "El responsable redacta; la firma es de otro.",
    destinationModule: "emergencias",
  }],
}

describe("CoverageReportPanel", () => {
  it("no describe como instrumento faltante a un grupo que no lo es", () => {
    render(<CoverageReportPanel report={report([sinPadron])} {...panelProps} />)

    // El resumen del bucket no bloqueante tiene que valer para las cuatro
    // clasificaciones que contiene, no sólo para las dos de instrumento.
    expect(screen.queryByText(/curso, plantilla, plan o mapa/i)).toBeNull()
    expect(screen.getAllByText(/no acreditan cumplimiento/i).length).toBeGreaterThan(0)
  })

  it("dice que el programa se firma y se activa igual con lo que no frena", () => {
    render(<CoverageReportPanel report={report([sinInstrumento])} {...panelProps} />)

    expect(screen.getByText(/no frenan el ciclo de vida/i)).toBeInTheDocument()
    expect(screen.getByText("N°63")).toBeInTheDocument()
  })

  it("separa lo que frena el ciclo de vida de lo que no", () => {
    render(<CoverageReportPanel report={report([sinMecanismo, sinInstrumento])} {...panelProps} />)

    expect(screen.getByText(/frenan el envío a revisión y la activación/i)).toBeInTheDocument()
    expect(screen.getAllByText(/no frena; no acredita hasta resolverse/i)).toHaveLength(1)
  })

  it("no afirma que algo frena y reconoce que lo pendiente aún no acredita", () => {
    render(<CoverageReportPanel report={report([sinInstrumento])} {...panelProps} />)

    expect(screen.queryByText(/frenan el envío a revisión y la activación/i)).toBeNull()
    expect(screen.getByText(/no hay bloqueos de destino o ejecutor/i)).toBeInTheDocument()
  })

  it("no se dibuja cuando el programa no tiene actividades activas", () => {
    const { container } = render(<CoverageReportPanel report={report([], 0, 0)} {...panelProps} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("P1(a): sin ejecutor asignado no dice el mensaje genérico y ofrece configurar en el borrador", () => {
    render(<CoverageReportPanel report={report([sinEjecutor])} {...panelProps} />)

    expect(screen.queryByText(/Todas las actividades activas tienen un destino y un ejecutor acreditador válido/i)).toBeNull()
    expect(screen.getByText(/no tienen un destino ejecutable o un ejecutor acreditador válido/i)).toBeInTheDocument()
    expect(screen.getByText("N°20")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Configurar ejecutores en el borrador" })).toBeInTheDocument()
  })

  // El panel ya no renderiza "Crear revisión": la salida a v+1 de un programa
  // activo la ofrece la cabecera del detalle (`showRevisionCta` en page.tsx),
  // que suma este caso —cobertura bloqueante— al alcance sin declarar y al
  // desvío de huella. Lo que se fija acá es que el panel deje de ofrecer el
  // atajo al borrador, que en un programa activo no lleva a ninguna parte.
  it("P1(a): en un programa activo no ofrece editar el borrador", () => {
    render(<CoverageReportPanel report={report([sinEjecutor])} {...panelProps} programStatus="active" />)

    expect(screen.queryByRole("link", { name: "Configurar ejecutores en el borrador" })).toBeNull()
    expect(screen.getByText("N°20")).toBeInTheDocument()
  })

  it("P1(a): ejecutor sin permiso ofrece administrar roles cuando el usuario puede hacerlo", () => {
    render(<CoverageReportPanel report={report([ejecutorSinPermiso])} {...panelProps} canManageRoles />)

    expect(screen.queryByText(/Todas las actividades activas tienen un destino y un ejecutor acreditador válido/i)).toBeNull()
    expect(screen.getByText("N°21")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Administrar roles" })).toBeInTheDocument()
  })

  it("P1(a): ejecutor sin permiso explica qué rol falta cuando el usuario no administra roles", () => {
    render(<CoverageReportPanel report={report([ejecutorSinPermiso])} {...panelProps} canManageRoles={false} />)

    expect(screen.queryByRole("link", { name: "Administrar roles" })).toBeNull()
    expect(screen.getByText(/Bodeguero/)).toBeInTheDocument()
    // El permiso aparece dos veces: en la línea "Destino: … · permiso para …"
    // y en la frase que dice qué rol lo necesita. Lo que importa es que la
    // explicación al usuario sin `admin:roles` nombre el permiso y a quién
    // pedírselo, no que el texto sea único en el panel.
    expect(screen.getAllByText(/registrar cumplimiento en PDTP/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/solicita el ajuste a quien administra roles/i)).toBeInTheDocument()
  })

  it("sólo ofrece configurar ejecutores cuando el programa sigue en borrador", () => {
    const draft = render(<CoverageReportPanel report={report([sinEjecutorInspecciones])} {...panelProps} />)
    expect(screen.getByRole("link", { name: "Configurar ejecutores en el borrador" })).toBeInTheDocument()
    expect(screen.getByText("Destino: Inspecciones · permiso para registrar inspecciones")).toBeInTheDocument()
    draft.unmount()

    render(
      <CoverageReportPanel
        report={report([sinEjecutorInspecciones])}
        {...panelProps}
        programStatus="in_review"
      />,
    )
    expect(screen.queryByRole("link", { name: "Configurar ejecutores en el borrador" })).toBeNull()
  })

  it("explica que un flujo segregado válido no requiere un ejecutor del programa", () => {
    render(<CoverageReportPanel report={report([flujoSegregado], 1, 1)} {...panelProps} />)

    expect(screen.getByText(/flujos segregados están cubiertos por contrato/i)).toBeInTheDocument()
    expect(screen.getByText(/válido; no requiere ejecutor del programa/i)).toBeInTheDocument()
    expect(screen.queryByText(/no acredita hasta resolverse/i)).toBeNull()
  })
})
