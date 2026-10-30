# QA focalizada: meses vacíos de Copec, traslados de vehículos y aviso de pendientes

Fecha: 2026-10-30. Alcance: cobertura de un producto deshabilitado en el
portal, versionado de asignaciones de proveedor al trasladar un vehículo y el
aviso de cargas pendientes del panel Copec en `/combustibles/importar`. No es una
auditoría completa.

## Hallazgos

- **PRODUCT BUG** — un producto deshabilitado en el portal (sin consumo en el
  mes) quedaba «desconocido» y el mes no avanzaba hasta confirmarlo a mano. Pasa
  casi todos los meses con TAE BlueMax.
- **PRODUCT BUG** — trasladar un vehículo de faena (flota, importación de flota,
  mantención) no movía sus asignaciones de proveedor, y la sincronización sigue
  la faena de la asignación: el consumo habría quedado en la faena vieja.
- **UX FINDING** — el panel decía «566 patente(s) sin vehículo registrado» con
  el número de FILAS pendientes de la última corrida (enero 2025, ya fuera del
  plan). Ahora dice «N carga(s) de <mes> quedaron pendientes» y la causa real.

- **PRODUCT BUG** — ninguna recepción TAE se aceptaba en el ledger aunque su
  vasija existiera: el validador entrega la tarjeta compacta («12422690023091»)
  y el mapa de estanques usaba la tarjeta con guiones. Visto en producción el
  2026-10-30 (27 filas de octubre y 42 de enero pendientes con las 3 vasijas ya
  creadas). Ahora se comparan compactas en los dos lados (ledger y ciclo físico).
- **PRODUCT BUG** — Copec reutiliza el número de guía entre vehículos distintos
  (guía 660150998: TBZW-37 y SRCJ-47 el 15-01-2026; 660297420: DZJY-31 y
  SRCJ-47 el 29-01). La segunda carga quedaba «corrección pendiente de revisión»
  y enero no cerraba. Ahora sólo se revisa la misma guía en el MISMO vehículo.

## Verificación

- Pruebas nuevas o actualizadas: sincronización (vacío confirmado en mes cerrado,
  desconocido en mes abierto y sin resultados), sesión del portal (motivo
  `product_disabled`), servicio de asignaciones con PGlite (versionado, corrección
  en el lugar, resolvedor real por fecha), acciones de flota y equipos de
  mantención con PGlite, y el aviso del panel.
- `npm run typecheck`, ESLint de lo tocado, `npm run test:fast` (15.629 pasan tras los dos últimos arreglos)
  y 36 suites PGlite relacionadas (394 pasan).
- Navegador (dev del worktree, `bodega_dev`): el panel muestra «503 carga(s) de
  enero de 2026 quedaron pendientes…» y no el texto viejo; sin errores de consola.

## Límites

- No se ejecutó una sincronización real nueva: el cierre automático de un mes
  vacío se verá en la próxima corrida después de desplegar.
- No se probó en el navegador un traslado de vehículo; lo cubren las pruebas de
  acción y PGlite.
