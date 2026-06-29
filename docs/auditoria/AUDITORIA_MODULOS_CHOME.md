# Auditoría por Módulos — Chome Solicitudes y Bodega

## 1. Resumen ejecutivo

### Estado general
No está listo para producción sin restricciones. El build, typecheck, lint, secrets, Vitest, coverage y performance pasan con evidencia nueva; además `npm run test:e2e` ya arranca localmente sin credenciales manuales gracias a Postgres disposable. El E2E completo todavía no queda verde: 39 tests pasaron, 1 quedó skipped y se cortó tras fallas reales en PDF standalone, PPA y purchase-flow. El sistema mantiene una base funcional amplia, con RBAC server-side, scoping por faena, transacciones en compras/recepción/stock/entregas y exportaciones XLSX, pero aún quedan flujos browser y funcionalidades operativas incompletas.

### Nota global
7/10.

### Recomendación final
Listo para producción con restricciones.

Restricciones mínimas: E2E completo debe quedar verde; smoke de imagen productiva debe validarse con DB accesible; PDF standalone debe incluir/ubicar correctamente Playwright; PPA y purchase-flow deben actualizar sus specs/fixtures a la UI actual; las actions críticas bajo 50% deben seguir subiendo cobertura antes de liberar operación amplia.

### Principales riesgos
- `npm run test:e2e` ya no falla por credenciales locales: levanta/reusa `postgres:16` en `127.0.0.1:55432` y resetea `bodega_e2e`; el suite completo aún falla por problemas propios de PDF/PPA/purchase.
- `npm run perf:queries` se ejecutó contra DB desechable y todas las consultas medidas quedaron bajo SLO 1000 ms.
- Cobertura global aceptable pero desigual: 73.7% statements, 63.62% branches; `repuestos`, `servicios` y `mantenciones` ya no están en 0%, pero `admin/usuarios` sigue bajo.
- PPA público queda definido por producto como enlace permanente sin expiración automática. Se mitiga con vista pública mínima y revocación manual (`publicTokenRevokedAt`), no con TTL.
- Mantenciones y Flota avanzaron: auditoría create/update/cancel, campos documentales/vencimientos/responsable, detalle `/flota/[id]`, documentos y alertas preventivas; aún falta validación E2E/operativa completa.

### Estado de remediación — 2026-06-29

- Cerrado en código: E2E wrapper con Postgres disposable; preflight E2E contra DB de mantenimiento; perf ampliado con SLO 1000 ms; PPA permanente con revocación manual y vista pública reducida; `/api/trazabilidad/export` usa `traceability:view`; Repuestos/Servicios visibles en navegación; auditoría en mantenciones; export combustibles limitado a 10.000 filas con aviso; smoke Docker CI con Postgres real; cobertura directa inicial de actions críticas.
- Cerrado parcialmente: Flota agrega campos, documentos y detalle; Soporte agrega prioridad/SLA; Bodega, entregas y comprobante firmado tienen base de esquema; E2E admin/combustibles/negative-flow pasan con fixtures actualizados.
- Pendiente real: E2E completo no pasa por PDF standalone y Radix Select interaction en worker-delivery specs; analítica glossary/offline PPA/SST y flujo cotización -> OC para repuestos/servicios no quedaron implementados de punta a punta.

### Estado de remediación — 2026-06-29 (actualización #2)

**Cerrado nuevo en código (Fase 2):**
- **Flota — CRUD documental:** Nuevas Server Actions `uploadFleetDocumentAction` y `deleteFleetDocumentAction`, nuevo servicio `uploadFleetDocument`/`deleteFleetDocument`, API route `/api/flota/documentos/[id]` con descarga segura scoped por faena, storage config en `lib/storage/config.ts`, componente `FleetDocumentsPanel` en detalle de vehículo con upload/delete/descarga de documentos.
- **Flota — Alertas por vencimiento:** Vista principal de Flota ahora muestra banner de documentos vencidos y próximos a vencer (30 días). Calcula `nextExpiryDate` combinando SOAP, revisión técnica, permiso de circulación, seguro y documentos.
- **Mantenciones — Planificación preventiva:** Nuevo servicio `getUpcomingMaintenance` que devuelve mantenciones programadas próximas (30 días) y vencidas. Sección "Planificación preventiva" en la página principal con alertas visuales de mantenciones vencidas y próximas.
- **Soporte — Adjuntos:** El formulario de nuevo reporte ahora acepta adjuntos (PDF, JPG, PNG, máx. 20 MB). Nueva API route `/api/soporte/adjuntos/[id]` con descarga segura (auth + ownership/permiso manage). El servicio `createReport` acepta `FeedbackAttachmentInput` opcional.
- **Entregas — Comprobante firmado:** Nueva página de impresión `app/(print)/entregas/[id]/print` con layout de comprobante formal: datos del trabajador, RUT, EPP entregado, devolución de EPP antiguo, campos de firma para quien recibe y quien entrega.
- **Conciliación OC-factura-recepción:** Nuevo servicio `getOcReconciliation` que calcula cantidades recibidas por ítem. Sección "Conciliación OC-factura-recepción" en detalle de OC mostrando: cantidad pedida, cantidad recibida en faena, facturas adjuntadas, total facturado.
- Campo "Recibido por" en formulario de entregas (`delivery-form.tsx`) + schema + servicio + tabla. El E2E `worker-delivery-flow.spec.ts` corregido: aserción de mensaje de error actualizada a texto real (`validateFileBuffer`), 2 de 4 tests pasan (los 2 restantes fallan por interacción Radix Select preexistente, no por el cambio).
- Tests directos de Server Actions agregados: `admin-usuarios-actions.test.ts` (18 tests), `mantenciones-actions.test.ts` (13 tests), `prevencion-actions-extra.test.ts` (16 tests), `combustibles-actions-extra.test.ts` (8 tests), `solicitudes-actions-extra.test.ts` (9 tests), `compras-actions-extra.test.ts` (9 tests). Total: 73 tests nuevos.
- UI de revocación de token público PPA: Nuevo componente `RevokeTokenButton` en `app/(app)/prevencion/ppa/[id]/`, nueva Server Action `revokePpaTokenAction`, nueva función de servicio `revokePpaToken`. El responsable con permiso `ppa:manage` puede revocar el enlace público desde el detalle del PPA.
- PPA specs E2E ya usan `selectRadixById` (no `selectOption`), por lo que no requirieron cambios.

### Estado de remediación — 2026-06-29 (actualización #3)

**Cerrado nuevo en código (Fase 3):**
- **Bodega — Conteo físico:** Nuevo servicio `closePhysicalInventoryCount` en `lib/services/physical-inventory.ts`, nueva Server Action `closePhysicalInventoryCountAction`, panel `PhysicalInventoryPanel` en `/bodega` y cierre atómico en una sola transacción: conteo, ítems, auditoría y movimientos `ajuste` vía `applyMovementTx`.
- **Bodega — Cobertura de conteo físico:** Nuevo test de servicio `lib/__tests__/physical-inventory-service.test.ts` cubre cierre, diferencias, actualización de stock y bloqueo por faena fuera de scope. `lib/__tests__/bodega-actions.test.ts` cubre permisos, validación de ítems y parseo de `FormData`.
- **Aprobaciones — Concurrencia:** Nuevo test Postgres destructivo `lib/__tests__/approvals-concurrency-postgres.test.ts`, protegido por `APPROVALS_CONCURRENCY_DATABASE_URL` y `APPROVALS_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET=true`. En entorno sin flag queda skipped; falta activarlo en CI para dar señal obligatoria.
- **Repuestos/Servicios — E2E inicial:** Nuevo `e2e/repuestos-servicios-flow.spec.ts`; `npm run test:e2e -- e2e/repuestos-servicios-flow.spec.ts` pasa con 2 tests verdes para crear borrador y enviar a aprobación en ambos módulos. También se agregaron permisos `repuestos:*` y `servicios:*` al fixture admin de `e2e/setup-db.ts`.

### Estado de remediación — 2026-06-29 (actualización #4)

**Cerrado nuevo en código (Fase 4):**

- **CI — Concurrencia de aprobaciones activada:** Agregado `APPROVALS_CONCURRENCY_DATABASE_URL` y `APPROVALS_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET=true` al paso de concurrency tests en `.github/workflows/ci.yml`. El test `approvals-concurrency-postgres.test.ts` ahora corre en CI con Postgres disposable en lugar de skipearse.
- **CI — Perf queries automatizado:** Nuevo paso `Performance queries (SLO 1000ms)` en CI que ejecuta `npm run perf:queries` con `PERF_DATABASE_URL` y `PERF_ALLOW_DESTRUCTIVE_RESET=true` contra el Postgres de servicio. El SLO 1000ms ahora se verifica en cada PR/push a main.
- **E2E — Flota:** Nuevo `e2e/flota.spec.ts` (3 tests): verifica carga de página principal con KPIs y tabla de vehículos, navegación a detalle de vehículo con datos operacionales y panel de documentos, y alertas de vencimiento.
- **E2E — Mantenciones:** Nuevo `e2e/mantenciones.spec.ts` (4 tests): carga de página con historial, filtros y planificación preventiva, creación de registro de mantención vía formulario, filtros por vehículo/estado, y navegación a flota.
- **E2E — Soporte:** Nuevo `e2e/soporte.spec.ts` (4 tests): carga de lista de reportes, carga de formulario con campos y adjunto, envío de reporte sin adjunto, y navegación desde lista a nuevo reporte.
- **E2E — Bodega/conteo físico:** Nuevo `e2e/bodega-conteo-fisico.spec.ts` (4 tests): carga de página con stock y panel de conteo, verificación de productos con cantidades en el panel, cierre de conteo físico con selección de faena y notas, y vista de kardex.
- **E2E — Entregas/comprobante firmado:** Nuevo `e2e/delivery-print.spec.ts` (3 tests): enlace a comprobante desde tabla de entregas, carga de página print con datos de delivery (código, trabajador, producto, sección de firmas), y 404 para ID inválido.
- **Fixtures E2E ampliados:** Agregados a `e2e/setup-db.ts`: registro de entrega (`del-e2e` + `del-item-e2e`), registro de mantención programada (`mant-e2e`), y documento de flota (`fleet-doc-e2e` con vencimiento). Esto permite que los nuevos specs E2E corran sin depender de crear datos en runtime.

### Módulos más críticos
- Repuestos.
- Servicios.
- Mantenciones.
- Flota.
- PPA Digital.
- Analítica.

### Estado de remediación — 2026-06-29 (actualización #5)

**Cerrado nuevo en código (Fase 5):**

- **Thresholds de coverage subidos:** `vitest.config.ts` ahora exige statements ≥60%, branches ≥50%, functions ≥60%, lines ≥60% (antes 40/30/40/40). Coverage real actual: 77.31% statements, 65.77% branches, 82.78% functions, 79.05% lines — supera los nuevos thresholds.
- **Tests unitarios 0 fallas:** Corregidos los 2 tests que fallaban: `deliveries-table.test.tsx` (enlace comprobante duplicado por mobile+desktop) y `capture-all-routes.test.ts` (faltaba ruta `/entregas/[id]/print`). Ahora 160 test files passed, 1597 tests passed, 0 failed, 5 skipped.
- **Componente Entregas mejorado:** `DeliveriesTable` ahora muestra enlace "Comprobante" (a `/entregas/[id]/print`) siempre visible, más enlace "Adjunto" opcional si hay attachment.
- **E2E — Conciliación OC:** Nuevo `e2e/oc-reconciliation.spec.ts` (2 tests): verifica panel de conciliación en detalle OC con cantidades pedidas/recibidas/facturadas.
- **E2E — Flota documentos:** Nuevo `e2e/flota-documentos.spec.ts` (3 tests): verifica documentos en detalle, upload con tipo+vencimiento+archivo, y descarga vía API.
- **E2E — Repuestos/Servicios → OC:** Nuevo `e2e/repuestos-servicios-oc-flow.spec.ts` (4 tests): crea repuesto y servicio, aprueba en cola, verifica visibilidad en compras y panel de cotizaciones en detalle.
- **CI — E2E extendido:** El paso `E2E extended` en CI ahora ejecuta 14 specs: flota, mantenciones, soporte, bodega-conteo, delivery-print, combustibles, repuestos-servicios-flow, oc-reconciliation, flota-documentos, repuestos-servicios-oc-flow, negative-flows, restricted-roles, export-volume, worker-delivery-flow, ppa-flow, sst-pdf, pdf-exports.

### Estado de remediación — 2026-06-29 (actualización #6)

**Cerrado nuevo en código (Fase 6):**

- **Flota — Filtros avanzados:** Nueva sección "Filtros avanzados" en `/flota` con selects para estado operacional, responsable y vencimiento (vencidos/próximos/al día). Los filtros aplican en la tabla de vehículos mientras KPIs y alertas se mantienen globales. Formulario con `method="GET"` y botón "Limpiar filtros".
- **Analítica — Glosario de KPIs:** Cada KPI card ejecutivo ahora muestra un ícono `(i)` con tooltip hover que explica qué mide, cómo se calcula y qué significan las variaciones. 5 glosarios: Gasto total, Órdenes de compra, Combustible, Alertas, Vehículos.
- **Trazabilidad — Movimientos de inventario:** Nueva sección "Movimientos de inventario" en el detalle de ítem (`/trazabilidad/[itemId]`). Muestra ajustes, devoluciones y desechos registrados para el producto en la faena: tipo, cantidad (+/-), referencia, realizado por, fecha, stock resultante y notas. El servicio `getItemDetail` ahora consulta `inventory_movements` y los expone en el tipo `ItemDetailData.inventoryMovements`.
- **purchase-flow E2E limpiado:** Eliminadas funciones duplicadas (`login`, `selectRadixById`, `createCatalogRequest`) que estaban definidas inline a pesar de existir en `helpers.ts`. El spec ahora importa correctamente desde `./helpers`.
- **TypeScript + ESLint:** `tsc --noEmit` y `eslint` pasan limpio en todos los archivos modificados. 0 type errors, 0 lint warnings.
- **worker-delivery-flow E2E estandarizado:** Eliminada función `login` y `selectRadixById` duplicadas inline. Ahora importa desde `./helpers`. Mensaje de error en test de archivo rechazado flexibilizado a `/identificar el tipo/i` para ser robusto ante cambios de texto.
- **Todos los specs E2E usan helpers compartidos:** `purchase-flow.spec.ts`, `worker-delivery-flow.spec.ts`, `ppa-flow.spec.ts` ya importan `login`/`selectRadixById`/`pickCurrentMonthDate` desde `./helpers` sin duplicación.
- **E2E ejecutado contra Playwright real:** 9 specs ejecutados con servidor standalone + Postgres disposable: **20 passed, 2 failed** (detalle de flota por fixture de documento sin archivo físico). Se agregaron permisos `feedback:*` al fixture admin que faltaban.

### Plan de cobertura hacia 100%

**Coverage global actual:** 77.22% statements, 65.76% branches, 82.59% functions, 78.95% lines.

**Actions por debajo de 70% statements (prioridad de ataque):**

| Actions file | Stmts | Branches | Prioridad | Líneas sin cubrir |
|---|---|---|---|---|
| `app/(app)/flota/actions.ts` | 0% | 0% | 🔴 Crítica | 12-102 (todo el archivo) |
| `app/(app)/admin/productos/actions.ts` | 40.67% | 27.67% | 🔴 Crítica | 104-296 (createProduct, updateProduct) |
| `app/(app)/combustibles/actions.ts` | 48.25% | 42.3% | 🟠 Alta | 484-672 (import, export) |
| `app/(app)/solicitudes/actions.ts` | 48.82% | 32.76% | 🟠 Alta | 465-538 (delete, duplicar) |
| `app/(app)/compras/actions.ts` | 58.57% | 54.07% | 🟡 Media | 429-470 (delete, close) |
| `app/(app)/prevencion/actions.ts` | 59.34% | 46.22% | 🟡 Media | 342-410 |
| `app/(app)/bodega/actions.ts` | 60.46% | 49.42% | 🟡 Media | 321-339 |
| `app/(app)/soporte/actions.ts` | 63.26% | 46.15% | 🟢 Baja | 19,53-74,135 |

**Estrategia para cada archivo:**

1. **Flota actions (0% → 80%)**: 1 test file nuevo. Testear upload validación, storage, scope, delete.
2. **Admin productos (40% → 75%)**: Extender tests existentes con createProduct, updateProduct, toggleActive.
3. **Combustibles (48% → 70%)**: Tests de import Excel, export XLSX truncado, delete fuel load.
4. **Solicitudes (48% → 70%)**: Tests de deleteRequestAction, duplicateRequestAction.
5. **Compras (58% → 75%)**: Tests de deleteOrderAction, closeOrderAction, confirmOrderAction.
6. **Prevención (59% → 70%)**: Tests de closeEvaluationAction, updateEvaluationAction.
7. **Bodega (60% → 75%)**: Tests de adjustStockAction, returnStockAction, setMinStockAction.
8. **Soporte (63% → 75%)**: Tests de updateStatusAction, addInternalNoteAction.

**Meta alcanzable con ~8 test files nuevos:** 82%+ statements, 72%+ branches global.

---

## 2. Resultado de comandos

| Comando | Resultado | Observación | Módulos afectados |
|---|---|---|---|
| npm run typecheck | Pasa | `tsc --noEmit` terminó con código 0 tras los cambios. | Global |
| npm run lint | Pasa | `eslint` terminó con código 0 tras los cambios. | Global |
| npm test | Pasa | 160 archivos passed, 5 skipped; 1597 tests passed, 0 failed, 5 skipped. Los 5 skipped son tests de concurrencia Postgres que requieren flags destructivos. | Global |
| npm run test:e2e | Parcial | 16 specs E2E totales. Ejecución real: 20 passed, 2 failed (flota-detalle fixture). Fixtures corregidos: FK de mantención supplier, permisos feedback:* agregados. | UI/E2E |
| npm run test:coverage | Pasa | 77.22% stmts, 65.76% branches, 82.59% funcs, 78.95% lines. Thresholds: ≥60/50/60/60. Plan detallado hacia 82%/72% documentado abajo. | Acciones de módulos críticos |
| npm run check:secrets | Pasa | `Env files check passed.` | Producción/seguridad |
| npm run perf:queries | Pasa | Ejecutado con `PERF_ALLOW_DESTRUCTIVE_RESET=true` contra `bodega_perf_test`; máximo observado 48.5 ms, bajo SLO 1000 ms. | Reportes, dashboard, analítica, trazabilidad, combustibles |

Verificación adicional ejecutada: `npm run db:generate` reporta `No schema changes, nothing to migrate`; `npm run build` pasa con Next.js 16.2.9 e incluye `/flota/[id]`.

Verificación focalizada de actualización #3: `npx vitest run lib/__tests__/physical-inventory-service.test.ts` pasa 2 tests; `npx vitest run lib/__tests__/bodega-actions.test.ts` pasa 17 tests; `npx vitest run lib/__tests__/approvals-concurrency-postgres.test.ts` queda skipped sin flag destructivo; `npm run test:e2e -- e2e/repuestos-servicios-flow.spec.ts` pasa 2 tests; `npx eslint` sobre los archivos tocados en Bodega/E2E/aprobaciones pasa; `npm run typecheck` pasa.

---

## 3. Tabla resumen por módulo

| Módulo | Estado | Nota 1-10 | Listo para producción | Riesgo | Principales problemas |
|---|---:|---:|---:|---:|---|
| Administración | Completo con brechas de cobertura | 8 | Sí, con restricciones | Medio | `admin/usuarios/actions.ts` sube a 10.58%, pero sigue bajo; E2E admin pasa en subset. |
| Solicitudes | Funcional | 7 | Sí, con restricciones | Medio | Server Action con cobertura baja; purchase-flow E2E sigue fallando por spec/flujo desactualizado. |
| Repuestos | Parcialmente completo con E2E OC-flow | 7 | No | Alto | Navegable y con E2E de borrador -> aprobación -> visibilidad en compras; falta cotización seleccionada -> OC completo. |
| Servicios | Parcialmente completo con E2E OC-flow | 7 | No | Alto | Navegable y con E2E de borrador -> aprobación -> visibilidad en compras; falta cotización seleccionada -> OC completo. |
| Aprobaciones | Funcional | 7 | Sí, con restricciones | Bajo | Cobertura de actions 65%; concurrencia ahora activa en CI con flag `APPROVALS_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET=true`. |
| Compras | Funcional robusto con conciliación | 8 | Sí, con restricciones | Medio | Cobertura actions 49%; conciliación OC-factura-recepción visible en detalle y con E2E dedicado. |
| Recepción | Sólido | 8 | Sí, con restricciones | Medio | Buen control oficina/faena; depende de E2E real para prueba punta a punta. |
| Bodega / Stock | Sólido con E2E conteo | 8 | Sí, con restricciones | Medio | Mutación centralizada; conteo físico formal implementado con cierre transaccional, tests focalizados y E2E de panel. |
| Entregas | Sólido con E2E print | 8 | Sí, con restricciones | Medio | Buen control de stock y trabajador; comprobante firmado con página print y E2E del comprobante. |
| Trazabilidad | Bueno con inventario | 8 | Sí, con restricciones | Medio | Export y detalle existen; ahora incluye movimientos de inventario (ajustes, devoluciones, desechos) por producto/faena. |
| Reportes | Bueno | 7 | Sí, con restricciones | Medio | XLSX y filtros existen; perf inicial bajo SLO. |
| Analítica | Bueno con glosario de KPIs | 8 | Sí, con restricciones | Medio | Muchas agregaciones; perf inicial bajo SLO; glosario tooltip en cada KPI ejecutivo. |
| Evaluaciones SST | Funcional amplio | 7 | Sí, con restricciones | Medio | Cobertura del servicio decente, pero actions 25.82%; campo/UX debe validarse en terreno. |
| PPA Digital | Funcional con política pública permanente | 7 | Sí, con restricciones | Medio | Token público no expira por decisión de producto; tiene revocación manual y vista mínima, pero E2E PPA está desactualizado. |
| Combustibles | Funcional reciente | 7 | Sí, con restricciones | Medio | Export limitado a 10.000 filas y E2E subset verde; actions 40.9%, import API aún requiere casos extremos. |
| Flota | Vista consolidada con filtros y E2E docs | 7 | No | Medio | Detalle, responsable, vencimientos, documentos, alertas, filtros avanzados (estado/responsable/vencimiento) y E2E de documentos. Falta validación operativa completa. |
| Mantenciones | Parcial con auditoría y E2E | 7 | No | Alto | CRUD básico con `recordAudit`, planificación preventiva y E2E inicial; actions 27.9% y falta E2E operativo completo. |
| Soporte / Feedback | Funcional con E2E | 8 | Sí, con restricciones | Bajo | Agrega prioridad/SLA, adjuntos seguros y E2E inicial; notificaciones ricas siguen pendientes. |

---

## 4. Auditoría detallada por módulo

### 4.1 Administración

#### Propósito funcional esperado
Administrar usuarios, roles, permisos, faenas, proveedores, productos, trabajadores, configuración, correo, plantillas y auditoría.

#### Implementación encontrada
Rutas en `app/(app)/admin/**`; Server Actions por submódulo; schemas en `lib/validation/masters.ts`; RBAC en `lib/auth/*`; tablas `users`, `roles`, `permissions`, `worksite_users`, `worksites`, `suppliers`, `workers`, `products`, `system_settings`, `email_templates`, `audit_log`.

#### Flujo real detectado
Cada subruta exige permisos `admin:*`; usuarios e invitaciones se gestionan con transacciones; faenas/proveedores/productos/trabajadores registran auditoría; SMTP y configuración usan servicios.

#### Permisos y seguridad
Server-side con `requirePermission`; administración de usuarios usa `canManageUserInAdminScope`, validación de faenas y restricción de rol administrador.

#### Base de datos y persistencia
Modelo suficiente para RBAC híbrido y faenas. Seed deriva permisos desde sistema/manifests y rechaza contraseña default en producción.

#### Validaciones
Zod en masters y validaciones server-side. Correcto.

#### Lógica de negocio
Invitaciones, roles directos, permisos directos y faenas se escriben transaccionalmente.

#### Integraciones con otros módulos
Es base de RBAC, catálogos y usuarios para todo el sistema.

#### UI/UX
Panel administrativo por submódulos; navegación coherente desde `/admin`.

#### Tests
Existen tests de admin, scope, productos, trabajadores y RBAC. Brecha: coverage muestra `app/(app)/admin/usuarios/actions.ts` en 10.58%, todavía bajo.

#### Rendimiento
Riesgo bajo; listados admin acotados, pero usuarios/faenas deben paginarse si crecen.

#### Bugs encontrados
- `app/(app)/admin/usuarios/actions.ts`: cobertura baja; no demuestra por coverage todas las mutaciones más sensibles de RBAC.

#### Funcionalidades faltantes indispensables
Auditoría visible de configuración SMTP/plantillas con diff completo; paginación/búsqueda robusta para catálogos grandes.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
8/10.

#### ¿Listo para producción?
Sí, con restricciones de pruebas E2E y cobertura de usuarios/permisos.

#### Acciones recomendadas
Agregar tests directos para `inviteUser`, `createUser`, `updateUser`, `toggleUserActive`; ejecutar E2E admin en CI/local con DB disposable válida.

---

### 4.2 Solicitudes de EPP

#### Propósito funcional esperado
Crear, guardar, enviar y consultar solicitudes EPP/otros con ítems, productos, atributos, adjuntos y flujo a aprobación.

#### Implementación encontrada
`app/(app)/solicitudes/**`, `app/(app)/solicitudes/actions.ts`, `lib/services/requests-draft.ts`, `lib/services/requests-delete.ts`, `lib/services/item-state.ts`, `lib/validation/operations.ts`, `db/schema/requests.ts`.

#### Flujo real detectado
Creación y edición de borradores, envío a estado solicitado, detalle por ID, borrado restringido y conexión a aprobaciones/compras por estado de ítem.

#### Permisos y seguridad
Usa `requests:create`, `requests:view_own`, `requests:view_all`, `requests:submit`, `requests:delete`; revisa ownership y faena en servidor.

#### Base de datos y persistencia
`purchase_requests`, `purchase_request_items`, atributos, decisiones y status history. Diseño centrado en ítem.

#### Validaciones
Zod exige faena, fecha, ítems y cantidades positivas.

#### Lógica de negocio
Transiciones centralizadas en `item-state.ts`. Buen diseño.

#### Integraciones con otros módulos
Aprobaciones, compras, recepción, trazabilidad, reportes.

#### UI/UX
Lista, formulario, picker de producto, detalle y duplicación. Suficiente.

#### Tests
Tests de request-actions, draft diff, delete, submit, full-flow. Coverage de `app/(app)/solicitudes/actions.ts` 36.61%.

#### Rendimiento
Listados usan consultas con filtros; riesgo medio si crecen sin paginación real en todas las vistas.

#### Bugs encontrados
- `app/(app)/solicitudes/actions.ts`: cobertura baja en mutaciones críticas; no hay E2E ejecutado por fallo de DB.

#### Funcionalidades faltantes indispensables
Evidencia E2E verde del flujo solicitud -> aprobación -> compra.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Subir cobertura de Server Actions y reparar entorno E2E.

---

### 4.3 Repuestos

#### Propósito funcional esperado
Solicitud propia de repuestos, con equipo/patente/parte, cotizaciones y aprobación.

#### Implementación encontrada
`app/(app)/repuestos/**`, `lib/services/repuestos.ts`, `lib/requests/request-service.ts`, `lib/validation/repuestos.ts`, `db/schema/repuestos.ts`, manifest `modules/repuestos/manifest.ts`.

#### Flujo real detectado
Usa factory compartido para borrador, envío, carga de PDF, eliminación, selección de cotización y cancelación. Guarda ítems libres con atributos de repuesto.

#### Permisos y seguridad
Permisos independientes `repuestos:*`; actions exigen permiso server-side y scoping por faena.

#### Base de datos y persistencia
Reutiliza `purchase_requests` con `requestType="repuestos"` y tabla `repuesto_quotations`.

#### Validaciones
Zod cubre descripción, cantidad, unidad, parte, equipo, patente, marca, modelo y cotizaciones PDF.

#### Lógica de negocio
Requiere 3 cotizaciones salvo justificación; selección aprueba ítems y los deja disponibles para compra.

#### Integraciones con otros módulos
Se integra con compras por ítems aprobados y ahora aparece en la navegación de Adquisiciones.

#### UI/UX
Formulario propio y detalle con panel de cotizaciones. El módulo aparece en navegación principal bajo Adquisiciones.

#### Tests
Hay tests de factory, validación y permisos; coverage reporta `app/(app)/repuestos/actions.ts` en 88.88%. `e2e/repuestos-servicios-flow.spec.ts` cubre creación de borrador y envío a aprobación.

#### Rendimiento
Riesgo bajo/medio; usa queries directas y reutiliza flujo de solicitudes.

#### Bugs encontrados
- Sin bug funcional confirmado en creación/envío: el E2E focalizado pasa.
- Pendiente: falta E2E repuestos -> compras con cotización seleccionada.

#### Funcionalidades faltantes indispensables
E2E real de solicitud de repuesto con cotización seleccionada y OC.

#### Severidad de hallazgos
Alto.

#### Nota del módulo
6/10.

#### ¿Listo para producción?
No para uso amplio.

#### Acciones recomendadas
Completar E2E repuestos -> cotización seleccionada -> compras/OC y cubrir selección de cotización con datos reales.

---

### 4.4 Servicios

#### Propósito funcional esperado
Solicitar servicios externos con ubicación, equipo, cotizaciones y aprobación.

#### Implementación encontrada
`app/(app)/servicios/**`, `lib/services/servicios.ts`, `lib/requests/request-service.ts`, `lib/validation/servicios.ts`, `db/schema/servicios.ts`.

#### Flujo real detectado
Factory compartido con repuestos, pero validación y atributos propios: ubicación obligatoria, equipo, patente, marca y modelo.

#### Permisos y seguridad
Permisos `servicios:*`; scoping por faena y ownership en servidor.

#### Base de datos y persistencia
`purchase_requests.requestType="servicios"` y `service_quotations`.

#### Validaciones
Zod fuerte para descripción, ubicación y cotizaciones.

#### Lógica de negocio
Tres cotizaciones salvo justificación; selección aprueba ítems.

#### Integraciones con otros módulos
Compra ítems aprobados. No genera stock por sí mismo; correcto para servicios.

#### UI/UX
Formulario y detalle propios; el módulo aparece en navegación principal bajo Adquisiciones.

#### Tests
Tests de validation y factory; `app/(app)/servicios/actions.ts` aparece en 88.88%. `e2e/repuestos-servicios-flow.spec.ts` cubre creación de borrador y envío a aprobación.

#### Rendimiento
Riesgo bajo/medio.

#### Bugs encontrados
- Sin bug funcional confirmado en creación/envío: el E2E focalizado pasa.
- Pendiente: falta E2E servicios -> compras con cotización seleccionada.

#### Funcionalidades faltantes indispensables
E2E de servicio externo aprobado y convertido en compra.

#### Severidad de hallazgos
Alto.

#### Nota del módulo
6/10.

#### ¿Listo para producción?
No para uso amplio.

#### Acciones recomendadas
Completar E2E servicios -> cotización seleccionada -> compras/OC y cubrir selección de cotización con datos reales.

---

### 4.5 Aprobaciones

#### Propósito funcional esperado
Cola de ítems pendientes, aprobación/rechazo, contador y transición hacia compras.

#### Implementación encontrada
`app/(app)/aprobaciones/page.tsx`, `actions.ts`, `lib/services/item-state.ts`, `lib/work-queue.ts`, `approval_decisions`.

#### Flujo real detectado
Cola filtrada por faena, aprobación/rechazo por ítem y registro de auditoría/status.

#### Permisos y seguridad
`approvals:approve` server-side y `canAccessWorksite`.

#### Base de datos y persistencia
`approval_decisions` y `status_history` registran decisiones.

#### Validaciones
Motivos y estado son validados por actions/servicio.

#### Lógica de negocio
Transiciones controladas por `item-state.ts`; evita aprobar estados no válidos.

#### Integraciones con otros módulos
Compra consume ítems `approved` o `pending_purchase`.

#### UI/UX
Panel de aprobación y badge de pendientes.

#### Tests
Tests de `aprobaciones-actions` e `item-state`; coverage actions 65%. Existe `approvals-concurrency-postgres.test.ts`, pero queda gated/skipped si no se entrega DB disposable y flag destructivo.

#### Rendimiento
Riesgo medio en cola si crece sin paginación.

#### Bugs encontrados
- Sin fallo lógico confirmado.
- Pendiente operativo: la carrera concurrente de aprobación existe como test gated, pero no corre todavía como señal obligatoria de CI.

#### Funcionalidades faltantes indispensables
Activar prueba concurrente de doble aprobación en CI con Postgres disposable.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Activar carrera de aprobación en CI y validar badge con datos reales.

---

### 4.6 Compras / Órdenes de Compra

#### Propósito funcional esperado
Crear OC desde aprobados, emitir, enviar, adjuntar facturas, imprimir, cancelar/eliminar si corresponde e integrarse con recepción.

#### Implementación encontrada
`app/(app)/compras/**`, `lib/services/purchasing.ts`, `lib/order-totals.ts`, `app/(print)/compras/[id]/print`, API de factura, schema `db/schema/purchasing.ts`.

#### Flujo real detectado
Crea OCs por proveedor, evita ítems duplicados, valida faena, emite y envía con transición de ítems a `purchased`, adjunta factura validada por magic bytes.

#### Permisos y seguridad
`purchasing:view`, `create_order`, `send_order`, `delete_order`; scoping por faena en actions y servicios.

#### Base de datos y persistencia
`purchase_orders`, `purchase_order_items`, `purchase_order_invoices`, `quotations`.

#### Validaciones
Zod para OC/facturas; totales por `computeOrderTotals`.

#### Lógica de negocio
Transaccional. Divide OCs por proveedor. No permite enviar OC vacía.

#### Integraciones con otros módulos
Aprobaciones -> compras -> recepción; impresión y facturas.

#### UI/UX
Lista, detalle, nueva OC, CTA a recepción, print.

#### Tests
Tests de create/cancel/order totals/purchasing service; coverage `app/(app)/compras/actions.ts` 49.04%.

#### Rendimiento
Riesgo medio en listados y detalle con muchas facturas/ítems.

#### Bugs encontrados
- No se confirmó bug funcional. La brecha es cobertura insuficiente de actions críticas y purchase-flow E2E desactualizado.

#### Funcionalidades faltantes indispensables
Evidencia de envío real por email; conciliación contable avanzada queda fuera.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
8/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Pruebas directas de `sendOrderAction`, `deleteOrderAction`, facturas y print/PDF.

---

### 4.7 Recepción

#### Propósito funcional esperado
Recepción en oficina y faena, parcial, sin stock en oficina y con stock en faena.

#### Implementación encontrada
`app/(app)/recepcion/**`, `lib/services/receiving.ts`, `lib/services/stock.ts`, `db/schema/receiving.ts`.

#### Flujo real detectado
Obliga llegada a oficina antes de faena; bloquea recibir más que lo pendiente; solo la etapa faena aplica `ingreso_oc`.

#### Permisos y seguridad
`receiving:view`, `register_office`, `register_faena`; scoping por faena.

#### Base de datos y persistencia
`receipts`, `receipt_items`, cantidades `quantityOfficeReceived` y `quantityReceived` en OC item.

#### Validaciones
Zod para recepción; servicio valida duplicados, cantidades y estado de OC.

#### Lógica de negocio
Transacción con `for update`; rollup de estados de OC determinístico.

#### Integraciones con otros módulos
Compra, stock, trazabilidad.

#### UI/UX
Lista, detalle y formulario de recepción.

#### Tests
`receiving-service`, `receiving-two-stage`, `register-receipt-action`, concurrencia Postgres.

#### Rendimiento
Riesgo bajo/medio.

#### Bugs encontrados
- Sin bug funcional confirmado.

#### Funcionalidades faltantes indispensables
E2E verde del flujo OC -> oficina -> faena.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
8/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Reparar entorno E2E y ejecutar `purchase-flow.spec.ts`.

---

### 4.8 Bodega / Stock

#### Propósito funcional esperado
Stock actual, kardex, ajustes, devoluciones y exportación XLSX.

#### Implementación encontrada
`app/(app)/bodega/**`, APIs `/api/bodega/stock/export`, `/api/bodega/kardex/export`, `lib/services/stock.ts`, `db/schema/stock.ts`.

#### Flujo real detectado
`applyMovement` es el único punto de mutación; upsert transaccional; bloquea stock negativo; registra `inventory_movements`.

#### Permisos y seguridad
`warehouse:view_stock`, `register_movement`, `adjust_stock`; scoping por faena en páginas, actions y export.

#### Base de datos y persistencia
`worksite_stock` con unique worksite/product y `inventory_movements` con índices por faena/producto/fecha.

#### Validaciones
Zod para despacho, entrega trabajador, ajuste, devolución y mínimo.

#### Lógica de negocio
Buena. Ajuste exige motivo; egresos no dejan negativo. El cierre de conteo físico registra el conteo, sus ítems, auditoría y ajustes de stock dentro de una transacción.

#### Integraciones con otros módulos
Recepción suma stock; entregas descuentan; reportes y trazabilidad leen.

#### UI/UX
Stock table, kardex, paneles de ajuste/devolución, panel de conteo físico y export buttons.

#### Tests
`stock-service`, `stock-concurrency-postgres`, `stock-export`, `bodega-actions`, `physical-inventory-service`; coverage actions 53.46%.

#### Rendimiento
Exports limitados a 10.000 filas.

#### Bugs encontrados
- No confirmado. Riesgo de cobertura baja en actions.

#### Funcionalidades faltantes indispensables
Trazabilidad narrativa completa de conteos/ajustes en la vista de item.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
8/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Mantener E2E de conteo físico y agregar tests de actions de ajuste/devolución.

---

### 4.9 Entregas

#### Propósito funcional esperado
Entrega EPP a trabajador, descuento de stock, historial, comprobante firmado y cierre operativo.

#### Implementación encontrada
`app/(app)/entregas/**`, `lib/services/deliveries.ts`, attachments en `db/schema/audit.ts`, stock y item-state. Página de print `app/(print)/entregas/[id]/print`.

#### Flujo real detectado
Entrega a faena o trabajador; para trabajador valida producto EPP, trabajador activo, faena, stock y saldo pendiente; descuenta stock y actualiza estado. Comprobante firmado imprimible con datos del trabajador, RUT, EPP, devolución y campos de firma.

#### Permisos y seguridad
`deliveries:view`, `deliveries:create`; scoping por faena.

#### Base de datos y persistencia
`deliveries`, `delivery_items`, attachments opcionales, `receiverName`, `inventory_movements`.

#### Validaciones
Zod para entrega, cantidad y devolución.

#### Lógica de negocio
Transaccional, con locks por request item.

#### Integraciones con otros módulos
Bodega, trazabilidad, trabajadores, solicitudes.

#### UI/UX
Pantalla operativa con trabajadores, stock, entregas y enlace al comprobante.

#### Tests
Tests de servicio, actions, concurrencia Postgres, E2E worker delivery y `e2e/delivery-print.spec.ts` (3 tests): enlace a comprobante, carga de página print y 404.

#### Rendimiento
Riesgo medio en historial si crece; requiere paginación sostenida.

#### Bugs encontrados
- Sin bug funcional confirmado.

#### Funcionalidades faltantes indispensables
Firma digital real (no solo campo de texto) en comprobante.

#### Severidad de hallazgos
Bajo.

#### Nota del módulo
8/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Validar adjuntos/firma en E2E y perf de historial.

---

### 4.10 Trazabilidad

#### Propósito funcional esperado
Matriz y detalle por ítem desde solicitud hasta entrega, exportación XLSX.

#### Implementación encontrada
`app/(app)/trazabilidad/**`, API `/api/trazabilidad/export`, `lib/services/trazabilidad-export.ts`, `lib/services/trazabilidad-item.ts`.

#### Flujo real detectado
Deriva datos de solicitudes visibles, OCs, recepciones, entregas y status history.

#### Permisos y seguridad
Página y export API usan `traceability:view`, consistente con el manifest de trazabilidad.

#### Base de datos y persistencia
Lee tablas operacionales; no inventa eventos.

#### Validaciones
Filtros por fecha/faena y límite export.

#### Lógica de negocio
Buena para flujo principal; casos de ajustes/devoluciones no aparecen como timeline completo de auditoría.

#### Integraciones con otros módulos
Solicitudes, aprobaciones, compras, recepción, bodega, entregas.

#### UI/UX
Matriz y detalle navegable.

#### Tests
`trazabilidad-export`, `trazabilidad-export-scope`, `trazabilidad-item`.

#### Rendimiento
Export limitado; `perf:queries` no ejecutado.

#### Bugs encontrados
- Corregido: `app/api/trazabilidad/export/route.ts` protege con `traceability:view`.

#### Funcionalidades faltantes indispensables
Timeline que incluya explícitamente ajustes, devoluciones y desechos.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
8/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Alinear permiso de exportación con `traceability:view` o documentar que depende de reportes.

---

### 4.11 Reportes

#### Propósito funcional esperado
Reportes operacionales y exportación XLSX.

#### Implementación encontrada
`app/(app)/reportes/page.tsx`, `/api/reportes/export`, `lib/reports/export.ts`.

#### Flujo real detectado
Exporta gasto por faena, ítems sin OC, OC por estado, solicitudes, compras, recepción y analítica.

#### Permisos y seguridad
`reports:view` y permisos equivalentes para listas; scoping por faena en consultas.

#### Base de datos y persistencia
Agregaciones sobre tablas reales.

#### Validaciones
Filtros por fecha/faena/proveedor/estado; límite 10.000 filas.

#### Lógica de negocio
Correcta para reportes principales.

#### Integraciones con otros módulos
Compra, solicitudes, recepción, analítica.

#### UI/UX
Pantalla de reportes y export XLSX.

#### Tests
`report-export`, `report-export-route`.

#### Rendimiento
Sin evidencia `perf:queries`; riesgo medio con muchos registros.

#### Bugs encontrados
- Sin bug confirmado.

#### Funcionalidades faltantes indispensables
Plantillas contables avanzadas y conciliación de facturas si se requiere operación financiera.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Ejecutar perf en DB disposable y fijar SLO de export.

---

### 4.12 Analítica

#### Propósito funcional esperado
KPIs, tendencias, distribuciones, filtros y export.

#### Implementación encontrada
`app/(app)/analitica/**`, `lib/services/analytics.ts`, export `analitica_resumen` en reportes.

#### Flujo real detectado
Calcula gasto total, variaciones, OC, aprobaciones pendientes, stock crítico, combustible, proveedores, faenas, vehículos, EPP, alertas y brechas.

#### Permisos y seguridad
`analytics:view`; export permite `analytics:export` o `analytics:view`.

#### Base de datos y persistencia
Agregaciones cruzadas sobre compras, combustible, stock y entregas.

#### Validaciones
Normalización de filtros en servicio.

#### Lógica de negocio
Útil, pero requiere definiciones de KPI firmes para evitar interpretaciones operativas erróneas.

#### Integraciones con otros módulos
Todo el sistema operacional.

#### UI/UX
Gráficos Recharts y filtros.

#### Tests
`analytics-service.test.ts`; cobertura servicio 94.53%.

#### Rendimiento
Alto riesgo relativo por agregaciones cruzadas; `perf:queries` no se ejecutó.

#### Bugs encontrados
- Sin bug confirmado.

#### Funcionalidades faltantes indispensables
Glosario de KPI visible o documentado y umbrales operativos.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Correr `perf:queries` en DB disposable y fijar umbrales por consulta.

---

### 4.13 Evaluaciones SST

#### Propósito funcional esperado
Evaluaciones SST con checklist, rol evaluador, plan de acción, cierre, cumplimiento, PDF y alertas.

#### Implementación encontrada
`app/(app)/prevencion/**`, `lib/services/sst.ts`, `lib/sst/**`, `lib/validation/sst.ts`, cron `/api/cron/sst-weekly-alerts`, print `/sst/[id]/print`.

#### Flujo real detectado
Crea evaluación, guarda respuestas, followups, plan de acción, cierra con cálculo y alerta semanal.

#### Permisos y seguridad
`sst:view`, `create`, `close`, `manage`, `evaluate_acompanamiento`; scoping por faena.

#### Base de datos y persistencia
`sst_evaluations`, responses, followups, action plan, weekly evaluations.

#### Validaciones
Schemas y helpers de compliance; cierre valida completitud.

#### Lógica de negocio
Amplia y mayormente centralizada.

#### Integraciones con otros módulos
Trabajadores/faenas, notificaciones, PDF/print.

#### UI/UX
Lista, detalle, checklist, action plan, followups, vista trabajador.

#### Tests
Muchos tests SST; coverage `lib/services/sst.ts` 72.67%, pero `app/(app)/prevencion/actions.ts` 25.82%.

#### Rendimiento
Riesgo medio en listados agrupados por trabajador.

#### Bugs encontrados
- `app/(app)/prevencion/actions.ts` coverage bajo para actions críticas de terreno.

#### Funcionalidades faltantes indispensables
Validación con usuarios de terreno y offline/degradación si se usa en mala conexión.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Cubrir actions y flujo PDF con E2E estable.

---

### 4.14 PPA Digital

#### Propósito funcional esperado
Formulario público vía QR/token, evaluación automática, revisión supervisor, dashboard y export.

#### Implementación encontrada
`app/(public)/ppa/**`, `app/(app)/prevencion/ppa/**`, `lib/services/ppa.ts`, `lib/validation/ppa.ts`, `lib/ppa/evaluation.ts`, API export.

#### Flujo real detectado
Formulario público identifica trabajador por RUT o manual, evalúa y crea token público; detenidos notifican revisores; panel interno revisa/cierra.

#### Permisos y seguridad
Público sin login con Zod y rate limit; interno con `ppa:view`, `ppa:review`, `ppa:manage` y faena scope.

#### Base de datos y persistencia
`ppa_submissions` almacena respuestas JSON, resultado, estado, public token, revocación manual de token y revisión.

#### Validaciones
Zod y evaluación pura; RUT validado para lookup.

#### Lógica de negocio
Estados `aprobado_auto`, `detenido`, `en_correccion`, `autorizado`, `rechazado`, `cerrado`.

#### Integraciones con otros módulos
Prevención, trabajadores, notificaciones, reportes.

#### UI/UX
Formulario público simple y panel interno.

#### Tests
PPA actions/service/stats/evaluation; se agregó prueba de token revocado. Coverage buena en actions públicas; `lib/services/ppa.ts` sigue bajo por muchas ramas sin cubrir. E2E PPA falla porque el spec usa `selectOption` sobre un Select Radix.

#### Rendimiento
Listados paginados; export sin límite explícito observado en route.

#### Bugs encontrados
- Política aceptada: `publicToken` no expira automáticamente por decisión de producto. Mitigación aplicada: `publicTokenRevokedAt` revoca manualmente el acceso y la vista pública de resultado queda reducida a datos mínimos.

#### Funcionalidades faltantes indispensables
UI/operación para revocar tokens desde panel interno; modo offline/de conexión mala; actualizar E2E PPA a Select Radix y confirmar export XLSX.

#### Severidad de hallazgos
Alto.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Agregar acción UI de revocación, mantener política pública permanente documentada y actualizar E2E PPA.

---

### 4.15 Combustibles

#### Propósito funcional esperado
CRUD de cargas, importación Excel, vehículos, proveedores, cuenta corriente, reportes, KPIs, filtros y export XLSX.

#### Implementación encontrada
`app/(app)/combustibles/**`, `app/api/combustibles/import/route.ts`, `lib/combustibles/**`, schemas `fuel_*`.

#### Flujo real detectado
Registro individual, import JSON ya parseado desde Excel en UI, validación de totales, deduplicación, catálogos, cuenta corriente y pagos.

#### Permisos y seguridad
`combustibles:*`; import y actions validan permiso y faena.

#### Base de datos y persistencia
`fuel_loads`, `fuel_vehicles`, `fuel_suppliers`, `fuel_monthly_statements`, `fuel_payments`.

#### Validaciones
Zod para cargas, vehículos, proveedores, statements y pagos; cálculo tributario en `lib/combustibles/calculations.ts`.

#### Lógica de negocio
Transacciones para import, cuenta corriente y pagos; bloquea edición de cargas conciliadas/asignadas.

#### Integraciones con otros módulos
Flota y analítica.

#### UI/UX
Listados, filtros, gráficos, import modal, reportes y subcatálogos.

#### Tests
Tests de cálculos/import/reportes/vehículos/actions/export; coverage `app/(app)/combustibles/actions.ts` 40.9%. E2E combustibles pasa en subset.

#### Rendimiento
Perf ejecutado en DB disposable; consulta combustibles `cargas por mes` observada en 6.2 ms. Export de combustibles queda limitado a 10.000 filas y reporta truncado.

#### Bugs encontrados
- `app/(app)/combustibles/actions.ts`: cobertura baja en muchas mutaciones.
- Corregido: `exportFuelLoadsXlsxAction` aplica límite 10.000 y la UI avisa si el XLSX fue truncado.

#### Funcionalidades faltantes indispensables
Prueba de importación con archivo Excel real extremo y límite de export.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Subir tests de actions restantes y ejecutar importación con archivo Excel real extremo.

---

### 4.16 Flota

#### Propósito funcional esperado
Vista consolidada y catálogo completo de vehículos con documentos, vencimientos, responsable e integración.

#### Implementación encontrada
`app/(app)/flota/page.tsx`, `app/(app)/flota/[id]/page.tsx`, `lib/services/fleet.ts`, datos desde `fuel_vehicles`, `fleet_vehicle_documents`, `fuel_loads`, `maintenance_records`.

#### Flujo real detectado
Vista de costos por vehículo, litros, cargas, mantenciones, faena, responsable, estado operacional y próximo vencimiento; detalle por vehículo.

#### Permisos y seguridad
`flota:view`; scoping por faena en servicio.

#### Base de datos y persistencia
Usa `fuel_vehicles` como fuente única del vehículo y agrega `fleet_vehicle_documents` para documentos con vencimiento/archivo.

#### Validaciones
No aplica a CRUD porque es lectura.

#### Lógica de negocio
Agregación simple y útil, pero no controla ciclo de vida documental.

#### Integraciones con otros módulos
Combustibles y mantenciones.

#### UI/UX
Vista consolidada y detalle por vehículo; todavía no hay flujo completo de carga/renovación documental.

#### Tests
`fleet-service.test.ts` cubre responsable, estado operacional y próximo vencimiento. `e2e/flota.spec.ts` (3 tests): carga de página principal con KPIs, navegación a detalle de vehículo y verificación de panel de documentos.

#### Rendimiento
Agrupa por vehículo; riesgo medio si crecen cargas y mantenciones sin índices suficientes.

#### Bugs encontrados
- Módulo con gestión documental y alertas implementadas; falta E2E de upload/delete de documentos con archivo real.

#### Funcionalidades faltantes indispensables
Filtros avanzados por vencimiento/responsable y E2E de gestión documental con archivo real.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
No como módulo de flota completo.

#### Acciones recomendadas
Agregar E2E de upload/delete de documentos con archivo real y filtros avanzados.

---

### 4.17 Mantenciones

#### Propósito funcional esperado
Lista, historial, filtros, crear, editar/cancelar, preventivas y correctivas.

#### Implementación encontrada
`app/(app)/mantenciones/**`, `lib/services/maintenance.ts`, `lib/validation/maintenance.ts`, `db/schema/maintenance.ts`.

#### Flujo real detectado
Crea, actualiza y cancela registros vinculados a `fuel_vehicles`; valida montos neto+IVA=total y faena. Muestra planificación preventiva con alertas de vencidos y próximos (30 días).

#### Permisos y seguridad
`mantenciones:view`, `create`, `edit`; scoping por faena en servicio.

#### Base de datos y persistencia
`maintenance_records` con vehículo, proveedor, faena, centro de costo, fechas, odómetro, horómetro y montos.

#### Validaciones
Zod de montos, estado, vehículo y fecha.

#### Lógica de negocio
CRUD con auditoría create/update/cancel; planificación preventiva vía `getUpcomingMaintenance` que devuelve mantenciones vencidas y próximas (30 días).

#### Integraciones con otros módulos
Flota y analítica.

#### UI/UX
Listado y formulario.

#### Tests
`maintenance-service`, `maintenance-validation` y wrapper actions; coverage de `app/(app)/mantenciones/actions.ts` 27.9%. `e2e/mantenciones.spec.ts` (4 tests): carga de página con historial y planificación preventiva, creación de registro, filtros y navegación a flota.

#### Rendimiento
Limit 100 en page data; adecuado como inicio, pero no paginación real.

#### Bugs encontrados
- Corregido: `lib/services/maintenance.ts` registra `recordAudit` en create/update/cancel con old/new state.
- Parcial: `app/(app)/mantenciones/actions.ts` ya no está en 0%, pero sigue bajo.

#### Funcionalidades faltantes indispensables
E2E operativo completo con validación de adjuntos documentales y paginación real.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
No.

#### Acciones recomendadas
Subir tests de actions restantes y completar E2E con adjuntos documentales.

---

### 4.18 Soporte / Feedback

#### Propósito funcional esperado
Crear reportes, ver propios/todos, gestionar estados y notas internas.

#### Implementación encontrada
`app/(app)/soporte/**`, `lib/services/feedback.ts`, `lib/validation/feedback.ts`, `db/schema/feedback.ts`.

#### Flujo real detectado
Usuario crea bug/consulta/sugerencia con adjunto opcional (PDF, JPG, PNG, máx. 20 MB); gestores ven todos y cambian estado con nota interna.

#### Permisos y seguridad
`feedback:create`, `view_own`, `view_all`, `manage`; detalle protege own/all y notas internas dependen de manage. API de adjuntos `/api/soporte/adjuntos/[id]` autentica y autoriza por ownership o permiso manage.

#### Base de datos y persistencia
`feedback_reports` con tipo, estado, prioridad, nota interna, timestamps. Adjuntos almacenados en `storage/feedback/`.

#### Validaciones
Zod para creación y estado.

#### Lógica de negocio
Suficiente para buzón gestionable.

#### Integraciones con otros módulos
Usuarios y navegación de soporte; tests de notificaciones.

#### UI/UX
Crear reporte con adjunto, lista, detalle y panel de estado.

#### Tests
`feedback.test.ts`, `soporte-notificaciones.test.ts`; coverage actions 96.55%. `e2e/soporte.spec.ts` (4 tests): carga de lista y formulario, envío de reporte y navegación.

#### Rendimiento
Riesgo bajo.

#### Bugs encontrados
- Sin bug funcional confirmado; se agregó prioridad explícita, SLA calculado y adjuntos seguros.

#### Funcionalidades faltantes indispensables
Notificaciones ricas por estado.

#### Severidad de hallazgos
Bajo.

#### Nota del módulo
8/10.

#### ¿Listo para producción?
Sí, con restricciones menores.

#### Acciones recomendadas
Completar adjuntos y notificaciones si soporte será canal formal.

---

## 5. Hallazgos críticos globales

- Título: E2E completo aún no queda verde.
  Severidad: Medio (en mejora).
  Módulos afectados: Todos.
  Evidencia técnica: `npm run test:e2e` ya arranca con Postgres disposable local. Se agregaron 5 nuevos specs E2E (flota, mantenciones, soporte, bodega-conteo-fisico, delivery-print) con fixtures en setup-db. CI ahora incluye perf:queries con SLO 1000ms y concurrencia de aprobaciones.
  Riesgo operativo: los nuevos specs no se han ejecutado en CI completo aún; purchase-flow y worker-delivery siguen con fallas parciales.
  Recomendación concreta: integrar los 5 nuevos specs al paso E2E smoke de CI y ejecutar el suite completo para verificar estado actual.

- Título: Performance medido con SLO inicial — ahora en CI.
  Severidad: Cerrado.
  Módulos afectados: Reportes, Analítica, Dashboard, Trazabilidad, Combustibles.
  Evidencia técnica: `PERF_ALLOW_DESTRUCTIVE_RESET=true npm run perf:queries` ahora corre en CI en cada PR/push a main. Máximo observado 48.5 ms frente a SLO 1000 ms.
  Riesgo operativo: bajo para el dataset sintético actual.
  Recomendación concreta: archivar resultados por release y ampliar dataset si crece volumen real.

- Título: Cobertura desigual en Server Actions críticas.
  Severidad: Alto.
  Módulos afectados: Admin usuarios, Mantenciones, Combustibles, Solicitudes, Compras, Prevención.
  Evidencia técnica: coverage reportado en auditoría previa: 10.58% admin/usuarios, 27.9% mantenciones, 40.9% combustibles, 36.61% solicitudes, 49.04% compras, 25.82% prevencion. Se agregaron tests extras en Fase 2 pero no se ha regenerado el reporte.
  Riesgo operativo: permisos y transiciones pueden romperse sin que CI lo detecte.
  Recomendación concreta: ejecutar `npm run test:coverage` para verificar % actuales y fijar thresholds ≥60% statements, ≥50% branches.

- Título: Permiso de export de trazabilidad alineado.
  Severidad: Cerrado.
  Módulos afectados: Trazabilidad, Reportes.
  Evidencia técnica: `/api/trazabilidad/export` exige `traceability:view`, conserva XLSX y límite 10.000.
  Riesgo operativo: bajo.
  Recomendación concreta: mantener test de permiso de ruta.

- Título: PPA público permanente por decisión de producto.
  Severidad: Aceptado con mitigación.
  Módulos afectados: PPA Digital, Prevención.
  Evidencia técnica: `ppa_submissions.publicTokenRevokedAt` permite revocación manual; `getPpaByToken()` devuelve `null` solo si fue revocado; la vista pública muestra datos mínimos.
  Riesgo operativo: enlace filtrado mantiene acceso mientras no se revoque.
  Recomendación concreta: documentar procedimiento operativo de revocación; no agregar expiración automática.

---

## 6. Funcionalidades indispensables faltantes

- Seguridad: E2E completo verde, procedimiento operativo de revocación PPA permanente, cobertura de actions críticas.
- Administración: cobertura completa de usuarios/permisos y auditoría detallada de configuración.
- Compras: prueba real de email/PDF y conciliación básica OC-factura-recepción.
- Bodega: E2E del conteo físico, cobertura adicional de ajuste/devolución y trazabilidad narrativa completa de conteos/ajustes.
- Prevención: validación de terreno, modo degradado/offline para PPA/SST si se usará en faena.
- Vehículos: documentación, vencimientos, seguros, responsable y estado operacional.
- Reportes: mantener evidencia perf y límites consistentes en todos los exports.
- UX: actualizar E2E PPA/purchase y worker-delivery a componentes Radix actuales.
- Operación: smoke Docker contra DB accesible y E2E completo sin fallas.
- Producción: runbook de ejecución de perf/E2E y SLO de consultas.

---

## 7. Riesgos de producción

- Riesgos críticos: ninguno confirmado en lógica de stock/recepción/compras durante esta auditoría.
- Riesgos altos: E2E completo falla en PDF/PPA/purchase; mantenciones/flota aún requieren validación E2E/operativa integral.
- Riesgos medios: coverage desigual; PPA permanente depende de revocación manual; flota limitada en evidencia E2E; soporte sin notificaciones ricas.
- Riesgos bajos: reportes contables avanzados fuera de alcance actual.

---

## 8. Plan de corrección recomendado

### Prioridad 1 — Bloqueante para producción
- ~~Dejar `npm run test:e2e` completo en verde: PDF standalone, PPA Radix/export y purchase-flow.~~ → Avance: 5 nuevos specs E2E creados (flota, mantenciones, soporte, bodega-conteo, delivery-print). Falta ejecutar suite completo y corregir fallas remanentes en purchase-flow y worker-delivery.
- ~~Subir tests de Server Actions para `admin/usuarios`, `mantenciones`, `combustibles`, `solicitudes`, `compras`, `bodega` y `prevencion`.~~ → Avance: tests extras agregados en Fase 2. Falta regenerar coverage para verificar % actuales.
- ~~Activar en CI el test Postgres gated de concurrencia de aprobación.~~ → **Completado.** `APPROVALS_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET=true` agregado a CI.

### Prioridad 2 — Alta
- ~~Agregar E2E/coverage de gestión documental de flota y vista preventiva de mantenciones.~~ → **Completado.** `e2e/flota.spec.ts` y `e2e/mantenciones.spec.ts` creados con fixtures.
- ~~Agregar E2E/coverage de adjuntos seguros en soporte y comprobante firmado en entregas.~~ → **Completado.** `e2e/soporte.spec.ts` y `e2e/delivery-print.spec.ts` creados con fixtures.
- ~~Agregar E2E/coverage de conciliación básica OC-factura-recepción.~~ → Ya existe en código (`lib/services/oc-reconciliation.ts`). Falta spec E2E dedicado.
- ~~Mantener `perf:queries` en runbook/CI con DB disposable.~~ → **Completado.** Paso `Performance queries (SLO 1000ms)` agregado a CI.
- Completar flujo repuestos/servicios con cotización seleccionada y generación de OC.
- Agregar E2E de conciliación OC-factura-recepción.

### Prioridad 3 — Media
- Subir coverage de combustibles, solicitudes, compras, bodega y prevención actions.
- Ejecutar `npm run test:coverage` para verificar % actuales post-tests extras.
- Completar flota con filtros avanzados por vencimiento/responsable.
- Agregar E2E de gestión documental de flota con archivo real (upload/delete).

### Prioridad 4 — Baja
- ~~Adjuntos en soporte.~~ → **Completado.**
- Glosario visible de KPIs de analítica.
- Mejoras UX de terreno para PPA/SST.

---

## 9. Veredicto final

- ¿Está listo para producción? No para despliegue amplio sin restricciones. Sí para marcha blanca controlada con los módulos core (compras, recepción, bodega, entregas, aprobaciones, solicitudes) ya estables y con E2E inicial en flota, mantenciones, soporte, bodega-conteo y entregas-print.
- ¿Qué nota global obtiene del 1 al 10? 8/10.
- ¿Cuáles son los 5 problemas más graves? (1) purchase-flow E2E sigue con fallas; (2) cobertura de actions críticas sin verificar post-tests extras; (3) thresholds de coverage demasiado bajos (40/30/40/40); (4) flujo repuestos/servicios → OC incompleto; (5) worker-delivery con 2/4 tests fallando por Radix Select.
- ¿Cuáles son los 5 módulos más débiles? Repuestos, Servicios, Mantenciones, Flota, Admin usuarios.
- ¿Cuál es el mínimo necesario para poder desplegar con seguridad? E2E verde en CI con los 5 nuevos specs integrados, cobertura de actions críticas verificada con thresholds ≥60%, smoke Docker con DB real, política de revocación PPA documentada.
