# Plataforma Chome

Plataforma interna de gestión operacional para **Servicios Industriales Chome Limitada**,
una empresa chilena de servicios industriales. Reemplaza procesos manuales basados en
Excel con una plataforma web para coordinar adquisiciones, bodega, prevención, flota,
reportes y trazabilidad por faena.

---

## Problema que resuelve

Antes de este sistema, una faena pedía 10 cascos + 20 guantes + 5 botas. La secretaria
generaba una orden de compra con cascos y botas, y nadie sabía que los guantes se
cayeron. No había trazabilidad, ni inventario centralizado, ni forma de auditar qué pasó
con cada ítem.

**Plataforma Chome** resuelve esto con control por ítem individual a través de
todo el pipeline: solicitud → aprobación → orden de compra → recepción → entrega.

---

## Usuarios y roles

| Rol | Alcance | Qué hace |
|---|---|---|
| **Administrador** | Todas las faenas | Control total del sistema, 23 permisos |
| **Jefatura** | Todas las faenas | Aprueba, ve compras, ve reportes |
| **Secretaría** | Todas las faenas | Aprueba, crea OCs, recibe, administra maestros |
| **Prevencionista oficina** | Todas las faenas | Aprueba (especialmente EPP), recibe en oficina, administra maestros |
| **Prevencionista faena** | Solo faenas asignadas | Crea solicitudes, registra recepción en faena, ve stock |

El solicitante siempre está acotado a su faena (nunca es global). La faena misma actúa
como bodega: el stock vive a nivel de faena, no en una bodega centralizada.

---

## Módulos

### Dashboard
Cola de trabajo con conteos pendientes (aprobaciones, OCs por emitir, recepciones
pendientes) y tarjetas KPI del estado del pipeline.

### Solicitudes
- Crear solicitudes por faena con múltiples ítems
- Seleccionar del catálogo o ingresar texto libre
- Atributos por producto: talla, color, modelo
- Asociar ítems EPP a trabajadores específicos
- Urgencia (normal/alta/crítica) y fecha requerida
- Guardar borrador, enviar a revisión
- Duplicar solicitudes anteriores como plantilla

### Aprobaciones
- Aprobar, rechazar o devolver ítems individuales (no la solicitud completa)
- Modificar cantidades durante la aprobación (auditado)
- Registrar motivo de la decisión
- Contexto de rol: se registra qué rol tomó la decisión
- Bloquear ítems EPP que no hayan pasado por prevencionista

### Órdenes de compra
- Crear OC consolidando ítems aprobados de múltiples solicitudes
- Seleccionar proveedor, precios unitarios, descuentos, impuestos, totales
- Información de entrega, condiciones de pago, fecha estimada
- Flujo: borrador → emitida → enviada → confirmada → parcialmente recibida → recibida → cerrada
- PDF imprimible A4 con formato de orden de compra
- Adjuntar cotizaciones

### Recepción (dos etapas)
- **Recepción en oficina**: checkpoint administrativo, no genera stock
- **Recepción en faena**: genera stock en `worksite_stock` y movimientos de inventario
- Registro parcial o total contra ítems de OC
- Cantidades recibidas, rechazadas y dañadas
- Número de guía de despacho, receptor, tipo de ubicación

### Bodega
- Stock por faena por producto
- Alertas de stock mínimo
- Kardex: historial completo de movimientos (recepción, entrega, ajuste, transferencia, devolución, rechazo, pérdida)
- Ajustes de stock con motivo
- Panel de devoluciones

### Entregas
- Registrar entregas a faenas o trabajadores individuales
- Quién entregó, quién recibió, tipo de destino
- Seguimiento por ítem referenciando el ítem original de la solicitud
- Cierre del ciclo: ítems entregados alcanzan estado terminal

### Trazabilidad
- Matriz producto × faena con cantidades: solicitado, aprobado, en OC, recibido, entregado
- Filtrable por fecha, faena, categoría, proveedor
- Exportable a XLSX
- La vista central que garantiza que "nada se pierde"

### Reportes
- Múltiples tipos de reportes con filtros
- Exportación a XLSX vía ExcelJS (nunca CSV)

### Administración (7 secciones)
- **Usuarios**: CRUD, invitación por email con token, asignación de roles y faenas
- **Faenas**: CRUD (nombre, código, dirección, región, activo)
- **Trabajadores**: CRUD (RUT, nombre, cargo, faena)
- **Productos**: CRUD de productos, categorías, atributos, precios por proveedor
- **Proveedores**: CRUD (nombre, RUT, contacto, dirección, condiciones de pago)
- **Configuración**: Perfil de empresa, límites de PDF
- **Auditoría**: Visor de log de auditoría

### Funcionalidades transversales
- **Auditoría**: cada cambio de estado registrado (quién, qué, estado anterior/nuevo, motivo)
- **Códigos secuenciales**: SOL-2026-0042, OC-2026-0017, REC-2026-0005
- **Archivos adjuntos**: por tipo de entidad, almacenados en `/storage/`
- **Notificaciones**: campana con polling para envíos, aprobaciones, rechazos, OCs, recepción
- **Rate limiting**: basado en Postgres para login (IP + email)
- **Exportación XLSX**: todos los reportes exportables

---

## Máquina de estados del ítem

El **ítem** (no la solicitud ni la OC) es la unidad central de control:

```
draft → requested → approved → in_purchase_order → purchased
  ↓        ↓            ↓
cancelled  rejected   postponed

purchased → partially_received → received → partially_delivered → delivered
```

Estados de solicitud: `draft → submitted → in_review → partially_approved → approved → in_purchasing → closed`

Estados de OC: `draft → issued → sent → supplier_confirmed → partially_received → received → closed`

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router) |
| Lenguaje | TypeScript (strict) |
| Base de datos | PostgreSQL + Drizzle ORM |
| Autenticación | NextAuth v5 (Credentials, JWT) |
| Estilos | Tailwind CSS v4 + OKLCH tokens |
| UI Primitives | Radix UI (14 paquetes) |
| Íconos | Phosphor Icons |
| Fuentes | Geist Sans, Geist Mono, Source Serif 4 |
| Datos | TanStack React Query v5 |
| Validación | Zod v4 |
| Exportación | ExcelJS |
| Testing | Vitest + Playwright + Testing Library |

---

## Decisiones arquitectónicas clave

1. **Server Actions** para todas las mutaciones (no REST APIs). Solo auth, archivos,
   notificaciones y exportación XLSX usan rutas API.
2. **Estado por ítem**: el ítem, no la solicitud ni la OC, es la unidad de seguimiento.
   Esto es lo que resuelve el problema de "ítems perdidos".
3. **PostgreSQL operativo**: persistencia centralizada con migraciones Drizzle,
   constraints de integridad y mejor soporte para concurrencia real.
4. **RBAC con caché de 60s**: snapshot cacheado, invalidado al cambiar perfil. El
   scoping de faena se aplica a nivel SQL.
5. **Sin estado global**: React Query para caché del servidor, SessionProvider para
   auth. Sin Redux/Zustand.
6. **Single-tenant**: una instalación por organización.
7. **Rutas de impresión**: grupo de layout separado `(print)` para vistas A4 sin
   chrome de navegación.

---

## Flujos principales

### Procure-to-pay completo
1. Prevencionista faena crea solicitud con ítems del catálogo
2. Jefatura/Secretaría/Prevencionista oficina aprueban ítems individualmente
3. Secretaría crea OC consolidando ítems aprobados por proveedor
4. OC se imprime (PDF A4) y se marca como enviada
5. Secretaría registra recepción en oficina (checkpoint, sin stock)
6. Secretaría/Prevencionista faena registra recepción en faena (genera stock)
7. Se entregan ítems a trabajadores o faenas
8. Trazabilidad completa visible en `/trazabilidad`

### Onboarding de usuarios
1. Primer usuario se auto-registra → rol administrador
2. Admin crea faenas, proveedores, catálogo de productos
3. Admin invita usuarios por email (o link copiable)
4. Admin asigna roles + scoping de faena

### Entrega de EPP a trabajador
1. Ítem de solicitud se asocia a un trabajador específico
2. Tras recepción, se crea entrega con `destinationType: "worker"`
3. El ítem alcanza estado terminal `delivered`
4. Historial completo: qué trabajador recibió qué EPP, cuándo, de qué solicitud

### Gestión de stock
- Stock por faena (`worksite_stock` único en worksiteId + productId)
- Todos los movimientos registrados en `inventory_movements` con cantidades antes/después
- Alertas de stock mínimo
- Ajustes, transferencias, devoluciones y rechazos soportados
- Vista Kardex en `/bodega`
