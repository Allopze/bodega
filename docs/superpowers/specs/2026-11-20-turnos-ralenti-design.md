# Turnos de operación y ralentí por operador

Fecha: 2026-11-20. Estado: borrador para aprobación.

## Para qué

En Cholguán, **Patricio Panes** (administrador de contrato de Cholguán y Teno)
define los turnos de los equipos y hoy los anota en una página externa,
«Ralentí Cholguán» (un Artifact de claude.ai), que cruza esos turnos con la
telemetría de VisionLink para medir el ralentí por operador frente a una meta.
La telemetría por hora de esa página se carga a mano y los operadores se
escriben como texto libre.

Se trae esa función a la plataforma: Patricio registra los turnos aquí, la
telemetría llega sola desde la API de VisionLink y la plataforma calcula el %
de ralentí por turno, por operador y por equipo. Los resultados los usa
gerencia; el diseño no supone qué decisión toman con ellos, así que aplica el
estándar de la plataforma: los turnos se pueden editar y cada cambio queda en
la auditoría.

Referencia funcional: la página original, leída el 2026-11-20 (320 turnos del
2026-10-01 al 2026-11-19, 15 operadores, equipos GR-10, GR-11, CR-52, CR-51 y
un turno de GR-06; meta 30 %).

## Qué se construye

1. **Registro de turnos**: equipo, fecha (la del inicio), hora de inicio, hora
   de fin, operador y observación, con turnos predefinidos.
2. **Telemetría por hora** desde VisionLink: los tramos de ralentí y de trabajo
   de cada equipo, sincronizados cada noche y agrupados por hora local.
3. **Una pantalla con tres vistas**: Turnos del día, Operadores (ranking) y
   Equipos (grilla diaria, días detenidos y litros en vacío).
4. **Meta de ralentí** configurable.
5. **Marca de día «sin operación programada»** para un equipo que no trabajó
   sin estar averiado.
6. **Migración**: el historial de tramos desde 2026-10-01 y los 320 turnos de
   la página original.

## Metas, no-metas, anti-metas

Metas

- Registrar un turno toma menos tiempo que en la página original (que Patricio
  ya usa a diario: 6–9 turnos por día).
- El % de ralentí de un turno sale sin que nadie cargue telemetría.
- Turnos, ranking y grilla de equipos de esta pantalla cuadran entre sí.

No-metas (v1)

- No reemplaza Combustible › Consumo › motor en vacío: esa pantalla sigue con
  el resumen diario de VisionLink.
- Sin firma, aprobación, notificaciones ni sanciones.
- Sin planificación semanal ni rotación de turnos (se registra turno a turno).
- Sin exportación a Excel (se agrega con `ExportButton` si se pide).
- Sin GPS (OnWay/Wialon) como fuente de turnos.

Anti-metas (sería un fracaso aunque funcione)

- Que un turno con telemetría aún no llegada se vea como 0 % o como «en meta».
- Que el % de un turno no cuadre con la grilla del mismo equipo y día.
- Un registro paralelo de «fuera de servicio por avería» que contradiga el
  estado del equipo que ya usa Mantención.
- Escribir la faena de un equipo (regla de traslados: sólo
  `transferVehiclesTx`).
- Que un administrador de contrato vea o registre turnos fuera de sus faenas.

## Lo que ya existe y condiciona el diseño

- **VisionLink** (`lib/integrations/visionlink/`): cliente OAuth, sync diario
  `syncVisionLink` → `fuel_telemetry_daily` (horas de motor, ralentí, trabajo y
  litros por equipo y día), cron `fuel-visionlink-sync` a las 06:00 que
  reescribe 14 días. El equipo se cruza por `fuel_vehicles.serial_number`.
  Equipos vinculados: GR-10, GR-11, CR-51, CR-52, CR-53, TO-37. GR-06 y GR-09
  no tienen VisionLink.
- **Endpoint de tramos** (no usado aún): `GET
  /catDigital/assetOperationHistory/v2/assetOperations?makeSerialNumbers=CAT|<serie>&startDate&endDate`.
  Devuelve tramos con `startStateUtc`, `endStateUtc`, `durationSeconds` y
  `segmentType` (`idle`, `working`, `running`). Máximo 100 tramos por equipo por
  respuesta; el resto se pide con `assetOperations[].nextSegmentUrl` y luego
  `responseMetadata.nextCursor` (campo en singular; la guía de Cat lo escribe
  distinto en dos lugares). Rango de hasta 1 mes por consulta, 24 meses hacia
  atrás. Cupo: 50.000 llamadas al día y 50 por segundo.
  **Sondeo del 2026-11-20** (GR-10, día 2026-11-18, sólo lectura): 2 llamadas,
  147 tramos; ralentí 2,28 h, trabajo 5,30 h, running 0,05 h. El resumen diario
  del mismo día dice ralentí 2,40 h y trabajo 4,96 h: las dos fuentes difieren
  ~4 % en horas de motor. Script del sondeo: no versionado (scratchpad).
- **Estado operativo del equipo**: `fuel_vehicle_operational_intervals`
  (`operativo` | `mantencion` | `fuera_servicio`, con inicio y fin) vía
  `setVehicleOperationalStatus`. Lo cambian la ficha del vehículo
  (`admin:fleet_vehicles`, que `admin_contrato` tiene) y las OT de Mantención.
  El Panel de Mantención cuenta los días detenidos desde ahí.
- **Estadías por faena**: `stayWorksiteOnDaySql` da la faena de un equipo un
  día dado; las consultas de ralentí ya filtran así.
- **Personal**: `workers` (Talana) con `worksite_id` y `position`. Los 15
  operadores de la página original calzan uno a uno con trabajadores de
  «Cholguan - Arauco», cargo «Operador de maquinaria» (verificado en
  `bodega_dev`, clon de prod del 2026-11-02).
- **Zona horaria**: helpers de `lib/utils.ts` (`chileDateParts`, `chileHour`,
  `todayInChile`, `chileDayStartInstant`).
- **Interruptores de submódulo** (`lib/services/module-toggles.ts`), auditoría
  (`audit_log`), alcance por faena (`worksiteScopeSql`).

## Enfoques considerados

1. **Turnos en la plataforma + tramos de VisionLink por hora** — elegido por el
   usuario («ve con la 1»). Exacto por turno y automático; cuesta una
   sincronización nueva (~126 llamadas por noche para 6 equipos × 14 días).
2. **Repartir el total diario según las horas del turno** — descartado: si un
   equipo trabaja mañana y noche, los dos operadores quedan con el mismo %, y el
   ranking no distingue a nadie.
3. **Cargar una planilla por hora a mano** (como la página actual) — descartado:
   depende de que alguien suba el archivo cada día y la API ya entrega el dato.

## Diseño

### Reglas de cálculo (heredadas de la página original)

- **Horas de motor** = ralentí + trabajo + running.
  **% ralentí** = ralentí ÷ (ralentí + trabajo). Running cuenta como motor pero
  no entra al %.
- Un turno va de `start_hour` a `end_hour` en horas enteras; si
  `end_hour <= start_hour`, termina al día siguiente. Se registra con la fecha en
  que empieza. Inicio y fin no pueden ser iguales.
- **Estado de un turno**, en este orden:
  1. *Sin telemetría*: el equipo no tiene VisionLink (no hay serie vinculada).
  2. *Pendiente de datos*: alguna hora del turno todavía no es conocida (ver
     § Hora conocida), o el turno tiene 0 min de motor y algún día que toca
     aún no tiene confirmación del resumen diario (ver § Sin señal).
  3. *Sin señal*: 0 min de motor y el resumen diario confirmó que el equipo no
     transmitió ese día (ver § Sin señal).
  4. *Sin uso*: menos de 0,5 h de motor.
  5. *Sin dato de ralentí*: hay motor pero ralentí + trabajo = 0.
  6. *Sobre meta*: % > meta. 7. *En meta*: el resto.
- **Qué significa que cuadren** (meta y anti-meta): todas las cifras de la
  pantalla salen de sumar las mismas filas por hora con una sola función. Para
  un equipo y un día, las horas del día cubiertas por turnos más las horas sin
  turno dan el total del día, en minutos de ralentí, trabajo y running. Un
  turno no tiene por qué dar el mismo % que la celda del día: cubre otras horas.
  Una prueba PGlite verifica esa identidad, incluido un turno nocturno que se
  reparte entre dos días.
- **Ranking de operadores**: % ponderado por horas (Σ ralentí ÷ Σ (ralentí +
  trabajo)) sólo con turnos *En meta* o *Sobre meta*; los demás se cuentan en
  sus columnas (turnos, pendientes) pero no mueven el %. Orden: menor % primero;
  los operadores sin % van al final, sin número de ranking.
- **Equipo-día** (grilla): el día calendario completo 00–24 h, con o sin turno.
  Se avisa «N h de motor sin turno» cuando hay ≥ 1 h de motor fuera de los
  turnos registrados, salvo que el equipo esté en mantención o fuera de
  servicio ese día.
- **Meta por defecto: 30 %.**
- Todo lo de esta pantalla (turnos, ranking, grilla) usa los tramos. Los litros
  en vacío vienen del resumen diario (`fuel_telemetry_daily.liters_idle`), que
  es por día y no se reparte por turno; la pantalla dice de dónde sale cada
  cifra.

### Hora conocida (cero ≠ falta)

Una hora sin tramos puede ser motor apagado o telemetría que aún no llega. La
sincronización deja constancia, por equipo y día, de cuándo se consultó. Una
hora es **conocida** si se consultó después de que esa hora terminó más un
margen de **1 h** (constante en un solo lugar). Medido el 2026-11-20: el último
tramo de GR-11 llegó con ~15 min de retraso. Hora conocida sin tramos = 0 min
de motor. Hora no conocida = el turno queda *Pendiente de datos*. Como el cron
reescribe 14 días, un dato que VisionLink corrige después se refleja en la
siguiente corrida.

### Sin señal (equipo detenido ≠ equipo que no transmite)

Los tramos sólo existen con el motor encendido, así que no distinguen un equipo
estacionado de uno que dejó de transmitir. El resumen diario sí: VisionLink
entrega una fila con 0 h los días en que el equipo estuvo detenido (en
`bodega_dev`, CR-51 tiene 274 de 420 días en 0 h) y **ninguna fila** cuando no
transmitió (CR-53 no tiene filas después del 2026-08-27). Regla: para un día
que el sync diario ya consultó después de terminado, fila con 0 h = detenido y
sin fila = *Sin señal*. Mientras ese día no se consulte cerrado, un turno con
0 min de motor queda *Pendiente de datos*; con algo de motor no hace falta
esperar. La grilla de equipos usa la misma regla («SS» = sin señal).

### Modelo de datos

Nombres orientativos; el builder ajusta a las convenciones del esquema.

- **`fleet_operation_shifts`** (turnos): `id`, `vehicle_id` → `fuel_vehicles`,
  `shift_date` (`YYYY-MM-DD`, fecha de inicio), `start_hour` y `end_hour`
  (0–23), `operator_worker_id` → `workers` (obligatorio),
  `operator_name_snapshot`, `notes`, `created_by`, `updated_by`, `created_at`,
  `updated_at`, `voided_at`, `voided_by`, `void_reason`.
  - La faena **no se guarda**: es la del equipo ese día
    (`stayWorksiteOnDaySql`), igual que en las consultas de ralentí.
  - **Anular, no borrar** (decisión mía): un turno anulado deja de contar pero
    queda para la auditoría.
  - **Sin cruces**: dos turnos vigentes del mismo equipo no comparten una hora,
    y un operador no tiene dos turnos vigentes que compartan una hora
    (decisión mía; la página original sólo validaba por equipo). Se valida en el
    servicio, dentro de la transacción y con bloqueo por equipo y por operador;
    el repo no usa `EXCLUDE USING gist`.
  - Crear, editar y anular escriben `audit_log` con valores antes/después.
- **Telemetría por hora** (p. ej. `fuel_telemetry_hourly`): `vehicle_id`, `day`
  (local), `hour` (0–23), `idle_seconds`, `working_seconds`, `running_seconds`,
  `source` (`visionlink-api`), `updated_at`. Única por equipo + día + hora +
  fuente. ~52.000 filas al año para 6 equipos.
- **Constancia de consulta** por equipo y día (`fetched_at`), para § Hora
  conocida. Puede ser otra tabla o columna; lo decide el builder.
- **`fleet_operation_day_marks`** (marcas de día): `vehicle_id`, `day`,
  `reason` (`sin_operacion_programada` | `otro`), `notes`, `created_by`,
  `created_at`. Única por equipo + día; se quita con auditoría.
- **Meta**: un valor global en la configuración del sistema (decisión mía; una
  meta por faena queda para cuando Teno la pida).

### Sincronización

- Paso nuevo en el cron `fuel-visionlink-sync`, **después** del resumen diario y
  aislado de él: si fallan los tramos, el resumen diario igual se guarda, y el
  resultado del cron informa cada paso por separado. La corrida de las 06:00
  reescribe 14 días (~126 llamadas).
- **Corrida liviana cada hora** (decisión mía): sólo tramos de ayer y hoy (~24
  llamadas por corrida, ~600 al día de un cupo de 50.000). Sin ella, los turnos
  de Tarde, Noche y Día 12 h de ayer —la vista que Patricio abre a diario—
  saldrían *Pendiente de datos* hasta la mañana siguiente. Va como entrada
  propia del programador de crons (`docker-compose.yml`) con su propio candado;
  no alarga la corrida de las 06:00.
- Por cada equipo con serie vinculada, pide los tramos del rango siguiendo
  `nextSegmentUrl` y `nextCursor`; reparte cada tramo entre las horas locales
  que atraviesa (un tramo de 05:50 a 06:20 suma 10 min a las 05 y 20 a las 06),
  y reescribe esas horas (idempotente).
- La hora local se calcula desde `*Utc` con `America/Santiago` (helpers del
  repo), no desde `*AssetLocalTime`, que depende de cómo esté configurado el
  equipo en VisionLink. **Ojo:** la API entrega `endStateUtc` y `startStateUtc`
  sin la `Z` final (p. ej. `2026-11-20T14:32:51`): hay que leerlas como UTC
  explícitamente, o `Date.parse` las toma como hora local del servidor. Los días
  de cambio de horario tienen 23 o 25 horas: el builder define cómo se
  registran, con prueba.
- Un tramo cuyo `segmentType` no sea `idle`, `working` ni `running` se registra
  en el log y no se suma.
- Tope de páginas por equipo, como el cliente actual (`MAX_PAGES`).

### Pantalla «Turnos y ralentí» (`/flota/turnos`)

Sigue las reglas de layout de `AGENTS.md` (`PageHeader`, `PageContainer`,
`DataTable`, `DatePicker`, `Field`, `PeriodControl`, `Badge`, tokens `-ink`,
estados vacíos con CTA). Vista en la URL (`?vista=dia|operadores|equipos`) con
`router.replace` + `scroll: false`. Debe funcionar en teléfono: Patricio
registra desde la faena.

- **Qué equipos aparecen** (decisión mía): en la fila de equipos y en la grilla,
  los de las faenas del alcance (por su estadía ese día) que tengan VisionLink,
  más cualquier otro que tenga turnos o marcas en el período. En el selector
  del formulario, todos los equipos activos de esas faenas: primero los que
  tienen VisionLink y luego el resto, rotulados «sin VisionLink» (se pueden
  registrar; sus turnos salen *Sin telemetría*). Hoy son 6 con VisionLink de
  28 activos en Cholguán.
- **Turnos del día**
  - Selector de día (anterior / siguiente / `DatePicker`); por defecto, ayer.
  - Fila de equipos (ver arriba): % del día 00–24 h, horas de motor, n.º de turnos,
    aviso de horas sin turno, estado del equipo (en mantención / fuera de
    servicio desde los intervalos) y marca de día.
  - **Formulario de turno en línea y plegable** (excepción A3 para estaciones de
    captura repetitiva; preferencia persistida). Campos: Equipo, Turno
    (Mañana 06–14, Tarde 14–22, Noche 22–06, Día 12 h 06–18, Noche 12 h 18–06,
    Otro horario), Inicio, Fin, Operador, Observación.
  - **Operador**: buscador sobre los trabajadores activos de la faena del equipo,
    con los de cargo «Operador de maquinaria» primero (decisión mía; los 15 de
    la página original están en esa lista).
  - Tabla de turnos del día: Equipo, Turno, Operador, Horario, Motor h,
    Trabajo h, Ralentí h, % ralentí (barra con la marca de la meta), Estado,
    acciones Editar / Anular (confirmación sólo en Anular).
  - Marcar «sin operación programada» o «otro motivo» por equipo y día. Para
    mantención o avería, enlace a la ficha del vehículo para cambiar su estado:
    no se duplica ese flujo.
- **Operadores**: `PeriodControl` (por defecto, el mes en curso) y filtro de
  equipo. Tira compacta con un máximo de 4 cifras (A1): % ralentí general,
  turnos, turnos sobre meta y pendientes de datos. Ranking en `DataTable`:
  #, Operador, Turnos, Motor h, Trabajo h, Ralentí h, % ralentí, Sobre meta,
  Pendientes, y fila de total.
- **Equipos**: período (por defecto, los últimos 14 días). Grilla equipo × día
  con el % (convenciones: vacío = sin telemetría, «–» = motor detenido, «FS» =
  fuera de servicio o en mantención, «SP» = sin operación programada), horas de
  motor y % del período. Debajo, «Días detenidos» (intervalos de estado + marcas
  de día) y «Litros en vacío por día» (resumen diario). La meta se edita aquí,
  en un bloque «Ajustes» visible sólo con permiso de gestión.

### Permisos y navegación

- `flota:view_shifts` — ver la pantalla. Roles: administrador, jefa_chome,
  jefe_mantencion, admin_contrato.
- `flota:manage_shifts` — registrar, editar y anular turnos, marcas de día y
  meta. Roles: administrador, admin_contrato.
- Alcance por faena en lectura y escritura: un usuario sin rol global sólo ve y
  registra equipos cuya faena del día esté en sus faenas. La acción del servidor
  lo valida; ocultar en el menú no es autorización.
- Menú: Control operacional › Flota › «Turnos y ralentí», `/flota/turnos`.
  Interruptor de submódulo **apagado** al desplegar, como Traslados.
- Paridad: ruta, acciones, `modules/flota/manifest.ts`, `modules/permissions.ts`,
  registry, `db:sync-rbac`.

### Migración y puesta en marcha

1. Migraciones generadas con `db:generate` + checksums.
2. **Historial de tramos** desde 2026-10-01 (el primer turno de la página
   original) hasta hoy: comando de una vez que reusa el paso del cron con un
   `from`; en prod va como one-shot del servicio `migrate` (ver cómo se hizo el
   backfill de VisionLink).
3. **Importación de los 320 turnos**: script de una vez que lee un JSON
   exportado de la página original (el usuario tiene acceso de lectura a su
   base; la exportación la hace quien implementa, con la herramienta de datos
   del Artifact). Formato de cada turno, tal como está en esa base:
   `{ "id": "<id del documento>", "equipo": "GR-11", "fecha": "2026-11-09",
   "ini": 22, "fin": 6, "operador": "Jose Briceño", "obs": "",
   "actualizado": "2026-11-16T15:30:16.778Z" }` (`ini`/`fin` en horas enteras;
   `fin <= ini` = termina al día siguiente). Reglas:
   - Equipo → `fuel_vehicles.code`; operador → `workers` por nombre exacto y
     único, comparando sin tildes ni mayúsculas, **contra prod al momento de
     correr**. Si un equipo u operador no calza, aborta sin escribir y lo lista.
     En `bodega_dev` los 15 operadores calzan uno a uno.
   - El id del documento original se guarda como referencia de importación, para
     que correrlo dos veces no duplique.
   - Los turnos históricos se importan **tal como están**, aunque choquen con la
     regla nueva de cruces por operador; el informe los lista para que Patricio
     los corrija en la plataforma (al editarlos, la regla ya aplica). Hay 1
     conocido: Mauricio Vallejos el 2026-11-03 en GR-06 06–18 y en GR-10 14–22.
     Cruces por equipo: 0.
   - Incluye el único turno de GR-06 (sin VisionLink: saldrá *Sin telemetría*).
   - Autor: el usuario de Patricio; nota «Importado de Ralentí Cholguán». Corre
     primero con `--dry-run`.
4. Las 2 marcas «En mantención» de la página original (GR-10 y CR-52, ambas del
   2026-11-19) **no se importan**: son averías y corresponden al estado del
   equipo. El informe de importación las lista para revisarlas en la ficha.
5. Encender el interruptor y avisar a Patricio. La página original queda de
   sólo lectura hasta que él confirme que trabaja en la plataforma.

### Pruebas

- Unitarias: reparto de tramos por hora (cruce de hora, cruce de medianoche,
  cambio de horario), horas de un turno nocturno, estados del turno, ranking
  ponderado, validación de cruces.
- Cliente: paginación de tramos (`nextSegmentUrl` + `nextCursor`) con
  respuestas de prueba, sin llamar a la API real.
- PGlite: crear, editar y anular con alcance por faena, cruces y auditoría;
  sincronización idempotente; § Hora conocida.
- E2E: admin. de contrato registra un turno y lo ve en el ranking; otro usuario
  sin la faena no lo ve; navegación por el permiso.

## Decisiones del usuario

- Enfoque 1: turnos en la plataforma + tramos por hora de VisionLink.
- Quien registra los turnos en Cholguán es Patricio Panes, en la plataforma.
- Lo que gerencia haga con los datos no condiciona el código: se usa el estándar
  de la plataforma (editable, con auditoría).

## Decisiones mías (revisar al leer)

- Anular en vez de borrar.
- Bloquear también el cruce de turnos del mismo operador.
- Operador desde `workers`, sin texto libre.
- Meta global, editable por quien registra turnos.
- Marcas de día sólo para «sin operación programada» y «otro»; las averías van
  al estado del equipo.
- Formulario en línea y plegable, no en un `Sheet`.
- Pantalla bajo Flota, con permisos `flota:view_shifts` / `flota:manage_shifts`
  y el interruptor apagado al desplegar.
- Margen de 1 h para dar una hora por conocida (latencia medida: ~15 min).
- Corrida liviana de tramos cada hora para ayer y hoy, además de la de 06:00.
- Estado *Sin señal* a partir de la ausencia de fila en el resumen diario.
- Equipos mostrados: los con VisionLink más los que tengan turnos o marcas; en
  el selector, todos los activos de la faena.
- Los turnos históricos se importan tal cual, aunque choquen con la regla de
  cruces por operador (1 caso conocido), y quedan listados para corregir.
- Las 2 marcas de mantención de la página original no se importan.

## Limitaciones conocidas

- Tramos y resumen diario difieren unos puntos (~4 % en el sondeo): esta
  pantalla y «motor en vacío» de Combustible no darán el mismo % de un día.
- Según el registro de la integración, los equipos con ConnectPro (TO-37,
  CR-51) informan poco ralentí: sus turnos pueden salir *Sin dato de ralentí*
  a menudo. CR-53 no informa desde el 2026-08-27: sus turnos saldrán
  *Sin señal*.

## Lo que queda al builder

Nombres de tablas y columnas, dónde se agrega (SQL o TypeScript), forma de la
constancia de consulta, manejo exacto de los días con cambio de horario, la
estructura de componentes y el orden de los pasos del cron, siempre dentro de
las reglas de arriba.
