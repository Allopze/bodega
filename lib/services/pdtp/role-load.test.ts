import { describe, expect, it } from "vitest"
import { computePdtpRoleLoad } from "./role-load"

const CATALOG = [
  { slug: "sup", displayName: "Supervisor" },
  { slug: "jt", displayName: "Jefe de turno" },
  { slug: "prf", displayName: "Prevencionista" },
  { slug: "adm_contrato", displayName: "Administrador de contrato" },
]

describe("computePdtpRoleLoad", () => {
  it("suma la cantidad planificada de una celda a TODOS los responsables de la actividad", () => {
    // Act. 38 (Anexo A): diálogos diarios, 5 por semana, sup + jt.
    // Act. 6: 1 por semana, prf + adm_contrato + sup + jt.
    const rows = computePdtpRoleLoad({
      activities: [
        { id: "act-38", responsibleSlugs: ["sup", "jt"] },
        { id: "act-6", responsibleSlugs: ["prf", "adm_contrato", "sup", "jt"] },
      ],
      cells: [
        { activityId: "act-38", month: 1, week: 1, plannedQuantity: 5 },
        { activityId: "act-6", month: 1, week: 1, plannedQuantity: 1 },
      ],
      catalog: CATALOG,
    })

    const sup = rows.find((row) => row.slug === "sup")!
    const jt = rows.find((row) => row.slug === "jt")!
    // Una actividad con dos responsables suma a ambos, no reparte: sup y jt
    // deben quedar exactamente iguales, cada uno con la suma completa de las
    // dos actividades (no la mitad).
    expect(sup.weekly[0]).toBe(6)
    expect(jt.weekly[0]).toBe(6)
    expect(sup.total).toBe(6)
    expect(sup.monthly[0]).toBe(6)

    const prf = rows.find((row) => row.slug === "prf")!
    expect(prf.total).toBe(1)
    expect(prf.weekly[0]).toBe(1)
  })

  it("agrega weekly por posición de semana a través de todos los meses", () => {
    const rows = computePdtpRoleLoad({
      activities: [{ id: "act-1", responsibleSlugs: ["sup"] }],
      cells: [
        { activityId: "act-1", month: 1, week: 1, plannedQuantity: 2 },
        { activityId: "act-1", month: 2, week: 1, plannedQuantity: 3 },
        { activityId: "act-1", month: 3, week: 2, plannedQuantity: 4 },
      ],
      catalog: CATALOG,
    })
    const sup = rows.find((row) => row.slug === "sup")!
    expect(sup.weekly).toEqual([5, 4, 0, 0])
    expect(sup.monthly).toEqual([2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(sup.total).toBe(9)
  })

  it("activityCount cuenta actividades, no celdas, incluidas las sin ninguna celda planificada", () => {
    const rows = computePdtpRoleLoad({
      activities: [
        { id: "act-1", responsibleSlugs: ["sup"] },
        { id: "act-2", responsibleSlugs: ["sup"] },
        { id: "act-3", responsibleSlugs: ["sup"] },
      ],
      cells: [{ activityId: "act-1", month: 1, week: 1, plannedQuantity: 1 }],
      catalog: CATALOG,
    })
    const sup = rows.find((row) => row.slug === "sup")!
    expect(sup.activityCount).toBe(3)
    expect(sup.total).toBe(1)
  })

  it("usa el slug como displayName cuando no está en el catálogo", () => {
    const rows = computePdtpRoleLoad({
      activities: [{ id: "act-1", responsibleSlugs: ["desconocido"] }],
      cells: [],
      catalog: CATALOG,
    })
    expect(rows[0]!.displayName).toBe("desconocido")
  })

  it("ignora celdas de actividades ajenas a la lista y cantidades no positivas", () => {
    const rows = computePdtpRoleLoad({
      activities: [{ id: "act-1", responsibleSlugs: ["sup"] }],
      cells: [
        { activityId: "act-ajena", month: 1, week: 1, plannedQuantity: 99 },
        { activityId: "act-1", month: 1, week: 1, plannedQuantity: 0 },
        { activityId: "act-1", month: 1, week: 1, plannedQuantity: -3 },
      ],
      catalog: CATALOG,
    })
    const sup = rows.find((row) => row.slug === "sup")!
    expect(sup.total).toBe(0)
  })

  it("actividad sin responsables no produce ninguna fila propia", () => {
    const rows = computePdtpRoleLoad({
      activities: [{ id: "act-1", responsibleSlugs: [] }],
      cells: [{ activityId: "act-1", month: 1, week: 1, plannedQuantity: 5 }],
      catalog: CATALOG,
    })
    expect(rows).toEqual([])
  })

  it("clampea semana y mes fuera de rango en vez de escribir fuera del arreglo", () => {
    const rows = computePdtpRoleLoad({
      activities: [{ id: "act-1", responsibleSlugs: ["sup"] }],
      cells: [
        { activityId: "act-1", month: 0, week: 0, plannedQuantity: 1 },
        { activityId: "act-1", month: 13, week: 7, plannedQuantity: 2 },
      ],
      catalog: CATALOG,
    })
    const sup = rows.find((row) => row.slug === "sup")!
    expect(sup.weekly[0]).toBe(1)
    expect(sup.weekly[3]).toBe(2)
    expect(sup.monthly[0]).toBe(1)
    expect(sup.monthly[11]).toBe(2)
    expect(sup.total).toBe(3)
  })

  it("ordena las filas por nombre visible", () => {
    const rows = computePdtpRoleLoad({
      activities: [
        { id: "act-1", responsibleSlugs: ["jt"] },
        { id: "act-2", responsibleSlugs: ["sup"] },
        { id: "act-3", responsibleSlugs: ["adm_contrato"] },
      ],
      cells: [],
      catalog: CATALOG,
    })
    expect(rows.map((row) => row.displayName)).toEqual(["Administrador de contrato", "Jefe de turno", "Supervisor"])
  })
})
