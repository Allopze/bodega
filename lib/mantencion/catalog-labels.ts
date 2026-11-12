import type { MantCatalogKey } from "@/lib/services/mantencion/catalogs"

/**
 * Rótulos de los catálogos cerrados del módulo, en lenguaje de usuario. Es un
 * módulo puro (sólo importa un tipo) para que lo usen tanto el servidor como los
 * componentes de cliente de «Catálogos».
 */
export interface CatalogLabels {
  /** Pestaña: «Marcas». */
  tab: string
  /** «marca» (en minúsculas, para frases: «Ya existe una marca…»). */
  singular: string
  /** «marcas». */
  plural: string
  /** Género gramatical: «una marca» / «un taller». */
  feminine: boolean
  /** Botón de alta: «Nueva marca». */
  create: string
  /** Para qué sirve, en una frase (descripción bajo las pestañas). */
  purpose: string
  /** Qué conserva lo que ya usa la entrada al desactivarla (texto del aviso de confirmación). */
  keeps: string
  /** Estado vacío: qué significa y qué hacer. */
  emptyTitle: string
  emptyDescription: string
  /** Rótulo del campo de nombre y su ejemplo. */
  nameLabel: string
  namePlaceholder: string
}

export const CATALOG_LABELS: Record<MantCatalogKey, CatalogLabels> = {
  brands: {
    keeps: "Los equipos y las reglas de pauta que ya la usan la conservan",
    tab: "Marcas", singular: "marca", plural: "marcas", feminine: true, create: "Nueva marca",
    purpose: "Marcas de los equipos. Las reglas de las pautas se definen por marca, así que un equipo sólo puede crearse con una marca de esta lista.",
    emptyTitle: "Todavía no hay marcas",
    emptyDescription: "Sin marcas no se pueden crear equipos. Agrega la primera con «Nueva marca».",
    nameLabel: "Nombre de la marca", namePlaceholder: "Ej: Toyota",
  },
  workshops: {
    keeps: "Los registros y las OT que ya la usan la conservan",
    tab: "Talleres", singular: "taller", plural: "talleres", feminine: false, create: "Nuevo taller",
    purpose: "Talleres externos que pueden ejecutar una mantención correctiva.",
    emptyTitle: "Todavía no hay talleres",
    emptyDescription: "Los talleres que agregues se ofrecen al registrar una correctiva ejecutada fuera de la faena. Agrega el primero con «Nuevo taller».",
    nameLabel: "Nombre del taller", namePlaceholder: "Ej: Taller Mecánico Los Aromos",
  },
  drivers: {
    keeps: "Los registros y las OT que ya lo usan lo conservan",
    tab: "Conductores", singular: "conductor", plural: "conductores", feminine: false, create: "Nuevo conductor",
    purpose: "Conductores que el mecánico declara en una correctiva (los de las últimas 24 horas).",
    emptyTitle: "Todavía no hay conductores",
    emptyDescription: "El mecánico los elige de esta lista al registrar una correctiva. Agrega el primero con «Nuevo conductor».",
    nameLabel: "Nombre del conductor", namePlaceholder: "Ej: Pérez Soto Juan",
  },
  workTypes: {
    keeps: "Los trabajos ya registrados lo conservan",
    tab: "Tipos de trabajo", singular: "tipo de trabajo", plural: "tipos de trabajo", feminine: false, create: "Nuevo tipo de trabajo",
    purpose: "Tipos de trabajo de una correctiva (Mecánico, Soldadura…). Cada trabajo registrado lleva uno.",
    emptyTitle: "Todavía no hay tipos de trabajo",
    emptyDescription: "Sin tipos de trabajo no se pueden registrar correctivas. Agrega el primero con «Nuevo tipo de trabajo».",
    nameLabel: "Nombre del tipo de trabajo", namePlaceholder: "Ej: Soldadura",
  },
  oils: {
    keeps: "Los registros ya hechos lo conservan",
    tab: "Aceites", singular: "aceite", plural: "aceites", feminine: false, create: "Nuevo aceite",
    purpose: "Aceites que se pueden declarar como cambiados en una correctiva.",
    emptyTitle: "Todavía no hay aceites",
    emptyDescription: "El mecánico los elige de esta lista al declarar un cambio de aceite. Agrega el primero con «Nuevo aceite».",
    nameLabel: "Nombre del aceite", namePlaceholder: "Ej: 15W-40",
  },
}

/** Largo permitido del nombre de una entrada de catálogo (el mismo criterio que el nombre de una pauta). */
export const CATALOG_NAME_MIN = 2
export const CATALOG_NAME_MAX = 80

/** Valor de `?catalogo=` de cada pestaña. Marcas es la de partida y no lleva parámetro. */
export const CATALOG_SLUGS: Record<MantCatalogKey, string> = {
  brands: "", workshops: "talleres", drivers: "conductores", workTypes: "tipos-de-trabajo", oils: "aceites",
}

export const CATALOG_ORDER: readonly MantCatalogKey[] = ["brands", "workshops", "drivers", "workTypes", "oils"]

/** Catálogo que pide la URL; cualquier valor desconocido cae en Marcas. */
export function catalogFromSlug(slug: string | undefined): MantCatalogKey {
  return CATALOG_ORDER.find((key) => CATALOG_SLUGS[key] !== "" && CATALOG_SLUGS[key] === slug) ?? "brands"
}
