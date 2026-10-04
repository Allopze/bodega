# Protocolo: prueba de comprensión de MIPER con usuarios

Sirve para ejecutar F0/F7 del [plan de mejora UI/UX](../../PLAN_MEJORA_UIUX_MIPER_2026-10-03.md) (§7). Responde una sola pregunta: **¿alguien que no conoce MIPER entiende la pantalla y empieza su trabajo sin que otra persona le explique cómo está organizada?**

Duración: 25–30 minutos por persona. Moderador y anotador pueden ser la misma persona.

## Participantes (5)

| # | Perfil | Usuario de QA |
|---|---|---|
| 1 | Prevencionista que **no** ha usado MIPER | rol prevencionista de faena |
| 2 | Prevencionista que la usa habitualmente | rol prevencionista de faena |
| 3 | Jefa de Prevención (revisión técnica) | rol revisor |
| 4 | Legal y RRHH (aprobación) | rol aprobador |
| 5 | Responsable de ejecutar actividades del programa | rol responsable |

No registres nombres ni datos personales: sólo el número y el perfil.

## Preparación

- **Entorno de QA o staging, nunca producción.** Crear los datos con prefijo `QA_`.
- Desktop, Chrome, ventana de 1440×900 (repetir con al menos una persona a 1280×800).
- Datos mínimos: una matriz en borrador con riesgos incompletos, una en revisión técnica con una observación abierta y una vigente con programa poblado (actividades con ejecuciones vencidas y próximas).
- Sesión iniciada con el usuario del perfil, en la portada `/prevencion/miper`.

## Guion del moderador

Lee esto tal cual al empezar:

> «No estamos evaluándote a ti, sino a la pantalla. Piensa en voz alta: di qué buscas y qué esperas que pase. No voy a ayudarte; si te quedas atascado, dilo y pasamos a lo siguiente.»

Durante la prueba: no señales, no completes frases, no corrijas. Si preguntan «¿esto es lo que tengo que hacer?», responde «¿qué harías tú?».

## Parte 1 — Prueba de 5 segundos (perfiles 1, 2, 3)

Muestra cada pantalla 5 segundos, ocúltala y pregunta:

**Portada** (`/prevencion/miper`)
1. ¿Qué se gestiona en esta pantalla?
2. ¿Qué faena tenía trabajo pendiente y cuál era?
3. ¿Dónde harías clic para continuar ese trabajo?

**Inicio de una matriz en borrador** (`?tab=resumen`)
4. ¿De qué faena y período es?
5. ¿En qué estado está el documento?
6. ¿Qué es lo primero que te pide hacer?

Correcto = responde lo esencial sin adivinar. Anota la respuesta textual.

## Parte 2 — Tareas

Lee cada tarea en voz alta. Mide si la completa **sin ayuda** y anota dónde dudó.

| Perfil | Tarea |
|---|---|
| 1, 2 | En la matriz en borrador: agrega una tarea nueva («QA_Limpieza de pasillo»), identifica un peligro, evalúalo y agrega una medida de control. |
| 1, 2 | Encuentra qué le falta al documento para enviarlo a revisión, y dónde se envía. |
| 3 | En la matriz en revisión: encuentra qué riesgos te toca revisar y registra una observación sobre uno. |
| 4 | Encuentra qué versión vas a aprobar y qué cambió respecto de la vigente. |
| 5 | En la matriz vigente: encuentra tus actividades vencidas y registra una ejecución con evidencia. |

## Parte 3 — Estados distintos (todos)

Pide que expliquen con sus palabras, señalando dónde lo ven:

- Un riesgo «completo».
- Un riesgo «Importante».
- Un control «verificado».
- Una ejecución «realizada».

**Falla** si alguien infiere que completar los datos de un riesgo equivale a que esté controlado o que la medida se haya cumplido.

## Parte 4 — Navegación (perfiles 1 y 2)

Desde un riesgo abierto: cambia de paso, vuelve a la tarea, recarga la página y usa Atrás. Anota si en algún momento se pierden filtros, scroll o datos, o si hay un salto inesperado.

## Criterios de salida (§7 del plan)

| Criterio | Meta |
|---|---|
| Comprensión inicial (Parte 1) | Al menos 4 de 5 responden correctamente |
| Recorrido básico (Parte 2, perfiles 1 y 2 más el de su rol) | Al menos 4 de 5 completan sin ayuda |
| Estados distintos (Parte 3) | Nadie confunde completar datos con controlar o cumplir |
| Navegación (Parte 4) | Sin pérdidas de contexto ni saltos inesperados |

Cinco personas no son una muestra estadística: sirven para encontrar los problemas grandes, no para medir porcentajes poblacionales.

## Hoja de registro

Copia esta tabla por participante:

| Ítem | ¿Correcto / sin ayuda? | Respuesta o dónde dudó | Severidad (S1–S4) |
|---|---|---|---|
| P1.1 qué se gestiona | | | |
| P1.2 faena con pendiente | | | |
| P1.3 dónde continuar | | | |
| P1.4 faena y período | | | |
| P1.5 estado | | | |
| P1.6 primer paso | | | |
| Tarea 1 | | | |
| Tarea 2 | | | |
| Estados: completo / Importante / verificado / realizada | | | |
| Navegación | | | |

## Después

Deja el resultado en `qa/reports/AAAA-MM-DD-miper-prueba-usuarios.md` y actualiza `qa/reports/latest.md`. Clasifica cada hallazgo como en [AGENTS.md](../../AGENTS.md): UX FINDING, INCONSISTENCY o PRODUCT BUG (con evidencia), e indica qué criterios de salida se cumplieron y cuáles no.
