// @vitest-environment jsdom
/**
 * Reflow 2026-09-27 ("Remaining findings"): a 1024 px los cuatro botones de
 * página de Catálogos PDTP ("Publicar y agregar", "Nueva identidad de
 * catálogo", "Nuevo responsable", "Nueva hoja") se apilaban en cuatro filas y
 * el TopBar crecía a ~150 px. AGENTS.md (layout 5 / densidad A3): varios flujos
 * de alta = UN botón en `PageHeader.actions` que pregunta QUÉ crear.
 *
 * Antes de la corrección fallaban: había cuatro botones y ningún diálogo.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { PdtpActions } from "./pdtp-actions"

vi.mock("./responsible-form", () => ({
  ResponsibleForm: ({ open }: { open: boolean }) => (open ? <div data-testid="form-responsable" /> : null),
}))
vi.mock("./sheet-form", () => ({
  SheetForm: ({ open }: { open: boolean }) => (open ? <div data-testid="form-hoja" /> : null),
}))
vi.mock("./activity-form", () => ({
  ActivityForm: ({ open }: { open: boolean }) => (open ? <div data-testid="form-identidad" /> : null),
}))
vi.mock("@/components/prevention/pdtp-activity-creator", () => ({
  PdtpActivityCreator: () => <div data-testid="form-publicar" />,
}))

afterEach(() => cleanup())

const DRAFT = { id: "p-2027", year: 2027, version: 1, status: "draft", title: "PDTP 2027" }
const ACTIVE = { id: "p-2026", year: 2026, version: 1, status: "active", title: "PDTP 2026" }

function renderActions(props: { canManagePrograms: boolean; programs: typeof DRAFT[] }) {
  return render(
    <PdtpActions
      programs={props.programs}
      roleOptions={["prevencionista"]}
      responsibleCatalog={[]}
      catalogActivities={[]}
      canManagePrograms={props.canManagePrograms}
    />,
  )
}

function openChooser() {
  fireEvent.click(screen.getByRole("button", { name: "Nuevo" }))
  return screen.getByRole("dialog", { name: "¿Qué quieres crear?" })
}

describe("PdtpActions — un solo punto de entrada para crear", () => {
  it("renderiza UN botón de página, no cuatro", () => {
    renderActions({ canManagePrograms: true, programs: [DRAFT] })
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Nuevo" })).toHaveAttribute("aria-haspopup", "dialog")
    for (const old of ["Publicar y agregar", "Nueva identidad de catálogo", "Nuevo responsable", "Nueva hoja"]) {
      expect(screen.queryByRole("button", { name: old })).toBeNull()
    }
  })

  it("el diálogo, rotulado, ofrece las cuatro opciones con permiso y programa en borrador", () => {
    renderActions({ canManagePrograms: true, programs: [DRAFT, ACTIVE] })
    const dialog = openChooser()
    const options = within(dialog).getAllByRole("button").filter((button) => button.dataset.choice)
    expect(options.map((button) => button.dataset.choice)).toEqual(["publicar", "identidad", "responsable", "hoja"])
    // Son <button> nativos: alcanzables con Tab y activables con Enter/Espacio.
    for (const option of options) expect(option.tagName).toBe("BUTTON")
  })

  it("sin permiso de programas no ofrece 'Publicar y agregar'", () => {
    renderActions({ canManagePrograms: false, programs: [DRAFT] })
    const dialog = openChooser()
    expect(within(dialog).queryByRole("button", { name: /Publicar y agregar/ })).toBeNull()
    expect(within(dialog).getByRole("button", { name: /Identidad de catálogo/ })).toBeInTheDocument()
  })

  it("sin programas en borrador tampoco lo ofrece, aunque haya permiso", () => {
    renderActions({ canManagePrograms: true, programs: [ACTIVE] })
    const dialog = openChooser()
    expect(within(dialog).queryByRole("button", { name: /Publicar y agregar/ })).toBeNull()
  })

  it.each([
    [/Publicar y agregar/, "form-publicar"],
    [/Identidad de catálogo/, "form-identidad"],
    [/Responsable/, "form-responsable"],
    [/Hoja de programa/, "form-hoja"],
  ])("elegir %s cierra el selector y abre el formulario existente", (name, testId) => {
    renderActions({ canManagePrograms: true, programs: [DRAFT] })
    const dialog = openChooser()
    fireEvent.click(within(dialog).getByRole("button", { name }))
    expect(screen.queryByRole("dialog", { name: "¿Qué quieres crear?" })).toBeNull()
    expect(screen.getByTestId(testId)).toBeInTheDocument()
  })
})
