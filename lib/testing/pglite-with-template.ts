import type { PGliteOptions } from "@electric-sql/pglite"
import { PGlite as RealPGlite } from "./pglite-real"
import { readPgliteTemplate } from "./pglite-template"

/**
 * `@electric-sql/pglite` sustituido en `vitest.pglite.config.ts`.
 *
 * Cargar un dump sólo se puede al construir la instancia (`loadDataDir` no es
 * un método de instancia), y las 330 suites que usan el migrador común hacen
 * `new PGlite()`. En vez de tocar cada archivo, se intercepta el módulo en el
 * proyecto de Vitest: la primera suite no encuentra plantilla y migra como
 * siempre; al terminar la escribe, y las siguientes cargan el dump en 1 s en
 * lugar de repetir 371 migraciones.
 *
 * Las suites que construyen su propio esquema importan `pglite-real.ts`.
 */
let template: File | null | undefined

export class PGlite extends RealPGlite {
  constructor(options?: PGliteOptions) {
    // Un archivo de test puede instanciar PGlite más de una vez; mientras la
    // plantilla exista se reutiliza el dump de 10,9 MB. Si todavía es `null`
    // (primera suite de la máquina), se reintenta: la migración anterior pudo
    // haberla escrito en este mismo proceso.
    if (options === undefined && template == null) template = readPgliteTemplate()
    const loadDataDir = options === undefined ? template : null
    super(loadDataDir ? { ...options, loadDataDir } : options)
  }
}
