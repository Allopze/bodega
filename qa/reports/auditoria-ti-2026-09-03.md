# Auditoría del módulo TI

**Fecha:** 2026-09-03
**Alcance:** `/ti`, activos, asignaciones, mantenciones, tickets, licencias, accesos, garantías, bajas, reportes, APIs de fotografías/adjuntos y actas imprimibles.
**Resultado inicial:** **La auditoría detectó hallazgos P1/P2 de autorización e integridad que impedían recomendar la liberación.** Las correcciones quedaron implementadas y verificadas estáticamente y mediante pruebas determinísticas; la validación funcional autenticada en navegador sigue limitada por la sesión QA disponible.

## Metodología y evidencia

- Revisión estática de páginas, server actions, servicios, validaciones, esquema TI, manifiesto/permisos y pruebas existentes.
- Línea base previa a los fixes: `test:pglite` enfocado en TI, **6 archivos, 59 pruebas OK**.
- Verificación posterior: `test:pglite` en los 6 archivos TI, **71/71 pruebas OK**; `test:fast` para actions y fechas civiles, **12/12 pruebas OK**.
- Línea base previa: `typecheck`, `lint` y `test:e2e -- e2e/ti-modulo.spec.ts` terminaron OK con la base desechable de auditoría.
- Línea base previa de `react-doctor --verbose`: análisis global del repositorio, no un score exclusivo de TI; detectó **56 advertencias en archivos TI y ningún error TI**.
- La primera auditoría directa de rutas con navegador quedó **no ejecutada** por `write EPIPE`. La repetición posterior sí inició Chromium, pero la sesión QA redirigió las rutas TI a `/dashboard` por falta de permiso.

## Hallazgos priorizados

| ID | Tipo | Prioridad | Hallazgo y evidencia | Recomendación |
|---|---|---:|---|---|
| TI-01 | Seguridad/autorización | P1 | `createAssetAction`, `updateAssetAction`, `deleteAssetAction` y `changeAssetStatusAction` solo verifican `ti:manage_assets` y llaman servicios sin `worksiteScope` (`app/(app)/ti/activos/actions.ts:50-137`). Los servicios tampoco validan la faena del activo (`lib/services/ti/assets.ts:112-264`). Un rol TI acotado puede forjar un `assetId` de otra faena, editarlo, eliminarlo lógicamente o cambiar su estado. | Pasar el scope de la sesión a cada servicio y validar tanto el activo objetivo como las relaciones `worker/worksite`; agregar pruebas negativas entre faenas para las cuatro acciones. |
| TI-02 | Seguridad/autorización | P1 | La descarga de adjuntos valida permiso, existencia, tipo de entidad y ruta, pero no resuelve `entityId` ni verifica la faena (`app/api/ti/attachments/[id]/route.ts:20-40`). Un usuario con `ti:view` acotado puede acceder a un `attachmentId` de otra faena. | Resolver la entidad TI propietaria y aplicar el scope antes de leer el archivo; probar acceso cruzado con IDs conocidos. |
| TI-03 | Seguridad/privacidad | P1 | Accesos y licencias cargan trabajadores, faenas, sistemas, checklists y asignaciones sin scope (`app/(app)/ti/accesos/page.tsx:28-40`, `lib/services/ti/access.ts:154-193`, `app/(app)/ti/licencias/page.tsx:25-40`, `lib/services/ti/licenses.ts:164-205`). Las mutaciones correspondientes tampoco reciben scope. | Hacer explícito el scope en lectura, alta, edición, revocación y checklist; revisar qué rol puede ver datos globales. |
| TI-04 | Seguridad/autorización | P1 | `exportTiReport` sí calcula scope para inventario, pero `historial_activo` consulta el activo y todo su historial solo por `assetId` (`app/(app)/ti/reportes/actions.ts:96-154`). Un exportador acotado puede pedir el historial de otro activo. | Aplicar el scope también en la consulta de `historial_activo` y añadir prueba de exportación cruzada. |
| TI-05 | Bug de integridad | P1 | El schema de transición acepta todos los estados (`dado_de_baja` incluido), aunque la UI solo ofrece estados manuales (`lib/validation/ti.ts:41-85`, `asset-status-control.tsx:32-50`). `changeAssetStatus` puede llevar un activo a baja/perdido/robado sin crear la baja formal y sin cerrar la asignación abierta; además borra `workerId` (`lib/services/ti/assets.ts:212-235`). Esto deja una custodia abierta que luego no se puede devolver. | Separar estados de flujo y estados manuales en servidor; bloquear estados terminales en esta acción y obligar a usar el flujo formal de baja/pérdida/robo; cerrar o disponer explícitamente la asignación. |
| TI-06 | Integridad/política | P2 | El flujo formal permite `perdida`/`robo` con asignación abierta y deja esa asignación vigente aunque el activo queda sin custodio (`lib/services/ti/retirements.ts:40-67`). El dashboard sigue contando la asignación como vigente (`lib/services/ti/queries.ts:57-70`). | Definir una única semántica: cerrar la custodia con resultado pérdida/robo y conservar el último custodio como historial, o excluirla del KPI de custodias vigentes. |
| TI-07 | Bug de ticket | P1 | Al reabrir un ticket desde `resuelto`, se conserva `resolvedAt` y `resolution` (`lib/services/ti/tickets.ts:138-145`). La pantalla muestra esos campos cuando no son nulos (`app/(app)/ti/tickets/[id]/ticket-detail.tsx:93-98`). Un ticket en progreso puede aparecer todavía resuelto. | Al salir de `resuelto`, limpiar ambos campos o modelar explícitamente historial de resoluciones; agregar regresión de reapertura. |
| TI-08 | Bug funcional | P2 | La action de transición asigna el ticket al usuario que ejecuta la transición (`app/(app)/ti/tickets/actions.ts:65-71`), aunque la pantalla solo ofrece cambio de estado y resolución. Un supervisor que reabra o cierre puede transferir silenciosamente la responsabilidad. | Separar asignación de transición; preservar el asignado salvo que se envíe un cambio explícito y agregar selector/acción de asignación. |
| TI-09 | Bug de estado | P2 | Reabrir una tarea de checklist limpia la tarea, pero nunca limpia `completedAt` del checklist (`lib/services/ti/access.ts:224-246`). La interfaz puede seguir mostrando el checklist como completado aunque tenga pendientes. | Actualizar `completedAt` a `null` cuando exista una tarea pendiente; probar completar, reabrir y completar nuevamente. |
| TI-10 | Bug de datos/evidencia | P2 | Las fotos de devolución se guardan con `assignmentId = null` y `pendingAssignmentId` (`app/api/ti/photos/route.ts:70-80`), pero la limpieza elimina cualquier foto sin `assignmentId` con más de 60 minutos (`lib/services/ti/assignment-photos.ts:113-125`). Una devolución abierta durante más de una hora puede perder sus evidencias antes de enviarse. | Limpiar solo registros con ambos vínculos nulos o modelar estados de carga pendientes; agregar prueba con foto de devolución antigua. |
| TI-11 | Bug de fecha | P2 | Fechas civiles `YYYY-MM-DD` se comparan con `new Date(...)` en UI y alertas (`app/(app)/ti/activos/asset-table.tsx:61-70`, `asset-summary.tsx:54-56`, `garantias/warranty-table.tsx:21-29`, `lib/services/ti/alerts.ts:49-81`). En Chile, el parseo UTC puede marcar vencida una garantía que termina hoy y puede divergir de SQL `current_date`. | Usar helper común de fecha civil basado en `todayInChile()` o comparaciones SQL con zona explícita; agregar casos límite en cambio de día chileno. |
| TI-12 | Integridad de licencias | P2 | `assignLicense` valida licencia y capacidad, pero no valida trabajador/activo activos, correspondencia de faena ni scope (`lib/services/ti/licenses.ts:97-127`). Puede registrar una asignación cruzada entre faenas. `updateLicense` además puede dejar asignadas más licencias que las compradas y no está expuesto en la UI. | Validar relaciones y scope en servidor, impedir reducir la capacidad bajo asignaciones vigentes y agregar edición controlada. |
| TI-13 | Integridad de accesos | P2 | Al reactivar un acceso, `revokedAt` conserva la fecha antigua; además el formulario envía `notes` vacío y puede borrar notas anteriores (`lib/services/ti/access.ts:84-101`). | Poner `revokedAt: null` al reactivar y distinguir “sin cambio” de “borrar nota”; cubrir baja → activo y preservación de notas. |
| TI-14 | Integridad/UX | P2 | `itAccessSystems.name` no es único (`db/schema/ti.ts:256-265`), `createAccessSystem` no evita duplicados y la matriz busca por `systemName` (`access-matrix.tsx:72-74`). Dos sistemas homónimos pueden mostrar o editar la celda incorrecta. | Añadir unicidad o una clave de negocio explícita y resolver la matriz por `systemId`. |
| TI-15 | UX responsive | P2 | La tabla de asignaciones ofrece Devolver/Transferir en escritorio (`assignments-table.tsx:78-97`), pero la tarjeta móvil solo navega al activo (`assignments-table.tsx:102-115`). El flujo operativo principal queda oculto en móvil. | Mantener las acciones en la tarjeta móvil, con botones accesibles y confirmación según corresponda. |

## Hallazgos de UI, accesibilidad y mantenibilidad

- **P3 — Activadores no accesibles:** React Doctor detectó `span` con `onClick` sin semántica de teclado en las hojas de activo, asignación, devolución, transferencia, baja, licencia, mantención y ticket. Ejemplos: `app/(app)/ti/asignaciones/assignment-sheet.tsx:129-132` y `app/(app)/ti/tickets/ticket-sheet.tsx:43-46`. Reemplazar por `<button>` o reutilizar el patrón `asChild`.
- **P3 — Respuesta HTTP frágil:** las hojas de asignación y devolución hacen `response.json()` antes de comprobar `response.ok` (`assignment-sheet.tsx:107-113`, `return-sheet.tsx:106-112`). Parsear de forma segura y reportar correctamente respuestas no JSON.
- **P3 — Object URLs:** las previsualizaciones usan `URL.createObjectURL` y la revocación está ligada al cierre; falta limpieza garantizada al desmontar (`assignment-sheet.tsx:113`, `return-sheet.tsx:112`).
- **P3 — Búsqueda/filtros de accesos:** `/ti/accesos` acepta `q`, `sistema` y `faena` en query string, pero no presenta controles visibles y la matriz no consume el filtro global del `TopBar` (`app/(app)/ti/accesos/page.tsx:26-40`).
- **P3 — Empty states:** varias vistas usan párrafos simples sin CTA ni el componente compartido `EmptyState`, por ejemplo activos (`app/(app)/ti/activos/page.tsx:93-97`), mantenciones (`app/(app)/ti/mantenciones/page.tsx:56-58`) y checklists (`checklists-panel.tsx:75-76`).
- **P3 — Fechas/controles:** hojas de asignación, devolución y transferencia usan `datetime-local` nativo. Esto puede variar por locale y no sigue el estándar compartido de controles de fecha/hora.
- **P3 — Gráfico:** `ti-charts.tsx:96-98` devuelve `null` si todas las mantenciones tienen costo cero, pese a que el gráfico también promete mostrar cantidad. Las intervenciones gratuitas desaparecen del análisis.
- **P3 — Impresión:** la página de acta envuelve un `PrintTrigger` dentro de `print-toolbar` (`app/(print)/ti/actas/[assignmentId]/print/page.tsx:43-49`); revisar si genera toolbar duplicada.

## Cobertura y advertencias de automatización

- El smoke E2E cubre dashboard, activo sembrado, ticket sembrado, exportación Excel y redirección de un rol sin `ti:view` (`e2e/ti-modulo.spec.ts`): es una buena señal de humo, pero no cubre mutaciones por faena, adjuntos, licencias, accesos, checklists, bajas, garantías ni responsive.
- No existe `npm run audit` ni `npm run audit:full` en `package.json` en este checkout, por lo que no fue posible ejecutar el pipeline canónico indicado por el contrato QA.
- No existía `qa/reports/latest.md`; este archivo documenta la auditoría actual. El crawler de navegador no completó ninguna ruta por el error de servidor local `write EPIPE`.
- React Doctor reportó además deuda global del repositorio. No se debe interpretar su score global (**49/100**) como score del módulo TI; para TI se observaron 56 advertencias y ningún error clasificado por la herramienta.
- No se observaron secretos ni credenciales en la salida de auditoría.

## Correcciones aplicadas y evidencia posterior

### Seguridad y autorización

- TI-01: las mutaciones de activos, asignaciones, bajas, mantenciones, licencias, accesos y fotografías reciben el alcance de faenas resuelto desde la sesión; los servicios vuelven a comprobar el activo o trabajador objetivo antes de mutar.
- TI-02: la descarga de adjuntos resuelve la entidad propietaria (`it_asset`, asignación, mantención, ticket, baja o licencia) y responde como no encontrado cuando está fuera del alcance.
- TI-03: accesos, trabajadores, checklists, licencias y destinos se filtran por faena. El catálogo de sistemas no tiene clave de faena y sus mutaciones quedaron reservadas a alcance global.
- TI-04: el historial exportable de un activo valida el activo dentro del alcance antes de consultar sus eventos.

### Integridad de estados y datos

- TI-05: el cambio manual solo acepta estados manuales; los estados terminales requieren la baja formal. La baja por pérdida/robo cierra toda custodia abierta que encuentre y conserva el motivo en el historial.
- TI-07/TI-08: reabrir un ticket limpia resolución y fecha de resolución, y las transiciones ya no reasignan silenciosamente al usuario que las ejecuta.
- TI-09: completar o reabrir tareas recalcula `completedAt` del checklist.
- TI-10: la limpieza de fotografías no elimina cargas pendientes de devolución.
- TI-11: garantías, antigüedad, alertas y reportes usan comparación de fecha civil con `todayInChile()`.
- TI-12: asignaciones de licencia validan trabajador, activo, faena, alcance y capacidad; la edición está disponible y no permite reducir la compra bajo asignaciones vigentes.
- TI-13/TI-14: reactivar accesos limpia `revokedAt` y conserva notas; el catálogo impide nombres duplicados sin distinguir mayúsculas y la matriz resuelve por `systemId`.
- Se excluyeron activos eliminados lógicamente de reportes, ranking, costos, garantías, gráficos y KPI de custodias.

### UX, accesibilidad y consistencia

- TI-15: las tarjetas móviles conservan Devolver y Transferir.
- Los activadores de hojas usan `SheetTrigger asChild` y los activadores de acciones son botones accesibles.
- Las cargas de fotografías manejan respuestas no JSON/HTTP fallidas y liberan `ObjectURL` al desmontar.
- Accesos tiene filtros visibles por trabajador, faena y sistema; los estados vacíos relevantes usan `EmptyState`.
- Las fechas civiles se muestran con los helpers compartidos y las acciones de fecha-hora usan el nuevo `DateTimePicker`, compuesto por calendario y hora explícita.
- El gráfico mensual mantiene las intervenciones aunque el costo sea cero y usa doble eje para costo/cantidad; el acta imprimible ya no duplica la barra de impresión.

### Verificación posterior

- `npm run test:pglite --` sobre los 6 archivos TI: **71/71 OK**.
- `npm run test:fast -- lib/__tests__/ti-actions.test.ts lib/services/ti/civil-dates.test.ts`: **12/12 OK**.
- `npm run typecheck`: **bloqueado por cambios ajenos en trabajadores, entregas y opciones de bodega** (`sizeFamilies`, `voidedAt/voidReason` e import faltante de `isNull`). El código TI no produjo errores en la ejecución anterior al ingreso de esos cambios concurrentes.
- `npm run lint`: **OK**.
- `npm run db:generate`: **sin cambios pendientes**.
- `npm run db:verify-migrations`: **cadena verificada durante la ejecución hasta `0252_quiet_galactus`**.
- `git diff --check`: **OK**.
- React Doctor sobre cambios: **sin advertencias de accesibilidad en TI**; quedan advertencias de complejidad/tamaño de componentes, clasificadas como deuda de mantenibilidad, no como bugs confirmados.
- Suite completa: **1.166/1.167 pruebas OK**; el único fallo es `module-toggles.test.ts`, que detecta cuatro rutas nuevas de trazabilidad sin inventariar (`/trazabilidad...`), fuera del módulo TI.
- Build de producción: iniciado, pero cancelado después de varios minutos sin progreso observable de Turbopack; no se reporta como exitoso.
- Navegador: Chromium funcionó fuera del sandbox y no produjo errores de consola, pero la sesión QA redirigió `/ti` y sus subrutas a `/dashboard`; no se pudo verificar el contenido autenticado del módulo.

## Pruebas de regresión recomendadas antes de liberar

1. Repetir con una sesión QA autorizada los flujos de lectura y mutación entre faena A y faena B, incluyendo adjuntos y exportación de historial.
2. Aplicar la migración `0252_quiet_galactus` en una copia controlada con datos reales y revisar previamente posibles nombres duplicados en `it_access_systems`.
3. Resolver el fallo ajeno de `module-toggles.test.ts` para que la suite completa vuelva a quedar verde.
4. Repetir el build de producción en un entorno con tiempo suficiente y conservar su salida como evidencia de release.
5. Ejecutar prueba visual responsive del flujo de asignaciones, devolución y transferencia con una sesión que tenga permisos TI.

## Conclusión

Los hallazgos TI-01 a TI-15 y los problemas P3 de UI identificados en la auditoría inicial tienen corrección en código y cobertura determinística enfocada. Antes de liberar, falta repetir la navegación y los flujos de mutación con una sesión QA que tenga `ti:view` y permisos de gestión, resolver el fallo ajeno de inventario de rutas de trazabilidad y obtener un build de producción concluido.
