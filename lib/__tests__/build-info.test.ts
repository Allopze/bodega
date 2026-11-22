/**
 * Identificador del build: el sha que pasa el deploy, o la hora del build si no
 * viene. Next reemplaza `process.env.NEXT_PUBLIC_BUILD_*` al compilar; en el test
 * se leen del entorno, por eso cada caso reimporta el módulo.
 */
import { afterEach, describe, expect, it, vi } from "vitest"

async function load(sha: string, time: string) {
  vi.stubEnv("NEXT_PUBLIC_BUILD_SHA", sha)
  vi.stubEnv("NEXT_PUBLIC_BUILD_TIME", time)
  vi.resetModules()
  return import("@/lib/build-info")
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("identificador del build", () => {
  it("usa el sha cuando el deploy lo pasa", async () => {
    const info = await load("3f9c2a1b7d0e", "2026-11-22T17:05:00.000Z")
    expect(info.BUILD_ID).toBe("3f9c2a1b7d0e")
    expect(info.BUILD_SHA).toBe("3f9c2a1b7d0e")
    expect(info.BUILD_TIME).toBe("2026-11-22T17:05:00.000Z")
  })

  it("cae a la hora del build sin sha", async () => {
    const info = await load("", "2026-11-22T17:05:00.000Z")
    expect(info.BUILD_ID).toBe("2026-11-22T17:05:00.000Z")
  })

  it("dev sin ninguna", async () => {
    const info = await load("", "")
    expect(info.BUILD_ID).toBe("dev")
  })

  it("rótulo legible", async () => {
    const { buildLabel } = await load("", "")
    const label = buildLabel("2026-11-22T17:05:00.000Z", "3f9c2a1b7d0e")
    expect(label).toContain("22-11-2026")
    expect(label).toContain("3f9c2a1b7d0e")
    // La versión que es la misma hora del build no se repite.
    expect(buildLabel("2026-11-22T17:05:00.000Z", "2026-11-22T17:05:00.000Z")).not.toContain("·")
    expect(buildLabel(null, "x")).toBe("Desconocida")
  })
})
