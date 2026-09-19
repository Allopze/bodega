/**
 * lib/prevention/pdtp-readiness-links.ts
 *
 * A dónde mandar al operador para que resuelva lo que le falta a una actividad.
 *
 * Es puro y vive fuera del servicio de cobertura a propósito: meter rutas en la
 * capa de datos la acopla al routing y obliga a verificar strings de URL en
 * tests con base de datos. Acá se puede afirmar, sin Postgres, que cada enlace
 * apunta a una ruta real y que **cada parámetro es uno que el destino
 * efectivamente lee** — que es el modo de fallar que produjo el defecto
 * original: un enlace que llega a la pantalla correcta y no hace nada.
 *
 * Verificado contra los destinos el 2026-09-19:
 * - `/prevencion/inspecciones/plantillas` lee `q`, `tipo` y `estado`
 *   (`inspection-catalog.tsx`, `useUrlFilters`), y `q` matchea contra
 *   `` `${code} ${name} ${versionLabel}` ``.
 * - `/prevencion/emergencias` lee `tab` y `vista`
 *   (`lib/prevention/emergency-list-filters.ts`); `vista=draft` sólo es válido
 *   con `tab=plans`.
 * - `/prevencion/capacitacion` lee `faena` y `year`, y nada más
 *   (`training-occurrence-list.tsx`). El enlace de capacitación va pelado desde
 *   que el catálogo de cursos dejó de existir (2026-09-19): antes apuntaba a
 *   `/prevencion/capacitacion/catalogo?tab=versions&q=<código>`.
 * - `/prevencion/pdtp/aplicabilidad` **no lee ningún parámetro**. Se enlaza
 *   pelado: inventarle un `?actividad=` habría sido exactamente el bug que
 *   este archivo existe para impedir.
 */

import type { PdtpCoverageInstrument } from "@/lib/services/pdtp/instrument-gap"

export type PdtpReadinessLink = {
  href: string
  /** Verbo de la acción, en imperativo y con el objeto. */
  label: string
}

const encode = (value: string) => encodeURIComponent(value)

/** El catálogo de plantillas de inspección, filtrado a la que falta. */
export function inspectionTemplateLink(code: string): PdtpReadinessLink {
  return {
    href: `/prevencion/inspecciones/plantillas?estado=draft&q=${encode(code)}`,
    label: "Abrir la plantilla",
  }
}

/**
 * El control anual de capacitación.
 *
 * Va pelado, sin `q` ni `tab`: el destino sólo lee `faena` y `year`
 * (`training-occurrence-list.tsx`), y un parámetro que nadie lee es
 * exactamente el defecto que este archivo existe para impedir. Tampoco lleva
 * `year`: sin él la página resuelve el catálogo vigente por su cuenta, que es
 * el que corresponde al programa que se está habilitando.
 */
export function trainingCatalogItemLink(): PdtpReadinessLink {
  return {
    href: "/prevencion/capacitacion",
    label: "Abrir el control anual",
  }
}

/**
 * El plan de emergencia.
 *
 * Con `planId` se va al detalle, que es donde viven el botón de aprobar y la
 * lista de lo que le falta al plan para poder aprobarse. Sin plan, a la lista
 * en la pestaña de planes en preparación, que es donde se crea.
 *
 * **Nunca "Aprobar" como verbo.** `approveEmergencyPlan` falla si
 * `assessPlanReadiness` no pasa, y el botón del detalle ya viene deshabilitado
 * por eso. Prometer una aprobación que el destino va a rechazar es el fallo que
 * este rediseño corrige, no uno que pueda reintroducir.
 */
export function emergencyPlanLink(planId: string | null): PdtpReadinessLink {
  return planId
    ? { href: `/prevencion/emergencias/${encode(planId)}`, label: "Revisar el plan" }
    : { href: "/prevencion/emergencias?tab=plans&vista=draft", label: "Crear el plan" }
}

/** El editor del programa, en la sección de revisión, anclado a la actividad. */
export function programEditorLink(programId: string, n: number, seccion: "actividades" | "faenas" | "revision" = "revision"): PdtpReadinessLink {
  return {
    href: `/prevencion/pdtp/${encode(programId)}/editar?seccion=${seccion}#actividad-${n}`,
    label: "Abrir en el editor",
  }
}

/** La matriz de aplicabilidad, donde se declara el padrón por faena. */
export function applicabilityLink(): PdtpReadinessLink {
  return { href: "/prevencion/pdtp/aplicabilidad", label: "Declarar el padrón" }
}

export function rolesLink(): PdtpReadinessLink {
  return { href: "/admin/roles", label: "Administrar roles" }
}

/**
 * El enlace de un instrumento concreto.
 *
 * Para un ref de plan de emergencia con varias faenas devuelve el de la
 * primera que falta: es una conjunción —hay que resolverlas todas— y la fila
 * vuelve a aparecer con la siguiente hasta que no queda ninguna.
 */
export function instrumentLink(instrument: PdtpCoverageInstrument): PdtpReadinessLink {
  if (instrument.kind === "inspection_template") return inspectionTemplateLink(instrument.code)
  if (instrument.kind === "training_catalog_item") return trainingCatalogItemLink()
  return emergencyPlanLink(instrument.worksites[0]?.planId ?? null)
}
