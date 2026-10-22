# Brechas: submódulo de control de combustible

> Comparación entre el módulo de combustibles de la plataforma y el inventario
> funcional del tablero de Looker Studio «TABLERO CONTROL COMBUSTIBLE», y plan
> para cerrarlas. Fecha de la comparación: 2026-10-21, rama
> `feat/control-combustible` sobre `main` @ `6dbea284`.
>
> Toda afirmación sobre el estado actual cita `ruta:línea`. Las rutas son
> relativas a la raíz del repositorio.

## 0. Stack detectado

| Pieza | Qué usa el repositorio | Evidencia |
|---|---|---|
| Framework | Next.js 16 (App Router, server actions, route handlers) | `package.json`, `AGENTS.md` |
| ORM y migraciones | Drizzle ORM + `drizzle-kit generate`, migraciones SQL numeradas; última `0358_loose_wallow.sql` | `db/migrations/`, `db/migrations/README.md:27-100` |
| Base de datos | PostgreSQL 16 (PGlite en pruebas) | `lib/testing/pglite-migrate.ts`, `vitest.pglite.config.ts` |
| Auth y permisos | Manifiestos por módulo → `SYSTEM_PERMISSIONS`; `requirePermission` / `guardPermission`; alcance por faena con `worksiteScopeSql` / `canAccessWorksite` | `modules/combustibles/manifest.ts:5-147`, `lib/auth/system-rbac.ts:54-90`, `lib/auth/can.ts:41,78`, `lib/auth/scope.ts:36,86` |
| Siembra de RBAC | `ensureSystemRbac` (registro del primer usuario y `npm run db:sync-rbac`), nunca migraciones | `lib/auth/bootstrap.ts:147`, `scripts/sync-rbac.ts:1-19` |
| Bitácora de auditoría | `audit_log` con `oldState`/`newState`, helper `recordAudit(params, tx?)` | `db/schema/audit.ts:7-41`, `lib/audit.ts:71` |
| Archivos privados | Almacenamiento local `storage/fuel-tae/`, servido por route handler autenticado | `lib/storage/config.ts:22,580-595`, `app/api/tae/evidence/[id]/route.ts:16-50` |
| Gráficos | Recharts ^3.9 con carga diferida (`next/dynamic`, `ssr:false`) | `package.json:150`, `app/(app)/combustibles/fuel-charts-lazy.ts:17-25` |
| Excel | `exceljs` ^4.4 (no hay SheetJS ni CSV; el contrato del repo prohíbe CSV) | `package.json:135`, `AGENTS.md` «Export Format Rule» |
| Tablas y filtros | `components/ui/data-table.tsx:479`, `ServerPagination`, `FilterToolbar`, `useUrlFilters` | `components/ui/server-pagination.tsx:13`, `lib/hooks/use-url-filters.ts:13` |
| Formato es-CL | `formatQty`, `formatDate`, `MONTH_LABELS` («Ene»…«Dic») | `lib/utils.ts:142,283,198` |
| Pruebas | Vitest (rápidas y PGlite; toda prueba PGlite se registra en `tests/pglite-files.ts`), Playwright E2E | `tests/pglite-files.ts:1-10`, `playwright.config.ts` |

No hace falta ninguna librería nueva.

## 1. Resumen del módulo actual

El módulo de combustibles es amplio y maduro, pero está organizado por **canal de
origen** (facturación, consumos de proveedor, log operacional, control TAE), no
por las preguntas que responde el tablero. Las piezas relevantes:

- **Catálogo de equipos** `fuel_vehicles` con código, patente, marca, modelo, tipo, faena, tipo de medidor, unidad de rendimiento y capacidad de estanque (`db/schema/fuel-vehicles.ts:10-53`). Tipos de equipo administrables con categoría y unidad por defecto (`db/schema/fuel-equipment-types.ts:5-25`; UI `/admin/flota-catalogos/tipos-equipo`).
- **Control de cargas en terreno («TAE»)**: PWA pública por QR revocable por faena y punto (`app/(public)/tae/page.tsx`, `app/(public)/tae/tae-form.tsx`), cola offline en IndexedDB con reenvío (`lib/pwa/tae-offline-queue.ts:124-186`), idempotencia por `clientSubmissionId` (`db/schema/fuel-tae.ts:72`, `lib/services/fuel-tae.ts:263-278`), cuatro fotos privadas (`db/schema/fuel-tae.ts:182-198`), sellos retirado e instalado con motivo obligatorio si falta (`lib/validation/fuel-tae.ts:29-33`), revisión validar/observar/anular (`lib/services/fuel-tae.ts:576-637`), corrección auditada de medidor (`app/(app)/combustibles/tae/actions.ts:125-178`), historial de sellos (`app/(app)/combustibles/sellos/page.tsx`, `lib/combustibles/seal-history.ts:53-189`).
- **Importación histórica TAE** (planilla del formulario de sellos) con informe previo, mapeos manuales de equipo y persona y filas rechazadas persistidas (`lib/combustibles/tae-import.ts:90,146`, `lib/combustibles/tae-import-service.ts:236-387`, `db/schema/fuel-tae.ts:135-179`).
- **Log operacional «CONSOLIDADO COMBUSTIBLES»**, que es la planilla de cargas del tablero: patente, fecha, hora, litros, código, faena, tipo, marca, modelo, horómetro/odómetro, operador, supervisor, «Suministro entregado por», rendimiento y tipo de rendimiento (`lib/combustibles/operations-import.ts:142-234`, `db/schema/fuel-operations.ts:41-75`, `app/(app)/combustibles/actions-operaciones.ts:102,231`).
- **Integraciones de proveedor**: Copec TCT/TAE por portal (`lib/combustibles/copec-sync.ts:1044`) y Aramco por API (`lib/combustibles/aramco-sync.ts:259`), con un libro de transacciones idempotente (`db/schema/fuel-integrations.ts:49-108`, `lib/combustibles/fuel-provider-ledger.ts:94,240`).
- **Ciclo de combustible**: estanques, recepciones, transferencias y entregas, con comparación recibido/entregado por faena (`db/schema/fuel-cycle.ts:10-69`, `lib/combustibles/fuel-cycle.ts:113-262`).
- **Rendimiento**: vista `/combustibles/analisis` con presets por familia y estadística descriptiva (`app/(app)/combustibles/analisis/page.tsx`, `lib/combustibles/equipment-performance.ts:33-309`, `lib/combustibles/performance-statistics.ts`).
- **Anomalías**: reglas configurables con casos investigables (`db/schema/fuel-anomalies.ts:9-60`, `lib/combustibles/anomaly-rule-catalog.ts:22-72`, `app/(app)/combustibles/anomalias/**`).
- **Telemetría**: integración GPS OnWay (posición, viajes, horómetro), sin consumo de combustible ni ralentí agregado (`lib/integrations/onway/onway-sync.ts:91-333`, `db/schema/fleet-gps.ts:92-210`).

### Defectos encontrados en lo existente

| Código | Defecto | Evidencia | Acción |
|---|---|---|---|
| D-1 | **El rendimiento mostrado como verdad es el digitado en la planilla.** El log operacional guarda «Rendimiento» y «Tipo de rendimiento» tal como vienen (defecto 1 del tablero, replicado). | `lib/combustibles/operations-import.ts:1-8,233-234`, `app/(app)/combustibles/actions-operaciones.ts:391-392`, mostrado en `lib/combustibles/operations-dashboard.ts:98-101` y `lib/combustibles/fuel-log.ts:307-308` | Calcular en servidor; el valor digitado queda como «declarado» solo para contraste. |
| D-2 | **Las cargas TAE y de facturación no calculan rendimiento.** | `lib/combustibles/equipment-performance.ts:4-9`, `lib/combustibles/fuel-log.ts:147,228`, `lib/combustibles/anomaly-detector.ts:192-199` | Serie canónica por equipo con rendimiento calculado. |
| D-3 | **Desviación estándar poblacional (÷n)**; con n=1 muestra 0. | `lib/combustibles/performance-statistics.ts:8-10,48-53` | Desviación muestral (n−1); con n<2 se muestra «—». |
| D-4 | **La fecha y hora de la carga en terreno la pone el dispositivo.** | `app/(public)/tae/tae-form.tsx:255`, `lib/services/fuel-tae.ts:242` | La sella el servidor; la hora del dispositivo queda solo para envíos encolados sin conexión. |
| D-5 | **El operador no digita el odómetro/horómetro**: el formulario envía `meterReading: null` y la lectura sale solo del OCR de la foto. | `app/(public)/tae/tae-form.tsx:262`, `app/api/tae/submit/route.ts:90-91` | Campo numérico obligatorio; OCR queda como sugerencia. |
| D-6 | **El retroceso de medidor en terreno no se rechaza**, solo alerta. | `lib/services/fuel-tae.ts:658-668` | Rechazo en servidor; la excepción es la corrección auditada existente. |
| D-7 | **Litros sobre la capacidad del estanque no se validan al ingresar** (tope fijo de 2.000 L). | `lib/validation/fuel-tae.ts:24`, `lib/combustibles/anomaly-detector.ts:302-337` | Validar contra `fuel_vehicles.tank_capacity_liters`. |
| D-8 | **No se rechazan valores de relleno** (sellos `777777`/`666666`, fecha `1899-12-30`). | Sin coincidencias de `777777|666666|1899-12-30` fuera de `lib/combustibles/tae-receipt-import.ts:45` | Validación estricta en terreno e importadores. |
| D-9 | **Las fotos de sello se exigen aun cuando no hay sello** y se justificó con motivo. | `lib/validation/fuel-tae.ts:5`, `app/api/tae/submit/route.ts:69-73`, `lib/services/fuel-tae.ts:190-194` | Foto de sello obligatoria solo si se informa el número. |
| D-10 | **Nombres de conductor y supervisor visibles para cualquiera con `combustibles:view`.** | `app/(app)/combustibles/bitacora/bitacora-table.tsx:50-51`, `app/(app)/combustibles/bitacora/page.tsx:55`, `app/(app)/combustibles/bitacora/actions.ts:171-172,210` | Permiso nuevo `combustibles:view_personal`. |
| D-11 | **Filtro «unidad de rendimiento» de la bitácora descarta todo el log operacional**: compara `km_lt|lt_hr` con `km_per_liter|liters_per_hour`. | `lib/combustibles/fuel-log.ts:355`, `lib/combustibles/operations-import.ts:16,115-116`, `app/(app)/combustibles/bitacora/page.tsx:73` | Mapear la unidad antes de comparar. |
| D-12 | **`/combustibles/analisis` pasa una función de un Server Component a un Client Component** (`drilldownHref`), lo que Next.js rechaza al renderizar. | `app/(app)/combustibles/analisis/page.tsx:124`, `app/(app)/combustibles/analisis/performance-charts.tsx:29`, `app/(app)/combustibles/analisis/analysis-charts-lazy.tsx:9-12` | Pasar hrefs precalculados (datos serializables). Verificar en navegador. |
| D-13 | **Cargadores contados en dos familias** (preset «cargadores y camionetas» y preset «heavy»). | `lib/combustibles/equipment-performance.ts:33-43` | Familia como atributo administrable del tipo de equipo. |
| D-14 | **Tolerancia del ciclo fija en código** (2 % y 5 %), marcada como pendiente. | `lib/combustibles/fuel-cycle.ts:12-18` | Tolerancia por mandante, administrable. |
| D-15 | **Las filas rechazadas del log operacional no se guardan** (solo el conteo). | `app/(app)/combustibles/actions-operaciones.ts:311,426` | Persistir rechazos con motivo. |

## 2. Matriz de brechas

Estados: **Existe**, **Parcial**, **Falta**, **Incorrecto** (existe pero contradice la especificación).

### Dimensiones transversales

| ID | Capacidad | Estado | Evidencia | Acción |
|---|---|---|---|---|
| X-01 | Faena como catálogo administrable | Existe | `db/schema/worksites.ts:7-33`; `/admin/faenas` (`app/(app)/admin/faenas/worksite-form.tsx:50-102`) | Reutilizar. |
| X-02 | Mandante como catálogo administrable | Falta | `worksites` no tiene mandante (`db/schema/worksites.ts:7-33`); `clients` solo se usa en facturación, vía `contracts.worksiteId` opcional (`db/schema/clients.ts:10-12,92-99`); ningún archivo de combustibles referencia `clients` | Crear `fuel_mandantes` (con vínculo opcional a `clients`) y su relación con faenas, con tolerancia. |
| X-03 | Medio de suministro como catálogo | Falta | Valores repartidos en `CHECK` y constantes: `db/schema/fuel-invoices.ts:56-58`, `db/schema/fuel-integrations.ts:34,193`, `lib/combustibles/fuel-sources.ts:28-47`; CMPC no existe en el código | Crear `fuel_supply_media` con alias y mapeo a canal de proveedor. |
| X-04 | Lugar de carga (surtidor, estanque camioneta, bidón, estación con tarjeta) | Parcial | `fuel_tae_loading_points.type` admite `fixed_dispenser|truck_dispenser|pickup_tank|tae|other` (`db/schema/fuel-tae.ts:47`), sin bidón ni estación con tarjeta; la UI siempre envía `tae` (`app/(app)/combustibles/tae/tae-access-panel.tsx:54`) | Agregar `jerrycan` y `card_station`; elegir tipo en la UI. |
| X-05 | Tipo de equipo | Parcial | Sembrados en `db/migrations/0043_awesome_fat_cobra.sql:38-50`: falta **grúa**; «cargador» genérico | Agregar `grua`; renombrar el nombre visible de `cargador` a «Cargador frontal» no es necesario (el catálogo es administrable). |
| X-06 | Tipo de rendimiento por equipo, no por carga | Parcial | `fuel_vehicles.performance_unit` existe (`db/schema/fuel-vehicles.ts:17`); el par medidor/unidad solo se valida en Zod (`lib/combustibles/validation.ts:320-334`); el log operacional lo toma de la fila (`lib/combustibles/operations-import.ts:233-234`) | El cálculo usa siempre la unidad del equipo; la de la fila se ignora. |
| X-07 | Familia de equipos para las vistas R | Incorrecto | Presets en código con cargadores duplicados (`lib/combustibles/equipment-performance.ts:33-43`) | Columna `performance_family` en `fuel_equipment_types`. |
| X-08 | Tiempo: año, mes, rango | Parcial | Solo rango Desde/Hasta (`app/(app)/combustibles/consumption-filters.tsx:122-140`) | Filtros año + meses múltiples + faena en URL. |

### G — Vista general

| ID | Capacidad | Estado | Evidencia | Acción |
|---|---|---|---|---|
| G-01 | Filtros año, mes (multi), faena, limpiar; en la URL | Parcial | Rango de fechas y faena única, con chips y URL (`app/(app)/combustibles/consumption-filters.tsx:33-43,86-151`, `app/(app)/combustibles/consumption-url.ts:7-23`); sin año ni meses múltiples | Filtros nuevos sobre `useUrlFilters`. |
| G-02 | Litros por mes por medio de suministro | Falta | Evolución por período de importación con una sola serie (`lib/combustibles/consumption-dashboard.ts:152-158`, `app/(app)/combustibles/consumption-charts.tsx:82-139`) | Barras apiladas por mes y medio. |
| G-03 | Tabla faena × medio, equipos KM/LT, con totales | Falta | Lo más cercano es una lista de barras por faena y canal, top 8, sin totales (`app/(app)/combustibles/fuel-control-overview.tsx:90-117`, `lib/combustibles/fuel-control-overview.ts:76-92`) | Tabla cruzada calculada en SQL. |
| G-04 | Ídem para LT/HR | Falta | Ídem | Ídem. |
| G-05 | Ranking de faenas por litros, uno por tipo de rendimiento | Parcial | Barras horizontales por faena desde texto libre, ordenadas por monto si hay permiso de costos, sin separar unidad (`app/(app)/combustibles/page.tsx:584-592`, `lib/combustibles/operations-dashboard.ts:112-118,155-156`) | Dos rankings por litros. |
| G-06 | Serie mensual km vs litros con km/L global | Falta | Solo dispersión litros vs lectura absoluta (`lib/combustibles/operations-dashboard.ts:177-208`, `app/(app)/combustibles/scatter-charts.tsx:29,37`) | Serie mensual de Δodómetro y litros. |
| G-07 | Serie mensual horas vs litros con L/h global | Falta | Ídem | Serie mensual de Δhorómetro y litros. |

### R — Rendimiento por familia

| ID | Capacidad | Estado | Evidencia | Acción |
|---|---|---|---|---|
| R-01 | Filtros año, mes o rango, tipo de rendimiento, faena, medio, código | Parcial | Presets, agrupar, faena única, desde/hasta (`app/(app)/combustibles/analisis/page.tsx:25,86-101`); la faena es la **actual** del equipo, no la de la carga (`lib/combustibles/equipment-performance.ts:99,107,118,136`) | Filtros nuevos sobre la faena de la carga. |
| R-02 | Por faena: promedio, desviación muestral, indicador de dispersión | Incorrecto | Desviación poblacional (`lib/combustibles/performance-statistics.ts:48-53`) | Desviación muestral calculada en SQL (`stddev_samp`). |
| R-03 | Por equipo: faena, código, patente, marca, modelo, tipo, unidad, promedio, desviación | Parcial | Fila «código · patente» sin faena, marca, modelo ni tipo (`app/(app)/combustibles/analisis/page.tsx:157-161`) | Tabla completa paginada. |
| R-04 | Promedio vs desviación por faena (dos ejes) | Parcial | Barra con error simétrico en un solo eje (`app/(app)/combustibles/analisis/performance-charts.tsx:35-95`) y probable caída por D-12 | Gráfico de dos ejes. |
| R-05 | Detalle de cargas de esa familia | Parcial | Enlace a la bitácora sin filtro de familia (`app/(app)/combustibles/analisis/page.tsx:41-46`); rendimiento nulo para TAE (`lib/combustibles/fuel-log.ts:147-148`) | Detalle paginado filtrado por familia. |
| R-06 | Equipo vs promedio del mismo modelo y vs su histórico | Parcial | Variación contra el período anterior y rango del `comparisonGroup` libre (`lib/combustibles/equipment-performance.ts:166-219`); el modelo no se usa | Columnas vs modelo y vs histórico de 12 meses. |

### C — Control de cargas con sello, por mandante

| ID | Capacidad | Estado | Evidencia | Acción |
|---|---|---|---|---|
| C-01 | Registro en terreno con todos los campos, hora sellada por servidor, borrador y reenvío, idempotencia | Parcial | PWA, cola offline e idempotencia existen (ver §1); faltan medio de suministro, lectura digitada (D-5), hora de servidor (D-4), capacidad (D-7), rechazo de relleno (D-8) y diseño de pasos grandes (solo el botón de envío es grande, `app/(public)/tae/tae-form.tsx:390`) | Formulario por pasos, campos y validaciones nuevas; registro autenticado además del QR. |
| C-02 | Conciliación por mandante: entrada → directo / vía estanque → diferencia abs y % | Parcial | Ciclo por faena con recibido/entregado y diferencia (`lib/combustibles/fuel-cycle.ts:76-131`); sin mandante, tolerancia fija (D-14), sin alertas | Conciliación por mandante con tolerancia administrable y alerta. |
| C-03 | Cruce control manual vs proveedor/tarjeta | Incorrecto | TAE y TCT se **suman** como canales (`lib/combustibles/tae-copec-reconciliation.ts:69-81`); la página declara que no hay diferencia contable (`app/(app)/combustibles/tae/conciliacion/page.tsx:44`) | Cruce por medio de suministro con diferencia. |
| C-04 | Total de cargas por supervisor | Existe | `lib/combustibles/tae-dashboard.ts:27-61`, `app/(app)/combustibles/tae/page.tsx:148-151` (agrupa por nombre libre) | Reutilizar la consulta, parametrizada por mandante. |
| C-05 | Iniciadas sin sello, por supervisor | Falta | Solo un filtro combinado (`app/(app)/combustibles/tae/actions.ts:194`) | Agregado por supervisor. |
| C-06 | Terminadas sin sello, por supervisor, con observación | Parcial | Motivo obligatorio (`lib/validation/fuel-tae.ts:29-33`); sin agregado | Agregado por supervisor con motivos. |
| C-07 | Detalle por equipo con todas las columnas y fotos | Parcial | Bitácora y detalle TAE (`app/(app)/combustibles/tae/[id]/page.tsx:36-41`, `app/(app)/combustibles/bitacora/bitacora-table.tsx:187-188`); sin filtro por equipo | Detalle por mandante y equipo con enlace a fotos. |
| C-08 | Cadena de sellos (sello roto = sello nuevo de la carga anterior del equipo o estanque) | Parcial | Alerta calculada al ver, solo por equipo (`lib/services/fuel-tae.ts:652-657,750-772`) | Estado persistido al registrar, por equipo y por estanque, auditado. |

### V — Ralentí

| ID | Capacidad | Estado | Evidencia | Acción |
|---|---|---|---|---|
| V-01 | % ralentí promedio por equipo y mes, total | Falta | Única fuente: `fleet_gps_trips.idle_duration` como texto, sin lectores (`db/schema/fleet-gps.ts:195`) | Telemetría diaria importada por archivo. |
| V-02 | % máximo y mínimo | Falta | Ídem | Ídem. |
| V-03 | Horas de funcionamiento por equipo y mes | Parcial | Solo el horómetro acumulado de OnWay (`db/schema/fleet-gps.ts:113`, `lib/integrations/onway/onway-sync.ts:180-196`) | Ídem. |
| V-04 | Horas promedio trabajando y en vacío | Falta | Ídem | Ídem. |
| V-05 | Litros trabajando y en vacío | Falta | OnWay no trae consumo, solo nivel % (`db/schema/fleet-gps.ts:118`) | Ídem. |
| V-06 | Gráfico mensual horas trabajando/vacío, litros en vacío y % | Falta | Ningún gráfico lee `fleet_gps_*` | Ídem. |
| V-07 | Gráfico diario horas con % en vacío | Falta | Ídem | Ídem. |
| V-08 | L/h de telemetría vs rendimiento calculado de cargas | Parcial | Solo la mitad de cargas (`lib/combustibles/equipment-performance.ts:26`) | Contraste por equipo y mes. |
| V-09 | Días con mayor % en vacío | Falta | Sin agregación diaria; los puntos GPS se borran a los 30 días (`lib/integrations/onway/onway-retention.ts:22-28`) | Listado desde la telemetría diaria. |

### Ingesta, exportación y transversales

| ID | Capacidad | Estado | Evidencia | Acción |
|---|---|---|---|---|
| I-01 | Histórico de la planilla de cargas (~8.000 filas) con normalización y filas inválidas marcadas | Parcial | Importador del log operacional con vista previa, hash y llave de fila (`app/(app)/combustibles/actions-operaciones.ts:117-209,271-285`); filas rechazadas no persistidas (D-15); rendimiento digitado (D-1) | Proyectar a la serie canónica con cálculo y marcas; persistir rechazos; plantilla. |
| I-02 | Movimientos de tarjeta/proveedor | Parcial | Copec TCT/TAE y Aramco ya sincronizan (`lib/combustibles/copec-sync.ts:1044`, `lib/combustibles/aramco-sync.ts:259`); no hay archivo para CMPC ni otros | Reutilizar sync; importador por archivo para el resto. |
| I-03 | Telemetría por archivo | Falta | Sin importador (`db/schema/fuel-meter-readings.ts:51` solo admite `copec_tct|aramco|gps_onway`) | Importador con plantilla. |
| I-04 | Fotos de sellos históricas preparadas como referencia | Existe | `fuel_tae_evidence.external_url` (`db/schema/fuel-tae.ts:191`) y columnas «Imagen …» del importador (`lib/combustibles/tae-import.ts:38-83`) | Sin cambios. |
| I-05 | Plantillas descargables | Falta | No hay plantillas de importación de combustibles | Plantilla por importador nuevo y por el log operacional. |
| E-01 | Exportación de cada tabla con filtros | Parcial | Solo bitácora y facturas (`app/(app)/combustibles/bitacora/export-button.tsx:7-12`, `app/(app)/combustibles/actions-module/export.ts:23-127`) | Exportación Excel de cada tabla nueva. **CSV no**: lo prohíbe la regla de exportación del repositorio. |
| A-01 | Toda escritura auditada | Parcial | Altas, revisiones y correcciones TAE auditadas (`lib/services/fuel-tae.ts:290-304,595-596`, `app/(app)/combustibles/tae/actions.ts:156-167`); la reversión de lotes TAE borra cargas (`app/(app)/combustibles/tae/importar/actions.ts:162-179`) | Auditar las escrituras nuevas; las cargas del submódulo se anulan, no se borran. |
| P-01 | Datos personales y fotos solo para roles autorizados | Parcial | Fotos por endpoint autenticado con `tae_view` (`app/api/tae/evidence/[id]/route.ts:18`); nombres sin control (D-10) | Permiso `view_personal` en fotos, nombres y exportaciones. |

## 3. Catálogos y entidades

| Entidad | Decisión | Detalle |
|---|---|---|
| Faena (`worksites`) | **Reutilizar** | Eje de alcance de permisos en toda la plataforma (`db/schema/clients.ts:10-12`). |
| Mandante | **Crear** `fuel_mandantes` + `fuel_mandante_worksites` | Nombre, cliente opcional (`clients.id`), tolerancia de conciliación en %, activo. Una faena pertenece a lo más a un mandante de control. Se crea en combustibles y no en `worksites` para no imponer un eje comercial a módulos que no lo necesitan; el vínculo a `clients` evita duplicar el cliente. |
| Medio de suministro | **Crear** `fuel_supply_media` | Nombre, tipo (`card`, `provider_station`, `mandante_dispenser`, `own_tank`, `other`), proveedor de combustible opcional, canal de integración opcional (`copec`/`aramco` + `TCT`/`TAE`) para leer el libro de transacciones existente, alias para normalizar «Suministro entregado por». Se siembran TCT, TAE, CMPC, Aramco y Copec como datos de catálogo (no RBAC). |
| Lugar de carga | **Extender** `fuel_tae_loading_points.type` | Se agregan `jerrycan` (bidón) y `card_station` (estación con tarjeta). |
| Tipo de equipo | **Extender** `fuel_equipment_types` | Columna `performance_family` (`camiones`, `cargadores_camionetas`, `maquinaria`, nula = fuera de las vistas R) y tipo `grua`. |
| Equipo (`fuel_vehicles`) | **Reutilizar** | Ya tiene código, patente, marca, modelo, tipo, faena, medidor, unidad y capacidad de estanque. |
| Trabajadores (`workers`) | **Reutilizar** | Conductor y supervisor por RUT verificado o nombre manual, como hoy (`lib/services/fuel-tae.ts:73-81`). |
| Proveedores (`fuel_suppliers`) | **Reutilizar** | Los medios de suministro apuntan a ellos. |
| Carga de equipo | **Crear** `fuel_equipment_loads` | Ver §6. Es la serie canónica por equipo de la que salen G, R y la revisión. **Por qué no reutilizar una tabla existente:** `fuel_loads` es facturación (IVA, IEC, proveedor obligatorio, se borra físicamente, `app/(app)/combustibles/actions-module/loads.ts:463`); `fuel_operation_records` y `fuel_tae_submissions` son dos orígenes distintos de la misma realidad física y ninguno contiene al otro; `fuel_meter_readings` declara expresamente que no es una carga (`db/schema/fuel-meter-readings.ts:16-23`). Sin una serie única, el rendimiento de un equipo cargado por ambos canales no se puede calcular. Es una proyección idempotente, el mismo patrón que Copec → `fuel_cycle_movements`. |
| Entradas reportadas por surtidor o tarjeta | **Crear** `fuel_supply_inputs` (+ lotes) | Para medios sin integración (surtidor CMPC y otros). Copec y Aramco se leen del libro existente `fuel_provider_transactions`. |
| Telemetría diaria | **Crear** `fuel_telemetry_daily` (+ lotes) | Una fila por equipo, día y fuente; idempotente. |
| Filas rechazadas de importación | **Crear** `fuel_control_import_rejections` | Común a log operacional, telemetría y entradas. La de TAE se mantiene. |
| Umbrales | **Reutilizar** + `system_settings` | El umbral de atípicos (σ) sale de la regla existente `rendimiento_fuera_historico` (`lib/combustibles/anomaly-rule-catalog.ts:23`), con sus excepciones por tipo de equipo; muestras mínimas y cotas de plausibilidad en la clave `combustibles.control.performance`. |

## 4. Fuentes de datos

| Fuente | Hoy | Cómo entra al submódulo |
|---|---|---|
| Planilla histórica de cargas | Importador del log operacional (`app/(app)/combustibles/importar/operations-import-wizard.tsx`) | Mismo importador. Al confirmar, cada fila válida se proyecta a `fuel_equipment_loads` con rendimiento calculado y marcas de revisión; las filas que no se pueden convertir en carga quedan en `fuel_control_import_rejections`. Plantilla descargable. |
| Formulario de sellos (histórico) | Importador TAE (`lib/combustibles/tae-import-service.ts:236`) | Sin cambios de formato; cada carga importada también se proyecta. |
| Formulario de sellos (en adelante) | PWA por QR | PWA rediseñada + registro autenticado en `/combustibles/control/registrar`. Ambos llaman al mismo servicio y se proyectan al confirmar. |
| Copec TCT/TAE | Sync por portal (cron 05:30) | Se lee del libro `fuel_provider_transactions` vía el mapeo del medio. Se reutiliza; no se toca el scraper. |
| Aramco | Sync por API | Ídem. |
| Surtidor CMPC y otros sin integración | No existe | Importador de entradas por archivo con plantilla. |
| Telemetría (VisionLink u otra) | No existe | Importador diario por archivo con plantilla. OnWay no aporta consumo ni ralentí diario. |

## 5. Decisiones abiertas y supuestos

| # | Decisión | Supuesto adoptado |
|---|---|---|
| S-1 | Formato real de la exportación de VisionLink | Una fila por equipo y día: `Equipo` (código interno o patente), `Fecha`, `Horas funcionamiento`, `Horas en vacío`, `Litros trabajando`, `Litros en vacío`. Si el archivo trae litros totales en vez de litros trabajando, el importador acepta `Litros totales` y deriva `trabajando = total − vacío`. Plantilla descargable. |
| S-2 | Formato del archivo de surtidor CMPC u otro medio sin integración | Una fila por despacho: `Fecha`, `Faena`, `Litros`, `Referencia` (guía o folio, llave de idempotencia junto al medio), `Patente o estanque` opcional. Plantilla descargable. |
| S-3 | Qué cuenta como «entregado directo» y «vía estanque» (C-02) | Según el tipo del punto de carga de la carga en terreno: `fixed_dispenser` y `card_station` = directo; `pickup_tank`, `truck_dispenser` y `jerrycan` = vía estanque. Las cargas de tipo `tae` u `other` cuentan como directo y se rotulan. |
| S-4 | Método de rendimiento | Tanque lleno, como pide la especificación, extendido igual que el código actual (`lib/combustibles/meter-performance.ts:67-164`): si cargas intermedias no traen lectura, los litros se acumulan desde la última carga con lectura. Con lecturas consecutivas el resultado es idéntico a la fórmula de la especificación. |
| S-5 | Hora sellada por servidor vs. cola offline | Envío en línea: la hora es la del servidor. Envío desde la cola sin conexión: se guarda la hora del dispositivo, acotada a la ventana existente (30 días atrás, 15 min adelante, `lib/services/fuel-tae.ts:44-45`), y se marca como «hora del dispositivo»; el servidor siempre sella además su hora de recepción. Reordenar la serie con la hora de recepción produciría retrocesos falsos de medidor. |
| S-6 | Lectura menor a la anterior en terreno | Se rechaza en servidor con un mensaje para el operador. La corrección (cambio de tablero o de equipo) la hace un revisor con el diálogo auditado existente, que ahora marca la carga como «reinicio de medidor» y parte la serie. |
| S-7 | Duplicado entre la planilla consolidada y el formulario de sellos | La misma carga física puede llegar por ambos canales. Al proyectar, una carga del mismo equipo dentro de ±15 minutos y con ±0,5 L de diferencia se marca como duplicada de la primera y se excluye de los cálculos (visible y reversible en la cola de revisión). |
| S-8 | Familia de la grúa | Las tres vistas R de la especificación no incluyen grúas. `grua` se siembra sin familia; el catálogo permite asignarla. |
| S-9 | Asignación de permisos a roles | Ver §7. Supuesto: la jefatura (`jefa_chome`) aprueba atípicos y ve datos personales; los umbrales y catálogos de control solo `administrador`, igual que hoy las reglas de anomalías (`modules/combustibles/manifest.ts:95-147`). |
| S-10 | Exportación CSV | No se implementa: la regla de exportación del repositorio exige Excel (`AGENTS.md`, «Export Format Rule»). |
| S-11 | Mandantes iniciales | No se siembran: la relación faena→mandante es un dato de negocio que el código no conoce. Se cargan desde la pantalla de configuración. |
| S-12 | Alcance de faena en la vista por mandante | Un usuario solo ve las faenas de su alcance; los totales del mandante se rotulan como «en tus faenas» cuando el alcance es parcial. |
| S-13 | Carga con valor de relleno (fecha 1899-12-30, sello 777777) importada del histórico | Queda en la cola de revisión con la marca «valor de relleno» y **fuera del recorrido de la serie** mientras no se apruebe: con fecha inventada se ordena primero y, si trae lectura alta, todas las cargas siguientes del equipo saldrían como retroceso falso. Aprobada, vuelve a la serie (`lib/combustibles/control/calc/performance-series.ts:146-147`). |
| S-14 | Familias de equipos | Camiones = camión, tracto, camión 3/4; cargadores y camionetas = cargador, camioneta, station wagon; maquinaria = retroexcavadora, excavadora, minicargador, tractor, bulldozer. `estanque`, `hidrolavadora` y `grua` quedan sin familia (administrable en Configuración). |
| S-15 | Lectura regresiva en terreno | Se compara contra las cargas en terreno del mismo equipo (`fuel_tae_submissions`), no contra la planilla importada: un dato erróneo del histórico no debe bloquear a un operador. La serie canónica sí marca el retroceso entre canales para revisión. |
| S-16 | Ralentí con dos fuentes para el mismo equipo y día | Se usa la fuente con más horas de funcionamiento; no se suman (`lib/combustibles/control/queries/idle.ts:36-55`). |

## 6. Diseño de cálculo

**Serie por equipo.** Para cada `fuel_equipment_loads` no anulada, no duplicada y no rechazada, ordenada por `occurred_at`:

- `km_per_liter`: (lectura − lectura ancla) ÷ litros acumulados desde el ancla (incluida esta carga).
- `liters_per_hour`: litros acumulados ÷ (lectura − lectura ancla).
- La unidad y el tipo de medidor son los del **equipo**, nunca los de la fila.
- Estado de cálculo: `computed`, `first_load` (sin ancla), `no_meter`, `meter_regression` (lectura < ancla sin reinicio declarado), `meter_reset` (corrección auditada que parte la serie), `zero_delta`, `not_applicable`.

**Marcas de revisión** (`review_status`): `ok`, `flagged`, `approved`, `rejected`. Una carga queda `flagged` por: retroceso de medidor, valor de relleno, litros sobre capacidad, rendimiento implausible o rendimiento atípico. Atípico = |x − media| > k·σ de las cargas previas del mismo equipo en estado `ok`/`approved` (σ muestral, mínimo de muestras configurable); k sale de la regla `rendimiento_fuera_historico`. Las decisiones humanas (`approved`/`rejected`) son persistentes; si cambian la lectura o los litros de esa carga, vuelve a evaluarse y queda auditado.

**Estadística de las vistas.** Promedio y desviación muestral (`avg`, `stddev_samp` en SQL) sobre cargas `computed` con `review_status IN ('ok','approved')`. Con n < 2 la desviación se muestra «—». Cada vista indica cuántas cargas excluyó por estar en revisión.

**Conciliación por mandante.** Entrada = medios del mandante (entradas importadas + transacciones del libro de proveedores mapeadas) en sus faenas; entregado = cargas en terreno no anuladas en esas faenas, separadas en directo y vía estanque (S-3); diferencia = entrada − (directo + estanque), absoluta y %. Alerta si |%| > tolerancia del mandante.

**Ralentí.** % vacío = horas en vacío ÷ horas de funcionamiento, siempre recalculado desde horas crudas (el promedio mensual es la razón de sumas, y además se reporta el promedio, máximo y mínimo de los % diarios).

## 7. Permisos nuevos

| Permiso | Para qué | Roles por defecto |
|---|---|---|
| `combustibles:register_load` | Registrar carga desde la app autenticada y su API | `administrador`, `jefa_chome`, `jefe_mantencion`, `admin_contrato` |
| `combustibles:approve_flagged` | Aprobar o rechazar cargas marcadas y duplicados | `administrador`, `jefa_chome` |
| `combustibles:view_personal` | Ver nombres de conductor y supervisor y las fotos | `administrador`, `jefa_chome` |
| `combustibles:manage_control` | Administrar mandantes, medios de suministro, familias y umbrales | `administrador` |

Se reutilizan: `combustibles:view` (vistas G, R, V y revisión de solo lectura), `combustibles:tae_view` (vistas C), `combustibles:tae_review` (anular, observar, corregir medidor), `combustibles:import` (importadores nuevos), `combustibles:export` (exportaciones sin datos personales; con nombres exige además `view_personal`).

## 8. Plan de implementación (por dependencias)

| Paso | Contenido | Archivos principales |
|---|---|---|
| 1 | Esquema y migración: catálogos (`fuel_mandantes`, `fuel_mandante_worksites`, `fuel_supply_media`), `fuel_equipment_loads`, `fuel_supply_inputs` + lotes, `fuel_telemetry_daily` + lotes, `fuel_control_import_rejections`; extensiones de tipos de equipo, puntos de carga y cargas TAE; índices por equipo+fecha, faena+fecha, medio+fecha; siembra de medios, familia y `grua` | `db/schema/fuel-control.ts` (nuevo), `db/schema/fuel-equipment-types.ts`, `db/schema/fuel-tae.ts`, `db/schema/index.ts`, `db/migrations/0359_*.sql` |
| 2 | Permisos y navegación | `modules/combustibles/manifest.ts`, pruebas de paridad |
| 3 | Cálculo puro con pruebas: serie de rendimiento, estadística muestral, atípicos, valores de relleno, cadena de sellos, conciliación, ralentí | `lib/combustibles/control/*.ts` |
| 4 | Proyección y revisión: proyectar log operacional y cargas TAE, recalcular serie, aprobar/rechazar, auditoría | `lib/combustibles/control/projection*.ts`, `review.ts` |
| 5 | Escritura en terreno: validaciones nuevas, hora de servidor, lectura digitada, medio, cadena de sellos persistida, formulario por pasos, registro autenticado y su API; división de `lib/services/fuel-tae.ts` (772 líneas) | `lib/services/fuel-tae*.ts`, `app/(public)/tae/**`, `app/api/combustibles/cargas/route.ts`, `app/(app)/combustibles/control/registrar/**` |
| 6 | Importadores: log operacional → proyección + rechazos + plantilla (división de `actions-operaciones.ts`, 558 líneas); telemetría; entradas de suministro | `app/(app)/combustibles/actions-operaciones*.ts`, `app/(app)/combustibles/control/importar/**`, `lib/combustibles/control/import-*.ts` |
| 7 | Vistas G y R con consultas agregadas en SQL, estados de carga/vacío/error y exportación | `app/(app)/combustibles/control/page.tsx`, `.../rendimiento/[familia]/**`, `lib/combustibles/control/queries-*.ts` |
| 8 | Vistas C (por mandante) y V | `.../control/sellos/**`, `.../control/ralenti/**` |
| 9 | Revisión de cargas marcadas y configuración | `.../control/revision/**`, `.../control/configuracion/**` |
| 10 | Datos personales: permiso en fotos, bitácora y exportaciones; correcciones D-11 y D-12 | `app/api/tae/evidence/[id]/route.ts`, `lib/combustibles/fuel-log.ts`, `app/(app)/combustibles/bitacora/**`, `app/(app)/combustibles/analisis/**` |
| 11 | Pruebas unitarias, PGlite, E2E; suite completa, lint, tipos, build | `lib/combustibles/control/*.test.ts`, `lib/__tests__/fuel-control-*.test.ts`, `e2e/combustibles-control.spec.ts` |

## 9. Estado final por ID (cierre, 2026-10-22)

Estados: **Implementado**, **Pendiente**, **Fuera de alcance**. La evidencia apunta a donde quedó cada capacidad.

### Dimensiones transversales

| ID | Estado | Dónde quedó |
|---|---|---|
| X-01 Faena | Implementado (reutilizada) | `worksites`; alcance con `worksiteScopeSql` en `lib/combustibles/control/filters.ts:138` |
| X-02 Mandante | Implementado | `db/schema/fuel-control.ts:17-40` (mandante y sus faenas); administración en `app/(app)/combustibles/control/configuracion/mandantes-section.tsx` |
| X-03 Medio de suministro | Implementado | `db/schema/fuel-control.ts:42-62`, siembra en `db/migrations/0359_fuel_control.sql` (final); administración en `configuracion/supply-media-section.tsx` |
| X-04 Lugar de carga | Implementado | `db/schema/fuel-tae.ts:48` (`jerrycan`, `card_station`); selector en `app/(app)/combustibles/tae/tae-access-panel.tsx:83` |
| X-05 Tipo de equipo | Implementado | `grua` sembrado en `0359_fuel_control.sql`; catálogo administrable existente |
| X-06 Unidad por equipo | Implementado | La serie usa siempre la del equipo: `lib/combustibles/control/calc/performance-series.ts:89-96` |
| X-07 Familia | Implementado | `db/schema/fuel-equipment-types.ts:14,26`; administración en `configuracion/equipment-families-section.tsx` |
| X-08 Año, mes, rango | Implementado | `lib/combustibles/control/filters.ts:40-67`, `app/(app)/combustibles/control/_components/control-filters.tsx` |

### G — Vista general (`/combustibles/control`)

| ID | Estado | Dónde quedó |
|---|---|---|
| G-01 | Implementado | `_components/control-filters.tsx` (año, meses conmutables, faena, limpiar; todo en la URL) |
| G-02 | Implementado | `lib/combustibles/control/queries/overview.ts:65`, `app/(app)/combustibles/control/page.tsx:137` |
| G-03 | Implementado | `queries/overview.ts:89` (tabla cruzada con totales por fila, columna y general), `_charts/overview-crosstab.tsx`, `page.tsx:145-172` |
| G-04 | Implementado | Mismo componente con `liters_per_hour` (`page.tsx:145-172`) |
| G-05 | Implementado | `_charts/overview-ranking-chart.tsx`, `page.tsx:156` (uno por unidad, por litros) |
| G-06 | Implementado | `queries/overview.ts:130` (Σ avance ÷ Σ litros), `page.tsx:181-202` |
| G-07 | Implementado | Ídem con horómetro |

### R — Rendimiento por familia (`/combustibles/control/rendimiento/[familia]`)

| ID | Estado | Dónde quedó |
|---|---|---|
| R-01 | Implementado | `rendimiento/[familia]/family-filters.tsx` (unidad, medio, equipo, rango) + filtros globales |
| R-02 | Implementado | `lib/combustibles/control/queries/performance.ts:37` (`avg`, `stddev_samp`, CV), `[familia]/stats-tables.tsx` |
| R-03 | Implementado | `queries/performance.ts:124` (paginada), `[familia]/stats-tables.tsx` |
| R-04 | Implementado | `_charts/performance-dispersion-chart.tsx` (promedio en barras, σ en eje derecho) |
| R-05 | Implementado | `lib/combustibles/control/queries/performance-detail.ts:41` (solo la familia, paginado), `[familia]/load-detail-table.tsx` |
| R-06 | Implementado | `queries/performance.ts:124` (promedio del modelo sin el propio equipo y su histórico de 12 meses), `lib/combustibles/control/view-helpers.ts:164-176` («Rinde peor» sobre 10 %) |

### C — Sellos por mandante (`/combustibles/control/sellos?mandante=`)

| ID | Estado | Dónde quedó |
|---|---|---|
| C-01 | Implementado | Formulario por pasos `components/combustibles/field-load/field-load-wizard.tsx`; servicio `lib/services/fuel-tae/submit.ts` (hora de servidor `:84`, lectura y retroceso, capacidad `:125`, sellos `:88`, medio `:105-112`, bloqueo por equipo `:157`); registro autenticado `app/api/combustibles/cargas/route.ts:25-43` y `app/(app)/combustibles/control/registrar/` |
| C-02 | Implementado | `lib/combustibles/control/queries/reconciliation.ts:112`, `lib/combustibles/control/calc/reconciliation.ts:21`, alerta en `control/sellos/flow-section.tsx` |
| C-03 | Implementado | `queries/reconciliation.ts:167`, `control/sellos/medium-section.tsx` |
| C-04 | Implementado | `lib/combustibles/control/queries/seals.ts:43` |
| C-05 | Implementado | `queries/seals.ts:43` (sin sello retirado por supervisor) |
| C-06 | Implementado | `queries/seals.ts:43,67` (sin sello nuevo, con las justificaciones), `control/sellos/supervisors-section.tsx` |
| C-07 | Implementado | `queries/seals.ts:132` (paginado), fotos solo con `view_personal` en `control/sellos/detail-section.tsx:83` |
| C-08 Cadena de sellos | Implementado (por equipo) | `lib/combustibles/control/seal-chain.ts:16`, persistida al registrar en `lib/services/fuel-tae/submit.ts:167`. Un estanque registrado como equipo (tipo `estanque`) tiene su propia cadena; los estanques del ciclo (`fuel_storage_locations`) no llevan sello en el modelo. |

### V — Ralentí (`/combustibles/control/ralenti`)

| ID | Estado | Dónde quedó |
|---|---|---|
| V-01 a V-05 | Implementado | `lib/combustibles/control/queries/idle.ts:123,149`, `control/ralenti/equipment-month-table.tsx` (con total general) |
| V-06 | Implementado | `_charts/idle-monthly-chart.tsx`, `_charts/idle-liters-chart.tsx` |
| V-07 | Implementado | `queries/idle.ts:181`, `_charts/idle-daily-chart.tsx` |
| V-08 | Implementado | `lib/combustibles/control/queries/idle-comparison.ts:28` |
| V-09 | Implementado | `queries/idle.ts:190` |

### Ingesta, exportación y transversales

| ID | Estado | Dónde quedó |
|---|---|---|
| I-01 Histórico de cargas | Implementado | Proyección `app/(app)/combustibles/actions-operaciones.ts:296`; rechazos persistidos `:308` y `lib/combustibles/operations-import-rejections.ts:24`; plantilla `lib/combustibles/operations-import-template.ts:31`; reversión `app/(app)/combustibles/actions-operaciones-batch.ts:32`; respaldo de lo ya cargado: `scripts/backfill-fuel-equipment-loads.ts` (corre al final de `db:migrate`) |
| I-02 Proveedores y tarjetas | Implementado | Copec y Aramco se leen del libro existente (`queries/reconciliation.ts`); el resto por archivo: `lib/combustibles/control/imports/service.ts:209,263` |
| I-03 Telemetría | Implementado | `lib/combustibles/control/imports/telemetry.ts`, mismo servicio |
| I-04 Fotos históricas | Fuera de alcance | Campo listo: `fuel_tae_evidence.external_url` (`db/schema/fuel-tae.ts:204`) |
| I-05 Plantillas | Implementado | `lib/combustibles/control/imports/templates.ts:75`, `lib/combustibles/operations-import-template.ts:31` |
| E-01 Exportación | Implementado (Excel) | `control/export-overview-actions.ts`, `control/rendimiento/export-actions.ts`, `control/sellos/export-actions.ts`, `control/ralenti/export-actions.ts`. CSV fuera de alcance por la regla del repositorio (S-10). |
| A-01 Auditoría | Implementado | Revisión `lib/combustibles/control/review.ts:20`; umbrales `lib/combustibles/control/settings.ts:90`; importaciones y reversiones en `imports/service.ts`; catálogos en `configuracion/actions.ts`; cadena rota y decisiones reiniciadas en `lib/combustibles/projection-audit.ts`. Las cargas del submódulo se anulan, nunca se borran. |
| P-01 Datos personales | Implementado | Fotos `app/api/tae/evidence/[id]/route.ts:22`; bitácora `lib/combustibles/fuel-log.ts:36-42`; exportación TAE `app/(app)/combustibles/tae/actions.ts:206-208`; agrupaciones `lib/combustibles/tae-dashboard.ts:53` |

### Defectos de §1

D-1 a D-15 corregidos. D-11 en `lib/combustibles/fuel-log.ts:51` (con prueba). D-12 en `app/(app)/combustibles/analisis/drilldown-hrefs.ts` y `analisis/page.tsx:121`. D-14 reemplazado por la tolerancia por mandante (`fuel_mandantes.tolerance_pct`); el ciclo por faena existente conserva su escala propia.

### Defectos del tablero que no se replicaron

| # | Cómo se evita |
|---|---|
| 1 | El rendimiento lo calcula el servidor (`calc/performance-series.ts:98`); el de la planilla queda como `declared_performance`, solo para contraste. |
| 2 | Sellos y fechas de relleno se rechazan en terreno (`lib/combustibles/control/validation.ts:30,45`) y quedan marcados en el histórico (S-13); un sello ausente exige motivo. |
| 3 | Unidad por equipo (X-06). |
| 4 | Cada vista R filtra por familia (`queries/performance-detail.ts:41`). |
| 5 | Cada widget tiene estado vacío y de error propio (`SectionError`, `DegradedDataBanner`); verificado en navegador. |
| 6 | Una sola vista de sellos parametrizada por mandante. |
| 7 | Una ruta por vista y meses en español (`MONTH_LABELS`). |
| 8 | Fotos por endpoint autenticado con `view_personal`; nombres enmascarados en servidor. |

## 10. Cierre de la implementación

### Archivos

- **Creados (200):** el submódulo vive en `app/(app)/combustibles/control/**` (vistas, acciones, exportaciones), `lib/combustibles/control/**` (contratos, filtros, cálculo, proyección, revisión, consultas, importadores, catálogos), `components/combustibles/field-load/**` (formulario de terreno por pasos), `lib/services/fuel-tae/**` (división de `lib/services/fuel-tae.ts`), `app/api/combustibles/cargas/**`, `db/schema/fuel-control*.ts`, la migración 0359, el script de respaldo y las pruebas.
- **Modificados (57):** entre ellos `modules/combustibles/manifest.ts`, `db/schema/fuel-tae.ts`, `db/schema/fuel-equipment-types.ts`, `app/(public)/tae/**`, `app/api/tae/**`, `app/(app)/combustibles/{tae,bitacora,analisis,importar}/**`, `lib/combustibles/{fuel-log,operations-import,tae-import-service}.ts`, `components/layout/{top-bar,nav-icons}.tsx`, `lib/services/module-toggles.ts`. `git diff --stat 6dbea284..HEAD` tiene la lista completa.
- **Divididos por tamaño:** `lib/services/fuel-tae.ts` (772 líneas), `lib/combustibles/tae-import-service.ts` (506), `app/(app)/combustibles/actions-operaciones.ts` (558), `app/(public)/tae/tae-form.tsx` (394), `lib/services/module-toggles.ts` (632) y `lib/__tests__/anomaly-detection-integration.test.ts` (1.033).
- **Excepciones a la regla de 500 líneas (tocados, no divididos):** `scripts/capture-all-routes.ts` (6.904; +10 líneas de inventario de rutas que exige su prueba) y `scripts/backup-orchestrator.sh` (611; +3 líneas de la lista blanca de variables). Son herramientas de QA y respaldo ajenas al submódulo, y dividirlas aquí arriesga el despliegue sin beneficio para él.

### Migraciones

`db/migrations/0359_fuel_control.sql`: tablas `fuel_mandantes`, `fuel_mandante_worksites`, `fuel_supply_media`, `fuel_equipment_loads`, `fuel_control_import_batches`, `fuel_control_import_rejections`, `fuel_supply_inputs`, `fuel_telemetry_daily`; columnas nuevas en `fuel_equipment_types` y `fuel_tae_submissions`; tipos de lugar de carga; índices por equipo + fecha, faena + fecha y medio + fecha; siembra idempotente de medios, `grua` y familias. Checksum registrado; `npm run db:verify-migrations` pasa; `drizzle-kit generate` informa «No schema changes».

**Despliegue:** `db:migrate` ahora termina con `npm run db:backfill-fuel-equipment-loads`, que proyecta el histórico ya cargado (idempotente, una transacción por equipo; `FUEL_LOADS_BACKFILL_DRY_RUN=true` para ensayar). No se corrió contra producción ni contra `bodega_dev`: el `next dev` local (:3001, base `bodega_dev`) necesita `npm run db:migrate` antes de abrir las pantallas nuevas.

### Permisos nuevos y asignación

| Permiso | Roles |
|---|---|
| `combustibles:register_load` | administrador, jefa_chome, jefe_mantencion, admin_contrato |
| `combustibles:approve_flagged` | administrador, jefa_chome |
| `combustibles:view_personal` | administrador, jefa_chome |
| `combustibles:manage_control` | administrador |

Se aplican con `npm run db:sync-rbac` (los `defaultGrants` solo se aplican la primera vez que el permiso aparece en una base). **Cambio de comportamiento:** desde ahora ver fotos de cargas y nombres de conductor y supervisor exige `view_personal`; los roles que hoy veían nombres solo con `combustibles:view` (jefe_mantencion, solicitante_faena, prevencionista_faena, admin_contrato) dejan de verlos.

### Pendientes y riesgos

- **Alertas de conciliación:** se muestran en la vista (alerta roja sobre la tolerancia); no envían correo ni notificación.
- **Primer respaldo en producción:** el historial importado con valores de relleno o lecturas erróneas va a poblar la cola de revisión la primera vez. Conviene ensayar con `FUEL_LOADS_BACKFILL_DRY_RUN=true` y mirar cuántas cargas quedan marcadas antes de comunicarlo.
- **Formato de VisionLink y del surtidor CMPC:** supuestos S-1 y S-2, a validar con un archivo real; las plantillas descargables documentan el formato esperado.
- **Fotos históricas:** fuera de alcance (I-04).

### Verificación (2026-10-22, rama `feat/control-combustible`)

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | Sin errores (repetido sobre el commit final `3b0db0f6`) |
| `npm run lint` | Sin errores (1 advertencia preexistente en `lib/combustibles/__tests__/copec-coverage-store.test.ts`) |
| `npm run test:fast` | 989 archivos, 13.149 pruebas en verde sobre el commit final. En el camino se corrigieron 7 fallas: 3 propias de la rama (inventario de rutas, conteo de permisos de `ARCHITECTURE.md`, texto de la llamada TAE en una prueba) y 4 heredadas de `main` en Copec (lista blanca IMAP del respaldo y mocks del portal sin el campo OTP) |
| `npm run test:pglite` | 275 archivos, 3.305 pruebas en verde sobre el commit final |
| `npm run db:verify-migrations` | Cadena verificada hasta 0359 |
| `npm run check:secrets` | Pasa |
| `npm run check:security-audit` | **Falla, preexistente:** avisos de `sharp`, `source-map-js` y `vite` fuera del allowlist. Esta rama no cambió `package-lock.json`; requiere decidir la actualización de dependencias. |
| `npm run doctor` | Termina con código 0 (puntaje 69/100 del repositorio). Las advertencias en archivos de esta rama son de estilo (`await` secuencial dentro de transacciones, gráficos que ya cargan en diferido); dos sospechosas se revisaron y no son fallas. |
| Build (`next build`, dentro de `test:e2e`) | Pasa |
| `npm run test:e2e` (suite completa) | 913 pasan, 2 fallan, 4 omitidas. `tae-public-flow` falló por una lectura de prueba sobre el tope (y destapó que el operador veía el mensaje crudo de zod en inglés): ambas cosas corregidas, y el spec pasa al repetirlo. `servicios-costo-pendiente` **falla también en `main` @ `6dbea284`**: la ficha de solicitud muestra «Colaborador» como dato de solo lectura (`app/(app)/solicitudes/item-editor.tsx:135`) y la prueba espera un campo; es de Solicitudes, ajeno a este trabajo. |
| E2E del submódulo `e2e/combustibles-control.spec.ts` | 7/7: registro con sellos desde la app, cadena de sellos `ok` y `mismatch` por API, atípico marcado y retroceso rechazado con 422, tablero de camiones, aprobación con promedio recalculado (10 → 11,67) y fila de auditoría, importación de entradas con conciliación por mandante y reimportación bloqueada, y la API negando registrar y ver fotos (403) a un rol sin permisos |
| Navegador | 10 pantallas nuevas en 1440 px y 390 px: todas responden 200, sin desborde horizontal de página, sin errores de consola ni respuestas fallidas, con datos y con estados vacíos. Se corrigió el ajuste de columnas de la cola de revisión. |
| Tamaño de archivos | Ningún archivo nuevo o modificado de la rama supera 500 líneas, salvo las dos excepciones documentadas arriba. |
| Corrección de seguridad posterior a la revisión automática | Un usuario con alcance parcial podía sobrescribir un despacho de otra faena reusando su referencia; ahora se rechaza (`lib/combustibles/control/imports/service.ts`, prueba en `lib/__tests__/fuel-control-imports-pglite.test.ts`). |
