// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("./actions", () => ({ toggleWorkerActive: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("./worker-form", () => ({ WorkerForm: () => null }))

import { WorkerList } from "./worker-list"

function worker(id: string, firstName: string, isActive: boolean) {
  return {
    id, rut: null, firstName, lastName: "Prueba", position: null,
    worksiteId: "ws-1", worksiteName: "Faena Uno", isActive,
    createdAt: "2026-08-18T00:00:00.000Z",
    sizeTop: null, sizeBottom: null, sizeShoe: null, sizeGloves: null, sizeHelmet: null,
  }
}

const WORKERS = [worker("w-1", "Ana", true), worker("w-2", "Beto", false)]

/** jsdom no aplica media queries: las tarjetas móviles y la tabla se montan a la
 *  vez, así que todas las aserciones van dentro de la tabla. */
function table() {
  return within(screen.getByRole("table"))
}

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("WorkerList", () => {
  it("separa a los desactivados en su propia pestaña", () => {
    render(<WorkerList workers={WORKERS} worksites={[{ id: "ws-1", name: "Faena Uno" }]} />)

    expect(table().queryByText("Ana Prueba")).not.toBeNull()
    expect(table().queryByText("Beto Prueba")).toBeNull()

    // Radix activa la pestaña en mousedown, no en click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Inactivos/ }))

    expect(table().queryByText("Beto Prueba")).not.toBeNull()
    expect(table().queryByText("Ana Prueba")).toBeNull()
  })
})
