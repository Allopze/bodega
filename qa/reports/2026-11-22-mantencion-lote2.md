# Mantención: segunda tanda de arreglos — app del mecánico (2026-11-22)

Rama `fix/mantencion-auditoria-lote2`, sobre `main` `5615b5cc3` (la primera tanda ya fusionada). Contiene el informe de la auditoría (`mantencion-auditoria-2026-11-22.md`, ahora versionado) y los arreglos de la app del mecánico (`/m/mantencion`). Sin migraciones ni permisos nuevos. El único cambio de servidor es un `HEAD` sin datos en `/api/mantencion/dispositivo`.

## Qué cambió

| Hallazgo | Cambio | Commit |
|---|---|---|
| APPN-1 (P1) | Un registro enviado deja de contar en el teléfono en cuanto el catálogo lo refleja o lo marca anulado. Antes contaba 48 h y bloqueaba la lectura corregida justo en «Crear registro corregido». Se compara la hora de recepción del **servidor** (`receivedAt`) con la del catálogo, también del servidor. Aplica a la ficha, a «Le toca», al aviso de duplicado y a las OT. | `8a4845284` |
| APPN-2 | Un equipo cuya salida registró la web ya no reaparece «en taller». | `8a4845284` |
| APP-5 | Los rechazos de taller, respuestas y operaciones de OT se ven en «No se pudo enviar» y se descartan con «Entendido». | `8a4845284` |
| APP-1 (P1) | «Fresco» ya no usa el reloj del teléfono. Se mide entre la hora en que el servidor armó la página y la cabecera `Date` de un `HEAD` sin caché, con una ventana de 10 min. Sin respuesta no decide, como antes. Un 5xx muestra «la plataforma no respondió bien», no «Necesitas señal». | `b02ab55c7`, `5825cb71c` |
| APPN-5 | Un 4xx que no es la respuesta propia del servidor (`{ok:false, code}`), como un 404 o un 413 de un proxy, se reintenta en vez de rechazar el registro para siempre. | `b02ab55c7` |
| APP-7 | El service worker espera la red 4,5 s como máximo y luego abre la app guardada. El HTML nuevo se guarda igual cuando llega. | `b02ab55c7` |
| APP-2 (P1) | Cambiar de equipo con fotos pide confirmar: «descarta las N fotos (llevan el sello de X)». Al confirmar las suelta y los pasos vuelven a «Falta». | `1bd3bfd95` |
| APP-3 (P1) | Un conductor, aceite, tipo de trabajo, mecánico o taller desactivado después de elegirlo se ve «Ya no disponible · quitar», y la validación dice qué quitar antes de firmar. | `1bd3bfd95` |
| APPN-3 | Las hojas con algo escrito preguntan «¿Descartar lo que escribiste?» al tocar el fondo, al pulsar Esc o al usar Volver/Cancelar. | `dd4431306` |
| APP-8 | El aviso flotante no recibe toques y queda sobre el pie. | `dd4431306` |

## Puertas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | OK, tras corregir un tipo en una prueba |
| `npm run lint` | OK |
| `npm run test:fast` | **21.785 pasan, 0 fallas** |
| `test:pglite` | No se corrió completa: la tanda no toca servicios de servidor. Se corrió `mantencion-sync-http-pglite` (14/14), que cubre el `HEAD` nuevo. |
| Hook de commit | OK en cada commit |

## Navegador

Pruebas en `next dev --webpack` de la rama, en :3003 contra `bodega_dev`, a 390×844 y con el service worker activo. Usuario QA (jefe de mantención).

- **APP-1:** con el reloj del teléfono adelantado 1 h (`page.clock`), la app llega a «Define tu PIN»: no muestra «Necesitas señal». El `HEAD` de hora responde 204 con `Date`.
- **Hallazgo durante el recorrido:** en la primera versión el `HEAD` respondía 405, y el navegador lo anotaba como error de consola en cada arranque. Eso habría hecho fallar la E2E de la app, que exige consola limpia. Se corrigió en `5825cb71c` y el recorrido final quedó sin errores de consola.
- **APP-2:** una correctiva de KCH-131 con 2 fotos. En «Revisar», «Cambiar» la lectura y luego «Cambiar equipo» a CR-52 muestra «¿Cambiar de equipo? Cambiar de equipo descarta las 2 fotos (llevan el sello de KCH-131). Tendrás que sacarlas de nuevo con CR-52», con las opciones «Dejar el equipo» y «Cambiar y descartar». No se firmó nada.
- **APP-8:** `.toast` con `pointer-events: none`.
- **Limpieza:** las 4 credenciales de dispositivo que el recorrido creó para el usuario QA en `bodega_dev` se revocaron desde «Dispositivos». Revocar cierra las sesiones web de la persona, como está diseñado.

## E2E

Corrida aislada sobre el worktree de la rama:

- base `bodega_e2e_lote1` en el contenedor `bodega-e2e-postgres` y puerto 3150, con una config temporal sin versionar;
- un worker, build de producción;
- specs `mantencion-1-app`, `mantencion-5-ot`, `mantencion-2-jefatura` y `mantencion-4-permisos`.

**Resultado: 34 de 34 pasan** (8,3 min), con la consola limpia que exige `mantencion-1-app`.

## Riesgos y brechas

- **Sin teléfono real:** el botón Atrás de Android (APP-10), el teclado sobre la hoja (APPN-14) y el comportamiento del service worker en un dispositivo no se probaron.
- **APP-3 en navegador:** no se reprodujo, porque exige desactivar un conductor en el catálogo con un borrador abierto. Está cubierto por pruebas unitarias y de render.
- **APPN-3 en navegador:** no se reprodujo. Las hojas con formulario de OT exigen una OT asignada al usuario. Está cubierto por 14 pruebas de render.
- **Caso borde de APP-1:** si el service worker sirve el shell guardado tras 4,5 s, y ese shell tiene menos de 10 min y es de otra cuenta, contaría como fresco. Aun así, la credencial y la cuenta activa salen de lo que responde el servidor según la cookie, no del HTML.
- **Pendiente:** `accounts.ts` (`credentialExpired`, `canSync`) compara el vencimiento del servidor con el reloj del teléfono. Las credenciales duran 30 días, así que el efecto es menor. Queda para otra pasada.
- **Fuera de esta tanda:**
  - APP-4: `needs_login` eterno tras un 403.
  - APP-6, APP-9 y APP-10..23.
  - APPN-4: teléfono compartido.
  - APPN-6..14.
- **Tercera tanda, pendiente:** traslado. La OT y la hoja de vida siguen al equipo y la conformidad la da la faena de destino.
