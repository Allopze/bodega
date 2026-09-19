/**
 * lib/services/pdtp/instrument-gap.test.ts
 *
 * El defecto que originó el rediseño: las catorce filas del grupo
 * `instrument_required` mostraban la misma frase, palabra por palabra, y sin un
 * id al que enlazar. El operador no podía distinguir una fila de otra ni saber
 * a dónde ir.
 *
 * Estos tests corren sin Postgres: es justamente por eso que la redacción se
 * extrajo de la compuerta a una función pura.
 */

import { describe, expect, it } from "vitest"
import { describePdtpInstrumentGap } from "./instrument-gap"
import type { PdtpInstrumentRecord } from "./instruments"

const template = (over: Partial<Extract<PdtpInstrumentRecord, { kind: "inspection_template" }>> = {}) => ({
  kind: "inspection_template" as const,
  id: "tpl-1", code: "INSP-EXT", versionLabel: "v02", name: "Inspección de extintores",
  status: "draft", authorUserId: "user-1", usable: false, ...over,
})

const catalogItem = (over: Partial<Extract<PdtpInstrumentRecord, { kind: "training_catalog_item" }>> = {}) => ({
  kind: "training_catalog_item" as const,
  id: "cat-1", code: "PDTP-63", title: "Inducción del trabajador",
  isActive: false, usable: false, ...over,
})

const plan = (over: Partial<Extract<PdtpInstrumentRecord, { kind: "emergency_plan" }>> = {}) => ({
  kind: "emergency_plan" as const,
  id: "plan-1", code: "PE-01", title: "Plan de emergencia", status: "draft",
  worksiteId: "ws-a", createdByUserId: "user-1", usable: false, ...over,
})

describe("describePdtpInstrumentGap — un motivo que distingue una fila de otra", () => {
  it("nombra la plantilla concreta y su estado", () => {
    const gap = describePdtpInstrumentGap({
      n: 24, candidates: [template()], missingWorksites: [], applicableWorksiteCount: 2,
    })
    expect(gap.reason).toBe("La plantilla INSP-EXT (v02) está en borrador y sólo una aprobada se puede programar.")
    expect(gap.instruments).toEqual([
      expect.objectContaining({ kind: "inspection_template", id: "tpl-1", blocker: "template_not_approved" }),
    ])
  })

  it("nombra la actividad del catálogo y su única causa", () => {
    // Antes eran tres causas —sin versión, sin publicar, publicada bajo el
    // mínimo— porque el instrumento era un curso versionado. El catálogo anual
    // no tiene ciclo de aprobación: o la actividad está vigente o está de baja.
    const deBaja = describePdtpInstrumentGap({
      n: 63, candidates: [catalogItem()], missingWorksites: [], applicableWorksiteCount: 1,
    })
    expect(deBaja.reason).toBe("La actividad PDTP-63 está dada de baja del catálogo anual y sólo una activa se puede programar.")
    expect(deBaja.instruments).toEqual([
      expect.objectContaining({ kind: "training_catalog_item", blocker: "catalog_item_inactive" }),
    ])

    // Dos actividades distintas siguen dando motivos distintos: el defecto
    // reportado era que todas las filas del grupo repetían la misma frase.
    const otra = describePdtpInstrumentGap({
      n: 57, candidates: [catalogItem({ code: "PDTP-57" })], missingWorksites: [], applicableWorksiteCount: 1,
    })
    expect(otra.reason).not.toBe(deBaja.reason)
  })

  it("los planes se agrupan por faena, distinguiendo el que falta del que no está aprobado", () => {
    const gap = describePdtpInstrumentGap({
      n: 84,
      candidates: [plan({ id: "plan-a", code: "PE-A", worksiteId: "ws-a" })],
      missingWorksites: [{ id: "ws-a", name: "Faena Norte" }, { id: "ws-b", name: "Faena Sur" }],
      applicableWorksiteCount: 3,
    })

    expect(gap.reason).toBe(
      "Su plan de emergencia no está aprobado en 2 de las 3 faenas donde aplica: Faena Norte, Faena Sur.",
    )
    // Un solo ref con dos faenas dentro: aprobar uno no basta, es conjunción.
    expect(gap.instruments).toHaveLength(1)
    expect(gap.instruments[0]).toEqual({
      kind: "emergency_plan",
      worksites: [
        { id: "ws-a", name: "Faena Norte", planId: "plan-a", planCode: "PE-A", planStatus: "draft", createdByUserId: "user-1", blocker: "plan_not_approved" },
        { id: "ws-b", name: "Faena Sur", planId: null, planCode: null, planStatus: null, createdByUserId: null, blocker: "plan_missing" },
      ],
    })
  })

  it("con dos candidatos dice que basta con resolver uno", () => {
    // Es la semántica real: `instrumentIssueFor` corta con
    // `usableGlobally.has(n)`, así que aprobar cualquiera apaga el issue.
    const gap = describePdtpInstrumentGap({
      n: 24,
      candidates: [template(), catalogItem({ code: "PDTP-24" })],
      missingWorksites: [], applicableWorksiteCount: 1,
    })

    expect(gap.reason).toBe(
      "Ninguno de los instrumentos que declaran el N°24 está vigente: la plantilla INSP-EXT (borrador) y la actividad PDTP-24 (dada de baja del catálogo). Resolver cualquiera de ellos habilita la actividad.",
    )
    expect(gap.instruments).toHaveLength(2)
  })

  it("dos instrumentos de la misma clase se nombran los dos", () => {
    const gap = describePdtpInstrumentGap({
      n: 56,
      candidates: [catalogItem({ id: "c-1", code: "PDTP-56" }), catalogItem({ id: "c-2", code: "PDTP-56B" })],
      missingWorksites: [], applicableWorksiteCount: 1,
    })
    expect(gap.reason).toContain("PDTP-56")
    expect(gap.reason).toContain("PDTP-56B")
    expect(gap.instruments.map((instrument) => instrument.kind)).toEqual(["training_catalog_item", "training_catalog_item"])
  })

  it("el caso mixto: una plantilla en borrador además del plan por faena", () => {
    // Aprobar la plantilla también resuelve la actividad —saltaría el
    // early-return de `usableGlobally.has(n)`—, y el mensaje anterior ni
    // mencionaba que existiera.
    const gap = describePdtpInstrumentGap({
      n: 84,
      candidates: [template({ code: "INSP-SIM" }), plan({ worksiteId: "ws-b", id: "plan-b", code: "PE-B" })],
      missingWorksites: [{ id: "ws-b", name: "Faena Sur" }],
      applicableWorksiteCount: 2,
    })
    expect(gap.instruments.map((instrument) => instrument.kind)).toEqual(["inspection_template", "emergency_plan"])
    expect(gap.reason).toContain("INSP-SIM")
    expect(gap.reason).toContain("Resolver cualquiera de ellos")
  })

  it("sin candidatos ni faenas cae en el texto defensivo, no en una frase rota", () => {
    const gap = describePdtpInstrumentGap({
      n: 99, candidates: [], missingWorksites: [], applicableWorksiteCount: 1,
    })
    expect(gap.reason).toBe("Su número está declarado, pero el instrumento que lo respalda no está vigente.")
    expect(gap.instruments).toEqual([])
  })

  it("los instrumentos son serializables: cruzan el borde RSC hacia el cliente", () => {
    // Un `Set`, un `Map` o un `Date` colado acá rompe el render en producción y
    // no en los tests de unidad, que comparan estructuras en memoria.
    const gap = describePdtpInstrumentGap({
      n: 84,
      candidates: [template(), catalogItem(), plan()],
      missingWorksites: [{ id: "ws-a", name: "Faena Norte" }],
      applicableWorksiteCount: 1,
    })
    expect(JSON.parse(JSON.stringify(gap))).toEqual(gap)
  })

  it("nunca emite un href: las rutas se arman en la UI", () => {
    const gap = describePdtpInstrumentGap({
      n: 24,
      candidates: [template(), catalogItem(), plan()],
      missingWorksites: [{ id: "ws-a", name: "Faena Norte" }],
      applicableWorksiteCount: 1,
    })
    expect(JSON.stringify(gap)).not.toMatch(/\/prevencion\//)
  })
})
