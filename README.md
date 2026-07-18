# Plataforma Chome

Plataforma interna para gestionar la operación por faena: solicitudes, aprobaciones, compras, recepción, stock, entregas, prevención, flota, reportes y trazabilidad.

## Puesta en marcha

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

El seed base no carga usuarios ni datos mock. Solo crea faenas/trabajadores base
y el listado de EPP con sus proveedores preferidos.

Para desarrollo rápido también puedes usar `npm run db:push`; para ambientes compartidos usa las migraciones versionadas en `db/migrations`.

El primer usuario se crea desde `/registro` y recibe el rol `Administrador`.
Después de eso, los registros requieren invitación desde `/admin/usuarios`.

Para habilitar invitaciones por correo, configura SMTP:

```bash
SMTP_HOST=smtp.tudominio.cl
SMTP_PORT=587
SMTP_USER=usuario
SMTP_PASS=clave
SMTP_FROM="Plataforma Chome <bodega@tudominio.cl>"
SMTP_SECURE=false
SMTP_EHLO_NAME=localhost
APP_URL=https://bodega.chome.dev
AUTH_URL=https://bodega.chome.dev
```

Con `SMTP_SECURE=false`, el servidor debe ofrecer STARTTLS antes de autenticar.
Usa `SMTP_SECURE=true` para SMTP sobre TLS directo, tipicamente en el puerto 465.

En producción, `AUTH_URL` debe coincidir exactamente con el origen público que se abre en el navegador. Si falta o apunta a otro dominio/protocolo, Auth.js puede crear una cookie de sesión que luego no reconoce al entrar a rutas protegidas, provocando que el usuario vuelva a `/login` después de autenticarse.

## Datos reales o de prueba con flujo real

Para probar el sistema sin mocks, ingresa los datos desde la app en este orden:

1. Administra faenas y centros de costo en `/admin/faenas`.
2. Crea proveedores en `/admin/proveedores`.
3. Crea categorias, productos, atributos y proveedores asociados en `/admin/productos`.
4. Crea usuarios por rol y asignales faenas en `/admin/usuarios`.
6. Crea un usuario `Prevencionista faena` y asignale al menos una faena.
7. Entra como prevencionista faena y crea una solicitud en `/solicitudes/nueva`.
8. Entra como jefatura, secretaría, prevencionista oficina o administrador y aprueba en `/aprobaciones`.
9. Entra como jefatura, secretaría o administrador, genera una OC en `/compras/nueva` y emite/envia la orden.
10. Anexa facturas desde el detalle de una solicitud u orden de compra cuando llegue el respaldo.
11. Registra recepción en oficina desde `/recepcion/nueva` y luego recepción en bodega/faena cuando Chome distribuya los productos.
12. Revisa el avance por ítem en `/trazabilidad` y los pendientes en `/reportes`.

## Reglas operativas

- El flujo operativo entrega EPP recibido a trabajadores desde el módulo Entregas.
- La recepción en oficina no deja stock disponible; la recepción en bodega/faena sí se registra contra la faena de la OC y deja stock disponible.
- La entrega de EPP a trabajador cierra el seguimiento operativo de sus ítems recibidos.
- La prevencionista oficina participa en aprobaciones de todos los productos.
- La aprobacion simple actual es suficiente: no hay cadena obligatoria.
- Las facturas anexas son visibles para administrador, jefatura, secretaría y prevencionista oficina.
- Los EPP con talla, color o modelo se mantienen como productos comprables separados, con atributos normalizados para busqueda y solicitud.
- La base Postgres local no se versiona; schema, migraciones y seed son la fuente reproducible.

## Pendiente para integraciones reales

Dashboard y reportes consultan datos persistidos de solicitudes, OC, recepciones, stock y facturas anexas.
Los reportes principales ya tienen exportacion XLSX desde `/reportes`.

Hace falta implementar:

- Importadores o conectores externos si los maestros vienen de ERP, planillas o proveedor contable.
- Ajustes de formato avanzado si los reportes XLSX requieren plantillas contables.
- Facturacion contable avanzada con lineas de factura, estados de pago e integracion externa.
- Pruebas E2E que creen datos por UI/API siguiendo el flujo anterior.

## Documentación

| Documento | Contenido |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack técnico, BD, ciclo de vida, RBAC, patrones |
| [DESIGN.md](DESIGN.md) | Sistema de tokens, diseño visual, accesibilidad |
| [STYLING.md](STYLING.md) | Guía de estilos y reglas de layout |
| [docs/deploy/DEPLOY.md](docs/deploy/DEPLOY.md) | Docker, migraciones, CI/CD y healthcheck |
| [docs/deploy/SERVIDOR_CASERO.md](docs/deploy/SERVIDOR_CASERO.md) | Deploy paso a paso en servidor propio |
| [docs/deploy/RUNBOOK.md](docs/deploy/RUNBOOK.md) | Backups, restore, monitoreo, SLO/RPO/RTO e incidentes |
| [docs/pruebas/TESTING.md](docs/pruebas/TESTING.md) | Unitarias, E2E, manuales y cobertura |
