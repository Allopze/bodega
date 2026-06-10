# Chome Solicitudes y Bodega

Sistema interno para solicitudes por faena, aprobaciones, compras, recepcion y bodega.

## Puesta en marcha

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

El seed base no carga datos mock. Solo crea roles, permisos y datos base de catálogo.
Para desarrollo rápido también puedes usar `npm run db:push`; para ambientes compartidos usa las migraciones versionadas en `db/migrations`.

El primer usuario se crea desde `/registro` y recibe el rol `Administrador`.
Después de eso, los registros requieren invitación desde `/admin/usuarios`.

Para habilitar invitaciones por correo, configura SMTP:

```bash
SMTP_HOST=smtp.tudominio.cl
SMTP_PORT=587
SMTP_USER=usuario
SMTP_PASS=clave
SMTP_FROM="Chome Solicitudes y Bodega <bodega@tudominio.cl>"
SMTP_SECURE=false
SMTP_EHLO_NAME=localhost
APP_URL=http://localhost:3000
```

Con `SMTP_SECURE=false`, el servidor debe ofrecer STARTTLS antes de autenticar.
Usa `SMTP_SECURE=true` para SMTP sobre TLS directo, tipicamente en el puerto 465.

## Datos reales o de prueba con flujo real

Para probar el sistema sin mocks, ingresa los datos desde la app en este orden:

1. Administra faenas y centros de costo en `/admin/faenas`.
2. Crea proveedores en `/admin/proveedores`.
3. Crea categorias, productos, atributos y proveedores asociados en `/admin/productos`.
4. Crea bodegas en `/admin/bodegas`.
5. Crea usuarios por rol y asignales faenas en `/admin/usuarios`.
6. Crea un usuario `Solicitante de faena` y asignale al menos una faena.
7. Entra como solicitante de faena y crea una solicitud en `/solicitudes/nueva`.
8. Entra como jefa, secretaria, prevencionista o administrador y aprueba en `/aprobaciones`.
9. Entra como jefa, secretaria o administrador, genera una OC en `/compras/nueva` y emite/envia la orden.
10. Anexa facturas desde el detalle de una solicitud u orden de compra cuando llegue el respaldo.
11. Marca la OC como recibida desde `/recepcion/nueva`.
12. Revisa el avance por ítem en `/trazabilidad` y los pendientes en `/reportes`.

## Reglas operativas

- El flujo operativo actual no usa entrega a trabajadores ni despacho desde bodega.
- La recepcion se registra directamente contra la faena de la OC.
- Marcar una OC como recibida cierra el seguimiento operativo de sus ítems recibidos.
- La prevencionista participa en aprobaciones de todos los productos.
- La aprobacion simple actual es suficiente: no hay cadena obligatoria.
- Las facturas anexas son visibles para administrador, jefa Chome, secretaria y prevencionista.
- Los EPP con talla, color o modelo se mantienen como productos comprables separados, con atributos normalizados para busqueda y solicitud.
- La base SQLite local no se versiona; schema, migraciones y seed son la fuente reproducible.

## Pendiente para integraciones reales

Dashboard y reportes consultan datos persistidos de solicitudes, OC, recepciones, stock y facturas anexas.
Los reportes principales ya tienen exportacion XLSX desde `/reportes`.

Hace falta implementar:

- Importadores o conectores externos si los maestros vienen de ERP, planillas o proveedor contable.
- Ajustes de formato avanzado si los reportes XLSX requieren plantillas contables.
- Facturacion contable avanzada con lineas de factura, estados de pago e integracion externa.
- Pruebas E2E que creen datos por UI/API siguiendo el flujo anterior.

## Documentación

La documentación del proyecto, especificaciones, arquitectura y auditorías ha sido organizada en subcarpetas dentro del directorio `docs/`:

*   **Diseño:** [DESIGN.md](file:///home/allopze/dev/chome/bodega/docs/diseno/DESIGN.md) - Guía sobre el sistema de tokens, diseño visual y alineamiento estético.
*   **Planificación:**
    *   [PLAN.md](file:///home/allopze/dev/chome/bodega/docs/planificacion/PLAN.md) - Plan de desarrollo y etapas.
    *   [PRODUCT.md](file:///home/allopze/dev/chome/bodega/docs/planificacion/PRODUCT.md) - Requisitos y especificaciones del producto.
    *   [chome_feature_list.md](file:///home/allopze/dev/chome/bodega/docs/planificacion/chome_feature_list.md) - Catálogo detallado de funcionalidades del sistema.
*   **Auditorías y Catálogos:**
    *   [AUDITORIA_PROYECTO.md](file:///home/allopze/dev/chome/bodega/docs/auditoria/AUDITORIA_PROYECTO.md) - Análisis, reporte de seguridad y mejoras necesarias.
    *   [EPP_PROVEEDORES_ESTRUCTURADO.md](file:///home/allopze/dev/chome/bodega/docs/auditoria/EPP_PROVEEDORES_ESTRUCTURADO.md) - Datos maestros estructurados de proveedores y catálogo.
*   **Pruebas:** [TESTING.md](file:///home/allopze/dev/chome/bodega/docs/pruebas/TESTING.md) - Información sobre la ejecución y cobertura de pruebas.
