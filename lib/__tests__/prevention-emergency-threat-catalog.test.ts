/**
 * lib/__tests__/prevention-emergency-threat-catalog.test.ts
 *
 * El catálogo de amenazas y el enum de escenarios tienen que decir lo mismo.
 *
 * Hasta hace poco el literal de los tipos vivía cuatro veces —dos CHECK de
 * base, dos `z.enum` del servicio— y las etiquetas de la UI eran una quinta
 * copia. Separar cualquiera de ellas produce un formulario que ofrece un valor
 * que la base rechaza, o una base que acepta un valor que la pantalla no sabe
 * nombrar. Esta suite es lo que impide que vuelvan a separarse.
 */

import { describe, expect, it } from "vitest"
import {
  EMERGENCY_SCENARIO_TYPES,
  EMERGENCY_SCENARIO_TYPE_LABELS,
  emergencyScenarioTypeLabel,
} from "@/lib/prevention/emergency"
import {
  EMERGENCY_THREAT_CATALOG,
  mandatoryEmergencyThreats,
} from "@/lib/prevention/emergency-threats"

describe("enum de escenarios y etiquetas", () => {
  it("las etiquetas cubren exactamente los tipos declarados", () => {
    expect(Object.keys(EMERGENCY_SCENARIO_TYPE_LABELS).sort()).toEqual([...EMERGENCY_SCENARIO_TYPES].sort())
  })

  it("incluye las quince amenazas del protocolo ACCEDER", () => {
    expect(EMERGENCY_SCENARIO_TYPES).toEqual(expect.arrayContaining([
      "sismo", "tsunami", "aluvion", "incendio_estructural", "incendio_forestal",
      "asalto_robo", "erupcion_volcanica", "inundacion_lluvia", "inundacion_cauce",
      "nevada", "marejada", "corte_energia", "corte_agua", "desorden_publico", "otra_amenaza",
    ]))
  })

  it("conserva los escenarios operacionales de la faena", () => {
    // No son amenazas territoriales, pero tienen procedimiento propio (DO-28
    // derrames, DO-16 RESPEL). Retirarlos empobrecería el plan.
    expect(EMERGENCY_SCENARIO_TYPES).toEqual(expect.arrayContaining([
      "derrame", "fuga", "volcamiento", "exposicion", "rescate",
    ]))
  })

  it("los tres valores retirados ya no existen", () => {
    for (const retirado of ["incendio", "clima", "otro"]) {
      expect(EMERGENCY_SCENARIO_TYPES as readonly string[]).not.toContain(retirado)
    }
  })

  it("un valor desconocido de la base se muestra crudo, no como undefined", () => {
    // La columna es `text`: si una fila trae algo que el catálogo no conoce, la
    // pantalla tiene que decir algo, no romperse.
    expect(emergencyScenarioTypeLabel("sismo")).toBe("Sismo")
    expect(emergencyScenarioTypeLabel("amenaza_que_no_existe")).toBe("amenaza_que_no_existe")
  })
})

describe("EMERGENCY_THREAT_CATALOG", () => {
  it("todas sus amenazas son tipos válidos", () => {
    for (const threat of EMERGENCY_THREAT_CATALOG) {
      expect(EMERGENCY_SCENARIO_TYPES as readonly string[], threat.type).toContain(threat.type)
    }
  })

  it("las obligatorias son las cinco que el DO-41 exige por escrito", () => {
    // "Como mínimo, deben evaluarse las amenazas de sismo, incendio
    // estructural, corte de agua, corte de energía eléctrica y asalto o robo."
    expect(mandatoryEmergencyThreats().map((t) => t.type).sort()).toEqual([
      "asalto_robo", "corte_agua", "corte_energia", "incendio_estructural", "sismo",
    ])
  })

  it("las que dependen del territorio no son obligatorias", () => {
    // El Visor Territorial de SENAPRED decide si aplican, y `worksites` no
    // guarda comuna. Sembrarlas sería inventar exposición.
    const territoriales = EMERGENCY_THREAT_CATALOG
      .filter((t) => ["tsunami", "incendio_forestal", "erupcion_volcanica"].includes(t.type))
    expect(territoriales).toHaveLength(3)
    for (const threat of territoriales) {
      expect(threat.obligation, threat.type).toBe("senapred_detected")
    }
  })

  it("cada procedimiento cabe en lo que el servicio acepta", () => {
    // `addEmergencyScenario` exige entre 10 y 10.000 caracteres. Un
    // procedimiento de doce caracteres pasa el validador y no le sirve a nadie,
    // así que el piso real que se exige acá es mucho más alto.
    for (const threat of EMERGENCY_THREAT_CATALOG) {
      expect(threat.responseProcedure.length, threat.type).toBeGreaterThan(200)
      expect(threat.responseProcedure.length, threat.type).toBeLessThanOrEqual(10_000)
      expect(threat.title.length, threat.type).toBeGreaterThanOrEqual(3)
    }
  })

  it("no repite amenazas", () => {
    const types = EMERGENCY_THREAT_CATALOG.map((t) => t.type)
    expect(new Set(types).size).toBe(types.length)
  })
})
