# Implementación de diferencias del Programa Preventivo — 2026

Fecha: 2026-09-18  
Alcance: cambios locales sobre `main`; migraciones y backfill aplicados únicamente
en la base local de desarrollo; sin migración, despliegue ni activación productiva.

## 1. Estado inicial encontrado

El módulo ya contaba con una base funcional y no fue reconstruido:

- catálogo corporativo versionado (`pdtpCatalogActivities` y revisiones),
  programas anuales, revisiones, hojas y permisos;
- actividades anuales y cronograma histórico de cuatro bloques por mes;
- responsabilidades por catálogo de roles/personas, asignaciones nominales por
  faena, obligaciones a demanda/evento y ejecuciones del ledger;
- acreditación desde conectores de prevención, evidencia, aprobaciones, cierres,
  changelog y auditoría;
- indicadores mensuales/anuales y tareas pendientes;
- recordatorios existentes para obligaciones, firmas y planes de acción;
- contrato 2026 (`PDTP_2026_ENGANCHE_DESTINATIONS`) usado como fallback para el
  cableado histórico.

La brecha principal era que la configuración nueva no tenía un contrato
persistido para fecha/recurrencia/destino/política, ni una ocurrencia materializada
independiente de la definición. La planilla antigua seguía siendo la fuente de
programación para actividades nuevas. El creador anual ya seleccionaba catálogo,
responsable y recurrencia de forma parcial, pero no guardaba la configuración
operacional completa.

El catálogo de Administración sí tenía su propio formulario de definición y
publicación. El editor anual tenía otro formulario para incorporar una definición
existente. Se conserva el formulario técnico de catálogo para operaciones
exclusivamente catalogales, pero el alta operacional usa ahora el creador común:
Administración puede crear/publicar/agregar en una transacción y el editor anual
puede reutilizar una identidad publicada sin exponer la separación interna.

## 2. Gap analysis

| Capacidad | Estado inicial | Diferencia implementada | Estado resultante |
|---|---|---|---|
| Catálogo versionado | Ya existe y funciona | Ninguna | Conservado |
| Programa anual/revisiones | Ya existe y funciona | Ninguna | Conservado |
| Creador anual | Parcial | Formulario guiado con revelado progresivo y persistencia transaccional | Extendido |
| Responsable rol/persona | Ya existe | Snapshot nominal por instancia | Extendido |
| Fecha única | No existía | `one_time` y fecha civil | Nuevo |
| Recurrencia X días/semanas/meses/años | Parcial, grilla 1–4 | Expansión civil configurable y acotada al programa | Nuevo/extendido |
| Semanas ISO | No existía | `isoWeekYear`, `isoWeek` y semanas que intersectan el mes | Nuevo |
| Eventos | Parcial, obligaciones dispersas | Registro durable, conectores y clave idempotente | Extendido |
| Destino operacional | Mapa 2026 rígido | Registro de 14 conectores y configuración anual | Extendido |
| Instrumento | Bindings existentes | Selector de binding compatible con catálogo/conector | Extendido |
| Evidencia | Texto/requisitos dispersos | Política requerida y tipos admitidos | Extendido |
| Criterio de cumplimiento | Parcial | Políticas manual/source/aprobada/checklist validadas en servidor | Extendido |
| Instancia programada | No existía | Ocurrencias por actividad/faena/fecha | Nuevo |
| Obligación de evento/a demanda | Ya existe y funciona | Reconciliador al modelo común de lectura | Extendido |
| Estados | Varios modelos | Estados persistidos y derivados para instancias nuevas | Extendido |
| Recordatorios | Parcial | Offsets y entregas deduplicadas/reintentables | Extendido |
| Cumplimiento | Grilla histórica | Instancias en denominador, sin compensar sobrecumplimiento | Extendido |
| Exportación operacional ISO | RE-36 histórico | Hoja `Calendario ISO` con instancias nuevas, sin alterar hojas legacy | Extendido |
| Auditoría/retiro | Ya existe | Configuración y cancelación futura en changelog | Extendido |
| Permisos | Ya existe | Verificación del permiso operativo del conector y alcance de faena | Extendido |

## 3. Cambios realizados

### Base de datos

- `pdtp_activities.schedule_definition` guarda la definición de fecha,
  recurrencia, evento, demanda u opción histórica.
- `pdtp_activity_execution_configs` guarda destino, binding, política de
  cumplimiento y política de evidencia.
- `pdtp_scheduled_instances` separa ocurrencia de definición y conserva estado,
  fecha planificada/real, responsable efectivo, motivo de no aplicación o retiro,
  metadatos e idempotencia.
- `pdtp_activity_reminder_rules` y `pdtp_reminder_deliveries` guardan offsets y
  deduplicación por instancia/regla/destinatario.
- `pdtp_trigger_events` es el libro durable de eventos fuente.
- `pdtp_executions.scheduled_instance_id` enlaza el ledger existente con una
  ocurrencia sin crear un segundo sistema de ejecuciones.
- Se añadieron índices y restricciones para estados, cantidades, semanas ISO,
  evidencia, claves únicas y referencias. Los nombres largos generados por
  Drizzle se corrigieron mediante una migración posterior segura.

### Backend y dominio

- `schedule-definition.ts` usa fechas civiles UTC, semanas ISO lunes-domingo,
  límites de período validados también en servidor, recurrencias configurables, ajuste del día mensual al
  último día y soporte explícito de `legacy_grid`.
- `scheduled-instances.ts` materializa ocurrencias al activar y reconcilia
  nuevas faenas desde cron. No crea registros nativos del submódulo y usa una
  clave única actividad+faena+fecha.
- La asignación nominal vigente se copia a la instancia con su rol snapshot;
  cambios posteriores de nómina no mutan el histórico.
- `connectors.ts` publica las capacidades reales de Inspecciones, Capacitación,
  Campañas, Documentación, Emergencias, Incidentes, Higiene, Alcotest, MIPER,
  EPP, CPHS, CGRD, Indicadores y habilitación del trabajador.
- `trigger-events.ts` valida que el evento tenga productor declarado, registra
  una ocurrencia durable y crea obligaciones con idempotencia. Un evento recibido
  antes de la activación queda pendiente.
- `scheduled-execution.ts` implementa inicio contextual idempotente, transición de
  estados, validación de evidencia/política e instrumento configurado, y enlace
  seguro a una ejecución fuente.
- `fulfillment.ts` enlaza automáticamente el hecho nativo acreditado con la
  instancia fechada compatible: respeta el conector declarado, completa sólo las
  políticas `source_completed`/`source_approved` satisfechas y deja `submitted`
  para aprobaciones todavía pendientes.
- `scheduled-reminders.ts` reutiliza notificaciones y reintenta entregas
  fallidas o reservadas sin confirmación, mientras la clave de la notificación
  evita duplicar el envío lógico.
- `fulfillment.ts` integra la cobertura de actividades nuevas al registro de
  conectores y permisos; el contrato 2026 solo sigue siendo fallback histórico.
- `connectors.ts` hidrata los instrumentos desde bindings persistidos compatibles;
  la UI ya no mantiene un mapa paralelo de tipos de fuente.
- La validación de servidor vuelve a comprobar que el evento productor esté
  declarado por un conector y que el instrumento pertenezca al destino elegido;
  la selección de UI no es la única barrera.
- `compliance.ts` suma instancias exigibles al denominador, excluye `not_applicable`
  y `cancelled`, y cuenta cumplidas fuera de plazo sin alterar la semántica de la
  grilla histórica.
- `lifecycle.ts` materializa y reconcilia después de activar sin mantener abierta
  la transacción de firma.

### Frontend

- El editor anual incorpora un creador guiado con revelado progresivo:
  catálogo/responsable → fecha, recurrencia, demanda o evento → destino e
  instrumento → política de cumplimiento → evidencia → recordatorio.
- Se reutilizan `DatePicker`, selector de responsables, catálogo de actividades,
  bindings activos y capacidades del registro de conectores.
- Las recurrencias muestran una previsualización de ocurrencias y las opciones de
  instrumento/evidencia se filtran por el conector seleccionado. El formulario
  permite además fecha única, días ISO configurables, plazos de evento/demanda
  en horas o días y múltiples offsets de recordatorio (antes, el mismo día o
  después del vencimiento).
- Desde Administración, una actividad publicada abre el mismo creador guiado
  hacia un programa en borrador, siempre que la sesión tenga
  `prevention:pdtp:program:manage`; la opción “Publicar y agregar” crea una
  identidad nueva, la publica y la incorpora en la misma transacción.
- La actividad nueva queda en el borrador del programa; la activación continúa
  pasando por la revisión y la compuerta de cobertura existentes.
- Las actividades modernas se editan con el mismo creador. Las actividades
  `legacy_grid` siguen usando el diálogo histórico para no inventar fechas ni
  sobrescribir su cronograma firmado.
- La entrada contextual de `/pendientes` para Inspecciones abre el alta nativa
  con el instrumento y la faena preseleccionados; la creación sigue ocurriendo
  en el servicio nativo y no en el panel PDTP.

### Integraciones y automatizaciones

- El cron semanal ahora reconcilia instancias, eventos, recordatorios y el ledger
  de cumplimiento junto con las tareas existentes.
- `/pendientes` lee instancias nuevas por permiso operativo, alcance de faena y
  asignación nominal/rol, y entrega una URL contextual del conector.
- La URL de `/pendientes` se construye desde el registro de conectores, no desde
  un `CASE` cerrado para cuatro módulos; los conectores existentes reciben la
  misma instancia, faena y, cuando existe, el instrumento contextual.
- Al abrir una instancia desde la cola, el enlace invoca la reserva idempotente
  existente antes de navegar; la ocurrencia pasa a `in_progress` sin crear aún
  un registro nativo del submódulo.
- Para Inspecciones, la ruta contextual resuelve el binding persistido a la
  plantilla aprobada y abre automáticamente el diálogo nativo con ese contexto.
- El adaptador de ingreso de trabajador emite `worker_created`; el adaptador de
  incidentes emite `incident_registered`. Ambos son tolerantes a fallos porque
  el libro durable permite reintento posterior.
- Los cierres confirmados de los demás conectores reales también emiten eventos
  declarados en el registro (`inspection_completed`, `session_closed`,
  `campaign_closed`, publicación/acuso documental, simulacro/plan de emergencia,
  medición de higiene, alcotest, revisión MIPER, entrega EPP, comité/revisión
  CPHS, estructura/matriz/acta CGRD e indicadores). La envoltura segura conserva
  el registro fuente aunque el libro de disparadores no esté disponible.

### Permisos

- La configuración anual continúa requiriendo
  `prevention:pdtp:program:manage`.
- La cobertura valida el permiso de configuración del destino, el permiso de
  ejecución del conector y los roles responsables/ejecutores.
- El inicio y el resultado comprueban permiso operativo, alcance de faena y,
  para no aplica/cancelación, los permisos de override/obligación existentes.
- No se modificó el modelo RBAC ni se usó la visibilidad de UI como autorización.

### Pruebas

- Se añadieron pruebas unitarias para fechas/ISO, conectores, instancias,
  cumplimiento, inicio/resultado, recordatorios, eventos, validación y el
  formulario guiado.
- El regresivo de incidentes cubre la limpieza de fixtures y el emisor de evento.

## 4. Decisiones arquitectónicas

### Definición frente a ejecución

La actividad anual declara qué debe hacerse y sus reglas. Una fila de
`pdtp_scheduled_instances` representa una ocurrencia concreta. Obligaciones de
evento/a demanda siguen en `pdtp_obligations`, pero se leen junto a las instancias
programadas como unidades ejecutables. Nunca se materializa un registro nativo
del submódulo por adelantado.

### Recurrencias y calendario

Las fechas se tratan como fechas civiles, no instantes sujetos a zona horaria. La
expansión queda limitada al período del programa. Las semanas son ISO; las
actividades nuevas no escriben los cuatro bloques históricos. `legacy_grid` evita
inventar fechas para datos anteriores.

### Eventos e idempotencia

Solo se aceptan eventos declarados por un conector. La clave combina conector,
evento, tipo/ID fuente y faena. Las obligaciones usan la clave fuente existente,
por lo que reintentos y concurrencia recuperan la misma obligación. El libro
permanece pendiente si el programa aún no está activo.

### Conectores

El registro publica permisos, eventos, políticas, evidencias y ruta del módulo;
las decisiones de cada actividad quedan en base de datos. No se introdujo un
motor genérico de workflow. Los bindings de acreditación existentes se
reutilizan como identidad de instrumento.

`preventionPdtpSourceLinks` no se reutiliza como configuración general: conserva
sus vínculos específicos por faena de riesgos y obligaciones legales.

### Cumplimiento

Para instancias nuevas, el denominador es la suma de cantidades planificadas de
instancias exigibles. `submitted` no cuenta; `completed` cuenta aun tarde;
`not_applicable` y `cancelled` se excluyen con motivo y actor. La grilla histórica
mantiene su cálculo para no cambiar indicadores ya firmados.

### Edición y retiro

La edición del programa activo sigue requiriendo revisión. Retirar una actividad
no borra historia: desde la fecha efectiva se cancelan las instancias futuras
pendientes con motivo auditado y las anteriores permanecen intactas.

## 5. Archivos modificados

### Aplicación y acciones

- `app/(app)/admin/pdtp-catalogos/page.tsx`
- `app/(app)/admin/pdtp-catalogos/catalog-tabs.tsx`
- `app/(app)/admin/pdtp-catalogos/pdtp-actions.tsx`
- `app/(app)/prevencion/pdtp/[programId]/editar/builder-tabs.tsx`
- `components/prevention/pdtp-activity-creator.tsx`
- `components/prevention/pdtp-scheduled-activity-panel.tsx`
- `components/prevention/pdtp-scheduled-activity-panel-server.tsx`
- `app/(app)/prevencion/pdtp/[programId]/editar/guided-activity-form.tsx`
- `app/(app)/prevencion/pdtp/[programId]/editar/guided-activity-form.test.tsx`
- `app/(app)/prevencion/pdtp/[programId]/editar/tabs/actividades-tab.tsx`
- `app/(app)/prevencion/pdtp/[programId]/editar/page.tsx`
- `app/(app)/pendientes/work-queue-workbench.tsx`
- `app/(app)/prevencion/inspecciones/inspection-run-list.tsx`
- `app/(app)/prevencion/inspecciones/inspections-screen.tsx`
- `app/(app)/prevencion/pdtp/actions.ts`
- `app/(app)/prevencion/pdtp/actions/activities.ts`
- `app/(app)/prevencion/pdtp/actions/scheduled-instances.ts`
- `app/api/cron/pdtp-weekly-reminders/route.ts`
- Panel compartido integrado en las 14 rutas de conector: `alcotest`,
  `campanas`, `capacitacion`, `cgrd`, `cphs`, `documentacion`, `emergencias`,
  `epp-preventivo`, `higiene`, `incidentes`, `indicadores`, `inspecciones`,
  `miper` y `nueva` (sus páginas/workbenches correspondientes).

### Esquema y migraciones

- `db/schema/prevention/pdtp.ts`
- `db/migrations/0307_warm_micromax.sql`
- `db/migrations/0308_chubby_layla_miller.sql`
- `db/migrations/0309_young_zemo.sql`
- `db/migrations/meta/0307_snapshot.json`
- `db/migrations/meta/0308_snapshot.json`
- `db/migrations/meta/0309_snapshot.json`
- `db/migrations/meta/_sql-checksums.json`

### Servicios, validaciones y adaptadores

- `lib/services/operational-work-queue.ts`
- `lib/__tests__/operational-work-queue-pdtp-activity-source.test.ts`
- `lib/services/pdtp/activities.ts`
- `lib/services/pdtp/activity-creation.ts`
- `lib/services/pdtp/compliance.ts`
- `lib/services/pdtp/connectors.ts`
- `lib/services/pdtp/executable-instances.ts`
- `lib/services/pdtp/connectors.test.ts`
- `lib/services/pdtp/content-digest.ts`
- `lib/services/pdtp/fulfillment.ts`
- `lib/services/pdtp/index.ts`
- `lib/services/pdtp/lifecycle.ts`
- `lib/services/pdtp/obligations.ts`
- `lib/services/pdtp/schedule-definition.ts`
- `lib/services/pdtp/schedule-definition.test.ts`
- `lib/services/pdtp/scheduled-compliance.ts`
- `lib/services/pdtp/scheduled-compliance.test.ts`
- `lib/services/pdtp/scheduled-execution.ts`
- `lib/services/pdtp/scheduled-execution.test.ts`
- `lib/services/pdtp/scheduled-instances.ts`
- `lib/services/pdtp/scheduled-instances.test.ts`
- `lib/services/pdtp/scheduled-reminders.ts`
- `lib/services/pdtp/scheduled-reminders.test.ts`
- `lib/services/pdtp/trigger-events.ts`
- `lib/services/pdtp/trigger-events.test.ts`
- `lib/services/pdtp-adapters/incident-accreditation-connector.ts`
- `lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts`
- `lib/services/pdtp-adapters/hygiene-accreditation-connector.ts`
- `lib/services/pdtp-adapters/worker-onboarding-connector.ts`
- `lib/services/prevention-campaigns.ts`
- `lib/services/prevention-alcotest.ts`
- `lib/reports/pdtp-re36-document.ts`
- `lib/reports/pdtp-re36-workbook.ts`
- `lib/reports/pdtp-re36-workbook.test.ts`
- `lib/__tests__/pdtp-fulfillment.test.ts`
- `lib/__tests__/pdtp-re36-document.test.ts`
- `lib/validation/prevention-module/pdtp.ts`
- `lib/validation/prevention-module/pdtp-schedule-definition.test.ts`
- `scripts/backfill-pdtp-scheduling.ts`
- `scripts/migration-preflight.mjs`
- `package.json`
- `docs/prevencion/IMPLEMENTACION_DIFERENCIAS_PROGRAMA_PREVENTIVO_2026.md`
- `qa/reports/2026-09-18-pdtp-programa-preventivo.md`
- `qa/reports/latest.md`

## 6. Migraciones y datos existentes

Se generaron tres migraciones Drizzle nuevas:

1. **0307** crea las tablas, columnas, índices y restricciones nuevas.
2. **0308** reemplaza cinco nombres de FK generados que excedían el límite de
   PostgreSQL por nombres estables y cortos; los `DROP` son idempotentes.
3. **0309** hace cascada la referencia del libro de eventos al purgar una faena,
   manteniendo la limpieza de fixtures y la integridad referencial.

Se generaron snapshots y se actualizó el journal por Drizzle. El verificador
reportó 310 entradas hasta `0309_young_zemo`, checksums válidos, 261/261
identificadores heredados largos tratados y 180/180 `DROP` heredados protegidos.
No se editó manualmente el journal ni una migración publicada.

El script `pdtp:backfill-scheduling` es seguro y explícito:

- actividades activas sin definición reciben `legacy_grid`;
- bindings inequívocos pueden crear configuración `source_completed`;
- bindings ambiguos o inexistentes solo se reportan;
- no se crea una revisión v3, no se activa ningún programa y no se alteran las
  19 ejecuciones `submitted` locales.

En la base local de desarrollo se ejecutó `npm run db:migrate` y se aplicaron
0307–0309. El primer preflight detectó erróneamente dos versiones del mismo año
como duplicadas; se corrigió para validar la clave real `(year, version)` y la
migración terminó correctamente. El backfill se aplicó una vez y luego se repitió
en `--dry-run`: quedó idempotente (`legacyGridActivities: 0`,
`executionConfigs: 0`, `existingScheduledInstances: 0`, cero claves duplicadas y
19 ejecuciones `submitted` preservadas). El reporte final conserva 22 bindings
ambiguos y 94 actividades sin binding para revisión manual; no se adivinaron
destinos.

## 7. Pruebas realizadas

| Prueba | Resultado |
|---|---|
| Suite nueva de calendario, conectores, instancias, cumplimiento, ejecución, recordatorios, eventos, validación y formulario | 9 archivos, 32/32 PASS |
| Acreditación y enlace de instancia programada | 69/69 PASS en `pdtp-fulfillment.test.ts` |
| Documento RE-36 y hoja `Calendario ISO` | 14/14 PASS en PGlite y 18 PASS en workbook (2 omitidas por diseño) |
| Cola operacional con destino dinámico por conector | 30/30 PASS en `operational-work-queue-pdtp-activity-source.test.ts`, incluido instrumento contextual |
| Regresión `lib/__tests__/prevention-incidents-re20.test.ts` | 1 archivo, 9/9 PASS |
| `npm run test:fast` | 732 archivos PASS, 30 omitidos; 2 fallas ajenas/ambientales: manifiesto de Flota con permisos adicionales y `openpyxl` ausente para un helper Python |
| `npm run test:pglite` | 180 archivos, 2.108 pruebas PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run db:generate` | PASS; `No schema changes` |
| `npm run db:verify-migrations` | PASS |
| `npm run check:secrets` | PASS |
| `npm run check:security-audit` | PASS; allowlist vigente hasta 2026-10-28 |
| `git diff --check` | PASS |
| React Doctor focalizado sobre cambios | PASS; 68 archivos, 83/100, 17 advertencias sin errores |
| `npm run doctor` completo | Baseline no verde: 49/100 y 919 hallazgos preexistentes en el alcance completo |
| `npm run test:e2e` | 659 PASS, 25 fallas, 3 omitidos de 687; los flujos funcionales PDTP pasaron. Las fallas restantes se concentran en accesibilidad de rutas, densidad de filtros de Incidentes y cierre avanzado de Inspecciones |
| Migración/backfill local | PASS; migración 0307–0309, apply y dry-run posterior idempotente |
| Navegador/UAT autenticada | El recorrido E2E sí se ejecutó; quedó evidencia de navegador, pero no es certificación total: persisten las 25 fallas descritas y la revisión con cada conector no quedó completa |

## 8. Pendientes reales

1. Promover las migraciones y el backfill a una base QA autorizada (la base local
   de desarrollo ya fue migrada); revisar antes los 22 bindings ambiguos y 94
   actividades sin binding, sin adivinar configuraciones.
2. Hacer una revisión autenticada con cada conector que tenga cierre nativo
   distinto (aprobación, checklist y evidencia de archivo). El callback común ya
   cubre los adaptadores que llaman `recordPdtpFulfillmentEvent`, pero los
   recorridos de navegador de cada módulo no están certificados aquí.
3. Validar mediante navegador autenticado que el CTA contextual de cada conector
   consume todos los parámetros que el módulo nativo soporta. La reserva y la
   URL común ya están centralizadas; algunos módulos sólo aceptan actualmente
   una parte del contexto en su formulario propio.
4. Completar la auditoría visual autenticada de los conectores y corregir las
   fallas E2E de accesibilidad/densidad que sean atribuibles a este cambio. No
   hay despliegue productivo ni activación automática como parte de esta entrega.
