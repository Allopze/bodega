# Prevención — PRs laterales I14 (etapas) y M10 (vitest)

- Fecha: 2026-09-26
- Rama: `prevencion/laterales-i14-m10`, base `e47d9b7a`
- Plan: sección "PRs laterales" · Auditoría: `2026-09-26-prevencion-production-readiness.md` (PREV-I14, PREV-M10)

## Alcance

| Ítem | Cambio | Archivos |
|---|---|---|
| PREV-I14 (etapas) | La grilla de etapas del ciclo de vida pasa a ser `<ol aria-label="Etapas del programa">` con `flex-wrap`; cada etapa es un `<li>` con `flex-[1_1_12rem]` y `min-w-0`, y el rótulo y el valor parten línea (`break-words`). El rótulo sigue enfocable con el tooltip de siglas. Colores sin cambios (ya usaban `-ink` y tokens de texto). | `app/(app)/prevencion/pdtp/[programId]/program-lifecycle-controls.tsx`, `…/program-lifecycle-controls.test.tsx` |
| PREV-M10 | `vitest` y `@vitest/coverage-v8` de `^4.1.8` a `^4.1.11`, dentro del mismo major. `vite` se mantiene en 6.4.3: resolver sin fijar lo subía a 8.x (rolldown), un cambio sin relación con el advisory. El lockfile solo cambia vitest y sus dependencias (`@vitest/*`, es-module-lexer, expect-type, obug, std-env, tinyexec, tinyrainbow). | `package.json`, `package-lock.json` |

Lo que I14 **no** cubre: los textos contradictorios de la auditoría original (I14 a/b/c: "frenan la firma" en un programa activo, "M7S1" en aprobaciones, el KPI "Ejecutadas"). Se trataron en `2026-09-26-prevencion-fixes.md`; este PR lateral se limita al punto del plan (lista semántica y envoltura a 390 px).

## Evidencia

### I14: rojo → verde

- Rojo (antes del cambio): la prueba nueva `expone las etapas como una lista ordenada que envuelve, con rótulo y estado por etapa` falló con `Unable to find an accessible element with the role "list" and name "Etapas del programa"` (12 pasaron y 1 falló de 13).
- Verde: 13 de 13 después del cambio.

### Navegador (servidor aislado en :3400, base `bodega_lat_e2e`)

Script Playwright propio (fuera del repo), login con `e2e/helpers.ts`:

| Caso | 1440 px | 390 px |
|---|---|---|
| `pdtp-prog-e2e` (activo) | `OL`, 2 etapas en 1 fila, sin scroll horizontal (ol 1126/1126, documento 1440/1440, well 1192/1192) | 2 etapas en 2 filas, sin scroll horizontal (ol 356/356, documento 390/390) |
| `pdtp-draft-e2e` (borrador) | igual, "Versión congelada: Pendiente" | igual |
| Prueba de estrés: se inyectan 4 etapas con rótulo largo y un valor de 57 caracteres sin espacios | 6 etapas en 2 filas, borde derecho máximo = borde del `ol` | 6 etapas en 6 filas, sin desborde |

Sin errores de consola ni respuestas 5xx en las 4 cargas reales. El seed E2E no trae plantilla de aprobación, por eso los programas reales muestran solo 2 etapas. Para probar con más etapas se usó la inyección en el DOM.

### Auditoría de dependencias (M10)

| | Antes | Después |
|---|---|---|
| `npm audit` | 3 moderadas (vitest, @vitest/mocker, @vitest/coverage-v8 → GHSA-82fw-gwwq-j7x9, `>=2.1.0 <4.1.11`), 0 altas, 0 críticas | **0 vulnerabilidades** |
| `npm run check:security-audit` | exit 0 | exit 0 |

En el allowlist de `scripts/check-security-audit.ts` no había ninguna entrada para este advisory, porque solo cubre hallazgos altos. No se quitó nada. Observación: ninguna de las 4 entradas del allowlist (brace-expansion ×2, sharp, js-yaml) aparece hoy en `npm audit`, ni antes ni después del bump. Parecen obsoletas, pero se dejan fuera de este PR: tocarlas sale del alcance de "solo package.json/lock".

## Puertas ejecutadas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 (también pasó en el hook pre-commit de cada commit) |
| `npm run check:security-audit` | exit 0 |
| `npm run test:fast` (vitest 4.1.11) | 771 archivos PASS / 30 omitidos; 10.013 pruebas PASS / 291 omitidas |
| `npm run test:pglite` (vitest 4.1.11) | 198/198 archivos PASS; 2.384/2.384 pruebas PASS (igual que en la integración T1+T5) |
| `npx playwright test e2e/pdtp-*.spec.ts` contra :3400 (config temporal fuera del repo, 1 worker) | 65 PASS / 1 omitida (`pdtp-habilitacion.spec.ts:98`, omisión condicional ya existente) |

## Sin recorrer

- `npm run test:e2e` completo, suites `*-postgres`, `npm run doctor`, `db:verify-migrations` (no hay migraciones en este PR).
- La cifra de `test:fast` (10.013) no se comparó contra una corrida con vitest 4.1.8 en la misma base. El informe de la integración T1+T5 anotaba 10.014, y la cuenta esperable con la prueba nueva sería 10.015. No hubo fallas. La diferencia puede venir de omisiones condicionales, pero no se investigó.
- Navegador con una plantilla de aprobación real de más de 2 pasos: el seed no la trae, y se cubrió con la inyección en el DOM.
