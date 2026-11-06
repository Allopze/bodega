import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { DRIVER_STATUS_RANK, resolveDriverStatus, type DriverStatusInput } from "@/lib/driver-license-status"
import {
  DRIVER_ATTENTION_STATUSES,
  DRIVER_LICENSE_CLASS_GROUPS,
  DRIVER_LICENSE_CLASS_INFO,
  DRIVER_LICENSE_CLASSES,
  DRIVER_LICENSE_NOTES_MAX,
  DRIVER_STATUSES,
  driverLicenseSchema,
  formatLicenseClassList,
  isDriverLicenseClass,
  licenseSatisfies,
  parseLicenseClasses,
  sortLicenseClasses,
} from "@/lib/validation/driver-licenses"

/**
 * Clases de licencia, lectura de la planilla y estado del conductor. El estado
 * lo comparten la pantalla `/flota/conductores`, el aviso diario y la
 * exportación: si cada uno lo calculara a su modo, el correo diría «vencida» de
 * alguien que la pantalla muestra vigente.
 */

describe("parseLicenseClasses — las formas que trae la planilla", () => {
  const cases: Array<[string, string[]]> = [
    ["A2/A4/A5/B", ["A2", "A4", "A5", "B"]],
    ["A2 Antigua/B", ["A2_ANTIGUA", "B"]],
    ["A2/A4/B/D", ["A2", "A4", "B", "D"]],
    ["A3/A5/B", ["A3", "A5", "B"]],
    ["a1,a2,b,d", ["A1", "A2", "B", "D"]],
    ["a3, a5", ["A3", "A5"]],
    ["b", ["B"]],
    ["A5", ["A5"]],
  ]
  it.each(cases)("«%s»", (raw, expected) => {
    expect(parseLicenseClasses(raw)).toEqual({ classes: expected, unrecognized: [] })
  })

  it("lo que no reconoce lo devuelve aparte y conserva el resto", () => {
    expect(parseLicenseClasses("XX/B")).toEqual({ classes: ["B"], unrecognized: ["XX"] })
    expect(parseLicenseClasses("Z9")).toEqual({ classes: [], unrecognized: ["Z9"] })
  })

  it("sin texto no hay clases ni nada sin reconocer", () => {
    for (const empty of [null, undefined, ""]) {
      expect(parseLicenseClasses(empty)).toEqual({ classes: [], unrecognized: [] })
    }
  })

  it("devuelve el orden canónico y sin repetidos, escriba como escriba la planilla", () => {
    expect(parseLicenseClasses("B/A5/b/A2").classes).toEqual(["A2", "A5", "B"])
  })

  it("acepta «Clase B», «y», sin tildes y abreviaturas de «antigua»", () => {
    expect(parseLicenseClasses("Clase B").classes).toEqual(["B"])
    expect(parseLicenseClasses("A4 y A5").classes).toEqual(["A4", "A5"])
    expect(parseLicenseClasses("A1 antígua/B").classes).toEqual(["A1_ANTIGUA", "B"])
    expect(parseLicenseClasses("A2 ant./B").classes).toEqual(["A2_ANTIGUA", "B"])
  })
})

describe("clases: orden, formato y coincidencia con el cargo", () => {
  it("sortLicenseClasses usa el orden de la lista, sin repetidos ni códigos ajenos", () => {
    expect(sortLicenseClasses(["B", "A5", "ZZ", "A5", "A2_ANTIGUA", "A1"])).toEqual(["A1", "A5", "A2_ANTIGUA", "B"])
    expect(sortLicenseClasses([])).toEqual([])
  })

  it("formatLicenseClassList arma «A2, A4 o B» para «su cargo exige …»", () => {
    expect(formatLicenseClassList(["A4", "A5"])).toBe("A4 o A5")
    expect(formatLicenseClassList(["B", "A2", "A4"])).toBe("A2, A4 o B")
    expect(formatLicenseClassList(["A4"])).toBe("A4")
    expect(formatLicenseClassList([])).toBe("")
    expect(formatLicenseClassList(["A4", "A5"], "y")).toBe("A4 y A5")
    expect(formatLicenseClassList(["A2_ANTIGUA", "B"])).toBe("A2 antigua o B")
  })

  it("licenseSatisfies: basta una coincidencia, y un cargo sin clases acepta cualquier licencia", () => {
    expect(licenseSatisfies(["A5"], ["A4", "A5"])).toBe(true)
    expect(licenseSatisfies(["B"], ["A4", "A5"])).toBe(false)
    expect(licenseSatisfies(["B"], [])).toBe(true)
    expect(licenseSatisfies([], ["B"])).toBe(false)
    expect(licenseSatisfies([], [])).toBe(true)
  })

  it("isDriverLicenseClass sólo acepta los códigos de la lista", () => {
    expect(isDriverLicenseClass("A2_ANTIGUA")).toBe(true)
    expect(isDriverLicenseClass("a2")).toBe(false)
    expect(isDriverLicenseClass("G")).toBe(false)
  })

  it("cada clase tiene su ficha y cada grupo de la ficha tiene su rótulo", () => {
    expect(Object.keys(DRIVER_LICENSE_CLASS_INFO).sort()).toEqual([...DRIVER_LICENSE_CLASSES].sort())
    for (const code of DRIVER_LICENSE_CLASSES) expect(DRIVER_LICENSE_CLASS_INFO[code].code).toBe(code)
    const groups = new Set(DRIVER_LICENSE_CLASS_GROUPS.map((group) => group.id))
    for (const info of Object.values(DRIVER_LICENSE_CLASS_INFO)) expect(groups.has(info.group)).toBe(true)
  })
})

describe("la restricción de la base repite exactamente DRIVER_LICENSE_CLASSES", () => {
  const read = (relative: string) => readFileSync(path.resolve(process.cwd(), relative), "utf8")
  const listsIn = (source: string) =>
    [...source.matchAll(/ARRAY\[([^\]]+)\]::text\[\]/g)].map((match) =>
      [...match[1]!.matchAll(/'([A-Z0-9_]+)'/g)].map((code) => code[1]!),
    )

  it("db/migrations/0374_naive_zaladane.sql: las dos restricciones (licencia y cargo)", () => {
    const lists = listsIn(read("db/migrations/0374_naive_zaladane.sql"))
    expect(lists).toHaveLength(2)
    for (const list of lists) expect(list).toEqual([...DRIVER_LICENSE_CLASSES])
  })

  it("db/schema: worker_driver_licenses y worker_positions declaran la misma lista", () => {
    const worksites = listsIn(read("db/schema/worksites.ts"))
    const positions = listsIn(read("db/schema/worker-positions.ts"))
    expect(worksites).toEqual([[...DRIVER_LICENSE_CLASSES]])
    expect(positions).toEqual([[...DRIVER_LICENSE_CLASSES]])
  })
})

describe("driverLicenseSchema", () => {
  const base = { workerId: "w-1", classes: ["A5", "B"], expiresAt: "2027-03-31", notes: null }

  it("acepta una licencia completa y la deja con clases sin repetir", () => {
    expect(driverLicenseSchema.parse({ ...base, classes: ["B", "B", "A5"] }).classes).toEqual(["B", "A5"])
  })

  it("la fecha puede faltar (la planilla trae licencias sin fecha)", () => {
    expect(driverLicenseSchema.safeParse({ ...base, expiresAt: null }).success).toBe(true)
  })

  it("exige al menos una clase y que cada una exista", () => {
    const none = driverLicenseSchema.safeParse({ ...base, classes: [] })
    expect(none.success).toBe(false)
    expect(none.error?.issues[0]?.message).toBe("Marca al menos una clase")
    expect(driverLicenseSchema.safeParse({ ...base, classes: ["Z"] }).success).toBe(false)
  })

  it("rechaza una fecha que no existe en el calendario", () => {
    expect(driverLicenseSchema.safeParse({ ...base, expiresAt: "2026-02-31" }).success).toBe(false)
    expect(driverLicenseSchema.safeParse({ ...base, expiresAt: "31-03-2027" }).success).toBe(false)
  })

  it("la observación admite hasta 300 caracteres", () => {
    expect(DRIVER_LICENSE_NOTES_MAX).toBe(300)
    expect(driverLicenseSchema.safeParse({ ...base, notes: "x".repeat(300) }).success).toBe(true)
    expect(driverLicenseSchema.safeParse({ ...base, notes: "x".repeat(301) }).success).toBe(false)
  })

  it("el trabajador es obligatorio", () => {
    expect(driverLicenseSchema.safeParse({ ...base, workerId: "  " }).success).toBe(false)
  })
})

describe("resolveDriverStatus — precedencia", () => {
  const TODAY = "2026-09-14"
  const input = (overrides: Partial<DriverStatusInput>): DriverStatusInput => ({
    requiresLicense: true,
    requiredClasses: ["A4", "A5"],
    license: { classes: ["A5", "B"], expiresAt: "2027-09-14" },
    today: TODAY,
    warningDays: 30,
    ...overrides,
  })

  it("vigente: clase que calza y fecha lejana", () => {
    expect(resolveDriverStatus(input({}))).toMatchObject({ status: "vigente", missingClasses: [] })
  })

  it("sin licencia, con un cargo que la exige", () => {
    expect(resolveDriverStatus(input({ license: null }))).toEqual({ status: "sin_licencia", expiry: null, missingClasses: [] })
  })

  it("vencida gana sobre todo lo demás, incluida la clase que no calza", () => {
    const result = resolveDriverStatus(input({ license: { classes: ["B"], expiresAt: "2026-09-13" } }))
    expect(result.status).toBe("vencida")
    expect(result.expiry).toMatchObject({ state: "vencido", days: -1 })
    expect(result.missingClasses).toEqual([])
  })

  it("vence hoy todavía no es vencida: es por vencer", () => {
    expect(resolveDriverStatus(input({ license: { classes: ["A5"], expiresAt: TODAY } })).status).toBe("por_vencer")
  })

  it("clase insuficiente gana sobre por vencer, y dice cuáles exigía el cargo", () => {
    const result = resolveDriverStatus(input({ license: { classes: ["B"], expiresAt: "2026-09-20" } }))
    expect(result.status).toBe("clase_insuficiente")
    expect(result.missingClasses).toEqual(["A4", "A5"])
  })

  it("clase insuficiente con fecha lejana sigue siendo clase insuficiente", () => {
    expect(resolveDriverStatus(input({ license: { classes: ["B"], expiresAt: "2028-01-01" } })).status).toBe("clase_insuficiente")
  })

  it("por vencer: calza la clase y vence dentro de la ventana", () => {
    expect(resolveDriverStatus(input({ license: { classes: ["A4"], expiresAt: "2026-10-14" } })).status).toBe("por_vencer")
    expect(resolveDriverStatus(input({ license: { classes: ["A4"], expiresAt: "2026-10-15" } })).status).toBe("vigente")
  })

  it("una licencia sin fecha no se puede controlar: sin_fecha, no vigente", () => {
    expect(resolveDriverStatus(input({ license: { classes: ["A5"], expiresAt: null } })).status).toBe("sin_fecha")
  })

  it("un cargo sin clases acepta cualquier licencia", () => {
    expect(resolveDriverStatus(input({ requiredClasses: [], license: { classes: ["C"], expiresAt: "2027-09-14" } })).status).toBe("vigente")
  })

  it("si el cargo no exige licencia, la clase no importa (pero el vencimiento sí)", () => {
    const vigente = resolveDriverStatus(input({ requiresLicense: false, requiredClasses: ["D"], license: { classes: ["B"], expiresAt: "2027-09-14" } }))
    expect(vigente.status).toBe("vigente")
    const vencida = resolveDriverStatus(input({ requiresLicense: false, license: { classes: ["B"], expiresAt: "2026-01-01" } }))
    expect(vencida.status).toBe("vencida")
  })

  it("sin licencia y sin exigencia no es «sin licencia»", () => {
    expect(resolveDriverStatus(input({ requiresLicense: false, license: null })).status).toBe("sin_fecha")
  })
})

describe("orden de urgencia", () => {
  it("DRIVER_STATUS_RANK ordena de lo que impide conducir a lo vigente", () => {
    const ordered = [...DRIVER_STATUSES].sort((a, b) => DRIVER_STATUS_RANK[a] - DRIVER_STATUS_RANK[b])
    expect(ordered).toEqual(["vencida", "sin_licencia", "clase_insuficiente", "sin_fecha", "por_vencer", "vigente"])
  })

  it("«Requieren atención» es todo menos vigente", () => {
    expect([...DRIVER_STATUSES].filter((status) => !DRIVER_ATTENTION_STATUSES.has(status))).toEqual(["vigente"])
  })
})
