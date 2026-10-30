# QA focalizada: cron de Copec/Aramco y botón «Sincronizar»

Fecha: 2026-10-29. Alcance: autenticación de los crons `fuel-copec-sync` y
`fuel-aramco-sync`, y el flujo del botón «Sincronizar meses TCT» en
`/combustibles/importar`. No es una auditoría completa de la aplicación.

## Hallazgos confirmados (producción, sólo lectura)

- **PRODUCT BUG — el cron de 05:30 nunca corrió.** `fuel_provider_sync_runs`
  sólo tiene corridas `manual` (Copec y Aramco) y `cron_runs` no tiene ninguna
  fila programada de `fuel-copec-sync`. Las rutas exigen un origen de
  `CRON_ALLOWED_SOURCES` en producción; la variable está vacía y el scheduler
  llama a `http://app:3000` sin `X-Forwarded-For`, así que responden 401 antes
  de tomar el lock. La prueba `fuel-cron-internal-auth.test.ts` reproduce ese
  401 con la autenticación real.
- **PRODUCT BUG — el botón no llegaba al mes en curso.** Pedía un mes por
  petición, siempre el pendiente más antiguo (2025-01 en producción). Ese mes
  queda incompleto por datos (patentes sin asignación fechada, proveedor Copec
  ausente del catálogo), el siguiente se rechazaba con «El período ya no
  corresponde al siguiente tramo pendiente» y el mes en curso nunca se pedía.
  Cada mes era además un login con correo de código.
- **PRODUCT BUG — respuesta perdida.** La app está detrás de Cloudflare
  (`server: cloudflare`); una corrida por mes tarda de 1,5 a 4 minutos y supera
  el corte de ~100 s del proxy.
- **INCONSISTENCY** — el aviso de conciliación mandaba a «Combustibles →
  Proveedores»; la pantalla está en Administración › Catálogos de flota ›
  Proveedores de combustible. Corregido.

## Cambios

- Las dos rutas aceptan el secreto interno `FUEL_CRON_INTERNAL_SECRET`
  (`X-Fuel-Cron-Secret`), mismo patrón que los jobs GPS. Cableado en el runner,
  el crontab (enmascarado en el log), `app`, `cron`, `backup-scheduler`, las
  listas del respaldo y `.env.example`.
- El botón corre el mismo barrido del cron (`syncCopecReports`, con el operador
  como importador) en segundo plano (`startCronJobInBackground` + `after()`), y
  la pantalla consulta el avance cada 4 s.

## Verificación

- Pruebas nuevas: autenticación real del scheduler (12), runner (1), contrato
  estructural runner↔ruta↔crontab↔servicios (1), acciones de inicio/avance (7),
  componente (8), barrido y operador (3), y `cron-lock-background-postgres`
  (3) contra Postgres real en `:55432`, agregada al CI.
- `npm run typecheck` y ESLint de los archivos tocados: sin errores.
- `npm run test:fast`: 15.619 pasan, 4 fallan. Tres no son de este cambio y
  fallan igual en `main` limpio o por un archivo sin versionar: dos de
  `pdtp-data-steps-parity` (también en `main`) y `mantencion/seed-data`, que lee
  `docs/mantencion/referencias/seed-mantencion.json`, presente en el checkout
  principal pero sin versionar. La cuarta, `postgres-suites-gating`, era de este
  cambio y se corrigió.
- **Navegador (dev del worktree en :3200, base `bodega_dev`, cuenta Copec real
  `allopze`):** el botón pasó a «Sincronizando meses…», mostró «Sincronizando
  octubre de 2026 · 0 de 5» y luego «enero de 2026 · 1 de 5», y a los ~3 min
  dejó el resumen: 813 filas recibidas, 231 aceptadas, 580 pendientes, 2
  rechazadas, con el motivo de cada mes y «Se detuvo: … 2026-01 no alcanzó
  cobertura terminal». Sin errores de consola ni peticiones fallidas; sin
  desborde horizontal a 390 px.

## Límites

- El primer clic del recorrido no hizo nada: llegó antes de la hidratación del
  dev con webpack. El segundo, esperando la hidratación, funcionó. No se observó
  en producción.
- No se verificó el cron programado de punta a punta: requiere desplegar y que
  `FUEL_CRON_INTERNAL_SECRET` esté en el `.env` de producción.
- No se verificó el corte real de Cloudflare: el dev local no pasa por el proxy.
- Los avisos (toasts) no se capturaron en el recorrido; los cubren las pruebas
  del componente.
- La corrida de dev escribió en `bodega_dev` (octubre y enero de 2026).
