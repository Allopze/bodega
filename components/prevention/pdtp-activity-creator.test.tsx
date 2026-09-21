// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PdtpActivityCreator } from "./pdtp-activity-creator"

const { mockSave, mockRefresh, mockToastSuccess } = vi.hoisted(() => ({
  mockSave: vi.fn(),
  mockRefresh: vi.fn(),
  mockToastSuccess: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }))
vi.mock("@/app/(app)/prevencion/pdtp/actions", () => ({ savePdtpProgramActivityAction: mockSave }))
vi.mock("@/lib/toast", () => ({ toast: { success: mockToastSuccess } }))

const RESPONSIBLES = [{ slug: "prevencionista", displayName: "Equipo de Prevención" }]
const CATALOG = [{
  id: "catalog-test",
  code: "PDT-TEST-ACTIVITY",
  title: "Verificar controles preventivos",
  description: "Verificar controles antes de iniciar la tarea",
  executionGuidance: "Registrar controles y conservar evidencia",
  status: "active" as const,
  currentRevision: 1,
}]

beforeEach(() => {
  window.localStorage.clear()
  mockSave.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("PdtpActivityCreator", () => {
  it("incorpora una actividad existente con responsable y recurrencia desde un solo formulario", async () => {
    render(<PdtpActivityCreator
      fixedProgramId="program-2027"
      responsibleCatalog={RESPONSIBLES}
      catalogActivities={CATALOG}
    />)

    fireEvent.click(screen.getByRole("button", { name: "Seleccionar actividad" }))
    fireEvent.click(screen.getByRole("option", { name: /Verificar controles preventivos/ }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar actividad" }))

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({
      programId: "program-2027",
      source: { kind: "catalog", catalogActivityId: "catalog-test" },
      responsibleSlug: "prevencionista",
      scheduleMode: "scheduled",
      recurrenceRule: expect.objectContaining({ frequency: "monthly", plannedQuantity: 1 }),
    })))
    expect(mockRefresh).toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenCalledWith("Actividad creada e incorporada al programa.")
  })

  it("sugiere el código desde el título y deja de cambiarlo después de una edición manual", () => {
    render(<PdtpActivityCreator
      fixedProgramId="program-2027"
      initialSourceMode="new"
      responsibleCatalog={RESPONSIBLES}
      catalogActivities={CATALOG}
    />)

    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Revisar protección auditiva" } })
    fireEvent.click(screen.getByText("Detalles adicionales"))
    const code = screen.getByLabelText("Código estable") as HTMLInputElement
    expect(code.value).toBe("PDT-REVISAR-PROTECCION-AUDITIVA")

    fireEvent.change(code, { target: { value: "PDT-HIGIENE-RUIDO" } })
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Medir exposición a ruido" } })
    expect(code.value).toBe("PDT-HIGIENE-RUIDO")
  })

  it("exige elegir el programa cuando se usa desde Administración", async () => {
    render(<PdtpActivityCreator
      programs={[{ id: "program-2028", title: "Programa 2028", year: 2028, version: 1 }]}
      initialSourceMode="new"
      responsibleCatalog={RESPONSIBLES}
      catalogActivities={CATALOG}
    />)

    fireEvent.click(screen.getByLabelText("Programa anual"))
    fireEvent.click(screen.getByRole("option", { name: /Programa 2028/ }))
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Inspeccionar zonas de tránsito" } })
    fireEvent.change(screen.getByLabelText("Descripción de la actividad"), { target: { value: "Revisar las zonas de tránsito peatonal" } })
    fireEvent.change(screen.getByLabelText("Guía de ejecución"), { target: { value: "Registrar hallazgos y evidencia" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar actividad" }))

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({
      programId: "program-2028",
      source: expect.objectContaining({ kind: "new", code: "PDT-INSPECCIONAR-ZONAS-DE-TRANSITO" }),
    })))
  })

  it("restaura el borrador del programa y lo elimina después de guardar", async () => {
    const first = render(<PdtpActivityCreator
      fixedProgramId="program-draft"
      initialSourceMode="new"
      responsibleCatalog={RESPONSIBLES}
      catalogActivities={CATALOG}
    />)
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Revisar un borrador persistente" } })
    fireEvent.change(screen.getByLabelText("Descripción de la actividad"), { target: { value: "Descripción persistente" } })
    fireEvent.change(screen.getByLabelText("Guía de ejecución"), { target: { value: "Guía persistente" } })
    await waitFor(() => expect(window.localStorage.getItem("pdtp-activity-creator:program-draft")).toContain("Revisar un borrador persistente"))
    first.unmount()

    render(<PdtpActivityCreator
      fixedProgramId="program-draft"
      initialSourceMode="new"
      responsibleCatalog={RESPONSIBLES}
      catalogActivities={CATALOG}
    />)
    await waitFor(() => expect(screen.getByLabelText("Título")).toHaveValue("Revisar un borrador persistente"))
    fireEvent.click(screen.getByRole("button", { name: "Guardar actividad" }))

    await waitFor(() => expect(mockSave).toHaveBeenCalled())
    expect(screen.getByLabelText("Título")).toHaveValue("")
    expect(window.localStorage.getItem("pdtp-activity-creator:program-draft")).toBeNull()
  })
})
