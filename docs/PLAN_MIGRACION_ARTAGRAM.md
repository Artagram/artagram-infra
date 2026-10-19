# ArtaGram: Plan Maestro de Migración a Microservicios (Replanteado sobre el Monolito Real)

Documento de ingeniería alineado con el diagrama [artagram_arquitectura(3).drawio](file:///C:/Users/tomas/Documents/ArtaGram/artagram-infra/docs/artagram_arquitectura%283%29.drawio) y con la auditoría completa del código fuente de `ARTAGRAM-backv1` (migraciones `V1` a `V17`) y `ARTAGRAM-frontv1`.
Objetivo: construir, migrar y probar **todo en local** con Docker Compose sin romper ningún flujo del frontend ni del monolito durante la transición.

---

## 1. Principios de Arquitectura (Alineados con `.drawio` y el Código Real)

- **Patrón Strangler Fig:** `ARTAGRAM-backv1` sigue funcionando todo el tiempo. Cada fase extrae un microservicio y actualiza su ruta en `artagram-gateway`. Al final (Fase 7), lo que permanece en `ARTAGRAM-backv1` (`community`, `canvas`, `party`, `realtime`, `observability`, `common`) se consolida como **`artagram-lienzo`**.
- **El Gateway conserva los paths reales del monolito:** `ARTAGRAM-frontv1` solo apunta a `:8080` (`VITE_API_BASE_URL` y `VITE_WS_URL`) sin romper contratos de respuesta ni manejo de errores (`NO_AUTENTICADO` 401, `SIN_PERMISO` 403).
- **Cada servicio es dueño exclusivo de su Base de Datos:**
  - **PostgreSQL 16 (1 instancia, bases separadas):** `db_auth`, `db_usuarios`, `db_feed`, `db_lienzo` (más `artagram` mientras vive el monolito completo).
  - **Redis 7 (1 instancia, bases lógicas separadas, fiel al `.drawio`):**
    - `db 0`: `artagram-lienzo` (`RealtimeBroadcaster` con `RTopic`, `DistributedLockService` con scripts Lua para locks de trazos y herramientas de fiesta, `BannerRateLimiter`, `PresenceService`).
    - `db 1`: `artagram-feed` (caché de páginas de feed y metadatos) y `artagram-gateway` (rate limiting).
  - **MongoDB 7 (1 instancia, bases separadas):** `db_chat` (`artagram-chat`) y `db_ia` (`artagram-ai-worker`).
  - **MinIO / S3 (`artagram-uploads`):** almacenamiento de objetos compatible con S3 (soporta tanto la subida actual por `multipart/form-data` y lectura en `/media/**` como URLs prefirmadas con `S3Presigner`).
- **Consistencia eventual + Relay de tiempo real:**
  - Los cambios entre dominios viajan por **RabbitMQ** (`exchange: artagram.events`, tipo `topic`, durable, con DLQ por cola).
  - Para que los contadores en vivo de likes y comentarios en [`PostCard.tsx`](file:///C:/Users/tomas/Documents/ArtaGram/ARTAGRAM-frontv1/src/features/feed/PostCard.tsx) sigan funcionando sin añadir WebSocket a `artagram-feed` ni cambiar el frontend, `artagram-feed` publica `like.updated`, `comment.created` y `comment.deleted` en RabbitMQ y `artagram-lienzo` los retransmite por STOMP a `/topic/publicaciones/{id}/likes` y `/comentarios`.
- **100 % Java 21:** incluidos los seeders (`@Profile("seed")`), el generador de llaves RSA de desarrollo y las pruebas E2E.

---

## 2. Estructura de Repositorios en el Workspace

```text
ArtaGram/
  artagram-infra/          compose, init de BD, RabbitMQ definitions, contratos, e2e, docs
  artagram-gateway/        Spring Cloud Gateway (:8080)
  artagram-auth/           Autenticación y emisión JWT RS256 + JWKS (:8081)
  artagram-users/          Perfiles, Seguidores, Cuotas y Pagos Mercado Pago (:8082)
  artagram-feed/           Publicaciones, Comentarios (V12), Edición (V13), Likes (:8083)
  ARTAGRAM-backv1/         Monolito -> evoluciona a artagram-lienzo (:8084)
  artagram-chat/           Chat personal/comunidad (Mongo) + Alertas SSE (:8085)
  artagram-media-worker/   Worker AMQP: marca de agua, BlurHash y miniaturas (:8086)
  artagram-ai-worker/      Worker AMQP: Visión IA con Groq / Fake + Mongo db_ia (:8087)
  ARTAGRAM-frontv1/        Aplicación React + TypeScript + Vite (:5173)
```

---

## 3. Convenciones Técnicas Comunes

- **Stack base:** Java 21, Maven, Spring Boot `3.3.4`, Spring Cloud `2023.0.3` (en `artagram-gateway`).
- **Paquete base:** `com.artagram.<servicio>` (`auth`, `users`, `feed`, `chat`, `media`, `ia`, `gateway`, y `platform`/`lienzo`).
- **Errores estándar:** JSON `ErrorResponse(code, message, traceId, violations)` en español (`401 NO_AUTENTICADO`, `403 SIN_PERMISO`).
- **Trazabilidad:** Cabecera `X-Trace-Id` generada en el Gateway si no viene en el request, propagada a MDC (logs JSON con `logstash-logback-encoder`) y a las cabeceras AMQP de RabbitMQ.
- **Calidad y Pruebas:** JUnit 5, Mockito, Testcontainers, JaCoCo >= 70 % de cobertura de líneas, SpotBugs sin hallazgos `High`.

---

## 4. Resumen de Contratos (Detalle completo en `docs/contracts.md`)

### 4.1 Puertos Locales

| Componente | Puerto | Notas |
|---|---|---|
| `artagram-gateway` | `8080` | Punto de entrada único HTTP y WebSocket (`/ws`) para el frontend |
| `artagram-auth` | `8081` | `/api/auth/**`, `/.well-known/jwks.json` |
| `artagram-users` | `8082` | `/api/perfil/**`, `/api/perfiles/**`, `/api/artistas/**`, `/api/pagos/**`, `/internal/users/**` |
| `artagram-feed` | `8083` | `/api/feed/**`, `/api/publicaciones/**`, `/api/comentarios/**`, `/api/ia/**`, `/media/**` |
| `artagram-lienzo` (`ARTAGRAM-backv1`) | `8084` | `/api/comunidades/**` (excepto `/chat`), `/api/fiestas/**`, `/api/admin/**`, `/ws/**`, `/internal/communities/**` |
| `artagram-chat` | `8085` | `/api/mensajes/**`, `/api/comunidades/{id}/chat`, `/api/notificaciones/**` (SSE) |
| `artagram-media-worker` | `8086` | Solo Actuator (`/actuator/health`, `/actuator/prometheus`) + consumidor AMQP |
| `artagram-ai-worker` | `8087` | Solo Actuator (`/actuator/health`, `/actuator/prometheus`) + consumidor AMQP |
| `ARTAGRAM-frontv1` | `5173` | Servidor de desarrollo Vite |
| PostgreSQL 16 | `5432` | Bases: `artagram`, `db_auth`, `db_usuarios`, `db_feed`, `db_lienzo` |
| Redis 7 | `6379` | `db 0` (Lienzo Pub/Sub y locks) y `db 1` (Caché Feed y Gateway) |
| MongoDB 7 | `27017` | Bases: `db_chat`, `db_ia` |
| RabbitMQ 3 | `5672` / `15672` | Exchange `artagram.events` (`topic`) + consola web |
| MinIO (S3 local) | `9000` / `9001` | Bucket `artagram-uploads` + consola web |

### 4.2 Reparto Real de las 22 Tablas SQL del Monolito (`V1` a `V17`)

1. **`db_auth` (`artagram-auth`):**
   - `usuarios` (`id`, `correo`, `nombre_artista`, `password_hash`, `verificado`, `rol_global`, `premium`, `creado_en`, `actualizado_en`)
   - `tokens_verificacion` (`id`, `usuario_id`, `token`, `expira_en`, `usado`, `creado_en`, `actualizado_en`)
2. **`db_usuarios` (`artagram-users`):**
   - `perfiles` (`id`, `usuario_id`, `nombre_artista`, `rol_global`, `premium`, `biografia`, `foto_url`, `creado_en`, `actualizado_en`)
   - `perfil_enlaces` (`id`, `perfil_id`, `etiqueta`, `url`, `orden`)
   - `perfil_obras_destacadas` (`id`, `perfil_id`, `titulo`, `ruta_imagen`, `orden`)
   - `seguidores` (`id`, `seguidor_id`, `seguido_id`, `creado_en`, `actualizado_en`) *(migrada desde `feed`)*
   - `uso_cuenta` (`usuario_id`, `comunidades_creadas`, `salas_fiesta_activas`, `actualizado_en`)
   - `eventos_pago` (`evento_id`, `usuario_id`, `proveedor`, `estado`, `procesado_en`) + `eventos_procesados`
3. **`db_feed` (`artagram-feed`):**
   - `publicaciones` (`id`, `autor_id`, `autor_nombre`, `titulo`, `descripcion`, `obra_final_ruta`, `blurhash`, `miniaturas_json`, `contador_likes`, `contador_comentarios`, `version`, `editado_en`, `creado_en`, `actualizado_en`)
   - `publicacion_etiquetas` (`publicacion_id`, `etiqueta`)
   - `imagenes_proceso` (`id`, `publicacion_id`, `ruta_imagen`, `orden`)
   - `reacciones` (`id`, `usuario_id`, `publicacion_id`, `creado_en`, `actualizado_en`)
   - `comentarios` (`id`, `publicacion_id`, `autor_id`, `autor_nombre`, `contenido`, `creado_en`, `actualizado_en`) *(`V12`)*
   - `analisis_obra` (`id`, `publicacion_id`, `solicitante_id`, `tipo`, `resultado_json`, `modelo`, `creado_en`, `actualizado_en`) *(`V14`)*
   - `seguidores_proyeccion` (`seguidor_id`, `seguido_id`) + `usuarios_proyeccion` (`usuario_id`, `nombre_artista`) + `eventos_procesados`
4. **`db_lienzo` (`artagram-lienzo`):**
   - `comunidades`, `membresias_comunidad`
   - `lienzos`, `trazos`
   - `banners_comunitarios`, `banner_regiones`, `banner_trazos`, `banner_snapshots`
   - `salas_fiesta` (con `total_rondas` de `V15`), `participantes_sala`, `party_ronda_estado`, `party_trazos`
   - `eventos_negocio` (`V11`, KPIs) + `usuarios_proyeccion` (`usuario_id`, `nombre_artista`, `premium`, `creado_en`)

---

## 5. Fases de Implementación

### Fase 0: Workspace, Infraestructura Local y Contratos (`artagram-infra`)
- `compose.yml` con PostgreSQL 16 (`init-multiple-dbs.sql`), Redis 7, MongoDB 7, RabbitMQ 3 (`definitions.json`) y MinIO (con creación automática del bucket `artagram-uploads`).
- `compose.services.yml` con la definición de los 8 servicios Java y límites de memoria.
- `docs/contracts.md`, `docs/IA-ACTUAL.md`, `docs/DECISIONES.md`, `.env.example`, `.gitignore`.
- Generador de llaves RSA en Java puro (`scripts/GenerarLlavesRsa.java`) que deposita `jwt-private.pem` y `jwt-public.pem` en `secrets-dev/`.
- **DoD:** `docker compose up -d` levanta las 5 piezas de infraestructura en estado `healthy` y el monolito actual funciona contra ellas.

### Fase 1: Monolito Preparado con Almacenamiento S3/MinIO (Conservando Redis)
- Implementar `S3StorageProvider` (AWS SDK v2 `software.amazon.awssdk:s3`) en `ARTAGRAM-backv1` junto a `DiskStorageProvider` y `AzureBlobStorageProvider`.
- Soportar tanto el flujo actual (`StorageService.guardar`/`leer` y `GET /media/**` con firma HMAC) como la generación de URLs prefirmadas (`S3Presigner`) para MinIO/S3.
- Conservar Redis (`RealtimeBroadcaster`, `DistributedLockService`, `BannerRateLimiter`, `PresenceService`) tal como establece `artagram_arquitectura(3).drawio`.
- **DoD:** `mvn verify` verde en `ARTAGRAM-backv1` incluyendo `S3StorageProviderIT` (con Testcontainers/MinIO).

### Fase 2: API Gateway (`artagram-gateway`)
- Proyecto Spring Cloud Gateway (WebFlux) en `:8080`.
- Enrutamiento completo de todos los controladores del monolito (apuntando por defecto a `:8084` mediante variables de entorno por servicio).
- Proxy de WebSocket para `/ws/**`, bloqueo de `/internal/**`, CORS centralizado, filtro `X-Trace-Id` y Rate Limiting con Redis (`db 1`) / Bucket4j.
- Validación opcional de JWT RS256 vía JWKS (`GATEWAY_JWT_ENABLED=false` en Fase 2, `true` en Fase 3).
- **DoD:** `ARTAGRAM-frontv1` funciona al 100% apuntando a `http://localhost:8080` y `ws://localhost:8080/ws`.

### Fase 3: Servicio de Autenticación (`artagram-auth`)
- Extraer `auth` a `artagram-auth` (`:8081`) con `db_auth` (Flyway `V1__auth.sql`).
- Endpoints `/api/auth/registro`, `/api/auth/verificar`, `/api/auth/login`, `/api/auth/nombre-disponible` y `/.well-known/jwks.json`.
- Emisión de JWT **RS256** con claims `sub` (`usuarioId`), `nombre` (`nombreArtista`), `rol` (`rolGlobal`), `premium`.
- Publicación de `user.registered` y `user.deleted` en RabbitMQ (`artagram.events`).
- Adaptar `ARTAGRAM-backv1` para validar JWT con JWKS (REST y handshake STOMP `?token=`) y consumir `user.registered`.
- **DoD:** Registro, verificación y login funcionan desde `artagram-auth`; Gateway con `GATEWAY_JWT_ENABLED=true` rechaza tokens inválidos o HS256 antiguos.

### Fase 4: Chat y Notificaciones (`artagram-chat`)
- Crear `artagram-chat` (`:8085`) con MongoDB `db_chat`.
- Migrar `/api/mensajes`, `/api/mensajes/conversaciones`, `/api/mensajes/con/{otroUsuarioId}` y `GET/POST /api/comunidades/{comunidadId}/chat`.
- Agregar en `ARTAGRAM-backv1` el endpoint interno `GET /internal/communities/{id}/members/{userId}` para que `artagram-chat` valide membresía activa.
- Endpoint SSE `GET /api/notificaciones/stream?token=...` para empujar mensajes personales y alertas (`follow.created`, `like.created`, `comment.created`, `subscription.updated`, `ai.completed`).
- En `ARTAGRAM-backv1`: el handler STOMP `/app/comunidad/{comunidadId}/chat/enviar` publica `room.message` en RabbitMQ para que `artagram-chat` lo persista en MongoDB.
- **DoD:** Chat personal, chat de comunidad y alertas SSE funcionando con persistencia en MongoDB; un usuario expulsado de una comunidad recibe 403 al consultar el historial.

### Fase 5: Feed (`artagram-feed`) y Worker de Media (`artagram-media-worker`)
- Crear `artagram-feed` (`:8083`) con `db_feed` y Redis (`db 1` para caché).
- Migrar `PublicacionController`, `PublicacionService` (con edición `@Version` de `V13` y likes atómicos) y `feed.comentario` (`ComentarioController`, `ComentarioService`, `ValidadorComentarios` de `V12`).
- Mantener subida dual: `POST /api/publicaciones` (`multipart/form-data`) + `POST /api/publicaciones/presign` (URL prefirmada S3/MinIO) y `GET /media/**`.
- Publicar `post.published`, `like.created`, `like.updated`, `comment.created`, `comment.deleted`.
- En `ARTAGRAM-backv1` (`Lienzo`): consumir `like.updated`, `comment.created` y `comment.deleted` desde RabbitMQ y retransmitirlos con `RealtimeBroadcaster` a `/topic/publicaciones/{id}/likes` y `/comentarios` (cero cambios en `PostCard.tsx`).
- Crear `artagram-media-worker` (`:8086`): consume `post.published`, valida imagen con Tika, genera marca de agua, miniaturas y BlurHash, sube a S3/MinIO y publica `media.processed`.
- **DoD:** Publicar obra genera BlurHash y miniaturas vía worker; likes y comentarios en tiempo real siguen actualizando `PostCard.tsx`; `LikeConcurrencyIT` (200 likes simultáneos) verde en `artagram-feed`.

### Fase 5b: Worker de IA (`artagram-ai-worker`)
- Crear `artagram-ai-worker` (`:8087`) con MongoDB `db_ia` y acceso de lectura a S3/MinIO.
- Migrar `PromptIa`, `PromptIaBuilder`, `AnalisisTecnicoEstrategia`, `SugerenciaEtiquetasEstrategia`, `GroqProveedorIa` (`qwen/qwen3.8-27b`) y `FakeProveedorIa` tal como están documentados en `docs/IA-ACTUAL.md`.
- `artagram-feed` expone los 4 endpoints actuales (`POST/GET /api/publicaciones/{id}/analisis*` y `POST /api/ia/sugerencias`), publica `ai.analyze` con `replyTo`/`correlationId` (Request-Reply AMQP con timeout de 15 s) y devuelve la respuesta en la misma petición HTTP.
- `artagram-ai-worker` consume `ai.analyze`, guarda auditoría en `db_ia`, responde al `replyTo` y publica `ai.completed` (que `artagram-feed` guarda en `analisis_obra` y `artagram-chat` notifica por SSE).
- **DoD:** Tanto el botón "Sugerir con IA" en `PublishWizard.tsx` como "Feedback IA" en `PostCard.tsx` funcionan de extremo a extremo a través de RabbitMQ y `artagram-ai-worker`.

### Fase 6: Usuario y Suscripción (`artagram-users`)
- Crear `artagram-users` (`:8082`) con `db_usuarios`.
- Migrar `PerfilController` (`/api/perfil/**`, `/api/perfiles/**`), `SeguidorController` (`/api/artistas/**`) y `QuotaService` (`uso_cuenta`).
- Consumir `user.registered` y `user.deleted`; publicar `follow.created`, `follow.deleted` y `subscription.updated`.
- Implementar `PaymentProvider` (`MercadoPagoProvider` y `FakePaymentProvider`) + webhook idempotente `POST /api/pagos/webhook/mercadopago`.
- Exponer `/internal/users/{id}/plan` y `/internal/users/{id}/quota/**` para que `artagram-lienzo` valide y reserve/libere cupos de comunidades y salas.
- **DoD:** Perfiles, fotos/obras destacadas, seguimiento de artistas, cambio a plan Premium y validación de cupos de comunidades funcionan contra `artagram-users`.

### Fase 7: Consolidación de `ARTAGRAM-backv1` como `artagram-lienzo`
- Limpiar de `ARTAGRAM-backv1` los paquetes ya extraídos (`auth`, `profile`, `billing`, `chat`, `feed`, `ia`), dejando únicamente `community`, `canvas`, `party`, `realtime`, `observability` y `common` sobre `db_lienzo` y Redis (`db 0`).
- **DoD:** Todas las pruebas de concurrencia y STOMP en tiempo real (`CanvasWebSocketIT`, `TrazoLockIT`, `BannerConcurrencyIT`, `PartyRoomIT`, `PartyEraserIT`, `KpiIT`) pasan en verde.

### Fase 8: Pruebas E2E (`artagram-infra`) y Ajuste Final del Frontend
- Módulo Maven `e2e` en `artagram-infra` que valida el recorrido completo contra el Gateway (`:8080`).
- Ajuste final en `ARTAGRAM-frontv1` para tolerancia de consistencia eventual tras registro y escucha de alertas SSE.
