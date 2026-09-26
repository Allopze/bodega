import { describe, expect, it } from "vitest"
import { pdtpChangeLogCategory } from "./change-log-labels"

describe("pdtpChangeLogCategory (PREV-K01)", () => {
  it("traduce la sección técnica a una categoría legible, sin identificadores internos", () => {
    expect(pdtpChangeLogCategory("obligation:pdtp-obligation-gkQ_EOjgb7s1BqTLxeTU4")).toBe("Obligación")
    expect(pdtpChangeLogCategory("obligation:abc:cancellation")).toBe("Obligación")
    expect(pdtpChangeLogCategory("deviation:77")).toBe("Desvío")
    expect(pdtpChangeLogCategory("closure:2026-05")).toBe("Cierre mensual")
    expect(pdtpChangeLogCategory("assignee:78")).toBe("Asignación")
    expect(pdtpChangeLogCategory("execution:pdtp-act-e2e-e-ws-e2e-2026-09-4")).toBe("Ejecución")
    expect(pdtpChangeLogCategory("lifecycle")).toBe("Ciclo de vida")
  })

  it("una sección desconocida no muestra el identificador crudo", () => {
    expect(pdtpChangeLogCategory("algo_nuevo:xyz-123")).toBe("Cambio")
  })
})
