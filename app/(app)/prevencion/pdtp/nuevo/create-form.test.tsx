// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ComponentPropsWithoutRef } from "react"
import { PdtpCreateProgramForm } from "./create-form"
import { toast } from "@/lib/toast"

// ── Mocks ───────────────────────────────────────────────────────────────────

const { mockRouter } = vi.hoisted(() => ({
  mockRouter: { back: vi.fn(), refresh: vi.fn(), push: vi.fn() },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}))

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentPropsWithoutRef<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("../actions", () => ({
  createPdtpProgramAction: vi.fn(async () => ({ ok: false, message: "" })),
}))

vi.mock("@/components/admin/submit-button", () => ({
  SubmitButton: ({ label, loadingLabel }: { label: string; loadingLabel?: string }) => (
    <button type="submit" data-loading-label={loadingLabel}>{label}</button>
  ),
}))

// ── Helpers ─────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear()

function makePrograms(): Parameters<typeof PdtpCreateProgramForm>["0"]["existingPrograms"] {
  return [
    {
      id: "prog-2025",
      title: "Programa Faenas 2025",
      year: CURRENT_YEAR - 1,
      version: 3,
      status: "closed",
      compliancePercent: 92,
      activityCount: 120,
    },
    {
      id: "prog-2026",
      title: "Programa General 2026",
      year: CURRENT_YEAR,
      version: 1,
      status: "active",
      compliancePercent: 75,
      activityCount: 89,
    },
  ]
}

function renderForm(props: Partial<Parameters<typeof PdtpCreateProgramForm>[0]> = {}) {
  return render(
    <PdtpCreateProgramForm
      userId="user-1"
      existingPrograms={makePrograms()}
      suggestedYear={CURRENT_YEAR}
      hasActiveProgram={false}
      {...props}
    />,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe("PdtpCreateProgramForm", () => {
  describe("D: Stepper timeline", () => {
    it("renderiza el stepper con 4 pasos y el paso 1 activo", () => {
      renderForm()
      expect(screen.getByText("Crear")).toBeDefined()
      expect(screen.getByText("Editar actividades")).toBeDefined()
      expect(screen.getByText("Aprobar")).toBeDefined()
      expect(screen.getByText("Activar")).toBeDefined()
      expect(screen.getByText(/Paso 1/)).toBeDefined()
    })
  })

  describe("A: Year picker visual", () => {
    it("renderiza pills para CURRENT_YEAR - 1, CURRENT_YEAR y CURRENT_YEAR + 1", () => {
      renderForm()
      // The accessible name of each pill is the concatenation of its children
      // (e.g. "2025Pasado"), so query by visible text instead of role name
      expect(screen.getByText(String(CURRENT_YEAR - 1))).toBeDefined()
      expect(screen.getByText(String(CURRENT_YEAR))).toBeDefined()
      expect(screen.getByText(String(CURRENT_YEAR + 1))).toBeDefined()
    })

    it("selecciona el suggestedYear por defecto", () => {
      renderForm({ suggestedYear: CURRENT_YEAR })
      const yearGroup = screen.getByRole("radiogroup", { name: "Seleccionar año" })
      const checkedPill = within(yearGroup).getByRole("radio", { checked: true })
      expect(checkedPill.textContent).toContain(String(CURRENT_YEAR))
    })

    it("cambia la selección al hacer click en otro año", () => {
      renderForm({ suggestedYear: CURRENT_YEAR })
      const yearGroup = screen.getByRole("radiogroup", { name: "Seleccionar año" })
      const prevYearPill = within(yearGroup).getByText(String(CURRENT_YEAR - 1)).closest("[role='radio']")!
      fireEvent.click(prevYearPill)
      const checkedPill = within(yearGroup).getByRole("radio", { checked: true })
      expect(checkedPill.textContent).toContain(String(CURRENT_YEAR - 1))
    })

    it("muestra 'Sugerido' cuando suggestedYear > CURRENT_YEAR", () => {
      renderForm({ suggestedYear: CURRENT_YEAR + 1, hasActiveProgram: true })
      expect(screen.getByText("Sugerido")).toBeDefined()
    })

    it("muestra 'Otro año…' que habilita input personalizado", () => {
      renderForm()
      fireEvent.click(screen.getByText("Otro año…"))
      // The custom year input has role="spinbutton" with aria-label
      expect(screen.getByRole("spinbutton", { name: "Año personalizado" })).toBeDefined()
    })

    it("el input personalizado permite cambiar el año", () => {
      renderForm()
      fireEvent.click(screen.getByText("Otro año…"))
      const customInput = screen.getByRole("spinbutton", { name: "Año personalizado" }) as HTMLInputElement
      fireEvent.change(customInput, { target: { value: "2027" } })
      expect(customInput.value).toBe("2027")
    })
  })

  describe("B: Auto-title", () => {
    it("genera título automáticamente cuando el año cambia y no se ha editado", () => {
      renderForm({ suggestedYear: CURRENT_YEAR })
      const titleInput = screen.getByRole("textbox", { name: "Título del programa" }) as HTMLInputElement
      expect(titleInput.value).toContain(String(CURRENT_YEAR))

      const yearGroup = screen.getByRole("radiogroup", { name: "Seleccionar año" })
      const prevYearPill = within(yearGroup).getByText(String(CURRENT_YEAR - 1)).closest("[role='radio']")!
      fireEvent.click(prevYearPill)
      expect(titleInput.value).toContain(String(CURRENT_YEAR - 1))
    })

    it("no sobreescribe el título si el usuario lo editó manualmente", () => {
      renderForm({ suggestedYear: CURRENT_YEAR })
      const titleInput = screen.getByRole("textbox", { name: "Título del programa" }) as HTMLInputElement
      fireEvent.change(titleInput, { target: { value: "Mi Programa Personalizado" } })
      expect(titleInput.value).toBe("Mi Programa Personalizado")

      const yearGroup = screen.getByRole("radiogroup", { name: "Seleccionar año" })
      const nextYearPill = within(yearGroup).getByText(String(CURRENT_YEAR + 1)).closest("[role='radio']")!
      fireEvent.click(nextYearPill)
      expect(titleInput.value).toBe("Mi Programa Personalizado")
    })

    it("resetea el flag de edición si el usuario vacía el campo", () => {
      renderForm({ suggestedYear: CURRENT_YEAR })
      const titleInput = screen.getByRole("textbox", { name: "Título del programa" }) as HTMLInputElement

      fireEvent.change(titleInput, { target: { value: "Manual" } })
      expect(titleInput.value).toBe("Manual")

      // Vaciar el campo → resetea el flag de edición manual
      fireEvent.change(titleInput, { target: { value: "" } })
      expect(titleInput.value).toBe(`Programa de Trabajo Preventivo SG-SST ${CURRENT_YEAR}`)
    })
  })

  describe("C: Visual source selector", () => {
    it("renderiza la opción 'Programa vacío'", () => {
      renderForm()
      expect(screen.getByText("Programa vacío")).toBeDefined()
      const matches = screen.getAllByText(/una vista general/)
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })

    it("renderiza cards de programas existentes con título, año, actividades y compliance", () => {
      renderForm()
      expect(screen.getByText("Programa Faenas 2025")).toBeDefined()
      expect(screen.getByText("Programa General 2026")).toBeDefined()
      expect(screen.getByText("92% cumplimiento")).toBeDefined()
      expect(screen.getByText("75% cumplimiento")).toBeDefined()
      expect(screen.getByText("120 actividades")).toBeDefined()
      expect(screen.getByText("89 actividades")).toBeDefined()
    })

    it("muestra badge de estado 'Activo' para programa activo", () => {
      renderForm()
      const activeBadge = screen.getByText("Activo")
      expect(activeBadge).toBeDefined()
    })

    it("selecciona un programa al hacer click en su card", () => {
      renderForm()
      const sourceGroup = screen.getByRole("radiogroup", { name: "Programas existentes" })
      const sourceButton = within(sourceGroup).getByText("Programa Faenas 2025").closest("[role='radio']")!
      fireEvent.click(sourceButton)

      const checked = within(sourceGroup).getByRole("radio", { checked: true })
      expect(checked.textContent).toContain("2025")
    })

    it("muestra el botón 'No duplicar' cuando hay una selección activa", () => {
      renderForm()
      const sourceGroup = screen.getByRole("radiogroup", { name: "Programas existentes" })
      const sourceButton = within(sourceGroup).getByText("Programa Faenas 2025").closest("[role='radio']")!
      fireEvent.click(sourceButton)
      expect(screen.getByText("No duplicar")).toBeDefined()

      fireEvent.click(screen.getByText("No duplicar"))
      expect(screen.getByText("Programa vacío")).toBeDefined()
    })

    it("permite partir desde una versión publicada de plantilla sin seleccionar un programa vivo", () => {
      const { container } = renderForm({
        templates: [{
          id: "template-1",
          name: "Programa preventivo base",
          description: "Objetivos y reglas corporativas",
          versionId: "template-1-v3",
          version: 3,
        }],
      })

      fireEvent.click(screen.getByText("Programa preventivo base"))

      expect((container.querySelector('input[name="templateVersionId"]') as HTMLInputElement).value).toBe("template-1-v3")
      expect((container.querySelector('input[name="copySheetsFromProgramId"]') as HTMLInputElement).value).toBe("")
      expect(screen.getByText(/versión inmutable/)).toBeDefined()
    })
  })

  describe("Hidden inputs", () => {
    it("incluye hidden input para userId", () => {
      const { container } = renderForm({ userId: "custom-user" })
      const userInput = container.querySelector('input[name="userId"]') as HTMLInputElement
      expect(userInput?.value).toBe("custom-user")
    })

    it("incluye hidden input para year", () => {
      const { container } = renderForm()
      const yearInput = container.querySelector('input[name="year"]') as HTMLInputElement
      expect(yearInput).toBeDefined()
      expect(yearInput?.value).toBe(String(CURRENT_YEAR))
    })
  })

  describe("Buttons", () => {
    it("renderiza botón Cancelar", () => {
      renderForm()
      expect(screen.getByText("Cancelar")).toBeDefined()
    })

    it("renderiza botón Crear programa", () => {
      renderForm()
      expect(screen.getByText("Crear programa")).toBeDefined()
    })

    it("renderiza texto contextual en el footer", () => {
      renderForm()
      const matches = screen.getAllByText(/una vista general/)
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })

    it("actualiza texto contextual cuando se selecciona un programa fuente", () => {
      renderForm()
      const sourceGroup = screen.getByRole("radiogroup", { name: "Programas existentes" })
      const sourceButton = within(sourceGroup).getByText("Programa Faenas 2025").closest("[role='radio']")!
      fireEvent.click(sourceButton)
      expect(screen.getByText(/Se duplicarán actividades/)).toBeDefined()
    })
  })

  describe("Custom year edge case", () => {
    it("customYear se activa correctamente y se puede desactivar seleccionando un año predefinido", () => {
      renderForm()
      fireEvent.click(screen.getByText("Otro año…"))
      expect(screen.getByRole("spinbutton", { name: "Año personalizado" })).toBeDefined()

      const currentYearPill = screen.getByText(String(CURRENT_YEAR)).closest("[role='radio']")!
      expect(currentYearPill).toHaveAttribute("aria-checked", "false")
    })
  })

  describe("Empty state (no existing programs)", () => {
    it("no renderiza la sección de origen si no hay programas existentes", () => {
      render(
        <PdtpCreateProgramForm
          userId="user-1"
          existingPrograms={[]}
        />,
      )
      expect(screen.queryByText("Partir desde un programa existente")).toBeNull()
      expect(screen.queryByText("Programa vacío")).toBeNull()
    })
  })

  describe("Error and success feedback", () => {
    it("no renderiza mensajes de estado inicialmente", () => {
      const { container } = renderForm()
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(container.querySelector('[role="status"]')).toBeNull()
    })
  })

  describe("Accessibility", () => {
    it("los años tienen role radio y aria-checked", () => {
      renderForm()
      const yearGroup = screen.getByRole("radiogroup", { name: "Seleccionar año" })
      expect(yearGroup).toBeDefined()
      const radios = within(yearGroup).getAllByRole("radio")
      expect(radios.length).toBeGreaterThanOrEqual(3)
    })

    it("el grupo de programas fuente tiene role radiogroup", () => {
      renderForm()
      const sourceGroup = screen.getByRole("radiogroup", { name: "Programas existentes" })
      expect(sourceGroup).toBeDefined()
    })
  })

  describe("F: Snapshot", () => {
    it("coincide con el snapshot del estado por defecto (con programas existentes)", () => {
      const { container } = renderForm({ suggestedYear: CURRENT_YEAR })
      expect(container.firstChild).toMatchSnapshot()
    })

    it("coincide con el snapshot del estado vacío (sin programas existentes)", () => {
      const { container } = render(
        <PdtpCreateProgramForm
          userId="user-1"
          existingPrograms={[]}
        />,
      )
      expect(container.firstChild).toMatchSnapshot()
    })

    it("coincide con el snapshot con suggestedYear > CURRENT_YEAR", () => {
      const { container } = renderForm({
        suggestedYear: CURRENT_YEAR + 1,
        hasActiveProgram: true,
      })
      expect(container.firstChild).toMatchSnapshot()
    })

    it("coincide con el snapshot con año personalizado activo", () => {
      const { container } = renderForm()
      fireEvent.click(screen.getByText("Otro año…"))
      expect(container.firstChild).toMatchSnapshot()
    })
  })

  describe("E: Form submission", () => {
    it("submit: llama a la action con el FormData correcto", async () => {
      // El redirect al editor ahora ocurre server-side (redirect() dentro de
      // createPdtpProgramAction, no un router.push cliente tras useActionState)
      // para evitar la carrera con revalidatePath — ver AUDITORIA_INTEGRAL_CHOME.md
      // Pasada 8/9. Ese redirect no es observable desde este test de componente,
      // que mockea la action entera; sólo se verifica el FormData enviado.
      const mockAction = vi.mocked(
        (await import("../actions")).createPdtpProgramAction,
      )
      mockAction.mockResolvedValueOnce({ ok: true, programId: "prog-new-123" })

      renderForm({ suggestedYear: CURRENT_YEAR })

      // Submit the form programmatically
      const form = document.querySelector("form")!
      await act(async () => {
        fireEvent.submit(form)
      })

      await waitFor(() => {
        expect(mockAction).toHaveBeenCalled()
      })
      const formData = mockAction.mock.calls[0]![1] as FormData
      expect(formData.get("year")).toBe(String(CURRENT_YEAR))
      expect(formData.get("title")).toBe(
        `Programa de Trabajo Preventivo SG-SST ${CURRENT_YEAR}`,
      )
      expect(formData.get("userId")).toBe("user-1")
      expect(formData.get("copySheetsFromProgramId")).toBe("")
    })

    it("submit exitoso: envía copySheetsFromProgramId al copiar de un programa", async () => {
      const mockAction = vi.mocked(
        (await import("../actions")).createPdtpProgramAction,
      )
      mockAction.mockResolvedValueOnce({ ok: true, programId: "prog-copy-456" })

      renderForm({ suggestedYear: CURRENT_YEAR })

      // Seleccionar un programa fuente (wrapped en act para flush state)
      const sourceGroup = screen.getByRole("radiogroup", { name: "Programas existentes" })
      const sourceButton = within(sourceGroup)
        .getByText("Programa Faenas 2025")
        .closest("[role='radio']")!
      await act(async () => {
        fireEvent.click(sourceButton)
      })

      // Submit
      const form = document.querySelector("form")!
      await act(async () => {
        fireEvent.submit(form)
      })

      await waitFor(() => {
        expect(mockAction).toHaveBeenCalled()
      })
      const formData = mockAction.mock.calls[0]![1] as FormData
      expect(formData.get("copySheetsFromProgramId")).toBe("prog-2025")
    })

    it("submit fallido: muestra error en pantalla y no redirige ni muestra toast", async () => {
      const mockAction = vi.mocked(
        (await import("../actions")).createPdtpProgramAction,
      )
      mockAction.mockResolvedValueOnce({
        ok: false,
        message: "El año ya tiene un programa activo.",
      })

      renderForm({ suggestedYear: CURRENT_YEAR })

      const form = document.querySelector("form")!
      await act(async () => {
        fireEvent.submit(form)
      })

      // Mensaje de error visible
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "El año ya tiene un programa activo.",
        )
      })

      // Sin toast ni redirección
      expect(toast.success).not.toHaveBeenCalled()
      expect(mockRouter.push).not.toHaveBeenCalled()
    })
  })
})
