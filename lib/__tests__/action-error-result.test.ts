import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { actionErrorResult } from "@/lib/actions/action-error-result"
import { isUniqueViolation } from "@/lib/action-error"
import { configureZodLocale } from "@/lib/validation/zod-locale"

function zodErrorOf(schema: z.ZodType, input: unknown): z.ZodError {
  const parsed = schema.safeParse(input)
  if (parsed.success) throw new Error("se esperaba un error de validación")
  return parsed.error
}

function pgError(code: string, constraint?: string) {
  return Object.assign(new Error("Failed query: insert into x values ($1)\nparams: secreto"), {
    query: "insert into x values ($1)",
    cause: { code, constraint_name: constraint },
  })
}

describe("actionErrorResult", () => {
  /*
   * El defecto que corrige: un ZodError lanzado por el servicio terminaba en
   * «No se pudo completar la operación.» y el usuario no sabía qué corregir.
   */
  it("un ZodError devuelve fieldErrors y la primera regla en el mensaje", () => {
    const schema = z.object({ reason: z.string().min(10, "El motivo debe tener al menos 10 caracteres.") })
    const result = actionErrorResult(zodErrorOf(schema, { reason: "corto" }), "No se pudo guardar.")
    expect(result).toEqual({
      ok: false,
      message: "Revisa los campos marcados: El motivo debe tener al menos 10 caracteres.",
      fieldErrors: { reason: ["El motivo debe tener al menos 10 caracteres."] },
    })
  })

  it("un issue sin path (refine del formulario) es el mensaje mismo", () => {
    const schema = z.object({ a: z.string(), b: z.string() })
      .refine((v) => v.a !== v.b, { message: "Las dos fechas no pueden coincidir." })
    const result = actionErrorResult(zodErrorOf(schema, { a: "x", b: "x" }), "No se pudo guardar.")
    expect(result).toEqual({ ok: false, message: "Las dos fechas no pueden coincidir." })
  })

  it("con el locale configurado, las reglas sin mensaje propio salen en español", () => {
    configureZodLocale()
    try {
      const schema = z.object({ code: z.string().min(2) })
      const result = actionErrorResult(zodErrorOf(schema, { code: "x" }), "No se pudo guardar.")
      expect(result.message).toMatch(/^Revisa los campos marcados: /)
      expect(result.message).not.toMatch(/Too small/)
      expect(result.fieldErrors?.code?.[0]).toMatch(/caracteres/)
    } finally {
      z.config(z.locales.en())
    }
  })

  it("una violación de unicidad usa el mensaje de su constraint, sin filtrar el SQL", () => {
    const result = actionErrorResult(pgError("23505", "prevention_committee_active_unique"), "No se pudo guardar.", {
      unique: { prevention_committee_active_unique: "La faena ya tiene un comité activo." },
    })
    expect(result).toEqual({ ok: false, message: "La faena ya tiene un comité activo." })
  })

  it("'*' cubre cualquier constraint única no listada", () => {
    const result = actionErrorResult(pgError("23505", "otra_constraint"), "No se pudo guardar.", {
      unique: { una: "A", "*": "Ya existe un registro igual." },
    })
    expect(result.message).toBe("Ya existe un registro igual.")
  })

  it("sin mensaje para la unicidad, cae al fallback y no muestra el SQL", () => {
    const result = actionErrorResult(pgError("23505", "x"), "No se pudo guardar.")
    expect(result).toEqual({ ok: false, message: "No se pudo guardar." })
  })

  it("una violación de llave foránea usa el mensaje indicado", () => {
    const result = actionErrorResult(pgError("23503"), "No se pudo guardar.", { foreignKey: "El registro ya no existe." })
    expect(result.message).toBe("El registro ya no existe.")
  })

  it("un error de negocio se muestra tal cual", () => {
    expect(actionErrorResult(new Error("El plan ya está aprobado."), "No se pudo guardar.").message)
      .toBe("El plan ya está aprobado.")
  })

  it("algo que no es Error cae al fallback", () => {
    expect(actionErrorResult("boom", "No se pudo guardar.")).toEqual({ ok: false, message: "No se pudo guardar." })
  })
})

describe("isUniqueViolation", () => {
  it("sin constraint, detecta cualquier 23505 dentro de la cadena de cause", () => {
    expect(isUniqueViolation(pgError("23505", "cualquiera"))).toBe(true)
    expect(isUniqueViolation(pgError("23503"))).toBe(false)
  })

  it("con constraint, sólo esa", () => {
    expect(isUniqueViolation(pgError("23505", "a"), "a")).toBe(true)
    expect(isUniqueViolation(pgError("23505", "a"), "b")).toBe(false)
  })
})
