/* ── Vocabulario de estados y categorías del módulo TI ──────────────────────
 * Mismo patrón que components/states/state-badge.tsx: los estados crudos de la
 * BD se mapean acá a label en español + variante de badge. El timeline
 * (it_asset_history) guarda el valor crudo; la UI nunca lo pinta directo. */

export type TiBadgeVariant = "default" | "primary" | "success" | "warning" | "signal" | "info" | "danger" | "neutral"

interface TiLabelMeta {
  label: string
  variant: TiBadgeVariant
}

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

export const IT_TICKET_PRIORITY_META: Record<string, { label: string; variant: TiBadgeVariant }> = {
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
