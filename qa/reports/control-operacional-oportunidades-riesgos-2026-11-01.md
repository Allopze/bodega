# Panel operacional — oportunidades faltantes y riesgos

Fecha: 2026-11-01
Alcance: cierre de los riesgos abiertos de la auditoría `auditoria-cambios-panel-2026-11-01.md` y de los deferidos de la Fase 6. No se modificó producción ni se ejecutó una base destructiva.

## Cambios aplicados

### Densidad de la tabla

La tabla de activos pasó a un conjunto de columnas clave por defecto y el resto disponible en el selector «Columnas» del `DataTable`:

- visibles por defecto: código, activo, faena, estado, próximo vencimiento, discrepancia GPS, litros, rendimiento promedio, cargas marcadas, casos abiertos, motor en vacío, OT abiertas, SLA vencido, hallazgos abiertos, CAPA vencidas, costo de combustible, costo aprobado y acción;
- ocultas por defecto: sin responsable, próximo plan, inspecciones, cumplimiento de inspecciones, detención y litros en vacío;
- la primera columna queda fija (`stickyFirstColumn`) y la vista se persiste en la URL (`viewKey="control-operacional-activos"`), con `router.replace(..., { scroll: false })`;
- la tarjeta móvil y el Excel conservan todas las dimensiones; las columnas ocultas no se pierden, sólo se pliegan en escritorio.

Esto reduce el ancho inicial sin esconder datos: el usuario que necesita una dimensión la enciende una vez y la preferencia sobrevive la navegación.

### Degradación visible

`getOperationalControlHub` devuelve `degradedSources` cuando fallan documentos de flota, ajustes, telemetría GPS u OT abiertas. La página muestra `DegradedDataBanner` («N de 4 fuentes») y la hoja «Indicadores» del Excel agrega una fila «Secciones no cargadas». Antes, una falla de documentos dejaba `nextExpiryDate` vacío sin distinguirlo de «sin documentos».

### Etiquetas y semántica

- Conciliación: el texto dice «Conciliación (hoy)»; los conteos son del estado actual, no del período.
- Cargas: la columna y el Excel dicen «Cargas marcadas (período)»; el tile global sigue diciendo «Cargas por decidir».
- CAPA: el glosario aclara que una CAPA vencida se cuenta aunque el hallazgo de origen ya esté cerrado; la acción sigue pendiente.
- Rendimiento: se conserva el promedio canónico de cargas válidas de `getEquipmentStats`/ficha del equipo y se rotula «Rendimiento promedio»; el glosario dice expresamente que no es una eficiencia ponderada por litros. Ponderarlo requeriría cambiar todo el módulo de combustible y es una decisión de producto, no un cambio local del panel.

### Fase 6: motor en vacío y discrepancia GPS

- `getAssetFuelSummary` agrega `operatingHours`, `idleHours`, `idlePct` y `litersIdle` desde `dailyTelemetry`, en una consulta agrupada por vehículo.
- Agrega `lastMeterReading`, `lastMeterType` y `lastMeterAt` desde la última carga contable con lectura.
- El hub marca `meterMismatch` cuando la lectura de la última carga y la telemetría del mismo medidor difieren más de 2 h (horómetro) o 5 km (odómetro), con lecturas a menos de 7 días.
- La tarjeta móvil muestra «Motor en vacío» y el aviso «Lectura GPS vs carga»; el Excel agrega «Motor en vacío (%)», «Litros en vacío» y «Discrepancia GPS».

## Archivos principales

- `app/(app)/control-operacional/operational-assets-table.tsx`
- `app/(app)/control-operacional/page.tsx`
- `app/(app)/control-operacional/actions.ts`
- `app/(app)/control-operacional/performance-stats.ts`
- `lib/services/operational-control.ts`
- `lib/combustibles/control/queries/asset-fuel-summary.ts`
- `lib/operational-control/export-columns.ts`
- `e2e/control-operacional-combustible.spec.ts`
- pruebas PGlite de combustible y documentos/GPS, y pruebas de columnas de exportación.

## Verificación ejecutada

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | pasa |
| `npm run lint` | pasa |
| `git diff --check` | pasa |
| PGlite focalizado (`operational-control-fuel`, `operational-control-documents-gps`) | 9/9 |
| No-PGlite focalizado (export columns/action, hub attention, performance stats, attention tiles, capabilities) | 73/73 |
| E2E del panel (`control-operacional-combustible`, `control-operacional-navegacion`) | 30/30 |
| Reflow de pantallas densas, incluido `/control-operacional`, a 320/375/390/768/1024/1440 px | 15/15 |

Las pruebas PGlite cubren: promedio canónico de cargas, motor en vacío, última lectura, discrepancia GPS, alcance por faena y permisos de costo. El E2E del panel se ejecutó con una base `chome_e2e_panel_*` creada para esta revisión y eliminada al terminar. Tres fallos iniciales eran de expectativa del test, no del panel: la fila del admin está en la página 2 (se resolvió con la búsqueda del TopBar), los encabezados ordenables se anuncian «Ordenar por …», y la ruta legacy de importación abre un diálogo que vuelve inerte el sidebar (se cierra antes de comprobar el ítem activo).

## No verificado

- **Comparación de valores contra `/combustibles/consumo/equipos/[id]`, `/flota` y Prevención**: el E2E verifica que la fila y los enlaces del panel existen y que el rol sin costos no ve montos; no compara el mismo vehículo/período contra las otras pantallas.
- **Costo/tiempo de las consultas nuevas**: se agregaron dos consultas agrupadas (última lectura e inactividad) además de las siete fuentes; no se midió el tiempo de respuesta ni el plan de ejecución.
- **`npm run test:fast`**: sigue bloqueado por `React.act is not a function` en pruebas de componentes ajenas al panel.

## Riesgos que permanecen

1. El «Rendimiento promedio» es el promedio de cargas, no una eficiencia ponderada. Está rotulado y glosado, pero sigue siendo una definición que puede sorprender al comparar períodos con distinta mezcla de cargas.
2. `meterMismatch` es una heurística (7 días, 2 h / 5 km); no distingue un medidor reemplazado de una lectura mal digitada. Es una señal para revisar, no un veredicto.
3. La consulta de inactividad recorre `fuel_telemetry_daily` para todos los activos del alcance. Falta medir con volumen real; si no cumple, el motor en vacío debe quedarse sólo en la ficha del equipo.
4. `fuel_anomaly_cases.vehicle_id` sigue sin índice dedicado. No se agregó una migración sin evidencia de volumen.
5. El selector de columnas es la única forma de recuperar las dimensiones ocultas en escritorio; la tarjeta móvil y el Excel las muestran siempre.
