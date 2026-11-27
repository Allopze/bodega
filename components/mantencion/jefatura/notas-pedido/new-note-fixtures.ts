import type { NewNoteOptions } from "@/lib/services/mantencion/parts-notes/new-note-options"

/** Opciones de ejemplo de «Nueva nota de pedido» para las pruebas: dos faenas, un equipo por faena, una OT por faena. */
export const NEW_NOTE_OPTIONS: NewNoteOptions = {
  worksites: [{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Cholguán" }],
  vehicles: [
    { id: "v-1", worksiteId: "ws-1", code: "KA-135", plate: "RBYD-98", typeName: "Camión" },
    { id: "v-2", worksiteId: "ws-2", code: "GR-11", plate: "GR-11", typeName: "Grúa" },
  ],
  costCenters: [{ id: "cc-1", worksiteId: "ws-1", code: "CC-BIO", name: "Taller Biodiversa" }],
  workOrders: [
    { id: "ot-1", worksiteId: "ws-1", vehicleId: "v-1", folio: "OT-0001", equipment: "KA-135 · Camión" },
    { id: "ot-2", worksiteId: "ws-2", vehicleId: "v-2", folio: "OT-0002", equipment: "GR-11 · Grúa" },
  ],
  suppliers: [{ id: "sup-1", name: "Repuestos Sur", rut: "76.000.000-1" }],
}

/** Lo mismo con una sola faena en el alcance (el mecánico): la faena viene fija. */
export const SINGLE_WORKSITE_OPTIONS: NewNoteOptions = {
  ...NEW_NOTE_OPTIONS,
  worksites: [NEW_NOTE_OPTIONS.worksites[0]!],
  vehicles: NEW_NOTE_OPTIONS.vehicles.filter((item) => item.worksiteId === "ws-1"),
  workOrders: NEW_NOTE_OPTIONS.workOrders.filter((item) => item.worksiteId === "ws-1"),
}
