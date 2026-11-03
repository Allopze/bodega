import { describe, expect, it } from "vitest"
import {
  APPROVAL_AGE_BUCKETS,
  approvalAgeBucketKey,
  approvalAgeBucketLabel,
  approvalAgeHref,
  approvalAgeSummary,
  bucketApprovalAges,
  formatApprovalAge,
  parseApprovalAgeParam,
} from "@/lib/approvals-age"

describe("approvalAgeBucketKey", () => {
  // Los bordes son el contrato del gráfico: 1/2, 3/4 y 7/8 días separan los tramos.
  it.each([
    [0, "0-1"],
    [1, "0-1"],
    [2, "2-3"],
    [3, "2-3"],
    [4, "4-7"],
    [7, "4-7"],
    [8, "mas-de-7"],
    [21, "mas-de-7"],
  ])("%i días cae en el tramo %s", (days, key) => {
    expect(approvalAgeBucketKey(days)).toBe(key)
  })

  it("una edad negativa (reloj adelantado) cuenta como recién enviada", () => {
    expect(approvalAgeBucketKey(-1)).toBe("0-1")
  })

  it("los tramos son contiguos y en orden cronológico, sin huecos ni solapes", () => {
    expect(APPROVAL_AGE_BUCKETS.map((bucket) => bucket.key)).toEqual(["0-1", "2-3", "4-7", "mas-de-7"])
    for (let i = 1; i < APPROVAL_AGE_BUCKETS.length; i++) {
      expect(APPROVAL_AGE_BUCKETS[i]!.min).toBe((APPROVAL_AGE_BUCKETS[i - 1]!.max ?? NaN) + 1)
    }
    expect(APPROVAL_AGE_BUCKETS.at(-1)!.max).toBeNull()
  })
})

describe("bucketApprovalAges", () => {
  it("suma los ítems de cada tramo y deja en cero los que no tienen", () => {
    const counts = bucketApprovalAges([
      { ageDays: 0, items: 3 },
      { ageDays: 1, items: 2 },
      { ageDays: 3, items: 4 },
      { ageDays: 9, items: 1 },
      { ageDays: 30, items: 1 },
    ])
    expect(counts).toEqual({ "0-1": 5, "2-3": 4, "4-7": 0, "mas-de-7": 2 })
  })

  it("una solicitud sin fecha de envío no se cuenta en ningún tramo", () => {
    expect(bucketApprovalAges([{ ageDays: null, items: 7 }, { ageDays: 2, items: 1 }])).toEqual({
      "0-1": 0, "2-3": 1, "4-7": 0, "mas-de-7": 0,
    })
  })

  it("sin filas devuelve los cuatro tramos en cero", () => {
    expect(bucketApprovalAges([])).toEqual({ "0-1": 0, "2-3": 0, "4-7": 0, "mas-de-7": 0 })
  })
})

describe("parseApprovalAgeParam", () => {
  it("acepta sólo las claves de tramo y descarta cualquier otro valor", () => {
    expect(parseApprovalAgeParam("2-3")).toBe("2-3")
    expect(parseApprovalAgeParam("mas-de-7")).toBe("mas-de-7")
    expect(parseApprovalAgeParam("8+")).toBe("")
    expect(parseApprovalAgeParam("1; drop table")).toBe("")
    expect(parseApprovalAgeParam(undefined)).toBe("")
    expect(parseApprovalAgeParam("")).toBe("")
  })

  it("con el parámetro repetido toma el primero", () => {
    expect(parseApprovalAgeParam(["4-7", "0-1"])).toBe("4-7")
  })
})

describe("formatApprovalAge", () => {
  it("dice hoy, hace 1 día y hace N días; sin fecha no inventa nada", () => {
    expect(formatApprovalAge(0)).toBe("hoy")
    expect(formatApprovalAge(1)).toBe("hace 1 día")
    expect(formatApprovalAge(5)).toBe("hace 5 días")
    expect(formatApprovalAge(null)).toBeNull()
  })
})

describe("approvalAgeBucketLabel", () => {
  it("devuelve el rótulo del tramo o null si la clave no existe", () => {
    expect(approvalAgeBucketLabel("2-3")).toBe("2–3 días")
    expect(approvalAgeBucketLabel("mas-de-7")).toBe("Más de 7 días")
    expect(approvalAgeBucketLabel("otra")).toBeNull()
  })
})

describe("approvalAgeSummary", () => {
  it("abre con la respuesta: cuánto espera y cuánto lleva más de una semana", () => {
    expect(approvalAgeSummary({ "0-1": 5, "2-3": 4, "4-7": 0, "mas-de-7": 3 }, "")).toBe(
      "12 ítems esperan tu decisión; 3 llevan más de 7 días.",
    )
  })

  it("concuerda en singular", () => {
    expect(approvalAgeSummary({ "0-1": 0, "2-3": 0, "4-7": 0, "mas-de-7": 1 }, "")).toBe(
      "1 ítem espera tu decisión; 1 lleva más de 7 días.",
    )
  })

  it("dice cuando nada pasa de una semana", () => {
    expect(approvalAgeSummary({ "0-1": 2, "2-3": 0, "4-7": 1, "mas-de-7": 0 }, "")).toBe(
      "3 ítems esperan tu decisión; ninguno lleva más de 7 días.",
    )
  })

  it("con un tramo elegido dice cuántos del total está mostrando la lista", () => {
    expect(approvalAgeSummary({ "0-1": 5, "2-3": 4, "4-7": 0, "mas-de-7": 3 }, "2-3")).toBe(
      "Filtrando por «2–3 días»: 4 de 12 ítems.",
    )
  })

  it("sin ítems no hay frase", () => {
    expect(approvalAgeSummary({ "0-1": 0, "2-3": 0, "4-7": 0, "mas-de-7": 0 }, "")).toBe("")
  })
})

describe("approvalAgeHref", () => {
  it("agrega el tramo conservando los demás filtros y reinicia la página", () => {
    expect(approvalAgeHref("/aprobaciones", { faena: "ws-1", urgencia: "high", page: "3" }, "4-7")).toBe(
      "/aprobaciones?faena=ws-1&urgencia=high&antiguedad=4-7",
    )
  })

  it("cambiar de tramo reemplaza el anterior", () => {
    expect(approvalAgeHref("/aprobaciones", { antiguedad: "0-1", q: "SOL-1" }, "mas-de-7")).toBe(
      "/aprobaciones?q=SOL-1&antiguedad=mas-de-7",
    )
  })

  it("sin tramo es la salida: quita el filtro y deja el resto", () => {
    expect(approvalAgeHref("/aprobaciones", { antiguedad: "2-3", faena: "ws-1" }, "")).toBe("/aprobaciones?faena=ws-1")
    expect(approvalAgeHref("/aprobaciones", { antiguedad: "2-3" }, "")).toBe("/aprobaciones")
  })

  it("conserva parámetros repetidos y descarta los vacíos", () => {
    expect(approvalAgeHref("/aprobaciones", { estado: ["a", "b"], q: "", otro: undefined }, "0-1")).toBe(
      "/aprobaciones?estado=a&estado=b&antiguedad=0-1",
    )
  })
})
