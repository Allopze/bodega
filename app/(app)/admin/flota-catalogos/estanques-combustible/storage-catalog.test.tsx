// @vitest-environment jsdom
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ShellHeaderProvider } from "@/components/layout/header-context"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/flota-catalogos/estanques-combustible" }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("./actions", () => ({ createFuelStorageLocationAction: vi.fn(), updateFuelStorageLocationAction: vi.fn(), setFuelStorageLocationStatusAction: vi.fn() }))

import { StorageCatalog } from "./storage-catalog"

afterEach(cleanup)

function renderCatalog() {
  return render(<ShellHeaderProvider><StorageCatalog rows={[]} worksites={[{ id: "w1", name: "Masisa" }]} products={[{ id: "p1", name: "Petróleo Diésel" }]} /></ShellHeaderProvider>)
}

describe("StorageCatalog", () => {
  // El botón era un <Link href="?nuevo=1"> y la ficha leía ese parámetro sólo al
  // montarse: desde la misma página la navegación no remontaba el componente,
  // así que la URL cambiaba y la ficha no se abría.
  it("«Nuevo estanque» abre la ficha, también después de cerrarla", () => {
    renderCatalog()
    fireEvent.click(screen.getByRole("button", { name: "Nuevo estanque" }))
    expect(screen.getByRole("dialog", { name: "Nuevo estanque" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(screen.queryByRole("dialog")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Nuevo estanque" }))
    expect(screen.getByRole("dialog", { name: "Nuevo estanque" })).toBeTruthy()
  })
})
