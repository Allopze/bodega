# Defectos preexistentes de la verificación — 2026-09-27

Rama `fix/preexistentes`, desde `prevencion/integracion-final` (`33a10750`). Sin
migraciones. Los cuatro puntos se reportaron en la tabla "Verificación" de
[2026-09-27-prevencion-cierre-plan.md](2026-09-27-prevencion-cierre-plan.md) como
fallas iguales en `main` (`9c862fd0`), no como regresiones.

**Alcance.** Suites `*-postgres`, React Doctor, gate de `npm audit` y el conteo de
`test:fast`. **Sin recorrer:** `test:e2e` completo (sólo 5 specs relacionados),
navegador manual, producción.

## 1. Suites `*-postgres`

Cada una corrió contra su propia base `_test` desechable en `127.0.0.1:55432`
(contenedor `bodega-e2e-postgres`). En ningún caso la aserción de autorización o
de concurrencia se debilitó.

| Suite | Causa | ¿Prueba o producto? | Arreglo |
|---|---|---|---|
| `combustibles-scope` (2) | La baja masiva exige `admin:fleet_vehicles` desde `e732a5ac2`; el fixture de sesión sólo tenía `combustibles:manage_vehicles`. La action cortaba en "Sin permisos" **antes** del filtro de faena: las pruebas de alcance no estaban probando el alcance. | Prueba desactualizada (la contraparte PGlite ya tenía el permiso) | Se agrega el permiso al fixture. La aserción de alcance (un vehículo de otra faena rechaza el lote entero) no cambia |
| `receiving-concurrency` (1) | Dos defectos de fixture: sin bodega-oficina configurada (`resolveOfficeWorksite` rechazaba las dos recepciones) y el ítem de solicitud en `in_purchase_order` bajo una OC `sent` (`sendOrder` los deja en `purchased`). Efecto oculto: la carrera recepción/cancelación **pasaba sola**, porque la recepción no podía ganar nunca. | Prueba desactualizada. El producto serializa bien | Fixture corregido y aserción nueva: el perdedor cae por "exceeds pending quantity". **Mutación:** sin los dos `FOR UPDATE` de `lib/services/receiving.ts` la prueba vuelve a rojo; con ellos, verde |
| `trabajadores-scope` (3) | Las tres morían en el `beforeEach`: la importación de la prueba anterior deja filas en `worker_position_history` (inmutable, FK a `workers`) y el `DELETE` de workers fallaba. No llegaban a la aserción de alcance. | Prueba desactualizada (la contraparte PGlite ya vaciaba la tabla) | Mismo orden de limpieza que PGlite (`truncateImmutableTable`). Las tres pasan **sin cambiar ninguna aserción**: import, `updateWorker` y `toggleWorkerActive` siguen negando fuera de faena |
| `invoice-line-allocations-concurrency` ("saltada") | **No estaba saltada.** Era la única suite que no crea su base: con la URL puesta y la base inexistente, el `beforeAll` moría con `database does not exist` y Vitest 4 resume eso como `Tests 1 skipped` (el fallo sólo aparece bajo "Failed Suites"). Reproducido con el archivo de `33a10750`. Tampoco pedía `_ALLOW_DESTRUCTIVE_RESET`. | Prueba (harness) | Crea su base como las demás y exige el par de variables. Verde desde una base inexistente |

**Hallazgo adicional, con prueba de contrato.** `lib/__tests__/postgres-suites-gating.test.ts`
comprueba que cada suite se habilite con `<P>_DATABASE_URL` + `<P>_ALLOW_DESTRUCTIVE_RESET`
y que algún paso de `.github/workflows/ci.yml` la incluya con las dos variables. En
rojo encontró **cinco suites que CI nunca corría** (se saltaban en verde):
`epp-request-concurrency`, `tae-import-reversal-concurrency`,
`pdtp-revision-window-concurrency` y `pdtp-year-close-concurrency` (el glob las tomaba
sin sus variables) y `pdtp-accreditation-year-close` (fuera de todo glob). Se agregaron
sus variables y un paso propio para la última. Las cinco pasan contra Postgres real.
No se verificó una corrida real de GitHub Actions.

**Corrida completa final:** 32/32 archivos PASS, **290 pruebas PASS**, 0 fallas, 0 "Failed Suites".

## 2. React Doctor (`npm run doctor`, react-doctor 0.9.14)

| | Antes (`33a10750`) | Después |
|---|---|---|
| Errores | 12 (10 de bugs, 2 de seguridad) | **0** |
| Puntaje | 49/100 | 67/100 |
| Código de salida | 1 | 0 |
| Warnings (fuera de alcance) | 951 | 950 |

| Archivo:línea (antes) | Regla | Veredicto | Arreglo |
|---|---|---|---|
| `lib/services/password-reset.ts:21, 98, 115` | server-auth-actions | **Real (seguridad).** El módulo era `"use server"`, así que sus tres exports eran endpoints POST públicos: `requestPasswordReset` sin el rate limit por IP de `forgotPasswordAction` (envío masivo de correos) y `applyPasswordReset` sin el largo mínimo de `resetPasswordAction` | Se quita la directiva: servicio interno. Prueba nueva `lib-no-use-server.test.ts` (roja antes): ningún módulo de `lib/` declara `"use server"` |
| `app/(app)/facturacion/propuestas/actions.ts:231` | server-auth-actions | Parcial: había guarda, pero después del parseo; sin sesión se podía sondear la forma de la entrada | `guardPermission` pasa a ser lo primero. Prueba nueva (roja antes) |
| `app/(app)/combustibles/actions-module/suppliers.ts:237` | server-auth-actions | Falso positivo (era `FormData.set`, delegaba el permiso), pero `deleteFuelSupplierAction` no tenía llamadores de UI | Se retira el envoltorio; sus pruebas pasan a `toggleFuelSupplierActive` |
| `app/(app)/compras/[id]/invoice-allocation-editor.tsx:104` | no-impure-state-updater | Real: `++rowSequence.current` dentro del updater de `setDraft` | La clave se reserva fuera del updater |
| `components/layout/navigation-progress.tsx:31` | effect-needs-cleanup | Débil: los timers vivían en un ref que vaciaba otro efecto | Los crea y libera el efecto del pathname; sale `useSearchParams`, que no se comparaba. Mismos tiempos |
| `components/pwa/pwa-register.tsx:15` | effect-needs-cleanup | Parcial: el listener `statechange` del worker nuevo no se liberaba | Ahora sí; el resto ya limpiaba → supresión puntual justificada |
| `app/(app)/admin/backups/sa-health-section.tsx:128` | effect-needs-cleanup | Falso positivo (limpiaba vía refs) | Intervalos como variables locales del efecto |
| `app/(app)/flota/monitoreo/fleet-gps-map.tsx:21` | effect-needs-cleanup | Falso positivo: `map.remove()` libera los `map.on` | Supresión puntual justificada |
| `app/api/admin/catalogos/export/route.ts:35` | nextjs-no-side-effect-in-get-handler | Falso positivo: `Map.set` local | Supresión puntual justificada |
| `app/api/purchase-orders/dtes/[id]/pdf/route.ts:17` | nextjs-no-side-effect-in-get-handler | Falso positivo: `Uint8Array#set` | `Uint8Array.from` |

`doctor.config.json` ignora `.claude/**` (worktrees de agentes) y directorios no
fuente que ya están en `.gitignore`. Dentro de este worktree, un archivo señuelo bajo
`.claude/worktrees/` ya quedaba fuera por `.gitignore`; **no se reprodujeron** desde el
checkout principal las 23 copias duplicadas que reportó el informe de cierre.

## 3. `npm run check:security-audit`

`npm audit`: 0 vulnerabilidades. Las cuatro entradas del allowlist
(GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895, GHSA-f88m-g3jw-g9cj, GHSA-5p4m-2wfm-xmqj)
ya no correspondían a ningún hallazgo. El script no tenía regla para entradas
obsoletas (sólo vencimiento por `reviewBy`): se vació el allowlist, se retiraron los
guardrails que sólo las sostenían y se agregó `findStaleAllowlistEntries`: una
entrada sin hallazgo alto que la respalde hace fallar el gate. Gate en verde.

## 4. Las 2 pruebas "saltadas tras vitest 4.1.11"

No es Vitest. Son `emergency-resource-catalog` ("reconoce el manifiesto real de
Biodiversa") y `re08-master-list-mapping` ("el XLSX de origen no cambió de versión"),
con `skipIf(!existsSync(...))` sobre dos planillas reales **no versionadas**
(`INVENTARIO DE EXTINTORES FAENA BIODIVERSA 2026.xlsx` y
`docs/prevención/.../RE-08 LISTADO MAESTRO...xlsx`), que existen sólo en el checkout
principal. La corrida de M10 (10.013/291) se hizo en un worktree. Evidencia, con la
misma Vitest 4.1.11: desde el checkout principal 17/17 PASS; desde este worktree 15
PASS + 2 omitidas. **El salto es correcto** (`9c71993ba` lo introdujo para que CI no
fallara sin esos datos, que no corresponde versionar). Sin cambio.

## Puertas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (además, el hook de cada commit) |
| `npm run check:security-audit` | PASS (allowlist vacío) |
| `npm run test:fast` | 777 archivos / **10.167 PASS**, 293 omitidas (290 de `*-postgres` sin variables + 3 condicionales por archivo/runtime) |
| `npm run test:pglite` | 214 archivos / **2.626 PASS**, 1 omitida (sonda `PDTP_PROBE_OUT`) |
| `npm run doctor` | 0 errores, 67/100, salida 0 (antes 12 errores, 49/100, salida 1) |
| `*-postgres` (32, base `_test` propia cada una) | 32/32, 290 PASS |
| E2E en servidor aislado `:3300` (`negative-flows`, `facturacion`, `invoice-allocation-split`, `combustibles`, `ppa-offline`) | 61 PASS, 1 omitida (condicional, preexistente) |

Nota de E2E: una primera corrida sin `E2E_DATABASE_URL` en el proceso de Playwright
dejó el rate limit de login sin limpiar (`clearRateLimits` lo necesita), y una
segunda sobre la misma base ya mutada falló en dos specs no idempotentes. Con base
nueva y la variable puesta: 61/61 de los ejecutados en verde.

## Riesgos y pendientes

- CI ahora corre cinco suites que antes no ejecutaba; pasan localmente contra
  Postgres 16.15 del contenedor (CI usa `postgres:16`); no se verificó una corrida real de Actions.
- `ci.yml` conserva variables de suites que ya no existen (`DELIVERIES_CONCURRENCY_*`,
  `PREVENTION_TRAINING_*`); inofensivas, no se tocaron.
- Las supresiones de React Doctor (`fleet-gps-map`, `pwa-register`, export de
  catálogos) desactivan la regla en esa línea: un efecto real agregado ahí no lo
  reportaría.
