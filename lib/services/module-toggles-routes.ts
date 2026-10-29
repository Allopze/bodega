/**
 * Inventario de rutas de `module-toggles.ts`: qué módulo y submódulo es dueño de
 * cada ruta que no aparece literalmente en la navegación, y a qué submódulo
 * deriva cada permiso. Son datos; la lógica de toggles vive en module-toggles.ts.
 */
export interface RouteOwnerRule {
  moduleId: string
  /** href canónico que administra el toggle de submódulo. */
  submoduleHref?: string
  prefix?: string
  pattern?: RegExp
}

/**
 * Rutas operativas que no aparecen literalmente en navegación. Mantener este
 * inventario junto a las regresiones de cobertura: el menú no es un mapa de
 * autorización y los endpoints/jobs tampoco deberían depender de él.
 */
export const ROUTE_OWNER_ALIASES: RouteOwnerRule[] = [
  // Administración no declara navegación en su manifest; toda su superficie
  // comparte un único toggle, salvo la puerta de recuperación exacta.
  { moduleId: "admin", submoduleHref: "/admin", prefix: "/admin" },

  // Evaluaciones SST: alta, detalle y ficha de trabajador son aliases del item.
  { moduleId: "sst", submoduleHref: "/prevencion/evaluaciones", prefix: "/prevencion/nueva" },
  { moduleId: "sst", submoduleHref: "/prevencion/evaluaciones", prefix: "/sst" },
  { moduleId: "sst", submoduleHref: "/prevencion/evaluaciones", prefix: "/prevencion/trabajador" },
  { moduleId: "sst", submoduleHref: "/prevencion/evaluaciones", pattern: /^\/prevencion\/[^/]+$/ },

  // Superficies públicas (PWA sin sesión) y APIs autenticadas/públicas.
  { moduleId: "ppa", submoduleHref: "/prevencion/ppa", prefix: "/ppa" },
  // INC-001: canal público de reporte de incidentes (sin sesión), gobernado
  // por el mismo toggle que el módulo de Incidentes que lo tría.
  { moduleId: "prevention", submoduleHref: "/prevencion/incidentes", prefix: "/reportar-incidente" },
  // CAP-002/PER-002: vía de acuse sin cuenta. Cada rama pertenece al submódulo
  // que emite el acuse, para que apagar Capacitación o Permisos también cierre
  // su enlace público y no queden puertas fuera del inventario.
  { moduleId: "prevention", submoduleHref: "/prevencion/capacitacion", prefix: "/acuse/capacitacion" },
  { moduleId: "prevention", submoduleHref: "/prevencion/permisos", prefix: "/acuse/permiso" },
  // Fallback del segmento dinámico `/acuse/[kind]/...`: cualquier rama que no
  // sea una de las dos anteriores pertenece igualmente a Prevención y nunca
  // debe quedar fuera del inventario.
  { moduleId: "prevention", prefix: "/acuse" },
  { moduleId: "combustibles", submoduleHref: "/combustibles/tae", prefix: "/tae" },
  { moduleId: "combustibles", submoduleHref: "/combustibles/tae", prefix: "/api/tae" },
  { moduleId: "combustibles", submoduleHref: "/combustibles/importar", prefix: "/api/combustibles/import" },
  { moduleId: "combustibles", submoduleHref: "/combustibles/control", prefix: "/api/combustibles/cargas" },
  { moduleId: "flota", submoduleHref: "/flota", prefix: "/api/flota" },
  { moduleId: "mantenciones", submoduleHref: "/mantenciones", prefix: "/api/mantenciones" },
  // Mantención de equipos: la app del mecánico (PWA) y sus APIs, incluidas las
  // de sincronización que autentican con credencial de dispositivo.
  // La app del mecánico no está en el menú (es una PWA aparte): su ruta, su login
  // y su sincronización cuelgan del mismo submódulo que los Registros.
  { moduleId: "mantencion_equipos", submoduleHref: "/mantencion/registros", prefix: "/m/mantencion" },
  { moduleId: "mantencion_equipos", submoduleHref: "/mantencion/registros", prefix: "/api/mantencion/sync" },
  { moduleId: "mantencion_equipos", submoduleHref: "/mantencion/registros", prefix: "/api/mantencion/dispositivo" },
  { moduleId: "mantencion_equipos", submoduleHref: "/mantencion/registros", prefix: "/api/mantencion" },
  { moduleId: "mantencion_equipos", submoduleHref: "/mantencion/equipos", prefix: "/mantencion/dispositivos" },
  // Fallback: la portada y cualquier rama futura bajo /mantencion. Los prefijos
  // de los ítems de navegación son más largos y ganan por orden.
  { moduleId: "mantencion_equipos", submoduleHref: "/mantencion/panel", prefix: "/mantencion" },
  { moduleId: "warehouse", submoduleHref: "/bodega", prefix: "/api/bodega" },
  { moduleId: "deliveries", submoduleHref: "/entregas", prefix: "/api/entregas" },
  // Módulo TI: fotos y adjuntos sirven evidencia de asignaciones/actas.
  { moduleId: "ti", submoduleHref: "/ti", prefix: "/api/ti" },
  { moduleId: "ti", submoduleHref: "/ti", prefix: "/api/cron/ti-alerts" },
  // Sirve exclusivamente evidencia de entregas (ver S-08 en el handler).
  { moduleId: "deliveries", submoduleHref: "/entregas", prefix: "/api/attachments" },
  // Las facturas tienen toggle propio. Debe ir antes del owner general de
  // Facturación para que apagar sólo Facturas también cierre su API directa.
  { moduleId: "billing", submoduleHref: "/facturacion/facturas", prefix: "/api/facturacion/facturas" },
  { moduleId: "billing", submoduleHref: "/facturacion", prefix: "/api/facturacion" },
  { moduleId: "purchasing", submoduleHref: "/compras", prefix: "/api/purchase-orders" },
  { moduleId: "reports", submoduleHref: "/reportes", prefix: "/api/reportes" },
  { moduleId: "warehouse", submoduleHref: "/seguimiento", prefix: "/api/bodega/trazabilidad" },
  { moduleId: "warehouse", submoduleHref: "/seguimiento", prefix: "/api/trazabilidad" },
  // Trazabilidad se mudó bajo Bodega y `/trazabilidad/*` quedó como
  // redirección; el 2026-10-05 pasó a Adquisiciones como `/seguimiento`
  // (auditoría UI/UX), y el dueño de estos prefijos es ahora ese ítem. Las páginas legadas siguen siendo superficie del módulo: sin
  // esto quedaban fuera del inventario y el toggle no las alcanzaba. El prefijo
  // de la API ya estaba; faltaba el de las páginas.
  { moduleId: "warehouse", submoduleHref: "/seguimiento", prefix: "/trazabilidad" },
  { moduleId: "feedback", submoduleHref: "/soporte", prefix: "/api/soporte" },
  { moduleId: "repuestos", prefix: "/api/repuestos" },
  { moduleId: "servicios", prefix: "/api/servicios" },
  { moduleId: "admin", submoduleHref: "/admin", prefix: "/api/admin" },
  { moduleId: "admin", submoduleHref: "/admin", prefix: "/api/backups" },
  { moduleId: "admin", submoduleHref: "/admin", prefix: "/api/dte-portal" },

  // Endpoints de Prevención: primero los owners específicos y al final el fallback.
  { moduleId: "ppa", submoduleHref: "/prevencion/ppa", prefix: "/api/prevencion/ppa" },
  { moduleId: "prevention", submoduleHref: "/prevencion/pdtp", prefix: "/api/prevencion/pdtp" },
  { moduleId: "prevention", submoduleHref: "/prevencion/capacitacion", prefix: "/api/prevencion/capacitacion" },
  { moduleId: "prevention", submoduleHref: "/prevencion/capa", prefix: "/api/prevencion/capa" },
  // Subida y descarga de la evidencia de campañas. Campañas no tiene item de
  // navegación propio —se controlan dentro de Capacitación—, así que el owner
  // es el mismo href al que ya resuelve el permiso `prevention:campaign:*`:
  // apagar ese submódulo tiene que cerrar el endpoint y el permiso a la vez.
  { moduleId: "prevention", submoduleHref: "/prevencion/capacitacion", prefix: "/api/prevencion/campanas" },
  // El mapa de riesgos se trasladó a CGRD (2026-09-22). El par href/prefijo viaja
  // junto con la ruta: si la API se quedaba bajo /api/prevencion/miper, apagar el
  // submódulo MIPER habría roto una pantalla del CGRD. El orden respecto de la
  // entrada de abajo no decide nada — el array se ordena por longitud de prefijo.
  { moduleId: "prevention", submoduleHref: "/prevencion/cgrd/mapa", prefix: "/api/prevencion/cgrd/mapa" },
  { moduleId: "prevention", submoduleHref: "/prevencion/cgrd", prefix: "/api/prevencion/cgrd" },
  // Subida y descarga del acta de un simulacro. Apagar Emergencias tiene que
  // cerrar el endpoint y el permiso a la vez: si no, la evidencia del módulo
  // apagado sigue siendo alcanzable por URL.
  { moduleId: "prevention", submoduleHref: "/prevencion/emergencias", prefix: "/api/prevencion/emergencias" },
  // Subida y descarga de la evidencia de las casillas de alcotest, por el mismo
  // motivo: apagar Alcotest tiene que cerrar el endpoint junto con el permiso.
  { moduleId: "prevention", submoduleHref: "/prevencion/alcotest", prefix: "/api/prevencion/alcotest" },
  { moduleId: "prevention", submoduleHref: "/prevencion/documentacion", prefix: "/api/prevencion/documentacion" },
  { moduleId: "prevention", submoduleHref: "/prevencion/documentacion", prefix: "/api/prevencion/archivos-sensibles" },
  { moduleId: "prevention", submoduleHref: "/prevencion/epp-preventivo", prefix: "/api/prevencion/epp" },
  { moduleId: "prevention", submoduleHref: "/prevencion/incidentes", prefix: "/api/prevencion/incidentes" },
  // Casos reservados es la superficie de Privacidad —igual que su override de
  // permiso—, no de Incidentes: apuntarlo a Incidentes hacía que el toggle de
  // ruta y el de permiso se contradijeran.
  { moduleId: "prevention", submoduleHref: "/prevencion/privacidad", prefix: "/api/prevencion/casos-reservados" },
  { moduleId: "prevention", submoduleHref: "/prevencion/indicadores-material-ambiental", prefix: "/api/prevencion/indicadores-material-ambiental" },
  { moduleId: "prevention", submoduleHref: "/prevencion/indicadores", prefix: "/api/prevencion/indicadores" },
  // Auditorías e inspecciones comparten estos endpoints. El owner exacto se
  // determina en el handler después de autenticar y cargar el kind real; el
  // proxy sólo aplica aquí el toggle del módulo Prevención.
  { moduleId: "prevention", prefix: "/api/prevencion/inspecciones" },
  { moduleId: "prevention", submoduleHref: "/prevencion/miper", prefix: "/api/prevencion/miper" },
  { moduleId: "prevention", submoduleHref: "/prevencion/permisos", prefix: "/api/prevencion/permisos" },
  { moduleId: "prevention", submoduleHref: "/prevencion/privacidad", prefix: "/api/prevencion/privacidad" },
  { moduleId: "prevention", submoduleHref: "/prevencion/requisitos-legales", prefix: "/api/prevencion/requisitos-legales" },
  { moduleId: "prevention", submoduleHref: "/prevencion/higiene", prefix: "/api/prevencion/salud" },
  // Subida del informe de laboratorio que respalda una medición de exposición.
  { moduleId: "prevention", submoduleHref: "/prevencion/higiene", prefix: "/api/prevencion/higiene" },

  // Automatizaciones: el secreto se valida en el handler antes de consultar el toggle.
  { moduleId: "admin", submoduleHref: "/admin", prefix: "/api/cron/backup-health" },
  { moduleId: "admin", submoduleHref: "/admin", prefix: "/api/cron/backup-report" },
  // Documentos generados → Cloudreve: se configura en Administración › Almacenamiento.
  { moduleId: "admin", submoduleHref: "/admin", prefix: "/api/cron/generated-documents-archive" },
  { moduleId: "billing", submoduleHref: "/facturacion/sincronizacion", prefix: "/api/cron/billing-sales-sync" },
  { moduleId: "billing", submoduleHref: "/facturacion/sincronizacion", prefix: "/api/cron/chipax-sync" },
  { moduleId: "admin", submoduleHref: "/admin", prefix: "/api/cron/dte-portal-sync" },
  { moduleId: "admin", submoduleHref: "/admin", prefix: "/api/cron/dte-sync-health" },
  { moduleId: "combustibles", submoduleHref: "/combustibles", prefix: "/api/cron/fuel-anomaly-detection" },
  { moduleId: "combustibles", submoduleHref: "/combustibles/importar", prefix: "/api/cron/fuel-copec-sync" },
  { moduleId: "combustibles", submoduleHref: "/combustibles/importar", prefix: "/api/cron/fuel-aramco-sync" },
  { moduleId: "combustibles", submoduleHref: "/combustibles", prefix: "/api/cron/fuel-statement-notifications" },
  { moduleId: "feedback", submoduleHref: "/soporte", prefix: "/api/cron/feedback-sla-reminders" },
  { moduleId: "flota", submoduleHref: "/flota/monitoreo", prefix: "/api/cron/fleet-onway-retention" },
  { moduleId: "flota", submoduleHref: "/flota/monitoreo", prefix: "/api/cron/fleet-onway-sync" },
  { moduleId: "mantenciones", submoduleHref: "/mantenciones", prefix: "/api/cron/maintenance-reminders" },
  // MNT-001: materializar el plan preventivo es del mismo módulo que su
  // recordatorio, y el prefijo más largo gana, así que no se pisan.
  { moduleId: "mantenciones", submoduleHref: "/mantenciones", prefix: "/api/cron/maintenance-plan-materialization" },
  { moduleId: "warehouse", submoduleHref: "/seguimiento", prefix: "/api/cron/operational-integrity-scan" },
  // TRZ-001: el segundo libro de integridad, el que cubre entregas contra
  // recepción en faena.
  { moduleId: "warehouse", submoduleHref: "/seguimiento", prefix: "/api/cron/traceability-integrity-scan" },
  /*
   * FLO-002, MIP-001 y PRI-001 comparten una corrida porque son el mismo
   * trabajo sobre tres tablas. Eso deja una ruta que no pertenece a un solo
   * módulo: se ancla en Prevención, que aporta dos de los tres barridos, y cada
   * barrido consulta sus propios permisos. Apagar Prevención silencia también
   * el aviso de documentos de flota — es la contrapartida de agruparlos, y se
   * anota aquí para que sea una decisión visible y no una sorpresa.
   */
  { moduleId: "prevention", submoduleHref: "/prevencion", prefix: "/api/cron/deadline-reminders" },
  { moduleId: "analytics", submoduleHref: "/analitica", prefix: "/api/cron/operational-metric-snapshots" },
  { moduleId: "analytics", submoduleHref: "/analitica", prefix: "/api/cron/operational-snapshot-health" },
  { moduleId: "prevention", submoduleHref: "/prevencion/pdtp", prefix: "/api/cron/pdtp-evidence-gc" },
  { moduleId: "prevention", submoduleHref: "/prevencion/pdtp", prefix: "/api/cron/pdtp-evidence-integrity" },
  { moduleId: "prevention", submoduleHref: "/prevencion/pdtp", prefix: "/api/cron/pdtp-weekly-reminders" },
  { moduleId: "prevention", submoduleHref: "/prevencion/pdtp", prefix: "/api/cron/pdtp-daily-reconcile" },
  { moduleId: "prevention", submoduleHref: "/prevencion", prefix: "/api/cron/prevention-cron-staleness" },
  { moduleId: "prevention", submoduleHref: "/prevencion/capa", prefix: "/api/cron/prevention-capa-reminders" },
  { moduleId: "prevention", submoduleHref: "/prevencion/cphs", prefix: "/api/cron/prevention-cphs-alerts" },
  { moduleId: "prevention", submoduleHref: "/prevencion/miper", prefix: "/api/cron/prevention-miper-daily-sweep" },
  { moduleId: "prevention", submoduleHref: "/prevencion/documentacion", prefix: "/api/cron/prevention-document-ack-reminders" },
  { moduleId: "prevention", submoduleHref: "/prevencion/incidentes", prefix: "/api/cron/prevention-incident-reminders" },
  { moduleId: "prevention", submoduleHref: "/prevencion/inspecciones", prefix: "/api/cron/prevention-inspection-programs" },
  { moduleId: "prevention", submoduleHref: "/prevencion/permisos", prefix: "/api/cron/prevention-permit-expiry" },
  { moduleId: "prevention", submoduleHref: "/prevencion/capacitacion", prefix: "/api/cron/prevention-training-reminders" },
  { moduleId: "sst", submoduleHref: "/prevencion/evaluaciones", prefix: "/api/cron/sst-weekly-alerts" },
]

export const PERMISSION_TARGET_OVERRIDES: Array<{ test: (permission: string) => boolean; href: string }> = [
  { test: (permission) => permission.startsWith("combustibles:tae_"), href: "/combustibles/tae" },
  { test: (permission) => permission === "combustibles:import" || permission === "combustibles:revert", href: "/combustibles/importar" },
  { test: (permission) => ["combustibles:register_load", "combustibles:approve_flagged", "combustibles:manage_control"].includes(permission), href: "/combustibles/control" },
  { test: (permission) => permission.startsWith("sst:"), href: "/prevencion/evaluaciones" },
  { test: (permission) => permission.startsWith("ppa:"), href: "/prevencion/ppa" },
  { test: (permission) => permission.startsWith("prevention:pdtp:"), href: "/prevencion/pdtp" },
  { test: (permission) => permission.startsWith("prevention:risk:"), href: "/prevencion/miper" },
  { test: (permission) => permission.startsWith("prevention:legal:"), href: "/prevencion/requisitos-legales" },
  { test: (permission) => permission.startsWith("prevention:training:"), href: "/prevencion/capacitacion" },
  { test: (permission) => permission.startsWith("prevention:capa:"), href: "/prevencion/capa" },
  { test: (permission) => permission.startsWith("prevention:incidents:"), href: "/prevencion/incidentes" },
  { test: (permission) => permission.startsWith("prevention:permits:"), href: "/prevencion/permisos" },
  { test: (permission) => permission.startsWith("prevention:cphs:"), href: "/prevencion/cphs" },
  { test: (permission) => permission.startsWith("prevention:hygiene:") || permission.startsWith("prevention:health:"), href: "/prevencion/higiene" },
  { test: (permission) => permission.startsWith("prevention:emergency:"), href: "/prevencion/emergencias" },
  { test: (permission) => permission.startsWith("prevention:epp:"), href: "/prevencion/epp-preventivo" },
  // Las campañas del programa anual se registran en el catálogo controlado;
  // el permiso legado conserva compatibilidad, pero ya no deriva al alta libre.
  { test: (permission) => permission.startsWith("prevention:campaign:"), href: "/prevencion/capacitacion" },
  { test: (permission) => permission.startsWith("prevention:engagement:"), href: "/prevencion/coordinacion" },
  { test: (permission) => permission.startsWith("prevention:docs:"), href: "/prevencion/documentacion" },
  { test: (permission) => permission.startsWith("prevention:indicadores:"), href: "/prevencion/indicadores" },
  { test: (permission) => permission.startsWith("prevention:privacy:") || permission.startsWith("prevention:reserved_case:"), href: "/prevencion/privacidad" },
]
