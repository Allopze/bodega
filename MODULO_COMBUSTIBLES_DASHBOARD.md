# Módulo Combustibles — Dashboard de consumos por patente

Rediseño del módulo `combustibles`: agrega un **dashboard de análisis de
consumos por patente** (tarjetas de combustible, no facturas) como vista
principal, con su propio flujo de importación XLSX. El control de facturas
existente (IEC/IVA, proveedores, cuenta corriente) **no se eliminó** — se
relocalizó a `/combustibles/facturas` porque contiene datos financieros
reales y un cron (`/api/cron/fuel-statement-notifications`) depende de él.

## Qué cambió

- **Nuevo dashboard principal** (`/combustibles`): KPIs, gráficos, filtros,
  alertas y una tabla de detalle subordinada, construidos sobre un dataset
  nuevo de **consumo por patente y periodo** (no factura por factura).
- **Nueva importación** (`/combustibles/importar`): asistente de 3 pasos
  (metadatos + archivo → previsualización/validación → confirmación),
  historial de lotes y reversión.
- **Facturas relocalizadas** a `/combustibles/facturas` (sin cambios de
  comportamiento; solo cambió la ruta y quedó fuera del menú principal).
- **Registro de vehículos** (`fuel_vehicles`, patentes) sin cambios — los
  consumos importados se cruzan contra él por patente.

## Rutas y pantallas

| Ruta | Descripción | Permiso |
|---|---|---|
| `/combustibles` | Dashboard de consumos (KPIs, gráficos, alertas, detalle) | `combustibles:view` |
| `/combustibles/importar` | Asistente de importación + historial de lotes | `combustibles:import` |
| `/combustibles/importar/[id]` | Detalle de un lote: registros, patentes sin asociar, revertir | `combustibles:import` (ver) / `combustibles:manage_vehicles` (vincular) / `combustibles:revert` (revertir) |
| `/combustibles/facturas` | Control de facturas (IEC/IVA, cuenta corriente) — relocalizado, sin cambios de lógica | `combustibles:view` |
| `/combustibles/vehiculos`, `/proveedores-combustible`, `/cuenta-corriente`, `/reportes`, `/nueva`, `/[id]` | Sin cambios | (sin cambios) |

## Permisos

Se agregó **un** permiso nuevo, `combustibles:revert`. El resto del flujo de
importación reutiliza `combustibles:import` (subir/previsualizar/confirmar es
un solo wizard). Ver `modules/combustibles/manifest.ts`.

| Permiso | Uso |
|---|---|
| `combustibles:view` | Ver el dashboard de consumos y facturas |
| `combustibles:import` | Ver/usar el asistente de importación de consumos |
| `combustibles:revert` | Revertir un lote de importación de consumos |
| `combustibles:manage_vehicles` | Vincular patentes sin asociar a un vehículo |
| `combustibles:export`, `combustibles:create`, `combustibles:delete`, `combustibles:manage_suppliers` | Sin cambios (facturas) |

`admin_contrato` (Administrador de contrato) recibió `combustibles:import` y
`combustibles:revert` por defecto, además de `combustibles:manage_vehicles`
que ya tenía. Tras cambiar el manifest se corrió `npm run db:sync-rbac`
(no `db:seed`, que no toca RBAC en este proyecto).

Todas las validaciones de permiso y de faena (`canAccessWorksite`) ocurren en
las server actions, nunca solo en el cliente.

## Cómo importar

1. Entrar a `/combustibles/importar` (requiere `combustibles:import`).
2. Elegir faena, periodo (desde/hasta) y fuente, y subir un archivo `.xlsx`.
3. El sistema lo parsea **en el servidor** (nunca se confía en filas armadas
   por el navegador) y muestra una previsualización con: filas válidas,
   filas rechazadas (con motivo por fila), duplicados dentro del archivo,
   patentes con/sin vehículo asociado, y avisos si el archivo o el lote
   (faena+periodo+fuente) ya fueron importados antes (por hash SHA-256 y por
   combinación de campos).
4. Confirmar: se persiste el archivo original en `storage/imports/` (con su
   hash) para trazabilidad, se crea el lote (`fuel_import_batches`) y sus
   registros (`fuel_consumption_records`), se cruza cada patente contra
   `fuel_vehicles.plate`, y se registra auditoría (`recordAudit`).
5. Desde el detalle del lote se pueden vincular manualmente las patentes que
   no matchearon ningún vehículo, o revertir el lote completo (borra sus
   registros del dashboard; el archivo y el historial se conservan).

## Campos que acepta la importación

Solo `.xlsx` (no CSV, por convención del proyecto — ver `AGENTS.md`).
Encabezados tolerantes a variaciones menores (mayúsculas/tildes/espacios).

| Columna | Campo interno | Tipo | Notas |
|---|---|---|---|
| Patente | `patente` | texto | `trim` + mayúsculas, obligatorio |
| N° Tarjetas | `numeroTarjetas` | entero ≥ 0 | |
| N° Transacciones | `numeroTransacciones` | entero ≥ 0 | |
| Cantidad (Unidad) | `cantidadUnidad` | decimal ≥ 0 | soporta coma decimal chilena |
| Monto ($) | `monto` | decimal ≥ 0 | soporta miles con `.` y decimales con `,` |
| Rendimiento Promedio | `rendimientoPromedio` | decimal ≥ 0 | |

Metadatos del lote (declarados una vez por importación, no por fila):
faena, periodo (desde/hasta), fuente, notas, usuario y fecha de importación,
archivo original + hash.

## Cómo se calculan las métricas

Centralizado en `lib/combustibles/consumption-calculations.ts` (con guardas
contra división por cero):

```
precio_promedio_unidad   = monto / cantidad                (null si cantidad = 0)
rendimiento_ponderado     = Σ(rendimiento × cantidad) / Σcantidad
variacion_periodo         = (actual − anterior) / anterior  (null si anterior = 0 o falta)
```

`lib/combustibles/consumption-dashboard.ts` arma el dashboard completo:
KPIs, series por periodo, rankings por patente (consumo, gasto,
transacciones), rendimiento por patente (marcando atípicos por desviación
estándar) y alertas derivadas.

## Pruebas agregadas

- `lib/combustibles/__tests__/consumption-import.test.ts` — parser: fila
  válida, patente vacía, negativos, duplicados en archivo, alias de
  encabezados, archivo corrupto, filas vacías.
- `lib/combustibles/__tests__/consumption-calculations.test.ts` — precio
  promedio con guarda de división por cero, rendimiento ponderado,
  variación, totales de lote.
- `app/(app)/combustibles/__tests__/actions-consumos.test.ts` — importación
  válida con match de vehículo, patente sin match, rechazo por duplicado de
  archivo, confirmación explícita de duplicado, rechazo de archivo no-XLSX,
  rechazo de periodo inválido, previsualización sin persistir datos.
- `lib/__tests__/auth-bootstrap-permissions.test.ts` — parity existente,
  recoge automáticamente `combustibles:revert`.
- `e2e/combustibles.spec.ts` — actualizado: dashboard de consumos en
  `/combustibles`, facturas en `/combustibles/facturas`, página de
  importación.

## Limitaciones y mejoras futuras

- No hay tabla de errores por fila persistida (`fuel_import_errors`): los
  errores de validación se muestran en la previsualización y no se guardan
  filas rechazadas. Agregar la tabla si se necesita auditoría exhaustiva de
  rechazos históricos.
- Los estados de lote son solo `importado` / `revertido` (no
  `borrador`/`validado`/`rechazado`), porque la validación ocurre antes de
  persistir, en la previsualización.
- El umbral de "rendimiento atípico" (1.5 desviaciones estándar) y de
  "variación fuerte" (30%) están fijos en código
  (`consumption-dashboard.ts`), no son configurables desde la UI.
- No hay caché/materialización de agregados: el dashboard recalcula todo en
  cada carga. Revisar si el volumen de datos lo justifica más adelante.
- Solo XLSX (sin CSV), por convención del proyecto.
