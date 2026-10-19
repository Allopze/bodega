import { describe, expect, it } from "vitest"
import { saveErrorCodeOf } from "@/lib/prevention/inspection-capture"
import { InspectionRunError, inspectionErrorCodeOf } from "@/lib/services/prevention-inspections/errors"

describe("saveErrorCodeOf", () => {
  it("lee el código que el servidor adjunta a un rechazo", () => {
    expect(saveErrorCodeOf({ ok: false, data: { code: "version_conflict" } })).toBe("version_conflict")
    expect(saveErrorCodeOf({ ok: false, data: { code: "evidence_guard" } })).toBe("evidence_guard")
  })

  it("un éxito, un rechazo sin código o un código desconocido no devuelven nada", () => {
    expect(saveErrorCodeOf({ ok: true, data: { code: "version_conflict" } })).toBeNull()
    expect(saveErrorCodeOf({ ok: false })).toBeNull()
    expect(saveErrorCodeOf({ ok: false, data: { code: "otra_cosa" } })).toBeNull()
    expect(saveErrorCodeOf(null)).toBeNull()
  })
})

describe("InspectionRunError", () => {
  it("lleva el código y se reconoce por forma", () => {
    const error = new InspectionRunError("not_editable", "La inspección ya fue ejecutada.")
    expect(error.message).toBe("La inspección ya fue ejecutada.")
    expect(inspectionErrorCodeOf(error)).toBe("not_editable")
  })

  it("no lleva `cause`: safeActionMessage lo ocultaría como error del driver", () => {
    expect("cause" in new InspectionRunError("invalid_row", "x")).toBe(false)
  })

  it("un error cualquiera no tiene código", () => {
    expect(inspectionErrorCodeOf(new Error("x"))).toBeNull()
    expect(inspectionErrorCodeOf("texto")).toBeNull()
  })
})
