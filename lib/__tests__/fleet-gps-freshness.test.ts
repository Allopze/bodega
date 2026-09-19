import { describe, expect, it } from "vitest"
import { isGpsCaptureStale } from "@/lib/services/fleet-gps"

describe("isGpsCaptureStale", () => {
  it("no marca una captura reciente del mismo día aunque los formatos difieran", () => {
    // Regresión: `observedAt` llega de drizzle con separador de espacio y
    // `staleBefore` es ISO. Comparados como texto, ' ' < 'T' marcaba toda
    // captura del día como desactualizada.
    expect(isGpsCaptureStale("2026-09-19 12:00:00.000+00", "2026-09-19T11:45:00.000Z")).toBe(false)
  })

  it("marca una captura anterior al umbral", () => {
    expect(isGpsCaptureStale("2026-09-19 11:00:00.000+00", "2026-09-19T11:45:00.000Z")).toBe(true)
  })

  it("no marca cuando no hay capturas", () => {
    expect(isGpsCaptureStale(null, "2026-09-19T11:45:00.000Z")).toBe(false)
  })

  it("no marca cuando alguna fecha no es parseable", () => {
    expect(isGpsCaptureStale("no-es-fecha", "2026-09-19T11:45:00.000Z")).toBe(false)
    expect(isGpsCaptureStale("2026-09-19 12:00:00.000+00", "")).toBe(false)
  })
})
