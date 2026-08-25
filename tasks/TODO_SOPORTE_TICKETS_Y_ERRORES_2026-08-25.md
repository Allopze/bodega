# TODO — Soporte, tickets y reporte de errores

Plan asociado: [PLAN_SOPORTE_TICKETS_Y_ERRORES_2026-08-25.md](./PLAN_SOPORTE_TICKETS_Y_ERRORES_2026-08-25.md)

## Antes de implementar

- [ ] Confirmar que `feedback:manage` implica lectura/descarga global incluso con grants directos.
- [ ] Confirmar eventos que ve el autor y que las notas internas nunca salen de soporte.
- [ ] Confirmar retención de adjuntos y eventos.
- [ ] Ejecutar preflight productivo en `READ ONLY`; guardar sólo conteos y distribución no sensible.

## Corte 1 — Error seguro

- [ ] No mostrar ni persistir `error.message` o stack desde límites de error.
- [ ] Enviar sólo digest, ruta sin query string y descripción del usuario.
- [ ] Registrar excepción con correlación server-side y devolver mensaje seguro.
- [ ] Añadir regresiones de error de DB/filesystem y URL sensible.

## Corte 2 — Adjuntos y permisos

- [ ] Crear política `FeedbackAccess` compartida por páginas, acciones y API.
- [ ] Devolver/listar metadatos de adjuntos autorizados en el detalle.
- [ ] Renderizar enlace de adjunto seguro en el ticket.
- [ ] Probar propio, `view_all`, `manage`, sin permiso y módulo deshabilitado.

## Corte 3 — Bandeja

- [ ] Implementar búsqueda, filtros y paginación coherentes; eliminar el límite oculto de 50.
- [ ] Generar migración de índices basada en la consulta final y validar con `EXPLAIN`.
- [ ] Usar enlaces accesibles por fila y `PageHeader.actions` para móvil.
- [ ] No seleccionar descripción/email que la tabla no necesita.
- [ ] E2E de 51+ tickets, filtros, teclado y CTA móvil.

## Checkpoint A

- [ ] Pruebas focalizadas/PGlite y rutas en verde.
- [ ] `npx tsc --noEmit`, ESLint focalizado y `npm run db:verify-migrations` verdes.
- [ ] E2E serial de creación, adjunto, descarga, búsqueda y paginación.
- [ ] Revisión humana del contrato de permisos.

## Corte 4 — Historial inmutable

- [ ] Modelar eventos de tickets, triage, responsable y versión de concurrencia.
- [ ] Generar migración nueva; no editar migraciones ni journal existentes.
- [ ] Backfill idempotente que marque hechos históricos desconocidos.
- [ ] Crear timeline de lectura con segregación de notas internas.

## Corte 5 — Gestión

- [ ] Implementar transiciones transaccionales con lock/version y auditoría.
- [ ] Añadir asignación, prioridad operativa, impacto informado y resumen de resolución.
- [ ] Notificar al autor sólo con información visible y al responsable según corresponda.
- [ ] Probar concurrencia, reapertura y segregación de eventos.

## Corte 6 — SLA

- [ ] Decidir integración con `/pendientes` o bandeja equivalente.
- [ ] Crear job idempotente de vencimientos y dedupe durable.
- [ ] Mostrar SLA, vencimiento, responsable y prioridad operativa.
- [ ] Instrumentar y verificar indicadores operativos sin PII.

## Cierre

- [ ] Ejecutar E2E desktop y 390 px: error → ticket → adjunto → triage → resolución → aviso.
- [ ] `npm run test:fast`, `npx tsc --noEmit`, `npm run lint`, `npm run db:verify-migrations` y build verdes.
- [ ] Preflight, migración y consultas post-commit productivas documentadas por separado de las pruebas locales.
- [ ] Actualizar este TODO y la auditoría con evidencia de ejecución.
