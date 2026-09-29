import { describe, expect, it } from "vitest"
import { userFacingErrorText } from "./user-facing-error"

describe("userFacingErrorText", () => {
  it("deja pasar un mensaje de negocio", () => {
    expect(userFacingErrorText("La celda ya tiene una ejecución registrada.")).toBe("La celda ya tiene una ejecución registrada.")
  })

  it("oculta la consulta SQL", () => {
    expect(userFacingErrorText("Failed query: insert into x")).toBeNull()
  })

  it("oculta errores del sistema de archivos y rutas del servidor (M-16)", () => {
    expect(userFacingErrorText("ENOENT: no such file or directory, open '/srv/app/storage/pdtp-evidence/a.pdf'")).toBeNull()
    expect(userFacingErrorText("EACCES: permission denied")).toBeNull()
    expect(userFacingErrorText("No se pudo leer /app/storage/x.pdf")).toBeNull()
    expect(userFacingErrorText("Error en C:\\data\\x.pdf")).toBeNull()
  })

  it("no confunde una fecha o una fracción con una ruta", () => {
    expect(userFacingErrorText("Meta 3/4 para el mes 04/2026.")).toBe("Meta 3/4 para el mes 04/2026.")
  })
})
