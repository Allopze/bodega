# QA — TI › Apps del teléfono e Integraciones (2026-11-22)

Rama `feat/ti-apps-terreno`. Diseño en `docs/superpowers/specs/2026-11-22-apps-de-terreno-ti-design.md`
y plan en `docs/superpowers/plans/2026-11-22-apps-de-terreno-ti.md`.

## Alcance

**Pantallas recorridas:**

- `/ti/apps`;
- `/ti/apps/ppa`, `/ti/apps/mantencion` y `/ti/apps/tae`, con el filtro `?estado=atencion`;
- `/ti/apps/bodega` (404);
- `/ti/integraciones` y su filtro `?estado=never`.

**Apps que mandan el aviso:** `/ppa` y `/tae`.

**Anchos:** 1440 px y 390 px.

**No se recorrió:**

- La app del mecánico (`/m/mantencion`) en el navegador. Su aviso está cubierto por pruebas de
  unidad y el upsert con credencial por PGlite.
- Un teléfono real con la app instalada. «Instalada» sólo se probó en unidad (`isStandalone`).
- Producción.

## Entornos

**Navegador:**

- `next dev` propio en :3013 contra `bodega_dev_tiapps`, una copia de `bodega_dev` migrada a 0400.
  `bodega_dev`, la base compartida, no se tocó.
- Datos `QA_` en la copia:
  - 3 enlaces TAE (vigente por vencer, sin uso, revocado);
  - 26 cargas TAE `public_pwa`;
  - 8 avisos sembrados por la ruta real en los cuatro estados;
  - más los avisos reales que mandaron `/ppa` y `/tae` al abrirse.

**E2E:**

- Build de producción (`npm run build`, que también pasa los validadores de rutas de Next) servido
  con `next start` en :3110.
- Base propia `bodega_e2e_tiapps`, ya borrada.

**Segunda ronda, tras la revisión final de la rama:**

- Build de producción con `BODEGA_BUILD_SHA`. El sha quedó incrustado igual en el bundle del cliente
  (PPA, TAE) y en el del servidor (TI › Apps, app del mecánico, respaldos).
- E2E en una base recién reiniciada.
- Recorrido en navegador sobre esa build (`next start`) contra una copia nueva de `bodega_dev`,
  ya borrada.

## Puertas deterministas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| `npm run test:fast` | 1441 archivos / 21716 pruebas OK |
| `npm run test:pglite` | 437 archivos / 5603 pruebas OK. Incluye `module-toggles`, que en `main` fallaba por `/api/apps` sin inventariar |
| `npm run db:verify-migrations` | OK, 401 entradas hasta `0400_marvelous_umar` (regenerada sin `pwa_device_days`, nunca publicada) |
| `npm run build` | OK, con y sin `BODEGA_BUILD_SHA` |
| E2E (chromium, build de producción) | 53 pasan, 1 omitida (`test.skip` previo en `ppa-offline.spec.ts:314`) |

En la primera ronda las puertas detectaron, y se corrigieron:

- 44 errores de tipos en código nuevo;
- un color literal en Integraciones;
- la clasificación pendiente de las consultas nuevas en el registro de uso personal.

**Specs E2E corridos:**

- `ti-apps`, `ti-integraciones` y `ti-modulo`;
- `ppa-flow`, `ppa-formulario` y `ppa-offline`;
- `tae-public-flow` y `tae-ppa-coexistence`.

## Hallazgos

### PRODUCT BUG (corregidos en la rama)

1. **PPA borraba del teléfono evaluaciones sin enviar a los 30 días.** `purgeExpiredPpas` borraba
   por edad sin mirar el estado. Ahora sólo borra las enviadas.
2. **Un PPA que se rendía por falta de red no se volvía a intentar solo.** Quedaba `failed` hasta que
   alguien apretara «Enviar ahora». Ahora vuelve a la fila al haber señal. Un rechazo del servidor
   sigue sin reintentarse.
3. **La versión de la app quedaba como `"dev"` o `"unknown"` en prod.** El deploy no fijaba la variable,
   y eso afectaba a `mant_records.app_version` y a los respaldos. Ahora el deploy pasa el sha como
   build-arg y la hora del build se fija una vez en el `RUN` del Dockerfile.
4. **Columna «Versión» con la hora repetida** («22-11-2026 22:04 · 2026-11-23T01:04:56.101Z»).
   Comparaba texto contra un `timestamptz` que la base devuelve en otro formato. Se encontró en el
   recorrido y se corrigió con prueba.

### Revisión final de la rama (Code Reviewer, Opus): corregido

5. **La ruta pública daba 500, con un evento de Sentry por petición,** ante un año 0 o un `\u0000`.
   Ahora rechaza caracteres de control y fechas anteriores a 2020. Un error de datos de Postgres
   responde 400 y se registra sin el `Error`. Verificado con `curl`: año 0 da 400.
6. **El reintento de PPA sin red no corría nunca:** la sincronización y el botón sólo miraban
   `pending`. Ahora se devuelven a la fila al abrir la app y con el evento `online`, sin bucle, y el
   aviso al trabajador cuenta todo lo no enviado. Lo cubre una prueba con temporizadores falsos.
7. **Escritura sin tope.** Ahora:
   - rechaza peticiones de otro sitio (403) y cuerpos que no son JSON (415);
   - limita a 60 teléfonos nuevos por hora y por IP;
   - purga los teléfonos sin aviso hace 180 días;
   - muestra a lo más 500 teléfonos en el detalle.
   - `pwa_device_days`, que nadie leía, se fue.
8. **«Requiere atención» quedaba encendida casi siempre.** Ahora cuenta como atrasado sólo al
   teléfono que avisó después del build actual y corre otra versión, y deja fuera los accesos sin uso.
9. **Fechas engañosas.** `last_error_at` es cuándo apareció el error y no el último reenvío, y el
   desfase del reloj del teléfono se corrige con `sentAt`.
10. **Credencial del mecánico.** Se revisa como en la sincronización: persona activa, permiso,
    contraseña no cambiada y misma cuenta del teléfono. Ya no refresca `last_used_at`.
11. **Los PPA rechazados por el servidor quedaban para siempre en el teléfono,** con el nombre y el
    RUT. Se borran a los 30 días; lo no enviado, nunca.
12. **El release de Sentry leía la variable vieja.** Ahora usa el sha del build.

### AUTOMATION WARNING

- **Con `next dev`, 2 specs nuevos fallaban de forma consistente** (clic a la tarjeta de PPA y
  `/forbidden` de Integraciones), igual que 2 de `ti-modulo` en frío. Las trazas muestran respuestas
  de 10 a 13 s del servidor de desarrollo compilando bajo carga. Con el build de producción pasan
  todos. No es un defecto del producto.
- **El servidor de desarrollo con 4 GB de heap se reinicia al compilar `/tae`** («approaching the
  used memory threshold»). Eso produjo `ERR_EMPTY_RESPONSE`, `ERR_FAILED` y versiones distintas entre
  páginas en el primer recorrido. Con 7 GB no se reinicia. Es del entorno.

### FUNCTIONAL FINDING (a mirar, no bloquea)

- **«Revocadas o vencidas en 30 días» de Mantención incluye las revocaciones automáticas.** Pasan
  cada vez que un teléfono pide credencial de nuevo, así que la cifra puede verse alta. Ya no
  enciende la insignia de la app.
- **Integraciones consulta las últimas corridas de cada job al cargar,** aunque el desplegable empiece
  cerrado. Hoy son unas 30 consultas chicas.

### COVERAGE GAP

- No hay prueba en un teléfono físico instalado (Android o iOS).
- La app del mecánico no se recorrió en el navegador.
- El freno de 5 minutos con el motor real de 60 s sólo está probado en unidad.

### PASS (verificado)

- **Lista:** las tres tarjetas con insignia «Requiere atención» y conteos coherentes con los datos
  sembrados. La nota al pie dice desde cuándo llegan avisos.
- **Detalle:**
  - tira de 4 cifras accionables;
  - el filtro `?estado=atencion` deja sólo los teléfonos con error o atascados, con chip
    «Mostrando…» y «Ver todos»;
  - tabla con estado, versión e insignia «Atrasada», instalada o navegador, pendientes y último error;
  - demora de llegada con mediana, p90 y % sin señal;
  - uso por persona (Mantención) o por faena;
  - accesos con enlaces vigentes, por vencer, sin uso y revocados;
  - calidad de captura con identificación manual y OCR por semana.
- **Avisos reales desde `/ppa` y `/tae`:**
  - 204;
  - el identificador del teléfono se conserva entre visitas;
  - el enlace TAE se asocia por el hash del token, también uno revocado;
  - ni nombre, ni RUT, ni el token en claro.
- **Integraciones:** agrupadas por módulo, con estado y último error, y filtro por estado. Un rol sin
  `ti:view` termina en «Sin permisos suficientes».
- **Calidad:** sin errores de consola ni respuestas ≥ 400 en el recorrido final, y sin desborde
  horizontal a 390 px.

## Recomendaciones

1. **Tras el deploy, abrir TI › Apps.** Vale «Sin avisos aún» hasta que alguien abra cada app con la
   versión nueva. Los teléfonos con la app vieja en caché empiezan a avisar cuando la actualizan.
2. **Primer deploy desde `scripts/deploy-prod.sh`,** que ahora pasa `BODEGA_BUILD_SHA`. Un build a
   mano sin ese argumento usa la hora del build como versión.
3. **Antes de mergear, actualizar la rama con `main`.** Avanzó con el lote 1 de Mantención y
   ambos tocan `tests/pglite-files.ts` en zonas distintas. Ninguno trae otra migración 0400.
