import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { parseZ } from "@/lib/actions/parse-z"

describe("parseZ", () => {
  it("returns Zod-transformed data, not the raw input, on valid input", () => {
    const schema = z.object({
      year: z.coerce.number(),
      label: z.string().transform((v) => v.trim().toUpperCase()),
    })

    const result = parseZ(schema, { year: "2026", label: "  hola  " })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok:true")
    expect(result.data).toEqual({ year: 2026, label: "HOLA" })
  })

  it("returns ok:false with populated fieldErrors on invalid input, without throwing", () => {
    const schema = z.object({
      name: z.string().min(1, "Nombre requerido"),
    })

    const result = parseZ(schema, { name: "" })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected ok:false")
    expect(result.fieldErrors.name).toEqual(["Nombre requerido"])
    expect(typeof result.message).toBe("string")
  })

  it("respects refine/superRefine on the schema (conditional cross-field validation)", () => {
    const schema = z
      .object({
        decision: z.enum(["aprobado", "correccion"]),
        accionCorrectiva: z.string().optional(),
      })
      .superRefine((value, ctx) => {
        if (value.decision !== "correccion") return
        if (!value.accionCorrectiva || value.accionCorrectiva.trim().length < 4) {
          ctx.addIssue({
            code: "custom",
            path: ["accionCorrectiva"],
            message: "Describe la acción correctiva requerida.",
          })
        }
      })

    const failing = parseZ(schema, { decision: "correccion" })
    expect(failing.ok).toBe(false)
    if (failing.ok) throw new Error("expected ok:false")
    expect(failing.fieldErrors.accionCorrectiva).toEqual(["Describe la acción correctiva requerida."])

    const passing = parseZ(schema, { decision: "aprobado" })
    expect(passing.ok).toBe(true)
  })

  it("never throws: uses safeParse internally, not parse", () => {
    const schema = z.object({ id: z.string() })
    const safeParseSpy = vi.spyOn(schema, "safeParse")
    const parseSpy = vi.spyOn(schema, "parse")

    expect(() => parseZ(schema, { id: 123 })).not.toThrow()

    expect(safeParseSpy).toHaveBeenCalled()
    expect(parseSpy).not.toHaveBeenCalled()

    safeParseSpy.mockRestore()
    parseSpy.mockRestore()
  })
})
