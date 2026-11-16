# Auditoría de estándares CHR y VOGE 180

## Alcance y seguridad

Esta revisión se hizo sobre los archivos Excel suministrados. No se importaron tareas en producción, no se cargaron catálogos en producción y no se desplegó Railway. Los cambios permanecen en la rama `feature/estandares-chr-voge-180`.

## CHR

El lector actual reconoce las hojas con encabezados compatibles:

- `VELEZ`: 36 filas de referencias y 36 imágenes incrustadas.
- `BRYAN`: 19 filas de referencias y 19 imágenes incrustadas.
- `ARLEY`: 30 filas de referencias y 30 imágenes incrustadas.
- También reconoce `LADO IZQUIERDO`, `FINAL DE LINEA` y `LADO DER` como hojas de puestos/resumen.

Las hojas nominadas se priorizan antes que las hojas de puestos, y el importador deduplica por EAN + puesto. El catálogo CHR requiere además `numeroReferencia` numérico y el puesto normalizado. Las imágenes de estas hojas están en columnas de galería (K en adelante), no dentro de la fila de la tabla; por tanto, el conteo de imágenes por hoja no prueba por sí solo la asociación de cada imagen con una referencia. No se debe construir el ZIP definitivo hasta confirmar visualmente la secuencia de cada grupo de fotos.

## VOGE 180

El lector reconoce encabezados de 43 hojas, incluidas `BOM`, hojas de puestos, `Carro Canasta`, `Kitting 02`, `PRE01` a `PRE27` y `Pre28` a `Pre35`. Las hojas de puesto se leen antes que `BOM`; las repeticiones idénticas se deduplican por EAN + puesto.

El libro no define un lote base numérico uniforme en los encabezados de las hojas de VOGE 180. No se debe asignar una cantidad de lote por inferencia; se conserva la cantidad de la fila cuando exista y, si no, la cantidad unitaria leída por el importador.

La revisión de imágenes encontró hojas con más fotos grandes que filas de referencia (por ejemplo, `19 Izquierdo`, `PRE08`, `PRE11`, `PRE14`, `PRE17` y `PRE18`), y `Pre35` tiene menos fotos grandes que filas. En otras hojas, varias fotos están ancladas a la misma celda o fila. Por ello no es seguro asignar fotos automáticamente solo por orden de archivo o proximidad de ancla. Se deben conservar las fotos sobrantes como complementarias únicamente después de validar a qué referencia pertenecen; las referencias sin foto deben quedar explícitamente pendientes.

## Próximos pasos antes de publicar

1. Validar visualmente la secuencia de fotos de las tres hojas CHR.
2. Resolver las asociaciones adicionales y faltantes de VOGE 180 contra EAN + puesto.
3. Generar los ZIP con `manifest.json` y fotos WebP, validando el límite de 15 MB por paquete.
4. Probar la vista previa del Excel y el catálogo en un entorno de prueba.
5. Solicitar autorización explícita antes de cualquier escritura de estándares o fotos en producción.
