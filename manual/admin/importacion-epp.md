# Importacion de EPP desde Excel

Puedes cargar varios productos EPP de una sola vez subiendo un archivo Excel.
El sistema analiza los datos, los normaliza automaticamente y te permite
revisar cada fila antes de incorporarla al catalogo.

## Requisitos del archivo

- Extension `.xlsx` (no funciona con `.xls` antiguo).
- Maximo 5.000 filas de datos.
- La primera fila debe contener los encabezados (nombres de columna).
- Solo se lee la primera hoja del libro.

## Columnas reconocidas

Puedes usar cualquiera de estos nombres de columna:

| Campo | Nombres aceptados |
|-------|-------------------|
| **Nombre** | `Nombre`, `Producto` |
| **SKU / Codigo** | `SKU`, `Codigo`, `Cod`, `Codigo interno` |
| **Descripcion** | `Descripcion`, `Detalle` |
| **Proveedor** | `Proveedor` |
| **Precio** | `Precio`, `Valor` |
| **Unidad** | `Unidad` |
| **Categoria** | `Categoria` |
| **Atributos** | `Atributos`, `Atributo` |
| **Talla** | `Talla` |
| **Color** | `Color` |
| **Marca** | `Marca` |
| **Modelo** | `Modelo` |
| **Material** | `Material` |
| **Notas** | `Notas`, `Nota` |

> La columna **Nombre** es obligatoria. Sin ella la importacion falla.

## Ejemplo de archivo

| Nombre | Unidad | Color | Talla | Proveedor | Precio | Marca | Material |
|--------|--------|-------|-------|-----------|--------|-------|----------|
| Casco de seguridad blanco | uni | Blanco | M | Seguridad Ltda. | 15000 | 3M | Policarbonato |
| Guante nitrilo azul talle L | par | Azul | L | ProSafety | 8500 | | Nitrilo |
| Botin seguridad negro talla 42 | par | Negro | 42 | Calzados Seg | 45000 | Bata | Cuero |
| Lente proteccion transparente | unidad | Transparente | | Optica Segura | 3200 | | Policarbonato |
| Chaleco reflectante naranja talle XL | uni | | XL | Seguridad Ltda. | 12800 | | |

## Reglas de normalizacion automatica

El sistema aplica varias reglas automaticas al procesar el archivo. Puedes
ver las correcciones propuestas en la pantalla de revision del lote.

### Unidades de medida

Reconoce estos valores y los normaliza:

| Escrito | Se interpreta como |
|---------|-------------------|
| `uni`, `un`, `unidad` | unidad |
| `par`, `pares` | par |
| `caja` | caja |
| `pack`, `paquete` | paquete |
| `set` | set |
| `juego` | juego |

### Colores

**Desde la columna Color.** Reconoce estos valores:

| Escrito | Normalizado |
|---------|-------------|
| `blanco` | Blanco |
| `negro`, `negra` | Negro |
| `azul` | Azul |
| `azul marino` | Azul marino |
| `rojo`, `roja` | Rojo |
| `amarillo`, `amarilla` | Amarillo |
| `verde` | Verde |
| `gris` | Gris |
| `claro` | Claro |
| `transparente` | Transparente |

**Desde el nombre del producto.** Si la columna Color esta vacia, el sistema
busca palabras de color dentro del nombre. Por ejemplo:

- "Casco de seguridad **blanco**" → detecta `Blanco` y lo limpia del nombre.
- "Guante **azul** talle L" → detecta `Azul` y lo limpia del nombre.

**Multi-color.** Puedes poner varios colores separados por coma:

```
Color: Blanco, Azul, Rojo
```

Esto crea un solo producto con tres variantes de color.

**Conflictos.** Si el color de la columna contradice el color detectado en el
nombre, la fila se marca como bloqueante.

### Tallas

**Desde la columna Talla.** Se usa el valor tal cual, normalizado a
mayusculas.

**Desde el nombre.** Si no hay columna Talla ni Modelo, el sistema busca en
el nombre valores como `XS`, `S`, `M`, `L`, `XL`, `2XL`, `3XL` o numeros de
dos digitos (tallas de calzado, ej: `42`, `43`).

**Multi-talla.** Varias tallas separadas por coma crean variantes:

```
Talla: S, M, L
```

**Tipo de talla.** Si el valor son dos digitos (ej: `42`) se guarda como
"Talla calzado". Si es una letra (ej: `M`, `XL`) se guarda como "Talla".

### Materiales

**Desde la columna Material.** Se usa directamente.

**Desde el nombre.** El sistema busca estas palabras en el nombre:
nitrilo, cabritilla, cuero, policarbonato, algodon.

Ejemplo: "Guante **nitrilo** azul" → material `Nitrilo`.

### Tipo de EPP

Se detecta automaticamente buscando estas palabras en el nombre del producto:

`casco`, `guante`, `lente`, `antiparra`, `botin`, `zapato`, `chaleco`,
`mascarilla`, `respirador`, `arnes`, `protector auditivo`, `buzo`, `traje`,
`pantalon`, `chaqueta`.

Si no se encuentra ninguna, la fila se marca como bloqueante.

### Precios

Acepta formatos chilenos:

| Escrito | Se interpreta como |
|---------|-------------------|
| `15000` | 15000 |
| `$15.000` | 15000 |
| `15.000` | 15000 |
| `15,50` | 15.50 |

### Categoria

Si no se especifica, se asigna "Elementos de Proteccion Personal".

## Flujo de importacion

1. Entra a `Administracion > Productos`.
2. Haz clic en `Importar` y luego `Equipos de proteccion (EPP)`.
3. Selecciona el archivo Excel y haz clic en `Importar Excel`.
4. El sistema analiza el archivo y muestra un resumen del lote.
5. Haz clic en `Revisar lote` para ver cada fila con sus correcciones.
6. Decide que hacer con cada fila: **Crear nuevo**, **Actualizar existente**
   u **Omitir**.
7. Una vez resueltas todas las filas, haz clic en `Confirmar importacion`.

> Para cancelar un lote sin aplicar cambios, usa `Cancelar importacion`.

## Posibles errores

| Problema | Causa | Solucion |
|----------|-------|----------|
| Falta columna Nombre | Ningun encabezado reconocible | Agrega una columna llamada "Nombre" o "Producto" |
| Tipo de EPP no detectado | El nombre no contiene ninguna palabra de la lista | Agrega el tipo al nombre (ej: "Casco ...") |
| Unidad no reconocida | Valor no estandar | Usa "unidad", "par", "caja", "paquete", "set" o "juego" |
| Precio invalido | Formato no interpretable | Usa solo numeros, opcionalmente con $ y puntos |
| Nombre vacio tras normalizar | Solo contenia palabras que se eliminaron | Agrega un nombre descriptivo |
| Archivo ya cargado | Mismo contenido (hash SHA-256) | No se puede importar el mismo archivo dos veces |
| Archivo muy grande | Mas de 5.000 filas | Divide el archivo en partes |
