/**
 * lib/services/pdtp-adapters/fulfillment-contract-2026.ts
 *
 * Dónde se cumple cada actividad de `enganche` o `compuesta` del programa
 * 2026, y con qué permiso.
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
   * Permiso del acto que acredita. `null` cuando el flujo tiene más de un
   * permiso segregado y no puede representarse con uno solo.
   */
  permission: string | null
  /** Ruta a la que mandar a quien tiene la actividad pendiente. */
  href: (worksiteId: string, programId?: string) => string | null
  /**
   * El responsable declarado no puede tener ese permiso por segregación de
   * deberes. Lleva el motivo escrito: sin él, la exención se lee como un parche.
   */
  segregated?: string
}

/* Todas las actividades de inspección acreditan al declarar el run ejecutado.
 * El parámetro que permitía pedir `review` se retiró junto con la N°26 y la
 * N°28: ninguna plantilla declara `pdtpReviewActivityNumbers`, así que el
 * mecanismo existe en el motor pero hoy no lo usa ninguna actividad, y dejar el
 * parámetro sugería lo contrario. */
const inspecciones = (): EngancheDestination => ({
  module: "inspecciones",
  permission: "prevention:inspections:execute",
  href: (worksiteId) => `/prevencion/inspecciones?faena=${worksiteId}`,
})

/* Un único permiso desde el 2026-09-19: `deliver` —registrar asistencia,
 * evaluación y cierre de una sesión— se retiró con el modelo por persona, y lo
 * que queda es marcar la actividad como hecha. El parámetro desapareció en vez
 * de quedar con un default: dos valores posibles donde sólo hay uno invitan a
 * pasar el que ya no existe. */
const capacitacion = (): EngancheDestination => ({
  module: "capacitacion",
  permission: "prevention:training:record",
  href: (worksiteId) => `/prevencion/capacitacion?faena=${worksiteId}`,
})

const campanas = (): EngancheDestination => ({
  module: "campanas",
  permission: "prevention:campaign:manage",
  href: (worksiteId) => `/prevencion/campanas?faena=${worksiteId}`,
})

const incidentes = (): EngancheDestination => ({
  module: "incidentes",
  permission: "prevention:incidents:investigate",
  href: (worksiteId) => `/prevencion/incidentes?faena=${worksiteId}`,
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

export const PDTP_2026_ENGANCHE_DESTINATIONS: Readonly<Record<number, EngancheDestination>> = {
  // ── Gobernanza del propio programa ──────────────────────────────────────
  1: {
    module: "pdtp",
    permission: null,
    href: (_worksiteId, programId) => programId
      ? `/prevencion/pdtp/${encodeURIComponent(programId)}?faena=${encodeURIComponent(_worksiteId)}`
      : null,
    segregated: "La aprobación tiene pasos y permisos distintos para Jefatura de Prevención y Legal/RRHH.",
  },
  11: {
    module: "faenas",
    permission: "prevention:cphs:manage",
    // La ficha resuelve por dotación si corresponde constituir CPHS, designar
    // delegado o si no existe órgano exigible. CPHS solo cubre la primera rama.
    href: (worksiteId) => `/prevencion/faenas/${encodeURIComponent(worksiteId)}`,
  },

  /* La cierra `closeManagementReview` en CPHS, que exige
   * `prevention:governance:review`. Estuvo declarada `sinDestino` —"gobernanza,
   * sin permiso propio"— y esa exención hacía dos cosas malas: mandaba a su
   * responsable a la planilla del PDTP en vez de a la reunión, y eximía a la
   * actividad de la verificación de permiso que sí le correspondía. Ninguno de
   * sus tres responsables tenía el permiso y la compuerta no lo reportaba. */
  9: {
    module: "cphs",
    permission: "prevention:governance:review",
    href: (worksiteId) => `/prevencion/cphs?faena=${worksiteId}`,
  },

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
  /* La N°26 es la revisión y firma del report de uso diario, y aun así exige
   * `execute` y no `review`: la plantilla `reporte_equipos` declara `[25, 26]`
   * en `pdtpActivityNumbers` —no en `pdtpReviewActivityNumbers`, que está vacío
   * en las 25 plantillas— porque el operador llena el reporte en papel y quien
   * lo transcribe línea por línea ES quien lo revisa y lo firma (decisión de
   * Prevención del 2026-08-23, en `lib/prevention/inspection-wiring.ts`).
   * Declararla como `review` describía un segundo paso que el instrumento no
   * tiene, y la marca `segregated` que lo acompañaba eximía a la actividad de
   * la verificación que sí correspondía hacerle.
   *
   * La N°28 no está en este mapa a propósito: `inspection-wiring.ts` la deja
   * fuera del catálogo —es un acto semanal sobre el conjunto de inspecciones
   * recibidas, no sobre una— y su mecanismo es `constancia`, así que
   * `resolvePdtpFulfillmentTarget` nunca llega a consultarla. */
  26: inspecciones(),

  // ── Capacitación ────────────────────────────────────────────────────────
  16: capacitacion(), 37: capacitacion(), 38: capacitacion(), 51: capacitacion(),
  53: capacitacion(), 57: capacitacion(), 59: capacitacion(), 60: capacitacion(),
  // Actividades acreditadas por el registro simplificado de ocurrencias.
  54: capacitacion(),
  55: capacitacion(),
  56: capacitacion(),
  58: capacitacion(),
  63: capacitacion(),

  // ── Habilitación del trabajador ─────────────────────────────────────────
  15: { module: "sst", permission: "sst:close", href: (w) => `/prevencion/nueva?faena=${w}` },
  17: { module: "sst", permission: "sst:close", href: (w) => `/prevencion/nueva?faena=${w}` },
  18: { module: "sst", permission: "sst:close", href: (w) => `/prevencion/nueva?faena=${w}` },
  23: { module: "sst", permission: "sst:close", href: (w) => `/prevencion/nueva?faena=${w}` },
  52: { module: "sst", permission: "sst:close", href: (w) => `/prevencion/nueva?faena=${w}` },
  /* La N°19 —mantener la carpeta del trabajador— se acredita con el acta y no
   * en Documentación: `STARTER_FOLDER_ACTIVITY_NUMBER = 19` en
   * `worker-onboarding-connector.ts`, que documenta que "cierra junto con" la
   * N°15, la N°18 y la N°23 porque es el mismo hecho, archivado. Apuntarla a
   * `docs:publish` mandaba a su responsable a un módulo donde no pasa nada. */
  19: { module: "sst", permission: "sst:close", href: (w) => `/prevencion/nueva?faena=${w}` },

  // ── Documentación SST ───────────────────────────────────────────────────
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
    // `/prevencion/miper`, no `/prevencion/riesgos`: la segunda no existe. Nadie
    // lo notó porque la cola de pendientes mandaba todo a la planilla y este
    // href no se usaba.
    href: (w) => `/prevencion/miper?faena=${w}`,
    segregated: "Publicar una revisión de la matriz exige firma distinta de quien la editó (segregación del módulo MIPER).",
  },

  // ── Alcotest ────────────────────────────────────────────────────────────
  30: alcotest(), 31: alcotest(),
  32: { ...alcotest(), permission: "prevention:alcotest:dispatch" },

  // ── Higiene y vigilancia ────────────────────────────────────────────────
  45: { ...higiene(), permission: "prevention:hygiene:measure" },
  46: higiene(), 47: higiene(), 48: higiene(), 49: higiene(), 50: higiene(),

  // ── EPP ─────────────────────────────────────────────────────────────────
  // El módulo es `epp-preventivo`; `/prevencion/epp` era un 404.
  62: { module: "epp", permission: "prevention:epp:manage", href: (w) => `/prevencion/epp-preventivo?faena=${w}` },

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
  // La n=71 y la n=75 son difusiones: las cierra `confirmIncidentDiffusion`,
  // que tiene permiso propio desde que se separó de cerrar el incidente.
  71: { ...incidentes(), permission: "prevention:incidents:diffuse" },
  72: { ...incidentes(), permission: "prevention:incidents:notify" },
  73: incidentes(), 74: incidentes(),
  75: { ...incidentes(), permission: "prevention:incidents:diffuse" },
  76: incidentes(), 78: incidentes(),
  // La n=77 sí acredita al CERRAR el caso (`onIncidentClosed`), y cerrar tiene
  // sus propias compuertas y es un acto de jefatura. El prevencionista de faena
  // arma y archiva el expediente; la firma que lo da por cerrado es de otro.
  77: {
    ...incidentes(),
    permission: "prevention:incidents:close",
    segregated: "Archivar el expediente es del prevencionista de faena; cerrar el incidente es de jefatura, verifica cinco compuertas y exige firma distinta de quien completó la investigación.",
  },

  // ── CGRD del DS 44 ──────────────────────────────────────────────────────
  79: { module: "cgrd", permission: "prevention:cgrd:committee:manage", href: (w) => `/prevencion/cgrd?faena=${w}` },
  80: {
    module: "cgrd",
    permission: "prevention:cgrd:matrix:publish",
    href: (w) => `/prevencion/cgrd?faena=${w}`,
    /* Simplificación 2026-09-14: `publishGrdMatrix` es un solo acto —sin
     * revisión ni aprobación intermedias—, pero sigue sin ser de quien edita.
     * El reparto del manifiesto le da `matrix:edit` al PRF y `matrix:publish`
     * a jefatura/administrador: la segregación queda en el permiso, no en una
     * comparación de usuarios dentro del servicio. */
    segregated: "Quien crea la versión de la matriz GRD y agrega sus amenazas (PRF) no tiene el permiso para publicarla: la publicación es de jefatura o administrador.",
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

  // ── Campañas incluidas en el catálogo anual ────────────────────────────
  85: capacitacion(),
  86: capacitacion(),
  87: capacitacion(),
  // La N°88 sigue siendo una campaña histórica compatible; el catálogo anual
  // nuevo usa la N°89 para puntos ciegos, por lo que no se debe ocultar este
  // destino mientras existan campañas antiguas con este número.
  88: campanas(),
  89: capacitacion(),
}

export function engancheDestinationFor(n: number): EngancheDestination | null {
  return PDTP_2026_ENGANCHE_DESTINATIONS[n] ?? null
}
