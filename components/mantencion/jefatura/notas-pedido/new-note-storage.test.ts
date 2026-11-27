// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { newDraft, newLine, type NoteDraft } from "./new-note-draft"
import { NEW_NOTE_OPTIONS as OPTIONS, SINGLE_WORKSITE_OPTIONS } from "./new-note-fixtures"
import { clearAllNewNoteDrafts } from "./new-note-draft-keys"
import { clearDraft, draftStorageKey, readDraft, sanitizeDraft, writeDraft } from "./new-note-storage"

const USER = "u-mec"
const NOW = new Date("2026-11-27T12:00:00.000Z")

const written = (): NoteDraft => ({
  ...newDraft(OPTIONS, { workOrderId: "ot-1" }),
  clientOpId: "op-12345678",
  urgent: true,
  notes: "Para mañana",
  lines: [
    { ...newLine("l1", "v:v-1"), description: "Filtro de aceite", quantity: "2", supplierId: "sup-1" },
    { ...newLine("l2", "c:cc-1"), description: "Guantes", quantity: "10", unit: "par" },
  ],
})

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe("borrador en el equipo", () => {
  it("se guarda y se restaura igual, con su clientOpId, para que el reenvío no duplique", () => {
    const draft = written()
    expect(writeDraft(USER, draft, NOW)).toBe(true)
    expect(readDraft(USER, OPTIONS, NOW)).toEqual({ draft, savedAt: NOW.toISOString() })
  })

  it("es de cada persona: otra cuenta del mismo equipo no lo ve, ni aunque copie la clave", () => {
    writeDraft(USER, written(), NOW)
    expect(readDraft("u-otro", OPTIONS, NOW)).toBeNull()
    localStorage.setItem(draftStorageKey("u-otro"), localStorage.getItem(draftStorageKey(USER))!)
    expect(readDraft("u-otro", OPTIONS, NOW)).toBeNull()
  })

  it("clearAllNewNoteDrafts (cerrar sesión) borra el borrador de todas las personas y deja las claves ajenas", () => {
    writeDraft(USER, written(), NOW)
    writeDraft("u-otro", written(), NOW)
    localStorage.setItem("chome:inspeccion:otra", "{}")
    clearAllNewNoteDrafts()
    expect(readDraft(USER, OPTIONS, NOW)).toBeNull()
    expect(readDraft("u-otro", OPTIONS, NOW)).toBeNull()
    expect(localStorage.getItem(draftStorageKey(USER))).toBeNull()
    expect(localStorage.getItem("chome:inspeccion:otra")).toBe("{}")
  })

  it("clearAllNewNoteDrafts no lanza con el almacenamiento bloqueado", () => {
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => { throw new Error("bloqueado") })
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("bloqueado") })
    expect(() => clearAllNewNoteDrafts()).not.toThrow()
  })

  it("clearDraft lo borra, y uno de hace más de un mes ya no se restaura", () => {
    writeDraft(USER, written(), NOW)
    expect(readDraft(USER, OPTIONS, new Date("2026-12-26T12:00:00.000Z"))).not.toBeNull()
    expect(readDraft(USER, OPTIONS, new Date("2026-12-28T12:00:00.000Z"))).toBeNull()
    clearDraft(USER)
    expect(readDraft(USER, OPTIONS, NOW)).toBeNull()
  })

  it("lo ilegible (JSON roto, otra versión, forma distinta) es «no había borrador», nunca un error", () => {
    const key = draftStorageKey(USER)
    for (const stored of ["{no es json", "null", JSON.stringify({ schema: 99, userId: USER, savedAt: NOW.toISOString(), draft: written() }), JSON.stringify({ schema: 1, userId: USER, savedAt: "ayer", draft: written() }), JSON.stringify({ schema: 1, userId: USER, savedAt: NOW.toISOString(), draft: "x" })]) {
      localStorage.setItem(key, stored)
      expect(readDraft(USER, OPTIONS, NOW)).toBeNull()
    }
  })

  it("con el almacenamiento bloqueado nada lanza: leer da «no hay», escribir avisa con false", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked") })
    expect(readDraft(USER, OPTIONS, NOW)).toBeNull()
    expect(writeDraft(USER, written(), NOW)).toBe(false)
    expect(() => clearDraft(USER)).not.toThrow()
  })
})

describe("lo guardado se ajusta a lo que hoy se ofrece", () => {
  it("suelta la OT, el cargo y el proveedor que ya no existen o son de otra faena, y conserva el resto", () => {
    const stale = { ...written(), worksiteId: "ws-1", workOrderId: "ot-2" }
    stale.lines = [
      { ...stale.lines[0]!, charge: "v:v-2", supplierId: "sup-baja" },
      { ...stale.lines[1]!, charge: "c:cc-1", supplierId: "sup-1" },
    ]
    const draft = sanitizeDraft(stale, OPTIONS)!
    expect(draft.workOrderId).toBe("")
    expect(draft.lines.map((line) => [line.charge, line.supplierId])).toEqual([["", ""], ["c:cc-1", "sup-1"]])
    expect(draft).toMatchObject({ clientOpId: "op-12345678", urgent: true, notes: "Para mañana" })
  })

  it("una faena fuera del alcance se suelta (o queda la única que hay) y con ella su OT y sus cargos", () => {
    const outside = { ...written(), worksiteId: "ws-9" }
    expect(sanitizeDraft(outside, OPTIONS)).toMatchObject({ worksiteId: "", workOrderId: "" })
    expect(sanitizeDraft(outside, SINGLE_WORKSITE_OPTIONS)).toMatchObject({ worksiteId: "ws-1" })
  })

  it("normaliza lo raro: sin líneas queda una vacía, claves nuevas, topes de largo, id de operación corto se descarta", () => {
    const draft = sanitizeDraft({ worksiteId: "ws-1", clientOpId: "corto", notes: "x".repeat(900), lines: [] }, OPTIONS)!
    expect(draft.clientOpId).toBe("")
    expect(draft.notes).toHaveLength(500)
    expect(draft.lines).toHaveLength(1)
    const many = sanitizeDraft({ worksiteId: "ws-1", lines: Array.from({ length: 30 }, () => ({ description: "a", quantity: 7, part: { id: "", name: "" } })) }, OPTIONS)!
    expect(many.lines).toHaveLength(20)
    expect(many.lines.map((line) => line.key).slice(0, 3)).toEqual(["l1", "l2", "l3"])
    expect(many.lines[0]).toMatchObject({ quantity: "1", unit: "unidad", part: null })
    expect(sanitizeDraft("texto", OPTIONS)).toBeNull()
  })
})
