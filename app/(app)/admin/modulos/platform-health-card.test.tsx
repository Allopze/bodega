// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { PlatformHealthCard } from "./platform-health-card"
import type { PlatformHealth } from "@/lib/services/platform-health"

afterEach(() => cleanup())

function health(overrides: Partial<PlatformHealth> = {}): PlatformHealth {
  return {
    status: "ok",
    db: "connected",
    storage: "writable",
    disk: { status: "ok", freePercent: 42, freeBytes: 50_000_000_000 },
    timestamp: "2026-08-03T00:00:00.000Z",
    ...overrides,
  }
}

describe("platform health card", () => {
  it("green only with positive evidence on every measured signal", () => {
    render(<PlatformHealthCard health={health()} />)
    expect(screen.getByText("Plataforma operativa")).toBeInTheDocument()
    expect(screen.getByText(/Base de datos: responde/)).toBeInTheDocument()
    expect(screen.getByText(/Almacenamiento: escribible/)).toBeInTheDocument()
  })

  it("names the failing signal instead of a generic error", () => {
    render(<PlatformHealthCard health={health({ status: "error", db: "disconnected" })} />)
    expect(screen.getByText("Plataforma con fallo")).toBeInTheDocument()
    expect(screen.getByText(/Base de datos: no responde/)).toBeInTheDocument()
  })

  // Lo que no se pudo medir se dice, no se pinta de verde.
  it("reports an unmeasured signal as unmeasured", () => {
    render(<PlatformHealthCard health={health({ status: "degraded", disk: { status: "unknown" } })} />)
    expect(screen.getByText("Disco: sin medir en esta plataforma")).toBeInTheDocument()
    expect(screen.getByText("Plataforma degradada")).toBeInTheDocument()
  })

  it("says out loud that the toggles below are not a health signal", () => {
    render(<PlatformHealthCard health={health()} />)
    expect(screen.getByText(/no miden salud/)).toBeInTheDocument()
  })
})
