# QA — Integridad operacional de compras y stock

**Rama:** `feat/integridad-operacional-compras-stock`
**Fecha de la corrida:** 2026-09-09
**Alcance:** Tasks 1–7 del plan `docs/superpowers/plans/2026-09-08-integridad-operacional-compras-stock.md`

## 1. Estado de la entrega

Las siete tareas del plan están implementadas. **La entrega no es candidata a release
todavía**: hay un conflicto de numeración de migraciones con `main` descrito en §6, que
debe resolverse antes de integrar.

## 2. Resultados exactos de los comandos

Ejecutados secuencialmente en el worktree de la rama.

| Comando | Resultado |
|---|---|
| `npm run db:generate` | `No schema changes, nothing to migrate` — exit 0 |
| `npm run db:verify-migrations` | `verified 263 entries through 0262_kind_mastermind` — exit 0 |
| `npm run db:verify-invoice-allocations` | los cinco conteos en 0 — exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test:fast` | 639 archivos OK, **1 fallo ajeno** (§5) — exit 1 |
| `npm run test:pglite` | 120 archivos OK, **1 fallo ajeno** (§5) — exit 1 |
| Concurrencia real (`invoice-line-allocations-concurrency-postgres`) | 1 test, exit 0, contra PostgreSQL 16 desechable |
| `npm run perf:queries` | 12 consultas bajo el presupuesto de 1000 ms — exit 0 |
| `npm run build` | exit 0 (requiere `DATABASE_URL` definido) |
| `npm run test:e2e -- e2e/operational-integrity.spec.ts` | 2 tests, exit 0 |

La consulta nueva de disponibilidad proyectada rinde **19,8 ms** sobre el dataset mediano
(1200 solicitudes, 3600 ítems, 500 OC, 600 filas de stock), dentro del mismo presupuesto de
un segundo que el resto. No se creó un segundo harness de performance.

## 3. Migraciones y datos

- **Tags de la rama:** `0261_mixed_mordo`, `0262_kind_mastermind`.
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

Ambos reproducen en `main` sin los cambios de la rama:

1. `lib/__tests__/emergency-resource-catalog.test.ts` — lee
   `INVENTARIO DE EXTINTORES FAENA BIODIVERSA 2026.xlsx`, que **no está versionado**. Falla en
   cualquier worktree porque el archivo sólo existe en el checkout principal.
2. `lib/__tests__/pdtp-constancias.test.ts` — «no ofrece deuda de un período anterior a la
   activación del programa» falla igualmente en `main`.

Ninguno toca compras, stock ni integridad.

## 6. Brecha bloqueante: numeración de migraciones

`main` avanzó **33 commits** desde que la rama se separó y ocupó los mismos índices:

| idx | Rama | `main` |
|---|---|---|
| 261 | `0261_mixed_mordo` | `0261_mushy_punisher` |
| 262 | `0262_kind_mastermind` | `0263_pantalon_letter_scale` |

`db:verify-migrations` pasa dentro de la rama porque sólo ve su propia cadena; el choque
aparece al integrar. Antes del merge hay que **renumerar las dos migraciones de la rama por
encima de la última de `main`** y regenerar el journal, como se hizo en
`fix(db): renumera migraciones de la matriz de riesgos a 0235`.

Mientras tanto, cualquier base migrada desde `main` **no tiene** las tablas de esta rama.

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

**No liberar todavía.** Falta, en orden:

1. Renumerar las migraciones (§6).
2. Rebasar o integrar con los 33 commits de `main` y volver a correr el gate completo.
3. Leer el conteo de asignaciones múltiples contra producción (§3, §7).
4. Aceptar explícitamente la brecha de `audit:full` (§8) o esperar la restauración del harness.

Una build local verde no equivale a despliegue ni a UAT de producción.
