# Integración de la ola 3: T7a y T6 (2026-09-27)

Rama local `prevencion/integracion-ola3` sobre la ola 2 (`84fa1e35`). Sin push.

| Rama integrada | Contenido | Informe |
|---|---|---|
| `prevencion/t7a-integridad` | Borrado restringido de ejecuciones, desvíos y cierres; índices nuevos (migración 0333); guardas al borrar programas y lotes; ventana de acuse de permisos; GC de evidencia agendado en modo de prueba; respaldos que verifican el storage | [T7a](2026-09-26-prevencion-t7a.md) |
| `prevencion/t6-revision` | Ventanas por versión (una v1 reemplazada acepta sus propias semanas), año consolidado en los tableros, traspaso de desvíos y asignaciones al activar, casillas sobrantes tras una v+1 y avisos de los pasos posteriores a la activación | [T6](2026-09-26-prevencion-t6.md) |

## Ajustes hechos al integrar

- **`prevention-permits-postgres`:** la prueba "lists every blocker at once" esperaba cuatro bloqueadores y la preparación del permiso devuelve cinco, porque desde PER-001 (`b8c16c2ac`) también exige el acuse de la cuadrilla. Verifiqué que ya fallaba en la base de la ola 2, antes de T7a. La suite se omite por defecto y nadie lo vio. Se actualizó la expectativa: 22/22 contra Postgres real.
- **`pdtp-year-copy.test.ts`:** un caso nuevo de T6 deja desvíos, y la limpieza del `beforeEach` chocaba con el borrado restringido que agrega T7a (error `23001`). Se agregó la limpieza de cierres, desvíos y ejecuciones antes de borrar actividades.
- Solo chocó `qa/reports/latest.md`, dos veces.

## Verificación de la rama integrada

| Puerta | Resultado |
|---|---|
| `npm run typecheck` / `npm run lint` | PASS |
| `db:generate` / cadena | Sin cambios pendientes / 334 entradas hasta 0333 |
| `npm run test:fast` | 774 archivos / **10.089 pruebas PASS**, 32 archivos omitidos (`*-postgres`) |
| `npm run test:pglite` | 212 archivos / **2.594 pruebas PASS** (tras el ajuste de `pdtp-year-copy`) |
| `prevention-permits-postgres` contra `:55432` | 22/22 PASS |
| E2E `pdtp-*` + `prevencion-*` contra un servidor aislado reconstruido (puerto 3100, base desechable) | **167 PASS, 1 omitida** (la condicional de `pdtp-habilitacion:98`) |

**Sin recorrer:**
- `npm run test:e2e` completo, las demás suites `*-postgres` y `npm run doctor`.
- EXPLAIN y duración de la migración 0333 sobre datos reales: la validación de claves foráneas y la creación de índices corren dentro de la transacción.
- El GC y los respaldos en el contenedor real.
- Una v+1 real sobre una copia del programa 2026.
