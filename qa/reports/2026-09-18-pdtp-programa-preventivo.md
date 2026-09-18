# QA — Programa Preventivo: diferencias 2026-09-18

## Alcance

Verificación focalizada de la implementación de programación, instancias,
conectores, eventos, evidencia, recordatorios y medición del Programa
Preventivo. El alcance cubre código, validaciones, servicios, migraciones y
las pruebas deterministas disponibles. No es una certificación global de la
plataforma.

La corrida agrupada incluyó `npm run test:e2e` sobre el entorno local y generó
evidencia de navegador. Esto permite reportar los flujos que pasaron, pero no
equivale a una certificación total: quedaron 25 pruebas fallidas y 3 omitidas
de 687, principalmente en accesibilidad de rutas, densidad de filtros de
Incidentes y cierre avanzado de Inspecciones.

## Resultado

| Área | Resultado | Evidencia |
|---|---|---|
| Calendario civil, semanas ISO y expansión de recurrencias | PASS | `schedule-definition.test.ts`: 8 pruebas, incluida la validación del período en servidor |
| Conectores y capacidades declaradas | PASS | `connectors.test.ts`: 4 pruebas |
| Materialización idempotente por faena | PASS | `scheduled-instances.test.ts`: 3 pruebas |
| Cumplimiento por instancias | PASS | `scheduled-compliance.test.ts`: 2 pruebas |
| Inicio, estados terminales y políticas de cumplimiento | PASS | `scheduled-execution.test.ts`: 2 pruebas |
| Recordatorios y deduplicación | PASS | `scheduled-reminders.test.ts`: 1 prueba |
| Eventos durables e idempotencia | PASS | `trigger-events.test.ts`: 2 pruebas |
| Productores de eventos de los conectores | PASS ESTÁTICO | Los adaptadores reales llaman la envoltura idempotente; `typecheck`/`lint` PASS y el libro tolera fallos post-commit |
| Enlace de hecho nativo con instancia programada | PASS | `pdtp-fulfillment.test.ts`: 69 pruebas, incluida acreditación por Campañas, aprobación pendiente y enlace reutilizable dentro de la transacción de Inspecciones |
| Destino contextual de `/pendientes` | PASS | La consulta usa el registro de conectores e incluye el instrumento cuando está configurado; typecheck/lint PASS |
| Reserva al abrir desde `/pendientes` | PASS PARCIAL | La acción idempotente y el recorrido de cola E2E pasaron; no se recorrieron los 14 conectores autenticados uno por uno |
| Validación Zod de programación/configuración | PASS | `pdtp-schedule-definition.test.ts`: 3 pruebas |
| Formulario guiado anual y entrada desde Administración | PASS | `guided-activity-form.test.tsx`: 5 pruebas; incluye fecha/recurrencia, evento en horas y múltiples recordatorios; typecheck PASS |
| Contexto nativo de Inspecciones desde una instancia PDTP | PASS ESTÁTICO | El binding persistido resuelve la plantilla aprobada y abre el diálogo con plantilla/faena preseleccionadas; falta recorrido autenticado por no haber servidor QA |
| Exportación RE-36 con hoja Calendario ISO | PASS | `pdtp-re36-document.test.ts`: 14 pruebas; `pdtp-re36-workbook.test.ts`: 18 PASS, 2 omitidas |
| Adaptador de incidentes y limpieza de fixtures | PASS | `prevention-incidents-re20.test.ts`: 9 pruebas |
| Regresión de cola PDTP | PASS | `operational-work-queue-pdtp-activity-source.test.ts`: 30 pruebas, incluida ruta con instrumento |
| Tipado | PASS | `npm run typecheck` |
| Lint | PASS | `npm run lint` |
| Cadena y reglas de migraciones | PASS | `npm run db:verify-migrations` — 310 entradas hasta 0309 |
| Archivos de entorno | PASS | `npm run check:secrets` |
| Auditoría de dependencias | PASS | `npm run check:security-audit` |
| Higiene del diff | PASS | `git diff --check` |
| React Doctor focalizado | PASS CON ADVERTENCIAS | 68 archivos, 83/100; 17 advertencias, sin errores |

La comprobación focalizada posterior a los últimos ajustes ejecutó 9 archivos y
32/32 pruebas PASS; `npm run typecheck` y `npm run lint` también terminaron PASS.
La revisión de React Doctor sobre cambios quedó en 68 archivos, 83/100, con 17
advertencias y sin errores.

Las pruebas focalizadas sumaron **32/32** unitarias, **180 archivos y 2.108/2.108**
pruebas PGlite, **9/9** del regresivo de incidentes y **30/30** de la cola
operacional. La corrida amplia `test:fast` terminó con 732 archivos PASS y 30
omitidos, pero dejó dos fallas no atribuibles a este cambio: una aserción exacta
del manifiesto de Flota con permisos adicionales y un helper Python que requiere
`openpyxl`. No se ocultan como PASS.

## Migración y backfill

En la base local de desarrollo se ejecutó `npm run db:migrate` y se aplicaron
0307–0309. El backfill se ejecutó con `--apply` y luego con `--dry-run`; la segunda
lectura confirmó idempotencia: 0 actividades legacy pendientes, 0 configuraciones
pendientes, 0 instancias preexistentes adicionales, 0 claves naturales duplicadas,
0 claves de idempotencia duplicadas y 19 ejecuciones `submitted` preservadas.
El reporte dejó 22 bindings ambiguos y 94 actividades sin binding para revisión
manual. No se creó una revisión nueva, no se activaron programas y no se tocó
producción.

## Cobertura no ejecutada

- `npm run test:e2e` sí se ejecutó: 659 PASS, 25 fallas y 3 omitidos. Las fallas
  no se convierten automáticamente en bugs del PDTP; deben triagearse según la
  evidencia individual. Los flujos PDTP funcionales pasaron, mientras que la
  accesibilidad de `/prevencion/pdtp/actividades`, la densidad de Incidentes y el
  cierre avanzado de Inspecciones quedaron como brechas.
- `npm run doctor` completo terminó con el baseline amplio 49/100 y 919 hallazgos;
  el alcance cambiado sí terminó sin errores (83/100, 17 advertencias).
- La revisión autenticada módulo por módulo de los 14 conectores no quedó
  completa; la reserva, URL contextual y acreditación están cubiertas por
  servicios y pruebas deterministas.

## Riesgos y seguimiento

Antes de activar en un entorno real se debe promover la migración/backfill a una
base QA autorizada después de revisar los 22 bindings ambiguos y 94 sin binding,
y completar los recorridos autenticados de fecha única, recurrencia mensual,
evento de ingreso, evidencia y retiro en cada conector relevante. El callback de
instancia ya está centralizado en el servicio de acreditación para los adaptadores
existentes. No hay despliegue productivo ni activación automática en esta entrega.
