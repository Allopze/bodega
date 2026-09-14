# Capítulo 06: Inspecciones en Terreno y Digitalización por Foto OCR

> **Marco Normativo:** Decreto Supremo 44 (DS 44), Artículos 8 y 21 (Control Operacional e Inspecciones de Seguridad).  
> **Ruta en Plataforma:** Menú > Cumplimiento del programa > **Inspecciones** (`/prevencion/inspecciones`).  
> **Actividades PDTP Asociadas:** N° 10, 24, 25, 26, 27, 29, 33, 34, 39, 40, 41, 64 y 65.

---

## 1. El Módulo de Inspecciones: Dos Formas de Operar

Las inspecciones de seguridad en terreno son la principal fuente de evidencia preventiva. En CHOME existen dos formas de registrar una inspección:

```
                      MÓDULO DE INSPECCIONES
                                │
        ┌───────────────────────┴───────────────────────┐
        ▼                                               ▼
1. VÍA DIGITAL INTERACTIVA                  2. INGESTA POR FOTO OCR
   (Tablet o Teléfono Móvil)                   (Planillas Físicas de Papel)
   Extintores, Contenedores,                  Report de Uso Diario de Equipos
   Herramientas, Áreas y OPT.                 llenado a mano por los conductores.
```

---

## 2. Vía 1: Ejecución Digital Interactiva (Paso a Paso)

Ideal para cuando el Prevencionista o Supervisor recorre la faena con una tablet o teléfono celular:

```
[Ir a /prevencion/inspecciones]
              │
              ▼
[Presionar "Nueva inspección"]
              │
              ▼
1. Elegir Faena y Plantilla (ej. Extintores, Áreas, Taller)
2. Responder ítem por ítem: Cumple / No Cumple / No Aplica
3. Si marcas "No Cumple": Foto Obligatoria + Derivar a CAPA
4. Firmar y Enviar a Revisión
```

### Paso 1: Iniciar la Inspección
1. Entra a `/prevencion/inspecciones`.
2. Haz clic en **"Nueva inspección"**.
3. Selecciona la **Faena** y el **Instrumento/Plantilla** correspondiente (ej. *Inspección mensual de extintores*, *Inspección de orden y aseo de áreas*).
4. El sistema abrirá la pauta digital con todas las preguntas normadas.

### Paso 2: Evaluación Ítem por Ítem
Por cada punto a inspeccionar, selecciona una de las siguientes opciones:
*   🟢 **Cumple:** La condición física o equipo está en óptimo estado.
*   🔴 **No cumple (Hallazgo):** Existe una desviación o peligro en terreno.
*   ⚪ **No aplica:** La pregunta no corresponde al área o equipo revisado.
*   🚨 **Riesgo Crítico:** Marca esta casilla si el hallazgo representa una condición de peligro inminente de accidente grave.

### Paso 3: Registro de Hallazgos y Fotografías
Si marcas **"No cumple"**, la plataforma te exigirá de inmediato:
1. **Descripción clara:** Detalla qué falla (ej. *Extintor N° 14 en sector romana con manómetro despresurizado y sin sello de seguridad*).
2. **Fotografía de respaldo:** Presiona el botón de la cámara para capturar la foto en el momento o sube la imagen desde tu galería.
3. **Derivación a Acción Correctiva (CAPA):** Puedes activar la casilla *"Generar acción correctiva inmediata"* asignando un responsable y fecha límite para corregirlo (ver Capítulo 13).

### Paso 4: Finalizar la Ejecución
Presiona **"Finalizar y enviar a revisión"**. La inspección pasará al estado `pendiente de revisión`.

---

## 3. Vía 2: Digitalización de Planillas Físicas por Foto (OCR)

En la operación de transporte y maquinaria, **los conductores y operadores de grúa llenan diariamente el Report de Uso Diario en una hoja de papel autocopiante**. 

Para evitar que el equipo de faena pierda horas transcribiendo a mano cada reporte al computador, la plataforma cuenta con un sistema de **visión artificial y reconocimiento de marcas (OCR)**:

```
[Hoja Física Firmada por el Conductor]
                 │
                 ▼
[Foto Nítida desde Celular o Tablet]
                 │
                 ▼
[Abrir la Inspección en /prevencion/inspecciones/[runId]]
                 │
                 ▼
[Cargar foto en panel "Subir foto de planilla física"]
                 │
                 ▼
[El motor OCR detecta marcas y pre-llena las casillas]
                 │
                 ▼
[Verificación rápida del Jefe de Terreno / PRF y Cierre]
```

### ¿Quién sube la planilla física? (Permiso `inspections:ingest`)
Por flujo operacional, la planilla física la recopila y sube el **Jefe de Terreno** o el **Administrador de Contrato** (quienes poseen el permiso `prevention:inspections:ingest`), transcribiendo y respaldando el reporte del operador que no cuenta con usuario en la plataforma. El Prevencionista de Faena participa en la revisión y cierre.

### Cómo Tomar la Fotografía Correctamente:
1. Coloca la hoja del reporte sobre una superficie plana y bien iluminada (evita sombras fuertes de manos o techos).
2. Asegúrate de que las 4 esquinas del formulario físico queden visibles dentro de la cámara.
3. Evita que la hoja esté arrugada o doblada.

### Subida y Validación en la Plataforma:
1. En `/prevencion/inspecciones`, abre la inspección correspondiente al equipo o vehículo (`/prevencion/inspecciones/[runId]`).
2. En la parte superior de la pauta verás el panel **"Subir foto de planilla física"**.
3. Sube la fotografía. El sistema llamará al servicio de visión artificial:
   * Verás la imagen original al lado de los datos leídos digitalmente.
   * Las casillas marcadas con cruz por el conductor se reconocerán automáticamente como *Cumple* o *No cumple*.
   * Si el sistema tiene duda sobre alguna casilla por trazo suave, te la resaltará en amarillo para que la confirmes con un solo clic.
4. Presiona **"Confirmar y Guardar Reporte"**.
5. **Impacto Inmediato:** Se acredita automáticamente la actividad **N° 26** del PDTP (*Revisión y firma del report de uso diario de equipos*).

---

## 4. Modo Offline en Terreno (`chome-prevention-offline`)

> [!TIP]
> **Operación sin Conexión en Terreno:**  
> Si estás en un sector de la faena sin cobertura celular:
> 1. Abre la inspección en tu tablet o teléfono mientras tengas señal en la oficina o garita.
> 2. Realiza la inspección en terreno sin conexión: la plataforma guardará cada respuesta y foto en la base local del dispositivo (`chome-prevention-offline`).
> 3. Al volver a una zona con señal Wi-Fi o 4G, el sistema sincronizará automáticamente las respuestas con el servidor sin perder ningún dato ni la hora real de ejecución.

---

## 5. El Cierre de la Inspección y la Segregación de Funciones

> [!NOTE]
> **Regla de Segregación Técnica:**  
> Quien ejecuta la inspección en terreno **no puede cerrarla sobre sí mismo**.
> *   Si tú (Prevencionista de Faena) realizaste la inspección, la revisión y cierre formal la realiza el Jefe de Terreno o la Jefa de Prevención.
> *   Si la inspección la ejecutó el Supervisor de Terreno, **tú como Prevencionista eres quien revisa, valida los hallazgos y cierra el expediente**.

### Cómo Cerrar una Inspección:
1. Ingresa a `/prevencion/inspecciones` y filtra por estado `pendiente de revisión`.
2. Abre la inspección completada por tu colega.
3. Revisa los hallazgos, las fotos y las acciones correctivas generadas.
4. Si todo está correcto, haz clic en **"Aprobar y Cerrar Inspección"**.
5. Al cerrarse, el cumplimiento se transfiere automáticamente a la celda de la actividad del PDTP correspondiente.
