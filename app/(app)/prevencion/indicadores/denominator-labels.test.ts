import { describe, expect, it } from "vitest"
import {
  DENOMINATOR_STATUS_LABELS,
  denominatorStatusVariant,
  labelOrRaw,
  RECONCILIATION_LABELS,
  SOURCE_TYPE_LABELS,
} from "./denominator-labels"

/**
 * Los valores que el CHECK de `safety_indicator_denominators` admite. Si el
 * esquema gana uno nuevo y nadie lo etiqueta, la tabla lo pinta crudo: así
 * nació `pending_review` en pantalla, porque el mapa tenía la clave inventada
 * `submitted` y `labelOrRaw` cae al valor tal cual.
 */
const STATUS_VALUES = ["draft", "pending_review", "approved", "rejected"]
const RECONCILIATION_VALUES = ["pending", "matched", "difference", "exception"]
const SOURCE_TYPE_VALUES = ["rrhh", "xlsx_import", "manual", "other_system"]

describe("etiquetas del denominador", () => {
  it("cubre todos los estados del CHECK sin dejar enums crudos", () => {
    for (const value of STATUS_VALUES) {
      expect(DENOMINATOR_STATUS_LABELS[value], `falta etiqueta para "${value}"`).toBeDefined()
      expect(labelOrRaw(DENOMINATOR_STATUS_LABELS, value)).not.toBe(value)
    }
  })

  it("cubre todos los estados de conciliación", () => {
    for (const value of RECONCILIATION_VALUES) {
      expect(RECONCILIATION_LABELS[value], `falta etiqueta para "${value}"`).toBeDefined()
      expect(labelOrRaw(RECONCILIATION_LABELS, value)).not.toBe(value)
    }
  })

  it("cubre todas las procedencias", () => {
    for (const value of SOURCE_TYPE_VALUES) {
      expect(SOURCE_TYPE_LABELS[value], `falta etiqueta para "${value}"`).toBeDefined()
    }
  })

  it("no conserva claves que el esquema no puede producir", () => {
    expect(DENOMINATOR_STATUS_LABELS).not.toHaveProperty("submitted")
    expect(Object.keys(DENOMINATOR_STATUS_LABELS).sort()).toEqual([...STATUS_VALUES].sort())
    expect(Object.keys(RECONCILIATION_LABELS).sort()).toEqual([...RECONCILIATION_VALUES].sort())
  })

  it("labelOrRaw resuelve el vacío con un guión", () => {
    expect(labelOrRaw(DENOMINATOR_STATUS_LABELS, null)).toBe("—")
    expect(labelOrRaw(DENOMINATOR_STATUS_LABELS, undefined)).toBe("—")
  })

  it("da un color a cada estado, con «en revisión» como advertencia", () => {
    expect(denominatorStatusVariant("approved")).toBe("success")
    expect(denominatorStatusVariant("rejected")).toBe("danger")
    expect(denominatorStatusVariant("pending_review")).toBe("warning")
    expect(denominatorStatusVariant("draft")).toBe("default")
    expect(denominatorStatusVariant(null)).toBe("default")
  })
})
