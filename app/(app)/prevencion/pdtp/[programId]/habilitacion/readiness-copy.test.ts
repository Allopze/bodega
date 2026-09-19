import { describe, expect, it } from "vitest"
import type { PdtpCoverageInstrument } from "@/lib/services/pdtp/instrument-gap"
import type { PdtpFulfillmentCoverageIssue } from "@/lib/services/prevention-pdtp"
import {
  READINESS_FORBIDDEN_JARGON,
  affectedWorksiteNames,
  instrumentStateLabel,
  readinessGroupCopy,
  readinessRowReason,
} from "./readiness-copy"

const ALL_STATUSES: PdtpFulfillmentCoverageIssue["status"][] = [
  "ready", "segregated_valid", "config_required", "code_gap", "destination_not_configured",
  "permission_gap", "executor_required", "executor_permission_gap", "decision_required",
  "instrument_required",
]

function issue(over: Partial<PdtpFulfillmentCoverageIssue> = {}): PdtpFulfillmentCoverageIssue {
  return {
    activityId: "act-1", n: 24, activity: "Inspección de extintores",
    status: "instrument_required", reason: "motivo de respaldo", ...over,
  }
}

const template: PdtpCoverageInstrument = {
  kind: "inspection_template", id: "tpl-1", code: "INS-014", versionLabel: "v3",
  name: "Inspección de extintores", status: "draft", authorUserId: "u-1",
  blocker: "template_not_approved",
}

const course = (over: Partial<Extract<PdtpCoverageInstrument, { kind: "training_catalog_item" }>> = {}): PdtpCoverageInstrument => ({
  kind: "training_catalog_item", id: "c-1", code: "CAP-07", title: "Inducción",
  blocker: "catalog_item_inactive", ...over,
})

describe("readiness-copy — lenguaje del oficio, no de la arquitectura", () => {
  it("cada clasificación tiene título y explicación, sin huecos", () => {
    // Un status nuevo en el servicio no puede llegar a la pantalla sin nombre:
    // el panel anterior mostraba lo que trajera el servicio, y por eso terminó
    // titulando un grupo con una frase de 90 caracteres entre paréntesis.
    for (const status of ALL_STATUSES) {
      const copy = readinessGroupCopy(status)
      expect(copy.title.length, status).toBeGreaterThan(0)
      expect(copy.blurb.length, status).toBeGreaterThan(0)
      expect(copy.title, status).toBe(copy.title.trim())
      // Título en frase, no en mayúsculas sostenidas ni con paréntesis
      // explicativos colgando.
      expect(copy.title, status).not.toBe(copy.title.toLocaleUpperCase("es-CL"))
      expect(copy.title, status).not.toContain("(")
    }
  })

  it("ningún texto de grupo usa la jerga interna", () => {
    const all = ALL_STATUSES
      .map((status) => `${readinessGroupCopy(status).title} ${readinessGroupCopy(status).blurb}`)
      .join(" ")
      .toLocaleLowerCase("es-CL")
    for (const term of READINESS_FORBIDDEN_JARGON) {
      expect(all, term).not.toContain(term)
    }
  })

  it("dos filas del mismo grupo con instrumentos distintos dan motivos distintos", () => {
    // Es exactamente el defecto reportado: en el panel anterior las catorce
    // filas de este grupo mostraban la misma frase palabra por palabra.
    const filas = [
      issue({ n: 16, instruments: [template] }),
      issue({ n: 63, instruments: [course({ code: "CAP-63" })] }),
      issue({ n: 57, instruments: [course({ code: "CAP-57" })] }),
      issue({ n: 56, instruments: [course({ code: "CAP-56" })] }),
    ].map(readinessRowReason)

    expect(new Set(filas).size).toBe(filas.length)
    expect(filas[0]).toBe("Plantilla INS-014 v3 en borrador")
    expect(filas[1]).toBe("Actividad CAP-63 dada de baja del catálogo anual")
    expect(filas[2]).toBe("Actividad CAP-57 dada de baja del catálogo anual")
    expect(filas[3]).toBe("Actividad CAP-56 dada de baja del catálogo anual")
  })

  it("con varios instrumentos el motivo dice que basta resolver uno", () => {
    const reason = readinessRowReason(issue({ instruments: [template, course()] }))
    expect(reason).toBe("Plantilla y Actividad del catálogo: resolver cualquiera habilita la actividad")
  })

  it("sin instrumentos cae en el motivo del servicio, no en una fila vacía", () => {
    expect(readinessRowReason(issue({ status: "code_gap", instruments: undefined })))
      .toBe("motivo de respaldo")
  })

  it("las faenas del plan se nombran, y muchas se resumen sin perder el conteo", () => {
    const dos = readinessRowReason(issue({
      instruments: [{ kind: "emergency_plan", worksites: [
        { id: "a", name: "Faena Norte", planId: "p1", planCode: "PE-1", planStatus: "draft", createdByUserId: null, blocker: "plan_not_approved" },
        { id: "b", name: "Faena Sur", planId: null, planCode: null, planStatus: null, createdByUserId: null, blocker: "plan_missing" },
      ] }],
    }))
    expect(dos).toBe("Sin plan aprobado en Faena Norte y Faena Sur")

    const muchas = readinessRowReason(issue({
      instruments: [{ kind: "emergency_plan", worksites: ["A", "B", "C", "D", "E"].map((name) => ({
        id: name, name: `Faena ${name}`, planId: null, planCode: null, planStatus: null,
        createdByUserId: null, blocker: "plan_missing" as const,
      })) }],
    }))
    expect(muchas).toBe("Sin plan aprobado en Faena A, Faena B y 3 faenas más")
  })

  it("el estado del instrumento se dice en español, no con el valor de la columna", () => {
    expect(instrumentStateLabel(template)).toBe("En borrador")
    expect(instrumentStateLabel(course())).toBe("Dada de baja")
  })

  it("distingue una actividad por faena de una global", () => {
    expect(affectedWorksiteNames(issue({ instruments: [template] }))).toBeNull()
    expect(affectedWorksiteNames(issue({
      instruments: [{ kind: "emergency_plan", worksites: [
        { id: "a", name: "Faena Norte", planId: null, planCode: null, planStatus: null, createdByUserId: null, blocker: "plan_missing" },
      ] }],
    }))).toEqual(["Faena Norte"])
  })
})
