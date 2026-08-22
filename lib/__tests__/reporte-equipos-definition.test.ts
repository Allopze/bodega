/**
 * El Reporte de Equipos es una definición de datos: lo que puede romperse es la
 * coherencia entre sus ítems y las puertas del motor, no una rama de código.
 * Estas pruebas fijan justo eso, sin base de datos.
 */
import { describe, expect, it } from "vitest"
import { REPORTE_EQUIPOS } from "@/lib/sst/definitions/reporte-equipos"
import { REPORTE_EQUIPOS_FILAS } from "@/lib/sst/definitions/reporte-equipos-sections"
import { CHECKLIST_DEFINITIONS } from "@/lib/sst/definitions"
import {
  assessRunCompletion,
  deriveFindings,
  fieldKindIsScorable,
  requiresHumanConfirmation,
  summarizeCompliance,
  validateAnswerRow,
  type InspectionItemSpec,
} from "@/lib/prevention/inspections"
import type { ChecklistDefinition } from "@/lib/sst/types"

/** Copia local del aplanado del motor, para no arrastrar `@/db` a un test puro. */
function itemsOf(definition: ChecklistDefinition): InspectionItemSpec[] {
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
    })),
  )
}

const items = itemsOf(REPORTE_EQUIPOS)
const mandatory = items.filter((item) => item.required || (item.countsForCompliance && fieldKindIsScorable(item.kind)))

/** Respuesta válida según el tipo del ítem. */
function answerFor(item: InspectionItemSpec, result: "conforming" | "non_conforming" = "conforming") {
  if (!fieldKindIsScorable(item.kind)) {
    return {
      sectionId: item.sectionId,
      itemId: item.itemId,
      result: "recorded" as const,
      value: item.kind === "number" ? "134122" : item.kind === "select" ? "tarde" : "Patio madera",
    }
  }
  return { sectionId: item.sectionId, itemId: item.itemId, result, comment: null }
}

describe("Reporte de Equipos", () => {
  it("declara que el jefe de faena traspasa el papel sin crear una sesión de mecánico", () => {
    expect(REPORTE_EQUIPOS.applicableTo).toMatch(/registro físico del operador y del mecánico/i)
    expect(REPORTE_EQUIPOS.applicableTo).toMatch(/exclusivamente por el jefe de faena/i)
    expect(REPORTE_EQUIPOS.applicableTo).not.toMatch(/sesión|usuario mecánico|rol mecánico/i)
  })

  it("está registrado en el catálogo importable", () => {
    expect(CHECKLIST_DEFINITIONS["reporte_equipos"]).toBe(REPORTE_EQUIPOS)
  })

  it("no exige responder las secciones condicionales", () => {
    // Un camión sin acoplado y que no es cargador frontal no debería tener que
    // justificar por escrito un "No aplica" por cada ítem que no le toca.
    const condicionales = ["estado_acoplado", "exclusivo_carga", "exclusivo_camion"]
    for (const sectionId of condicionales) {
      const section = items.filter((item) => item.sectionId === sectionId)
      expect(section.length).toBeGreaterThan(0)
      expect(section.every((item) => !item.countsForCompliance && !item.required)).toBe(true)
    }
  })

  it("bloquea completar sin responder nada y deja pasar un camión simple", () => {
    expect(assessRunCompletion(items, []).allowed).toBe(false)
    const answers = mandatory.map((item) => answerFor(item))
    expect(assessRunCompletion(items, answers)).toMatchObject({ allowed: true, blockers: [] })
  })

  it("deja la cabecera fuera del porcentaje de cumplimiento", () => {
    const answers = mandatory.map((item) => answerFor(item))
    // Horómetro, turno y control de mantención son datos, no conformidad.
    expect(summarizeCompliance(items, answers).compliancePercent).toBe(100)
  })

  it("levanta hallazgo crítico en frenos y dirección, del camión y del acoplado", () => {
    const criticos = [
      "freno_servicio", "freno_estacionamiento", "direccion",
      "acoplado_freno_servicio", "acoplado_direccion",
    ]
    for (const itemId of criticos) {
      const item = items.find((entry) => entry.itemId === itemId)
      expect(item, itemId).toBeDefined()
      const [finding] = deriveFindings(items, [
        { sectionId: item!.sectionId, itemId, result: "non_conforming" },
      ])
      expect(finding?.criticality, itemId).toBe("critical")
    }
  })

  it("genera hallazgo aunque la sección no puntúe", () => {
    // `countsForCompliance: false` sólo saca el ítem del porcentaje; una falla
    // en el acoplado sigue siendo una falla que alguien debe corregir.
    const item = items.find((entry) => entry.itemId === "acoplado_freno_servicio")!
    expect(item.countsForCompliance).toBe(false)
    expect(deriveFindings(items, [{ sectionId: item.sectionId, itemId: item.itemId, result: "non_conforming" }])).toHaveLength(1)
  })

  it("rechaza el separador de miles del papel en el horómetro", () => {
    const item = items.find((entry) => entry.itemId === "horometro_inicio")!
    expect(item.kind).toBe("number")
    expect(validateAnswerRow(item, { result: "recorded", value: "134.122" })).toMatch(/separador de miles/i)
    // El mensaje propone el número corregido, que es el que quiso escribir.
    expect(validateAnswerRow(item, { result: "recorded", value: "134.122" })).toContain("134122")
    expect(validateAnswerRow(item, { result: "recorded", value: "134122" })).toBeNull()
    expect(validateAnswerRow(item, { result: "recorded", value: "134122,5" })).toBeNull()
    expect(validateAnswerRow(item, { result: "recorded", value: "abc" })).toMatch(/número válido/i)
    expect(validateAnswerRow(item, { result: "recorded", value: "-5" })).toMatch(/número válido/i)
  })

  it("trata el campo numérico como dato y no como conformidad", () => {
    const item = items.find((entry) => entry.itemId === "carga_combustible")!
    expect(fieldKindIsScorable(item.kind)).toBe(false)
    expect(validateAnswerRow(item, { result: "conforming" })).toMatch(/no se evalúa como cumple/i)
  })

  it("exige ratificar sólo los ítems que matan", () => {
    // El reconocimiento pre-llena todo, pero frenos, dirección y acople no
    // pueden quedar aprobados por omisión: leídos al revés dejan el equipo
    // operando con la falla que mata.
    const fatales = items.filter((item) => requiresHumanConfirmation(item))
    expect(fatales.map((item) => item.itemId).sort()).toEqual([
      "acoplado_direccion", "acoplado_freno_estacionamiento", "acoplado_freno_servicio",
      "direccion", "freno_estacionamiento", "freno_servicio",
    ])
    // El resto no bloquea: 28 confirmaciones serían un trámite que nadie lee.
    const bocina = items.find((item) => item.itemId === "bocina")!
    expect(requiresHumanConfirmation(bocina)).toBe(false)
  })

  it("no deja cerrar mientras un ítem fatal siga sin ratificar", () => {
    const answers = mandatory.map((item) => answerFor(item))
    expect(assessRunCompletion(items, answers).allowed).toBe(true)

    // Mismo conjunto, pero el freno lo puso la máquina y nadie lo miró.
    const conPendiente = answers.map((answer) => answer.itemId === "freno_servicio"
      ? { ...answer, needsConfirmation: true }
      : answer)
    const bloqueado = assessRunCompletion(items, conPendiente)
    expect(bloqueado.allowed).toBe(false)
    expect(bloqueado.blockers).toContainEqual({
      kind: "unconfirmed_critical",
      detail: "Estado de frenos — de servicio (pedal de freno).",
    })

    // Ratificarlo lo desbloquea, sin cambiar la respuesta.
    const ratificado = conPendiente.map((answer) => ({ ...answer, needsConfirmation: false }))
    expect(assessRunCompletion(items, ratificado).allowed).toBe(true)
  })

  it("ignora la marca en ítems que no son fatales", () => {
    // La ingesta sólo debería marcarlos en los fatales, pero si un cliente
    // manda la marca en otro ítem no puede trabar la subida entera.
    const answers = mandatory.map((item) => item.itemId === "bocina"
      ? { ...answerFor(item), needsConfirmation: true }
      : answerFor(item))
    expect(assessRunCompletion(items, answers).allowed).toBe(true)
  })

  it("conserva las 25 filas del papel en su orden exacto", () => {
    // El detector lee por posición de celda: si este orden se altera, la
    // fila N de la foto entra en el ítem equivocado y nadie se entera —
    // "Normal" en la fila de al lado se ve igual de plausible.
    expect(REPORTE_EQUIPOS_FILAS.map((item) => item.id)).toEqual([
      "luces", "baliza", "bocina", "alarma_retroceso", "fuga_aceite_frenos",
      "espejos", "cinturon_seguridad", "freno_servicio", "freno_estacionamiento",
      "estado_carroceria", "neumaticos_llantas", "nivel_agua", "nivel_aceite_motor",
      "nivel_aceite_hidraulico", "extintor", "tableros_instrumentos", "direccion",
      "estado_asiento", "pernos_tuercas_rueda",
      "estado_rotor", "estado_garra", "estado_link_pasadores", "estado_orugas", "estado_balde",
      "estado_ampliroll",
    ])
  })

  it("las tres secciones de estado concatenan exactamente esas 25 filas", () => {
    const concatenadas = ["estado_camion", "exclusivo_carga", "exclusivo_camion"]
      .flatMap((sectionId) => items.filter((item) => item.sectionId === sectionId))
    expect(concatenadas.map((item) => item.itemId)).toEqual(REPORTE_EQUIPOS_FILAS.map((item) => item.id))
  })

  it("el acoplado es espejo exacto de las 25 filas, en el mismo orden", () => {
    // La columna ACOPLADO del papel usa LAS MISMAS filas. Un subconjunto
    // elegido a criterio —lo que tenía antes esta definición— deja huérfanas
    // 17 de las 25 y hace imposible mapear la celda leída a un ítem.
    const acoplado = items.filter((item) => item.sectionId === "estado_acoplado")
    expect(acoplado).toHaveLength(REPORTE_EQUIPOS_FILAS.length)
    expect(acoplado.map((item) => item.itemId))
      .toEqual(REPORTE_EQUIPOS_FILAS.map((item) => `acoplado_${item.id}`))
    // El daño potencial viaja con el espejo: un freno del acoplado mata igual.
    expect(acoplado.map((item) => item.danoPotencial))
      .toEqual(REPORTE_EQUIPOS_FILAS.map((item) => item.danoPotencial ?? null))
  })

  it("declara la triple firma del papel", () => {
    expect(REPORTE_EQUIPOS.closingAct.signatureRoles).toEqual([
      "operador_entrante", "operador_saliente", "supervisor_turno",
    ])
  })
})
