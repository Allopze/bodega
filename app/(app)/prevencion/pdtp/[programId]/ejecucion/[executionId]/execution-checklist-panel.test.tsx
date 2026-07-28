// @vitest-environment jsdom
/**
 * Los borradores sin guardar del checklist deben sobrevivir a un remonte.
 *
 * Cada guardado del panel llama `router.refresh()`, que re-suspende el render
 * del servidor, cruza el boundary de `loading.tsx` y hace que React descarte y
 * vuelva a montar este árbol. Como el estado inicial se sembraba SÓLO de las
 * respuestas ya guardadas, guardar el sujeto A borraba en silencio lo que el
 * usuario había respondido —y no guardado— en los sujetos B..N. Multi-sujeto es
 * el caso normal: una instancia por extintor, equipo o trabajador inspeccionado.
 *
 * El remonte se simula desmontando y volviendo a renderizar con las mismas
 * props del servidor, que es exactamente lo que hace el refresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { ExecutionChecklistPanel } from "./execution-checklist-panel"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock("../../../actions/checklist-actions", () => ({
  startPdtpExecutionChecklistAction: vi.fn(async () => ({ ok: true })),
  upsertPdtpChecklistResponsesAction: vi.fn(async () => ({ ok: true })),
  submitPdtpExecutionChecklistAction: vi.fn(async () => ({ ok: true })),
}))

const ITEM_LABEL = "Extintor con carga vigente"

const DEFINITION = {
  sections: [{
    id: "sec-1",
    title: "Sección 1",
    items: [{ id: "item-1", label: ITEM_LABEL, kind: "cumple_nocumple_obs" }],
  }],
}

function instance(id: string, subjectLabel: string) {
  return {
    id,
    executionId: "exec-1",
    overallStatus: "en_proceso",
    subjectType: "extintor",
    subjectId: id,
    subjectLabel,
    porcentajeCumplimiento: null,
    definition: DEFINITION,
  }
}

const PROPS = {
  executionId: "exec-1",
  programId: "prog-1",
  // Dos sujetos: el bug sólo es visible con más de una instancia.
  instances: [instance("inst-a", "Extintor A"), instance("inst-b", "Extintor B")],
  responsesByInstance: { "inst-a": [], "inst-b": [] },
  canFill: true,
  vehicles: [],
  worksiteWorkers: [],
} as unknown as React.ComponentProps<typeof ExecutionChecklistPanel>

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("ExecutionChecklistPanel — borradores entre sujetos", () => {
  it("conserva la respuesta sin guardar del segundo sujeto al remontar", () => {
    const first = render(<ExecutionChecklistPanel {...PROPS} />)
    expect(screen.getAllByText("Pendiente de respuesta")).toHaveLength(2)

    // Responde sólo el sujeto B (segundo grupo con el mismo ítem).
    const groupB = screen.getAllByRole("group", { name: ITEM_LABEL })[1]!
    fireEvent.click(within(groupB).getByRole("button", { name: "Cumple" }))
    expect(screen.getAllByText("Registrado")).toHaveLength(1)

    // Remonte: mismas props del servidor, sin respuestas guardadas todavía.
    first.unmount()
    render(<ExecutionChecklistPanel {...PROPS} />)

    expect(screen.getAllByText("Registrado")).toHaveLength(1)
    expect(screen.getAllByText("Pendiente de respuesta")).toHaveLength(1)
  })

  it("no arrastra borradores de otra ejecución", () => {
    const first = render(<ExecutionChecklistPanel {...PROPS} />)
    const groupB = screen.getAllByRole("group", { name: ITEM_LABEL })[1]!
    fireEvent.click(within(groupB).getByRole("button", { name: "Cumple" }))
    first.unmount()

    render(<ExecutionChecklistPanel {...PROPS} executionId="exec-2" />)
    expect(screen.getAllByText("Pendiente de respuesta")).toHaveLength(2)
  })

  it("sigue funcionando si sessionStorage no está disponible", () => {
    const getItem = vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage deshabilitado")
    })
    const setItem = vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("SecurityError: storage deshabilitado")
    })
    try {
      render(<ExecutionChecklistPanel {...PROPS} />)
      const groupB = screen.getAllByRole("group", { name: ITEM_LABEL })[1]!
      fireEvent.click(within(groupB).getByRole("button", { name: "Cumple" }))
      // Sin persistencia se pierde al remontar, pero no rompe la pantalla.
      expect(screen.getAllByText("Registrado")).toHaveLength(1)
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })
})
