
# Preguntas para Prevención — Programa PDTP y RE-20 (2026-07-23)

Estamos terminando de dejar automático el registro de actividades del PDTP: la
idea es que cuando una actividad realmente ocurre (una inspección, una
capacitación, una reunión de comité, un simulacro, la investigación de un
incidente), el sistema la marque sola en el programa, sin tener que cargarla dos
veces.

Para que quede bien hecho necesitamos que nos confirmes algunos criterios. Son
decisiones tuyas, de prevención, no técnicas. Abajo van en lenguaje simple.

---

## 1. Actividades que se miden por cobertura de personas

Hay actividades donde lo importante no es "cuántas veces se hizo", sino "a qué
porcentaje de la gente se llegó" (por ejemplo, cubrir al 90% del personal de la
faena).

**Necesitamos que definas:**

- Para esas actividades, ¿cuándo se considera **cumplida**? ¿Solo cuando se
  llega o supera el porcentaje meta (por ej. 90%), o se va contando el avance
  parcial (si voy en 60%, cuenta como 60%)?
- ¿Cuál es el **total de personas** que se toma como referencia (el "padrón")?
  ¿Todos los trabajadores activos de la faena? ¿Solo los de cierto cargo o área?

## 2. Inspecciones que deben cubrir a todo un grupo

Para algunas inspecciones la regla puede ser "todo o nada": si no se cubrió a
todas las personas o puntos que correspondía, no se da por cumplida.

**Necesitamos que definas:**

- En una inspección, ¿qué es "haber cubierto a alguien"? ¿Las personas
  evaluadas en la lista de chequeo? ¿Los puestos o áreas revisadas? ¿Los
  trabajadores presentes ese día? que la persona recibio la difusion o recibio la inspeccion en su totalidad
- ¿Esta regla de "todo o nada" aplica a **todas** las inspecciones del programa,
  o solo a algunas que tú marques? a todas

## 3. Cuando se hace más de lo planificado

Hoy, si en un mes se hace más de lo que estaba planificado para ese mes, el
indicador se topa en 100% (no muestra "150%"). El tope se aplica **sumando todo
el mes junto**: si una actividad se hizo de más, puede tapar que otra del mismo
mes quedó corta.

**Necesitamos que confirmes:**

- ¿Te sirve que el tope sea por el total del mes, o prefieres que cada actividad
  se tope por separado (más exigente, no se compensan entre ellas)? por mes

## 4. Investigación de incidentes (RE-20) — pasos que faltan aclarar

Ya quedaron enganchados los pasos que el sistema puede marcar solo: aviso del
evento, informe preliminar (3h), declaraciones (24h), DIAT (24h), investigación
definitiva (72h), seguimiento quincenal de medidas, cierre del expediente y
difusión del ONE PAGE (24h).

**Nos falta que aclares dos pasos:**

- La **difusión en los turnos** y la **difusión de las medidas correctivas
  (48h)**: ¿desde qué registro se dan por hechas? Hoy no tienen un momento
  claro en el flujo para marcarse solas. prevencionista de faena marca como completado ysupervisor de faena confirma
- La **difusión del ONE PAGE (24h)** y la **difusión de medidas correctivas
  (48h)**: ¿son el mismo momento/difusión, o son dos difusiones distintas?
- son dos difusiones distintas

---

## Nota aparte (para el equipo técnico, no para Prevención)

Quedan pruebas automáticas contra la base de datos real que no se corrieron
porque borran y recrean datos. Se necesita una base de prueba desechable
dedicada para poder ejecutarlas y validar los cambios antes de subir a
producción.

---

## Para tu tranquilidad: qué ya quedó arreglado

Ya corregimos y dejamos funcionando: el registro automático de actividades
espera a que el evento quede realmente guardado antes de marcarse (evita marcas
"fantasma"); las exclusiones de actividades por faena vuelven a exigir un motivo
escrito; los pasos de la investigación de incidentes que faltaban por enganchar
ya quedaron conectados; y una actividad marcada como "con evidencia" solo se
cuenta así cuando hay un archivo o enlace real, no un simple texto.
