import { describe, expect, it } from "vitest"
import { partsNoteSchema, type CatalogPartsNote, type MantCatalog } from "../../contracts"
import { rejectedNotes } from "../home-model"
import { buildMyNotes, noteLineText, splitMyNotes } from "../parts-notes-model"
import { canRequestParts, chargeChoices, chargeFields, chargeOfCostCenter, chargeOfVehicle, chargeStillValid, NO_CHARGE, partsNoteInput } from "../parts-request-model"
import type { QueueItem } from "../types"
import { UUID, catalog, equipment, freePartsNoteItem, ownNote, partsNoteItem } from "./fixtures"

const LINE = (overrides: Partial<CatalogPartsNote["lines"][number]> = {}): CatalogPartsNote["lines"][number] => ({
  id: "l-1", description: "Filtro de aceite", quantity: 5, unit: "unidad", partNumber: null, stage: "pedido", arrived: 0, used: 0, rejectionReason: null, ...overrides,
})

const withNotes = (notes: CatalogPartsNote[], extra: Partial<MantCatalog> = {}): MantCatalog => ({ ...catalog("u-1"), ownPartsNotes: notes, ...extra })
const mine = (notes: CatalogPartsNote[], queue: QueueItem[] = [], extra: Partial<MantCatalog> = {}) => buildMyNotes(withNotes(notes, extra), queue, "u-1")

describe("«Mis notas»: estado en lenguaje simple y motivo a la vista", () => {
  it("cada estado del servidor se dice con palabras y tono", () => {
    const states = ["enviada", "aceptada", "en_espera", "en_gestion", "en_compra", "recibida_parcial", "cerrada", "rechazada", "anulada"] as const
    const labels = states.map((status, index) => mine([ownNote({ id: `n-${index}`, status, createdAt: `2026-10-28T10:0${index}:00.000Z` })])[0]!)
    expect(labels.map((note) => note.label)).toEqual(["Enviada", "Aceptada", "En espera", "En gestión", "En compra", "Llegó una parte", "Cerrada", "Rechazada", "Anulada"])
    expect(labels.find((note) => note.state === "cerrada")?.tone).toBe("ok")
    expect(labels.find((note) => note.state === "rechazada")?.tone).toBe("bad")
    for (const note of labels) expect(note.detail.length).toBeGreaterThan(0)
  })

  it("En espera y Anulada muestran su motivo; Rechazada, el de sus líneas rechazadas", () => {
    const [hold] = mine([ownNote({ status: "en_espera", statusReason: "Espera la cotización del proveedor" })])
    expect(hold).toMatchObject({ state: "en_espera", reason: "Espera la cotización del proveedor", open: true })

    const [voided] = mine([ownNote({ status: "anulada", statusReason: "Se pidió dos veces" })])
    expect(voided).toMatchObject({ state: "anulada", reason: "Se pidió dos veces", open: false })

    const rejected = ownNote({ status: "rechazada", lines: [
      LINE({ id: "a", stage: "rechazado", rejectionReason: "No se usa en esa flota" }),
      LINE({ id: "b", stage: "rechazado", rejectionReason: "No se usa en esa flota" }),
    ] })
    expect(mine([rejected])[0]).toMatchObject({ state: "rechazada", reason: "No se usa en esa flota", open: false })
    // Con motivos distintos no se inventa uno: cada línea dice el suyo.
    const mixed = ownNote({ status: "rechazada", lines: [LINE({ id: "a", stage: "rechazado", rejectionReason: "Uno" }), LINE({ id: "b", stage: "rechazado", rejectionReason: "Otro" })] })
    expect(mine([mixed])[0]!.reason).toBeNull()
    expect(mine([mixed])[0]!.lines.map((line) => line.label)).toEqual(["Rechazado: Uno", "Rechazado: Otro"])
  })

  it("una línea rechazada de una nota abierta dice su motivo y no cuenta como algo que se espera", () => {
    const [note] = mine([ownNote({ status: "en_gestion", lines: [
      LINE({ id: "a", stage: "en_bodega", arrived: 5 }),
      LINE({ id: "b", stage: "rechazado", rejectionReason: "Ya hay en bodega" }),
      LINE({ id: "c", stage: "pedido" }),
    ] })])
    expect(note!.lines.map((line) => line.label)).toEqual(["Llegó 5 de 5", "Rechazado: Ya hay en bodega", "Pedido"])
    expect(note).toMatchObject({ arrivedLines: 1, expectedLines: 2 })
  })

  it("el avance de recepción por línea dice «Llegó 2 de 5», y «Usado» aparte cuando la línea ya se consumió", () => {
    expect(noteLineText({ stage: "en_bodega", quantity: 5, arrived: 2, used: 0, rejectionReason: null })).toMatchObject({ label: "Llegó 2 de 5", tone: "info", complete: false })
    expect(noteLineText({ stage: "en_bodega", quantity: 5, arrived: 5, used: 0, rejectionReason: null })).toMatchObject({ label: "Llegó 5 de 5", tone: "ok", complete: true })
    expect(noteLineText({ stage: "en_bodega", quantity: 2, arrived: 1.5, used: 1, rejectionReason: null })).toMatchObject({ label: "Llegó 1,5 de 2", detail: "Usado 1 de 1,5" })
    expect(noteLineText({ stage: "en_compra", quantity: 5, arrived: 0, used: 0, rejectionReason: null })).toMatchObject({ label: "En compra" })
    expect(noteLineText({ stage: "por_enviar", quantity: 5, arrived: 0, used: 0, rejectionReason: null })).toMatchObject({ label: "Por enviar" })
  })

  it("una nota cerrada con líneas rechazadas dice que lo aprobado llegó", () => {
    const [closed] = mine([ownNote({ status: "cerrada", lines: [LINE({ id: "a", stage: "en_bodega", arrived: 5 }), LINE({ id: "b", stage: "rechazado", rejectionReason: "No aplica" })] })])
    expect(closed).toMatchObject({ state: "cerrada", detail: "Lo aprobado ya llegó a la faena.", open: false })
  })

  it("con OT dice el equipo y el folio; sin OT, la faena; la urgencia sale de `urgent` (o del equipo detenido si no viene)", () => {
    const [withOt, free] = mine([
      ownNote({ id: "a", createdAt: "2026-10-28T11:00:00.000Z", workOrderId: "ot-1", workOrderFolio: "OT-BIO-0001", equipmentCode: "KA-140", equipmentPlate: "SGCP-84", equipmentStopped: true, urgent: undefined }),
      ownNote({ id: "b", urgent: true }),
    ])
    expect(withOt).toMatchObject({ workOrderFolio: "OT-BIO-0001", equipment: "KA-140 · SGCP-84", urgent: true })
    expect(free).toMatchObject({ workOrderFolio: null, equipment: null, worksiteName: "Biodiversa", urgent: true })
  })

  it("abiertas y cerradas se separan: cerrada, rechazada y anulada ya no tienen nada por hacer", () => {
    const notes = mine([
      ownNote({ id: "a", status: "en_compra", createdAt: "2026-10-28T10:01:00.000Z" }),
      ownNote({ id: "b", status: "cerrada", createdAt: "2026-10-28T10:02:00.000Z" }),
      ownNote({ id: "c", status: "rechazada", createdAt: "2026-10-28T10:03:00.000Z" }),
      ownNote({ id: "d", status: "anulada", createdAt: "2026-10-28T10:04:00.000Z" }),
      ownNote({ id: "e", status: "aceptada", createdAt: "2026-10-28T10:05:00.000Z" }),
    ])
    const { open, closed } = splitMyNotes(notes)
    expect(open.map((note) => note.key)).toEqual(["e", "a"])
    expect(closed.map((note) => note.key)).toEqual(["d", "c", "b"])
  })
})

describe("«Mis notas»: lo que aún está en el teléfono", () => {
  it("un pedido en la cola sale «Por enviar», sin folio, con su faena y sus líneas; va antes que lo del servidor", () => {
    const pending = freePartsNoteItem(1, { urgent: true, notes: "Para el taller", createdAt: "2026-10-27T09:00:00.000Z" })
    const notes = mine([ownNote()], [pending])
    expect(notes.map((note) => note.key)).toEqual([pending.id, "np-own-1"])
    expect(notes[0]).toMatchObject({
      code: null, state: "por_enviar", label: "Por enviar", open: true, urgent: true, worksiteName: "Biodiversa", workOrderFolio: null,
      observation: "Para el taller", queueId: pending.id,
    })
    expect(notes[0]!.lines).toEqual([expect.objectContaining({ description: "Rodamiento 6205", quantity: 4, label: "Por enviar", stage: "por_enviar" })])
  })

  it("enviándose o esperando que su autor entre de nuevo también es «Por enviar»", () => {
    for (const status of ["pending", "sending", "needs_login"] as const) {
      expect(mine([], [{ ...freePartsNoteItem(1), status }])[0]).toMatchObject({ state: "por_enviar" })
    }
  })

  it("lo enviado cuenta mientras el catálogo guardado sea más viejo que el envío; después manda el catálogo", () => {
    const sent = { ...freePartsNoteItem(1), status: "sent" as const, sentAt: "2026-10-28T13:00:00.000Z" }
    // generatedAt del catálogo de pruebas: 12:00. El envío fue después: la nota aún no está en el catálogo.
    expect(mine([], [sent])[0]).toMatchObject({ state: "enviada", code: null })
    const newer = buildMyNotes({ ...withNotes([]), generatedAt: "2026-10-28T14:00:00.000Z" }, [sent], "u-1")
    expect(newer).toEqual([])
  })

  it("si el catálogo ya trae la nota (mismo clientOpId) no se lista dos veces: manda el del servidor", () => {
    const pending = { ...freePartsNoteItem(1), status: "sent" as const, sentAt: "2026-10-28T13:00:00.000Z" }
    const notes = mine([ownNote({ clientOpId: pending.id, status: "aceptada" })], [pending])
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ code: "NP-2026-0101", state: "aceptada" })
  })

  it("un envío rechazado queda a la vista con su motivo hasta que se lee, y es de quien lo pidió", () => {
    const rejected = { ...freePartsNoteItem(1), status: "rejected" as const, lastError: "Esa faena no es de tu alcance." }
    const [note] = mine([], [rejected, { ...freePartsNoteItem(2, { authorUserId: "u-2" }), status: "rejected" as const }])
    expect(note).toMatchObject({ state: "no_enviada", label: "No se pudo enviar", reason: "Esa faena no es de tu alcance.", open: true, queueId: rejected.id })
    expect(mine([], [rejected, { ...freePartsNoteItem(2, { authorUserId: "u-2" }), status: "rejected" as const }])).toHaveLength(1)
  })

  it("el pedido de una OT guardado antes de pedir sin OT (resumen con OT) se lista con su equipo y su folio", () => {
    const [note] = mine([], [partsNoteItem(1)])
    expect(note).toMatchObject({ state: "por_enviar", workOrderFolio: "OT-BIO-0001", equipment: "KA-140 · SGCP-84", urgent: false })
  })

  it("sin catálogo o con uno antiguo (sin ownPartsNotes) sólo se ve lo del teléfono", () => {
    expect(buildMyNotes(null, [], "u-1")).toEqual([])
    expect(buildMyNotes(catalog("u-1"), [freePartsNoteItem(1)], "u-1")).toHaveLength(1)
  })

  it("el título del rechazo de un pedido sin OT dice la faena; el de uno con OT, el equipo y el folio", () => {
    const rejected = (item: ReturnType<typeof freePartsNoteItem>) => rejectedNotes([{ ...item, status: "rejected", lastError: "No" }], "u-1")[0]!.title
    expect(rejected(freePartsNoteItem(1))).toBe("Biodiversa · Pedido de repuestos")
    expect(rejected(partsNoteItem(2))).toBe("KA-140 · OT-BIO-0001 · Pedido de repuestos")
  })
})

describe("«Pedir repuestos» sin OT: cargo, faena y payload", () => {
  const CATALOG: MantCatalog = {
    ...catalog("u-1", [equipment({ id: "veh-2", code: "CR-52", plate: "CR-52", typeName: "Retroexcavadora" }), equipment(), equipment({ id: "veh-9", code: "ZZ-1", plate: "ZZ-1", worksiteId: "ws-cho", worksiteName: "Cholguán" })]),
    user: { id: "u-1", name: "Javier Roa", worksiteIds: ["ws-bio"], canRequestParts: true },
    costCenters: [{ id: "cc-bio", name: "Taller", worksiteId: "ws-bio" }, { id: "cc-cho", name: "Taller Cholguán", worksiteId: "ws-cho" }],
  }

  it("se ofrece sólo si la plataforma lo dice y hay a qué faena pedir", () => {
    expect(canRequestParts(CATALOG)).toBe(true)
    expect(canRequestParts(catalog("u-1"))).toBe(false)
    expect(canRequestParts({ ...CATALOG, user: { ...CATALOG.user, canRequestParts: false } })).toBe(false)
    expect(canRequestParts({ ...CATALOG, worksites: [] })).toBe(false)
    expect(canRequestParts(null)).toBe(false)
  })

  it("las opciones de cargo son los centros y equipos de ESA faena, por código", () => {
    const choices = chargeChoices(CATALOG, "ws-bio")
    expect(choices.costCenters).toEqual([{ id: "cc-bio", name: "Taller" }])
    expect(choices.equipment.map((eq) => eq.label)).toEqual(["CR-52 · Retroexcavadora", "KA-140 · SGCP-84 · Camión"])
    expect(chargeChoices(CATALOG, "ws-cho").equipment.map((eq) => eq.id)).toEqual(["veh-9"])
    expect(chargeChoices(CATALOG, "")).toEqual({ costCenters: [], equipment: [] })
    // Sin centros en el catálogo: sólo equipos (o nada).
    expect(chargeChoices({ ...CATALOG, costCenters: undefined }, "ws-bio").costCenters).toEqual([])
  })

  it("al cambiar de faena se sueltan los cargos que ya no son opciones", () => {
    const bio = chargeChoices(CATALOG, "ws-bio")
    const cho = chargeChoices(CATALOG, "ws-cho")
    expect(chargeStillValid(NO_CHARGE, cho)).toBe(true)
    expect(chargeStillValid(chargeOfVehicle("veh-1"), bio)).toBe(true)
    expect(chargeStillValid(chargeOfVehicle("veh-1"), cho)).toBe(false)
    expect(chargeStillValid(chargeOfCostCenter("cc-bio"), bio)).toBe(true)
    expect(chargeStillValid(chargeOfCostCenter("cc-bio"), cho)).toBe(false)
    expect(chargeStillValid("x:1", bio)).toBe(false)
  })

  it("el cargo viaja como equipo O centro de costo, nunca los dos, y sin cargo no viaja ninguno", () => {
    expect(chargeFields(chargeOfVehicle("veh-2"))).toEqual({ chargeVehicleId: "veh-2" })
    expect(chargeFields(chargeOfCostCenter("cc-bio"))).toEqual({ chargeCostCenterId: "cc-bio" })
    expect(chargeFields(NO_CHARGE)).toEqual({})
  })

  const base = { id: UUID(1), deviceId: UUID(900), appVersion: "test", createdAt: "2026-10-28T15:00:00.000Z", equipmentStopped: false, notes: "  ", lines: [] }

  it("sin OT lleva la faena y la urgencia, y cada línea su cargo; cumple el esquema del servidor", () => {
    const input = partsNoteInput({
      ...base, worksiteId: "ws-bio", urgent: true, notes: " Pedido de taller ",
      lines: [
        { description: "Rodamiento 6205", quantity: 4, partNumber: " 6205-2RS ", charge: chargeOfVehicle("veh-2") },
        { description: "Guantes de cuero", quantity: 2, partNumber: "", charge: chargeOfCostCenter("cc-bio") },
        { description: "Cable de acero", quantity: 1, partNumber: "", charge: NO_CHARGE },
      ],
    })
    expect(input).not.toHaveProperty("workOrderId")
    const parsed = partsNoteSchema.parse(input)
    expect(parsed).toMatchObject({ worksiteId: "ws-bio", urgent: true, equipmentStopped: false, notes: "Pedido de taller" })
    expect(parsed.lines[0]).toMatchObject({ partNumber: "6205-2RS", chargeVehicleId: "veh-2", productId: null, unitOfMeasure: "unidad" })
    expect(parsed.lines[1]).toMatchObject({ chargeCostCenterId: "cc-bio" })
    expect(parsed.lines[1]).not.toHaveProperty("chargeVehicleId")
    expect(parsed.lines[2]).not.toHaveProperty("chargeVehicleId")
    expect(parsed.lines[2]).not.toHaveProperty("chargeCostCenterId")
  })

  it("con OT es EXACTAMENTE el pedido de siempre: sin faena, sin urgencia y sin claves de cargo", () => {
    const input = partsNoteInput({ ...base, workOrderId: "ot-1", equipmentStopped: true, urgent: true, worksiteId: "ws-bio", lines: [{ description: "Filtro de aceite", quantity: 2, partNumber: "", charge: NO_CHARGE }] })
    expect(input).toEqual({
      id: UUID(1), workOrderId: "ot-1", deviceId: UUID(900), appVersion: "test", createdAt: "2026-10-28T15:00:00.000Z", equipmentStopped: true, notes: null,
      lines: [{ description: "Filtro de aceite", quantity: 2, unitOfMeasure: "unidad", partNumber: null, productId: null }],
    })
    expect(partsNoteSchema.safeParse(input).success).toBe(true)
  })

  it("sin faena ni OT el esquema deja pasar el pedido y es la hoja la que pide elegir faena (el servidor también lo rechaza)", () => {
    const input = partsNoteInput({ ...base, worksiteId: null, lines: [{ description: "Rodamiento", quantity: 1, partNumber: "", charge: NO_CHARGE }] })
    expect(input).toMatchObject({ worksiteId: null })
  })
})
