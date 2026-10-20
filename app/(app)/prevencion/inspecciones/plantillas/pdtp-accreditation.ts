import {
  resolvePdtpNumbersToCatalogIds,
  type PdtpActivityIdentityMap,
} from "@/lib/services/prevention-inspections/pdtp-identity"

/*
 * Qué acredita una plantilla en el programa anual, tal como lo lee y lo edita la
 * pantalla.
 *
 * La acreditación tiene dos fuentes: las identidades del catálogo corporativo
 * (`pdtp_accreditation_bindings`) y, de respaldo, los números de actividad que
 * la plantilla trae desde antes. Los vínculos ganan sobre los números, eje por
 * eje (`resolvePdtpAccreditationTarget`). La tabla leía los números y el diálogo
 * los vínculos, así que podían decir cosas distintas; acá se resuelve una sola
 * vez, con la misma regla del servidor, y la pantalla sólo la muestra.
 */

export type PdtpAccreditationSource = "catalog" | "numbers" | "none"

export type TemplatePdtpAccreditation = {
  pdtpAccreditation: {
    /** De dónde sale lo que se muestra: vínculos, números históricos o nada. */
    source: PdtpAccreditationSource
    /** Lo mismo, eje por eje: un eje puede estar vinculado y el otro seguir por número. */
    executeSource: PdtpAccreditationSource
    reviewSource: PdtpAccreditationSource
    /** Etiquetas listas para mostrar: «N° 29 — Inspección de contenedores». */
    execute: string[]
    review: string[]
  }
  /** Identidades con que se precarga el diálogo, por eje. */
  pdtpPreloadExecuteIds: string[]
  pdtpPreloadReviewIds: string[]
  /** Números que acreditan hoy pero no tienen actividad en el catálogo corporativo. */
  pdtpUnmappedNumbers: { execute: number[]; review: number[] }
}

type AxisInput = {
  /** Números históricos de la plantilla en este eje. */
  numbers: readonly number[] | null
  /** Identidades de catálogo vinculadas y vigentes en este eje. */
  bindingIds: readonly string[]
}

type AxisResult = {
  labels: string[]
  preloadIds: string[]
  unmapped: number[]
  fromNumbers: boolean
}

function buildAxis(axis: AxisInput, lookups: {
  identities: PdtpActivityIdentityMap
  nameByNumber: ReadonlyMap<number, string>
  catalogTitleById: ReadonlyMap<string, string>
}): AxisResult {
  const { identities, nameByNumber, catalogTitleById } = lookups

  // Un vínculo gana sobre los números aunque los números existan.
  if (axis.bindingIds.length > 0) {
    return {
      labels: axis.bindingIds.map((id) => {
        const identity = identities.byCatalogId.get(id)
        return identity ? `N° ${identity.n} — ${identity.name}` : catalogTitleById.get(id) ?? "Actividad del catálogo"
      }),
      preloadIds: [...axis.bindingIds],
      unmapped: [],
      fromNumbers: false,
    }
  }

  const numbers = [...(axis.numbers ?? [])]
  if (numbers.length === 0) return { labels: [], preloadIds: [], unmapped: [], fromNumbers: false }

  const { catalogActivityIds, unmappedNumbers } = resolvePdtpNumbersToCatalogIds(numbers, identities)
  return {
    labels: numbers.map((n) => {
      const name = identities.byNumber.get(n)?.name ?? nameByNumber.get(n)
      return name ? `N° ${n} — ${name}` : `N° ${n}`
    }),
    preloadIds: catalogActivityIds,
    unmapped: unmappedNumbers,
    fromNumbers: true,
  }
}

export function buildTemplatePdtpAccreditation(input: {
  numbers: { execute: readonly number[] | null; review: readonly number[] | null }
  bindingIds: { execute: readonly string[]; review: readonly string[] }
  identities: PdtpActivityIdentityMap
  /** Nombre de cada actividad del programa vigente, para los números sin identidad. */
  nameByNumber: ReadonlyMap<number, string>
  /** Título de cada actividad del catálogo corporativo. */
  catalogTitleById: ReadonlyMap<string, string>
}): TemplatePdtpAccreditation {
  const lookups = {
    identities: input.identities,
    nameByNumber: input.nameByNumber,
    catalogTitleById: input.catalogTitleById,
  }
  const execute = buildAxis({ numbers: input.numbers.execute, bindingIds: input.bindingIds.execute }, lookups)
  const review = buildAxis({ numbers: input.numbers.review, bindingIds: input.bindingIds.review }, lookups)

  const axisSource = (axis: AxisResult): PdtpAccreditationSource =>
    axis.labels.length === 0 ? "none" : axis.fromNumbers ? "numbers" : "catalog"
  const executeSource = axisSource(execute)
  const reviewSource = axisSource(review)
  // Basta un eje por número para que la plantilla siga dependiendo de ellos.
  const source: PdtpAccreditationSource = executeSource === "numbers" || reviewSource === "numbers"
    ? "numbers"
    : executeSource === "catalog" || reviewSource === "catalog" ? "catalog" : "none"

  return {
    pdtpAccreditation: { source, executeSource, reviewSource, execute: execute.labels, review: review.labels },
    pdtpPreloadExecuteIds: execute.preloadIds,
    pdtpPreloadReviewIds: review.preloadIds,
    pdtpUnmappedNumbers: { execute: execute.unmapped, review: review.unmapped },
  }
}
