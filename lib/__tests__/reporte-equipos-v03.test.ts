/**
 * Reporte de Equipos v03 (2026-11-17), tras revisar 30 papeles reales.
 *
 * Cada mejora es un campo opcional de la definición que se lee del SNAPSHOT de
 * la plantilla; estas pruebas fijan las dos mitades: que la v03 los declara y
 * que una plantilla anterior que no los trae se comporta exactamente igual que
 * antes.
 */
import { describe, expect, it } from "vitest"
import { REPORTE_EQUIPOS } from "@/lib/sst/definitions/reporte-equipos"
import {
  assessRunCompletion,
  closingActFromDefinition,
  definitionForVehicleType,
  effectiveRequiredItems,
  inspectionFrequencyLabel,
  isSunday,
  nextDueAfter,
  notLessThanProblem,
  programSkipsSundays,
  resolveProgramSlot,
  sectionAppliesToVehicleType,
  skipSunday,
  summarizeCompliance,
  validateClosingAct,
  MISSING_PAPER_SIGNATURE_LABEL,
  type InspectionAnswerInput,
  type InspectionItemSpec,
} from "@/lib/prevention/inspections"
import type { ChecklistDefinition } from "@/lib/sst/types"

function itemsOf(definition: Pick<ChecklistDefinition, "sections">): InspectionItemSpec[] {
  return definition.sections.flatMap((section) =>
    section.items.map((item) => ({
      sectionId: section.id,
      itemId: item.id,
      label: item.label,
      required: item.required ?? false,
      countsForCompliance: section.countsForCompliance ?? true,
      danoPotencial: item.danoPotencial ?? null,
      kind: item.kind,
      options: item.options,
      placeholder: item.placeholder,
      ...(item.notLessThanItemId ? { notLessThanItemId: item.notLessThanItemId } : {}),
    })),
  )
}

const itemKeys = (definition: Pick<ChecklistDefinition, "sections">) => itemsOf(definition).map((item) => `${item.sectionId}::${item.itemId}`)

/** Respuestas válidas para todo lo que el cierre exige. */
function answersForRequired(items: InspectionItemSpec[], overrides: Record<string, string> = {}): InspectionAnswerInput[] {
  return effectiveRequiredItems(items).map((item) => {
    const scorable = item.kind !== "number" && item.kind !== "text" && item.kind !== "select"
    return scorable
      ? { sectionId: item.sectionId, itemId: item.itemId, result: "conforming" as const }
      : { sectionId: item.sectionId, itemId: item.itemId, result: "recorded" as const, value: overrides[item.itemId] ?? "140000" }
  })
}

const answer = (itemId: string, value: string): InspectionAnswerInput =>
  ({ sectionId: "horometro", itemId, result: "recorded", value })

describe("v03 · lo que declara la definición", () => {
  it("es la versión 03 del 2026-11-17 y declara los cuatro campos nuevos", () => {
    expect(REPORTE_EQUIPOS.version).toBe("03")
    expect(REPORTE_EQUIPOS.revisionDate).toBe("2026-11-17")
    expect(REPORTE_EQUIPOS.scheduleSkipsSundays).toBe(true)
    expect(REPORTE_EQUIPOS.closingAct?.allowMissingSignatures).toBe(true)
    const section = (id: string) => REPORTE_EQUIPOS.sections.find((entry) => entry.id === id)!
    expect(section("exclusivo_carga").appliesToVehicleTypes).toEqual(["cargador", "excavadora", "retroexcavadora", "minicargador"])
    expect(section("exclusivo_camion").appliesToVehicleTypes).toEqual(["camion", "camion_3_4"])
    expect(section("estado_acoplado").appliesToVehicleTypes).toEqual(["camion", "tracto"])
    // La sección común y las de cabecera no se filtran nunca.
    expect(section("estado_camion").appliesToVehicleTypes).toBeUndefined()
    const termino = section("horometro").items.find((item) => item.id === "horometro_termino")!
    expect(termino.notLessThanItemId).toBe("horometro_inicio")
  })

  it("deja de exigir turno, área y los dos horómetros, y sigue exigiendo el operador entrante", () => {
    const items = itemsOf(REPORTE_EQUIPOS)
    const required = new Set(effectiveRequiredItems(items).map((item) => item.itemId))
    // Bajar `required` no los vuelve a exigir por otra vía: no puntúan (número, texto, select).
    // El horómetro de inicio también: el reporte de un equipo fuera de servicio no trae lectura (N° 023502).
    for (const itemId of ["turno", "area_trabajo", "horometro_inicio", "horometro_termino"]) {
      expect(required.has(itemId), itemId).toBe(false)
      expect(items.find((item) => item.itemId === itemId)!.countsForCompliance).toBe(false)
    }
    expect(required.has("operador_entrante")).toBe(true)
  })

  it("un papel con término, turno, área y firmas en blanco se puede declarar ejecutado", () => {
    const items = itemsOf(REPORTE_EQUIPOS)
    const answers = answersForRequired(items)
    expect(answers.some((entry) => entry.itemId === "horometro_termino")).toBe(false)
    const spec = closingActFromDefinition(REPORTE_EQUIPOS)
    const act = { result: "operativo", signatures: [{ role: "operador_entrante", name: "Juan Pérez" }] }
    expect(assessRunCompletion(items, answers, { spec, act })).toMatchObject({ allowed: true, blockers: [] })
  })
})

describe("v03 · lunes a sábado", () => {
  it("reconoce el domingo y salta al lunes", () => {
    expect(isSunday("2026-11-15")).toBe(true)
    expect(isSunday("2026-11-14")).toBe(false)
    expect(isSunday("2026-11-16")).toBe(false)
    expect(skipSunday("2026-11-15")).toBe("2026-11-16")
    expect(skipSunday("2026-11-14")).toBe("2026-11-14")
    // Cruza el fin de mes y de año sin romperse.
    expect(isSunday("2026-11-29")).toBe(true)
    expect(skipSunday("2026-11-29")).toBe("2026-11-30")
    expect(skipSunday("2023-12-31")).toBe("2024-01-01")
  })

  it("sólo un programa diario con el campo en el snapshot salta domingos", () => {
    expect(programSkipsSundays("daily", { scheduleSkipsSundays: true })).toBe(true)
    // Una plantilla v02 (sin el campo) o con el campo apagado se programa como siempre.
    expect(programSkipsSundays("daily", { version: "02" })).toBe(false)
    expect(programSkipsSundays("daily", { scheduleSkipsSundays: false })).toBe(false)
    expect(programSkipsSundays("daily", {})).toBe(false)
    expect(programSkipsSundays("daily", null)).toBe(false)
    expect(programSkipsSundays("daily", undefined)).toBe(false)
    // Y el campo sólo manda con frecuencia diaria.
    expect(programSkipsSundays("weekly", { scheduleSkipsSundays: true })).toBe(false)
    expect(programSkipsSundays("daily", { scheduleSkipsSundays: "true" })).toBe(false)
  })

  it("la siguiente fecha de un diario nunca es domingo", () => {
    // Ejecutada el sábado 14: el siguiente día es el domingo 15, que pasa al lunes 16.
    expect(nextDueAfter("2026-11-14", 1, "2026-11-14", { skipSundays: true })).toBe("2026-11-16")
    // Sin el campo, igual que siempre: el domingo.
    expect(nextDueAfter("2026-11-14", 1, "2026-11-14")).toBe("2026-11-15")
    // Entre semana no cambia nada.
    expect(nextDueAfter("2026-11-16", 1, "2026-11-16", { skipSundays: true })).toBe("2026-11-17")
  })

  it("un diario atrasado varias semanas genera una sola fecha futura y no cae en domingo", () => {
    // Vencido desde hace ~6 semanas; hoy sábado 21: rueda hasta el domingo 22, que pasa al lunes 23.
    expect(nextDueAfter("2026-10-05", 1, "2026-11-21", { skipSundays: true })).toBe("2026-11-23")
    // Hoy un día cualquiera: rueda a mañana.
    expect(nextDueAfter("2026-10-05", 1, "2026-11-18", { skipSundays: true })).toBe("2026-11-19")
    // Hoy domingo: mañana lunes.
    expect(nextDueAfter("2026-10-05", 1, "2026-11-22", { skipSundays: true })).toBe("2026-11-23")
    // Barrido de un año de cierres: ninguna fecha resultante es domingo ni pasada.
    for (let offset = 0; offset < 370; offset += 1) {
      const today = new Date(Date.UTC(2026, 0, 1 + offset, 12)).toISOString().slice(0, 10)
      const next = nextDueAfter("2025-06-02", 1, today, { skipSundays: true })
      expect(isSunday(next), `${today} -> ${next}`).toBe(false)
      expect(next > today, `${today} -> ${next}`).toBe(true)
    }
  })

  it("un diario con salto de domingos no altera las demás cadencias", () => {
    expect(nextDueAfter("2026-11-01", 30, "2026-11-01")).toBe("2026-12-01")
    expect(nextDueAfter("2026-11-01", 7, "2026-11-01", { skipSundays: false })).toBe("2026-11-08")
  })

  it("el materializador no crea el domingo: si hoy es domingo sólo mueve la fecha al lunes", () => {
    expect(resolveProgramSlot({ nextDueOn: "2026-11-15", today: "2026-11-15", skipSundays: true, manual: false }))
      .toEqual({ action: "advance", scheduledFor: "2026-11-16" })
  })

  it("si el cron no corrió el domingo, el lunes crea la ejecución del lunes (nunca la del domingo)", () => {
    expect(resolveProgramSlot({ nextDueOn: "2026-11-15", today: "2026-11-16", skipSundays: true, manual: false }))
      .toEqual({ action: "create", scheduledFor: "2026-11-16" })
  })

  it("un vencimiento entre semana se crea como siempre, atrasado o no", () => {
    expect(resolveProgramSlot({ nextDueOn: "2026-10-05", today: "2026-11-21", skipSundays: true, manual: false }))
      .toEqual({ action: "create", scheduledFor: "2026-10-05" })
    expect(resolveProgramSlot({ nextDueOn: "2026-11-17", today: "2026-11-17", skipSundays: true, manual: false }))
      .toEqual({ action: "create", scheduledFor: "2026-11-17" })
  })

  it("«Ejecutar ahora» siempre crea, pero con el primer día hábil", () => {
    expect(resolveProgramSlot({ nextDueOn: "2026-11-15", today: "2026-11-15", skipSundays: true, manual: true }))
      .toEqual({ action: "create", scheduledFor: "2026-11-16" })
  })

  it("una plantilla v02 (sin el campo) sigue creando ejecuciones en domingo", () => {
    expect(resolveProgramSlot({ nextDueOn: "2026-11-15", today: "2026-11-15", skipSundays: false, manual: false }))
      .toEqual({ action: "create", scheduledFor: "2026-11-15" })
    expect(resolveProgramSlot({ nextDueOn: "2026-11-15", today: "2026-11-15", skipSundays: programSkipsSundays("daily", { version: "02" }), manual: true }))
      .toEqual({ action: "create", scheduledFor: "2026-11-15" })
  })

  it("rotula la frecuencia como «Diaria (lunes a sábado)» sólo para esos programas", () => {
    expect(inspectionFrequencyLabel("daily", { skipsSundays: true })).toBe("Diaria (lunes a sábado)")
    expect(inspectionFrequencyLabel("daily")).toBe("Diaria")
    expect(inspectionFrequencyLabel("daily", { skipsSundays: false })).toBe("Diaria")
    expect(inspectionFrequencyLabel("weekly", { skipsSundays: true })).toBe("Semanal")
    expect(inspectionFrequencyLabel("desconocida")).toBe("desconocida")
  })
})

describe("v03 · secciones que no aplican al equipo", () => {
  const visibleSections = (type: string | null) =>
    definitionForVehicleType(REPORTE_EQUIPOS, type).sections.map((section) => section.id)
  const CONDICIONALES = ["exclusivo_carga", "exclusivo_camion", "estado_acoplado"]

  it("cada tipo ve sólo los bloques que le tocan", () => {
    expect(visibleSections("cargador").filter((id) => CONDICIONALES.includes(id))).toEqual(["exclusivo_carga"])
    expect(visibleSections("excavadora").filter((id) => CONDICIONALES.includes(id))).toEqual(["exclusivo_carga"])
    expect(visibleSections("retroexcavadora").filter((id) => CONDICIONALES.includes(id))).toEqual(["exclusivo_carga"])
    expect(visibleSections("minicargador").filter((id) => CONDICIONALES.includes(id))).toEqual(["exclusivo_carga"])
    expect(visibleSections("camion").filter((id) => CONDICIONALES.includes(id))).toEqual(["exclusivo_camion", "estado_acoplado"])
    expect(visibleSections("camion_3_4").filter((id) => CONDICIONALES.includes(id))).toEqual(["exclusivo_camion"])
    expect(visibleSections("tracto").filter((id) => CONDICIONALES.includes(id))).toEqual(["estado_acoplado"])
  })

  it("una grúa horquilla queda sin las tres secciones y conserva las demás", () => {
    const ids = visibleSections("grua_horquilla")
    for (const id of CONDICIONALES) expect(ids).not.toContain(id)
    expect(ids).toEqual(["identificacion", "horometro", "control_mantencion", "estado_camion", "observaciones"])
    // Y sus ítems desaparecen también del aplanado que usa el motor.
    const keys = itemKeys(definitionForVehicleType(REPORTE_EQUIPOS, "grua_horquilla"))
    expect(keys.some((key) => key.startsWith("estado_acoplado::") || key.startsWith("exclusivo_"))).toBe(false)
  })

  it("sin equipo o con un tipo desconocido se muestra todo, como en la v02", () => {
    for (const type of [null, undefined, "", "   "]) {
      expect(definitionForVehicleType(REPORTE_EQUIPOS, type)).toBe(REPORTE_EQUIPOS)
    }
    // Un tipo cualquiera que no está en ninguna lista SÍ pierde los bloques condicionales;
    // «desconocido» es el caso en que el tipo no se pudo leer (ver `getRunVehicleType`).
    expect(visibleSections("tractor")).not.toContain("exclusivo_carga")
  })

  it("compara ignorando mayúsculas y espacios", () => {
    expect(sectionAppliesToVehicleType({ appliesToVehicleTypes: ["cargador"] }, " Cargador ")).toBe(true)
    expect(sectionAppliesToVehicleType({ appliesToVehicleTypes: ["cargador"] }, "camion")).toBe(false)
    expect(sectionAppliesToVehicleType({ appliesToVehicleTypes: [] }, "camion")).toBe(true)
    expect(sectionAppliesToVehicleType({}, "camion")).toBe(true)
  })

  it("una plantilla sin el campo (v02) no se filtra: es el mismo objeto", () => {
    const v02: ChecklistDefinition = {
      ...REPORTE_EQUIPOS,
      version: "02",
      sections: REPORTE_EQUIPOS.sections.map(({ appliesToVehicleTypes: _omit, ...section }) => section),
    }
    expect(definitionForVehicleType(v02, "grua_horquilla")).toBe(v02)
    expect(itemKeys(definitionForVehicleType(v02, "grua_horquilla"))).toEqual(itemKeys(v02))
  })

  it("una definición sin `sections` (fixture legado) se devuelve intacta", () => {
    const legacy = {} as ChecklistDefinition
    expect(definitionForVehicleType(legacy, "grua_horquilla")).toBe(legacy)
  })

  it("una sección que puntúa y no aplica deja de exigirse y de contar; si aplica, se exige", () => {
    const definition: ChecklistDefinition = {
      ...REPORTE_EQUIPOS,
      sections: [
        { id: "comun", title: "Común", countsForCompliance: true, items: [{ id: "luces", label: "Luces.", kind: "cumple_nocumple_na_obs" }] },
        {
          id: "solo_carga", title: "Sólo carga", countsForCompliance: true, appliesToVehicleTypes: ["cargador"],
          items: [{ id: "balde", label: "Balde.", kind: "cumple_nocumple_na_obs" }],
        },
      ],
    }
    const common: InspectionAnswerInput = { sectionId: "comun", itemId: "luces", result: "conforming" }

    const camion = itemsOf(definitionForVehicleType(definition, "camion"))
    expect(assessRunCompletion(camion, [common])).toMatchObject({ allowed: true, blockers: [] })
    expect(summarizeCompliance(camion, [common]).compliancePercent).toBe(100)

    const cargador = itemsOf(definitionForVehicleType(definition, "cargador"))
    const blocked = assessRunCompletion(cargador, [common])
    expect(blocked.allowed).toBe(false)
    expect(blocked.blockers).toContainEqual(expect.objectContaining({ kind: "missing_required", itemId: "balde" }))
    // Y cuenta para el porcentaje sólo cuando aplica.
    expect(summarizeCompliance(cargador, [common, { sectionId: "solo_carga", itemId: "balde", result: "non_conforming", comment: "roto" }]).compliancePercent).toBe(50)
  })
})

describe("v03 · horómetro de término no menor que el de inicio", () => {
  const items = itemsOf(REPORTE_EQUIPOS)
  const base = answersForRequired(items, { horometro_inicio: "140000" }).filter((entry) => entry.itemId !== "horometro_inicio")
  const run = (inicio: string | null, termino: string | null) => {
    const answers = [
      ...base,
      ...(inicio === null ? [] : [answer("horometro_inicio", inicio)]),
      ...(termino === null ? [] : [answer("horometro_termino", termino)]),
    ]
    return assessRunCompletion(items, answers)
  }

  it("bloquea con un mensaje claro cuando el término es menor", () => {
    const result = run("140000", "135120")
    expect(result.allowed).toBe(false)
    expect(result.blockers).toEqual([expect.objectContaining({
      kind: "invalid_value",
      sectionId: "horometro",
      itemId: "horometro_termino",
      detail: "El horómetro término (135120) es menor que el horómetro inicio (140000).",
    })])
  })

  it("acepta igual, mayor, y coma decimal como `readMeterFromRun`", () => {
    expect(run("140000", "140000").allowed).toBe(true)
    expect(run("140000", "140350").allowed).toBe(true)
    expect(run("140000,5", "140000,5").allowed).toBe(true)
    expect(run("140000,5", "140001,25").allowed).toBe(true)
    // La coma cuenta: 140000,4 < 140000,5.
    expect(run("140000,5", "140000,4").blockers.map((entry) => entry.kind)).toEqual(["invalid_value"])
    expect(run("140000.5", "140000.4").allowed).toBe(false)
  })

  it("no se dispara con alguno de los dos horómetros en blanco (equipo fuera de servicio, papel sin lectura)", () => {
    expect(run("140000", null).allowed).toBe(true)
    expect(run(null, "100").allowed).toBe(true)
  })

  it("el formulario dice lo mismo que el servidor", () => {
    const termino = items.find((item) => item.itemId === "horometro_termino")!
    const valueOf = (_section: string, itemId: string) => ({ horometro_inicio: "140000", horometro_termino: "135120" } as Record<string, string>)[itemId]
    expect(notLessThanProblem(termino, items, valueOf)).toBe(run("140000", "135120").blockers[0]!.detail)
    expect(notLessThanProblem(termino, items, (_s, itemId) => (itemId === "horometro_termino" ? "" : "140000"))).toBeNull()
    expect(notLessThanProblem(termino, items, () => undefined)).toBeNull()
    // Un ítem sin la regla nunca falla.
    const inicio = items.find((item) => item.itemId === "horometro_inicio")!
    expect(notLessThanProblem(inicio, items, valueOf)).toBeNull()
  })

  it("una plantilla anterior sin `notLessThanItemId` no bloquea un término menor", () => {
    const v02 = items.map(({ notLessThanItemId: _omit, ...item }) => item)
    expect(assessRunCompletion(v02, [...base, answer("horometro_inicio", "140000"), answer("horometro_termino", "100")]).allowed).toBe(true)
  })
})

describe("v03 · firmas que el papel no trae", () => {
  const roles = ["operador_entrante", "operador_saliente", "supervisor_turno"]
  const v03 = closingActFromDefinition(REPORTE_EQUIPOS)!
  const { allowMissingSignatures: _flag, ...v02Act } = REPORTE_EQUIPOS.closingAct!
  const v02 = closingActFromDefinition({ closingAct: v02Act })!
  const act = (names: Record<string, string>) => ({
    result: "operativo",
    signatures: roles.map((role) => ({ role, name: names[role] ?? "" })),
  })

  it("la v03 no exige los roles que faltan", () => {
    expect(v03.allowMissingSignatures).toBe(true)
    expect(validateClosingAct(v03, act({ operador_entrante: "Ana" }))).toBeNull()
    expect(validateClosingAct(v03, act({}))).toBeNull()
    expect(validateClosingAct(v03, { result: "operativo", signatures: [] })).toBeNull()
    // Un espacio en blanco no es una firma.
    expect(validateClosingAct(v03, act({ operador_saliente: "   " }))).toBeNull()
  })

  it("lo demás del acta sigue exigiéndose", () => {
    expect(validateClosingAct(v03, null)).toMatch(/Falta completar el acta/)
    expect(validateClosingAct(v03, { result: "", signatures: [] })).toMatch(/Falta elegir el resultado/)
    expect(validateClosingAct(v03, { result: "otro", signatures: [] })).toMatch(/no corresponde a las opciones/)
  })

  it("la v02 (sin el campo) sigue exigiendo las tres firmas", () => {
    expect(v02.allowMissingSignatures).toBeUndefined()
    expect(validateClosingAct(v02, act({ operador_entrante: "Ana" }))).toBe("Faltan firmas del acta: Operador saliente, Supervisor turno.")
    expect(validateClosingAct(v02, act({}))).toMatch(/^Faltan firmas del acta: Operador entrante, Operador saliente, Supervisor turno\.$/)
    expect(validateClosingAct(v02, act({ operador_entrante: "Ana", operador_saliente: "Luis", supervisor_turno: "Eva" }))).toBeNull()
    // Y el bloqueo llega al cierre.
    const items = itemsOf(REPORTE_EQUIPOS)
    const closing = assessRunCompletion(items, answersForRequired(items), { spec: v02, act: act({}) })
    expect(closing.blockers).toContainEqual(expect.objectContaining({ kind: "missing_closing_act" }))
  })

  it("`allowMissingSignatures: false` o ausente no se arrastra al spec", () => {
    expect(closingActFromDefinition({ closingAct: { ...v02Act, allowMissingSignatures: false } })!.allowMissingSignatures).toBeUndefined()
  })

  it("dice «Sin firma en el papel» para la que falta", () => {
    expect(MISSING_PAPER_SIGNATURE_LABEL).toBe("Sin firma en el papel")
  })
})
