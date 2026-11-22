/**
 * lib/apps/field-apps.ts — Las apps que se instalan en el teléfono (vista TI › Apps).
 *
 * Son las tres con manifest y service worker propios. El formulario offline del
 * RE-20 tiene service worker pero no se instala, así que no está. Puro y apto
 * para el cliente: el aviso de cada app (`lib/pwa/heartbeat.ts`) usa el tipo.
 */
export type FieldAppId = "ppa" | "mantencion" | "tae"

export const FIELD_APP_IDS: readonly FieldAppId[] = ["ppa", "mantencion", "tae"]

export interface FieldAppDef {
  id:          FieldAppId
  /** `short_name` de su manifest. */
  label:       string
  description: string
  /** Por dónde se entra a la app en el teléfono. */
  entryHref:   string
  /** Ícono del manifest, servido desde `public/`. */
  iconSrc:     string
  /** Módulo del registry al que pertenece (interruptor y etiqueta). */
  moduleId:    string
  /** Ruta que decide si la app está encendida (`isRouteOperational`). */
  toggleRoute: string
  /** Dónde se administran sus accesos, si los tiene. */
  manageHref:  string | null
  manageLabel: string | null
}

export const FIELD_APPS: readonly FieldAppDef[] = [
  {
    id: "ppa",
    label: "PPA Digital",
    description: "Evaluación preventiva antes de iniciar el trabajo",
    entryHref: "/ppa",
    iconSrc: "/ppa-icon-192.png",
    moduleId: "ppa",
    // La misma ruta con que `submitPpaAction` decide si acepta envíos.
    toggleRoute: "/prevencion/ppa",
    manageHref: null,
    manageLabel: null,
  },
  {
    id: "mantencion",
    label: "Mantención",
    description: "Registro de mantención preventiva y correctiva de equipos, con o sin señal",
    entryHref: "/m/mantencion",
    iconSrc: "/mant-icon-192.png",
    moduleId: "mantencion_equipos",
    // `/api/mantencion/sync/*` cuelga de este submódulo (module-toggles-routes).
    toggleRoute: "/mantencion/registros",
    manageHref: "/mantencion/dispositivos",
    manageLabel: "Administrar dispositivos",
  },
  {
    id: "tae",
    label: "Control TAE",
    description: "Registro operativo de cargas TAE de Copec",
    entryHref: "/tae",
    iconSrc: "/tae-icon-192.png",
    moduleId: "combustibles",
    // `/api/tae` cuelga de este submódulo (module-toggles-routes).
    toggleRoute: "/combustibles/cargas",
    manageHref: "/combustibles/ajustes/puntos-de-carga",
    manageLabel: "Administrar enlaces",
  },
]

export function isFieldAppId(value: unknown): value is FieldAppId {
  return typeof value === "string" && (FIELD_APP_IDS as readonly string[]).includes(value)
}

export function findFieldApp(id: string): FieldAppDef | undefined {
  return FIELD_APPS.find((app) => app.id === id)
}
