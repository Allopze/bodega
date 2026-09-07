/* ── Vocabulario de estados y categorías del módulo TI ──────────────────────
 * Mismo patrón que components/states/state-badge.tsx: los estados crudos de la
 * BD se mapean acá a label en español + variante de badge. El timeline
 * (it_asset_history) guarda el valor crudo; la UI nunca lo pinta directo. */

import type { StateMetaInput } from "@/components/states/state-badge"

export type TiBadgeVariant = StateMetaInput["variant"]

export type TiLabelMeta = StateMetaInput

export const IT_ASSET_STATUS_META: Record<string, TiLabelMeta> = {
  disponible:    { label: "Disponible",     variant: "success" },
  asignado:      { label: "Asignado",       variant: "info" },
  en_prestamo:   { label: "En préstamo",    variant: "primary" },
  en_reparacion: { label: "En reparación",  variant: "warning" },
  en_bodega:     { label: "En bodega",      variant: "neutral" },
  dado_de_baja:  { label: "Dado de baja",   variant: "default" },
  perdido:       { label: "Perdido",        variant: "danger" },
  robado:        { label: "Robado",         variant: "danger" },
}

export const IT_PHYSICAL_STATE_META: Record<string, TiLabelMeta> = {
  bueno:  { label: "Bueno",   variant: "success" },
  regular: { label: "Regular", variant: "warning" },
  malo:   { label: "Malo",    variant: "danger" },
  nuevo:  { label: "Nuevo",   variant: "info" },
}

export const IT_ASSIGNMENT_KIND_META: Record<string, string> = {
  delivery:    "Entrega",
  loan:        "Préstamo",
  transfer:    "Transferencia",
  repair_exit: "Salida a reparación",
}

export const IT_MAINTENANCE_TYPE_META: Record<string, string> = {
  preventiva:   "Preventiva",
  correctiva:   "Correctiva",
  reparacion:   "Reparación",
  actualizacion: "Actualización",
  revision:     "Revisión",
}

export const IT_RETIREMENT_REASON_META: Record<string, string> = {
  venta:       "Venta",
  reciclaje:   "Reciclaje",
  destruccion: "Destrucción",
  repuesto:    "Repuesto",
  donacion:    "Donación",
  perdida:     "Pérdida",
  robo:        "Robo",
}

export const IT_TICKET_CATEGORY_META: Record<string, string> = {
  hardware:   "Hardware",
  software:   "Software",
  correo:     "Correo",
  internet:   "Internet",
  impresoras: "Impresoras",
  telefonia:  "Telefonía",
  accesos:    "Accesos",
  plataforma: "Plataforma CHOME",
  cuentas:    "Cuentas",
  otro:       "Otros",
}

export const IT_TICKET_PRIORITY_META: Record<string, TiLabelMeta> = {
  baja:    { label: "Baja",    variant: "default" },
  normal:  { label: "Normal",  variant: "info" },
  alta:    { label: "Alta",    variant: "warning" },
  critica: { label: "Crítica", variant: "danger" },
}

export const IT_TICKET_STATUS_META: Record<string, TiLabelMeta> = {
  nuevo:               { label: "Nuevo",                variant: "signal" },
  asignado:            { label: "Asignado",             variant: "info" },
  en_diagnostico:      { label: "En diagnóstico",       variant: "primary" },
  en_progreso:         { label: "En progreso",          variant: "primary" },
  esperando_usuario:   { label: "Esperando usuario",    variant: "warning" },
  esperando_proveedor: { label: "Esperando proveedor",  variant: "warning" },
  resuelto:            { label: "Resuelto",             variant: "success" },
  cerrado:             { label: "Cerrado",              variant: "default" },
}

export const IT_LICENSE_PERIODICITY_META: Record<string, string> = {
  mensual: "Mensual",
  anual:   "Anual",
  unica:   "Única",
}

export const IT_ACCESS_STATUS_META: Record<string, TiLabelMeta> = {
  activo:     { label: "Activo",     variant: "success" },
  suspendido: { label: "Suspendido", variant: "warning" },
  baja:       { label: "Baja",       variant: "default" },
}

export const IT_SUPPLIER_CATEGORY_META: Record<string, string> = {
  reparacion:     "Reparación de computadores",
  venta_hardware: "Venta de hardware",
  licencias:      "Licencias",
  telefonia:      "Telefonía",
  internet:       "Internet",
  cloud:          "Servicios cloud",
  otro:           "Otro",
}

export const IT_ASSET_CATEGORY_META: Record<string, string> = {
  computacion:    "Computación",
  periferico:     "Periféricos",
  red:            "Red",
  telefonia:      "Telefonía",
  movilidad:      "Movilidad",
  almacenamiento: "Almacenamiento",
  otro:           "Otros",
}

export const IT_CHECKLIST_KIND_META: Record<string, string> = {
  onboarding:  "Alta",
  offboarding: "Baja",
}

/** Plantilla de checklist de alta: se instancia (copia el nombre) al crear. */
export const ONBOARDING_CHECKLIST_TEMPLATE = [
  "Crear correo corporativo",
  "Crear accesos correspondientes",
  "Entregar notebook",
  "Entregar teléfono",
  "Asignar licencias",
  "Configurar aplicaciones",
  "Entregar accesorios",
] as const

/** Plantilla de checklist de baja. */
export const OFFBOARDING_CHECKLIST_TEMPLATE = [
  "Bloquear correo corporativo",
  "Revocar accesos",
  "Quitar VPN",
  "Recuperar notebook",
  "Recuperar celular",
  "Recuperar accesorios",
  "Respaldar o transferir información",
  "Cerrar licencias asignadas",
] as const

/** Accesorios sugeridos al entregar un equipo (el usuario puede agregar otros). */
export const ACCESSORY_SUGGESTIONS = [
  "Cargador", "Mouse", "Bolso", "Dock", "Adaptador", "Teclado", "Cable HDMI",
] as const

export function itStatusLabel(status: string | null | undefined): string {
  if (!status) return "—"
  return IT_ASSET_STATUS_META[status]?.label ?? status
}

export function itTicketStatusLabel(status: string): string {
  return IT_TICKET_STATUS_META[status]?.label ?? status
}

/**
 * Estado final del activo según el motivo de baja: pérdida y robo conservan su
 * propio estado. Vive acá —vocabulario puro, sin dependencia de `@/db`— porque
 * la usan el servicio de bajas, la validación y los tests.
 */
export function retirementTargetStatus(reason: string): string {
  return reason === "perdida" ? "perdido" : reason === "robo" ? "robado" : "dado_de_baja"
}

/**
 * Estados terminales: fuera del "parque vigente" que muestra el inventario.
 *
 * Una sola definición a propósito. El triple estaba repetido literal en siete
 * lugares (inventario, dashboard, alertas, licencias, bajas, garantías y el
 * filtro de la página de activos) y ya había divergido: el tile "Garantías por
 * vencer" excluía las bajas y el listado al que enlaza, no.
 */
export const IT_RETIRED_STATUSES = ["dado_de_baja", "perdido", "robado"] as const

/** `true` si el estado saca al activo del parque vigente. */
export function isRetiredStatus(status: string): boolean {
  return (IT_RETIRED_STATUSES as readonly string[]).includes(status)
}

/**
 * Estado del activo al entregarlo, según el `kind` de la asignación. Antes de
 * esto, `createAssignment` fijaba siempre 'asignado' sin mirar `kind`: un
 * préstamo (`loan`) o una salida a reparación (`repair_exit`) quedaban
 * "asignados" en vez de reflejar su naturaleza, y `en_prestamo` era un estado
 * manual que nunca coexistía con una asignación abierta (por eso su rama en
 * `returnAssignment` era código inalcanzable).
 */
export function assignmentTargetStatus(kind: string): string {
  if (kind === "loan") return "en_prestamo"
  if (kind === "repair_exit") return "en_reparacion"
  return "asignado" // delivery, transfer
}

/**
 * Ingredientes para decidir si una baja se puede revertir. Todos calculables
 * con datos que `listRetirements`/`reverseRetirement` ya tienen en la fila (o
 * en un `EXISTS` correlacionado); el helper solo aplica la regla de negocio,
 * en un solo lugar, para que la comprobación de la UI (`canReverse`) y la
 * guarda final del servicio nunca diverjan.
 */
export interface RetirementReversalState {
  reason: string
  reversedAt: string | null
  previousStatus: string | null
  closedAssignmentId: string | null
  assetStatus: string
  assetDeletedAt: string | null
  /** Existe otra baja del mismo activo posterior a esta (por created_at). */
  hasLaterRetirement: boolean
  /**
   * Existe un evento posterior en la línea de tiempo del activo
   * (status_changed / assigned / returned) que pudo sobrescribir el efecto de
   * esta baja. Se excluyen a propósito 'retired'/'retirement_reversed': en
   * Postgres `now()` es el timestamp de TRANSACCIÓN, así que la entrada
   * 'retired' de esta misma baja comparte el mismo instante que su
   * `created_at` — no es "posterior", y `hasLaterRetirement` ya cubre las
   * bajas realmente posteriores.
   */
  hasLaterMovement: boolean
  /** El activo tiene una asignación abierta ahora mismo. */
  hasOpenAssignment: boolean
}

/**
 * `null` = la baja se puede revertir. Texto = el motivo exacto por el que no,
 * listo para mostrar al usuario y para lanzar como Error en el servicio.
 *
 * Una baja "vieja" cuyo efecto ya fue sobrescrito no es reversible: restaurar
 * su `previousStatus` pisaría el estado que fijó un evento posterior.
 */
export function retirementReverseBlocker(s: RetirementReversalState): string | null {
  if (s.reversedAt !== null) return "Esta baja ya fue revertida"
  if (s.assetDeletedAt !== null) return "El activo fue eliminado del inventario: restáuralo antes de revertir la baja"
  if (s.previousStatus === null) {
    return "Esta baja no registra el estado previo del activo (es anterior a esta función): usa el control manual de estado en la ficha"
  }
  const target = retirementTargetStatus(s.reason)
  if (s.assetStatus !== target) {
    return `El activo está en estado '${itStatusLabel(s.assetStatus)}' y no en el que dejó esta baja ('${itStatusLabel(target)}'): su efecto ya fue sobrescrito`
  }
  if (s.hasLaterRetirement) return "Existe una baja posterior para este activo: revierte primero la más reciente"
  if (s.hasLaterMovement) return "El activo registra movimientos posteriores a la baja (cambio de estado, entrega o devolución): la reversión ya no es unívoca"
  if (s.hasOpenAssignment) return "El activo tiene una asignación abierta: su custodia ya no la fija esta baja"
  return null
}
