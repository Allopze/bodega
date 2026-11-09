import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import maplibrePackage from "maplibre-gl/package.json"
import { GET, generateStaticParams } from "./route"

function call(version: string, file: string) {
  return GET(new Request(`http://localhost/vendor/maplibre/${version}/${file}`), { params: Promise.resolve({ version, file }) })
}

describe("GET /vendor/maplibre/[version]/[file]", () => {
  it("genera en el build sólo el worker y su módulo compartido, de la versión instalada", () => {
    expect(generateStaticParams()).toEqual([
      { version: maplibrePackage.version, file: "maplibre-gl-worker.mjs" },
      { version: maplibrePackage.version, file: "maplibre-gl-shared.mjs" },
    ])
  })

  it("sirve el worker tal cual, como JavaScript cacheable", async () => {
    const response = await call(maplibrePackage.version, "maplibre-gl-worker.mjs")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8")
    expect(response.headers.get("cache-control")).toContain("immutable")
    const expected = await readFile(path.join(process.cwd(), "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"), "utf8")
    expect(await response.text()).toBe(expected)
  })

  it("el worker importa el módulo compartido por ruta relativa: los dos viven en la misma carpeta", async () => {
    const worker = await (await call(maplibrePackage.version, "maplibre-gl-worker.mjs")).text()
    expect(worker).toContain('from"./maplibre-gl-shared.mjs"')
  })

  it("no sirve otros archivos ni otra versión", async () => {
    expect((await call(maplibrePackage.version, "maplibre-gl.mjs")).status).toBe(404)
    expect((await call(maplibrePackage.version, "..%2Fpackage.json")).status).toBe(404)
    expect((await call("0.0.0", "maplibre-gl-worker.mjs")).status).toBe(404)
  })
})
