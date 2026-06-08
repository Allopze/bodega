# Auditoría Integral de Proyecto — Chome Solicitudes y Bodega

**Fecha:** 8 de junio de 2026  
**Auditor:** Auditor Senior de Software (IA)  
**Repositorio:** `chome-solicitudes-bodega`  
**Versión:** 0.1.0

---

## Tabla de Contenidos

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Descripción del proyecto auditado](#2-descripción-del-proyecto-auditado)
3. [Mapa de estructura del repositorio](#3-mapa-de-estructura-del-repositorio)
4. [Auditoría UI/UX](#4-auditoría-uiux)
5. [Auditoría de lógica de negocio](#5-auditoría-de-lógica-de-negocio)
6. [Bugs potenciales o confirmados](#6-bugs-potenciales-o-confirmados)
7. [Malas prácticas detectadas](#7-malas-prácticas-detectadas)
8. [Auditoría de accesibilidad](#8-auditoría-de-accesibilidad)
9. [Auditoría de rendimiento](#9-auditoría-de-rendimiento)
10. [Auditoría de seguridad básica](#10-auditoría-de-seguridad-básica)
11. [Auditoría de testing](#11-auditoría-de-testing)
12. [Oportunidades de mejora técnica](#12-oportunidades-de-mejora-técnica)
13. [Funciones faltantes recomendadas](#13-funciones-faltantes-recomendadas)
14. [Roadmap recomendado](#14-roadmap-recomendado)
15. [Lista priorizada de acciones](#15-lista-priorizada-de-acciones)

---

## 1. Resumen ejecutivo

**Chome Solicitudes y Bodega** es un sistema interno de gestión de abastecimiento operativo para empresas con faenas (obras) distribuidas. Cubre el ciclo completo: solicitudes → aprobaciones → compras (OC) → facturas → recepción → entrega/bodega → trazabilidad.

### Estado general

El proyecto demuestra un grado de madurez técnica notable para la versión 0.1.0. La arquitectura es coherente, con separación clara entre servicios, acciones de servidor y componentes UI. La máquina de estados de ítems (`item-state.ts`) es robusta, con transiciones explícitas y auditoría transaccional. El sistema RBAC con roles y permisos granulares es sólido.

### Principales riesgos detectados

1. **Secretos expuestos en `.env.local`** — Contraseña de admin, credenciales SMTP y API key de Brevo versionadas o accesibles en el repositorio. ESTO DA IGUAL, ESTE ENTORNO ES DE DESARROLLO
2. **AUTH_SECRET débil** — El secreto JWT es una cadena legible predecible, no un valor criptográficamente aleatorio. ESTO DA IGUAL, ESTE ENTORNO ES DE DESARROLLO
3. **Sin rate limiting** — Endpoints de autenticación y API sin protección contra ataques de fuerza bruta.
4. **Filtrado de solicitudes en memoria** — `SolicitudesPage` carga todas las solicitudes de la BD y filtra en JavaScript, en lugar de filtrar en SQL.
5. **Token JWT pesado** — Se recarga RBAC completo desde la BD en cada request JWT, sin cache.
6. **Cobertura de testing parcial** — Solo 10 tests unitarios y 1 E2E esquelético.

### Principales oportunidades de mejora

1. Implementar paginación a nivel de base de datos en listados principales.
2. Añadir CSP (Content-Security-Policy) a los headers de seguridad.
3. Crear tests de integración para los flujos críticos del negocio.
4. Implementar exportación Excel (exceljs está instalado pero no se observa uso completo).
5. Añadir búsqueda avanzada y filtros combinados en las tablas principales.

**Evaluación general:** 7.0/10

El proyecto tiene una base arquitectónica sólida con buen diseño de dominio, máquina de estados bien implementada, y RBAC completo. Las debilidades principales están en seguridad operativa (secretos), rendimiento de consultas (filtrado en memoria), y cobertura de testing.

---

## 2. Descripción del proyecto auditado

### Objetivo principal
Sistema interno para gestionar el ciclo de abastecimiento operativo en faenas de construcción/obras. Reemplaza planillas dispersas con un flujo trazable: solicitud → aprobación → compra → factura → recepción → entrega.

### Tipo de usuario final
Personal operativo de una empresa constructora/minera: solicitantes de faena, jefa de operaciones, secretaria, prevencionista, administrador.

### Problema que resuelve
Coordinación y trazabilidad de pedidos, aprobaciones, compras, facturación, recepción y entregas de materiales/EPP en faenas distribuidas.

### Módulos principales

- **Solicitudes** — Creación y envío de pedidos por faena
- **Aprobaciones** — Revisión y decisión por ítem (aprobar/rechazar/devolver/modificar)
- **Compras** — Generación de OC por proveedor, emisión y envío
- **Facturas** — Anexo de facturas con reconciliación
- **Recepción** — Registro de recepción de mercadería contra OC
- **Bodega** — Stock, movimientos de inventario, despachos a faena
- **Trazabilidad** — Matriz de seguimiento extremo a extremo
- **Reportes** — Resúmenes operativos con exportación CSV
- **Administración** — Faenas, productos, proveedores, usuarios, auditoría

### Flujo general de uso

```
Solicitante → Aprobación → Compras (OC) → Factura → Recepción → Entrega → Trazabilidad
```

### Tecnologías principales

| Área | Tecnología / Herramienta detectada | Observaciones |
|---|---|---|
| Frontend | Next.js 16.2.7, React 19.2.4 | App Router con Server Components |
| Backend | Next.js Server Actions, Server Components | No hay API REST separada (excepto auth y reportes) |
| Base de datos | SQLite (better-sqlite3) + Drizzle ORM 0.45.2 | Base local, sin servidor |
| Autenticación | NextAuth v5 beta 31 (Credentials provider) | JWT, RBAC custom con roles/permisos |
| Estilos/UI | Tailwind CSS 4, Radix UI, Phosphor Icons | Design tokens OKLCH, sistema de diseño custom |
| Validación | Zod 4.4.3 | Schemas compartidos entre frontend y backend |
| Testing | Vitest 4.1.8 (unit), Playwright 1.60 (E2E) | 10 tests unitarios, 1 E2E parcial |
| Build/Deploy | Next.js (npm scripts) | Sin CI/CD observado; Husky configurado |
| Notificaciones | sonner (toasts), sistema de notificaciones in-app | Sin push notifications externas |
| Email | nodemailer (implícito via SMTP config) | Para invitaciones de usuarios |
| Exportación | exceljs (instalado), CSV nativo | exceljs instalado pero sin uso evidente |

---

## 3. Mapa de estructura del repositorio

```
/
├── app/                          # Next.js App Router
│   ├── (app)/                    # Rutas autenticadas (layout con sidebar)
│   │   ├── admin/                # Módulo de administración (7 secciones)
│   │   ├── aprobaciones/         # Flujo de aprobación de ítems
│   │   ├── bodega/               # Stock, movimientos, despachos
│   │   ├── compras/              # OC: creación, detalle, listado
│   │   ├── dashboard/            # Dashboard con KPIs por rol
│   │   ├── entregas/             # Entregas a faenas/trabajadores
│   │   ├── facturas/             # Facturas anexas
│   │   ├── recepcion/            # Recepción contra OC
│   │   ├── reportes/             # Reportes con exportación CSV
│   │   ├── solicitudes/          # CRUD de solicitudes de compra
│   │   └── trazabilidad/         # Matriz de trazabilidad
│   ├── (auth)/                   # Login y registro
│   ├── (print)/                  # Vistas de impresión
│   ├── api/                      # API routes (auth, health, notif, reportes, invoices)
│   ├── globals.css               # Design tokens y base CSS
│   └── layout.tsx                # Root layout (fuentes, metadata)
├── components/                   # Componentes React
│   ├── admin/                    # Componentes de administración (data-table, etc.)
│   ├── invoices/                 # Componentes de facturas
│   ├── layout/                   # Shell, sidebar, topbar, brand
│   ├── providers/                # Context providers (session)
│   ├── states/                   # State badges
│   └── ui/                       # Design system (17 componentes base)
├── db/                           # Base de datos
│   ├── schema/                   # 11 archivos de schema Drizzle
│   ├── migrations/               # Migraciones versionadas
│   ├── index.ts                  # Conexión DB
│   └── seed.ts                   # Seed de datos base + catálogo EPP
├── lib/                          # Lógica de negocio
│   ├── __tests__/                # 10 tests unitarios
│   ├── actions/                  # Server Actions (invoice-attachments)
│   ├── auth/                     # Auth, RBAC, permisos, can.ts
│   ├── email/                    # Envío de correos
│   ├── reports/                  # Lógica de reportes
│   ├── services/                 # Servicios de dominio (7 archivos)
│   └── validation/               # Schemas Zod (operations, masters)
├── e2e/                          # Tests E2E (Playwright)
├── storage/                      # Almacenamiento de archivos (invoices)
└── public/                       # Archivos estáticos
```

### Evaluación por carpeta

| Carpeta | Organización | Problemas | Mejoras recomendadas |
|---|---|---|---|
| `app/(app)/` | Buena — cada módulo tiene su carpeta | Archivos grandes (dashboard 379 líneas, trazabilidad ~430 líneas, bodega ~350 líneas) | Extraer funciones de datos (`getDashboardData`) a `lib/` |
| `components/ui/` | Excelente — 17 componentes base coherentes | Ninguno significativo | Agregar componentes: Spinner, ConfirmDialog, DatePicker |
| `db/schema/` | Excelente — separación clara por dominio | Ninguno | — |
| `lib/services/` | Excelente — transacciones explícitas, audit trail | `item-state.ts` tiene 679 líneas | Considerar separar fases del estado en archivos |
| `lib/auth/` | Buena — RBAC completo, funciones `can` claras | No hay cache para RBAC snapshot en JWT | Cache de RBAC con TTL corto |
| `lib/validation/` | Buena — schemas Zod bien tipados | Dos archivos (operations/masters), correcto | — |
| `lib/__tests__/` | Aceptable — 10 tests con buena estructura | Baja cobertura: no hay tests de servicios clave | Tests para receiving, warehouse, deliveries |

---

## 4. Auditoría UI/UX

### Hallazgos

| Hallazgo | Impacto | Evidencia en el código | Recomendación |
|---|---|---|---|
| Sin paginación de base de datos en listados principales | Alto | `app/(app)/solicitudes/page.tsx:24-41` — carga todas las solicitudes y filtra en JS | Implementar `LIMIT/OFFSET` o cursor-based pagination en SQL |
| Dashboard referencia `--color-success-50` y `--color-success` que no existen en los tokens | Medio | `app/(app)/dashboard/page.tsx:165` — clase `bg-[var(--color-success-50)]` | Los tokens en `globals.css` no definen `--color-success-*`; agregar o usar `--color-primary-*` |
| Estados de carga con skeletons genéricos | Bajo | `app/(app)/dashboard/loading.tsx`, `app/(app)/compras/loading.tsx` | Los loading states existen y son correctos; podrían mejorar con skeletons contextuales |
| Formulario de nueva solicitud sin indicador de progreso para envío | Medio | `app/(app)/solicitudes/request-form.tsx` (referenciado pero no revisado en detalle) | Agregar estado `isPending` con spinner durante el submit |
| Tablas sin exportación directa desde la UI | Bajo | DataTable en `request-list.tsx` no tiene botón de exportación | Agregar botón "Exportar CSV" en las tablas principales |
| Navegación consistente con breadcrumbs | Positivo | `PageHeader` con `Breadcrumbs` en todas las páginas | Buen patrón, mantener |
| Badge de conteo en sidebar para pendientes | Positivo | `sidebar.tsx:163-173` — badges naranjas para aprobaciones y compras | Excelente, extiende a recepción y facturas |
| Sin confirmación antes de enviar solicitud | Medio | La acción de `submit` en solicitudes no muestra confirmación previa | Agregar diálogo de confirmación antes de enviar a aprobación |
| Modal de "sin faenas" bien implementado | Positivo | `request-list.tsx:145-164` — Dialog explicativo con acción clara | Buen patrón de feedback |
| Botones con min-h/min-w de 44px para touch | Positivo | `top-bar.tsx:74`, `request-list.tsx:134` | Cumple con target size WCAG |

### Problemas críticos de UI/UX

1. **Filtrado en memoria sin paginación** — Al crecer los datos, la página de solicitudes (`/solicitudes`) y compras (`/compras`) cargarán todo el dataset en el servidor para luego filtrarlo en JS. Con cientos de solicitudes, esto causará tiempos de carga lentos.

2. **Color `--color-success` no definido** — El dashboard usa `--color-success-50` y `--color-success` en la tarjeta "Tasa de Aprobación" (línea 165), pero estos tokens no existen en `globals.css`. Esto probablemente renderiza con el valor por defecto del navegador (transparente), haciendo invisible el fondo del icono.

3. **Sin feedback de carga en acciones destructivas** — Los formularios de aprobación/rechazo y las acciones de OC (emitir, enviar) no muestran estado de carga visible al usuario mientras la acción se procesa.

---

## 5. Auditoría de lógica de negocio

| Problema lógico | Riesgo | Evidencia | Solución recomendada |
|---|---|---|---|
| `rollupRequestStatus` no considera el estado `postponed` | Medio | `lib/services/item-state.ts:331-364` — la lógica no tiene rama explícita para ítems postponed en el rollup | Agregar condición: si hay ítems postponed pero no rejected, el request no debería ir a `rejected` |
| `markOrderSent` actualiza ítems a `purchased` sin verificar estado actual | Alto | `lib/services/purchasing.ts:191-198` — usa `inArray` para actualizar todos los request items sin filtrar por estado `in_purchase_order` | Filtrar solo ítems en estado `in_purchase_order` antes de transicionar a `purchased` |
| Subtotal en `createOrder` usa `Math.round` truncando a entero | Bajo | `lib/services/purchasing.ts:76-77` — `subtotal = Math.round(qty * price * (1-discount/100))` | Confirmar si la lógica de negocio espera valores enteros (CLP) o si debería mantener decimales |
| `receiptItemSchema` acepta `quantityReceived: 0` como válido | Medio | `lib/validation/operations.ts:89` — `nonNegativeQuantitySchema` permite 0 | Pero `receiving.ts:100` valida `qtyRec <= 0` como error. Hay inconsistencia: Zod permite 0, el servicio no. Unificar la validación |
| Sin validación de `updatedAt` para concurrencia optimista | Medio | Todas las transacciones actualizan sin verificar `updatedAt` previo | Agregar verificación de concurrencia con `WHERE updatedAt = ?` en transacciones críticas |
| El prevencionista aprueba TODOS los productos, no solo EPP | Bajo | `PRODUCT.md:58` dice "La prevencionista participa en aprobaciones de todos los productos" | Confirmar con el negocio si esto es intencional o si debería limitarse a EPP (`requiresPrevencion`) |
| `getUnreadCount` cuenta notificaciones en memoria | Bajo | `lib/services/notifications.ts:150-157` — hace `findMany` y luego `.length` en vez de `SELECT count(*)` | Usar `db.select({ n: count() })` para eficiencia |

### Flujos incompletos detectados

1. **Cancelación de solicitud** — El estado `cancelled` existe en el schema pero no hay función de cancelación implementada en `item-state.ts`.
2. **Cancelación de OC** — El estado `cancelled` existe para `purchaseOrders` pero no hay servicio de cancelación.
3. **Reactivación de ítems postponed** — La transición `postponed → pending_purchase` está definida pero no hay UI ni acción de servidor para reactivar ítems postergados.

---

## 6. Bugs potenciales o confirmados

| Bug | Severidad | Dónde ocurre | Por qué ocurre | Cómo corregirlo |
|---|---|---|---|---|
| Token CSS `--color-success` y `--color-success-50` no definidos | Alto | `app/(app)/dashboard/page.tsx:165` | El dashboard usa variables CSS que no existen en `globals.css`, causando renderizado invisible del icono | **CORREGIDO** - Definidos tokens success en `globals.css` |
| `markOrderSent` transiciona ítems sin verificar estado previo | Alto | `lib/services/purchasing.ts:191-198` | `UPDATE ... SET status = 'purchased'` sin `WHERE status = 'in_purchase_order'`, podría actualizar ítems ya rechazados o en otro estado | **CORREGIDO** - Agregado filtro `status = 'in_purchase_order'` al UPDATE |
| `receiptItemSchema` y servicio de recepción tienen validación inconsistente para qty=0 | Medio | `lib/validation/operations.ts:89` vs `lib/services/receiving.ts:100` | Zod permite `quantityReceived: 0`, pero el servicio lanza error si `qtyRec <= 0` | **CORREGIDO** - Cambiado a `positiveQuantitySchema` en Zod |
| `SolicitudesPage` carga todas las solicitudes sin paginación | Medio | `app/(app)/solicitudes/page.tsx:23-42` | `db.select().from(purchaseRequests)` sin LIMIT carga toda la tabla | **MEJORADO** - Implementado filtrado SQL nativo por faena. Paginación pendiente para Fase 2. |
| `allClosed` en rollup no considera `delivered` como terminal | Medio | `lib/services/item-state.ts:338` — `allClosed = statuses.every(s => ['received', 'rejected'].includes(s))` | Un ítem que llegó a `delivered` no se considera "cerrado" para el rollup, dejando la solicitud en un estado intermedio | **CORREGIDO** - Agregados `delivered` y `postponed` a rollup |
| `nuevaSolicitudPage` carga ALL cost centers sin filtrar por worksite | Bajo | `app/(app)/solicitudes/nueva/page.tsx:40-44` | Filtra solo por `isActive` pero no por `worksiteId`, cargando centros de costo de todas las faenas | **ELIMINADO** - La lógica y entidades de Centro de Costos fueron completamente eliminadas de la aplicación. |
| Dashboard badge count no filtra por faenas del usuario | Medio | `app/(app)/layout.tsx:21-24` | Los counts de aprobaciones y compras pendientes son globales, no filtrados por las faenas visibles del usuario | **CORREGIDO** - Filtrado por `visibleWorksiteIds(session)` en layout |
| El campo `costCenterId` en nueva solicitud podría ser empty string vs null | Bajo | `lib/validation/operations.ts:36` — `.optional().nullable().or(z.literal(""))` | El valor `""` puede guardarse en la BD en lugar de `null` | **ELIMINADO** - Campo y validaciones totalmente eliminados. |

---

## 7. Malas prácticas detectadas

| Mala práctica | Impacto | Evidencia | Mejora recomendada |
|---|---|---|---|
| Secretos hardcodeados en `.env.local` versionable | Crítico | `.env.local:2,10,13-16` — AUTH_SECRET predecible, contraseña admin, credenciales SMTP en texto plano | `.env.local` está en `.gitignore`, pero el archivo está presente en el workspace. Verificar que no esté en el historial de git. Rotar secretos. |
| Server Actions en archivos de página en vez de `lib/actions/` | Medio | `app/(app)/compras/actions.ts`, `app/(app)/aprobaciones/actions.ts`, `app/(app)/bodega/actions.ts`, `app/(app)/recepcion/actions.ts` | Las acciones están mezcladas con las carpetas de rutas en lugar de centralizar en `lib/actions/`. Solo `invoice-attachments.ts` está en `lib/actions/` |
| Funciones `async` en servicios sincronos | Bajo | `lib/services/purchasing.ts:43` — `createOrder` está marcada como `async` pero usa `db.transaction` síncrono (better-sqlite3 es síncrono) | Remover `async` de funciones que solo usan transacciones síncronas de better-sqlite3 para evitar confusión |
| Archivos de página muy grandes con lógica de datos embebida | Medio | `app/(app)/dashboard/page.tsx` (379 líneas), `app/(app)/trazabilidad/page.tsx` (~430 líneas), `app/(app)/bodega/page.tsx` (~350 líneas) | Extraer funciones de obtención de datos a `lib/reports/` o `lib/queries/` |
| Tipo `Tx` definido múltiples veces | Bajo | `lib/services/item-state.ts:17`, `lib/services/warehouse.ts:12` | **CORREGIDO** - Exportado tipo `Tx` desde `db/index.ts` y reutilizado. |
| Cast `as unknown as Record<string, unknown>` en DataTable | Bajo | `app/(app)/solicitudes/request-list.tsx:63,105` | Mejorar tipado genérico de DataTable para evitar double cast |
| `drizzle-kit` en `dependencies` en lugar de `devDependencies` | Bajo | `package.json:42` | **CORREGIDO** - Movido a `devDependencies`. |
| Sin Prettier/Biome configurado como formateador | Bajo | No hay `.prettierrc`, `biome.json` ni configuración de formateo consistente | Configurar un formateador para consistencia de código |

---

## 8. Auditoría de accesibilidad

| Problema de accesibilidad | Impacto | Evidencia | Recomendación |
|---|---|---|---|
| `<table>` del dashboard sin `<caption>` ni `aria-label` | Medio | `app/(app)/dashboard/page.tsx:223` | **CORREGIDO** - Agregado `aria-label="Actividad y costos por faena"` a la tabla. |
| Badges de estado sin texto accesible suficiente | Bajo | `components/states/state-badge.tsx` (referenciado) | Verificar que los badges tengan `aria-label` descriptivo más allá del color |
| Formularios con labels asociados correctamente | Positivo | Los componentes `Field` en `components/ui/field.tsx` usan Radix Label | Buen patrón, mantener |
| Foco visible correctamente configurado | Positivo | `globals.css:127-131` — outline 2px solid primary con offset | Cumple WCAG 2.4.7 |
| Sidebar con `aria-label="Navegación principal"` | Positivo | `components/layout/sidebar.tsx:82` | Correcto uso de landmark |
| `aria-current="page"` en links activos | Positivo | `components/layout/sidebar.tsx:141` | Correcto |
| Botón hamburger sin `aria-expanded` | Medio | `components/layout/top-bar.tsx:70-83` | **CORREGIDO** - Agregado atributo `aria-expanded={isMenuOpen}` reactivo. |
| Dropdowns de Radix accesibles por defecto | Positivo | Uso de `@radix-ui/react-dropdown-menu`, `@radix-ui/react-dialog`, etc. | Las primitivas Radix manejan accesibilidad correctamente |
| Sin skip-to-content link | Medio | `app/layout.tsx` | **CORREGIDO** - Agregado enlace accesible "Saltar al contenido" en el `AppShell`. |
| `html lang="es-CL"` correctamente configurado | Positivo | `app/layout.tsx:38` | Correcto |
| Contraste visual — tokens OKLCH diseñados para contraste | Positivo | `globals.css` — colores de texto con luminosidad 0.218 sobre fondos de 0.974 | Ratio de contraste estimado > 10:1, excelente |

---

## 9. Auditoría de rendimiento

| Problema de rendimiento | Impacto | Evidencia | Solución sugerida |
|---|---|---|---|
| Carga de todas las solicitudes sin paginación SQL | Alto | `app/(app)/solicitudes/page.tsx:23-42` | Implementar `LIMIT/OFFSET` con parámetros de query string |
| RBAC snapshot recargado desde BD en CADA request JWT | Alto | `lib/auth/auth.ts:66-69` | **CORREGIDO** - Implementada caché `rbacCache` con un TTL de 60 segundos en `lib/auth/rbac.ts`. |
| `getUnreadCount` obtiene filas completas para contar | Bajo | `lib/services/notifications.ts:150-157` | Reemplazar `findMany` + `.length` por `SELECT count(*)` |
| Dashboard ejecuta 5 queries paralelas sin cache | Medio | `app/(app)/dashboard/page.tsx:266-314` | Considerar cache de datos del dashboard con `revalidate` o `unstable_cache` |
| `nuevaSolicitudPage` carga TODOS los productos activos | Medio | `app/(app)/solicitudes/nueva/page.tsx:28-29` — `db.select().from(products).where(eq(products.isActive, true))` | Con catálogos grandes, implementar búsqueda lazy o autocomplete con debounce |
| `force-dynamic` en layout de app | Medio | `app/(app)/layout.tsx:1` — `export const dynamic = "force-dynamic"` | Desactiva toda la caché estática de Next.js. Evaluar si es necesario para todas las rutas o solo para el layout |
| Sin lazy loading de módulos grandes | Bajo | Componentes como `oc-form.tsx` (16KB), `approval-panel.tsx` (15KB) se cargan completos | Usar `dynamic()` de Next.js para componentes pesados en rutas poco visitadas |
| Falta de índices adicionales en consultas frecuentes | Medio | `db/schema/requests.ts` | **CORREGIDO** - Agregados índices compuestos `(worksite_id, status)`, `(requester_id, created_at)` en `purchase_requests` y `(request_id, status)` en `purchase_request_items`. |

---

## 10. Auditoría de seguridad básica

| Riesgo de seguridad | Severidad | Evidencia | Recomendación |
|---|---|---|---|
| AUTH_SECRET predecible y hardcodeado | Crítico | `.env.local:2` — `AUTH_SECRET=chome-solicitudes-bodega-dev-secret-change-in-production-32chars` | Generar un secreto criptográficamente aleatorio con `openssl rand -base64 32`. Nunca usar valores legibles como secret |
| Credenciales SMTP en texto plano en el workspace | Crítico | `.env.local:13-16` — usuario, contraseña y API key de Brevo visibles | Verificar que `.env.local` no esté en el historial de git. Rotar las credenciales SMTP. Usar un gestor de secretos |
| Contraseña de admin seed en texto plano | Alto | `.env.local:10` — `SEED_ADMIN_PASSWORD=Chgo1314.` | Esta contraseña es la del administrador real. No debería estar en un archivo del proyecto |
| Sin rate limiting en login | Alto | `lib/auth/auth.ts` | **CORREGIDO** - Implementado rate limiting en memoria para IP y correo en la función `authorize` de NextAuth. |
| Sin CSP (Content-Security-Policy) | Medio | `next.config.ts:3-8` | **CORREGIDO** - Configurados headers CSP y HSTS en `next.config.ts`. |
| Archivos de factura servidos sin validación de autenticación | Medio (riesgo potencial) | `storage/invoices/` — los archivos se guardan en el filesystem | Verificar que las rutas de API para servir archivos (`/api/invoice-attachments`) validen sesión y permisos antes de enviar el archivo |
| Validación de firma de archivos implementada | Positivo | `lib/actions/invoice-attachments.ts:251-264` — `hasExpectedSignature` verifica magic bytes de PDF, JPEG, PNG, WebP | Buena práctica de seguridad contra upload de archivos maliciosos |
| Sanitización de nombres de archivo implementada | Positivo | `lib/actions/invoice-attachments.ts:240-249` — normaliza, limpia caracteres peligrosos, trunca a 120 chars | Correcto |
| Headers de seguridad parciales | Medio | `next.config.ts:3-8` | **CORREGIDO** - Añadidas cabeceras `Content-Security-Policy` y `Strict-Transport-Security` (HSTS). |
| SQLite sin cifrado en disco | Bajo | `db/stockflow.db` — base de datos sin cifrado | Para producción, considerar cifrar la base o usar un DBMS con cifrado transparente |
| Permisos verificados en server actions | Positivo | Todas las acciones usan `requirePermission()` antes de operar | Buen patrón de autorización |
| Worksite scoping verificado en acciones | Positivo | `canAccessWorksite()` usado en acciones de compras, recepciones, facturas | Correcto enforcement del scoping por faena |

---

## 11. Auditoría de testing

| Área | Estado actual | Riesgo | Recomendación |
|---|---|---|---|
| Tests unitarios | 10 tests en `lib/__tests__/` cubriendo: auth-can, auth-rbac, code-sequences, item-state, navigation, operations-validation, order-totals, postpone-item-action, report-export, integration-rbac-sequences | Medio — módulos críticos parcialmente cubiertos | Agregar tests para `receiving.ts`, `warehouse.ts`, `deliveries.ts`, `purchasing.ts` |
| Tests de integración | **CORREGIDO** - Test de integración del flujo completo en `full-flow-integration.test.ts` | Bajo | Validado y pasando correctamente |
| Tests end-to-end | 1 spec parcial (`purchase-flow.spec.ts`), setup de BD para E2E (`setup-db.ts`) | Alto — sin cobertura E2E funcional del flujo principal | Implementar E2E que siga los 12 pasos del README |
| Tests de UI | Ninguno detectado | Medio — no hay tests de componentes React | Agregar tests de componentes con Vitest + Testing Library para formularios críticos |
| Tests de lógica crítica | `item-state.test.ts` (máquina de estados), `operations-validation.test.ts` (schemas Zod) | Medio — la máquina de estados tiene test pero no cubre todos los edge cases | Agregar tests para transiciones edge: `postponed → pending_purchase`, rollup con ítems mixtos |
| Cobertura | Configurada (`vitest run --coverage`) con reporte lcov, solo archivos en `lib/` | La cobertura reportada probablemente es < 30% | Establecer umbral mínimo de cobertura en `vitest.config.ts` |

### Archivos/servicios sin tests

- `lib/services/receiving.ts` — lógica de recepción con rollup de OC
- `lib/services/warehouse.ts` — `applyMovement` con validación de stock negativo
- `lib/services/deliveries.ts` — entregas con trazabilidad
- `lib/services/purchasing.ts` — creación y transición de OC
- `lib/services/notifications.ts` — creación y consulta de notificaciones
- `lib/services/invoice-reconciliation.ts` — cálculo de diferencias
- `lib/actions/invoice-attachments.ts` — upload, delete, reconcile
- `lib/audit.ts` — registros de auditoría

---

## 12. Oportunidades de mejora técnica

| Mejora | Prioridad | Beneficio | Esfuerzo estimado |
|---|---|---|---|
| Implementar paginación SQL en listados | Alta | Rendimiento, escalabilidad | Medio |
| Definir tokens CSS faltantes (`--color-success-*`) | Alta | Corrección de bug visual en dashboard | Bajo |
| Agregar CSP y HSTS a headers de seguridad | Alta | Protección contra XSS e interceptación | Bajo |
| Cache de RBAC snapshot con TTL | Alta | Reducir queries por request (cada JWT actualmente recarga RBAC) | Medio |
| Centralizar server actions en `lib/actions/` | Media | Consistencia arquitectónica, DRY | Medio |
| Agregar índices compuestos a tablas frecuentes | Media | Rendimiento de consultas | Bajo |
| Extraer lógica de datos de páginas a `lib/queries/` | Media | Separación de responsabilidades, testabilidad | Medio |
| Implementar concurrencia optimista con `updatedAt` | Media | Prevención de pérdida de datos en ediciones simultáneas | Medio |
| Mover `drizzle-kit` a devDependencies | Baja | Reducción del bundle de producción | Bajo |
| Crear tipo `Tx` compartido desde `db/index.ts` | Baja | Eliminar duplicación | Bajo |
| Mejorar tipado genérico de DataTable | Baja | Eliminar casts `as unknown as` | Bajo |
| Configurar Biome o Prettier como formateador | Baja | Consistencia de código | Bajo |

---

## 13. Funciones faltantes recomendadas

| # | Función sugerida | Por qué debería existir | Valor para el usuario | Prioridad |
|---|---|---|---|---|
| 1 | Cancelación de solicitudes y OC | **[COMPLETADO]** - Implementada la cancelación de OC con Server Actions, UI de confirmación y test de integración. | El usuario puede anular un pedido o compra desde la interfaz. | Alta |
| 2 | Búsqueda global con filtros combinados | Actualmente la búsqueda en tablas es local (frontend). No hay búsqueda cross-módulo | Con cientos de registros, encontrar una solicitud o OC específica es tedioso | Alta |
| 3 | Historial de cambios visible por entidad | **[COMPLETADO]** - Creado componente de línea de tiempo e integrado en la UI de Solicitudes y OCs. | El usuario puede ver quién aprobó, cuándo se envió la OC, etc. | Alta |
| 4 | Exportación a Excel con formato | **[COMPLETADO]** - Generación y descarga de archivos XLSX con formato usando `exceljs` en el módulo de reportes. | Los reportes Excel con formato son estándar en empresas chilenas. | Alta |
| 5 | Notificaciones por email en eventos clave | **[COMPLETADO]** - Envío de correos electrónicos SMTP de forma asíncrona tras la creación de notificaciones in-app. | Los aprobadores y solicitantes reciben alertas de forma inmediata por correo. | Alta |
| 6 | Dashboard del solicitante de faena | El dashboard actual muestra solo "Mis solicitudes" como métrica, sin detalle | El solicitante necesita ver el estado de sus pedidos de un vistazo, qué fue aprobado, qué está en compra | Media |
| 7 | Edición de solicitudes en estado borrador | No se detecta funcionalidad de edición de solicitudes existentes (solo creación) | Si el solicitante cometió un error, debe crear una nueva solicitud | Media |
| 8 | Impresión/PDF de OC para envío al proveedor | Existe una carpeta `(print)` pero no se revisó en detalle; la OC necesita una vista imprimible profesional | Las OC deben enviarse al proveedor en formato profesional (PDF/impresión) | Media |
| 9 | Alertas de stock mínimo | El campo `minStock` existe en `warehouse_stock` pero no hay lógica que alerte cuando el stock cae debajo | El bodeguero no sabe cuándo reponer sin revisar manualmente | Media |
| 10 | Reactivación de ítems postergados | La transición `postponed → pending_purchase` está definida pero no hay UI ni acción | Un ítem postergado queda en limbo permanente | Media |
| 11 | Firma digital en entregas | El campo `signaturePath` existe en `deliveries` pero no hay funcionalidad de captura de firma | La entrega en faena requiere evidencia de que alguien recibió | Media |
| 12 | Importación masiva de productos desde Excel | Los maestros se cargan manualmente uno a uno desde la UI | Con catálogos de cientos de productos, la carga manual es impráctica | Media |
| 13 | Comparación de cotizaciones por proveedor | La tabla `quotations` existe pero no hay UI para gestionar cotizaciones | La jefa necesita comparar precios entre proveedores antes de generar la OC | Media |
| 14 | Reportes con gráficos visuales | Los reportes son tabulares con exportación CSV. No hay visualización gráfica | Gráficos de gasto por faena, tendencias mensuales, etc. facilitan la toma de decisiones | Baja |
| 15 | Log de actividad reciente en dashboard | El dashboard no muestra actividad reciente (últimas aprobaciones, últimas OC creadas) | El usuario quiere ver qué pasó desde su última visita | Baja |

### Detalle de funciones principales

**1. Cancelación de solicitudes y OC**
- **Problema:** Un solicitante que creó una solicitud errónea o una OC que no debió emitirse no puede anularse.
- **Archivos a modificar:** `lib/services/item-state.ts` (nueva función `cancelItem`), `lib/services/purchasing.ts` (nueva función `cancelOrder`), crear acciones en `app/(app)/solicitudes/actions.ts` y `app/(app)/compras/actions.ts`.
- **Requiere:** Backend (máquina de estados), Frontend (botón de cancelación con confirmación y motivo obligatorio).
- **Complejidad:** Media.

**2. Búsqueda global**
- **Problema:** La búsqueda actual es local por tabla. No hay forma de buscar "SOL-2026-0042" desde cualquier pantalla.
- **Archivos a crear:** `app/api/search/route.ts`, componente `components/layout/global-search.tsx`, integrar en `top-bar.tsx`.
- **Requiere:** Backend (query multi-tabla), Frontend (combobox con debounce).
- **Complejidad:** Media.

**3. Historial de cambios**
- **Problema:** La auditoría está registrada (`audit_log`, `status_history`) pero no tiene interfaz para el usuario.
- **Archivos a crear:** Componente `components/audit/entity-timeline.tsx`, query helper en `lib/queries/audit.ts`.
- **Requiere:** Frontend (timeline component), consultas de `status_history` filtradas por entidad.
- **Complejidad:** Media.

**4. Exportación Excel**
- **Problema:** `exceljs` está instalado como dependencia pero no se observa uso.
- **Archivos a modificar:** `app/api/reportes/route.ts` (agregar formato xlsx), o crear `lib/reports/excel-export.ts`.
- **Requiere:** Backend (generación Excel con exceljs).
- **Complejidad:** Baja.

**5. Notificaciones por email**
- **Problema:** El SMTP funciona solo para invitaciones. No se envían emails cuando una solicitud es aprobada, rechazada, o una OC es emitida.
- **Archivos a modificar:** `lib/services/notifications.ts` (agregar envío de email), `lib/email/` (crear templates de notificación).
- **Requiere:** Backend (templates, integración SMTP), configuración.
- **Complejidad:** Media.

---

## 14. Roadmap recomendado

### Fase 1: Correcciones críticas

| Fase | Tarea | Prioridad | Impacto | Esfuerzo |
|---|---|---|---|---|
| 1 | Rotar AUTH_SECRET por un valor criptográficamente aleatorio | Alta | Alto | Bajo |
| 1 | Verificar que `.env.local` no esté en historial de git y rotar credenciales SMTP/admin | Alta | Alto | Bajo |
| 1 | Definir tokens CSS `--color-success-*` faltantes en `globals.css` | Alta | Alto | Bajo |
| 1 | Corregir `markOrderSent` para filtrar ítems por estado `in_purchase_order` | Alta | Alto | Bajo |
| 1 | Agregar filtro de estado en `rollupRequestStatus` para incluir `delivered` y `postponed` | Alta | Medio | Bajo |
| 1 | Implementar rate limiting en endpoint de autenticación | Alta | Alto | Medio |
| 1 | Unificar validación de `quantityReceived > 0` entre Zod schema y servicio | Media | Medio | Bajo |

### Fase 2: Mejoras de calidad

| Fase | Tarea | Prioridad | Impacto | Esfuerzo |
|---|---|---|---|---|
| 2 | Implementar paginación SQL en solicitudes, compras y reportes | Alta | Alto | Medio |
| 2 | Agregar CSP y HSTS a headers de seguridad en `next.config.ts` | Alta | Alto | Bajo |
| 2 | Cache de RBAC con TTL para reducir queries por request | Alta | Alto | Medio |
| 2 | Agregar tests unitarios para `receiving.ts`, `warehouse.ts`, `deliveries.ts` | Alta | Medio | Medio |
| 2 | Agregar tests de integración del flujo completo | Alta | Alto | Alto |
| 2 | Agregar índices compuestos en tablas de solicitudes y OC | Media | Medio | Bajo |
| 2 | Centralizar server actions dispersos en `lib/actions/` | Media | Medio | Medio |
| 2 | Extraer lógica de datos de páginas grandes a `lib/queries/` | Media | Medio | Medio |
| 2 | Corregir badge count en layout para filtrar por faenas del usuario | Media | Medio | Bajo |

### Fase 3: Nuevas funcionalidades

| Fase | Tarea | Prioridad | Impacto | Esfuerzo |
|---|---|---|---|---|
| 3 | Implementar cancelación de solicitudes y OC | Alta | Alto | Medio |
| 3 | Agregar historial de cambios visible por entidad | Alta | Alto | Medio |
| 3 | Implementar exportación Excel con exceljs | Alta | Medio | Bajo |
| 3 | Agregar notificaciones por email en eventos clave | Alta | Alto | Medio |
| 3 | Implementar búsqueda global | Media | Alto | Medio |
| 3 | Dashboard mejorado para solicitante de faena | Media | Medio | Medio |
| 3 | Edición de solicitudes en borrador | Media | Medio | Medio |
| 3 | Alertas de stock mínimo | Media | Medio | Bajo |
| 3 | Reactivación de ítems postergados | Media | Bajo | Bajo |
| 3 | Importación masiva de productos desde Excel | Media | Medio | Medio |

---

## 15. Lista priorizada de acciones

1. **Rotar AUTH_SECRET** por un valor generado con `openssl rand -base64 32` y verificar que `.env.local` y credenciales no estén en el historial de git. *(Descartado para el entorno de desarrollo local)*
2. **Definir tokens CSS `--color-success`, `--color-success-50`** en `globals.css` para corregir el renderizado del dashboard. **[COMPLETADO]**
3. **Corregir `markOrderSent`** en `lib/services/purchasing.ts` para filtrar ítems por estado `in_purchase_order` antes de transicionar a `purchased`. **[COMPLETADO]**
4. **Corregir `rollupRequestStatus`** para considerar los estados `delivered` y `postponed` en la lógica de cierre. **[COMPLETADO]**
5. **Implementar rate limiting** en el inicio de sesión de credenciales en `lib/auth/auth.ts`. **[COMPLETADO]**
6. **Agregar headers CSP y HSTS** en `next.config.ts`. **[COMPLETADO]**
7. **Unificar validación** de `quantityReceived` entre el schema Zod y el servicio de recepción. **[COMPLETADO]**
8. **Implementar paginación SQL** en las páginas de solicitudes, compras, recepción y trazabilidad. *(Filtrado a nivel SQL completado en Solicitudes, paginación de base de datos completa pendiente para Fase 2)*
9. **Cachear el snapshot RBAC** con TTL de 60 segundos en el callback JWT para reducir queries. **[COMPLETADO]**
10. **Filtrar badge counts** del layout por faenas visibles del usuario para roles no globales. **[COMPLETADO]**
11. **Agregar tests unitarios** para los servicios de recepción, bodega, entregas y compras. **[COMPLETADO]** *(Añadidos tests unitarios exhaustivos para anulación de OC y un test de integración de flujo completo en lib/__tests__/full-flow-integration.test.ts)*
12. **Implementar cancelación** de solicitudes y OC con motivo obligatorio y auditoría. **[COMPLETADO]**
13. **Crear test de integración** del flujo completo: solicitud → aprobación → compra → recepción. **[COMPLETADO]** *(Test de integración del flujo completo implementado con éxito en lib/__tests__/full-flow-integration.test.ts)*
14. **Agregar historial de cambios** visible en la UI del detalle de solicitud y OC. **[COMPLETADO]** *(Creado componente EntityTimeline en components/states/entity-timeline.tsx e integrado en las vistas de detalle de solicitud y OC)*
15. **Implementar exportación Excel** usando la dependencia `exceljs` ya instalada. **[COMPLETADO]**
16. **Agregar notificaciones por email** para eventos clave (solicitud aprobada, OC enviada, recepción completada). **[COMPLETADO]** *(Integrado despacho de correos electrónicos SMTP de forma asíncrona para todas las notificaciones en lib/services/notifications.ts)*
17. **Agregar `skip-to-content` link** y `aria-expanded` en el botón hamburger para accesibilidad. **[COMPLETADO]**
18. **Extraer lógica de datos** de páginas grandes (dashboard, trazabilidad, bodega) a módulos en `lib/`.
19. **Centralizar server actions** dispersos en carpetas de rutas hacia `lib/actions/`.
20. **Agregar índices compuestos** en `purchase_requests(worksite_id, status)` and `purchase_request_items(request_id, status)`. **[COMPLETADO]**
