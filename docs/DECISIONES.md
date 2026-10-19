# Registro de Decisiones Arquitectónicas (`DECISIONES.md`)

Este archivo registra las diferencias encontradas entre el borrador original del plan y el código real de `ARTAGRAM-backv1` / `ARTAGRAM-frontv1`, junto con la decisión acordada.

---

## Decisión 1: Permanencia de Redis (Alineado con `artagram_arquitectura(3).drawio`)
- **Contexto:** El diagrama `artagram_arquitectura(3).drawio` incluye Redis para caché de Feed y para canvas + pub/sub en Lienzo, mientras que el borrador inicial sugería quitar Redis en la Fase 1. En el código real de `ARTAGRAM-backv1`, Redis + Redisson ya está implementado y probado en `RealtimeBroadcaster`, `DistributedLockService` (con scripts Lua para locks de trazos y herramientas de fiesta), `BannerRateLimiter` y `PresenceService`.
- **Decisión:** Se **mantiene una única instancia de Redis 7** en Docker Compose, separando lógicamente `db 0` para `artagram-lienzo` (Pub/Sub STOMP, locks distribuidos y presencia) y `db 1` para `artagram-feed` (caché de feed) y `artagram-gateway` (rate limiting).

## Decisión 2: Actualizaciones en Tiempo Real de Likes y Comentarios en el Feed
- **Contexto:** En el código real (`V12__comentarios.sql`, `LikeEventListener`, `ComentarioEventListener` y `PostCard.tsx`), el frontend escucha cambios de likes y comentarios en tiempo real por WebSocket STOMP en `/topic/publicaciones/{id}/likes` y `/topic/publicaciones/{id}/comentarios`.
- **Decisión:** `artagram-feed` se mantiene como microservicio REST sin servidor WebSocket propio. Cuando ocurre un like o comentario, `artagram-feed` publica `like.updated`, `comment.created` o `comment.deleted` en RabbitMQ (`artagram.events`). `artagram-lienzo` consume estos eventos y los retransmite por `RealtimeBroadcaster` a `/topic/publicaciones/{id}/likes` y `/comentarios`. De este modo, `PostCard.tsx` no requiere cambios y el diagrama `.drawio` se respeta (WebSocket únicamente en `artagram-lienzo`).

## Decisión 3: Estrategia Dual para Subida y Lectura de Imágenes (S3/MinIO)
- **Contexto:** Hoy `ARTAGRAM-frontv1` sube imágenes mediante `multipart/form-data` (`POST /api/publicaciones`, `POST /api/perfil/me/foto`, `POST /api/perfil/me/obras/imagen`) y las visualiza mediante URLs firmadas con HMAC hacia `GET /media/{*rutaRelativa}?exp=...&sig=...`. El `.drawio` propone almacenamiento en S3 (MinIO en local) con URLs prefirmadas y procesamiento en `artagram-media-worker`.
- **Decisión:** Se soportan **ambos mecanismos**:
  1. Se añade `S3StorageProvider` (AWS SDK v2 apuntando a MinIO en local y S3 en producción) debajo de la interfaz `StorageProvider` existente, manteniendo operativos los endpoints `multipart/form-data` y `GET /media/**`.
  2. Se habilitan endpoints de URLs prefirmadas (`S3Presigner`) para subida/descarga directa a S3/MinIO y el procesamiento asíncrono en `artagram-media-worker` (marca de agua, miniaturas y BlurHash).

## Decisión 4: Módulo de IA Multimodal con Visión (`GroqProveedorIa` / `FakeProveedorIa`)
- **Contexto:** El código real en `com.artagram.platform.ia` (`V14__analisis_ia.sql`) analiza imágenes en Base64 con visión artificial (`qwen/qwen3.8-27b` en Groq) usando `PromptIaBuilder`, `AnalisisTecnicoEstrategia` y `SugerenciaEtiquetasEstrategia`, tanto para obras publicadas (`/api/publicaciones/{id}/analisis*`) como para el asistente previo a publicar (`POST /api/ia/sugerencias`).
- **Decisión:** `artagram-ai-worker` migra exactamente esas estrategias, prompts y proveedores, persistiendo su historial y métricas en MongoDB (`db_ia`) y respondiendo a `artagram-feed` mediante Request-Reply sobre RabbitMQ (`ai.analyze` / `ai.completed`).

## Decisión 5: Seguidores (`/api/artistas/**`) en `artagram-users`
- **Contexto:** En el monolito, `SeguidorController` y la tabla `seguidores` (`V10__feed.sql`) estaban en el paquete `feed`, pero el `.drawio` asigna Seguidores al microservicio **Usuario y Suscripción (`artagram-users`)**.
- **Decisión:** `SeguidorController` (`/api/artistas/**`) se mueve a `artagram-users` (`db_usuarios`). `artagram-users` publica `follow.created` y `follow.deleted` en RabbitMQ para que `artagram-feed` actualice su tabla `seguidores_proyeccion` y filtre el feed por artistas seguidos.

## Decisión 6: Unificación de los 12 Usuarios Semilla (`DemoDataSeeder` + `V17`)
- **Contexto:** Además de los 7 usuarios originales de `DemoDataSeeder`, la migración `V17__cinco_usuarios_adicionales.sql` incorporó 5 artistas con UUIDs fijos (`a1b2c3d4-0001-4000-8000-000000000001`..`0005`).
- **Decisión:** Se estandarizan los **12 usuarios de demostración** con UUIDs deterministas en `docs/contracts.md` para que todos los microservicios siembren datos coherentes sin depender de la base de datos de otro servicio.
