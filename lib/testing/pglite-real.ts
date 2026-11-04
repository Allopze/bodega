import { createRequire } from "node:module"
import type { PGlite as PGliteInstance, PGliteOptions } from "@electric-sql/pglite"

/**
 * PGlite **sin** la plantilla migrada.
 *
 * Va para las suites que construyen su propio esquema o aplican una migración
 * concreta sobre una base vacía (las de `*-migration.test.ts`, backfills y
 * `queue-age`). Esas pruebas afirman justamente el paso desde un estado
 * anterior; si heredaran el esquema ya migrado, el `CREATE TABLE` inicial
 * fallaría con «relation already exists» y la prueba dejaría de medir lo suyo.
 *
 * El resto de las suites importa `@electric-sql/pglite`, que en
 * `vitest.pglite.config.ts` resuelve a `pglite-with-template.ts`.
 *
 * `createRequire` salta el alias de Vite a propósito: si resolviera por el
 * alias, este módulo se importaría a sí mismo.
 */
const nodeRequire = createRequire(import.meta.url)
const real = nodeRequire("@electric-sql/pglite") as {
  PGlite: new (options?: PGliteOptions) => PGliteInstance
}

export class PGlite extends real.PGlite {}
