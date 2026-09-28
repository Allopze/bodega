# Recorrido de exploración — Prevención (`/docs:explore`)

**Fecha:** 2026-09-27 · **Entorno:** `next dev` en `http://localhost:3001`, base `bodega_dev`
(335/335 migraciones) · **Sesión:** `playwright/.auth/monkeytest.json` · **Navegador:**
Chromium de `@playwright/test`, 1440×900 y 390×844.

**Modo:** no mutante. Solo se abrieron disparadores de diálogo (`aria-haspopup="dialog"`) y se
cerraron con Escape; ningún formulario se envió. La validación se leyó con `checkValidity()`.
Se registraron **0** server actions disparadas.

**Propósito:** contrastar en la aplicación los estados de UI que `/docs:discover prevention
--deep` dedujo del código (`docs/.knowledge/modules/prevention/`). No es una auditoría de
liberación.

## Alcance

| | |
|---|---|
| Rutas de `routes.json` (sin impresión) | 70 |
| Rutas estáticas visitadas | 46 → 43 con 200, 3 con 404 |
| Rutas de detalle visitadas | 7 de 26, con IDs reales de `bodega_dev` |
| Diálogos abiertos | 36 propios de la página (más la campana del shell en cada una) |
| Medición de desborde a 390 px | 50 páginas |

**100 % de las rutas estáticas descubiertas se procesó.** Eso no cubre los estados con datos:
`bodega_dev` no tiene solicitudes de cambio, CAPA, permisos, solicitudes de privacidad,
requisitos legales, controles MIPER, comités CPHS ni grupos de exposición.

## PASS (verificado)

- Las 43 rutas estáticas vigentes responden 200, sin límite de error, sin errores de consola
  y sin requests fallidos propios.
- Los 36 diálogos abren con título y cierran con Escape.
- Ningún diálogo de alta usa `<input type="date">` nativo, salvo el que se indica abajo.
- Sin desborde horizontal del documento a 390 px en las 50 páginas medidas.
- El estado vacío de Gestión del cambio cumple A4: dice qué falta, por qué importa y ofrece
  un CTA real ("Nuevo cambio").

## UX FINDING

1. **Acciones de alta fuera del `PageHeader`** (regla de layout 5 / A3). El botón está en una
   barra dentro del contenido, no en el TopBar:
   - `/prevencion/gestion-cambio` "Nuevo cambio" (`shots/prevencion_gestion-cambio.png`).
   - `/prevencion/cphs` "Nuevo comité".
   - `/prevencion/emergencias` "Nuevo plan".
   - `/prevencion/higiene` "Nuevo agente".
   - `/prevencion/permisos` "Nuevo tipo".
   - `/prevencion/miper/mapa` "Cargar plano".

   Sí están en el TopBar: CAPA, documentación, inspecciones, programación, plantillas, MIPER,
   privacidad y requisitos legales.
2. **KPI vacíos con "0" pelado** (A1). En `/prevencion/gestion-cambio` los cuatro tiles
   muestran `0` sin acción para dejar de estarlo.

## INCONSISTENCY

3. **Fecha nativa** (A6). "Programar simulacro", en el detalle del plan de emergencia, usa
   `<input type="date">`. Es el único de los 36 diálogos que lo hace.

## COVERAGE GAP

4. **Sin datos en `bodega_dev`, los hallazgos estáticos de mayor severidad siguen sin
   reproducirse:**
   - "Aprobar cambio" siempre deshabilitado. Lo sostiene el código (`prevention-change.ts:352,429`,
     `change-detail.tsx:273`); no hay solicitud que abrir.
   - Documentos sensibles archivables o enlazables sin acceso de lectura.
   - Bloqueo del cierre de un incidente fatal o grave rebajado en triage.
   - El toast de "No aplica" en capacitación exige enviar el diálogo.
5. **19 rutas de detalle sin recorrer** por falta de registros.
6. **Mensajes de validación de servidor y Zod no capturados**: requieren enviar. Los requeridos
   nativos sí quedan en `validation-messages.json`: 15 diálogos.
7. **Pendiente:** navegación por teclado, WebKit, otros roles y estados con datos.

## AUTOMATION WARNING

8. **Avatar externo.** `api.dicebear.com` falla en las 58 cargas porque el sandbox no tiene
   internet. No es un defecto del producto.
9. **Chrome del MCP.** El navegador del MCP de Playwright no arranca: exige Chrome en
   `/opt/google/chrome`. Se usó el Chromium del repo.
10. **Volcado desactualizado.** Tres 404 corresponden a rutas eliminadas que el volcado del
    2026-09-14 aún lista (`/prevencion/capacitacion/{brechas,catalogo,competencias}`); no son
    enlaces rotos de la aplicación.

## Incidente del entorno (resuelto antes del recorrido)

Todas las rutas autenticadas daban 500. `bodega_dev` tenía 328/335 migraciones y el shell
consulta `worksites.deactivated_at` (migración 0332). El usuario aplicó las migraciones y, tras
eso, el recorrido corrió limpio.

## Evidencia

- `docs/.knowledge/modules/prevention/explore/` (no versionado):
  - `interactions.json`
  - `validation-messages.json`
  - `api-calls.json`
  - `shots/` (capturas de página, diálogo y móvil)
- Los 43 `ui-states/*.json` estáticos llevan ahora un bloque `runtime_observation`.

## Recomendación

Sembrar en `bodega_dev` un juego `QA_` mínimo y repetir el recorrido con envíos:

- una solicitud de cambio abierta;
- una CAPA;
- un documento `sensible`;
- un incidente grave.

Eso confirma o descarta los cuatro candidatos de mayor severidad de
`docs/.knowledge/_meta/warnings.json`.
