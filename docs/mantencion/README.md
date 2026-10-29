# Mantención de equipos

Módulo de mantención preventiva y correctiva, independiente del módulo antiguo
`mantenciones` (órdenes de trabajo con costos). Especificación completa en
[`ESPECIFICACION.md`](./ESPECIFICACION.md) y decisiones en
[`PLAN-modulo-mantencion.md`](../../PLAN-modulo-mantencion.md).

## Superficies

- **App del mecánico** — `/m/mantencion`. PWA de pantalla completa, sin el
  AppShell de la plataforma. Registra preventivas y correctivas, actualiza el
  estado en taller y funciona sin conexión.
- **Jefatura** — `/mantencion/{panel,registros,registros/[id],equipos,equipos/[id],equipos/nuevo,equipos/importar,pautas,pautas/[id],dispositivos}`.
- **API de sincronización** — `/api/mantencion/sync/*`, autenticada sólo con
  `Authorization: Bearer <credencial de dispositivo>`.
- **PDF** — `/mantencion/registros/[id]/print`, renderizado con Chromium y
  archivado en `storage/mantencion/`.

## Arquitectura

- El equipo es `fuel_vehicles` (la flota existente) más `mant_equipment_profiles`
  (1:1). La faena es `worksites` más `mant_worksite_settings` (código de folio).
- Las tablas propias llevan prefijo `mant_*` y viven en
  `db/schema/mantencion-{catalogs,schedules,records,devices}.ts`. La migración
  aditiva es `db/migrations/0361_mantencion_equipos.sql`.
- Las reglas puras (lecturas, estado, pauta, normalización) están en
  `lib/mantencion/` y se comparten entre el teléfono y el servidor. El servidor
  revalida todo lo que valida el cliente.
- La app guarda catálogos, borradores, cola de envío y fotos (Blob) en IndexedDB.
  El service worker (`public/mant-sw.js`) cachea el shell.
- Cada credencial de dispositivo dura 30 días, se guarda sólo como SHA-256 y se
  revoca desde `/mantencion/dispositivos`. La cola de una tablet compartida se
  envía con la credencial de su autor, no con la sesión abierta.
- Los registros firmados no se editan: sólo cambian `status` (anulación),
  `review` (observación/revisión) y el PDF archivado. Las pautas se versionan y
  cada registro conserva el snapshot con que se firmó.

## Roles y permisos

| Rol | Alcance |
|---|---|
| `mecanico` | Registra y ve lo propio; requiere faena asignada. |
| `supervisor_mantencion` | Ve, observa y exporta su faena; requiere faena asignada. |
| `jefe_mantencion` | Todo el módulo (global). |
| `jefa_chome` | Lectura y exportación de todas las faenas. |

Los permisos se declaran en `modules/mantencion-equipos/manifest.ts` y se
sincronizan con `npm run db:sync-rbac` o el servicio `sync-rbac` del deploy.

## Carga inicial

```bash
npm run db:seed:mantencion
# Reconocer cuentas ya creadas y reportar a quién falta invitar:
npm run db:seed:mantencion -- --correos /ruta/fuera/del/repo/correos.json
```

El seed lee `db/seed/mantencion-seed.json`, es idempotente y concilia la flota
existente por código y luego por patente sin pisar datos. **No crea cuentas ni
contraseñas**: los mecánicos se invitan desde `/admin/usuarios`. El archivo de
correos debe quedar fuera del repositorio.

En producción, el seed se ejecuta **a mano**, después de migrar y sincronizar
RBAC. No forma parte del servicio `migrate` ni del deploy automático.

## Probar sin conexión

1. Levantar la app y entrar a `/m/mantencion` con una cuenta con `mant:app:use`.
2. Definir el PIN local en el primer ingreso.
3. En DevTools, activar `Offline` (o usar `context.setOffline(true)` en
   Playwright) y registrar una mantención.
4. Recargar: el shell y la cola deben seguir disponibles.
5. Volver a `Online`: la cola se envía sola, sin duplicados. La foto local se
   borra sólo después de que el servidor confirma el registro completo.
6. Para la tablet compartida, «Cambiar de cuenta» exige el PIN local y cada
   elemento de la cola conserva su autor.

## Operación

- **Folios**: los asigna el servidor al recibir (`MP-<FAENA>-0001`); el teléfono
  muestra «Folio pendiente» hasta sincronizar. La concurrencia real se verifica
  con `scripts/verify-mantencion-folio-concurrency.ts` contra una base desechable.
- **Anulación**: sólo jefatura, con motivo de al menos 10 caracteres. El registro
  sigue visible, marcado, y se excluye de lecturas, estados y KPI.
- **Observaciones**: supervisor o jefatura comentan; el mecánico responde desde
  la app y jefatura puede marcar «revisado».
- **PDF**: se genera y archiva la primera vez; las siguientes descargas entregan
  el mismo archivo. Al anular se regenera con la marca «ANULADO».
- **Dispositivos**: revocar una credencial desconecta ese teléfono sin borrar lo
  que tenga sin enviar.

## Fuera de alcance

Firma de jefatura (queda el espacio visible), notificaciones push, integración
con Bodega (los repuestos son texto con cantidad) y costos.
