# Plan de implementación — Soporte, tickets y reporte de errores

Fecha: 2026-08-25  
Fuente: auditoría local de `/soporte`, adjuntos y `ReportErrorButton`  
Estado: pendiente de aprobación

## Resultado esperado

Un reporte de soporte debe ser un ticket seguro, recuperable y gestionable: la
persona que lo crea puede consultar su avance y sus adjuntos; el equipo de
soporte puede buscar, asignar, priorizar y cerrar el trabajo; cada decisión
queda trazada; el SLA mueve una acción real; y un fallo de la aplicación aporta
contexto útil sin revelar internals ni secretos.

No se cambia el dominio operativo de otros módulos, no se otorgan permisos a
roles nuevos y no se despliega a producción dentro de este plan.

## Hallazgos que cubre

| Hallazgo confirmado | Corte que lo cierra |
|---|---|
| `e.message` llega al usuario y al ticket | 1 — frontera segura de errores |
| Un adjunto se guarda, pero no se puede abrir desde el ticket | 2 — adjuntos como parte del detalle |
| `view_all`/`manage` no se comportan igual en página y descarga | 2 — política única de acceso |
| Bandeja fija en 50, sin búsqueda ni paginación | 3 — bandeja consultable |
| Cambios de estado/notas se sobrescriben sin historia | 4 y 5 — línea de tiempo inmutable |
| Prioridad la define quien reporta y el SLA no genera trabajo | 5 y 6 — triage, asignación y vencimientos |
| El reportante no recibe la resolución | 5 — notificación de transición |
| Crear no aparece en móvil y filas no son accesibles | 3 — interacción de bandeja |

## Decisiones de arquitectura

1. **Permisos semánticos, no combinaciones dispersas.** Se crea una frontera
   `FeedbackAccess` en `lib/services/feedback-access.ts`: `canCreate`,
   `canReadOwn`, `canReadAll`, `canManage`. `feedback:manage` implica lectura
   global para gestionar; la misma política se usa en páginas, acciones y API
   de adjuntos. No se confía en que los grants por defecto siempre lleguen
   agrupados.
2. **El error técnico no es contenido del ticket.** El cliente sólo envía
   `pagePath` (sin query string), `errorDigest` y la descripción de la persona.
   La excepción completa se registra con logger/Sentry y un identificador de
   correlación, nunca se muestra ni se persiste en `feedback_reports`.
3. **El adjunto pertenece al ticket.** Se conserva la tabla genérica
   `attachments`, pero el servicio devuelve metadatos de adjuntos autorizados y
   el detalle los renderiza como enlaces seguros. No se expone una ruta de disco
   ni se depende de conocer el ID por fuera de la pantalla.
4. **Historial de tickets append-only.** `feedback_report_events` guarda actor,
   fecha, tipo (`created`, `status_changed`, `assignment_changed`,
   `triaged`, `internal_note`, `resolution_published`) y payload validado. La
   nota interna deja de ser un único campo destructivo. `feedback_reports`
   mantiene sólo el estado actual y campos de consulta rápida.
5. **Triage separado de lo informado.** Quien reporta declara impacto; soporte
   decide la prioridad operativa que calcula SLA, responsable y resolución.
   Los valores existentes de `priority` se conservan como prioridad operativa
   durante la migración; el impacto histórico se marca como no disponible, no
   se inventa.
6. **SLA medible y accionable.** Un ticket abierto o en progreso se considera
   vencido al superar `dueAt`; el job idempotente alerta al responsable y a los
   gestores, y la bandeja lo muestra. Resuelto/descartado no alertan.

## Cortes de implementación

### Corte 0 — Contrato de producto y preflight

**Objetivo:** cerrar las tres decisiones que cambian comportamiento antes de
crear una migración o reescribir servicios.

- Confirmar que todos los usuarios con `feedback:manage` pueden leer y descargar
  cualquier ticket, incluidos los grants directos.
- Confirmar que el autor recibe notificación en `en_progreso`, `resuelto` y
  `descartado`; las notas internas nunca salen de soporte.
- Confirmar la política de retención para adjuntos y eventos. Propuesta:
  conservar mientras el ticket exista y no programar borrado retroactivo en
  esta entrega.
- En producción, ejecutar una consulta **READ ONLY** que mida tickets, adjuntos,
  combinaciones de permisos directos y distribución de estados/prioridades.
  Esa salida decide si hace falta backfill adicional, pero no se modifica nada.

**Criterios de aceptación:** hay decisión escrita para los tres puntos y un
reporte de preflight sin datos sensibles.

**Dependencias:** ninguna.

### Corte 1 — Frontera segura para reportar un error

**Objetivo:** eliminar la divulgación de excepciones y conservar sólo contexto
seguro y accionable.

- Cambiar `ReportErrorButton` para no mostrar ni concatenar `error.message`;
  enviar digest, ruta sin query y descripción de la persona.
- Cambiar las acciones para registrar el error real con correlación y responder
  un mensaje genérico. Ninguna ruta devuelve errores de DB, filesystem o stack.
- Mantener `global-error.tsx` como captura Sentry genérica: no debe intentar
  crear tickets sin una sesión autenticada.
- Añadir pruebas de regresión para errores de servicio, URL con query sensible y
  digest presente/ausente.

**Archivos probables:**
`components/report-error-button.tsx`, `app/(app)/soporte/actions.ts`,
`lib/validation/feedback.ts`, pruebas de acciones y límites de error.

**Criterios de aceptación:**

- Un fallo interno nunca aparece en toast, diálogo ni descripción persistida.
- El gestor puede correlacionar el ticket con logs/Sentry mediante ID seguro.
- El reporte manual conserva título, descripción y página útil.

**Dependencias:** Corte 0.

### Corte 2 — Acceso uniforme y adjuntos visibles

**Objetivo:** que una misma política de permisos gobierne ticket, adjuntos y
gestión, y que el adjunto cargado sea recuperable desde el detalle.

- Implementar `FeedbackAccess` en `lib/`, usado tanto por Server Components,
  Server Actions como por `app/api/soporte/adjuntos/[id]`.
- Extender la lectura de detalle con adjuntos de `entityType = feedback_report`;
  devolver metadatos mínimos (ID, nombre, tamaño, MIME) tras autorizar el ticket.
- Renderizar los adjuntos en el detalle como enlaces a la API existente;
  descargar en una pestaña/visor seguro según tipo, sin `dangerouslySetInnerHTML`.
- Añadir pruebas de matriz: propio, `view_all`, `manage`, sin permiso, adjunto
  ajeno y módulo deshabilitado.

**Archivos probables:**
`lib/services/feedback.ts`, `lib/services/feedback-access.ts` (nuevo),
`app/(app)/soporte/[id]/page.tsx`, `app/api/soporte/adjuntos/[id]/route.ts`,
pruebas de ruta/servicio.

**Criterios de aceptación:**

- El creador y cualquier gestor autorizado abren el mismo adjunto desde el ticket.
- `view_all` y `manage` funcionan coherentemente aun con grants directos.
- Un usuario no autorizado recibe respuesta no enumeradora y nunca recibe bytes.

**Dependencias:** Corte 1.

### Corte 3 — Bandeja encontrable, escalable y accesible

**Objetivo:** retirar el límite oculto de 50 y permitir que soporte encuentre y
opere cualquier ticket autorizado.

- Definir consulta paginada por cursor o `page`/`pageSize`, con total/`hasMore`,
  filtros de texto, estado, tipo, prioridad, responsable y vencimiento.
- Añadir índices que correspondan exactamente a las consultas finales: al menos
  orden temporal y los filtros combinados que demuestre `EXPLAIN` sobre datos de
  prueba representativos. Generar migración nueva; nunca editar las existentes.
- Cambiar `ReportList` a enlaces reales y accesibles, integrar el texto con el
  TopBar o declarar búsqueda propia; usar `PageHeader.actions` para que “Nuevo
  reporte” exista también en móvil.
- Mantener la autorización en la consulta, no en un filtro visual, y no cargar
  descripción ni email cuando la tabla no los necesita.

**Archivos probables:**
`lib/services/feedback.ts`, `db/schema/feedback.ts`, migración nueva,
`app/(app)/soporte/page.tsx`, `report-list.tsx`, tests de servicio y E2E.

**Criterios de aceptación:**

- Con 51+ tickets se accede a todos sin alterar el aislamiento propio/global.
- Búsqueda, filtros, paginación y conteo usan el mismo conjunto de condiciones.
- La tabla se navega con teclado y el CTA existe en desktop y móvil.

**Dependencias:** Corte 2.

### Checkpoint A — Seguridad y bandeja

- Pruebas unitarias, PGlite y de rutas para Cortes 1–3 en verde.
- `npx tsc --noEmit`, ESLint focalizado y `npm run db:verify-migrations` pasan.
- E2E en navegador: crear reporte, adjuntar, listar, buscar, paginar y descargar
  como autor, visor global y gestor; captura móvil del CTA.
- Revisión humana del contrato de permisos antes de migrar el workflow.

### Corte 4 — Esquema de workflow y línea de tiempo inmutable

**Objetivo:** hacer auditables los cambios sin perder el estado actual rápido de
consultar.

- Modelar `feedback_report_events`, campos de triage (`assigned_to_user_id`,
  `reported_impact`, prioridad operativa) y versión de concurrencia en el
  esquema Drizzle.
- Generar una única migración forward-only con índices, checks y FKs. Backfill:
  un evento `created` por ticket y un `status_changed` terminal cuando los
  campos actuales aporten evidencia; marcar explícitamente lo que sea
  desconocido, sin fabricar notas ni responsables.
- Preflight, migración y verificación se ejecutan en ese orden en producción;
  la migración local verde no es prueba de despliegue.
- Exponer tipos de lectura de evento sin filtrar notas internas hacia el autor.

**Archivos probables:**
`db/schema/feedback.ts`, migración nueva, `lib/services/feedback.ts`,
`lib/validation/feedback.ts`, tests PGlite.

**Criterios de aceptación:**

- Cada ticket nuevo y cada transición deja un evento inmutable con actor y fecha.
- Reabrir no borra quién resolvió ni cuándo; el estado actual sigue consistente.
- El backfill es idempotente y documenta los hechos que no puede reconstruir.

**Dependencias:** Checkpoint A y preflight de Corte 0.

### Corte 5 — Triage transaccional, comunicación y gestión

**Objetivo:** convertir los cambios de estado en una operación de soporte
concurrentemente segura y visible para quienes corresponda.

- Reemplazar la actualización directa por un servicio transaccional que bloquee
  el ticket, valide transiciones, aplique versión optimista, escriba el evento y
  registro de auditoría, y actualice la proyección actual en una transacción.
- Añadir asignación, prioridad operativa, impacto informado, nota interna
  append-only y resumen de resolución visible al autor.
- Notificar al autor sólo sobre cambios visibles; notificar a la persona
  asignada sobre asignación/atraso; evitar enviar contenido interno.
- Transformar el panel de gestión en acciones separadas y explícitas, más una
  línea de tiempo que segrega los eventos internos de la vista del autor.

**Archivos probables:**
`lib/services/feedback.ts` (o servicios focalizados),
`app/(app)/soporte/actions.ts`, `status-panel.tsx`, detalle, notificaciones,
validación y pruebas.

**Criterios de aceptación:**

- Dos gestores concurrentes no pueden sobrescribir silenciosamente el trabajo.
- Autor, gestor y responsable ven sólo los eventos permitidos para su rol.
- Una resolución incluye quién, cuándo y un resumen útil para el autor.

**Dependencias:** Corte 4.

### Corte 6 — SLA operativo, cola y alertas

**Objetivo:** que `dueAt` sirva para priorizar trabajo en lugar de ser una fecha
decorativa.

- Incorporar tickets autorizados a la cola operativa o, si se descarta esa
  integración, implementar una bandeja de soporte equivalente con “vencidos”,
  “sin responsable” y “mis tickets”. La decisión se toma en Corte 0.
- Crear un job idempotente de recordatorios de SLA con cursor/dedupe duradero;
  sólo opera tickets activos y no reintenta notificaciones de forma infinita.
- Mostrar estado de SLA (vigente, próximo, vencido), responsable y prioridad
  operativa; quien reporta no modifica la prioridad que rige alertas.
- Instrumentar conteos de tickets abiertos, vencidos, sin responsable y tiempo
  de primera respuesta/resolución, sin registrar descripción ni adjuntos.

**Archivos probables:** servicio de soporte, job/API cron, registro de rutas y
owners de módulo, `operational-work-queue.ts` si se integra, UI y pruebas.

**Criterios de aceptación:**

- Un ticket crítico vencido llega una sola vez al responsable/gestores definidos.
- Cerrar o descartar cancela recordatorios futuros.
- Los indicadores coinciden con la misma consulta que alimenta la bandeja.

**Dependencias:** Corte 5.

### Checkpoint B — Workflow completo

- Pruebas de transición, concurrencia, permisos, eventos, adjuntos y SLA verdes.
- E2E serial en desktop y 390 px: error boundary → ticket → adjunto → triage →
  asignación → resolución → aviso al autor.
- `npm run test:fast`, `npx tsc --noEmit`, `npm run lint`,
  `npm run db:verify-migrations` y build pasan.
- Revisión de seguridad: mensajes, logs, adjuntos, autorización y cron.

## Orden de despliegue

1. Cortes 1–3: se pueden desplegar sin migración de workflow y corrigen los
   riesgos visibles primero.
2. Preflight de producción en sólo lectura y respaldo verificado.
3. Corte 4: aplicar migración y backfill dentro de la misma ventana controlada;
   consultar post-commit cantidades de tickets/eventos/adjuntos.
4. Cortes 5–6: habilitar workflow y job primero en modo observación; confirmar
   métricas y dedupe antes de activar avisos a usuarios.
5. Smoke autenticado con cuentas de autor, visor global y gestor. Rollback de
   aplicación es inmediato; la migración es aditiva y no se revierte por borrar
   historial.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Backfill inventa historia que nunca existió | Eventos con `source=backfill` y campos desconocidos explícitos; no inferir notas o actores. |
| Permisos personalizados rompen la bandeja | Matriz de autorización con grants mínimos, no sólo roles seed. |
| Adjuntos grandes afectan memoria | Conservar el límite de configuración, validar antes de escribir y medir carga; no aumentar el máximo en este trabajo. |
| El cron duplica avisos | Persistir llave de dedupe por ticket, evento y ventana; probar reintentos. |
| Migraciones concurrentes | Generar una sola vez, no editar journal/SQL existente y ejecutar suites PostgreSQL en serie. |
| El autor recibe información interna | Proyección separada de eventos visibles y pruebas negativas de contenido. |

## Evidencia de cierre

- Tests unitarios y PGlite cubren creación, adjuntos, matriz de permisos,
  búsqueda/paginación, transición, concurrencia, eventos y SLA.
- E2E cubre el flujo completo y los roles mínimos; el resultado no se sustituye
  por `--list` ni por pruebas de API aisladas.
- La migración se verifica localmente y en producción con consultas post-commit
  de sólo lectura; se reportan por separado las pruebas locales y la evidencia
  productiva.
- Se actualizan la auditoría y `TODO_SOPORTE_TICKETS_Y_ERRORES_2026-08-25.md`
  con pruebas reales, no con intención de implementación.

