# QA — Integridad operacional de compras y stock

**Rama:** `feat/integridad-operacional-compras-stock`
**Fecha de la corrida:** 2026-09-09; integración con `main` el 2026-09-10
**Alcance:** Tasks 1–7 del plan `docs/superpowers/plans/2026-09-08-integridad-operacional-compras-stock.md`

## 1. Estado de la entrega

Las siete tareas del plan están implementadas y la rama está integrada con `main`
(36 commits de divergencia incorporados el 2026-09-10). El conflicto de numeración de
migraciones descrito en §6 **quedó resuelto**.

## 2. Resultados exactos de los comandos

Ejecutados secuencialmente en el worktree de la rama.

| Comando | Resultado |
|---|---|
| `npm run db:verify-migrations` | `verified 264 entries through 0264_eminent_shiver_man` — exit 0 |
| `npm run db:generate` | `No schema changes, nothing to migrate` — exit 0 |
| `npm run db:migrate` (base vacía) | exit 0; las 4 tablas y la FK compuesta creadas |
| `npm run db:verify-invoice-allocations` | los cinco conteos en 0 — exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test:fast` | 640 archivos OK, **1 fallo ambiental** (§5) — exit 1 |
| `npm run test:pglite` | 126 archivos OK, **1 fallo ajeno** (§5) — exit 1 |
| Concurrencia real: asignaciones de factura | 1 test, exit 0 |
| Concurrencia real: movimientos de stock | 2 tests, exit 0 |
| `npm run perf:queries` | 12 consultas bajo el presupuesto de 1000 ms — exit 0 |
| `npm run build` | exit 0 (requiere `DATABASE_URL` definido) |
| `npm run test:e2e -- e2e/operational-integrity.spec.ts` | 2 tests, exit 0 |

Todos ejecutados sobre el árbol **ya mergeado con `main`**, contra PostgreSQL 16 en bases
desechables.

La consulta nueva de disponibilidad proyectada rinde **17,8 ms** sobre el dataset mediano
(1200 solicitudes, 3600 ítems, 500 OC, 600 filas de stock), dentro del mismo presupuesto de
un segundo que el resto. No se creó un segundo harness de performance.

## 3. Migraciones y datos

- **Tag de la migración:** `0264_eminent_shiver_man` (idx 263). Sustituye a los originales
  `0261_mixed_mordo` y `0262_kind_mastermind`, consolidados en uno solo al integrar (§6).
- **Backfill 1:1 → N:N:** el verificador reporta 0 filas heredadas sin su asignación sobre
  una base migrada desde cero. **No se ejecutó contra un volcado de producción**, así que el
  conteo real de backfill sigue sin medirse.
- **Filas con más de una asignación:** 0 en la base de verificación (base limpia, sin datos
  productivos). Este número hay que volver a leerlo contra producción antes del release,
  porque de él depende la compatibilidad de rollback descrita en §7.

## 4. Escenarios verificados en navegador autenticado

Cubiertos por `e2e/operational-integrity.spec.ts` (Chromium, sesión autenticada, datos QA
dedicados sobre `prod-qa-integridad-e2e`):

1. Escaneo del ledger y aparición del caso `STOCK_BALANCE_MISMATCH` con severidad crítica.
2. Filtro por dominio: el caso desaparece bajo «Compras» y vuelve bajo «Bodega».
3. CTA exacto: «Ver evidencia» navega a `/bodega?vista=kardex&faena=…&producto=…`.
4. Volver conserva pestaña y faena.
5. Sin errores de consola ni peticiones fallidas propias (se excluyen los prefetch RSC
   cancelados por navegación, que son comportamiento normal del App Router).
6. Acuse con motivo obligatorio y su transición a «Reconocido».
7. Verificación sobre un problema que persiste: **el caso no se cierra**, comprobado sobre el
   estado persistido tras recargar, no sobre el toast.

**No cubiertos en navegador** (brecha explícita, no se declaran como PASS):

- Repartir una línea de factura QA `6 + 4` y observar ambas líneas de OC.
- Intento de `6 + 5` y de envío con fingerprint obsoleto.
- Inspección de la proyección para los casos directo y vía oficina.
- Repetición del recorrido con un usuario de faena restringida.
- Identidad de variante concreta y desbordes responsivos.

La cobertura automatizada de esos puntos existe a nivel de servicio y componente
(`invoice-line-allocations*`, `stock-availability*`, `operational-integrity-ledger`), pero no
equivale a verificación de UI autenticada.

## 5. Fallos ajenos a esta rama

1. `lib/__tests__/emergency-resource-catalog.test.ts` — **fallo ambiental, no del código.**
   Lee `INVENTARIO DE EXTINTORES FAENA BIODIVERSA 2026.xlsx`, que está en `.gitignore` y sólo
   existe en el checkout principal, así que falla en cualquier worktree. Comprobado: copiando
   el archivo al worktree, el test pasa 7/7.
2. `lib/__tests__/pdtp-constancias.test.ts` — «no ofrece deuda de un período anterior a la
   activación del programa» falla en `main`. El arreglo existe (`d7d7508a`) pero vive en
   `fix/conciliacion-unidad-documental` y aún no ha llegado a `main`; entrará con esa rama.

Ninguno toca compras, stock ni integridad, y la rama no modifica ningún archivo de
prevención.

## 6. Numeración de migraciones (resuelto)

`main` había ocupado los mismos índices que la rama:

| idx | Rama (original) | `main` |
|---|---|---|
| 261 | `0261_mixed_mordo` | `0261_mushy_punisher` |
| 262 | `0262_kind_mastermind` | `0263_pantalon_letter_scale` |

**Cómo se resolvió.** Renombrar no bastaba: los snapshots de la rama se habían generado sin
los cambios de `main`, así que la siguiente `db:generate` habría calculado un diff sobre un
estado de esquema falso. En vez de renumerar a mano se adoptó la cadena de `main` y se
regeneró la migración con Drizzle sobre ella, quedando una sola migración
`0264_eminent_shiver_man` (idx 263).

Dos cosas hubo que reponer a mano sobre lo que generó Drizzle:

1. **El backfill 1:1 → N:N**, que es un `INSERT` de datos y ningún generador de esquema
   reproduce. Es idempotente (`ON CONFLICT DO NOTHING`).
2. **El orden de dos sentencias.** El índice único `(case_id, id)` de las observaciones debe
   crearse *antes* de la FK compuesta que lo referencia. Como migraciones separadas el orden
   era implícito; consolidadas, PostgreSQL rechaza la FK con
   `there is no unique constraint matching given keys` (42830). Verificado aplicando desde
   una base vacía.

Nota sobre `main`: su journal llega al idx 262 pero sus snapshots sólo al 0261, porque
`0263_pantalon_letter_scale` es un `UPDATE` de datos sin DDL. No es un defecto —el estado de
esquema sigue siendo el del 0261— pero conviene saberlo antes de generar migraciones.

## 7. Rollback

El orden es obligatorio:

1. **Primero** deshabilitar las escrituras N:N nuevas.
2. Si alguna línea de factura tiene más de una asignación, la versión anterior **la mostrará
   como no vinculada**, y hace falta remediación manual antes de declarar compatibilidad
   completa de rollback.
3. Recién entonces revertir el esquema.

El conteo de líneas con más de una asignación (§3) es el que decide si el paso 2 aplica. En
producción debe leerse **antes** de iniciar el rollback, no después.

## 8. Auditoría exploratoria

`audit:full` **sigue ausente** de `package.json`. Siguiendo el plan, no se creó como parte de
este alcance: queda registrada la **auditoría exploratoria completa pendiente**. El archivo
`qa/reports/latest.md` existe pero corresponde a una corrida anterior y no cubre este trabajo.
Los resultados E2E y de navegador de §4 son evidencia separada y no equivalente.

## 9. Decisión de release

Integrada en `main` con el gate completo en verde sobre el resultado mergeado. Antes de
**desplegar a producción** falta:

1. Leer el conteo de asignaciones múltiples contra producción (§3, §7), del que depende la
   compatibilidad de rollback.
2. Ejecutar el backfill sobre datos reales y volver a correr `db:verify-invoice-allocations`:
   los conteos en cero de §2 provienen de una base limpia, no de un volcado productivo.
3. Cubrir en navegador los escenarios pendientes de §4.
4. Aceptar explícitamente la brecha de `audit:full` (§8) o esperar la restauración del harness.

Una build local verde no equivale a despliegue ni a UAT de producción.
