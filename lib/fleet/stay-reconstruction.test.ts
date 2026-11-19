import { describe, expect, it } from "vitest"
import { reconstructStays, type StayEvidence } from "./stay-reconstruction"

const ev = (day: string, worksiteId: string, kind: StayEvidence["kind"] = "carga", ref = `${kind}-${day}`): StayEvidence => ({
  day,
  worksiteId,
  kind,
  ref,
})

describe("reconstructStays", () => {
  it("sin evidencia: una sola estadía en la faena actual", () => {
    const result = reconstructStays({ evidence: [], currentWorksiteId: "ws-a", maxGapDays: 7 })
    expect(result).toEqual({
      stays: [{ worksiteId: "ws-a", startedOn: null, endedOn: null, evidence: "Sin evidencia: faena actual" }],
      toConfirm: [],
      confident: true,
    })
  })

  it("sólo una faena con evidencia, igual a la actual: una estadía abierta por ambos lados", () => {
    const result = reconstructStays({
      evidence: [ev("2026-09-10", "ws-a"), ev("2026-08-02", "ws-a")],
      currentWorksiteId: "ws-a",
      maxGapDays: 7,
    })
    expect(result.stays).toHaveLength(1)
    expect(result.stays[0]).toMatchObject({ worksiteId: "ws-a", startedOn: null, endedOn: null })
    expect(result.toConfirm).toEqual([])
    expect(result.confident).toBe(true)
  })

  it("cambio dentro de la ventana: borde en el primer día con evidencia en la faena nueva", () => {
    const result = reconstructStays({
      evidence: [
        ev("2026-08-02", "ws-a"),
        ev("2026-09-10", "ws-a"),
        ev("2026-09-14", "ws-b"),
        ev("2026-10-01", "ws-b"),
      ],
      currentWorksiteId: "ws-b",
      maxGapDays: 7,
    })
    expect(result.confident).toBe(true)
    expect(result.toConfirm).toEqual([])
    expect(result.stays.map(({ worksiteId, startedOn, endedOn }) => ({ worksiteId, startedOn, endedOn }))).toEqual([
      { worksiteId: "ws-a", startedOn: null, endedOn: "2026-09-13" },
      { worksiteId: "ws-b", startedOn: "2026-09-14", endedOn: null },
    ])
  })

  it("el gap se mide en días corridos y el tope es inclusivo", () => {
    const base = (to: string) =>
      reconstructStays({
        evidence: [ev("2026-09-10", "ws-a"), ev(to, "ws-b")],
        currentWorksiteId: "ws-b",
        maxGapDays: 7,
      })
    expect(base("2026-09-17").confident).toBe(true)
    expect(base("2026-09-18").toConfirm[0]?.reason).toBe("ventana_amplia")
  })

  it("ventana mayor al tope: va a Por confirmar con lo que se sabe y no es confiable", () => {
    const result = reconstructStays({
      evidence: [ev("2026-08-02", "ws-a"), ev("2026-09-10", "ws-a"), ev("2026-09-20", "ws-b")],
      currentWorksiteId: "ws-b",
      maxGapDays: 7,
    })
    expect(result.confident).toBe(false)
    expect(result.toConfirm).toEqual([
      {
        reason: "ventana_amplia",
        fromWorksiteId: "ws-a",
        toWorksiteId: "ws-b",
        lastDayInFrom: "2026-09-10",
        firstDayInTo: "2026-09-20",
        gapDays: 10,
        detail: expect.stringContaining("10 días"),
      },
    ])
  })

  it("dos faenas el mismo día: contradicción, y sigue juntando el resto", () => {
    const result = reconstructStays({
      evidence: [
        ev("2026-09-05", "ws-a", "carga", "c1"),
        ev("2026-09-05", "ws-b", "tae", "t1"),
        ev("2026-09-10", "ws-b"),
        ev("2026-09-30", "ws-c"),
      ],
      currentWorksiteId: "ws-c",
      maxGapDays: 7,
    })
    expect(result.confident).toBe(false)
    const reasons = result.toConfirm.map((p) => p.reason)
    expect(reasons).toContain("contradiccion")
    // El resto sigue procesándose: el salto ws-b → ws-c (20 días) también se informa.
    expect(reasons).toContain("ventana_amplia")
    const contradiction = result.toConfirm.find((p) => p.reason === "contradiccion")
    expect(contradiction).toMatchObject({ firstDayInTo: "2026-09-05", gapDays: 0 })
    expect(contradiction?.detail).toContain("ws-a")
    expect(contradiction?.detail).toContain("ws-b")
  })

  it("la última faena con evidencia distinta de la actual: faena_actual_distinta", () => {
    const result = reconstructStays({
      evidence: [ev("2026-08-02", "ws-a"), ev("2026-09-10", "ws-a")],
      currentWorksiteId: "ws-b",
      maxGapDays: 7,
    })
    expect(result.confident).toBe(false)
    expect(result.toConfirm).toHaveLength(1)
    expect(result.toConfirm[0]).toMatchObject({
      reason: "faena_actual_distinta",
      fromWorksiteId: "ws-a",
      toWorksiteId: "ws-b",
      lastDayInFrom: "2026-09-10",
      gapDays: null,
    })
    // No se corrige la faena actual: la estadía abierta queda en la de la evidencia.
    expect(result.stays).toHaveLength(1)
    expect(result.stays[0]).toMatchObject({ worksiteId: "ws-a", endedOn: null })
  })

  it("una planilla en otra faena que la estadía que cubre su día va a Por confirmar", () => {
    const result = reconstructStays({
      evidence: [
        ev("2026-08-02", "ws-a"),
        ev("2026-09-10", "ws-a"),
        ev("2026-08-21", "ws-c", "planilla", "INVENTARIO-FAENA-ANTERIOR"),
      ],
      currentWorksiteId: "ws-a",
      maxGapDays: 7,
    })
    expect(result.confident).toBe(false)
    expect(result.toConfirm).toHaveLength(1)
    expect(result.toConfirm[0]).toMatchObject({
      reason: "planilla",
      fromWorksiteId: "ws-a",
      toWorksiteId: "ws-c",
      firstDayInTo: "2026-08-21",
    })
    // La planilla no crea bordes ni estadías.
    expect(result.stays).toHaveLength(1)
    expect(result.stays[0]).toMatchObject({ worksiteId: "ws-a", startedOn: null, endedOn: null })
  })

  it("una planilla que coincide con la estadía que cubre su día no genera pendientes", () => {
    const result = reconstructStays({
      evidence: [ev("2026-08-02", "ws-a"), ev("2026-08-21", "ws-a", "planilla")],
      currentWorksiteId: "ws-a",
      maxGapDays: 7,
    })
    expect(result.toConfirm).toEqual([])
    expect(result.confident).toBe(true)
  })

  it("sólo planilla sin otra evidencia: se contrasta con la estadía por defecto", () => {
    const result = reconstructStays({
      evidence: [ev("2026-08-21", "ws-c", "planilla")],
      currentWorksiteId: "ws-a",
      maxGapDays: 7,
    })
    expect(result.stays).toEqual([
      { worksiteId: "ws-a", startedOn: null, endedOn: null, evidence: "Sin evidencia: faena actual" },
    ])
    expect(result.toConfirm.map((p) => p.reason)).toEqual(["planilla"])
    expect(result.confident).toBe(false)
  })

  it("funde tramos consecutivos de la misma faena y deja volver a una faena anterior", () => {
    const result = reconstructStays({
      evidence: [
        ev("2026-09-01", "ws-a"),
        ev("2026-09-03", "ws-a", "tae"),
        ev("2026-09-06", "ws-b"),
        ev("2026-09-09", "ws-a"),
      ],
      currentWorksiteId: "ws-a",
      maxGapDays: 7,
    })
    expect(result.stays.map((s) => [s.worksiteId, s.startedOn, s.endedOn])).toEqual([
      ["ws-a", null, "2026-09-05"],
      ["ws-b", "2026-09-06", "2026-09-08"],
      ["ws-a", "2026-09-09", null],
    ])
    expect(result.confident).toBe(true)
  })

  it("no depende del orden de entrada", () => {
    const evidence = [ev("2026-09-14", "ws-b"), ev("2026-08-02", "ws-a"), ev("2026-09-10", "ws-a")]
    const forward = reconstructStays({ evidence, currentWorksiteId: "ws-b", maxGapDays: 7 })
    const backward = reconstructStays({ evidence: [...evidence].reverse(), currentWorksiteId: "ws-b", maxGapDays: 7 })
    expect(backward).toEqual(forward)
  })

  it("redacta la evidencia: conteos por tipo y rango de fechas", () => {
    const result = reconstructStays({
      evidence: [
        ev("2026-08-02", "ws-a", "carga", "l1"),
        ev("2026-08-09", "ws-a", "carga", "l2"),
        ev("2026-08-20", "ws-a", "carga", "l3"),
        ev("2026-09-02", "ws-a", "carga", "l4"),
        ev("2026-08-12", "ws-a", "registro_mantencion", "r1"),
        ev("2026-09-10", "ws-a", "registro_mantencion", "r2"),
        ev("2026-09-14", "ws-b", "tae", "t1"),
        ev("2026-09-15", "ws-b", "carga_terreno", "f1"),
        ev("2026-09-16", "ws-b", "ot", "o1"),
        ev("2026-09-17", "ws-b", "auditoria", "a1"),
        ev("2026-09-18", "ws-b", "planilla", "p1"),
      ],
      currentWorksiteId: "ws-b",
      maxGapDays: 7,
    })
    expect(result.stays[0]!.evidence).toBe("4 cargas, 2 registros de mantención entre 02-08-2026 y 10-09-2026")
    // Singular, orden fijo de tipos y la planilla no se cuenta.
    expect(result.stays[1]!.evidence).toBe(
      "1 carga en terreno, 1 envío TAE, 1 OT, 1 cambio auditado entre 14-09-2026 y 17-09-2026",
    )
  })

  it("evidencia de un solo día: «el 05-09-2026», no «entre 05-09-2026 y 05-09-2026»", () => {
    const result = reconstructStays({
      evidence: [
        ev("2026-08-02", "ws-a", "carga", "l1"),
        ev("2026-09-01", "ws-a", "carga", "l2"),
        ev("2026-09-05", "ws-b", "carga", "l3"),
        ev("2026-09-05", "ws-b", "ot", "o1"),
      ],
      currentWorksiteId: "ws-b",
      maxGapDays: 7,
    })
    expect(result.stays[0]!.evidence).toBe("2 cargas entre 02-08-2026 y 01-09-2026")
    expect(result.stays[1]!.evidence).toBe("1 carga, 1 OT el 05-09-2026")
  })
})
