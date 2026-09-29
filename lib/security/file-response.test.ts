import { describe, expect, it } from "vitest"
import { fileDisposition, isInlineSafeMime } from "./file-response"

describe("fileDisposition (M-03)", () => {
  it("sólo PDF e imágenes rasterizadas se muestran en el navegador", () => {
    expect(fileDisposition("application/pdf", false)).toBe("inline")
    expect(fileDisposition("image/jpeg", false)).toBe("inline")
    expect(fileDisposition("text/html", false)).toBe("attachment")
    expect(fileDisposition("image/svg+xml", false)).toBe("attachment")
    expect(fileDisposition(null, false)).toBe("attachment")
  })

  it("una descarga pedida siempre es attachment", () => {
    expect(fileDisposition("application/pdf", true)).toBe("attachment")
  })

  it("ignora parámetros y mayúsculas del tipo", () => {
    expect(isInlineSafeMime("Application/PDF; charset=binary")).toBe(true)
  })
})
