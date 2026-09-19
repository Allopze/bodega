import { discoverRoutePatterns } from "../scripts/capture-route-inventory"

/**
 * Alcance y configuración de la auditoría automática de accesibilidad.
 *
 * Vive fuera del `.spec` para que sea verificable sin navegador: el contrato
 * que protege —qué se audita y con qué reglas— es exactamente lo que la
 * auditoría interna encontró roto, y no puede depender de correr Playwright
 * para detectar una regresión (`e2e/accessibility-targets.test.ts`).
 */

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const

/**
 * UX-001 (auditoría 2026-09-14): la suite desactivaba `color-contrast` con el
 * comentario "audited separately in AUDITORIA.md". El contraste es, junto al
 * foco, lo que más se rompe al tocar estilos, y era el único criterio que la
 * suite decidía no mirar: un cambio de token podía degradarlo sin que fallara
 * ninguna prueba.
 *
 * La lista queda **vacía a propósito**. Cualquier excepción futura se escribe
 * acá con su motivo; la prueba de acompañamiento exige que `color-contrast`
 * nunca vuelva a esta lista.
 *
 * La paleta declarada en `app/globals.css` cumple AA en los pares que el
 * sistema realmente usa (texto sobre superficie y cada `*-ink` sobre su
 * `*-tint`), y esa comprobación se automatizó también sin navegador en la
 * misma prueba: los tres tokens sólidos que no alcanzan 4.5:1 contra blanco
 * —`signal`, `warning` y `accent`— no se usan como fondo de texto en ninguna
 * pantalla, sólo como relleno de íconos y bordes.
 */
export const AXE_DISABLED_RULES: readonly string[] = []

export interface AccessibilityTarget {
  /** URL concreta que visita la suite. */
  path: string
  /** Patrón del App Router del que sale (clave de cobertura). */
  pattern: string
  /** Nombre del caso de prueba. */
  name: string
  /** `false` = se visita sin sesión. */
  auth: boolean
}

/**
 * UX-002: rutas que el inventario descubre y la auditoría **no** visita, cada
 * una con su motivo. Es la única lista escrita a mano que queda, y la prueba
 * exige que toda entrada corresponda a una ruta real: una exclusión huérfana
 * es un error, no un comentario que envejece en silencio.
 */
export const EXCLUDED_ROUTES: Record<string, string> = {
  // Redirección pura hacia `/dashboard` o `/login`: no pinta interfaz propia.
  "/": "Redirección de entrada; no renderiza interfaz auditable.",
}

/**
 * URL concreta para los patrones que no se pueden visitar tal cual: rutas
 * dinámicas con su fixture del sembrado E2E, y pantallas que exigen un
 * parámetro de consulta para mostrar contenido.
 *
 * Los ids son los mismos que ya usaba la suite antes de esta corrección, más
 * los del sembrado de `scripts/axe-audit.ts`. No se inventan fixtures nuevos:
 * un patrón dinámico sin entrada acá simplemente no se audita, y la prueba lo
 * reporta como deuda visible en vez de esconderlo.
 */
export const ROUTE_URL_OVERRIDES: Record<string, string> = {
  "/recepcion/nueva": "/recepcion/nueva?oc=po-audit-1",
  "/compras/[id]/print": "/compras/oc-e2e/print",
  "/entregas/[id]/print": "/entregas/del-e2e/print",
  "/sst/[id]/print": "/sst/sst-eval-e2e/print",
  "/prevencion/pdtp/[programId]/habilitacion": "/prevencion/pdtp/pdtp-prog-e2e/habilitacion",
}

/**
 * UX-002 (auditoría 2026-09-14): la suite recorría una lista fija de ~20
 * páginas sobre 207 —"la cobertura declarada como auditoría de accesibilidad
 * es representativa, no exhaustiva"— y, peor, esa lista no crecía sola: cada
 * módulo nuevo nacía fuera del alcance sin que nada avisara.
 *
 * El inventario de rutas ya existía para las capturas
 * (`scripts/capture-route-inventory.ts`); acá se reutiliza. Toda página
 * estática del App Router entra al alcance por el hecho de existir.
 */
export function accessibilityTargets(appDirectory?: string): AccessibilityTarget[] {
  return discoverRoutePatterns(appDirectory)
    .filter((route) => !(route.pattern in EXCLUDED_ROUTES))
    .filter((route) => !route.dynamic || route.pattern in ROUTE_URL_OVERRIDES)
    .map((route) => ({
      path: ROUTE_URL_OVERRIDES[route.pattern] ?? route.pattern,
      pattern: route.pattern,
      name: route.pattern,
      auth: route.auth,
    }))
}

/** Rutas estáticas que no se auditan ni están excluidas con motivo: deben ser cero. */
export function uncoveredStaticRoutes(appDirectory?: string): string[] {
  const covered = new Set(accessibilityTargets(appDirectory).map((target) => target.pattern))
  return discoverRoutePatterns(appDirectory)
    .filter((route) => !route.dynamic)
    .filter((route) => !covered.has(route.pattern) && !(route.pattern in EXCLUDED_ROUTES))
    .map((route) => route.pattern)
}

/** Patrones dinámicos sin fixture: deuda declarada, no cobertura silenciosa. */
export function dynamicRoutesWithoutFixture(appDirectory?: string): string[] {
  return discoverRoutePatterns(appDirectory)
    .filter((route) => route.dynamic && !(route.pattern in ROUTE_URL_OVERRIDES) && !(route.pattern in EXCLUDED_ROUTES))
    .map((route) => route.pattern)
}
