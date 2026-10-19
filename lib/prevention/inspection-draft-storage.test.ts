// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearAllInspectionDrafts,
  clearInspectionDraft,
  clearInspectionDraftsOfRun,
  currentTabId,
  inspectionDraftKey,
  readInspectionDraft,
  readInspectionDrafts,
  writeInspectionDraft,
} from "@/lib/prevention/inspection-draft-storage"

const DRAFTS = { "s1::a": { result: "conforming", comment: "", value: "", needsConfirmation: false } }

function seed(key: string, value: unknown, storage: Storage = localStorage) {
  storage.setItem(key, typeof value === "string" ? value : JSON.stringify(value))
}

describe("inspection-draft-storage", () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it("escribe en localStorage, por ejecución y por pestaña, con el esquema v2", () => {
    expect(writeInspectionDraft("run-1", { version: 3, drafts: DRAFTS, userId: "u1" })).toBe(true)
    const key = `chome:inspection-draft:run-1:${currentTabId()}`
    expect(inspectionDraftKey("run-1")).toBe(key)
    const stored = JSON.parse(localStorage.getItem(key)!)
    expect(stored).toMatchObject({ schema: 2, userId: "u1", tabId: currentTabId(), version: 3, drafts: DRAFTS })
    expect(typeof stored.savedAt).toBe("string")
    // sessionStorage sólo guarda el id de la pestaña, nunca las respuestas.
    expect(sessionStorage.getItem(key)).toBeNull()
  })

  it("el id de pestaña es estable dentro de la pestaña", () => {
    expect(currentTabId()).toBe(currentTabId())
    sessionStorage.clear()
    expect(currentTabId()).not.toBe("")
  })

  it("guarda el acta, la ubicación y los participantes sin enviar", () => {
    writeInspectionDraft("run-1", {
      version: 2,
      drafts: {},
      closing: { result: "approved", restrictions: "Ninguna", signatures: [{ role: "prevencionista", name: "Ana" }] },
      coords: { lat: "-33.4", lon: "-70.6" },
      participants: [{ id: "p1", name: "Luis", position: "Operador", userId: null }],
    })
    const [stored] = readInspectionDrafts("run-1")
    expect(stored!.snapshot.closing?.result).toBe("approved")
    expect(stored!.snapshot.coords).toEqual({ lat: "-33.4", lon: "-70.6" })
    expect(stored!.snapshot.participants).toHaveLength(1)
  })

  it("devuelve false si el almacenamiento falla (cuota llena o bloqueado)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError") })
    expect(writeInspectionDraft("run-1", { version: 1, drafts: DRAFTS })).toBe(false)
  })

  it("lee los espejos de todas las pestañas de la ejecución, el más reciente primero, y marca el propio", () => {
    writeInspectionDraft("run-1", { version: 3, drafts: DRAFTS, savedAt: "2026-10-19T10:00:00.000Z" })
    seed("chome:inspection-draft:run-1:otra-pestana", {
      schema: 2, userId: "u1", tabId: "otra-pestana", version: 3, savedAt: "2026-10-19T11:00:00.000Z", drafts: DRAFTS,
    })
    seed("chome:inspection-draft:run-2:otra", { schema: 2, userId: "u1", tabId: "otra", version: 1, savedAt: "x", drafts: DRAFTS })

    const found = readInspectionDrafts("run-1")
    expect(found.map((entry) => entry.snapshot.tabId)).toEqual(["otra-pestana", currentTabId()])
    expect(found.map((entry) => entry.ownTab)).toEqual([false, true])
    expect(found.every((entry) => !entry.pending)).toBe(true)
  })

  it("el espejo apartado (pending) vive en su propia clave y no pisa al vivo", () => {
    writeInspectionDraft("run-1", { version: 3, drafts: DRAFTS })
    writeInspectionDraft("run-1", { version: 2, drafts: {} }, "pending")
    expect(inspectionDraftKey("run-1", "pending")).toBe(`chome:inspection-draft:run-1:pending:${currentTabId()}`)
    const found = readInspectionDrafts("run-1")
    expect(found).toHaveLength(2)
    expect(found.filter((entry) => entry.pending)).toHaveLength(1)
    expect(found.find((entry) => entry.pending)?.snapshot.version).toBe(2)
    expect(found.find((entry) => entry.pending)?.ownTab).toBe(true)
  })

  it("migra el espejo de la versión anterior que quedó en sessionStorage", () => {
    seed("chome:inspection-draft:run-1", { version: 4, savedAt: "2026-10-19T09:00:00.000Z", drafts: DRAFTS }, sessionStorage)
    const found = readInspectionDrafts("run-1")
    expect(found).toHaveLength(1)
    expect(found[0]!.snapshot).toMatchObject({ schema: 2, userId: null, tabId: currentTabId(), version: 4, drafts: DRAFTS })
    // Ya vive en localStorage y salió de sessionStorage.
    expect(localStorage.getItem(inspectionDraftKey("run-1"))).not.toBeNull()
    expect(sessionStorage.getItem("chome:inspection-draft:run-1")).toBeNull()
    // Leer de nuevo no lo duplica.
    expect(readInspectionDrafts("run-1")).toHaveLength(1)
  })

  it("la migración no pisa un espejo v2 que esta pestaña ya tiene", () => {
    writeInspectionDraft("run-1", { version: 5, drafts: DRAFTS })
    seed("chome:inspection-draft:run-1", { version: 1, savedAt: "x", drafts: {} }, sessionStorage)
    const found = readInspectionDrafts("run-1")
    expect(found).toHaveLength(1)
    expect(found[0]!.snapshot.version).toBe(5)
    expect(sessionStorage.getItem("chome:inspection-draft:run-1")).toBeNull()
  })

  it("readInspectionDraft devuelve el más reciente o null", () => {
    expect(readInspectionDraft("run-1")).toBeNull()
    writeInspectionDraft("run-1", { version: 7, drafts: DRAFTS })
    expect(readInspectionDraft("run-1")?.version).toBe(7)
  })

  it("descarta lo que no tiene forma reconocible: JSON roto, sin drafts, esquema futuro", () => {
    seed("chome:inspection-draft:run-1:a", "{no es json")
    seed("chome:inspection-draft:run-1:b", { schema: 2, version: 1 })
    seed("chome:inspection-draft:run-1:c", { schema: 3, version: 1, drafts: DRAFTS })
    seed("chome:inspection-draft:run-1:d", { schema: 2, version: "1", drafts: DRAFTS })
    seed("chome:inspection-draft:run-1:e", "null")
    expect(readInspectionDrafts("run-1")).toEqual([])
    expect(readInspectionDraft("run-1")).toBeNull()
  })

  it("un almacenamiento que lanza degrada a «no había borrador»", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("bloqueado") })
    expect(readInspectionDrafts("run-1")).toEqual([])
  })

  describe("borrado", () => {
    it("clearInspectionDraft sin clave borra el de esta pestaña y deja el de otra", () => {
      writeInspectionDraft("run-1", { version: 1, drafts: DRAFTS })
      seed("chome:inspection-draft:run-1:otra", { schema: 2, userId: null, tabId: "otra", version: 1, savedAt: "x", drafts: DRAFTS })
      clearInspectionDraft("run-1")
      expect(readInspectionDrafts("run-1").map((entry) => entry.snapshot.tabId)).toEqual(["otra"])
    })

    it("clearInspectionDraft con clave borra sólo ese espejo, y sólo si es de la ejecución", () => {
      writeInspectionDraft("run-1", { version: 1, drafts: DRAFTS })
      writeInspectionDraft("run-1", { version: 1, drafts: DRAFTS }, "pending")
      writeInspectionDraft("run-2", { version: 1, drafts: DRAFTS })
      clearInspectionDraft("run-1", inspectionDraftKey("run-1", "pending"))
      expect(readInspectionDrafts("run-1").filter((entry) => entry.pending)).toHaveLength(0)
      expect(readInspectionDrafts("run-1")).toHaveLength(1)
      // Una clave de otra ejecución no se borra por esta vía.
      clearInspectionDraft("run-1", inspectionDraftKey("run-2"))
      expect(readInspectionDrafts("run-2")).toHaveLength(1)
    })

    it("clearInspectionDraftsOfRun borra todas las pestañas de la ejecución y ninguna ajena", () => {
      writeInspectionDraft("run-1", { version: 1, drafts: DRAFTS })
      writeInspectionDraft("run-1", { version: 1, drafts: DRAFTS }, "pending")
      seed("chome:inspection-draft:run-1:otra", { schema: 2, userId: null, tabId: "otra", version: 1, savedAt: "x", drafts: DRAFTS })
      writeInspectionDraft("run-2", { version: 1, drafts: DRAFTS })
      clearInspectionDraftsOfRun("run-1")
      expect(readInspectionDrafts("run-1")).toEqual([])
      expect(readInspectionDrafts("run-2")).toHaveLength(1)
    })

    it("clearAllInspectionDrafts borra todo lo de inspecciones y respeta las claves ajenas", () => {
      writeInspectionDraft("run-1", { version: 1, drafts: DRAFTS })
      writeInspectionDraft("run-2", { version: 1, drafts: DRAFTS }, "pending")
      seed("chome:inspection-draft:run-3:otra", { schema: 2, userId: null, tabId: "otra", version: 1, savedAt: "x", drafts: DRAFTS })
      seed("chome:inspection-draft:run-4", { version: 1, savedAt: "x", drafts: DRAFTS }, sessionStorage)
      localStorage.setItem("chome:saved-views", "[1]")
      localStorage.setItem("theme", "dark")
      sessionStorage.setItem("otra-cosa", "x")

      clearAllInspectionDrafts()

      expect(Object.keys(localStorage).sort()).toEqual(["chome:saved-views", "theme"])
      expect(sessionStorage.getItem("chome:inspection-draft:run-4")).toBeNull()
      expect(sessionStorage.getItem("otra-cosa")).toBe("x")
    })

    it("un almacenamiento que lanza no rompe el borrado", () => {
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("bloqueado") })
      expect(() => {
        clearInspectionDraft("run-1")
        clearInspectionDraftsOfRun("run-1")
        clearAllInspectionDrafts()
      }).not.toThrow()
    })
  })
})
