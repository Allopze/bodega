# Traslado de equipos entre faenas y recorrido por faena

Fecha: 2026-11-18. Estado: borrador para aprobación.

## Para qué

Gerencia decide de vez en cuando mover equipos (uno o varios) de una faena a
otra. Hoy nadie registra eso en la plataforma: los cambios viven en planillas
dispersas (`INVENTARIO_EQUIPOS_ACTUALIZADO_FAENAS_10-2026.xlsx`,
`Base_Equipos_por_Faena_Nov2026.xlsx`, …) y los equipos pierden trazabilidad por
el camino. El objetivo es que **la plataforma sea el registro oficial de dónde
está cada equipo y desde cuándo**, y dejar de usar la planilla para esto.

Mover varios a la vez es el medio, no el fin: si registrar un traslado es más
lento que editar la planilla, la gente no deja la planilla.

## Qué se construye

1. **Registrar un traslado** de uno o varios equipos a una faena, con la fecha
   real en que ocurrió, el motivo y quién lo autorizó.
2. **El recorrido de cada equipo**: en qué faena estuvo, desde qué día y hasta
   qué día, con quién registró cada cambio y de dónde salió el dato.
3. **Reportes por faena correctos en el tiempo**: lo que pasó con un equipo en
   un período (consumo, días fuera de servicio, uso GPS…) cuenta en la faena
   donde estaba ESE día, no en la faena donde está hoy (opción elegida por el
   usuario: «la 2»).
4. **Reconstrucción del pasado**: el recorrido se reconstruye hacia atrás hasta
   donde la evidencia lo permita con seguridad (palabras del usuario: «desde
   donde esté seguro que se pueda realizar»).

## Metas, no-metas, anti-metas

Metas

- Un traslado de 1 a ~20 equipos se registra en un solo paso, en menos de un
  minuto.
- Cada cambio de faena de un equipo queda con fecha, origen, destino, motivo,
  quién lo autorizó y quién lo registró.
- Los reportes listados en § Reportes reparten por la faena del día.

No-metas

- Traslados planificados a futuro (fecha posterior a hoy). Se registra lo que
  ya ocurrió.
- Aprobación en dos pasos (alguien pide, Gerencia aprueba). Gerencia decide
  fuera de la plataforma; aquí se registra la decisión.
- Notificaciones o correos por traslado.
- Cargar ahora las faenas de la planilla de noviembre de Alexis: eso se hará
  como primer uso real de la pantalla nueva, no por script.

Anti-metas (si pasa esto, fracasó aunque funcione)

- Que quede **otra** forma de cambiar la faena de un equipo que no deje
  recorrido: el recorrido dejaría de ser confiable y la planilla volvería.
- Que el historial reconstruido **invente** fechas: un traslado reconstruido
  sin evidencia suficiente se presenta como dudoso y lo confirma una persona.
- Que un traslado reescriba lo que una persona registró en terreno (una carga
  anotada en Santa Fe sigue siendo de Santa Fe).

## Lo que ya existe y condiciona el diseño

- `fuel_vehicles.worksite_id` es la faena ACTUAL y la usan ~76 lugares para
  alcance, formularios y estado actual. Se conserva tal cual, como espejo de la
  estadía abierta.
- Hoy la faena cambia por cinco caminos, todos sin recorrido:
  1. edición del padrón (`updateFuelVehicleAction`,
     `app/(app)/combustibles/actions-module/vehicles.ts`), usada desde
     `/admin/flota-catalogos/vehiculos` y la cabecera de `/flota/[id]`;
  2. importación del padrón (mismo archivo, ~l. 591);
  3. «Incorporar desde la flota» en Mantención (`applyCreate`,
     `lib/services/mantencion/equipment.ts`);
  4. importación de Mantención (`applyUpdate`, mismo archivo);
  5. scripts de una vez (`seed-equipment.ts`, `apply-vencimientos-…`).
- `moveProviderMappingsWithVehicleTx` (`lib/combustibles/provider-mappings.ts`)
  ya versiona las asignaciones Copec/Aramco cuando un vehículo cambia de faena y
  **ya acepta `effectiveFrom`**, aunque ningún caller lo pasa.
- Las tablas GPS (`fleet_gps_latest_positions`, `_position_history`, `_trips`,
  `_alerts`) tienen una FK compuesta `(vehicle_id, worksite_id) →
  fuel_vehicles(id, worksite_id)` con `ON UPDATE CASCADE`: mover un equipo
  reescribe la faena de **todo** su historial GPS.
- Ya guardan su propia faena fijada al momento del evento (no requieren
  cambio): `fuel_loads`, `fuel_consumption_records`, `fuel_equipment_loads`,
  `fuel_tae_submissions`, `fuel_cycle_movements`, `mant_records`,
  `mant_work_orders`, `purchase_requests`, `purchase_orders`.
- No tienen faena: `fuel_telemetry_daily`, `fuel_meter_readings`,
  `fuel_vehicle_operational_intervals`.
- Precedente de intervalos: `fuel_vehicle_operational_intervals` (un solo
  intervalo abierto por vehículo, índice único parcial).
- Precedente de UI: «Asignar equipos» de las pautas
  (`components/mantencion/jefatura/pautas/assign-equipment-dialog.tsx` y
  `assign-equipment-list.tsx`): modal, equipos agrupados por faena, casilla por
  grupo, efecto por fila, resumen al pie, el servidor recalcula.
- Precedente de anulación con motivo: `deliveries` y `fleet_vehicle_documents`
  (motivo ≥ 10 caracteres, responsable y fecha, los tres juntos).
- Precedente de carga de una vez: `apply-vencimientos-planilla-2026-11.ts`
  (dry-run, auditoría, `--apply`).

## Enfoques considerados

Para la pantalla:

| Enfoque | A favor | En contra |
| --- | --- | --- |
| **Botón «Trasladar equipos» → modal** (elegido) | Copia un patrón que el equipo ya usa (Asignar equipos de pautas); sirve igual para 1 o 20; casilla por faena para vaciar una faena entera; funciona en teléfono | Un componente nuevo (modal) |
| Casillas en la lista de `/flota` + «Cambiar de faena» | Familiar | La lista está paginada de a 25 en servidor: juntar equipos de varias páginas o faenas obliga a filtrar y paginar |
| Tablero por faena con arrastrar | Muy visual | 10 faenas × ~160 equipos = scroll horizontal; no sirve en teléfono; arrastrar no es accesible con teclado; librería nueva; cada soltada igual pide fecha y motivo |

Para el alcance de reportes: «sólo recorrido + lista de traslados» (reportes
como hoy) contra «además reportes por faena del día». **El usuario eligió la
segunda.**

Para el pasado: «desde hoy» contra «reconstruir desde agosto con planillas»
contra «otra fecha». **El usuario eligió: hasta donde la evidencia lo
permita con seguridad.**

## Diseño

### Modelo de datos

Tres tablas nuevas (nombres orientativos; el builder ajusta a convenciones):

- **`fleet_transfers`** (el traslado, la decisión):
  folio correlativo legible (p. ej. `TR-0001`), `effective_date` (fecha civil
  `YYYY-MM-DD`, texto como `fuel_provider_mappings.effective_from`),
  `to_worksite_id`, `reason` (obligatorio, ≥ 10 caracteres), `authorized_by`
  (texto obligatorio: quién de Gerencia lo decidió; puede no ser usuario de la
  plataforma), `created_by`, `created_at`, y anulación con el contrato de
  `deliveries` (`voided_at`, `voided_by`, `void_reason` ≥ 10, los tres juntos o
  ninguno).
- **`fleet_transfer_items`**: `transfer_id`, `vehicle_id`, `from_worksite_id`.
  Único por (traslado, vehículo).
- **`fuel_vehicle_worksite_intervals`** (el recorrido): `vehicle_id`,
  `worksite_id`, `started_on`, `ended_on` (nulo = estadía actual), `source`
  (`alta` | `traslado` | `reconstruccion`), `transfer_id` (nulo salvo
  `traslado`), y para `reconstruccion` una nota de evidencia legible (qué
  registros la sostienen). Una sola estadía abierta por vehículo (índice único
  parcial, como `fuel_vehicle_operational_intervals`); sin solapes ni huecos
  entre la primera estadía y hoy.

Invariante: **`fuel_vehicles.worksite_id` = faena de la estadía abierta**,
siempre, desde el deploy. Lo garantiza la base, no sólo una convención (mi
decisión, ver «Una sola puerta»).

Convención de bordes (mi decisión): `started_on` inclusivo, `ended_on` = día
anterior al `started_on` de la estadía siguiente (inclusivo). El día del
traslado ya cuenta en la faena nueva, igual que `effectiveFrom` de las
asignaciones de proveedor.

**La primera estadía de cada equipo no tiene inicio** (`started_on` nulo =
«desde siempre»), mi decisión. La fecha de alta no sirve como inicio: buena
parte de la flota de producción se sembró el 2026-11-13 y tiene cargas,
telemetría y registros de meses antes. Con inicio abierto, ningún dato antiguo
queda sin estadía y se cae de un reporte. Consecuencias:

- La migración crea, para cada vehículo existente, **una estadía abierta y sin
  inicio** en su faena actual. Al desplegar, todos los reportes dan
  exactamente lo mismo que hoy; sólo cambian cuando hay traslados o cuando
  corre la reconstrucción.
- Las consultas de § Reportes nunca encuentran un dato sin estadía (la primera
  la cubre hacia atrás); no hace falta respaldo a la faena actual.

### Una sola puerta para cambiar de faena

Un servicio único (p. ej. `lib/services/fleet-transfers.ts`) es el ÚNICO código
que cambia `fuel_vehicles.worksite_id` de un vehículo existente. En una
transacción, por cada equipo:

1. cierra la estadía abierta el día anterior a `effective_date` y abre la nueva;
2. actualiza `fuel_vehicles.worksite_id`;
3. llama a `moveProviderMappingsWithVehicleTx` **con `effectiveFrom =
   effective_date`**;
4. corrige lo que se estampó solo desde esa fecha (ver § Retroactivo);
5. escribe el historial del equipo de Mantención (si tiene perfil) y una fila
   de auditoría por equipo, más una del traslado.

Todo o nada: si un equipo falla (fuera de alcance, inactivo, fecha inválida),
no se mueve ninguno y el mensaje dice cuál y por qué.

**La base hace cumplir la puerta única** (mi decisión; el revisor preguntó si
bastaba convención + prueba, y no basta: los scripts de una vez ya cambiaron
faenas con `UPDATE` directo, p. ej. `scripts/apply-fleet-copec-decisions-2026-10-29.ts:262`):

- Un trigger `AFTER INSERT` en `fuel_vehicles` abre la primera estadía (sin
  inicio, `source = alta`). Así quedan cubiertos los **ocho** lugares que hoy
  crean vehículos sin tocar ninguno: `actions-module/vehicles.ts:210` y `:603`,
  `actions-operaciones.ts:256` (autocreación desde el log de consumos),
  `app/api/combustibles/import/route.ts:227`,
  `lib/services/mantencion/equipment.ts:128`, `seed-equipment.ts:147` y dos
  scripts.
- Un trigger de restricción **diferido** (se evalúa al confirmar la
  transacción) rechaza cualquier transacción que deje
  `fuel_vehicles.worksite_id` distinto de la faena de su estadía abierta. Un
  `UPDATE` directo de la faena falla; el servicio de traslado, que mueve las
  dos cosas en la misma transacción, pasa.
- El SQL va anexado a la migración generada, idempotente, como pide
  `db/migrations/README.md`.

Los caminos que hoy CAMBIAN la faena de un equipo existente quedan así (mi
decisión, ver § Decisiones mías):

- **Edición del padrón** (`/admin/flota-catalogos/vehiculos` y cabecera de
  `/flota/[id]`): el campo Faena queda de solo lectura para equipos existentes,
  con un enlace «Trasladar» que abre el modal con ese equipo marcado. En el alta
  sigue siendo editable (el trigger abre la primera estadía).
- **Importación del padrón** e **importación de Mantención**: una fila que trae
  una faena distinta a la actual de un equipo existente se rechaza con un error
  de fila: «Para cambiar de faena usa Trasladar equipos». (El importador del
  log de consumos, `actions-operaciones.ts:~240`, sólo completa código, marca,
  modelo y año de equipos existentes: no cambia faena y no necesita regla.)
- **Incorporar desde la flota** (Mantención): si la faena elegida difiere de la
  actual, pasa por el servicio de traslado con fecha de hoy y motivo
  «Incorporación a Mantención» (autorizado por: quien incorpora).
- **Scripts de una vez**: deben usar el servicio. Se documenta en el script de
  reconstrucción y en `AGENTS.md`/README de Flota.

### Pantalla: «Trasladar equipos»

- Botón «Trasladar equipos» en `PageHeader.actions` de `/flota` y de la lista
  de traslados. También «Trasladar» desde la ficha `/flota/[id]` (abre el modal
  con ese equipo ya marcado).
- Modal (patrón Asignar equipos de pautas, con `stableHeight`):
  - arriba: **A la faena** (sólo faenas activas del alcance), **Desde el**
    (`DatePicker`, por defecto hoy, no permite futuro), **Motivo**,
    **Autorizado por**;
  - abajo: buscador propio del modal (código, patente, marca) y filtro por
    tipo; equipos activos agrupados por faena actual, con casilla por faena y
    por equipo; los equipos que ya están en la faena destino no aparecen;
  - cada fila marcada dice su efecto: «Sale de Santa Fe»; si corresponde,
    avisos que no bloquean: «Tiene la OT-… abierta en Santa Fe: la OT se queda
    en Santa Fe», «Tiene asignación Copec: pasa a Mininco desde el 15-11»;
  - aviso que **sí** bloquea, por fila: la fecha es anterior al inicio de su
    estadía actual («Llegó a Santa Fe el 02-10: la fecha no puede ser
    anterior»);
  - pie: «N equipos pasan a Mininco desde el 15-11» + Trasladar.
- Tras guardar: toast con el folio y enlace al traslado.

### Lista de traslados y recorrido

- **`/flota/traslados`** (ítem nuevo «Traslados» en el grupo Flota del menú):
  la lista de traslados (folio, fecha, destino, equipos y sus orígenes,
  motivo, autorizado por, registrado por, estado). Filtros estructurados:
  período (`PeriodControl`), faena (origen o destino). Búsqueda por la TopBar.
  «Exportar Excel» (`ExportButton`). Estado vacío con CTA «Trasladar equipos».
- **Anular** un traslado: con motivo (≥ 10), sólo si para cada equipo sigue
  siendo su último traslado; reabre la estadía anterior, devuelve
  `fuel_vehicles.worksite_id` y las asignaciones de proveedor, y deshace la
  corrección retroactiva. Para corregir una fecha: anular y registrar de nuevo.
- **Ficha del equipo** (`/flota/[id]`): sección «Recorrido por faena» con cada
  estadía (faena, desde, hasta, días), el traslado que la abrió (folio,
  motivo, autorizado/registrado por) y, si es reconstruida, el rótulo
  «Reconstruido» con su evidencia.

### Retroactivo (fecha pasada)

Regla general: **lo que registró una persona en terreno no se mueve; lo que se
estampó solo con la faena del vehículo, sí se corrige desde la fecha del
traslado.**

- No se mueven: `fuel_loads`, `fuel_equipment_loads`, `fuel_tae_submissions`,
  `mant_records`, `mant_work_orders`, solicitudes y OC.
- Se corrigen desde `effective_date`: asignaciones de proveedor (ya lo hace
  `moveProviderMappingsWithVehicleTx`), registros de consumo del proveedor
  sincronizados con la faena vieja después de esa fecha, filas GPS de ese
  vehículo posteriores a esa fecha, casos de anomalía estampados con la faena
  actual (ver § Reportes).
- Límite: la fecha no puede ser anterior al `started_on` de la estadía actual
  del equipo (no se reescribe historia detrás de otro traslado), ni posterior a
  hoy. **Ni anterior al día 1 del mes anterior** (decisión del usuario
  2026-11-18): cubre anotar tarde sin cambiar meses viejos ya revisados. Un caso
  más antiguo se corrige con el script de reconstrucción, con aprobación del
  usuario. No se usa una marca de «período cerrado» porque no hay una confiable:
  la única candidata es `fuel_provider_period_coverage` (sólo Copec, por mes,
  con estado `closed_with_issues`), que no cubre Aramco, pagos ni cuadratura.
  El `DatePicker` no ofrece días fuera de la ventana y el servidor lo valida.
- **Agregados mensuales que cruzan la fecha** (mi decisión): se usa el
  mecanismo que ya existe. Un agregado mensual de proveedor que queda con dos
  faenas pasa por el reparto por día (`lib/combustibles/copec-day-split.ts`,
  decisión del usuario del 2026-11-05) cuando hay detalle por transacción, y si
  no lo hay queda pendiente para que lo reparta una persona, como hoy
  (`provider-mappings.ts:20-30`). El traslado no inventa un reparto ni se
  bloquea por esto.

### GPS: dejar de reescribir el historial

Se reemplaza la FK compuesta con `ON UPDATE CASCADE` de las tablas GPS por una
que no arrastre la faena: cada fila GPS conserva la faena con que se ingirió,
como las cargas. La corrección retroactiva del traslado (arriba) re-estampa las
filas posteriores a la fecha. Además de la trazabilidad, evita reescribir todo
el historial de posiciones del equipo en cada traslado. El builder define la
migración (generada con `db:generate`, nunca editada a mano) y revisa los
`check` de consistencia de alcance de esas tablas y `onway-automation.ts:63`.

### Reportes que pasan a la faena del día

Inventario hecho el 2026-11-18 (agente de exploración + verificación manual de
tres casos). Cambian:

| Consulta | Pantalla | Cómo |
| --- | --- | --- |
| `lib/combustibles/consumption-dashboard.ts:347` mapa faena × equipo | `/combustibles/consumo/litros` | Agrupar por `fuel_consumption_records.worksite_id` (ya existe) |
| `lib/combustibles/control/queries/idle.ts:30` | `/combustibles/consumo/motor-en-vacio` (+Excel), Panel de combustible (eficiencia), `/flota/indicadores` (ralentí) | Telemetría del día ⋈ estadía del día |
| `lib/combustibles/control/queries/idle-comparison.ts:59` | `/combustibles/consumo/motor-en-vacio` (+Excel) | Lado cargas: `fuel_equipment_loads.worksite_id`; lado telemetría: como `idle.ts` |
| `lib/combustibles/control/queries/meter-rates.ts:85` | `/combustibles/consumo/litros`, Panel de combustible | Lectura ⋈ estadía del día de la lectura |
| `lib/services/fleet-gps-indicators.ts:175`, `:383` | `/flota/indicadores` | Viajes, alertas y lecturas ⋈ estadía del día |
| `lib/services/mantencion/indicators.ts:462` días fuera de servicio | `/mantencion/panel` | Intervalo operacional ∩ estadías: cada día cuenta en la faena de ese día |

Los filtros por faena **y por mandante** de esas consultas se aplican sobre la
faena del día, no sobre la actual.

Casos dudosos del inventario, con mi decisión:

| Caso | Decisión |
| --- | --- |
| `lib/services/fleet.ts:170, :554`, `coverage-notice-data.ts:72` totales 12 meses por equipo en `/flota` | Sin cambio: es una lista por equipo que «sigue al equipo» a propósito |
| `control/queries/asset-fuel-summary.ts:125` | Sin cambio (por equipo) |
| `control/queries/performance.ts:161`, `panel/queries.ts:263` rótulo de faena en rankings por equipo | Sin cambio: el rótulo es la faena actual del equipo; el filtro ya usa la faena de la carga |
| `anomaly-detector.ts:380` caso de anomalía sobre un envío TAE | Usar `fuel_tae_submissions.worksite_id` |
| `anomaly-detector.ts:866` saltos de medidor | Faena de la estadía del día de la lectura |
| `sources-status.ts:416`, `coverage-matrix-data.ts:104` frescura de telemetría | Sin cambio |
| `app/(app)/combustibles/actions-consumos.ts:96` importador de consumos | Reconocer la patente si el equipo estuvo en la faena del lote durante el período del lote, no sólo si está hoy |
| `lib/services/operational-control.ts:322` | El builder separa: lista actual de vehículos = faena actual; conteos del período = faena propia del evento si existe, si no estadía del día |

Alcance de quien mira: en los reportes de esta tabla, una persona con alcance
sobre Santa Fe ve lo que un equipo hizo **mientras estuvo** en Santa Fe, aunque
hoy esté en otra faena. El acceso a la ficha del equipo sigue siendo por faena
actual.

### Reconstrucción del pasado (script de una vez)

`scripts/` al estilo de `apply-vencimientos-planilla-2026-11.ts`: dry-run por
defecto que produce un Excel/MD de revisión; `--apply` escribe. Corre contra
`bodega_dev` primero y en producción sólo con autorización explícita del
usuario.

Evidencia, de más a menos fuerte:

1. **Presencia física registrada por una persona**: `fuel_loads`,
   `fuel_equipment_loads`, `fuel_tae_submissions`, `mant_records` (excluyendo
   `out_of_worksite = true`), `mant_work_orders`. Cada una dice «el equipo
   estaba en la faena F el día D».
2. **Cambios registrados**: `audit_log` de `fuel_vehicle`/`mant_equipment` con
   cambio de `worksiteId`, y el historial de equipos de Mantención.
3. **Fotos de planilla**: `INVENTARIO_EQUIPOS_ACTUALIZADO_FAENAS_10-2026.xlsx`
   (columna «FAENA ANTERIOR 21-08-2026» y la faena de octubre). Ubican al
   equipo en un mes, no en un día. Con las erratas ya conocidas (KCH-133/135/136
   cruzados, CR-31 duplicado, KA-91 ≠ CBJY-18, RR-06/07 invertidos, etc.; ver
   la memoria del proyecto), corregidas antes de usarlas.
4. **No es evidencia**: `fuel_consumption_records`/asignaciones Copec y Aramco
   (su faena viene de la misma asignación que pudo estar mal: confirmarían el
   error) ni las filas GPS (su faena es la actual por la cascada).

Reglas:

- Un cambio de faena se acepta cuando la última evidencia en la faena vieja y
  la primera en la nueva están a **7 días o menos** (mi decisión; parámetro del
  script). La fecha del traslado = primer día con evidencia en la nueva. Se
  registra como `source = reconstruccion` con su nota de evidencia, sin
  `fleet_transfers` (no hubo una decisión registrada).
- Si la ventana es mayor, o la evidencia se contradice (dos faenas el mismo
  día, salvo `out_of_worksite`), el cambio va a la lista **«Por confirmar»**
  del informe con lo que se sabe, y no se escribe hasta que el usuario dé la
  fecha.
- Antes de la primera evidencia de un equipo, su primera estadía queda sin
  inicio en la faena de esa primera evidencia, salvo que una foto de planilla
  diga otra cosa (entonces va a «Por confirmar»).
- **Orden** (mi decisión): la migración y el trigger salen primero (todos con
  una estadía sin inicio); la reconstrucción corre **antes** de habilitar el
  botón «Trasladar equipos» a los usuarios (el ítem de menú y el botón quedan
  detrás de la misma bandera o del mismo deploy siguiente). Así ningún traslado
  registrado choca con una estadía reconstruida.
- **Re-ejecutable** (mi decisión): el script sólo reescribe estadías con
  `source` `alta` o `reconstruccion`, y nunca toca un equipo que ya tenga un
  traslado registrado (`source = traslado`); a ese lo informa y lo salta.
- La estadía abierta termina coincidiendo con `fuel_vehicles.worksite_id` de
  hoy; si la evidencia más reciente contradice la faena actual de prod, va a
  «Por confirmar» y no se corrige la faena actual en este script (eso es un
  traslado y se registra por la pantalla).
- Equipos sin ninguna evidencia: una sola estadía desde el alta en su faena
  actual (lo mismo que los reportes asumen hoy).

## Permisos y navegación

- Ítem «Traslados» en el grupo Flota de `modules/flota/manifest.ts`, ruta
  `/flota/traslados`, visible con `flota:view`.
- Registrar y anular traslados (decisión del usuario 2026-11-18: «jefatura en
  general + jefe de mantención y admin»): permiso nuevo (p. ej.
  `flota:transfer`) para los roles `jefa_chome` (rótulo «Jefatura»),
  `jefe_mantencion` y `administrador`. Anular usa el mismo permiso. Además del
  permiso, quien traslada debe tener alcance sobre la faena actual de cada
  equipo **y** sobre la faena destino (como `canManageFuelVehicleWorksite`
  hoy). Los demás roles que hoy editan el padrón (secretaria, admin. de
  contrato, prevencionista de faena) dejan de poder cambiar la faena.
- Paridad: ruta, autorización de servidor, menú, `modules/permissions.ts`,
  manifest y seed (`npm run db:seed` / `db:sync-rbac`), según AGENTS.md.

## Decisiones mías (revisar al leer)

- Primera estadía sin inicio; la migración crea una por vehículo existente.
- Triggers: `AFTER INSERT` abre la primera estadía; restricción diferida
  impide que la faena actual y la estadía abierta difieran.
- Agregados mensuales que cruzan un traslado: reparto por día existente o
  pendiente, como hoy.
- La reconstrucción corre antes de habilitar el botón; re-ejecutable sin tocar
  traslados registrados.
- Anular usa el mismo permiso que registrar.
- Folio correlativo global `TR-0001`.
- Campo «Autorizado por» en texto libre obligatorio, además del motivo.
- El día del traslado cuenta en la faena nueva.
- Sin fechas futuras; sin fechas anteriores al inicio de la estadía actual
  (la ventana del mes anterior la decidió el usuario).
- Faena de solo lectura en la edición del padrón; las importaciones rechazan
  cambios de faena de equipos existentes.
- «Incorporar desde la flota» con faena distinta pasa por el servicio de
  traslado con fecha de hoy.
- GPS deja de arrastrar la faena (cambio de FK).
- Ventana de 7 días para aceptar un traslado reconstruido.
- Los casos dudosos del inventario se resuelven como dice la tabla.
- Avisos por OT abierta y asignación de proveedor: informan, no bloquean.

## Abierto (sólo el usuario)

Nada. Resuelto el 2026-11-18: quién registra (§ Permisos) y hasta cuán atrás
va la fecha (§ Retroactivo).

## Lo que queda al builder

- Nombres finales de tablas, columnas e índices; cómo garantizar sin solapes
  (restricción de exclusión o validación en servicio + prueba).
- Mecanismo exacto para re-estampar consumo de proveedor, GPS y anomalías
  posteriores a la fecha, y para deshacerlo al anular.
- Ubicación exacta de «Recorrido por faena» dentro de la ficha.
- Formato del informe de revisión del script.
- Pruebas: servicio de traslado (todo o nada, alcance, bordes de fecha,
  anulación), invariante faena actual = estadía abierta, cada consulta de
  § Reportes con un equipo que cambió a mitad del período (PGlite), y un E2E
  del modal (marcar una faena entera, trasladar, ver el recorrido en la ficha).
