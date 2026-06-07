# Chome Solicitudes y Bodega

Sistema interno para solicitudes por faena, aprobaciones, compras, recepcion y bodega.

## Puesta en marcha

```bash
npm install
npm run db:push
npm run db:seed
npm run dev
```

El seed base no carga datos mock. Solo crea roles, permisos y datos base de catálogo.

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
10. Registra la recepcion en `/recepcion/nueva`.
11. Registra entregas a faena desde `/bodega`; cada entrega descuenta stock y guarda quien recibio.
12. Anexa facturas desde el detalle de una solicitud u orden de compra.
13. Revisa stock, movimientos y entregas en `/bodega` y `/entregas`.

## Reglas operativas

- Las entregas son siempre a una faena.
- Para registrar una entrega basta indicar quien recibio.
- Toda entrega descuenta stock desde una bodega.
- La prevencionista participa en aprobaciones de todos los productos.
- La aprobacion simple actual es suficiente: no hay cadena obligatoria.
- Las facturas anexas son visibles solo para jefa Chome, secretaria y prevencionista.
- Los EPP con talla, color o modelo se mantienen como productos comprables separados, con atributos normalizados para busqueda y solicitud.
- La base SQLite local no se versiona; schema y seed son la fuente reproducible.

## Pendiente para integraciones reales

Dashboard y reportes consultan datos persistidos de solicitudes, OC, recepciones, stock y facturas anexas.

Hace falta implementar:

- Importadores o conectores externos si los maestros vienen de ERP, planillas o proveedor contable.
- Exportacion CSV/Excel si los reportes deben salir del sistema.
- Pruebas E2E que creen datos por UI/API siguiendo el flujo anterior.
