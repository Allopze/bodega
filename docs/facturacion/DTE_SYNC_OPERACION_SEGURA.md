# Operación segura de sincronización DTE

Este runbook aplica al corte del almacenamiento de credenciales DTE y al
re-cifrado opcional de su keyring. Conserva exactamente las credenciales de
FacturaEnLínea; no ejecuta sincronizaciones ni modifica producción por sí solo.

## Release compatible

1. Desplegar una imagen que incluya el DTO Admin seguro, origen fijo del portal,
   runner Node, evaluador de salud y lectura de sobres `enc:v1`.
2. Provisionar sólo en el servicio `app` un keyring JSON con claves base64url de
   32 bytes y un `kid` activo. Ejemplo de forma, sin secreto real:

   ```text
   DTE_SETTINGS_KEYRING={"2026-08":"<32-byte-base64url>"}
   DTE_SETTINGS_ACTIVE_KEY_ID=2026-08
   DTE_SETTINGS_MODE=compat
   ```

3. Confirmar que `cron` no recibe `DTE_SETTINGS_*`, que Admin muestra
   `migration_required` (o `encrypted` si la release compatible ya escribió
   sobres) y que `/api/cron/dte-sync-health` responde autenticado. No activar
   la conversión si existen corridas `running` o el release no está estable.
4. Confirmar que **todas** las réplicas de `app` usan la imagen compatible
   (lease de operación y lectura `enc:v1`) antes de convertir. Una imagen
   antigua no reconoce el cerco y por eso no puede coexistir con el corte.
   Los flujos de deploy verifican el SHA de cada réplica `app` y rechazan más
   de un `cron`, porque dos schedulers duplicarían las consultas al portal.

## Invariantes de corte

- `dte.sync_enabled` conserva su significado operativo para Compras. El corte
  usa una llave distinta: durante la operación guarda
  `dte.sync_start_barrier=cutover`, que ningún guardado concurrente puede
  reabrir; al verificar el resultado queda en `paused` hasta que un operador
  habilite explícitamente la sincronización. Así también se pausan Ventas sólo
  durante conversión o re-cifrado del keyring.
- Cada GET, POST y descarga XML/PDF del cliente DTE toma un lease durable y
  acotado antes de enviar credenciales. Conversión y re-cifrado del keyring esperan esos
  leases, no un estado histórico de corrida que podría estar vencido.
- La conversión exige que las cuatro credenciales necesarias ya existan en
  `system_settings`; nunca completa una mitad persistida con `DTE_PORTAL_*`.
  Una lectura runtime de settings que falla también falla cerrada.
- Si la pausa corta ambos períodos antes de iniciar, el cron responde
  `disabled` (sin alerta). Si corta sólo uno después de otro exitoso, responde
  `partial`: no certifica el lote como completo.

## Conversión controlada

1. En Administración → Sincronización DTE, confirmar **Convertir y activar
   corte cifrado**.
2. La aplicación pone `dte.sync_enabled=false` y la barrera de inicios en
   `cutover`, espera cualquier request activo con credenciales DTE, toma un
   advisory lock transaccional, cifra o revalida todos los campos sensibles y
   verifica cada sobre antes de confirmar. Conserva byte a byte RUT, contraseña,
   CodEmp e importer; sólo cambia su protección en reposo. Sólo registra
   metadatos de auditoría.
3. La conversión deja la barrera durable `encrypted_only`; un clear/reset no
   puede revivir `DTE_PORTAL_*` plaintext. Desplegar además
   `DTE_SETTINGS_MODE=encrypted_only` en el host para conservar ese fail-closed
   ante un fallo de lectura de la base.
4. No volver a una imagen legacy. El rollback floor es la imagen compatible con
   lectura de sobres y el mismo keyring.

## Re-cifrado del keyring (no de las credenciales del portal)

1. Agregar la nueva clave al keyring de `app`, conservar la antigua y hacer que
   la nueva sea `DTE_SETTINGS_ACTIVE_KEY_ID`.
2. Confirmar **Re-cifrar con clave activa**. La acción requiere la marca durable
   `encrypted_only`, pausa sync, espera los leases activos, toma el mismo lock y
   sólo confirma si todos los sobres abren con la nueva clave.
3. Verificar que los sobres nuevos abren con los mismos valores de RUT,
   contraseña, CodEmp e importer. Esta operación nunca cambia datos en
   FacturaEnLínea ni solicita una contraseña nueva.
4. Recién entonces retirar la clave **de cifrado** anterior y las copias
   `DTE_PORTAL_*` del entorno de producción. Esto elimina duplicados de la
   misma credencial, no la rota. Los respaldos que contengan una copia previa
   se dejan expirar según la retención vigente.

## Salud, alertas y recuperación de datos

- El scheduler corre compras a las 07:00, 13:00 y 19:00, ventas a las 07:30,
  Chipax a las 09:00 y el evaluador cada cinco minutos en
  `America/Santiago`. Chipax cubre ventas del mes actual/anterior y cartolas
  del mes actual bajo un `correlationId` común.
- Durante una ventana de 20 minutos sólo cuentan corridas `cron`; manuales y
  backfills no prueban la automatización. Una fila `running` recibe 10 minutos
  de gracia antes de alertar para no paginar una corrida activa/conflicto recién
  iniciado. Cada dominio exige mes actual y anterior con el mismo
  `correlation_id`.
- `partial` genera alerta degradada; falla/configuración genera alerta crítica;
  una ejecución medida exitosa emite recuperación. Notificaciones se dirigen a
  usuarios activos con `admin:dte_sync` y respetan su preferencia de correo.
- Tras el corte, ejecutar backfill controlado únicamente de mes actual y
  anterior, comparar totales con el portal, revisar `partial`, conciliación y
  alertas antes de cerrar el incidente.

## Preflight y reparación del vínculo DTE

Antes de aplicar la migración que crea el índice único parcial de
`dte_documents.purchase_order_invoice_id`:

1. ejecutar `npm run db:preflight-dte-single-link` en la base objetivo;
2. si reporta conflictos, generar el informe por defecto con
   `npm run db:repair-dte-single-link`;
3. preparar un mapping explícito que conserve exactamente un DTE por factura
   de OC y elimine o cambie el resto;
4. ejecutar `npm run db:repair-dte-single-link -- --apply --mapping <archivo>`;
5. repetir el preflight hasta cero y recién entonces ejecutar `npm run db:migrate`.

La reparación bloquea filas, valida que no hayan cambiado desde el informe y
registra cada desvinculación en `audit_log`. No selecciona ganadores por
antigüedad, monto ni orden de consulta.

La ingesta y la conciliación se operan por separado: `status=success` puede
coexistir con `reconciliation_status=partial`, pero health queda degradado;
`reconciliation_status=failed` es crítico. Los XML y su caché están acotados a
10 MiB, incluido el archivo ya persistido.

## Rollback

Antes de la conversión se puede volver al tag previo. Después, sólo volver a la
imagen compatible con cifrado, manteniendo el keyring. Nunca retire la clave
que aún abre un sobre ni intente editar el journal de Drizzle.

El deploy automático y `scripts/deploy-prod.sh` revierten `app`, `cron` y la
definición Compose previa si falla cualquier verificación posterior al
reemplazo: health de app, health de cron, SHA de ambas imágenes o smoke
autenticado. Antes de armar ese rollback leen la marca durable
`dte.encryption_mode`: sólo si indica `compat` recuperan el tag anterior.
Con `encrypted_only` —o si no logran probar el estado— rechazan el rollback
automático y dejan el incidente para intervención explícita. Tras el corte,
fijar y conservar un tag de rollback floor compatible con `enc:v1` y el
keyring; no usar por reflejo una imagen legacy aunque sea el tag inmediatamente
anterior.
