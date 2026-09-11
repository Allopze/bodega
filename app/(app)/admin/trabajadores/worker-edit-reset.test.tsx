// @vitest-environment jsdom

/**
 * Regresión: `WorkerForm` guarda cargo, faena y tallas en estado local y
 * `WorkerList` lo mantiene montado entre aperturas. Sin un `key` por
 * trabajador, editar a alguien después de otro arrastraba los valores del
 * anterior — y al guardar lo movía de faena y le cambiaba el cargo.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("./actions", () => ({
  toggleWorkerActive: vi.fn(),
  createWorker: vi.fn(),
  updateWorker: vi.fn(),
}))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { WorkerList } from "./worker-list"

afterEach(cleanup)

const POSITIONS = [
  { id: "pos-op", code: "OPERADOR", name: "Operador", isActive: true, needsReview: false },
  { id: "pos-sup", code: "SUPERVISOR", name: "Supervisor", isActive: true, needsReview: false },
]

const WORKSITES = [{ id: "ws-1", name: "Faena Uno" }, { id: "ws-2", name: "Faena Dos" }]

function worker(id: string, firstName: string, positionId: string, worksiteId: string, sizeTop: string) {
  return {
    id, rut: null, firstName, lastName: "Prueba", position: null,
    positionId, positionNeedsReview: false,
    worksiteId, worksiteName: worksiteId === "ws-1" ? "Faena Uno" : "Faena Dos",
    isActive: true, createdAt: "2026-08-18T00:00:00.000Z",
    sizeTop, sizeBottom: null, sizeShoe: null, sizeGloves: null, sizeHelmet: null,
  }
}

/** Los campos que el formulario envía van en inputs ocultos, no en el Select. */
function submitted() {
  const value = (name: string) =>
    document.querySelector(`input[name="${name}"]`)?.getAttribute("value")
  return { positionId: value("positionId"), worksiteId: value("worksiteId"), sizeTop: value("sizeTop") }
}

/** jsdom no aplica media queries: tarjeta móvil y tabla se montan a la vez,
 *  así que el botón aparece dos veces y cualquiera de los dos sirve. */
function openEditFor(firstName: string) {
  fireEvent.click(screen.getAllByRole("button", { name: `Editar trabajador ${firstName} Prueba` })[0]!)
}

describe("WorkerList — editar dos trabajadores seguidos", () => {
  it("carga los datos del segundo trabajador, no los del primero", () => {
    render(
      <WorkerList
        workers={[
          worker("w-1", "Ana", "pos-op", "ws-1", "M"),
          worker("w-2", "Beto", "pos-sup", "ws-2", "XL"),
        ]}
        worksites={WORKSITES}
        sizeFamilies={[]}
        positions={POSITIONS}
      />,
    )

    openEditFor("Ana")
    expect(submitted()).toEqual({ positionId: "pos-op", worksiteId: "ws-1", sizeTop: "M" })

    fireEvent.click(screen.getAllByRole("button", { name: "Cancelar" })[0]!)
    openEditFor("Beto")
    expect(submitted()).toEqual({ positionId: "pos-sup", worksiteId: "ws-2", sizeTop: "XL" })
  })
})
