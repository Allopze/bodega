# Mantención Trinorma: contratos de la Fase 1

Rama de integración: `feat/mantencion-trinorma`, en el worktree `bodega-wt/mantencion-trinorma`. Base: `main` a47271fd3.

La auditoría Trinorma de Biodiversa es el **2026-12-01**. Ese día la plataforma tiene que mostrar dos cosas:

- el historial de mantenciones cargado;
- un tablero con datos reales que reemplace el Looker.

Este documento fija lo que comparten los paquetes. Un implementador **no** cambia nada de lo que está aquí. Si no le alcanza, se detiene y lo reporta.

## 1. Decisiones del usuario (2026-11-20)

| # | Decisión |
|---|---|
| C1 | No se crean ENAP ni Campo Pangui como faenas. Las filas con esos textos quedan sin faena y conservan su texto. |
| C2 | Calymag y Santa Fe Residuos «ya no existen». En el consolidado son **contratos** dentro de Santa Fe (`CONTRATO` = Residuos, Calymag o Rodantes) y la faena de la fila es SANTA FE. No se crean faenas: el contrato se guarda como texto (`contract_text`). |
| C3 | Opción A. La faena de origen es `fuel_vehicles.worksite_id`, sin cambios. La ubicación física se **deriva**: si el equipo tiene una OT abierta con taller, el taller; si no, su faena. Se agrega la marca `location_pending_confirmation`. No hay tabla de ubicación. |
| C4 | Aún no se mueven equipos de faena. El traslado sigue apagado. La faena **sólo** cambia con `transferVehiclesTx` (AGENTS.md). |
| C5 | La OT que nace de un hallazgo de inspección se precarga como **correctiva**, editable. |
| C6 | El historial importado **entra** en los indicadores retrospectivos del tablero (por tipo, % de correctivas, días en taller, horas hombre, por faena y por equipo), con la fuente rotulada. El semáforo, las alertas y la lectura oficial del equipo siguen sin leer el historial. |
| C7 | Los 142 trabajos cargados en prod el 18-11 son los mismos 142 del consolidado con FUENTE «NUEVA_BASE… (form. nuevo)». Se reconocen por la identidad existente, `sourceKey = sha256("google-forms\n" + "YYYY-MM-DD HH:MM:SS" + "\n" + correo)`. No se duplican ni se borran: se completan las columnas nuevas, sin tocar su contenido. |

**Unir las dos «Arauco».** Se propuso al usuario el 20-11 y respondió «tienes mi permiso». El script de WP1 lo implementa **sólo en simulación**. Aplicarlo en producción requiere que el usuario lo autorice explícitamente, aparte, al ver el informe de la simulación. La propuesta:

- `HORCONES` (activa, 8 equipos) pasa a llamarse **Arauco**;
- las 18 filas del historial que apuntan a `MANT-ARA` (la del seed, inactiva y sin equipos) pasan a `HORCONES`;
- `MANT-ARA` se renombra para no repetir el nombre y queda inactiva, sin borrarse.

Decisiones anteriores que siguen vigentes:

- El costo se imputa a la faena de origen.
- Sin tablets: los reportes los sube el administrador de contrato.
- La OT no lleva costos (0394).
- No existe un rol de Gerencia.

## 2. Esquema nuevo (migración `0398_furry_luckman`, ya generada)

**No editar** `db/schema/*`, `db/migrations/*` ni los archivos `meta`. La reversión compensatoria está en `0398-reversion.sql` y la prueba `db/__tests__/trinorma-0398-pglite.test.ts`.

| Tabla.columna | Significado |
|---|---|
| `worksites.kind` | `operacion` (por defecto), `deposito` (Flor del Laja) o `administracion` (Oficina Central). No cambia permisos ni alcance. |
| `worksite_aliases` (`worksite_id`, `alias_text`, `alias_key` única, `created_by`) | Otros nombres de una faena. `alias_key = worksiteAliasKey(alias_text)`. |
| `fleet_owners` (`name` único sin distinguir mayúsculas, `kind`, `is_active`) | Empresa propietaria. `kind`: `propia`, `relacionada`, `financiera` o `tercero`. |
| `fuel_vehicles.owner_id` | FK a `fleet_owners`; null = sin informar. |
| `fuel_vehicles.location_pending_confirmation` | Marca «ubicación por confirmar». No es una ubicación. |
| índice `fuel_vehicles_code_key_unique` | Código único tras `equipmentCodeKey`. Prod no tenía duplicados. Una violación con ese índice se traduce a «Ya existe un equipo con el código X». |
| `mant_work_orders.action_type` | `preventiva`, `correctiva` o `predictiva`; null = no informado (OT anteriores). |
| `mant_work_orders.specialties` | `text[]` ⊆ `mecanica`, `electrica`, `soldadura`, `hidraulica`. |
| `mant_work_orders.labor_hours` | Horas hombre (0–10.000), sin pesos. |
| `mant_work_orders.execution_worksite_id` | Faena donde se ejecutó, si no es la de imputación. La imputación sigue siendo `worksite_id`. |
| `mant_work_orders.work_performed` | Trabajo realizado. |
| `mant_historical_records.source_record_id`, `origin_source` | ID_REGISTRO y FUENTE del consolidado. Son referencia, no identidad. |
| `…action_type` | Uno de los tres tipos o `sin_clasificar`; null = no derivado. |
| `…labor_hours`, `…downtime_days`, `…specialties` | HORAS_TRABAJADAS, DIAS_DETENIDO y TIPO_TRABAJO. |
| `…contract_text`, `…quality_notes`, `…is_test` | CONTRATO, OBS_CALIDAD y POSIBLE_PRUEBA. |
| `mant_historical_inspections` | Una unidad inspeccionada (hoja INSPECCIONES). |
| `mant_historical_findings` | Un ítem en estado `regular`, `mal` o `no_tiene` (hoja HALLAZGOS_INSPECCION). Se une a su inspección por `inspection_source_key`. |
| `mant_historical_schedule_checks` | Una pauta preventiva ejecutada (hoja PAUTAS_PREVENTIVAS). `compliance` va de 0 a 1. |

Las tablas `mant_historical_*` siguen el patrón de `mant_historical_records`:

- `equipment_match` vale `linked`, `unmatched` o `conflict`.
- `fields` guarda la fila original como `HistoricalField[]`, sin las fotos.
- `fingerprint` es `sha256(JSON.stringify(fields))`.
- `imported_by` es la cuenta que importó.

## 3. Código compartido (escrito y probado; no se cambian las firmas)

- **`lib/mantencion/equipment-identity.ts`**
  - `equipmentCodeKey(raw)`: la misma expresión del índice único.
  - `plateKey(raw)`.
  - `canonicalEquipmentCode(raw)`.
  - `matchVehicle({ code, plate }, vehicles)`: devuelve `linked`, `unmatched` o `conflict`. Si el código y la patente apuntan a equipos distintos, es conflicto y nunca elige.
- **`lib/worksites/resolve-worksite.ts`**
  - `resolveWorksiteId(text, sites, aliases)`: busca primero el nombre exacto y después el alias; si no encuentra, devuelve `null`. No adivina.
  - `worksiteAliasKey(text)`.
- **`lib/mantencion/action-type.ts`**
  - Tipos, rótulos y especialidades.
  - `actionTypeFromText`.
  - `workOrderActionType`.
  - `specialtiesFromText`.
- **Parámetros** en `getOperationalSettings()`, sección «Mantención» de `/admin/parametros-operativos`:
  - `mantencionActionTypeRequired`, 0/1, por defecto 0;
  - `mantencionExcludeTestRows`, 0/1, por defecto 0: con 0, las filas de prueba se importan marcadas con `is_test`;
  - `mantencionFindingWithoutOtDays`, 1–60, por defecto 7.

## 4. Reglas comunes

Rigen `AGENTS.md` y `.claude/agents/implementador-mantencion.md`, y además:

- **Archivos:** cada paquete toca sólo sus archivos (§5). Los de otro paquete se leen, no se editan.
- **Tests PGlite:** cada paquete tiene su suite ya registrada en `tests/pglite-files.ts`, hoy un stub: `lib/__tests__/trinorma-<paquete>-pglite.test.ts`. El patrón a seguir es `lib/__tests__/mantencion-historical-import-pglite.test.ts`.
- **Verificación, en dos niveles:**
  - Cada implementador corre y deja en verde sus tests focalizados a través del guardián de recursos, que serializa el trabajo pesado entre agentes en esta máquina de 14 GB: `bash scripts/run-resource-guard.sh npx vitest run [--config vitest.pglite.config.ts] <archivo>`.
  - El orquestador corre después todas las puertas del repositorio sobre la rama integrada (typecheck, lint, test:fast, test:pglite, verificación de migraciones, E2E y recorrido en navegador) antes de dar nada por terminado.
- **Permisos:** no hay permisos nuevos; se usan los existentes. Si de verdad hace falta uno, se reporta al orquestador, que mantiene la paridad entre manifiesto, `modules/permissions.ts`, bootstrap y `sync-rbac`.
- **Commits y datos reales:** los commits los hace el orquestador. Ningún agente corre scripts contra producción.

## 5. Paquetes

### WP1, maestros de faenas y equipos (R1, R2)

**Archivos que le pertenecen:**

- `app/(app)/admin/faenas/**`;
- `lib/services/worksite-*.ts`, más un `lib/services/worksite-aliases.ts` nuevo;
- un `lib/services/fleet-owners.ts` nuevo;
- en flota, la ficha, la edición del equipo, la tabla y los filtros: `app/(app)/flota/actions.ts`, `fleet-table.tsx`, `fleet-filters.tsx`, `app/(app)/flota/[id]/**`, y los servicios de flota que crean o editan un equipo;
- `app/(app)/mantencion/equipos/actions.ts`, sólo para traducir el código duplicado;
- un `scripts/apply-trinorma-maestros.ts` nuevo y su test;
- `lib/__tests__/trinorma-maestros-pglite.test.ts`.

**Qué hace:**

1. **`/admin/faenas`:** tipo de faena y alias, con auditoría. Rechaza un alias cuya clave ya exista o que sea el nombre de otra faena.
2. **Ficha y edición de equipo en `/flota`:**
   - «Empresa propietaria», que se elige del catálogo o se crea en línea con nombre y tipo, con el permiso de edición de flota;
   - casilla «Ubicación por confirmar»;
   - auditoría.
3. **Tabla de flota:** filtro «Ubicación por confirmar» y propietario visible (regla A2 y arquitectura de búsqueda de AGENTS.md).
4. **Código duplicado:** se traduce a un mensaje claro en flota y en `mantencion/equipos`. El código se normaliza con `canonicalEquipmentCode`.
5. **`scripts/apply-trinorma-maestros.ts`** sigue el patrón de `scripts/apply-mantencion-correcciones-2026-10-31.ts`: simulación por defecto, `--apply`, `--actor-email`, una transacción, rollback de la simulación y `recordAudit`. Identifica las faenas por código: `FLOR-DEL-LAJA`, `OFICINA-CENTRAL`, `HORCONES`, `MANT-ARA`, `FA-007`, `CHOLGUAN-ARAUCO`, `SANTA-FE`, `MASISA` y `TENO-ARAUCO`. Si falta alguna, la reporta. Pasos:

   1. **Tipos:** Flor del Laja pasa a `deposito` y Oficina Central a `administracion`.
   2. **Unión de las dos Arauco** (§1, sólo con autorización explícita para producción).
   3. **Alias,** sólo los que no son ya el nombre exacto de una faena: «Horcones» → HORCONES; «Cholguan», «Cholguan Maderas» y «Cholguan Residuos» → CHOLGUAN-ARAUCO; «Rodantes Santa Fe» → SANTA-FE; «Administración» → OFICINA-CENTRAL; «Masisa Maderas» y «Masisa Tableros» → MASISA; «Teno» → TENO-ARAUCO.

      No se crean «Mininco» → Pacífico ni «Cabrero» → Masisa: existen faenas con esos nombres y el inventario dice que Cabrero es una faena propia. El informe lo dice.
   4. **Propietarios:** sólo con `--inventario <xlsx>`, que es el inventario de octubre, hoja «Base de Datos», encabezados en la fila 3 (EMPRESA, C.INT, PATENTE).
      - Crea en `fleet_owners` las empresas que aparecen y asigna por `matchVehicle`, sin sobrescribir un `owner_id` que ya tenga valor.
      - Clasificación: CHOME → `propia`; ASIR, «ASIR Y ACUÑA» y SERVIMAR → `relacionada`; nombres con BANCO, BCO, SCOTIABANK, ITAU o LEASING → `financiera`; el resto → `tercero`.
      - Ignora las filas de notas, que no tienen código ni patente.
      - Los propietarios `tercero` se informan sólo por cantidad, sin nombres de personas.
   5. **Ubicación por confirmar:** la marca va a los equipos activos de faenas inactivas y a los de Pacífico (`FA-007`). No cambia ninguna faena.

   El informe lista cada cambio. Una segunda corrida no cambia nada.

**Tests:**

- PGlite:
  - la simulación no escribe;
  - con `--apply` aplica y deja auditoría;
  - la segunda corrida no cambia nada;
  - los alias conflictivos se rechazan;
  - el código duplicado se rechaza con mensaje.
- Unitarias donde ya haya tests vecinos.

### WP2, importador del consolidado (R3)

**Archivos que le pertenecen:**

- `lib/services/mantencion/historical-workbook.ts` (sólo para cambiar `resolveHistoricalWorksite` a `resolveWorksiteId` con alias, sin cambiar firmas exportadas ni `HistoricalField`);
- `lib/services/mantencion/historical-import.ts` (puede extender el listado y el detalle con las columnas nuevas);
- nuevos: `lib/services/mantencion/consolidated-workbook.ts`, `lib/services/mantencion/consolidated-import.ts` y `scripts/import-consolidado-mantencion.ts`;
- `app/(app)/mantencion/registros/historicos/**` y `components/mantencion/jefatura/registros/historical-*.tsx`, sólo para mostrar tipo de acción, horas, contrato, «posible prueba» y observaciones de calidad;
- `lib/__tests__/trinorma-consolidado-pglite.test.ts`.

**Archivo real:** `/home/allopze/dev/chome/bodega/CONSOLIDADO_CHOME_COMBUSTIBLE_MANTENCION_INSPECCION.xlsx`. Pesa 3,2 MB y **no se copia al repo**. El script recibe la ruta por `--file`.

**MANTENCIONES** (2.344 filas) va a `mant_historical_records`. Las columnas están en la fila 1:

```
ID_REGISTRO ID_EQUIPO PATENTE EQUIPO_ORIGINAL TIPO_EQUIPO FUENTE TALLER_REGISTRO MARCA_TEMPORAL FAENA FAENA_GRUPO
CONTRATO OT TIPO_ACCION TIPO_TRABAJO CAMBIO_ACEITE REALIZA_RESPONSABLE TALLER_EXTERNO CONDUCTOR ODOMETRO_HOROMETRO
TRABAJO_REALIZADO REPUESTOS F_INGRESO F_SALIDA DIAS_EN_TALLER HORAS_TRABAJADAS DIAS_DETENIDO ODO_PROX_MANTENCION
MES OBS_CALIDAD POSIBLE_PRUEBA FOTO FOTO_STICKER CORREO
```

- **Identidad:** `sourceKey = sha256("google-forms\n" + MARCA_TEMPORAL truncada al segundo "YYYY-MM-DD HH:MM:SS" + "\n" + CORREO.trim().toLowerCase())`.
  - Verificado contra prod: 142 coinciden con las filas ya cargadas y las 2.344 claves son únicas.
  - La fecha se lee como en `historical-workbook.ts`, en UTC para conservar el calendario.
- **Fila nueva:**
  - origen: `source_file` = nombre del archivo, `source_sheet` = «MANTENCIONES» y `source_row`;
  - `fields`: la fila sin FOTO ni FOTO_STICKER;
  - columnas de texto: `submittedAt` = fecha de envío; `worksiteText` = FAENA; `equipmentText` = EQUIPO_ORIGINAL, o ID_EQUIPO / PATENTE; `orderText` = OT; `kindText` = TIPO_ACCION; `readingText` = ODOMETRO_HOROMETRO; `description` = TRABAJO_REALIZADO; `entryDate` y `exitDate` = F_INGRESO y F_SALIDA; `hoursText` = HORAS_TRABAJADAS;
  - columnas nuevas: `action_type` = `actionTypeFromText`; `labor_hours`; `downtime_days`; `specialties`; `contract_text`; `quality_notes`; `is_test`; `source_record_id`; `origin_source`.
- **Equipo:** `matchVehicle({ code: ID_EQUIPO, plate: PATENTE })`; si ID_EQUIPO está vacío, con EQUIPO_ORIGINAL como hoy.
- **Faena:** `resolveWorksiteId(FAENA, …)`.
- **Fila que ya existe** (mismo `sourceKey`, venga del archivo que venga):
  - se completan sólo las columnas nuevas que estén vacías, y los vínculos vacíos como en `relink`;
  - **nunca** se tocan `fields`, `fingerprint`, el origen ni un vínculo hecho a mano;
  - si la fila ya tiene columnas nuevas con valores distintos, no se cambian y se informa la diferencia, sin abortar.
- **Filas de prueba** (POSIBLE_PRUEBA no vacía): con `mantencionExcludeTestRows` = 0 se importan con `is_test`; con 1 no se importan, pero se informan.
- **Lo que no es equipo:** EQUIPOS.CATEGORIA «No es equipo…», o ID_EQUIPO o EQUIPO_ORIGINAL igual a uno de esos nombres. Se rechaza con su motivo.
- **SIN CLASIFICAR** se conserva como `sin_clasificar`.

**INSPECCIONES** (1.333) va a `mant_historical_inspections`.

- Clave derivada del formulario: MARCA_TEMPORAL al segundo, N_FORMULARIO, TIPO_UNIDAD y `plateKey(PATENTE_ORIGINAL || PATENTE)`, con prefijo «inspeccion». Hay que confirmar que es única en el archivo; si no lo es, se agrega lo que la distinga y se informa.
- Equipo: `matchVehicle({ code: ID_EQUIPO, plate: PATENTE })`. Faena: `resolveWorksiteId(FAENA_GRUPO)`.
- Conteos: BUEN_ESTADO, REGULAR, MAL_ESTADO, NO_TIENE y NO_APLICA.

**HALLAZGOS_INSPECCION** (1.132) va a `mant_historical_findings`.

- Se une a su inspección por la misma clave o por ID_INSPECCION dentro del archivo.
- `source_key = sha256(inspection_source_key + "\n" + SECCION + "\n" + ITEM)`; si se repite, se agrega la fila y se informa.
- `condition` sale de NIVEL o ESTADO.
- No se guardan SEGUIMIENTO_TALLER ni OT_SIGUIENTE: el tablero calcula su seguimiento.

**PAUTAS_PREVENTIVAS** (276) va a `mant_historical_schedule_checks`.

- Clave: MARCA_TEMPORAL al segundo, `plateKey(PATENTE)` y PAUTA, con prefijo «pauta».
- `is_test` = ES_PRUEBA ≠ «No».
- `compliance` = %_CUMPLIMIENTO.

**EQUIPOS** (155) **no escribe en la flota.** Sólo sirve para clasificar lo que no es equipo y para informar:

- los equipos que no están en la flota (hoy 16);
- las diferencias de patente: KCH-133/135/136 están cruzadas.

Crear equipos lo decide el usuario. CALIDAD_DATOS va al informe. COMBUSTIBLE y CONTROL_SELLOS no se importan en la Fase 1.

**Script:** `npx tsx scripts/import-consolidado-mantencion.ts --file <ruta> [--apply] [--actor-email <correo>] [--report <ruta.md>]`.

- Simulación por defecto; una transacción con `pg_advisory_xact_lock(hashtext('mant-historical-import'))`; rollback en simulación; `recordAudit` (`mant_historical_import`).
- El informe en Markdown incluye:
  - conteos por hoja: nuevas, completadas, sin cambios, con diferencia, rechazadas, de prueba;
  - vinculadas, sin equipo y en conflicto;
  - sin faena, por texto;
  - los equipos que no están en la flota;
  - las diferencias de patente;
  - las filas rechazadas con su motivo (máximo 200 listadas y el resto contado);
  - el resumen de CALIDAD_DATOS.
- Sin correos ni nombres de personas.
- La segunda corrida da todo «sin cambios».

**Tests PGlite**, con un libro construido en el test:

- idempotencia;
- completa una fila preexistente sin tocar sus `fields`;
- no sobrescribe un vínculo manual;
- filas de prueba marcadas o excluidas;
- rechazo de lo que no es equipo;
- `sin_clasificar`;
- conflicto de código y patente;
- alias de faena;
- hallazgos enlazados;
- pautas con `is_test`.

### WP3, OT (R4, C5)

**Archivos que le pertenecen:**

- `lib/mantencion/work-order-schemas.ts`, `work-order-states.ts`;
- `lib/services/mantencion/work-orders/**`;
- `app/(app)/mantencion/ot/**`;
- `components/mantencion/jefatura/ot/**`;
- `app/(print)/mantencion/ot/**`;
- `app/api/mantencion/ot/**`;
- en `lib/services/prevention-inspections/runs.ts`, sólo `createWorkOrderWithClient`;
- `lib/__tests__/trinorma-ot-pglite.test.ts`.

La sincronización de la app móvil no se toca: los campos nuevos son opcionales.

**Qué hace:**

1. **Alta de OT:**
   - tipo de acción, obligatorio sólo con `mantencionActionTypeRequired = 1`, validado en el servidor;
   - especialidades;
   - faena de imputación precargada (la del equipo), visible y no editable;
   - «Faena de ejecución» opcional;
   - al elegir el tipo, las casillas `repair` y `maintenance` se prellenan de forma coherente, sin romper el CHECK.
2. **Término del trabajo:** pide «Trabajo realizado» y «Horas hombre». Se mantiene la regla existente: sin fecha de salida no hay término, y la OT queda «En taller».
3. **Detalle, PDF y Excel de la OT:** tipo (`workOrderActionType`, «No informado» si no se puede saber), especialidades, horas, faena de ejecución, trabajo realizado y días detenido derivados de ingreso y salida.
4. **C5:** `createWorkOrderWithClient` guarda `action_type = 'correctiva'`.
5. **Auditoría:** los eventos de la OT y `recordAudit` registran los campos nuevos.

**Tests PGlite:**

- el interruptor encendido o apagado;
- término sin salida rechazado;
- horas negativas rechazadas;
- la OT desde un hallazgo nace correctiva;
- el alcance por faena.

Se actualizan los tests existentes de la OT que cambien.

### WP4, tablero (R5)

**Archivos que le pertenecen:**

- `lib/services/mantencion/indicators.ts`;
- un `lib/services/mantencion/maintenance-work.ts` nuevo;
- `app/(app)/mantencion/panel/**`;
- `components/mantencion/jefatura/panel/**`;
- un `app/(print)/mantencion/informe/**` nuevo y su ruta de PDF, siguiendo el patrón de `app/(print)/prevencion/inspecciones/[runId]/print/pdf/route.ts` y `lib/pdf/render-print-page.ts`;
- la acción del Excel del tablero (`BoardExportButton` del Panel);
- `lib/__tests__/trinorma-tablero-pglite.test.ts`.

**Qué hace:**

1. **`maintenance-work.ts`:** «trabajos de mantención» del período, con alcance por faena (`equipmentScope` y `viewerFromSession`). Es la unión de:
   - `mant_historical_records` sin `is_test`, con fuente `historial`;
   - `mant_work_orders` no anuladas, con fuente `ot`.

   Cada fila lleva:
   - fecha (ingreso, o la de envío o la de solicitud si falta);
   - equipo y faena de imputación;
   - tipo (`workOrderActionType`, o `action_type` del historial; si es null, `actionTypeFromText(kind_text)`);
   - horas hombre;
   - días en taller (salida − ingreso; una OT abierta, hasta hoy, marcada «en taller»);
   - si el taller fue externo.

   `mant_records` sigue en su sección y no se suma aquí, para no contar dos veces.
2. **Panel:** una sección «Trabajos de mantención», con gráficos de a dos por fila (`DashboardSection` + `ChartSlot` + `lazyChart`, `SummaryBar numerals="sans"` con hasta 4 cifras accionables y sin tiles). Contiene:
   - trabajos por tipo por mes y % de correctivas;
   - días en taller y horas hombre por faena (`BarRankingChart`);
   - equipos con más correctivas;
   - la fuente rotulada.

   **Navegación Chome → faena → equipo:** el filtro de faena existente y un filtro `?equipo=`, dentro del alcance, que acota el Panel y enlaza a la hoja de vida del equipo.
3. **Indicadores de R5:**
   - fuera de servicio (ya existe);
   - pautas: el semáforo nativo con **«Sin pauta definida»** visible y contado, nunca 0 ni «al día» sin pauta, más el promedio de `compliance` de las pautas importadas sin `is_test`, rotulado;
   - hallazgos «mal estado» del período sin trabajo del mismo equipo (historial u OT) con ingreso dentro de `mantencionFindingWithoutOtDays` días: la cifra y la lista por equipo.
4. **Exportación por faena:**
   - **PDF** del Panel para la faena y el período, con portada (faena, período, fecha de emisión), cifras y tablas, y permiso `mant:export`;
   - **Excel**: una hoja «Trabajos» con las filas de `maintenance-work`. Excel, nunca CSV.
5. `formatDate`/`todayInChile`, tokens `-ink` y gráficos accesibles.

**Tests PGlite:**

- sin doble conteo;
- excluye `is_test`;
- alcance por faena;
- `sin_clasificar` aparte en el % de correctivas;
- días en taller;
- hallazgo con y sin trabajo dentro del plazo;
- «Sin pauta definida».

Se actualizan los tests del Panel que cambien.

## 6. Datos de referencia (prod, solo lectura, 2026-11-20)

- **Faenas activas:** Biodiversa (`BIODIVERSA`), Cholguan - Arauco (`CHOLGUAN-ARAUCO`), Flor del Laja (`FLOR-DEL-LAJA`), Fábrica de Puertas (`FABRICA-DE-PUERTAS`), Horcones (`HORCONES`), Masisa (`MASISA`), Oficina Central (`OFICINA-CENTRAL`), Pacifico (`FA-007`), Santa Fe (`SANTA-FE`) y Teno - Arauco (`TENO-ARAUCO`).
- **Faenas inactivas:** Arauco (`MANT-ARA`, con las 18 filas de historial), Cabrero (`MANT-CAB`), Ecoservitran (`MANT-ECO`), Mininco (`MININCO`), Panguipulli (`MANT-PAN`), Servimar (`MANT-SER`) y Sin ubicación (`MANT-SUB`).
- **Flota:** 164 equipos activos, sin códigos ni patentes duplicados. Hay 14 sin código y 6 con código H-xx.
- **Historial:** 142 filas con `kind_text` vacío. 0 registros nativos, 0 OT reales y 1 hallazgo abierto.
- **El consolidado:** 2.232 de 2.344 mantenciones se vinculan a la flota. FAENA solo toma 7 valores: SANTA FE, CHOLGUAN, BIODIVERSA, PACIFICO, MASISA, ARAUCO y FLOR DEL LAJA.
