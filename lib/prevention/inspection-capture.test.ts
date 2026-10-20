import { describe, expect, it } from "vitest"
import {
  buildAnswersPayload,
  captureStatusLabel,
  classifySaveFailure,
  diffDrafts,
  draftsFromAnswers,
  normalizeAnswer,
  rebaseDrafts,
  sameAnswerSet,
  saveErrorCodeOf,
  summarizeCompletion,
  type CaptureDraft,
} from "@/lib/prevention/inspection-capture"
import type { InspectionAnswerInput, InspectionItemSpec } from "@/lib/prevention/inspections"
import { InspectionRunError, inspectionErrorCodeOf } from "@/lib/services/prevention-inspections/errors"

describe("saveErrorCodeOf", () => {
  it("lee el código que el servidor adjunta a un rechazo", () => {
    expect(saveErrorCodeOf({ ok: false, data: { code: "version_conflict" } })).toBe("version_conflict")
    expect(saveErrorCodeOf({ ok: false, data: { code: "evidence_guard" } })).toBe("evidence_guard")
  })

  it("un éxito, un rechazo sin código o un código desconocido no devuelven nada", () => {
    expect(saveErrorCodeOf({ ok: true, data: { code: "version_conflict" } })).toBeNull()
    expect(saveErrorCodeOf({ ok: false })).toBeNull()
    expect(saveErrorCodeOf({ ok: false, data: { code: "otra_cosa" } })).toBeNull()
    expect(saveErrorCodeOf(null)).toBeNull()
  })
})

describe("InspectionRunError", () => {
  it("lleva el código y se reconoce por forma", () => {
    const error = new InspectionRunError("not_editable", "La inspección ya fue ejecutada.")
    expect(error.message).toBe("La inspección ya fue ejecutada.")
    expect(inspectionErrorCodeOf(error)).toBe("not_editable")
  })

  it("no lleva `cause`: safeActionMessage lo ocultaría como error del driver", () => {
    expect("cause" in new InspectionRunError("invalid_row", "x")).toBe(false)
  })

  it("un error cualquiera no tiene código", () => {
    expect(inspectionErrorCodeOf(new Error("x"))).toBeNull()
    expect(inspectionErrorCodeOf("texto")).toBeNull()
  })
})

/* ── Funciones puras de la captura ────────────────────────────────────────── */

function item(itemId: string, overrides: Partial<InspectionItemSpec> = {}): InspectionItemSpec {
  return {
    sectionId: "s1",
    itemId,
    label: `Ítem ${itemId}`,
    required: false,
    countsForCompliance: true,
    kind: "cumple_nocumple_na_obs",
    ...overrides,
  }
}

const draft = (patch: Partial<CaptureDraft> = {}): CaptureDraft => ({
  result: "", comment: "", value: "", needsConfirmation: false, ...patch,
})

function persistedFrom(...rows: InspectionAnswerInput[]): Record<string, InspectionAnswerInput> {
  return Object.fromEntries(rows.map((row) => [`${row.sectionId}::${row.itemId}`, row]))
}

describe("normalizeAnswer", () => {
  it("«Sin responder» no es una respuesta", () => {
    expect(normalizeAnswer(item("a"), draft())).toBeNull()
  })

  it("recorta y convierte el texto vacío en null, como el servidor", () => {
    expect(normalizeAnswer(item("a"), draft({ result: "conforming", comment: "  ok  ", value: "   " }))).toEqual({
      sectionId: "s1",
      itemId: "a",
      result: "conforming",
      comment: "ok",
      value: null,
      needsConfirmation: false,
    })
  })

  it("la marca de ratificación sólo sobrevive en los ítems que la exigen", () => {
    const marked = draft({ result: "conforming", needsConfirmation: true })
    expect(normalizeAnswer(item("a"), marked)?.needsConfirmation).toBe(false)
    expect(normalizeAnswer(item("a", { danoPotencial: "fatal" }), marked)?.needsConfirmation).toBe(true)
  })
})

describe("buildAnswersPayload", () => {
  const items = [item("texto", { kind: "text" }), item("numero", { kind: "number" }), item("cumple")]

  /*
   * P1-1: una sola fila inválida frenaba el guardado de todas las demás, y el
   * inspector perdía lo que había respondido sin enterarse.
   */
  it("una fila inválida no frena a las demás: viaja el resto y la mala queda retenida", () => {
    const { answers, held } = buildAnswersPayload({
      items,
      drafts: {
        "s1::texto": draft({ result: "recorded", value: "Todo en orden" }),
        "s1::numero": draft({ result: "recorded", value: "134.122" }),
        "s1::cumple": draft({ result: "conforming" }),
      },
      persisted: {},
    })
    expect(answers.map((answer) => answer.itemId)).toEqual(["texto", "cumple"])
    expect(held).toHaveLength(1)
    expect(held[0]).toMatchObject({ key: "s1::numero", reason: "invalid" })
    expect(held[0]!.problem).toMatch(/sin separador de miles/)
  })

  it("una fila retenida viaja con su última versión persistida, no con la de la pantalla", () => {
    const persisted = persistedFrom({
      sectionId: "s1", itemId: "cumple", result: "non_conforming", comment: "Falta extintor", value: null, needsConfirmation: false,
    })
    const { answers, held } = buildAnswersPayload({
      items,
      // La persona borró el motivo: «No cumple» sin motivo es inválido.
      drafts: { "s1::cumple": draft({ result: "non_conforming", comment: "" }) },
      persisted,
    })
    expect(held).toMatchObject([{ key: "s1::cumple", reason: "invalid" }])
    expect(answers).toEqual([persisted["s1::cumple"]])
  })

  it("dejar sin responder una fila con fotos la retiene en vez de borrarla", () => {
    const persisted = persistedFrom({
      sectionId: "s1", itemId: "cumple", result: "conforming", comment: null, value: null, needsConfirmation: false,
    })
    const { answers, held } = buildAnswersPayload({
      items,
      drafts: { "s1::cumple": draft() },
      persisted,
      photoCountByKey: { "s1::cumple": 2 },
    })
    expect(held).toEqual([{
      key: "s1::cumple",
      reason: "unanswer_with_photos",
      problem: "Para dejar «Ítem cumple» sin responder, quita primero sus fotos.",
    }])
    expect(answers).toEqual([persisted["s1::cumple"]])
  })

  it("dejar sin responder una fila sin fotos la omite: el servidor la borra", () => {
    const persisted = persistedFrom({
      sectionId: "s1", itemId: "cumple", result: "conforming", comment: null, value: null, needsConfirmation: false,
    })
    const { answers, held } = buildAnswersPayload({
      items,
      drafts: { "s1::cumple": draft() },
      persisted,
      photoCountByKey: { "s1::cumple": 0 },
    })
    expect(answers).toEqual([])
    expect(held).toEqual([])
  })

  it("una fila retenida que nunca se persistió se omite", () => {
    const { answers, held } = buildAnswersPayload({
      items,
      drafts: { "s1::cumple": draft({ result: "non_conforming" }) },
      persisted: {},
    })
    expect(answers).toEqual([])
    expect(held).toHaveLength(1)
  })

  it("un texto que pasa el tope del servidor retiene la fila en vez de hacer rechazar el lote", () => {
    const { answers, held } = buildAnswersPayload({
      items,
      drafts: {
        "s1::cumple": draft({ result: "non_conforming", comment: "x".repeat(2001) }),
        "s1::texto": draft({ result: "recorded", value: "ok" }),
      },
      persisted: {},
    })
    expect(answers.map((answer) => answer.itemId)).toEqual(["texto"])
    expect(held[0]!.problem).toMatch(/supera los 2000 caracteres/)
  })

  it("ignora borradores de ítems que la plantilla no tiene", () => {
    const { answers, held } = buildAnswersPayload({
      items,
      drafts: { "s1::fantasma": draft({ result: "conforming" }) },
      persisted: {},
    })
    expect(answers).toEqual([])
    expect(held).toEqual([])
  })
})

describe("sameAnswerSet", () => {
  const a: InspectionAnswerInput = { sectionId: "s1", itemId: "a", result: "conforming", comment: null, value: null, needsConfirmation: false }
  const b: InspectionAnswerInput = { sectionId: "s1", itemId: "b", result: "non_conforming", comment: "Falta", value: null }

  it("no depende del orden", () => {
    expect(sameAnswerSet([a, b], [b, a])).toBe(true)
  })

  it("trata ausente y null / false como lo mismo", () => {
    expect(sameAnswerSet([{ ...b, needsConfirmation: false, value: null }], [b])).toBe(true)
  })

  it("detecta una diferencia de contenido, de tamaño o de clave", () => {
    expect(sameAnswerSet([a, b], [a, { ...b, comment: "Otro" }])).toBe(false)
    expect(sameAnswerSet([a], [a, b])).toBe(false)
    expect(sameAnswerSet([a], [{ ...a, itemId: "z" }])).toBe(false)
    expect(sameAnswerSet([], [])).toBe(true)
  })
})

describe("diffDrafts", () => {
  it("devuelve las claves que difieren; ausente equivale a «Sin responder» vacía", () => {
    const base = { "s1::a": draft({ result: "conforming" }), "s1::b": draft({ result: "partial", comment: "Desgaste" }) }
    const local = { "s1::a": draft({ result: "conforming" }), "s1::b": draft({ result: "partial", comment: "Desgaste" }), "s1::c": draft() }
    expect(diffDrafts(local, base)).toEqual([])
    expect(diffDrafts({ ...local, "s1::c": draft({ result: "conforming" }) }, base)).toEqual(["s1::c"])
    expect(diffDrafts({ "s1::a": local["s1::a"] }, base)).toEqual(["s1::b"])
  })

  it("compara recortado, igual que el envío", () => {
    expect(diffDrafts({ "s1::a": draft({ result: "conforming", comment: "ok " }) }, { "s1::a": draft({ result: "conforming", comment: "ok" }) })).toEqual([])
  })

  it("un comentario tecleado sin resultado todavía cuenta como algo que rescatar", () => {
    expect(diffDrafts({ "s1::a": draft({ comment: "Pendiente de medir" }) }, {})).toEqual(["s1::a"])
  })
})

describe("rebaseDrafts", () => {
  const server = {
    "s1::a": draft({ result: "conforming" }),
    "s1::b": draft({ result: "non_conforming", comment: "Del otro inspector" }),
  }
  const oldPersisted = { "s1::a": draft({ result: "conforming" }) }

  it("gana lo local que difiere de lo persistido antes y se conserva lo que el otro guardó", () => {
    const local = {
      "s1::a": draft({ result: "non_conforming", comment: "Mi cambio" }),
      "s1::c": draft({ result: "conforming" }),
    }
    expect(rebaseDrafts({ server, oldPersisted, local })).toEqual({
      "s1::a": local["s1::a"],
      "s1::b": server["s1::b"],
      "s1::c": local["s1::c"],
    })
  })

  it("lo local que no cambió no pisa lo nuevo del servidor", () => {
    const local = { "s1::a": draft({ result: "conforming" }) }
    const newer = { ...server, "s1::a": draft({ result: "partial", comment: "Del otro" }) }
    expect(rebaseDrafts({ server: newer, oldPersisted, local })["s1::a"]).toEqual(newer["s1::a"])
  })

  it("una fila que la persona dejó sin responder se quita del resultado", () => {
    const local = { "s1::a": draft() }
    expect(rebaseDrafts({ server, oldPersisted, local })).not.toHaveProperty("s1::a")
  })

  it("no muta sus entradas", () => {
    const snapshot = JSON.stringify(server)
    rebaseDrafts({ server, oldPersisted, local: { "s1::a": draft() } })
    expect(JSON.stringify(server)).toBe(snapshot)
  })

  it("draftsFromAnswers deja las respuestas persistidas listas para comparar", () => {
    expect(draftsFromAnswers([{ sectionId: "s1", itemId: "a", result: "partial", comment: "x", value: null }])).toEqual({
      "s1::a": { result: "partial", comment: "x", value: "", needsConfirmation: false },
    })
  })
})

describe("classifySaveFailure", () => {
  it("una excepción es transitoria: sin conexión si el navegador lo dice, reintentando si no", () => {
    expect(classifySaveFailure(null, { thrown: true, online: false })).toEqual({ transient: true, code: null, state: { kind: "offline" } })
    expect(classifySaveFailure(null, { thrown: true, online: true })).toMatchObject({ transient: true, state: { kind: "retrying" } })
    expect(classifySaveFailure({ ok: false }, { thrown: true })).toMatchObject({ transient: true })
  })

  it("el conflicto de versión y el estado no editable son permanentes y tienen estado propio", () => {
    expect(classifySaveFailure({ ok: false, data: { code: "version_conflict" } })).toEqual({
      transient: false, code: "version_conflict", state: { kind: "conflict" },
    })
    expect(classifySaveFailure({ ok: false, data: { code: "not_editable" } })).toMatchObject({
      transient: false, state: { kind: "not_editable" },
    })
  })

  it("cualquier otro rechazo es permanente y conserva el mensaje del servidor", () => {
    expect(classifySaveFailure({ ok: false, message: "Falta el motivo", data: { code: "invalid_row" } })).toEqual({
      transient: false, code: "invalid_row", state: { kind: "rejected", message: "Falta el motivo" },
    })
    expect(classifySaveFailure({ ok: false, message: "Algo falló" })).toMatchObject({
      transient: false, code: null, state: { kind: "rejected", message: "Algo falló" },
    })
    expect(classifySaveFailure({ ok: false })).toMatchObject({ state: { kind: "rejected", message: "No se pudo guardar." } })
  })
})

describe("captureStatusLabel", () => {
  it("dice lo mismo para cada estado, con el plural de las filas incompletas", () => {
    expect(captureStatusLabel({ kind: "saved", heldCount: 0 })).toBe("Guardado")
    expect(captureStatusLabel({ kind: "saved", heldCount: 1 })).toBe("Guardado, salvo 1 respuesta incompleta")
    expect(captureStatusLabel({ kind: "saved", heldCount: 3 })).toBe("Guardado, salvo 3 respuestas incompletas")
    expect(captureStatusLabel({ kind: "dirty" })).toBe("Cambios sin guardar")
    expect(captureStatusLabel({ kind: "saving" })).toBe("Guardando…")
    expect(captureStatusLabel({ kind: "offline" })).toBe("Sin conexión · se enviará al volver la señal")
    expect(captureStatusLabel({ kind: "retrying" })).toBe("No se pudo guardar · reintentando")
    expect(captureStatusLabel({ kind: "conflict" })).toBe("Cambió en otra sesión")
    expect(captureStatusLabel({ kind: "not_editable" })).toBe("Ya no se puede editar")
    expect(captureStatusLabel({ kind: "rejected", message: "x" })).toBe("No se pudo guardar")
    expect(captureStatusLabel({ kind: "closing" })).toBe("Declarando ejecutada…")
    expect(captureStatusLabel({ kind: "queued_close" })).toBe("Cierre pendiente de enviar")
  })
})

describe("summarizeCompletion", () => {
  it("sin retenidas ni impedimentos se puede declarar", () => {
    expect(summarizeCompletion([], [])).toEqual({ lines: [], firstKey: null, heldCount: 0, canComplete: true })
  })

  it("lista primero las retenidas y no repite el impedimento de la misma fila", () => {
    const summary = summarizeCompletion(
      [
        { kind: "missing_nc_reason", detail: "Ítem b", sectionId: "s1", itemId: "b" },
        { kind: "missing_required", detail: "Ítem c", sectionId: "s1", itemId: "c" },
        { kind: "missing_closing_act", detail: "Falta el resultado del acta." },
      ],
      [{ key: "s1::b", reason: "invalid", problem: "«Ítem b»: un \"No cumple\" exige indicar el motivo." }],
    )
    expect(summary.lines).toEqual([
      { key: "s1::b", text: "«Ítem b»: un \"No cumple\" exige indicar el motivo.", held: true },
      { key: "s1::c", text: "Ítem c", held: false },
      { key: null, text: "Falta el resultado del acta.", held: false },
    ])
    expect(summary.firstKey).toBe("s1::b")
    expect(summary.heldCount).toBe(1)
    expect(summary.canComplete).toBe(false)
  })

  it("«Ir al primero» salta al primer ítem aunque la primera línea no cuelgue de uno", () => {
    const summary = summarizeCompletion(
      [
        { kind: "missing_closing_act", detail: "Falta el acta." },
        { kind: "missing_required", detail: "Ítem c", sectionId: "s1", itemId: "c" },
      ],
      [],
    )
    expect(summary.firstKey).toBe("s1::c")
  })
})
