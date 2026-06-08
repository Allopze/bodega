# Plan: OC Imprimible Profesional para Chome

## Resumen
- Alcance confirmado: **solo PDF/impresión**, sin envío automático por correo ni descarga server-side.
- La OC será una **vista A4 profesional** que el navegador permite imprimir o guardar como PDF.
- Se usará el logo existente `public/chome_logo.svg`.
- Los datos legales/comerciales de Chome serán **configurables** desde Administración, usando la tabla `system_settings` existente.
- El estado “sent” seguirá funcionando como hoy: cambia al hacer click en **Marcar como enviada**.

## Cambios Clave
- Agregar un perfil de empresa configurable en `system_settings`, sin migración nueva:
  - `company_name`, default `Chome`
  - `company_rut`
  - `company_address`
  - `company_phone`
  - `company_email`
  - `company_website`
- Extender `lib/services/system-settings.ts` con:
  - tipo `CompanyProfile`
  - `getCompanyProfile()`
  - `setCompanyProfile(profile, userId, userEmail?)`
  - auditoría por actualización de configuración.
- Extender `/admin/configuracion`:
  - mantener el límite PDF actual.
  - agregar sección “Datos de empresa para órdenes de compra”.
  - validar con Zod campos opcionales, email válido cuando exista, largos máximos razonables.
- Rediseñar `/compras/[id]/print` como documento A4:
  - encabezado con logo Chome, datos de empresa, título “Orden de Compra” y código OC.
  - bloque proveedor con nombre, RUT, contacto, correo, teléfono y dirección si existen.
  - bloque operación con faena, dirección de entrega, condición de pago, fecha emisión/impresión, entrega estimada y estado.
  - tabla de ítems con SKU, descripción, notas, cantidad, unidad, precio unitario, descuento si aplica y subtotal.
  - totales neto, IVA 19% y total.
  - notas/instrucciones para proveedor.
  - firmas: Compras, Aprobación, Proveedor.
  - pie con código OC y fecha.
- Mejorar controles no imprimibles:
  - botón “Guardar PDF / Imprimir”.
  - botón “Volver a la OC”.
  - helper breve con nombre sugerido: `OC-{codigo}.pdf`.
- Mantener seguridad actual:
  - `requirePermission("purchasing:view")`.
  - `canAccessWorksite`.
  - no exponer la vista imprimible públicamente.

## Interfaces
- No agregar endpoint PDF ni dependencia nueva.
- No cambiar schema de `purchase_orders`.
- No cambiar el flujo de `sendOrderAction`.
- La única interfaz nueva estable será el helper de configuración:
  - `CompanyProfile = { name, rut, address, phone, email, website }`
  - los campos vuelven como strings, usando `""` cuando no estén configurados.

## Test Plan
- Unit tests:
  - `getCompanyProfile()` retorna defaults cuando no hay configuración.
  - `setCompanyProfile()` guarda todos los campos y registra auditoría.
  - validación de configuración acepta campos vacíos y rechaza email inválido.
- E2E/Playwright:
  - crear o usar una OC existente.
  - abrir `/compras/{id}/print`.
  - verificar que aparecen logo, código OC, proveedor, faena, tabla de ítems y total.
  - verificar que los botones no aparecen en modo impresión.
  - verificar que el enlace “Imprimir / PDF” sigue visible desde el detalle de OC.
- Verificación visual:
  - revisar screenshot desktop de la vista imprimible.
  - revisar que el layout cabe en A4, sin solapes, con tabla legible y márgenes correctos.
- Regresión:
  - confirmar que “Marcar como enviada” sigue cambiando estado al hacer click, sin depender del PDF.

## Supuestos
- El PDF se obtiene con el diálogo nativo del navegador: **Imprimir → Guardar como PDF**.
- No se implementa correo al proveedor en esta iteración.
- No se implementa descarga automática con nombre de archivo controlado por servidor.
- Si faltan datos legales de Chome o del proveedor, el documento muestra solo los campos disponibles y no imprime guiones innecesarios.
