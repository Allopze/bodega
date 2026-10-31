import { existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { TAE_ACCESS_PATH, taeAccessUrl } from "./tae-access-url"

const ROOT = path.resolve(__dirname, "../..")

describe("taeAccessUrl", () => {
  it("apunta a la página pública que existe", () => {
    expect(taeAccessUrl("https://chome.test", "tok-1")).toBe("https://chome.test/tae/access/tok-1")
    expect(existsSync(path.join(ROOT, "app/(public)/tae/access/[accessToken]/page.tsx"))).toBe(true)
  })

  it("no duplica la barra del origen y codifica el token", () => {
    expect(taeAccessUrl("https://chome.test/", "a b")).toBe("https://chome.test/tae/access/a%20b")
  })

  it("los QR antiguos con /tae/acceso tienen una redirección", () => {
    expect(TAE_ACCESS_PATH).toBe("/tae/access")
    expect(existsSync(path.join(ROOT, "app/(public)/tae/acceso/[accessToken]/page.tsx"))).toBe(true)
  })
})
