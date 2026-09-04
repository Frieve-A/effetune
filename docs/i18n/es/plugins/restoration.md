---
title: "Plugins de restauración - EffeTune"
description: "Plugins de restauración para clics, picos recortados, zumbido eléctrico y ruido de fondo constante."
lang: es
---

# Plugins de restauración

Los plugins de restauración reducen problemas no deseados de una grabación sin perder el placer de escuchar la música.

## Lista de plugins

- [Click Remover](#click-remover) - Repara clics, crujidos, chasquidos y cortes breves
- [Clip Restorer](#clip-restorer) - Restaura picos aplanados por recorte duro
- [Hum Remover](#hum-remover) - Elimina el zumbido eléctrico constante y sus armónicos
- [Noise Reduction](#noise-reduction) - Reduce el siseo y zumbido de fondo constantes sin afectar la música

## Click Remover

Click Remover repara defectos breves y aislados, como crujidos de discos, chasquidos, clics y pequeños cortes. Úselo para interrupciones ocasionales, no para siseo o zumbido constantes.

### Guía de escucha

1. Empiece con **Sensitivity** al 50 % y **Max Repair Length** en 1 ms.
2. Aumente **Sensitivity** poco a poco hasta que los clics molesten menos. Si se suavizan ataques musicales como los de la batería, vuelva a bajarla.
3. Aumente **Max Repair Length** solo para chasquidos o cortes más largos; manténgalo corto para el crujido normal.
4. Mientras suena el pasaje afectado, compruebe **REPAIRS/S** y compare con el efecto desactivado antes de conservar un ajuste más fuerte.

### Parámetros

- **Sensitivity** (0–100 %, inicial 50 %) controla con qué facilidad un cambio corto se trata como defecto. Un valor alto repara más clics sospechosos; uno bajo es más prudente y conserva mejor los ataques musicales.
- **Max Repair Length** (0,1–2 ms, inicial 1 ms) limita la duración de cada reparación. Auméntelo para chasquidos o cortes algo más largos y redúzcalo para crujidos breves.

### Cómo leer la pantalla

**REPAIRS/S** muestra el número reciente de reparaciones por segundo. Cerca de cero significa que no se están reparando defectos breves. Un valor alto y continuo con música normal indica que debe bajar **Sensitivity** o **Max Repair Length**.

## Clip Restorer

Clip Restorer reconstruye picos aplanados por recorte digital duro. Sirve para grabaciones con distorsión de picos claramente plana, pero no puede recuperar todos los detalles perdidos antes de llegar a EffeTune.

### Guía de escucha

1. Empiece con **Threshold** en -0,10 dB y **Output Gain** en -3 dB.
2. Baje ligeramente **Threshold** si quedan picos recortados claros. Súbalo hacia 0 dB si modifica sonidos fuertes y sostenidos sin necesidad.
3. Cuando sea posible, mantenga **Output Gain** por debajo de 0 dB: los picos restaurados pueden superar los picos originales aplanados.
4. Consulte **RESTORED** durante una sección dañada y compare con el efecto desactivado para elegir el ajuste menos invasivo.

### Parámetros

- **Threshold** (-18–0 dB, inicial -0,10 dB) fija el nivel tratado como pico recortado. Cerca de 0 dB solo actúa sobre picos casi a escala completa; un valor menor incluye recorte menos evidente, pero puede afectar más material intenso.
- **Output Gain** (-12–0 dB, inicial -3 dB) fija el nivel de salida tras restaurar. Súbalo hacia 0 dB para más volumen o bájelo para dejar más margen a los picos restaurados.

### Cómo leer la pantalla

**RESTORED** muestra el porcentaje reciente de muestras reparadas como picos recortados. Un valor pequeño puede ser normal, pues el recorte suele ser breve. Si se mantiene alto en material que no parece recortado, suba **Threshold**.

## Hum Remover

Hum Remover reduce zumbido eléctrico constante de red y sus armónicos, por ejemplo de un tocadiscos, cable o problema de alimentación. Es para un tono continuo, no para ruido de fondo general.

### Guía de escucha

1. Empiece con **Frequency** en **Auto**, **Harmonics** en 8 y **Tracking Speed** en 50 %.
2. Si conoce la frecuencia de red de la grabación, elija **50 Hz** o **60 Hz**. Si no, deje **Auto** y revise **FUNDAMENTAL**.
3. Suba **Harmonics** si queda zumbido por encima de la fundamental; bájelo si la música pierde cuerpo o detalle.
4. Suba **Tracking Speed** si el tono cambia lentamente de altura; bájelo para un zumbido estable. Si un bajo sostenido coincide exactamente con un armónico, reduzca **Harmonics**.

### Parámetros

- **Frequency** (**Auto**, **50 Hz** o **60 Hz**; inicial **Auto**) selecciona la fundamental. **Auto** sigue un zumbido de red detectado; elija un valor fijo si conoce su frecuencia.
- **Harmonics** (1–64, inicial 8) elige cuántos múltiplos de la fundamental se eliminan. Valores altos limpian más zumbido; valores bajos preservan más música cerca de los armónicos altos. El control deslizante usa una escala logarítmica para ofrecer un ajuste más preciso en los valores bajos.
- **Tracking Speed** (0–100 %, inicial 50 %) controla la rapidez con que el seguimiento automático responde a un zumbido cambiante. Un valor alto sigue cambios más rápido; uno bajo conviene a un zumbido estable.

### Cómo leer la pantalla

**FUNDAMENTAL** muestra la frecuencia que el efecto trata en ese momento. **REMOVED** muestra en dBFS el nivel del componente eliminado: más cerca de 0 dBFS significa más zumbido eliminado; un valor muy bajo, como -140 dBFS, significa poco o ninguno.

## Noise Reduction

Noise Reduction reduce el ruido de fondo continuo, como el siseo de cinta, el ruido de equipos o el ruido de sala. Úselo cuando haya una capa de ruido constante detrás de la música. Funciona mejor con ruido que permanece entre las notas; no está diseñado para eliminar clics aislados, sonidos de fondo cambiantes ni otra música de la grabación.

### Guía de escucha

1. Empiece con los valores iniciales: **Reduction** 12 dB, **Sensitivity** 0 dB, **Smoothing** 50%, **Treble Care** 50% y **Mix** 100%.
2. Suba **Reduction** poco a poco hasta que las partes silenciosas estén más limpias. Bájelo si voces, platillos o ambiente empiezan a sonar poco naturales.
3. Para un siseo continuo evidente, suba un poco **Sensitivity**; para música ya limpia, bájelo.
4. Si la reducción parece fluctuar o cambia el color del sonido, suba **Smoothing**. Si la música se suaviza demasiado, baje **Smoothing** o **Reduction**.
5. Compare con el efecto desactivado y use **Mix** para conservar parte del sonido original si resulta más natural.

### Parámetros

- **Reduction** (0–24 dB, inicial 12 dB) establece la reducción máxima de ruido de fondo. Un valor bajo es más suave; uno alto reduce más ruido, pero también puede ocultar detalles tenues. Para ruido ligero, empiece entre 6 y 12 dB.
- **Sensitivity** (-12–+12 dB, inicial 0 dB) controla con qué facilidad se considera ruido de fondo. Súbalo si aún se oye ruido constante; bájelo si se reducen demasiado instrumentos suaves, colas de reverb o ambiente. Normalmente bastan ajustes pequeños.
- **Smoothing** (0–100%, inicial 50%) hace más uniforme la reducción entre frecuencias cercanas. Un valor alto ayuda a evitar un carácter fluctuante o acuoso; uno bajo actúa de forma más selectiva. Si el sonido se vuelve apagado, reduzca este valor y **Reduction**.
- **Treble Care** (0–100%, inicial 50%) protege el detalle musical de alta frecuencia. Súbalo para conservar el brillo de platillos, cuerdas y voces; bájelo solo si el siseo agudo sigue molestando. Un valor intermedio suele equilibrar bien.
- **Mix** (0–100%, inicial 100%) mezcla el resultado tratado con el original. A 100% se oye solo el resultado tratado; bájelo si un poco del ambiente original suena más natural. A 0% el sonido no cambia y sirve para comparar.

### Ajustes recomendados

1. **Limpieza suave de una grabación con poco ruido:** Reduction 6–10 dB, Sensitivity -2 a 0 dB, Smoothing 40–60%, Treble Care 50–70%.
2. **Siseo claro de cinta o equipo:** Reduction 12–18 dB, Sensitivity 0 a +4 dB, Smoothing 60–80%, Treble Care 50–70%.
3. **Conservar agudos delicados:** Reduction 6–12 dB, Sensitivity -4 a 0 dB, Smoothing 50–70%, Treble Care 70–100%, Mix 70–100%.
