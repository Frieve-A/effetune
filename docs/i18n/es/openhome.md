---
title: "Control remoto OpenHome (aplicación de escritorio) - EffeTune"
description: "Controla la aplicación de escritorio de EffeTune desde aplicaciones de control OpenHome de tu red local: configuración, acceso a la red, compatibilidad y limitaciones."
lang: es
---

# Control remoto OpenHome (aplicación de escritorio)

En las compilaciones de escritorio compatibles (Windows x64, macOS para Intel/Apple silicon y Linux x64), EffeTune puede aparecer como reproductor OpenHome para aplicaciones de control en la misma red local. Abre **Configuración > Configuración...**, activa **Permitir controladores OpenHome en esta red** (desactivado de forma predeterminada) y espera hasta que el estado indique que EffeTune está disponible. El nombre predeterminado del reproductor es `EffeTune (nombre del equipo)`; usa **Nombre del reproductor** para definir un nombre personalizado como `EffeTune Living Room`.

OpenHome no requiere iniciar sesión. Mientras esté activado, otros dispositivos de la red local pueden ver los metadatos de reproducción, editar la cola del reproductor y controlar la reproducción. Si el Firewall de Windows solicita permiso, permite EffeTune solo en **redes privadas**, no en **redes públicas**. Desactiva la opción cuando no necesites el control remoto.

Los controladores pueden añadir flujos de audio HTTP o HTTPS, gestionar la cola de reproducción remota y controlar reproducción, pausa, parada, salto de pista, búsqueda, repetición y modo aleatorio. El audio remoto pasa por el pipeline de efectos activo de EffeTune como de costumbre. El control básico de cola y reproducción se ha verificado con BubbleUPnP en Android; otras aplicaciones OpenHome pueden mostrar los servicios de forma distinta. EffeTune funciona como fuente OpenHome Playlist (no como UPnP AV MediaRenderer) y no expone edición de efectos, rutas de archivos locales, volumen maestro, Radio, Songcast ni sincronización multiroom mediante OpenHome.

La reproducción sin pausas no está garantizada, y los datos técnicos de la pista pueden seguir siendo desconocidos hasta que la fuente los proporcione. Tras una suspensión, una reactivación, una conexión VPN o un cambio de red, el reproductor puede desaparecer brevemente mientras se vuelve a conectar.

[← Volver al README](README.md)
