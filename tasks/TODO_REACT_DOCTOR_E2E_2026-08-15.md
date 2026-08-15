# TODO React Doctor y E2E — 2026-08-15

Alcance: árbol local completo respecto de `HEAD`, incluidos archivos no rastreados. Entrega en working tree, sin commit, push ni despliegue.

## Baseline reproducible

- [x] Fijar React Doctor `0.9.12` y guardar reporte JSON schema `3`.
- [x] Ejecutar `--scope files --base HEAD --include-untracked --no-cache`.
- [x] Confirmar cobertura completa: `33` archivos, `0` errores, `91` advertencias, score `81/100`.
- [x] TypeScript: `npm run typecheck`.
- [x] ESLint: `npm run lint`.
- [x] Pruebas rápidas: `4.060` pasadas, `181` omitidas.
- [x] PGlite: `672` pasadas.
- [x] Cadena de migraciones: `169` entradas hasta `0168_fat_scarlet_spider`.
- [x] Secretos y auditoría de dependencias.
- [x] `git diff --check`.
- [x] Build de producción con Next.js `16.2.12`.

## Diagnósticos React Doctor

| Estado | Regla | Cantidad | Tratamiento requerido |
| --- | --- | ---: | --- |
| [x] | `async-await-in-loop` | 26 | Diez N+1/lotes corregidos; 16 efectos ordenados revisados individualmente (proveedores, CAS, CAPA, auditoría o límite de fan-out) y documentados sin supresión. |
| [x] | `js-combine-iterations` | 25 | Catorce recorridos de servicios/hot paths fusionados; 11 proyecciones UI pequeñas preservadas por legibilidad y documentadas con evidencia de alcance. |
| [x] | `server-sequential-independent-await` | 14 | Diez lecturas independientes paralelizadas; cuatro órdenes transaccionales/de estado preservados y documentados. |
| [x] | `zod-v4-prefer-top-level-string-formats` | 5 | Migradas a `z.iso.datetime()`/`z.url()`; 49 pruebas focalizadas y rescan limpios. |
| [x] | `no-giant-component` | 3 | Revisadas: son Server Components orquestadores con hojas interactivas ya extraídas; no hay frontera concreta que justifique un split mecánico. |
| [x] | `js-flatmap-filter` | 3 | Normalización DTE/PDTP convertida a una pasada conservando la eliminación explícita de valores vacíos; rescan limpio. |
| [x] | `no-many-boolean-props` | 2 | Capacidades independientes agrupadas en `RiskMatrixPermissions`; rescan limpio. |
| [x] | `rendering-hydration-mismatch-time` | 2 | Fecha calculada en Server Component y serializada al workbench; prueba RED→GREEN y rescan limpio. |
| [x] | `js-set-map-lookups` | 2 | Sets estables para períodos DTE y secciones SST; rescan limpio. |
| [x] | `js-hoist-intl` | 2 | Formateadores Chile reutilizados; benchmark local ~71,9× y rescan limpio. |
| [x] | `js-index-maps` | 2 | Índices estables para comité y requisitos de certificación; rescan limpio. |
| [x] | `no-prevent-default` | 1 | Rechazado con evidencia: diálogo cliente-controlado mediante `useOperation`; excepción documentada. |
| [x] | `no-derived-useState` | 1 | Eliminada la copia local; el estado viaja en el formulario y el select se reinicia con la versión visible. Prueba RED→GREEN y rescan limpio. |
| [x] | `click-events-have-key-events` | 1 | Plano enfocable con Enter/Espacio, sin interferir con botones de marcadores. Prueba RED→GREEN y rescan limpio. |
| [x] | `nextjs-no-img-element` | 1 | Rechazado con evidencia: ruta autenticada + dimensiones naturales necesarias para coordenadas; excepción documentada con contrato Next.js 16. |
| [x] | `async-parallel` | 1 | Cobertura PDTP agrupada en lecturas paralelas después de sus gates obligatorios; pruebas PGlite y rescan limpios. |

## E2E y cierre

- [x] Verificar que `E2E_DATABASE_URL` apunte a una base explícitamente desechable y que `E2E_ALLOW_DESTRUCTIVE_RESET=true` esté presente: PostgreSQL exclusivo `bodega-e2e-reactdoctor-20260815`, puerto `55439`, base `bodega_e2e`; Playwright inyecta el flag destructivo sólo al setup aislado.
- [x] Ejecutar Playwright contra servidor y base exclusivos: corrida final `429` pasadas, `3` omitidas, `0` fallidas (`432` total, 2 workers, 16,8 min).
- [x] Ejecutar específicamente los flujos CPHS lifecycle, CPHS maturity y mapa MIPER: pasaron tanto focalizados como dentro de la corrida completa.
- [x] Revisar fallos de navegador, consola, red y accesibilidad que exponga la suite: corregidos PDTP, selectores CPHS, persistencia URL de MIPER, transición Compras→Recepción, costo de servicios y expiración de sesión bajo carga. Los logs restantes (`CredentialsSignin`, Server Action falsa y flujos negativos deliberados) corresponden a pruebas de rechazo exitosas.
- [x] Repetir React Doctor con idéntica versión y alcance: `0` errores, `36` advertencias, `25` archivos, score `87/100`.
- [x] Ejecutar scan no filtrado de regresión sobre los archivos afectados: `13` advertencias en `10` archivos, todas subconjunto de las excepciones individualmente revisadas; no reapareció ninguna categoría corregida.
- [x] Repetir todos los gates del baseline y registrar cualquier pendiente real.

## Criterio de marcado

Una fila se marca solo cuando todas sus ocurrencias quedaron corregidas y verificadas, o clasificadas individualmente con evidencia como rechazadas/observaciones legítimas. No se deshabilitan reglas ni se agregan supresiones para inflar el score.

## Progreso de rescans

- Baseline: `91` advertencias, score `81/100`.
- Tras Zod + contrato temporal/permisos MIPER: `82` advertencias, score `82/100`; cobertura completa, `0` errores.
- Tras estado de certificación + teclado del mapa: `80` advertencias, score `83/100`; cobertura completa, `0` errores.
- Tras fechas reutilizables + lecturas de cobertura: `71` advertencias, score `84/100`; cobertura completa, `0` errores.
- Tras lotes SST, índices y certificación/MIPER: `54` advertencias, score `87/100`; cobertura completa, `0` errores.
- Tras N+1 de MIPER/PDTP/capacitación: `48` advertencias, score `87/100`; cobertura completa, `0` errores.
- Estado revisado previo a E2E: `36` advertencias, score `87/100`; las 36 restantes están clasificadas individualmente en `.react-doctor/false-positives.md`, sin reglas deshabilitadas ni supresiones.
- Rescan final posterior a pruebas: `36` advertencias, score `87/100`, `0` errores; distribución estable: 16 efectos async ordenados, 11 proyecciones acotadas, 4 órdenes transaccionales/de estado, 3 Server Components orquestadores, 1 formulario controlado por cliente y 1 imagen autenticada de mapa.

## Evidencia final

- Playwright: `429` pasadas, `3` omitidas, `0` fallidas.
- Vitest rápido: `491` archivos pasados, `26` omitidos; `4.066` pruebas pasadas, `181` omitidas.
- PGlite: `64` archivos y `672` pruebas pasadas.
- PostgreSQL real focalizado: `59` pruebas pasadas — MIPER/legal `4`, capacitación `19`, inspecciones `18`, CPHS `15`, CAPA `3`.
- TypeScript, ESLint, build Next.js `16.2.12`, `git diff --check`, secretos y auditoría de dependencias: pasados.
- Migraciones: `169` entradas verificadas hasta `0168_fat_scarlet_spider`.
- Contenedor desechable `bodega-e2e-reactdoctor-20260815` y sus bases retirados; puertos `3100` y `55439` libres. El contenedor habitual en `55432` quedó intacto. No hubo commit, push ni despliegue.
