/**
 * Configuración de cobertura compartida por los dos proyectos de test.
 *
 * Existe porque medir cobertura sólo con `vitest.config.ts` deja fuera del
 * numerador todo lo que cubren las 53 suites PGlite (`vitest.pglite.config.ts`),
 * y servicios enteros aparecen en 0 % cuando en realidad están probados —
 * sólo que en el otro proyecto. Con el mismo `include`/`exclude` en ambos, sus
 * reportes se pueden combinar en una sola cifra comparable
 * (H-12, AUDITORIA_BUGS_2026-08-05.md).
 *
 * Los umbrales se aplican SOLO en la corrida unificada (`npm run
 * test:coverage:all`): exigirlos en cada proyecto por separado castigaría a
 * cada uno por lo que cubre el otro.
 */
export const COVERAGE_INCLUDE = [
  "lib/**/*.ts",
  // Las Server Actions son la frontera de escritura de la aplicación: quedaban
  // fuera del denominador pese a concentrar permisos, validación y alcance.
  "app/**/actions.ts",
  "app/**/actions/**/*.ts",
  "app/**/actions-*.ts",
]

export const COVERAGE_EXCLUDE = [
  "lib/auth/types.ts",
  "lib/sst/types.ts",
  "lib/requests/request-config.ts",
  "lib/sst/index.ts",
  "**/*.d.ts",
  "**/node_modules/**",
  // Declarar un `exclude` propio reemplaza los defaults de Vitest, que ya
  // descartaban el código de prueba: sin estas líneas los propios tests y sus
  // ayudantes entran al denominador y la cifra deja de medir la aplicación.
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/__tests__/**",
  "lib/testing/**",
]

/**
 * `exclude` se evalúa por defecto sobre los paths transformados, antes del
 * remapeo a fuentes, y ahí no descarta nada. Verificado: sin esto los propios
 * `*.test.ts` entran al denominador.
 *
 * Va en las configs de ORIGEN, no en la del merge: `--mergeReports` respeta
 * `thresholds` pero no `include`/`exclude` — esos quedan grabados en el blob
 * en el momento de recolectar.
 */
export const COVERAGE_EXCLUDE_AFTER_REMAP = true

/**
 * Piso de la corrida unificada.
 *
 * Medición real del 2026-08-05 sobre ambos proyectos combinados: statements
 * 57,37 % · branches 47,76 % · functions 60,78 % · lines 60,81 %. El umbral va
 * unos puntos por debajo para absorber fluctuación normal sin volverse ruido.
 *
 * Los 40/30/40/40 anteriores describían otra cosa: sólo el proyecto rápido,
 * sólo `lib/**`, y con los propios tests dentro del denominador. Súbelo cuando
 * la cobertura real suba, no antes.
 */
export const COVERAGE_THRESHOLDS = {
  statements: 55,
  branches:   45,
  functions:  57,
  lines:      57,
}
