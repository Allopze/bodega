import { describe, expect, it } from "vitest"
import { computeRouteBundleStats, routeFromManifestKey } from "./check-bundle-budget"

describe("routeFromManifestKey", () => {
  it("quita los grupos de ruta y el segmento page", () => {
    expect(routeFromManifestKey("/(app)/combustibles/pagos/page")).toBe("/combustibles/pagos")
    expect(routeFromManifestKey("/(app)/combustibles/cargas/[origen]/[id]/page")).toBe("/combustibles/cargas/[origen]/[id]")
    expect(routeFromManifestKey("/page")).toBe("/")
  })
})

describe("computeRouteBundleStats", () => {
  const sizes: Record<string, number> = {
    "static/chunks/main.js": 100,
    "static/chunks/shared.js": 50,
    "static/chunks/pagos.js": 30,
    "static/css/app.css": 999,
  }
  const sizeOf = (file: string) => sizes[file] ?? 0

  it("suma los chunks raíz y los de la página una sola vez cada uno", () => {
    const stats = computeRouteBundleStats(
      {
        "/(app)/combustibles/pagos/page": {
          a: { chunks: ["1", "static/chunks/shared.js", "2", "static/chunks/pagos.js"] },
          b: { chunks: ["1", "/_next/static/chunks/shared.js"] },
          c: { chunks: ["static/css/app.css"] },
        },
      },
      ["static/chunks/main.js"],
      sizeOf,
    )
    expect(stats).toEqual([{ route: "/combustibles/pagos", firstLoadUncompressedJsBytes: 180 }])
  })

  it("ignora las entradas que no son páginas", () => {
    expect(computeRouteBundleStats({ "/(app)/layout": { a: { chunks: ["static/chunks/shared.js"] } } }, [], sizeOf)).toEqual([])
  })
})
