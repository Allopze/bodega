# Plan MVP Chome Solicitudes y Bodega

## Resumen
Construir un MVP web interno en **Next.js + TypeScript + PostgreSQL**, enfocado en resolver el problema central: ningún ítem aprobado puede perderse entre solicitud, compra, recepción, entrega y factura.

El MVP incluirá **bodega Nivel 1**: stock simple por bodega, ingresos desde OC, egresos/entregas y movimientos básicos. Se diseñará single-tenant para Chome sobre PostgreSQL.

## Cambios Clave

- Stack: Next.js App Router, TypeScript, PostgreSQL, Drizzle ORM, Tailwind, Auth.js o sesión propia con credenciales.
- Roles MVP: administrador, solicitante, jefe de faena, compras, recepción/bodega, finanzas, gerencia consulta.
- Núcleo operativo:
  - solicitudes por faena con ítems individuales;
  - aprobación por ítem;
  - bandeja de ítems aprobados pendientes de compra;
  - generación de OC desde ítems aprobados;
  - recepción parcial/completa;
  - ingreso a bodega Nivel 1 o recepción directa;
  - entrega a faena/trabajador;
  - factura manual y conciliación básica;
  - matriz obligatoria de trazabilidad por ítem.
- UI: dashboard operativo denso pero claro, sin landing page; navegación por módulos; pantallas móviles usables para faena y recepción; estados loading/empty/error en formularios y bandejas.
- Auditoría: registrar usuario, fecha, acción, entidad, estado anterior/nuevo y motivo cuando aplique.

## Interfaces y Modelo

- Entidades principales:
  - `User`, `Role`, `Permission`, `UserRole`, `WorksiteUser`
  - `Worksite`, `CostCenter`, `Supplier`
  - `Product`, `ProductCategory`, `ProductAttribute`, `ProductSupplier`
  - `PurchaseRequest`, `PurchaseRequestItem`, `RequestItemAttribute`
  - `ApprovalDecision`, `PurchaseOrder`, `PurchaseOrderItem`
  - `Receipt`, `ReceiptItem`, `Delivery`, `DeliveryItem`
  - `Warehouse`, `WarehouseStock`, `InventoryMovement`
  - `Invoice`, `InvoiceItem`, `InvoiceReconciliationDifference`
  - `AuditLog`, `Attachment`, `Notification`
- Estados MVP:
  - Solicitud: `draft`, `submitted`, `in_review`, `partially_approved`, `approved`, `rejected`, `returned`, `in_purchasing`, `closed`, `cancelled`
  - Ítem: `draft`, `requested`, `approved`, `rejected`, `returned`, `pending_purchase`, `in_purchase_order`, `purchased`, `partially_received`, `received`, `partially_delivered`, `delivered`, `invoiced`, `reconciled`, `observed`, `postponed`
  - OC: `draft`, `issued`, `sent`, `supplier_confirmed`, `partially_received`, `received`, `partially_invoiced`, `invoiced`, `reconciled`, `closed`, `cancelled`
  - Factura: `registered`, `pending_review`, `observed`, `reconciled`, `rejected`, `sent_to_payment`, `paid`, `cancelled`
- API interna:
  - `/api/requests`, `/api/request-items`, `/api/approvals`
  - `/api/purchase-orders`, `/api/receipts`, `/api/deliveries`
  - `/api/warehouses`, `/api/inventory-movements`
  - `/api/invoices`, `/api/reconciliation`
  - `/api/admin/users`, `/api/admin/products`, `/api/admin/worksites`, `/api/admin/suppliers`
- Regla dura: las transiciones de estado de ítems deben vivir en servicios compartidos, no repartidas en componentes UI.

## Fases de Implementación

1. Base técnica: proyecto Next.js, auth, layout, roles, Drizzle/PostgreSQL, seed inicial, auditoría base.
2. Datos maestros: usuarios, faenas, centros de costo, productos, categorías, proveedores, bodegas.
3. Solicitudes: creación, borrador, envío, ítems con atributos, adjuntos básicos, historial.
4. Aprobaciones: aprobación/rechazo/devolución por ítem, motivos obligatorios, reglas EPP simples.
5. Compras: bandeja de ítems aprobados, creación de OC, PDF, estado enviado/confirmado, control de ítems no incluidos.
6. Recepción y bodega Nivel 1: recepción parcial/completa, ingreso a stock, movimientos, egresos y entregas.
7. Facturación: factura manual, asociación a OC, comparación cantidad/precio/recepción, observaciones y conciliación.
8. Dashboards/reportes: pendientes por rol, matriz de trazabilidad, gastos básicos, exportación XLSX.
9. Endurecimiento: permisos granulares, validaciones, pruebas E2E, datos de demostración y respaldo Postgres.

## Test Plan

- Unit tests para transiciones de estado de ítems, reglas de aprobación, cálculo de pendientes y conciliación.
- Integration tests para crear solicitud, aprobar ítems, generar OC, recibir parcialmente, entregar y conciliar factura.
- E2E Playwright:
  - ítem aprobado no incluido en OC queda pendiente con alerta;
  - recepción parcial mantiene saldo pendiente;
  - factura con cantidad mayor a recepción queda observada;
  - bodega rechaza egreso sin stock suficiente;
  - usuario sin permiso no puede aprobar, comprar, recibir o conciliar fuera de rol.
- Validación visual responsive en móvil y desktop para solicitud, bandeja de compras, recepción y matriz de trazabilidad.

## Supuestos

- “Next.hs/SQLite” fue el supuesto inicial; la app viva usa **Next.js + PostgreSQL**.
- MVP será una aplicación interna de Chome, no portal proveedor.
- Bodega MVP será **Nivel 1**, con stock simple por producto/bodega, sin ubicaciones internas, kardex avanzado, lotes ni seriales.
- Facturas serán registradas manualmente; importación PDF/XML e integración contable quedan para segunda etapa.
- Email puede partir como registro de envío y evolucionar a envío real SMTP/API.
