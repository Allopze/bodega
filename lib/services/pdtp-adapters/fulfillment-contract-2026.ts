/**
 * lib/services/pdtp-adapters/fulfillment-contract-2026.ts
 *
 * Dónde se cumple cada actividad de `enganche` del programa 2026, y con qué
 * permiso.
 *
 * Es el archivo que `destinationPermissionFor` viene prometiendo desde que la
 * compuerta se escribió: sin él no se podía verificar el permiso de destino de
 * una actividad de enganche —una cierra en Inspecciones, otra en Capacitación,
 * otra en EPP— y la compuerta prefería no afirmar nada antes que verificar
 * contra el módulo equivocado.
 *
 * **La regla de oro: el permiso es el del acto que dispara el conector, no el
 * de entrar al módulo.** La N°7 no se acredita al mirar los indicadores sino al
 * cerrar el período (`prevention:indicadores:close`); la N°62 no al ver el EPP
 * sino al registrar la entrega. Confundirlos convierte la verificación en un
 * sello de goma.
 *
 * **`segregated: true` no es una excepción cómoda: es la norma.** Hay
 * actividades cuyo responsable declarado NO puede —ni debe— tener el permiso
 * que las acredita, porque el propio servicio impone segregación de deberes. La
 * N°83 la ejecuta el prevencionista de faena y la aprueba otra persona:
 * `approveEmergencyPlan` rechaza que coincidan. Exigirle al responsable el
 * permiso de aprobar contradiría esa regla, así que esas actividades se marcan
 * y se explican, no se fuerzan.
 */

export interface EngancheDestination {
  /** Módulo donde se registra el cumplimiento. */
  module: string
  /**
   * Permiso del acto que acredita. `null` cuando la actividad no tiene módulo
   * de destino: se cumple en el propio PDTP o es un acto de gobernanza.
   */
  permission: string | null
  /** Ruta a la que mandar a quien tiene la actividad pendiente. */
  href: (worksiteId: string) => string
  /**
   * El responsable declarado no puede tener ese permiso por segregación de
   * deberes. Lleva el motivo escrito: sin él, la exención se lee como un parche.
   */
  segregated?: string
}

const inspecciones = (permission: string | null = "prevention:inspections:execute"): EngancheDestination => ({
  module: "inspecciones",
  permission,
  href: (worksiteId) => `/prevencion/inspecciones?faena=${worksiteId}`,
})

const capacitacion = (): EngancheDestination => ({
  module: "capacitacion",
  permission: "prevention:training:deliver",
  href: (worksiteId) => `/prevencion/capacitacion?faena=${worksiteId}`,
})

const incidentes = (): EngancheDestination => ({
  module: "incidentes",
  permission: "prevention:incidents:investigate",
  href: (worksiteId) => `/prevencion/incidentes?faena=${worksiteId}`,
})

const campanas = (): EngancheDestination => ({
  module: "campanas",
  permission: "prevention:campaign:manage",
  href: (worksiteId) => `/prevencion/campanas?faena=${worksiteId}`,
})

const higiene = (): EngancheDestination => ({
  module: "higiene",
  permission: "prevention:hygiene:assess",
  href: (worksiteId) => `/prevencion/higiene?faena=${worksiteId}`,
})

const alcotest = (): EngancheDestination => ({
  module: "alcotest",
  permission: "prevention:alcotest:register",
  href: (worksiteId) => `/prevencion/alcotest?faena=${worksiteId}`,
})

/** Sin módulo de destino: se cumple dentro del propio PDTP o es gobernanza. */
const sinDestino = (reason: string): EngancheDestination => ({
  module: "pdtp",
  permission: null,
  href: (worksiteId) => `/prevencion/pdtp/actividades?faena=${worksiteId}&vista=semana`,
  segregated: reason,
})

export const PDTP_2026_ENGANCHE_DESTINATIONS: Readonly<Record<number, EngancheDestination>> = {
  // ── Gobernanza del propio programa ──────────────────────────────────────
  1: sinDestino("Aprobar el programa es un acto del propio PDTP, con su flujo de firmas."),
  9: sinDestino("La revisión por la dirección la cierra el CPHS; su acta no tiene permiso de destino propio."),
  11: sinDestino("Constituir el comité y designar al delegado son actos de gobernanza del CPHS."),

  // ── Indicadores ─────────────────────────────────────────────────────────
  7: {
    module: "indicadores",
    permission: "prevention:indicadores:close",
    href: (worksiteId) => `/prevencion/indicadores?faena=${worksiteId}`,
  },

  // ── Inspecciones y observaciones ────────────────────────────────────────
  10: inspecciones(), 24: inspecciones(), 25: inspecciones(), 27: inspecciones(),
  29: inspecciones(), 33: inspecciones(), 34: inspecciones(), 39: inspecciones(),
  40: inspecciones(), 41: inspecciones(), 64: inspecciones(), 65: inspecciones(),
  26: {
    ...inspecciones("prevention:inspections:review"),
    segregated: "Es la revisión y firma del report que otra persona ejecutó: exige `review`, no `execute`.",
  },
  28: inspecciones("prevention:inspections:review"),

  // ── Capacitación ────────────────────────────────────────────────────────
  16: capacitacion(), 37: capacitacion(), 38: capacitacion(), 51: capacitacion(),
  53: capacitacion(), 54: capacitacion(), 55: capacitacion(), 56: capacitacion(),
  57: capacitacion(), 58: capacitacion(), 59: capacitacion(), 60: capacitacion(),
  63: capacitacion(),

  // ── Habilitación del trabajador ─────────────────────────────────────────
  15: { module: "sst", permission: "sst:close", href: (w) => `/prevencion/nueva?faena=${w}` },
  17: { module: "sst", permission: "sst:close", href: (w) => `/prevencion/nueva?faena=${w}` },
  18: { module: "sst", permission: "sst:close", href: (w) => `/prevencion/nueva?faena=${w}` },
  23: { module: "sst", permission: "sst:close", href: (w) => `/prevencion/nueva?faena=${w}` },
  52: { module: "sst", permission: "sst:close", href: (w) => `/prevencion/nueva?faena=${w}` },

  // ── Documentación SST ───────────────────────────────────────────────────
  19: {
    module: "documentacion",
    permission: "prevention:docs:publish",
    href: (w) => `/prevencion/documentacion?faena=${w}`,
    segregated: "La carpeta del trabajador se completa con el acta; publicar el expediente es otro acto y otro rol.",
  },
  43: {
    module: "documentacion",
    permission: "prevention:docs:publish",
    href: (w) => `/prevencion/documentacion?faena=${w}`,
    segregated: "Quien redacta el procedimiento no lo publica: el flujo documental separa autoría de publicación.",
  },
  36: {
    module: "documentacion",
    permission: "prevention:docs:distribute",
    href: (w) => `/prevencion/documentacion?faena=${w}`,
  },

  // ── MIPER ───────────────────────────────────────────────────────────────
  35: {
    module: "riesgos",
    permission: "prevention:risk:publish",
    href: (w) => `/prevencion/riesgos?faena=${w}`,
    segregated: "Publicar una revisión de la matriz exige firma distinta de quien la editó (segregación del módulo MIPER).",
  },

  // ── Alcotest ────────────────────────────────────────────────────────────
  30: alcotest(), 31: alcotest(),
  32: { ...alcotest(), permission: "prevention:alcotest:dispatch" },

  // ── Higiene y vigilancia ────────────────────────────────────────────────
  45: { ...higiene(), permission: "prevention:hygiene:measure" },
  46: higiene(), 47: higiene(), 48: higiene(), 49: higiene(), 50: higiene(),

  // ── EPP ─────────────────────────────────────────────────────────────────
  62: { module: "epp", permission: "prevention:epp:manage", href: (w) => `/prevencion/epp?faena=${w}` },

  // ── Incidentes (RE-20) ──────────────────────────────────────────────────
  //
  // Los trece pasos NO comparten permiso, y suponerlo produce un informe falso.
  // Cada número lleva el del acto que dispara su conector, verificado en
  // `prevention-incidents.ts`: avisar exige `report`, la DIAT exige `notify`,
  // las difusiones pasan por `confirmIncidentDiffusion` que exige `close`, y el
  // resto entra por `getInvestigableIncident`, que exige `investigate`.
  66: { ...incidentes(), permission: "prevention:incidents:report" },
  67: { ...incidentes(), permission: "prevention:incidents:report" },
  68: incidentes(), 69: incidentes(), 70: incidentes(),
  71: { ...incidentes(), permission: "prevention:incidents:close" },
  72: { ...incidentes(), permission: "prevention:incidents:notify" },
  73: incidentes(), 74: incidentes(),
  75: { ...incidentes(), permission: "prevention:incidents:close" },
  76: incidentes(), 78: incidentes(),
  77: { ...incidentes(), permission: "prevention:incidents:close" },

  // ── CGRD del DS 44 ──────────────────────────────────────────────────────
  79: { module: "cgrd", permission: "prevention:cgrd:committee:manage", href: (w) => `/prevencion/cgrd?faena=${w}` },
  80: {
    module: "cgrd",
    permission: "prevention:cgrd:matrix:publish",
    href: (w) => `/prevencion/cgrd?faena=${w}`,
    segregated: "La matriz GRD tiene firmas segregadas: editar, revisar, aprobar y publicar son cuatro permisos y cuatro personas.",
  },
  81: { module: "cgrd", permission: "prevention:cgrd:meeting:manage", href: (w) => `/prevencion/cgrd?faena=${w}` },

  // ── Emergencias ─────────────────────────────────────────────────────────
  83: {
    module: "emergencias",
    permission: "prevention:emergency:approve",
    href: (w) => `/prevencion/emergencias?faena=${w}`,
    segregated: "`approveEmergencyPlan` rechaza que quien aprueba sea quien creó el plan. El responsable declarado lo redacta; la firma es de otro.",
  },
  84: {
    module: "emergencias",
    permission: "prevention:emergency:drill_execute",
    href: (w) => `/prevencion/emergencias?faena=${w}`,
  },

  // ── Campañas ────────────────────────────────────────────────────────────
  85: campanas(), 86: campanas(), 87: campanas(), 88: campanas(), 89: campanas(),
}

export function engancheDestinationFor(n: number): EngancheDestination | null {
  return PDTP_2026_ENGANCHE_DESTINATIONS[n] ?? null
}
