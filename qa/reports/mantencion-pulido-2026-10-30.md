# QA — Pulido UI/UX del módulo de mantención de equipos (2026-10-30)

Rama `feat/mantencion-pulido`. Partió de una crítica impeccable de 25/40 (`.impeccable/critique/2026-10-30T16-09-32Z__app-app-mantencion.md`), hecha con dos evaluadores aislados: revisión de diseño, y detector más navegador. El usuario eligió abordar todo, incluida la bandeja de revisión, y mantener la correctiva en naranja.

## Alcance recorrido

- **Jefatura (`/mantencion/*`), a 1440 y 390 px:**
  - panel;
  - registros (pestañas, detalle preventiva/duplicado/correctiva, «Más filtros», «Marcar revisado y siguiente» hasta vaciar la bandeja);
  - equipos (lista, ficha, nuevo, importar);
  - pautas (lista, detalle, quitar y restituir un intervalo, teclado en la matriz);
  - dispositivos.
- **App del mecánico (`/m/mantencion`), a 390×844 táctil con service worker:**
  - login, PIN e inicio;
  - preventiva y correctiva hasta «Revisar», sin firmar;
  - salir guardando, retomar un borrador, migración de un borrador correctivo con los pasos viejos;
  - hoja de observaciones.
- **Datos:** `bodega_dev` con 8 registros `QA_` (folios `…-9101` a `…-9108`) y fotos en el `STORAGE_PATH` del dev.

## Defectos confirmados y corregidos

- **Panel:** «Mantenciones vencidas 0 · Todas las pautas al día» con 112 de 119 equipos sin lecturas. Ahora dice entre cuántos se midió, y «sin lecturas» es un aviso con enlace.
- **Equipo en taller:** KA-110, con 15 días en taller, aparecía «AL DÍA» en Próximas. Ahora la etiqueta es «En taller · N días» seguida del estado de pauta (`EquipmentStateBadge`).
- **Alerta cortada en móvil:** el chip «…72 H» medía 396 px dentro de 358 y se cortaba a 390 px. Las alertas son ahora un aviso en tipo oración, con acción y enlace a la foto; no dependen de `title`.
- **Contraste de la leyenda:** «Correctivas» estaba a 3,8:1 y ahora a 8,1:1. La serie sigue en naranja.
- **Pautas:** quitar un intervalo era un clic sin confirmar, sobre una pauta con 70 equipos. Volver a agregarlo copiaba la columna de otro intervalo. Ahora hay `ConfirmDialog` con el impacto y la restitución conserva su columna.
- **App:** salir de un registro sólo ofrecía «Salir y descartar», aunque el borrador ya se autoguarda. Ahora es «Guardar y salir».
- **Textos:**
  - quedaba visible el texto de hoja de ruta «Jefatura · segunda etapa…»;
  - «Salió de taller: Sigue en taller»;
  - «un comentario. Respóndelos»;
  - «Observ.»;
  - «Ford Cargo Ford Cargo 5032 E» y «Ford Cargo Cargo 2628».
- **Maquetación:** fechas y folios partidos en dos líneas; tablas con borde dentro de tarjetas con borde; línea secundaria de `SummaryBar` a 11 px; rótulo de `KpiCard` truncado en 2×2.
- **Navegación:** el alias `/mantencion/dispositivos → /mantencion/equipos` de `module-toggles-routes.ts` habría hecho que apagar «Dispositivos» no cerrara su ruta, una vez agregado el ítem al menú.

## Mejoras de UX entregadas

- **Bandeja de revisión** con pestañas y contador, anterior/siguiente sobre la misma consulta de la lista, y «Marcar revisado y siguiente».
- **Accesibilidad de la matriz de pauta:** una sola parada de Tab (antes ~265) y celdas táctiles de 44 px en móvil.
- **Móvil:** tarjetas en Registros y Equipos, y KPI del panel en 2×2.
- **Dispositivos:** en el menú, agrupados por persona, con CTA en el estado vacío.
- **App del mecánico:**
  - paso «Fotos» propio en la correctiva;
  - «Notas» con atajo «Sin novedad»;
  - foto completa con su sello;
  - validación igual en ambos flujos;
  - faenas resumidas en el encabezado.

## Consola y red

0 errores de consola, 0 `pageerror` y 0 respuestas ≥400 en todas las vistas recorridas. No cuentan `api.dicebear.com` ni el favicon, que es ruido conocido del sandbox. axe: 0 serious/critical.

## Advertencias de automatización

- **Antes de corregir:** las fotos sembradas daban 404 porque se guardaron en `./storage` y el dev usa el `STORAGE_PATH` de `.env.development.local`. Era del entorno, no del producto.
- **E2E que fallaron por los tests, no por el producto:**
  - un `count()` que no esperaba a que la matriz cargara;
  - el texto viejo de la alerta «Fuera de faena»;
  - una regex que no aceptaba el singular «Ver 1 anterior»;
  - una repetición parcial sin la spec 3a, de la que depende la 3b.

## Puertas ejecutadas

- **Typecheck y lint:** completos y limpios.
- **`test:fast`:** 1.055 archivos, 15.733 tests en verde.
- **PGlite del módulo:** 8 suites, 175 tests en verde.
- **E2E (worktree desechable, chromium):**
  - `mantencion-1` a `mantencion-4`: 46 de 46;
  - `control-operacional-navegacion`, `densidad-kpi`, `densidad-kpi-filtros` y `dashboard-rediseno`: en verde.

## Brechas de cobertura

- No se firmó ningún registro en la app ni se probó la importación con un archivo real. La pantalla final después de firmar quedó cubierta por la E2E 1.
- Sin estados de error de red ni de sesión vencida en la app, fuera de lo que cubre la E2E.
- No se hizo pasada en tablet.

## Decisiones abiertas

- **Pauta «en vivo»:** cada edición publica versión. Se mantuvo; pasar a borrador y publicar toca cómo la app descarga y firma contra versiones.
- **Paleta de la app:** la app conserva la suya (#1e6e3e / #f39200) y no se alineó con la de la plataforma.
- **Descripción de la pauta:** es el nombre de la planilla de origen y viene del seed.
- **Pendientes menores:**
  - menú «Exportar» del detalle de registro, que necesita un `ExportButton` dentro de un menú;
  - `StageTabs` con parámetro configurable;
  - columna «Actividad» fija en la matriz en móvil.
