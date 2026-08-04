// @vitest-environment jsdom
/**
 * Fase 1 — creador de checklists PDTP (`checklist-tab.tsx`).
 *
 * F1:  sin plantilla, el editor abre en modo visual con un esqueleto mínimo
 *      (no en el textarea JSON) y "Guardar" queda deshabilitado hasta tener
 *      ≥1 sección con ≥1 ítem, explicando qué falta.
 * F2+F10: borrar una sección exige confirmación y, tras confirmar, el foco
 *      vuelve al botón "Agregar sección".
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ChecklistTab } from "./checklist-tab"
import type { PdtpChecklistTemplate } from "@/lib/services/prevention-pdtp"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock("../../actions/checklist-actions", () => ({
  savePdtpChecklistTemplateAction: vi.fn(async () => ({ ok: true })),
  ensureDefaultPdtpChecklistAction: vi.fn(async () => ({ ok: true })),
  deletePdtpChecklistTemplateAction: vi.fn(async () => ({ ok: true })),
}))

const ACTIVITY = {
  id: "act-1",
  n: 24,
  activity: "Inspección de Estado de Extintores",
} as unknown as React.ComponentProps<typeof ChecklistTab>["activities"][number]

const ACTIVITY_2 = {
  id: "act-2",
  n: 25,
  activity: "Inspección de Taller",
} as unknown as React.ComponentProps<typeof ChecklistTab>["activities"][number]

const TEMPLATE_OTRA: PdtpChecklistTemplate = {
  id: "cl-act-2",
  activityId: "act-2",
  programId: "prog-1",
  label: "Checklist Taller",
  version: "03",
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  definitionJson: {},
  definition: {
    code: "pdtp_act-2",
    version: "03",
    revisionDate: "2026-01-01",
    title: "Inspección de Taller",
    tipo: "nuevo",
    legalFramework: ["DS 44"],
    applicableTo: "",
    sections: [
      {
        id: "s-taller",
        title: "Estado del taller",
        items: [{ id: "i-taller", label: "Orden y limpieza", kind: "cumple_nocumple_obs" }],
      },
    ],
    closingAct: { title: "Cierre", resultOptions: [{ value: "conforme", label: "Conforme" }], signatureRoles: [] },
  },
}

function renderTab(checklists: React.ComponentProps<typeof ChecklistTab>["checklists"] = []) {
  render(<ChecklistTab programId="prog-1" activities={[ACTIVITY]} checklists={checklists} />)
  fireEvent.click(screen.getByText("Definir checklist"))
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("ChecklistTab — Fase 1", () => {
  it("sin plantilla abre el editor visual por defecto, no el textarea JSON", () => {
    renderTab()
    expect(screen.getByRole("button", { name: /Agregar sección/ })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Definición \(JSON/)).toBeNull()
    expect(screen.getByText("Sin secciones. Agrega al menos una.")).toBeInTheDocument()
  })

  it("deshabilita Guardar hasta que exista una sección con al menos un ítem", () => {
    renderTab()
    const save = screen.getByRole("button", { name: "Guardar plantilla" })
    expect(save).toBeDisabled()
    expect(screen.getByText(/Agrega al menos una sección/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Agregar sección/ }))
    // Sección sin ítems: sigue inválido y el mensaje lo señala.
    expect(save).toBeDisabled()
    expect(screen.getByText(/debe tener al menos un ítem/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Agregar ítem/ }))
    expect(save).toBeEnabled()
  })

  it("exige confirmación para borrar una sección y reenfoca el botón Agregar sección", async () => {
    renderTab()
    fireEvent.click(screen.getByRole("button", { name: /Agregar sección/ }))
    fireEvent.click(screen.getByRole("button", { name: "Eliminar sección" }))

    // El diálogo pide confirmar y la sección sigue existiendo.
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }))
    expect(screen.getByText("Sin secciones. Agrega al menos una.")).toBeInTheDocument()
    // El refocus es deferido (setTimeout 0) para correr después del focus-restore
    // de Radix Dialog, así que hay que esperar un tick.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: /Agregar sección/ }))
    })
  })
})

describe("ChecklistTab — Fase 2", () => {
  it("muestra 'Cambios sin guardar' al editar y lo oculta tras guardar", async () => {
    renderTab()
    expect(screen.queryByText("Cambios sin guardar")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /Agregar sección/ }))
    expect(screen.getByText("Cambios sin guardar")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Agregar ítem/ }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar plantilla" }))
    await waitFor(() => expect(screen.queryByText("Cambios sin guardar")).toBeNull())
  })

  it("considera la etiqueta en el dirty check (editar solo la etiqueta marca cambios sin guardar)", () => {
    renderTab()
    const labelInput = screen.getByLabelText("Etiqueta de la plantilla")
    fireEvent.change(labelInput, { target: { value: "Etiqueta revisada" } })
    expect(screen.getByText("Cambios sin guardar")).toBeInTheDocument()
  })

  it("muestra los roles con labels en español, nunca slugs", () => {
    renderTab()
    fireEvent.click(screen.getByRole("button", { name: /Agregar sección/ }))
    // La sección nueva y el panel de configuración (firmas del cierre) exponen
    // los mismos roles, así que la búsqueda es múltiple.
    expect(screen.getAllByRole("checkbox", { name: "Prevencionista de faena" }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole("checkbox", { name: "Supervisor de faena" }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole("checkbox", { name: "Jefe de faena" }).length).toBeGreaterThan(0)
    expect(screen.queryByRole("checkbox", { name: "prevencionista_faena" })).toBeNull()
  })

  it("renderiza la vista previa en solo lectura con el resumen de cierre", () => {
    renderTab()
    fireEvent.click(screen.getByRole("button", { name: "Vista previa" }))
    expect(screen.getByText("Así lo verá quien llene la verificación (solo lectura).")).toBeInTheDocument()
    expect(screen.getByText("Sin secciones para previsualizar.")).toBeInTheDocument()
    expect(screen.getByText("Cierre de verificación")).toBeInTheDocument()
    expect(screen.getByText("Conforme")).toBeInTheDocument()
  })

  it("muestra el resumen de secciones e ítems del builder y alerta las secciones vacías", () => {
    renderTab()
    expect(screen.getByText("0 secciones · 0 ítems")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Agregar sección/ }))
    expect(screen.getByText("1 sección · 0 ítems")).toBeInTheDocument()
    expect(screen.getByText(/sección sin ítems/)).toBeInTheDocument()
  })
})

describe("ChecklistTab — Fase 3", () => {
  it("edita título del checklist desde el panel de configuración (F4)", () => {
    renderTab()
    fireEvent.click(screen.getByText("Configuración del checklist"))
    const title = screen.getByLabelText("Título") as HTMLInputElement
    expect(title.value).toBe("Inspección de Estado de Extintores")
    fireEvent.change(title, { target: { value: "Verificación de extintores" } })
    expect(screen.getByText("Cambios sin guardar")).toBeInTheDocument()
  })

  it("edita el cierre desde el panel de configuración (F4)", () => {
    renderTab()
    fireEvent.click(screen.getByText("Configuración del checklist"))
    const cierre = screen.getByLabelText("Título del cierre")
    fireEvent.change(cierre, { target: { value: "Resultado de la verificación" } })
    expect(screen.getByText("Cambios sin guardar")).toBeInTheDocument()
  })

  it("duplica un ítem y luego la sección completa (F8)", () => {
    renderTab()
    fireEvent.click(screen.getByRole("button", { name: /Agregar sección/ }))
    fireEvent.click(screen.getByRole("button", { name: /Agregar ítem/ }))
    expect(screen.getByText("1 sección · 1 ítem")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Duplicar ítem" }))
    expect(screen.getByText("1 sección · 2 ítems")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Nuevo ítem (copia)")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Duplicar sección" }))
    expect(screen.getByText("2 secciones · 4 ítems")).toBeInTheDocument()
  })

  it("copia la plantilla de otra actividad con ids nuevos (F12)", () => {
    render(
      <ChecklistTab programId="prog-1" activities={[ACTIVITY, ACTIVITY_2]} checklists={[TEMPLATE_OTRA]} />,
    )
    fireEvent.click(screen.getByText("Definir checklist"))

    // Aísla el editor de la fila abierta: la segunda actividad renderiza su
    // propio editor (con la misma plantilla) dentro de su <details> cerrado.
    const row = screen.getByText("Definir checklist").closest("details") as HTMLElement
    const view = within(row)

    // El selector de copia aparece y trae la otra actividad (opción en portal).
    fireEvent.click(view.getByRole("combobox", { name: "Copiar desde otra actividad" }))
    fireEvent.click(screen.getByRole("option", { name: /Inspección de Taller/ }))

    // La plantilla clonada carga en modo visual con la sección copiada.
    expect(view.getByDisplayValue("Estado del taller")).toBeInTheDocument()
    expect(view.getByDisplayValue("Checklist Taller (copia)")).toBeInTheDocument()
    expect(view.getByText("Cambios sin guardar")).toBeInTheDocument()
  })

  it("pide confirmación al copiar cuando hay cambios sin guardar (F12)", () => {
    render(
      <ChecklistTab programId="prog-1" activities={[ACTIVITY, ACTIVITY_2]} checklists={[TEMPLATE_OTRA]} />,
    )
    fireEvent.click(screen.getByText("Definir checklist"))
    const row = screen.getByText("Definir checklist").closest("details") as HTMLElement
    const view = within(row)

    // Edita algo primero: la copia ya no puede reemplazar en silencio.
    const labelInput = view.getByLabelText("Etiqueta de la plantilla")
    fireEvent.change(labelInput, { target: { value: "Edición a medias" } })

    fireEvent.click(view.getByRole("combobox", { name: "Copiar desde otra actividad" }))
    fireEvent.click(screen.getByRole("option", { name: /Inspección de Taller/ }))

    // El diálogo pide confirmar antes de pisar el trabajo sin guardar.
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Copiar y reemplazar" }))
    expect(view.getByDisplayValue("Checklist Taller (copia)")).toBeInTheDocument()
    expect(view.getByDisplayValue("Estado del taller")).toBeInTheDocument()
  })
})
