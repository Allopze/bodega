// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { FleetGpsPosition } from "@/lib/services/fleet-gps"

/** La lista al lado del mapa (crítica 2026-11-15): misma búsqueda que la tabla, y elegir ubica en el mapa. */

const header = vi.hoisted(() => ({ searchQuery: "" }))
vi.mock("@/components/layout/header-context", () => ({ useSafeShellHeader: () => header }))

import { FleetGpsSideList } from "./fleet-gps-side-list"

const position = (over: Partial<FleetGpsPosition>) => ({
  id: "p1", plate: "AB1234", code: "KA-1", brand: "Volvo", model: "FH", typeName: "Camión", worksiteName: "Pacifico", providers: ["OnWay"],
  ignition: true, ignitionKnown: true, gpsReportedAt: "2026-11-16T12:00:00.000Z", gpsIsStale: false, ...over,
}) as FleetGpsPosition

afterEach(() => { cleanup(); header.searchQuery = "" })

describe("FleetGpsSideList", () => {
  const positions = [position({}), position({ id: "p2", plate: "CD5678", code: "GR-2", ignition: false, gpsIsStale: true })]

  it("lista cada vehículo con su encendido y marca el elegido", () => {
    render(<FleetGpsSideList positions={positions} selectedId="p2" onSelect={() => {}} />)
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("2")
    expect(screen.getByRole("button", { name: "Ubicar KA-1 en el mapa" }).getAttribute("aria-pressed")).toBe("false")
    expect(screen.getByRole("button", { name: "Ubicar GR-2 en el mapa" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByText("Encendido")).toBeTruthy()
    expect(screen.getByText(/atrasado/)).toBeTruthy()
  })

  it("elegir un vehículo avisa su id", () => {
    const onSelect = vi.fn()
    render(<FleetGpsSideList positions={positions} selectedId={null} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole("button", { name: "Ubicar GR-2 en el mapa" }))
    expect(onSelect).toHaveBeenCalledWith("p2")
  })

  it("filtra con la búsqueda de la barra superior y lo dice cuando no hay ninguno", () => {
    header.searchQuery = "gr-2"
    const { unmount } = render(<FleetGpsSideList positions={positions} selectedId={null} onSelect={() => {}} />)
    expect(screen.queryByRole("button", { name: "Ubicar KA-1 en el mapa" })).toBeNull()
    unmount()
    header.searchQuery = "zzz"
    render(<FleetGpsSideList positions={positions} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByText("Ningún vehículo calza con la búsqueda.")).toBeTruthy()
  })
})
