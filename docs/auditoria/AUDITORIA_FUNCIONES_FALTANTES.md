# Auditoría de Funciones Faltantes Indispensables

**Fecha:** 23 de junio de 2026  
**Alcance:** Repositorio completo — app/, lib/, db/, modules/, components/, e2e/, scripts/, docs/  
**Auditor:** Buffy (agente AI de auditoría de producto y código)

---

## 1. Resumen ejecutivo

El sistema **Plataforma Chome** está en un estado funcional avanzado. El flujo principal del negocio (Solicitud → Aprobación → OC → Recepción → Stock → Entrega) está **completo y operable** desde la creación de solicitudes hasta la entrega a trabajadores, con trazabilidad, auditoría y notificaciones integradas.

**Estado general:**
- **Flujo principal completo:** El ciclo vida de un ítem desde solicitud hasta entrega funciona de punta a punta sin salir de la aplicación.
- **Módulos más completos:** Solicitudes, Aprobaciones, Órdenes de Compra, Recepción, Bodega, Entregas.
- **Módulos parciales:** Trazabilidad (falta vista detallada por ítem), Reportes (faltan tipos de reporte), Administración (falta CRUD de roles como entidad independiente).
- **Riesgos operativos menores:** El sistema no obliga a volver a Excel para completar el flujo principal. Las áreas que requieren intervención externa son funcionales pero con limitaciones de eficiencia.
- **Nivel de confianza:** Alto — la auditoría revisó todas las rutas, acciones, servicios, esquemas, permisos, navegación, tests y documentación del repositorio.

**Principales faltantes detectados:**
1. No existe CRUD de roles por UI (crear/editar roles, modificar permisos de un rol — las mappings están hardcodeadas en system-rbac.ts)
2. Trazabilidad carece de vista detallada por ítem y exportación por trabajador/producto
3. Bodega no tiene exportación de stock ni kardex a XLSX
4. Reportes faltan tipos: por trabajador, por proveedor, por producto, por faena con filtros avanzados
5. Perfil de usuario no permite cambiar contraseña ni editar nombre

**El sistema sí obliga a usar herramientas externas en casos puntuales:** La creación de nuevos roles o modificación de permisos por rol requiere acceso directo a la base de datos. La asignación de roles/permisos a usuarios funciona desde la UI. Todo lo demás es operable desde la UI.

---

## 2. Decisión de producción

```
🟡 Listo para producción con observaciones
```

**Razón:** El flujo principal del negocio está completo y funcional. No existen bloqueadores que impidan la operación diaria. Sin embargo, la ausencia de UI para roles/permisos y la limitación de reportes/trazabilidad son observaciones importantes que deben resolverse en las primeras iteraciones post-producción.

---

## 3. Calificación global

**Calificación funcional global:** 7/10

**Veredicto:** Listo con observaciones

**Justificación de la nota:**

| Criterio | Puntaje | Observación |
|---|---|---|
| Flujo principal (SOL→OC→REC→STOCK→ENTREGA) | 9/10 | Completo, funcional, con validaciones |
| Aprobaciones por ítem | 9/10 | Aprobar, rechazar, devolver, modificar cantidad, bulk approve |
| Órdenes de compra | 9/10 | Crear, emitir, enviar, confirmar, cancelar, cerrar, eliminar, PDF, facturas |
| Recepción dos etapas | 9/10 | Oficina → Faena con validación de cantidades |
| Bodega y stock | 8/10 | Funcional pero sin exportación de stock/kardex |
| Entregas a trabajadores | 9/10 | Con devolución EPP y comprobantes |
| Trazabilidad | 6/10 | Matrix funcional pero sin vista detallada por ítem |
| Reportes | 6/10 | 3 tipos disponibles, faltan tipos por dimensión |
| Administración | 7/10 | CRUD completo; falta CRUD de roles como entidad (asignación a usuarios sí funciona) |
| Notificaciones | 8/10 | In-app + email funcional |
| Auditoría | 8/10 | Log funcional con resumen |
| Seguridad/RBAC | 8/10 | Completo, sin UI de gestión |

**Restricciones de la rúbrica:**
- Flujo principal completo → no aplica restricción de nota 4
- Trazabilidad mínima existe → no aplica restricción de nota 6
- Funciones administrativas mínimas existen pero falta gestión de roles → aplica restricción parcial

---

## 4. Mapa funcional del sistema

| Módulo | Funciones esperadas | Funciones encontradas | Faltantes detectados | Estado general |
|---|---|---|---|---|
| Dashboard | Métricas, tareas pendientes, accesos rápidos, actividad reciente | Métricas reales, cola de trabajo por rol, accesos rápidos por permisos, actividad por faena | Ninguno crítico | **Completo** |
| Solicitudes | CRUD completo, envío, cancelación, duplicación, historial, filtros | Crear, editar, eliminar, duplicar, enviar, cancelar, re-enviar ítem devuelto, filtros por faena/estado/solicitante | Ninguno crítico | **Completo** |
| Aprobaciones | Aprobar/rechazar por ítem, modificar cantidad, motivos, cola, notificaciones | Aprobar, rechazar, devolver, modificar cantidad, bulk approve, notificaciones, validación EPP | Ninguno crítico | **Completo** |
| Órdenes de Compra | Crear, emitir, enviar, confirmar, cerrar, cancelar, PDF, cotizaciones, facturas | Crear por proveedor, emitir, enviar, confirmar, cancelar, cerrar, eliminar, PDF A4, cotizaciones, facturas, cálculo automático | Ninguno crítico | **Completo** |
| Recepción | Oficina, faena, parcial, validación, stock, kardex | Dos etapas (oficina→faena), validación de cantidades, stock al recibir en faena, kardex, códigos REC | Ninguno crítico | **Completo** |
| Bodega | Stock por faena, mínimos, alertas, kardex, ajustes, devoluciones, exportación | Stock por faena, mínimos, alertas, kardex, ajustes con motivo, devoluciones, despacho | Exportar stock, exportar kardex | **Parcial** |
| Entregas | Seleccionar trabajador, producto, cantidad, descontar stock, trazabilidad, historial | Seleccionar trabajador, producto, cantidad, descontar stock, devolución EPP, comprobante, trazabilidad | Historial por trabajador/producto (vista dedicada) | **Parcial** |
| Trazabilidad | Matrix producto×faena, cantidades, filtros, exportación, links | Matrix funcional, alertas, filtros por faena/estado, exportación XLSX, links a solicitud | Vista detallada por ítem, filtro por trabajador/producto, exportación por trabajador | **Parcial** |
| Reportes | Por solicitud, compra, recepción, stock, trabajador, faena, proveedor, producto, exportación | 3 tipos (ítems sin OC, gasto/faena, OC/estado), exportación XLSX, filtros | Reportes por trabajador, proveedor, producto, stock, recepción | **Parcial** |
| Administración | CRUD usuarios, roles, faenas, trabajadores, productos, proveedores, configuración, auditoría | CRUD usuarios (con invitación, roles y permisos por usuario), faenas, trabajadores, productos, proveedores, configuración, auditoría, SMTP, plantillas | CRUD de roles como entidad (crear/editar rol, modificar permisos de un rol), importación masiva | **Parcial** |
| Notificaciones | Campana, polling, in-app, email | Campana funcional, in-app, email por eventos clave, preferencia por usuario | Polling/refresh automático, todas las notificaciones de eventos | **Parcial** |
| Archivos adjuntos | Carga, descarga, eliminación controlada | Carga y descarga funcional, eliminación de facturas | Eliminación de adjuntos de solicitudes desde UI | **Parcial** |
| Auditoría | Log por cambios, status history | Log con filtros, status history, resumen | Paginación, filtros avanzados, exportación | **Parcial** |
| Configuración | Parámetros generales | PDF max size, perfil empresa, SMTP, plantillas de correo | Ninguno crítico | **Completo** |

---

## 5. Funciones bloqueadoras faltantes

No se detectaron funciones cuya ausencia **bloquee** la operación del sistema en producción. El flujo principal está completo.

---

## 6. Funciones importantes faltantes

### [FF-001] CRUD de Roles como Entidad Independiente

**Severidad funcional:** Medio  
**Módulo:** Administración  
**Estado:** Ausente (las mappings de rol→permiso están hardcodeadas)  
**Impacto en producción:** No se pueden crear roles nuevos, editar nombres/descripciones de roles, ni modificar qué permisos hereda cada rol sin acceder a la BD o al código fuente

**Evidencia encontrada:**
- Archivo(s): `db/schema/users.ts` (tablas `roles`, `permissions`, `rolePermissions` existen)
- Archivo(s): `lib/auth/system-rbac.ts` (roles y mappings hardcodeados como constantes `SYSTEM_ROLES`, `SYSTEM_ROLE_PERMISSIONS`)
- Servicio(s): `lib/auth/rbac.ts` (sistema RBAC funcional con cache)
- Seed(s): `db/seed.ts`, `lib/auth/bootstrap.ts` (seed idempotente de roles/permisos)
- Ruta(s): No existe `/admin/roles` — la asignación de roles a usuarios SÍ funciona desde `/admin/usuarios`

**Qué se esperaba que existiera:**
Pantalla administrativa para crear/editar/eliminar roles, asignar permisos a roles, y ver la matriz de permisos por rol.

**Qué existe actualmente:**
- Tablas `roles`, `permissions`, `rolePermissions` en la BD
- Sistema RBAC funcional con cache
- **Asignación de roles y permisos a usuarios desde `/admin/usuarios` (UI completa con toggle chips y checkboxes)**
- Roles y mappings hardcodeados en `lib/auth/system-rbac.ts` como arrays `as const`
- Seed de roles y permisos en `db/seed.ts` y `lib/auth/bootstrap.ts`
- **No existe UI para crear/editar roles ni modificar las mappings rol→permiso**

**Qué falta exactamente:**
- Página `/admin/roles` con listado de roles existentes
- Server Actions para crear/editar/eliminar roles
- UI para modificar qué permisos hereda cada rol (matrix de permisos por rol)
- Validación de integridad al eliminar un rol asignado a usuarios

**Por qué es importante:**
Actualmente los roles están definidos en código fuente. Para agregar un nuevo rol o ajustar permisos se necesita modificar `system-rbac.ts` y re-ejecutar el seed. Con una UI, un admin podría hacerlo sin tocar código.

**Implementación mínima recomendada:**
- Página de listado de roles con opciones de editar
- Formulario para crear/editar nombre y descripción del rol
- Checkbox matrix para asignar permisos al rol
- Botón de eliminar rol (con validación de uso)

**Tests mínimos requeridos:**
- CRUD de roles funciona correctamente
- Asignación de permisos a roles persiste
- Eliminación de rol asignado a usuarios muestra advertencia
- Permisos derivados de roles se reflejan en el RBAC

---

### [FF-002] Exportación de Stock por Faena

**Severidad funcional:** Alto  
**Módulo:** Bodega  
**Estado:** Ausente  
**Impacto en producción:** Imposible generar inventario físico o reporte de stock para una faena específica

**Evidencia encontrada:**
- Archivo(s): `app/(app)/bodega/page.tsx`, `app/(app)/bodega/actions.ts`
- Ruta(s): `/bodega` muestra tabla de stock pero sin botón de exportación
- Servicio(s): `lib/services/stock.ts` tiene `applyMovement` pero no función de exportación

**Qué se esperaba que existiera:**
Botón "Exportar Excel" en la página de bodega que genere un archivo XLSX con el stock actual de una faena, incluyendo producto, SKU, cantidad, mínimo y último movimiento.

**Qué existe actualmente:**
- Tabla de stock por faena con cantidades y mínimos
- Panel de ajuste y devolución
- Kardex visible
- **No hay botón ni endpoint de exportación de stock**

**Qué falta exactamente:**
- Endpoint `/api/bodega/export` o Server Action para generar XLSX de stock
- Botón de exportación en la UI de bodega
- Servicio que consulte `worksiteStock` y genere el buffer XLSX

**Por qué es indispensable:**
Para inventarios físicos, reportes a jefatura y conciliaciones, se necesita exportar el stock actual.

**Implementación mínima recomendada:**
- Endpoint GET `/api/bodega/export?faena=<id>` que retorne XLSX
- Servicio `getStockExport(session, faenaId)` que consulte `worksiteStock` con joins a `products` y `worksites`
- Botón "Exportar stock" en `bodega/page.tsx`

**Tests mínimos requeridos:**
- Endpoint retorna XLSX válido con headers correctos
- Filtrado por faena funciona
- Roles sin permisos reciben 403

---

### [FF-003] Exportación de Kardex

**Severidad funcional:** Alto  
**Módulo:** Bodega  
**Estado:** Ausente  
**Impacto en producción:** Imposible exportar historial de movimientos de inventario para auditoría o conciliación

**Evidencia encontrada:**
- Archivo(s): `app/(app)/bodega/kardex-table.tsx` (tabla visible en UI)
- Tabla(s): `inventoryMovements` en `db/schema/stock.ts`
- No existe endpoint ni servicio de exportación de kardex

**Qué se esperaba que existiera:**
Endpoint para exportar el kardex (historial de movimientos) de un producto en una faena como XLSX, incluyendo tipo de movimiento, cantidad, stock antes/después, responsable, fecha y motivo.

**Qué existe actualmente:**
- Tabla de kardex visible en la UI de bodega
- Datos de movimientos consultables
- **No hay exportación a XLSX**

**Qué falta exactamente:**
- Endpoint `/api/bodega/kardex/export`
- Servicio `getKardexExport(session, worksiteId, productId)`
- Botón de exportación en `kardex-table.tsx`

**Por qué es indispensable:**
El kardex es un documento legal requerido para la trazabilidad de inventarios en faenas industriales.

**Implementación mínima recomendada:**
- Endpoint GET con filtros por faena y producto
- XLSX con columnas: Fecha, Tipo, Producto, Cantidad, Stock Anterior, Stock Posterior, Responsable, Motivo
- Límite de filas con indicador de truncamiento

**Tests mínimos requeridos:**
- Endpoint retorna XLSX válido
- Filtrado por faena y producto funciona
- Movimientos se ordenan cronológicamente

---

### [FF-004] Vista Detallada de Ítem en Trazabilidad

**Severidad funcional:** Alto  
**Módulo:** Trazabilidad  
**Estado:** Ausente  
**Impacto en producción:** Imposible ver la historia completa de un ítem específico (quién solicitó, aprobó, compró, recibió, entregó)

**Evidencia encontrada:**
- Archivo(s): `app/(app)/trazabilidad/page.tsx`
- La página muestra la matrix pero cada ítem no tiene enlace a vista detallada
- El estado de cada ítem se muestra pero no la secuencia temporal de eventos

**Qué se esperaba que existiera:**
Al hacer clic en un ítem de la trazabilidad, se muestra una vista con:
- Timeline de eventos (solicitud → aprobación → OC → recepción → entrega)
- Cantidades en cada etapa
- Responsables en cada etapa
- Fechas de cada transición

**Qué existe actualmente:**
- Matrix de trazabilidad con estados y cantidades
- Links desde la trazabilidad hacia la solicitud original
- **No hay vista detallada del ítem ni timeline de eventos**

**Qué falta exactamente:**
- Página `/trazabilidad/[itemId]` o panel lateral con timeline
- Consulta a `statusHistory` para reconstruir la secuencia de eventos
- Visualización de cantidades en cada etapa del flujo

**Por qué es indispensable:**
Para resolver disputas, verificar entregas y auditar el ciclo de vida completo de un ítem, se necesita esta vista.

**Implementación mínima recomendada:**
- Página o panel con timeline de eventos del ítem
- Datos de `approvalDecisions`, `purchaseOrderItems`, `receiptItems`, `deliveryItems`
- Estados con fechas y responsables

**Tests mínimos requeridos:**
- Timeline muestra eventos en orden cronológico
- Cada etapa muestra responsable y fecha
- Ítems sin eventos completos muestran parcialidad

---

### [FF-005] Reportes por Trabajador

**Severidad funcional:** Alto  
**Módulo:** Reportes  
**Estado:** Ausente  
**Impacto en producción:** Imposible generar reporte de EPP entregado por trabajador para cumplimiento normativo

**Evidencia encontrada:**
- Archivo(s): `app/(app)/reportes/page.tsx`, `lib/reports/export.ts`
- Tabla(s): `deliveries`, `deliveryItems`, `workers` existen con relaciones
- No hay reporte que cruce trabajadores con entregas

**Qué se esperaba que existiera:**
Reporte exportable que muestre: trabajador, faena, productos recibidos, cantidades, fechas de entrega, y EPP pendiente.

**Qué existe actualmente:**
- 3 tipos de reporte: ítems sin OC, gasto por faena, OC por estado
- **No hay reporte por trabajador**

**Qué falta exactamente:**
- Tipo de reporte `entregas_por_trabajador` en `lib/reports/export.ts`
- Query que cruce `deliveryItems` → `deliveries` → `workers`
- Filtros por faena, trabajador y rango de fechas
- Botón de exportación correspondiente en UI

**Por qué es indispensable:**
Para auditorías de EPP y cumplimiento de la Ley 16.744, se necesita saber qué trabajador recibió qué equipo y cuándo.

**Implementación mínima recomendada:**
- Nuevo tipo de reporte en `getReportData`
- XLSX con columnas: Trabajador, RUT, Faena, Producto, SKU, Cantidad, Fecha Entrega, Observaciones
- Filtros por faena y trabajador

**Tests mínimos requeridos:**
- Reporte genera XLSX válido
- Filtrado por trabajador funciona
- Trabajadores sin entregas aparecen vacíos

---

### [FF-006] Reportes por Proveedor

**Severidad funcional:** Alto  
**Módulo:** Reportes  
**Estado:** Ausente  
**Impacto en producción:** Imposible analizar compras por proveedor para negociación y evaluación

**Evidencia encontrada:**
- Archivo(s): `lib/reports/export.ts`
- Tabla(s): `purchaseOrders` tiene `supplierId`, `suppliers` tiene datos del proveedor
- No hay cruce de OC con proveedores para reportes

**Qué se esperaba que existiera:**
Reporte que muestre: proveedor, cantidad de OC, monto total, productos comprados, historial de entregas.

**Qué existe actualmente:**
- Datos de proveedores en OC
- **No hay reporte por proveedor**

**Qué falta exactamente:**
- Tipo de reporte `compras_por_proveedor`
- Query que agrupe `purchaseOrders` por `supplierId`
- Filtros por proveedor, faena y rango de fechas

**Por qué es indispensable:**
Para evaluar proveedores, negociar precios y gestionar contratos, se necesita visibilidad de compras por proveedor.

**Implementación mínima recomendada:**
- Tipo de reporte con agrupación por proveedor
- XLSX: Proveedor, RUT, Cantidad OC, Monto Total, Primer/MÚltima compra
- Filtros por proveedor y rango de fechas

**Tests mínimos requeridos:**
- Reporte genera XLSX válido
- Agrupación por proveedor es correcta
- Totales coinciden

---

### [FF-007] Cambio de Contraseña desde Perfil

**Severidad funcional:** Alto  
**Módulo:** Perfil de usuario  
**Estado:** Ausente  
**Impacto en producción:** Usuarios no pueden cambiar su propia contraseña desde la aplicación

**Evidencia encontrada:**
- Archivo(s): `app/(app)/perfil/page.tsx`, `app/(app)/perfil/actions.ts`
- La página de perfil solo muestra toggle de notificaciones por email
- No hay formulario de cambio de contraseña

**Qué se esperaba que existiera:**
Formulario para cambiar contraseña con validación de contraseña actual, nueva contraseña y confirmación.

**Qué existe actualmente:**
- Toggle de notificaciones email
- **No hay cambio de contraseña**

**Qué falta exactamente:**
- Formulario de cambio de contraseña en `/perfil`
- Server Action `changePassword` que valide la contraseña actual y actualice la hash
- Validación de seguridad (mínimo 8 caracteres, etc.)

**Por qué es indispensable:**
Los usuarios deben poder cambiar su contraseña por seguridad, especialmente después de la contraseña temporal generada por la invitación.

**Implementación mínima recomendada:**
- Sección "Seguridad" en `/perfil` con formulario
- Server Action que valide `currentPassword` contra la hash y aplique la nueva
- Feedback de éxito/error

**Tests mínimos requeridos:**
- Cambio con contraseña actual incorrecta falla
- Cambio con contraseña válida funciona
- Nueva contraseña funciona en login

---

## 7. Funciones parcialmente implementadas o desconectadas

### [FF-008] Notificaciones de Eventos OC y Entregas

**Severidad funcional:** Medio  
**Módulo:** Transversal / Notificaciones  
**Estado:** Parcial  
**Impacto en producción:** No todas las transiciones de estado generan notificaciones

**Evidencia encontrada:**
- Archivo(s): `lib/services/notifications.ts`, `app/(app)/compras/actions.ts`
- Notificaciones existentes: `request_submitted`, `request_approved`, `request_rejected`, `oc_sent`, `receipt_done`, `dispatch_done`, `ppa_*`, `feedback_submitted`
- Notificaciones **NO** generadas: creación de OC, cancelación de OC, cierre de OC, recepción en oficina

**Qué falta exactamente:**
- Notificación al crear OC (para jefatura/secretaría)
- Notificación al cancelar OC (para involucrados)
- Notificación al recibir en oficina (para prevencionista faena)
- Notificación al cerrar OC (para seguimiento)

**Implementación mínima recomendada:**
- Agregar `notifyAfterCommit` en `createOrderAction`, `cancelOrderAction`, `closeOrderAction`
- Agregar notificación en `registerReceiptAction` para stage=office

---

### [FF-009] Paginación y Filtros en Log de Auditoría

**Severidad funcional:** Medio  
**Módulo:** Administración / Auditoría  
**Estado:** Parcial  
**Impacto en producción:** Con miles de eventos, la página carga lenta y no permite buscar

**Evidencia encontrada:**
- Archivo(s): `app/(app)/admin/auditoria/page.tsx`
- Limita a 500 registros sin paginación
- No hay filtros por usuario, tipo de entidad, acción o rango de fechas

**Qué falta exactamente:**
- Paginación del log de auditoría
- Filtros por usuario, tipo de entidad, acción y fecha
- Búsqueda por código de entidad

**Implementación mínima recomendada:**
- Paginación server-side con `limit`/`offset`
- Filtros en query params
- UI de filtros con selects y date pickers

---

### [FF-010] Exportación de Auditoría

**Severidad funcional:** Medio  
**Módulo:** Administración / Auditoría  
**Estado:** Ausente  
**Impacto en producción:** Imposible exportar el log de auditoría para revisión externa

**Evidencia encontrada:**
- No hay endpoint de exportación de auditoría
- Los datos están en `auditLog` table

**Qué falta exactamente:**
- Endpoint `/api/admin/auditoria/export` para XLSX
- Botón de exportación en la UI

**Implementación mínima recomendada:**
- Endpoint GET que genere XLSX del log filtrado
- Columnas: Fecha, Usuario, Acción, Entidad, Código, Detalle, IP

---

### [FF-011] Creación de Plantillas de Correo

**Severidad funcional:** Medio  
**Módulo:** Administración / Plantillas  
**Estado:** Parcial  
**Impacto en producción:** Solo se pueden editar plantillas existentes, no crear nuevas

**Evidencia encontrada:**
- Archivo(s): `app/(app)/admin/plantillas/actions.ts`
- Acciones existentes: `updateTemplateAction`, `resetTemplateAction`, `seedTemplatesAction`
- **No hay `createTemplateAction`**

**Qué falta exactamente:**
- Server Action `createTemplateAction` para crear plantillas nuevas
- Botón "Nueva plantilla" en la UI

**Implementación mínima recomendada:**
- Formulario para crear plantilla con key, nombre, asunto y HTML
- Validación de key única

---

### [FF-012] Importación Masiva de Trabajadores

**Severidad funcional:** Medio  
**Módulo:** Administración  
**Estado:** Ausente  
**Impacto en producción:** Carga inicial de cientos de trabajadores desde Excel requiere ingreso manual uno a uno

**Evidencia encontrada:**
- El `db/seed.ts` carga trabajadores desde JSON pero es script de desarrollo
- No hay importador desde UI
- El repositorio tiene archivos Excel de trabajadores en `docs/`

**Qué se esperaba que existiera:**
Importador que reciba XLSX/CSV con columnas (nombre, apellido, RUT, cargo, faena) y cree trabajadores en lote.

**Qué existe actualmente:**
- CRUD manual uno a uno desde `/admin/trabajadores`
- Seed script para desarrollo
- **No hay importador desde UI**

**Por qué es indispensable:**
Para la puesta en marcha con cientos de trabajadores, el ingreso manual es impracticable.

**Implementación mínima recomendada:**
- Endpoint que reciba XLSX y procese filas
- Validación de RUT duplicado, faena existente
- Reporte de resultados (creados, duplicados, errores)

---

### [FF-013] Importación Masiva de Productos

**Severidad funcional:** Medio  
**Módulo:** Administración  
**Estado:** Ausente  
**Impacto en producción:** Catálogo de productos EPP requiere carga manual

**Evidencia encontrada:**
- El `db/seed/epp-catalog.json` tiene catálogo de ejemplo
- No hay importador desde UI
- CRUD manual uno a uno desde `/admin/productos`

**Qué falta exactamente:**
- Importador de productos desde XLSX
- Mapeo de columnas: SKU, nombre, categoría, U/M, isEpp, etc.

---

## 8. Funciones declaradas en documentación/UI/permisos pero no implementadas

| Función declarada | Dónde se declara | Evidencia | Implementación encontrada | Conclusión |
|---|---|---|---|---|
| Transferencias entre faenas | `bodega/actions.ts` — `returnStockAction` limita a faena original | No documentada como requerida | No existe | Pendiente de definición (no es indispensable) |
| Búsqueda global | `components/layout/command-palette.tsx` | Paleta ⌘K existe y filtra por permisos | Implementada | ✅ Funcional |
| Filtros persistentes | N/A | No está declarada en documentación | No existe | No es indispensable |
| Importación masiva desde Excel | `README.md` — "Hace falta implementar importadores" | Mencionado como pendiente | No existe | Reportada como FF-012/FF-013 |
| Pruebas E2E que creen datos | `README.md` — "Pruebas E2E que creen datos por UI/API" | Mencionado como pendiente | Tests E2E existen pero con datos de seed | Pendiente, no bloquea producción |

---

## 9. Funciones recomendables, pero no indispensables

| Función | Módulo | Justificación |
|---|---|---|
| Dashboard con gráficos interactivos | Dashboard | Métricas actuales son numéricas; gráficos mejorarían visualización pero no bloquean operación |
| Búsqueda global avanzada | Transversal | ⌘K existe; una búsqueda global de texto completo sería conveniente pero no indispensable |
| Filtros persistentes en URL | Transversal | Mejora UX pero no bloquea operación |
| Notificación por push (browser) | Transversal | Notificaciones in-app + email son suficientes para producción |
| Dashboard de métricas por período | Reportes | Los reportes actuales cubren necesidades básicas |
| Historial de cambios por campo | Auditoría | El status history existe; un diff detallado sería conveniente |
| Comprobante de entrega imprimible | Entregas | El campo `proofAttachment` soporta archivos; un PDF imprimible sería adicional |
| Gestión de categorías de productos | Admin | CRUD de categorías existe; una jerarquía de categorías sería adicional |
| Backup automático programado | Operación | El script `backup-pg.sh` existe; automatización con cron sería adicional |
| Métricas de.usage por usuario | Admin | Para optimización de licencias; no bloquea producción |

---

## 10. Impacto por rol

| Rol | Funciones que debería poder hacer | Funciones faltantes | Impacto operativo |
|---|---|---|---|
| Administrador | Control total: usuarios, roles, faenas, productos, proveedores, configuración, auditoría | No puede crear/editar roles como entidad (FF-001 — las mappings están en código); no puede importar masivamente trabajadores/productos (FF-012/013); no puede exportar auditoría (FF-010) | **Bajo** — asignación de roles a usuarios funciona; CRUD de roles es mejorable |
| Jefatura | Revisar, aprobar/rechazar, ver compras, reportes, trazabilidad | No puede ver reportes por trabajador (FF-005) ni por proveedor (FF-006); trazabilidad sin vista detallada (FF-004) | **Bajo** — funciones principales disponibles |
| Secretaría | Crear OC, gestionar proveedores, recepcionar, administrar maestros | Limitada para exportar stock (FF-002) y kardex (FF-003) | **Bajo** — OC y recepción funcionales |
| Prevencionista oficina | Aprobar EPP, recibir en oficina, gestionar información preventiva | Sin reportes por trabajador (FF-005) para cumplimiento normativo | **Medio** — puede aprobar y recepcionar, pero le falta reportabilidad |
| Prevencionista faena | Crear solicitudes, recibir en faena, consultar stock, registrar entregas | Stock sin exportación (FF-002); trazabilidad sin vista detallada (FF-004) | **Bajo** — flujo operativo completo |

---

## 11. Impacto por flujo de negocio

| Flujo | ¿Se puede completar de punta a punta? | Dónde se corta | Funciones faltantes | Severidad |
|---|---|---|---|---|
| Solicitud → Entrega | **Sí** | — | Ninguna | N/A |
| Compra | **Sí** | — | Ninguna | N/A |
| Recepción | **Sí** | — | Ninguna | N/A |
| Bodega | **Parcial** | Exportación | FF-002, FF-003 | Alto |
| Entregas | **Sí** | — | Ninguna (historial por trabajador es conveniente) | N/A |
| Administración | **Sí** | — | FF-001 (CRUD roles) es mejorable, no bloquea | Medio |
| Reportes | **Parcial** | Tipos de reporte | FF-005, FF-006 | Alto |
| Trazabilidad | **Parcial** | Vista detallada | FF-004 | Alto |

---

## 12. Roadmap de implementación

### P0 — Bloqueadores antes de producción

No se identificaron bloqueadores absolutos. El sistema es operable.

### P1 — Necesarias para operación estable (0-2 semanas)

| # | Función | Módulo | Motivo | Implementación mínima | Tests mínimos |
|---|---|---|---|---|---|
| 1 | FF-007: Cambio de contraseña | Perfil | Seguridad básica | Formulario + Server Action | Contraseña cambia y funciona en login |
| 2 | FF-002: Exportación stock | Bodega | Inventario físico | Endpoint XLSX + botón | XLSX válido, filtrado por faena |
| 3 | FF-003: Exportación kardex | Bodega | Auditoría de movimientos | Endpoint XLSX + botón | XLSX válido, cronológico |
| 4 | FF-001: CRUD de roles | Admin | Crear roles nuevos sin tocar código | CRUD + matrix permisos | CRUD funciona |

### P2 — Necesarias para eficiencia operativa (2-4 semanas)

| # | Función | Módulo | Motivo | Implementación mínima | Tests mínimos |
|---|---|---|---|---|---|
| 5 | FF-004: Vista detallada trazabilidad | Trazabilidad | Resolución de disputas | Página/timeline por ítem | Timeline correcto |
| 6 | FF-005: Reportes por trabajador | Reportes | Cumplimiento normativo | Tipo de reporte + exportación | XLSX válido |
| 7 | FF-006: Reportes por proveedor | Reportes | Negociación | Tipo de reporte + exportación | XLSX válido |
| 8 | FF-009: Paginación/filtros auditoría | Admin | Usabilidad con datos reales | Paginación + filtros | Funciona con miles de registros |
| 9 | FF-012: Importación trabajadores | Admin | Puesta en marcha | Importador XLSX | Crea registros, maneja duplicados |
| 10 | FF-013: Importación productos | Admin | Catálogo EPP | Importador XLSX | Crea registros, maneja duplicados |

### P3 — Recomendables post-producción (4+ semanas)

| # | Función | Módulo | Motivo | Implementación mínima | Tests mínimos |
|---|---|---|---|---|---|
| 11 | FF-008: Notificaciones OC/entregas | Transversal | Visibilidad | Agregar notifyAfterCommit | Notificaciones se generan |
| 12 | FF-010: Exportación auditoría | Admin | Revisión externa | Endpoint XLSX | XLSX válido |
| 13 | FF-011: Creación plantillas correo | Admin | Flexibilidad | Server Action + UI | Plantilla se crea y usa |
| 14 | Historial por trabajador | Entregas | Consulta rápida | Página dedicada | Lista correcta |
| 15 | Historial por producto | Entregas | Consulta rápida | Página dedicada | Lista correcta |

---

## 13. Checklist mínimo antes de producción

- [ ] CRUD de roles como entidad independiente desde UI (FF-001)
- [ ] Cambio de contraseña desde perfil (FF-007)
- [ ] Exportación de stock por faena a XLSX (FF-002)
- [ ] Exportación de kardex a XLSX (FF-003)
- [ ] Flujo completo Solicitud → Entrega verificado end-to-end
- [ ] Notificaciones in-app y email funcionales en eventos clave
- [ ] Auditoría registrando todos los cambios de estado
- [ ] RBAC validando permisos en todas las Server Actions
- [ ] Códigos secuenciales (SOL, OC, REC, ENT) generándose correctamente
- [ ] Stock no permite cantidades negativas
- [ ] Recepción no permite recibir más de lo comprado
- [ ] Entrega no permite entregar más de lo recibido
- [ ] PDF de OC genera correctamente
- [ ] Facturas se adjuntan y descargan correctamente
- [ ] Usuarios se invitan por email y definen contraseña
- [ ] Prevencionista faena puede crear solicitudes de sus faenas
- [ ] Jefatura/secretaría puede aprobar solicitudes de EPP
- [ ] Dashboard muestra métricas reales para el rol del usuario

---

## 14. Conclusión

**Nota funcional global:** 7/10  
**Decisión de producción:** 🟡 Listo para producción con observaciones  
**Funciones bloqueadoras faltantes:** 0  
**Funciones importantes faltantes:** 6 (FF-002 a FF-007) + 1 medio (FF-001)  
**Módulos más incompletos:** Trazabilidad, Reportes, Bodega (exportaciones)  

**Recomendación inmediata:**

El sistema está en un estado **funcionalmente usable** para producción. El flujo principal del negocio está completo: un prevencionista de faena puede crear solicitudes, un aprobador puede gestionarlas, secretaría puede generar y enviar órdenes de compra, recepcionar en oficina y faena, y entregar a trabajadores con trazabilidad completa.

Las **4 prioridades inmediatas** antes del despliegue son:
1. **FF-007** — Cambio de contraseña desde perfil (requisito de seguridad mínimo)
2. **FF-002/003** — Exportación de stock y kardex (necesario para operación diaria)
3. **FF-004** — Vista detallada de trazabilidad (necesaria para resolución de incidencias)
4. **FF-005/006** — Reportes por trabajador y proveedor (cumplimiento normativo)

La gestión de roles/permisos a usuarios ya funciona desde la UI. El CRUD de roles como entidad (FF-001) es importante pero no bloquea producción — los roles predefinidos cubren el alcance actual.

**El sistema no obliga a volver a Excel para completar el flujo principal.** Solo requiere intervención externa para la carga inicial masiva de datos (trabajadores/productos).

---

*Auditoría generada el 23 de junio de 2026 por Buffy (agente AI de auditoría).*
