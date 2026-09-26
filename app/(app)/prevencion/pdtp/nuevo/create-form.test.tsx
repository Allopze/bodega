// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { PdtpCreateProgramForm } from "./create-form"

vi.mock("../actions", () => ({
  createPdtpProgramAction: vi.fn(async () => ({ ok: false, message: "" })),
}))

vi.mock("@/components/ui/submit-button", () => ({
  SubmitButton: ({ label, disabled }: { label: string; disabled?: boolean }) => (
    <button type="submit" disabled={disabled}>{label}</button>
  ),
}))

afterEach(() => cleanup())

const BASE = {
  version: 1,
  activityCount: 87,
  contentDigest: "sha256:base-2026",
}

const CANDIDATE_2026 = { year: 2026, programId: "pdtp-2026-v2", version: 2, status: "active", activityCount: 85 }

function hiddenValue(form: HTMLElement, name: string) {
  return (form.querySelector(`input[type="hidden"][name="${name}"]`) as HTMLInputElement | null)?.value
}

describe("PdtpCreateProgramForm", () => {
  it("preselecciona copiar la versión vigente del año anterior y envía el origen (PREV-C03.1)", () => {
    const { container } = render(<PdtpCreateProgramForm suggestedYear={2027} existingPrograms={[]} copyCandidates={[CANDIDATE_2026]} baseRevision={BASE} />)

    expect(screen.getByLabelText("Año del programa")).toHaveValue(2027)
    const copy = screen.getByRole("radio", { name: /Copiar el programa 2026 \(v2\)/ })
    expect(copy).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: /Base preventiva 2026/ })).toHaveAttribute("aria-checked", "false")
    expect(hiddenValue(container, "origin")).toBe("previous_program")
    expect(hiddenValue(container, "sourceProgramId")).toBe("pdtp-2026-v2")
    expect(screen.getByRole("button", { name: "Crear programa anual" })).toBeEnabled()
  })

  it("permite elegir la Base preventiva 2026 en vez de la copia", () => {
    const { container } = render(<PdtpCreateProgramForm suggestedYear={2027} existingPrograms={[]} copyCandidates={[CANDIDATE_2026]} baseRevision={BASE} />)
    fireEvent.click(screen.getByRole("radio", { name: /Base preventiva 2026/ }))
    expect(hiddenValue(container, "origin")).toBe("base")
    expect(hiddenValue(container, "sourceProgramId")).toBe("")
  })

  it("sin programa anterior, ofrece solo la Base", () => {
    const { container } = render(<PdtpCreateProgramForm suggestedYear={2027} existingPrograms={[]} copyCandidates={[]} baseRevision={BASE} />)
    expect(screen.queryByRole("radio", { name: /Copiar el programa/ })).toBeNull()
    expect(screen.getByRole("radio", { name: /Base preventiva 2026/ })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText(/Revisión 1 · 87 actividades/)).toBeDefined()
    expect(hiddenValue(container, "origin")).toBe("base")
  })

  it("el candidato se recalcula al cambiar el año: solo sirven años anteriores", () => {
    render(<PdtpCreateProgramForm
      suggestedYear={2027}
      existingPrograms={[]}
      copyCandidates={[CANDIDATE_2026, { year: 2025, programId: "pdtp-2025-v1", version: 1, status: "closed", activityCount: 80 }]}
      baseRevision={BASE}
    />)
    fireEvent.change(screen.getByLabelText("Año del programa"), { target: { value: "2026" } })
    expect(screen.getByRole("radio", { name: /Copiar el programa 2025 \(v1\)/ })).toHaveAttribute("aria-checked", "true")
  })

  it("si el año ya existe, lo dice, enlaza al existente y no ofrece crear otro", () => {
    render(<PdtpCreateProgramForm
      suggestedYear={2026}
      existingPrograms={[{ year: 2026, id: "pdtp-2026-v2", creationMode: "base_2026", status: "active", version: 2 }]}
      copyCandidates={[]}
      baseRevision={BASE}
    />)
    expect(screen.getByText(/El programa 2026 ya existe/)).toBeDefined()
    expect(screen.getByText(/creado desde la Base preventiva 2026/)).toBeDefined()
    expect(screen.getByRole("link", { name: "Abrir el programa 2026" })).toHaveAttribute("href", "/prevencion/pdtp/pdtp-2026-v2")
    expect(screen.queryByRole("button", { name: "Crear programa anual" })).toBeNull()
  })

  it("bloquea la creación si no hay programa anterior ni Base instalada", () => {
    render(<PdtpCreateProgramForm suggestedYear={2027} existingPrograms={[]} copyCandidates={[]} baseRevision={null} />)
    expect(screen.getByRole("alert")).toHaveTextContent("No hay desde dónde crear el programa 2027")
    expect(screen.getByRole("button", { name: "Crear programa anual" })).toBeDisabled()
  })
})
