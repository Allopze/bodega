import { describe, expect, it } from "vitest"
import { ANOMALY_RULE_CATALOG } from "@/lib/combustibles/anomaly-rule-catalog"
import { KNOWN_RULE_CODES } from "@/lib/combustibles/validation"
import {
  BATCH_ROW_LIMIT_PARAMETER,
  BATCH_RULE_CODES,
  describeRuleTrigger,
  diffMarkSnapshots,
  equipmentFamilyInputSchema,
  findAliasConflicts,
  isKnownRuleCode,
  mandanteInputSchema,
  mergeRuleParameters,
  normalizeAliases,
  parseDecimalInput,
  parseRuleConfig,
  performanceThresholdsSchema,
  PROVIDER_MAPPING_LABELS,
  providerMappingFromColumns,
  providerMappingToColumns,
  RULE_PARAMETERS,
  recomputeProgressLabel,
  recomputeSummaryText,
  ruleParametersFor,
  ruleParameterValue,
  slugify,
  supplyMediumInputSchema,
  uniqueSlug,
  type MarkSnapshot,
} from "./catalogs"

describe("parseDecimalInput", () => {
  it("acepta coma decimal, punto decimal y miles con punto", () => {
    expect(parseDecimalInput("2,5")).toBe(2.5)
    expect(parseDecimalInput(" 2.5 ")).toBe(2.5)
    expect(parseDecimalInput("1.234,5")).toBe(1234.5)
    expect(parseDecimalInput(3)).toBe(3)
  })
  it("rechaza texto, vacío e infinitos", () => {
    expect(parseDecimalInput("")).toBeNull()
    expect(parseDecimalInput("abc")).toBeNull()
    expect(parseDecimalInput("1,2,3")).toBeNull()
    expect(parseDecimalInput(Number.POSITIVE_INFINITY)).toBeNull()
    expect(parseDecimalInput(null)).toBeNull()
  })
})

describe("slugify / uniqueSlug", () => {
  it("quita tildes y signos", () => {
    expect(slugify("Surtidor CMPC · Planta Ñuble")).toBe("surtidor-cmpc-planta-nuble")
    expect(slugify("!!!")).toBe("medio")
  })
  it("agrega sufijo cuando el slug ya existe", () => {
    expect(uniqueSlug("tct", ["tct", "tct-2"])).toBe("tct-3")
    expect(uniqueSlug("nuevo", ["tct"])).toBe("nuevo")
  })
})

describe("normalizeAliases", () => {
  it("guarda en mayúsculas, sin vacíos ni repetidos", () => {
    expect(normalizeAliases(" cmpc , Surtidor  CMPC,, cmpc ;copec")).toEqual(["CMPC", "SURTIDOR CMPC", "COPEC"])
  })
  it("acepta una lista ya separada", () => {
    expect(normalizeAliases(["tae", "TAE "])).toEqual(["TAE"])
  })
})

describe("rótulos del mapeo de proveedor", () => {
  it("se dicen sin siglas: ni TCT ni TAE", () => {
    for (const label of Object.values(PROVIDER_MAPPING_LABELS)) expect(label).not.toMatch(/\bTCT\b|\bTAE\b/)
  })
})

describe("mapeo de proveedor", () => {
  it("ida y vuelta de cada opción", () => {
    for (const mapping of ["none", "copec_tct", "copec_tae"] as const) {
      const { providerCode, providerChannel } = providerMappingToColumns(mapping)
      expect(providerMappingFromColumns(providerCode, providerChannel)).toBe(mapping)
    }
  })
  it("rechaza el mapeo retirado de Aramco", () => {
    expect(providerMappingFromColumns("aramco", null)).toBe("none")
    expect(supplyMediumInputSchema.safeParse({ name: "Tarjeta", kind: "provider_station", providerMapping: "aramco" }).success).toBe(false)
  })
  it("un canal desconocido de Copec queda sin mapeo", () => {
    expect(providerMappingFromColumns("copec", null)).toBe("none")
  })
})

describe("mandanteInputSchema", () => {
  const base = { name: "  Arauco  ", clientId: null, tolerancePct: "2,5", isActive: true, worksiteIds: ["w1", "w1", "w2"] }
  it("acepta coma decimal, recorta y deduplica faenas", () => {
    const parsed = mandanteInputSchema.parse(base)
    expect(parsed.name).toBe("Arauco")
    expect(parsed.tolerancePct).toBe(2.5)
    expect(parsed.worksiteIds).toEqual(["w1", "w2"])
    expect(parsed.confirmMove).toBe(false)
  })
  it("rechaza tolerancia fuera de 0–100 o no numérica", () => {
    expect(mandanteInputSchema.safeParse({ ...base, tolerancePct: "101" }).success).toBe(false)
    expect(mandanteInputSchema.safeParse({ ...base, tolerancePct: "-1" }).success).toBe(false)
    expect(mandanteInputSchema.safeParse({ ...base, tolerancePct: "dos" }).success).toBe(false)
    expect(mandanteInputSchema.safeParse({ ...base, tolerancePct: "" }).success).toBe(false)
    expect(mandanteInputSchema.safeParse({ ...base, tolerancePct: "100" }).success).toBe(true)
    expect(mandanteInputSchema.safeParse({ ...base, tolerancePct: "0" }).success).toBe(true)
  })
  it("rechaza nombre corto", () => {
    expect(mandanteInputSchema.safeParse({ ...base, name: " a " }).success).toBe(false)
  })
})

describe("supplyMediumInputSchema", () => {
  const base = { name: "Surtidor CMPC", kind: "mandante_dispenser", fuelSupplierId: null, providerMapping: "none", aliases: "cmpc, surtidor cmpc", sortOrder: "5", isActive: true }
  it("normaliza alias y deriva proveedor y canal", () => {
    const parsed = supplyMediumInputSchema.parse({ ...base, providerMapping: "copec_tae" })
    expect(parsed.aliases).toEqual(["CMPC", "SURTIDOR CMPC"])
    expect(parsed.providerCode).toBe("copec")
    expect(parsed.providerChannel).toBe("TAE")
    expect(parsed.sortOrder).toBe(5)
  })
  it("rechaza tipo inválido, orden fraccionario y demasiados alias", () => {
    expect(supplyMediumInputSchema.safeParse({ ...base, kind: "otro" }).success).toBe(false)
    expect(supplyMediumInputSchema.safeParse({ ...base, sortOrder: "1,5" }).success).toBe(false)
    const many = Array.from({ length: 31 }, (_, index) => `alias${index}`).join(",")
    const result = supplyMediumInputSchema.safeParse({ ...base, aliases: many })
    expect(result.success).toBe(false)
  })
  it("orden vacío = 0", () => {
    expect(supplyMediumInputSchema.parse({ ...base, sortOrder: "" }).sortOrder).toBe(0)
  })
})

describe("findAliasConflicts", () => {
  it("detecta alias de otro medio y ignora el propio", () => {
    const others = [{ id: "a", name: "TCT", aliases: ["TCT", "TARJETA"] }, { id: "b", name: "CMPC", aliases: ["CMPC"] }]
    expect(findAliasConflicts(["TARJETA", "NUEVO"], others, "b")).toEqual([{ alias: "TARJETA", mediumName: "TCT" }])
    expect(findAliasConflicts(["CMPC"], others, "b")).toEqual([])
  })
})

describe("equipmentFamilyInputSchema", () => {
  it("acepta una familia o null (fuera de las vistas)", () => {
    expect(equipmentFamilyInputSchema.safeParse({ equipmentTypeId: "t", family: "camiones" }).success).toBe(true)
    expect(equipmentFamilyInputSchema.safeParse({ equipmentTypeId: "t", family: null }).success).toBe(true)
    expect(equipmentFamilyInputSchema.safeParse({ equipmentTypeId: "t", family: "heavy" }).success).toBe(false)
  })
})

describe("performanceThresholdsSchema", () => {
  const ok = { minSamples: "5", maxKmPerLiter: "25", maxLitersPerHour: "80,5", duplicateWindowMinutes: "15", duplicateLitersTolerance: "0,5" }
  it("lee números con coma", () => {
    expect(performanceThresholdsSchema.parse(ok)).toEqual({ minSamples: 5, maxKmPerLiter: 25, maxLitersPerHour: 80.5, duplicateWindowMinutes: 15, duplicateLitersTolerance: 0.5 })
  })
  it("rechaza enteros fraccionarios y cotas imposibles", () => {
    expect(performanceThresholdsSchema.safeParse({ ...ok, minSamples: "1" }).success).toBe(false)
    expect(performanceThresholdsSchema.safeParse({ ...ok, minSamples: "5,5" }).success).toBe(false)
    expect(performanceThresholdsSchema.safeParse({ ...ok, maxKmPerLiter: "0" }).success).toBe(false)
    expect(performanceThresholdsSchema.safeParse({ ...ok, duplicateLitersTolerance: "-1" }).success).toBe(false)
  })
})

describe("recomputeProgressLabel", () => {
  it("singular y plural", () => {
    expect(recomputeProgressLabel(1, 1)).toBe("1 de 1 equipo")
    expect(recomputeProgressLabel(50, 130)).toBe("50 de 130 equipos")
  })
})

describe("reglas de detección: parámetros en palabras", () => {
  it("describe cada regla con el valor configurado o, si falta, el que aplica el motor", () => {
    expect(describeRuleTrigger("exceso_cargas_ventana", '{"maxLoads":3,"windowHours":24}')).toBe("Avisa si un equipo carga 3 veces o más en 24 horas.")
    expect(describeRuleTrigger("exceso_cargas_ventana", '{"maxLoads":1,"windowHours":1}')).toBe("Avisa si un equipo carga 1 vez o más en 1 hora.")
    expect(describeRuleTrigger("exceso_cargas_ventana", "{}")).toBe("Avisa si un equipo carga 3 veces o más en 2 horas.")
    expect(describeRuleTrigger("litros_supera_capacidad", '{"margin":0.05}')).toBe("Avisa si una carga supera la capacidad del estanque en más de 5 %.")
    expect(describeRuleTrigger("litros_supera_capacidad", '{"margin":0.075}')).toContain("7,5 %")
    expect(describeRuleTrigger("variacion_brusca_consumo", '{"thresholdPct":30}')).toBe("Avisa si el consumo del período varía más de 30 % respecto del anterior.")
    expect(describeRuleTrigger("rendimiento_fuera_historico", '{"thresholdStdDevs":2.5,"minSample":8}')).toBe(
      "Avisa si el rendimiento se aleja más de 2,5 veces su variación normal, con al menos 8 cargas previas del equipo.",
    )
    expect(describeRuleTrigger("salto_medidor_implausible", "{}")).toBe("Avisa si el medidor avanza más de 1.500 km (o 24 horas) por día entre dos cargas.")
  })

  it("avisa de las excepciones por tipo de equipo", () => {
    const text = describeRuleTrigger("variacion_brusca_consumo", '{"thresholdPct":50,"equipmentTypes":{"a":{"thresholdPct":30},"b":{"thresholdPct":70}}}')
    expect(text.endsWith("Con excepciones para 2 tipos de equipo.")).toBe(true)
    expect(describeRuleTrigger("variacion_brusca_consumo", '{"equipmentTypes":{"a":{}}}')).toContain("1 tipo de equipo")
  })

  it("nombra las fotos exigidas, y las reglas sin parámetros dicen que saltan siempre", () => {
    expect(describeRuleTrigger("evidencia_faltante", '{"requiredKinds":["odometer","removed_seal"]}')).toBe(
      "Avisa si la carga en terreno no trae la foto de el tablero (odómetro u horómetro), el sello retirado.",
    )
    expect(describeRuleTrigger("sello_repetido", "{}")).toBe("Siempre que ocurre.")
    expect(describeRuleTrigger("carga_fuera_horario", "{}")).toBe("Según el horario de operación de la ficha de cada equipo.")
  })

  it("un código que el motor no conoce o un JSON ilegible se dicen tal cual", () => {
    expect(describeRuleTrigger("regla_inventada", "{}")).toContain("no se evalúa")
    expect(describeRuleTrigger("sello_repetido", "{nope")).toContain("no se puede leer")
    expect(describeRuleTrigger("sello_repetido", null)).toBe("Siempre que ocurre.")
  })

  it("lee el JSON sin reemplazarlo en silencio por {}", () => {
    expect(parseRuleConfig("")).toEqual({})
    expect(parseRuleConfig(null)).toEqual({})
    expect(parseRuleConfig('{"a":1}')).toEqual({ a: 1 })
    expect(parseRuleConfig("{nope")).toBeNull()
    expect(parseRuleConfig("[1,2]")).toBeNull()
    expect(parseRuleConfig("7")).toBeNull()
  })

  it("muestra el margen en porcentaje aunque se guarde como fracción", () => {
    const [margin] = ruleParametersFor("litros_supera_capacidad")
    expect(ruleParameterValue(margin!, { margin: 0.05 })).toBe(5)
    expect(ruleParameterValue(margin!, { margin: 0.075 })).toBe(7.5)
    expect(ruleParameterValue(margin!, {})).toBeUndefined()
  })

  it("mezcla los campos en el JSON: convierte, respeta lo que no conoce y un campo vacío quita la clave", () => {
    const parameters = ruleParametersFor("litros_supera_capacidad")
    const merged = mergeRuleParameters(parameters, { margin: 0.05, equipmentTypes: { grua: { margin: 0.1 } } }, { margin: "7,5" })
    expect(merged.errors).toEqual({})
    expect(merged.config).toEqual({ margin: 0.075, equipmentTypes: { grua: { margin: 0.1 } } })
    expect(mergeRuleParameters(parameters, { margin: 0.05, otra: 1 }, { margin: " " }).config).toEqual({ otra: 1 })
    // Un parámetro que no llegó en el formulario deja el JSON como estaba.
    expect(mergeRuleParameters(parameters, { margin: 0.05 }, {}).config).toEqual({ margin: 0.05 })
  })

  it("rechaza texto, fuera de rango y decimales donde se pide un entero, con el nombre del campo", () => {
    const parameters = ruleParametersFor("exceso_cargas_ventana")
    expect(mergeRuleParameters(parameters, {}, { maxLoads: "tres" }).errors.maxLoads).toContain("escribe un número")
    expect(mergeRuleParameters(parameters, {}, { maxLoads: "0" }).errors.maxLoads).toContain("debe estar entre 1 y 50")
    expect(mergeRuleParameters(parameters, {}, { windowHours: "2,5" }).errors.windowHours).toContain("número entero")
    expect(mergeRuleParameters([BATCH_ROW_LIMIT_PARAMETER], {}, { batchRowLimit: "50" }).errors.batchRowLimit).toContain("entre 100 y 1.000.000")
    // «50.000» son cincuenta mil, no cincuenta: el punto es separador de miles en los enteros.
    expect(mergeRuleParameters([BATCH_ROW_LIMIT_PARAMETER], {}, { batchRowLimit: "50.000" }).config).toEqual({ batchRowLimit: 50000 })
    expect(mergeRuleParameters(ruleParametersFor("salto_medidor_implausible"), {}, { maxKmPerDay: "1.200" }).config).toEqual({ maxKmPerDay: 1200 })
    expect(mergeRuleParameters(ruleParametersFor("exceso_cargas_ventana"), {}, { maxLoads: "1.5" }).errors.maxLoads).toContain("número entero")
  })

  it("los parámetros con campo propio son de reglas del catálogo, y sus valores por omisión coinciden con los sembrados", () => {
    for (const code of Object.keys(RULE_PARAMETERS)) expect(KNOWN_RULE_CODES).toContain(code)
    for (const code of BATCH_RULE_CODES) expect(isKnownRuleCode(code)).toBe(true)
    for (const rule of ANOMALY_RULE_CATALOG) {
      for (const parameter of ruleParametersFor(rule.code)) {
        const seeded = rule.config[parameter.key]
        if (typeof seeded === "number") expect(seeded * (parameter.displayFactor ?? 1)).toBeCloseTo(parameter.defaultValue, 6)
      }
    }
  })

  it("reconoce los códigos del motor", () => {
    expect(isKnownRuleCode("sello_repetido")).toBe(true)
    expect(isKnownRuleCode("regla_inventada")).toBe(false)
  })
})

describe("recálculo de series: qué cambió", () => {
  const snapshot = (rows: Array<[string, string, string]>): MarkSnapshot => new Map(rows.map(([id, reviewStatus, signature]) => [id, { reviewStatus, signature }]))

  it("cuenta las cargas cuya marca cambió, y cuántas pasaron a por decidir o dejaron de estarlo", () => {
    const before = snapshot([["a", "ok", "1"], ["b", "flagged", "2"], ["c", "ok", "3"], ["d", "approved", "4"], ["e", "ok", "5"]])
    const after = snapshot([["a", "flagged", "1x"], ["b", "ok", "2x"], ["c", "ok", "3"], ["d", "approved", "4x"], ["e", "ok", "5"], ["nueva", "flagged", "9"]])
    expect(diffMarkSnapshots(before, after)).toEqual({ changedLoads: 3, flagged: 1, released: 1 })
  })

  it("sin diferencias no hay cambios", () => {
    const same = snapshot([["a", "ok", "1"]])
    expect(diffMarkSnapshots(same, snapshot([["a", "ok", "1"]]))).toEqual({ changedLoads: 0, flagged: 0, released: 0 })
    expect(diffMarkSnapshots(new Map(), new Map())).toEqual({ changedLoads: 0, flagged: 0, released: 0 })
  })

  it("lo dice en palabras, en singular y plural", () => {
    expect(recomputeSummaryText({ equipment: 130, changedLoads: 12, flagged: 9, released: 3, stopped: false })).toBe(
      "Se recalcularon 130 equipos. 12 cargas cambiaron: 9 pasaron a «Por decidir» y 3 dejaron de estarlo.",
    )
    expect(recomputeSummaryText({ equipment: 1, changedLoads: 1, flagged: 1, released: 0, stopped: false })).toBe(
      "Se recalcularon 1 equipo. 1 carga cambió: 1 pasó a «Por decidir».",
    )
    expect(recomputeSummaryText({ equipment: 25, changedLoads: 0, flagged: 0, released: 0, stopped: false })).toBe("Se recalcularon 25 equipos. Ninguna carga cambió.")
    expect(recomputeSummaryText({ equipment: 50, changedLoads: 2, flagged: 0, released: 2, stopped: true })).toBe(
      "Recálculo detenido tras 50 equipos. 2 cargas cambiaron: 2 dejaron de estarlo.",
    )
  })
})
