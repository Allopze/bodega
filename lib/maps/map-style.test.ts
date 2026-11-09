import { describe, expect, it } from "vitest"
import {
  DEVELOPMENT_MAP_STYLE_URL,
  MAPLIBRE_WORKER_FILES,
  mapStyleConnectSrcOrigin,
  maplibreWorkerUrl,
  resolveMapStyleUrl,
} from "./map-style"

describe("resolveMapStyleUrl", () => {
  it("usa el estilo configurado, sin espacios", () => {
    expect(resolveMapStyleUrl("  https://tiles.example.com/style.json ", true)).toBe("https://tiles.example.com/style.json")
  })

  it("fuera de producción cae al estilo de desarrollo", () => {
    expect(resolveMapStyleUrl("", false)).toBe(DEVELOPMENT_MAP_STYLE_URL)
  })

  it("en producción sin configurar no hay mapa", () => {
    expect(resolveMapStyleUrl(undefined, true)).toBeNull()
    expect(resolveMapStyleUrl("   ", true)).toBeNull()
  })
})

describe("mapStyleConnectSrcOrigin", () => {
  it("devuelve sólo el origen https del estilo", () => {
    expect(mapStyleConnectSrcOrigin(DEVELOPMENT_MAP_STYLE_URL)).toBe("https://tiles.openfreemap.org")
    expect(mapStyleConnectSrcOrigin(null)).toBeNull()
    expect(mapStyleConnectSrcOrigin("http://tiles.example.com/style.json")).toBeNull()
  })
})

describe("maplibreWorkerUrl", () => {
  it("apunta al worker del mismo origen, con la versión en la ruta", () => {
    expect(maplibreWorkerUrl("6.9.0")).toBe("/vendor/maplibre/6.9.0/maplibre-gl-worker.mjs")
    expect(MAPLIBRE_WORKER_FILES[0]).toBe("maplibre-gl-worker.mjs")
  })
})
