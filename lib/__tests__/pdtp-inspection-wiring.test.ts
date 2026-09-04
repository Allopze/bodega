/**
 * lib/__tests__/pdtp-inspection-wiring.test.ts
 *
 * El detector de plantillas de inspección mal cableadas.
 *
 * Existe por un caso concreto y caro: una plantilla vigente que no declara
 * ninguna actividad del PDTP se ejecuta con normalidad, se cierra, y el
 * programa no se entera. No falla nada — y eso es exactamente el problema.
 */

import { describe, expect, it } from "vitest"
import {
  classifyPdtp2026InspectionWiring,
  type InspectionTemplateWiringRow,
} from "@/lib/prevention/inspection-wiring"

function row(overrides: Partial<InspectionTemplateWiringRow> & Pick<InspectionTemplateWiringRow, "code" | "versionLabel" | "status" | "sourceDefinitionCode">): InspectionTemplateWiringRow {
  return {
    id: `tpl-${overrides.code}-${overrides.versionLabel}`,
    pdtpActivityNumbers: null,
    executorOfRecord: "platform_user",
    ...overrides,
  }
}

describe("classifyPdtp2026InspectionWiring", () => {
  it("marca la vigente sin números cuyo borrador del mismo código sí los declara", () => {
    const { gaps } = classifyPdtp2026InspectionWiring([
      row({ code: "inspeccion_extintores", versionLabel: "01", status: "approved", sourceDefinitionCode: "inspeccion_extintores" }),
      row({ code: "inspeccion_extintores", versionLabel: "02", status: "draft", sourceDefinitionCode: "inspeccion_extintores", pdtpActivityNumbers: [24] }),
    ])

    const silent = gaps.filter((gap) => gap.kind === "silently_unwired")
    expect(silent).toHaveLength(1)
    expect(silent[0]).toMatchObject({
      definitionCode: "inspeccion_extintores",
      approved: { versionLabel: "01" },
      draft: { versionLabel: "02", declares: [24] },
    })
  })

  it("detecta la huérfana cuyo reemplazo tiene OTRO código", () => {
    // El caso que una regla agrupada por `code` no vería, y el único del
    // catálogo que no se arregla solo al aprobar: `supersedePreviousApproved`
    // retira por `code`, así que `inspeccion_epp` v02 quedaría vigente para
    // siempre, ejecutable y acreditando nada.
    const { gaps } = classifyPdtp2026InspectionWiring([
      row({ code: "inspeccion_epp", versionLabel: "02", status: "approved", sourceDefinitionCode: "inspeccion_epp" }),
      row({ code: "inspeccion_epp_jt", versionLabel: "03-jt", status: "draft", sourceDefinitionCode: "inspeccion_epp", pdtpActivityNumbers: [64] }),
      row({ code: "inspeccion_epp_prf", versionLabel: "03-prf", status: "draft", sourceDefinitionCode: "inspeccion_epp", pdtpActivityNumbers: [65] }),
    ])

    const orphans = gaps.filter((gap) => gap.kind === "orphan_approved")
    expect(orphans).toHaveLength(1)
    expect(orphans[0]).toMatchObject({
      approved: { code: "inspeccion_epp" },
      replacedByCodes: ["inspeccion_epp_jt", "inspeccion_epp_prf"],
    })
    // Y no se confunde con el caso de arriba: acá no hay borrador del mismo
    // código, así que aprobar no basta.
    expect(gaps.some((gap) => gap.kind === "silently_unwired")).toBe(false)
  })

  it("marca dos borradores del mismo código que declaran lo mismo", () => {
    const { gaps } = classifyPdtp2026InspectionWiring([
      row({ code: "inspeccion_taller", versionLabel: "001", status: "draft", sourceDefinitionCode: "inspeccion_taller", pdtpActivityNumbers: [27] }),
      row({ code: "inspeccion_taller", versionLabel: "02", status: "draft", sourceDefinitionCode: "inspeccion_taller", pdtpActivityNumbers: [27] }),
    ])

    const duplicates = gaps.filter((gap) => gap.kind === "duplicate_drafts")
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0]!.kind === "duplicate_drafts" && duplicates[0]!.drafts.map((d) => d.versionLabel)).toEqual(["001", "02"])
  })

  it("marca el ejecutante de registro equivocado en la vigente", () => {
    // D04: el report de uso diario lo ejecuta el operador nombrado en el
    // formulario. Con `platform_user` el candado de independencia impide que el
    // jefe de terreno firme lo que sólo transcribió.
    const { gaps } = classifyPdtp2026InspectionWiring([
      row({ code: "reporte_equipos", versionLabel: "01", status: "approved", sourceDefinitionCode: "reporte_equipos" }),
    ])

    const mismatch = gaps.filter((gap) => gap.kind === "executor_mismatch")
    expect(mismatch).toHaveLength(1)
    expect(mismatch[0]).toMatchObject({ expected: "declared_in_form", actual: "platform_user" })
  })

  it("un borrador cableado sin vigente que lo cubra queda pendiente de aprobación", () => {
    const { gaps } = classifyPdtp2026InspectionWiring([
      row({ code: "caminata_seguridad", versionLabel: "01", status: "draft", sourceDefinitionCode: "caminata_seguridad", pdtpActivityNumbers: [41] }),
    ])

    expect(gaps.filter((gap) => gap.kind === "pending_approval")).toHaveLength(1)
  })

  it("una vigente ya cableada no genera ningún hallazgo", () => {
    const { gaps, activitiesWithoutApprovedInstrument } = classifyPdtp2026InspectionWiring([
      row({ code: "inspeccion_extintores", versionLabel: "02", status: "approved", sourceDefinitionCode: "inspeccion_extintores", pdtpActivityNumbers: [24] }),
    ])

    expect(gaps).toHaveLength(0)
    expect(activitiesWithoutApprovedInstrument).not.toContain(24)
  })

  it("la auditoría del SGSST no se viste de problema", () => {
    // No acredita ninguna actividad del programa a propósito: la exige el DS 44,
    // no el PDTP. Una regla que confundiera "sin números" con "mal cableada"
    // ensuciaría la pantalla con un falso positivo permanente.
    const { gaps } = classifyPdtp2026InspectionWiring([
      row({ code: "auditoria_sgsst", versionLabel: "01", status: "approved", sourceDefinitionCode: "auditoria_sgsst" }),
    ])

    expect(gaps).toHaveLength(0)
  })

  it("sin ninguna plantilla vigente, todas las actividades del programa quedan sin instrumento", () => {
    const { activitiesWithoutApprovedInstrument } = classifyPdtp2026InspectionWiring([])
    expect(activitiesWithoutApprovedInstrument).toEqual(
      expect.arrayContaining([10, 24, 25, 26, 27, 29, 33, 34, 39, 40, 41, 64, 65]),
    )
  })
})
