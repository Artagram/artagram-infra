# Contratos de Microservicios de ArtaGram (`contracts.md`)

Este documento define los contratos técnicos compartidos entre los microservicios de ArtaGram: puertos locales, enrutamiento del API Gateway, estructura de tokens JWT (RS256 + JWKS), eventos asíncronos en RabbitMQ, endpoints internos (`/internal/**`) e identificadores deterministas para los datos de demostración.

---

## 1. Puertos y Bases de Datos por Servicio

| Servicio / Componente | Puerto HTTP | Base de Datos / Almacenamiento |
|---|---|---|
| `artagram-gateway` | `8080` | Redis `db 1` (rate limiting) |
| `artagram-auth` | `8081` | PostgreSQL `db_auth` (`:5432`) |
| `artagram-users` | `8082` | PostgreSQL `db_usuarios` (`:5432`) + MinIO/S3 (`artagram-uploads`) |
| `artagram-feed` | `8083` | PostgreSQL `db_feed` (`:5432`) + Redis `db 1` (caché) + MinIO/S3 (`artagram-uploads`) |
| `artagram-lienzo` (`ARTAGRAM-backv1`) | `8084` | PostgreSQL `db_lienzo` / `artagram` (`:5432`) + Redis `db 0` (STOMP Pub/Sub, locks, rate limit) |
| `artagram-chat` | `8085` | MongoDB `db_chat` (`:27017`) |
| `artagram-media-worker` | `8086` | MinIO/S3 (`artagram-uploads`) |
| `artagram-ai-worker` | `8087` | MongoDB `db_ia` (`:27017`) + MinIO/S3 (`artagram-uploads`) |
| `ARTAGRAM-frontv1` | `5173` | — |
| PostgreSQL 16 | `5432` | `artagram`, `db_auth`, `db_usuarios`, `db_feed`, `db_lienzo` |
| Redis 7 | `6379` | `db 0` (Lienzo), `db 1` (Feed y Gateway) |
| MongoDB 7 | `27017` | `db_chat`, `db_ia` |
| RabbitMQ 3 | `5672` (AMQP) / `15672` (UI) | Exchange `artagram.events` (`topic`, `durable`) |
| MinIO (S3 local) | `9000` (API) / `9001` (UI) | Bucket `artagram-uploads` |

---

## 2. Tabla de Rutas del API Gateway (`:8080`)

El Gateway expone exactamente los mismos paths que el monolito hoy, enrutando hacia el microservicio correspondiente:

| Método y Path | Servicio Destino | Seguridad en Gateway |
|---|---|---|
| `POST /api/auth/registro` | `artagram-auth` (`:8081`) | Público (`permitAll`) |
| `GET /api/auth/verificar` | `artagram-auth` (`:8081`) | Público (`permitAll`) |
| `POST /api/auth/login` | `artagram-auth` (`:8081`) | Público (`permitAll`) |
| `GET /api/auth/nombre-disponible` | `artagram-auth` (`:8081`) | Público (`permitAll`) |
| `GET /.well-known/jwks.json` | `artagram-auth` (`:8081`) | Público (`permitAll`) |
| `GET /api/perfiles/{nombreArtista}` | `artagram-users` (`:8082`) | Público (`permitAll`, JWT opcional) |
| `POST /api/perfiles/{nombreArtista}/premium` | `artagram-users` (`:8082`) | Autenticado (JWT) |
| `GET /api/perfil/me`, `PUT /api/perfil/me`, `POST /api/perfil/me/foto`, `POST /api/perfil/me/obras/imagen` | `artagram-users` (`:8082`) | Autenticado (JWT) |
| `GET /api/artistas`, `POST /api/artistas/{id}/seguir`, `DELETE /api/artistas/{id}/seguir`, `GET /api/artistas/{id}/seguimiento` | `artagram-users` (`:8082`) | Autenticado (JWT) |
| `POST /api/pagos/webhook/**` | `artagram-users` (`:8082`) | Público (validado por firma `x-signature`) |
| `/api/pagos/**` | `artagram-users` (`:8082`) | Autenticado (JWT) |
| `GET /api/feed` | `artagram-feed` (`:8083`) | Autenticado (JWT) |
| `POST /api/publicaciones`, `PATCH /api/publicaciones/{id}`, `PUT /api/publicaciones/{id}`, `DELETE /api/publicaciones/{id}`, `POST /api/publicaciones/{id}/like`, `POST /api/publicaciones/presign` | `artagram-feed` (`:8083`) | Autenticado (JWT) |
| `GET /api/publicaciones/{id}/comentarios`, `POST /api/publicaciones/{id}/comentarios`, `DELETE /api/comentarios/{id}` | `artagram-feed` (`:8083`) | Autenticado (JWT) |
| `POST /api/publicaciones/{id}/analisis`, `GET /api/publicaciones/{id}/analisis`, `GET /api/publicaciones/{id}/analisis/ultimo`, `POST /api/ia/sugerencias` | `artagram-feed` (`:8083`) | Autenticado (JWT) |
| `GET /media/{*rutaRelativa}` | `artagram-feed` / `artagram-users` | Público (validado por firma HMAC `?exp=&sig=`) |
| `POST /api/mensajes`, `GET /api/mensajes/conversaciones`, `GET /api/mensajes/con/{otroUsuarioId}` | `artagram-chat` (`:8085`) | Autenticado (JWT) |
| `GET /api/comunidades/{comunidadId}/chat`, `POST /api/comunidades/{comunidadId}/chat` | `artagram-chat` (`:8085`) | Autenticado (JWT) |
| `GET /api/notificaciones/stream` (SSE) | `artagram-chat` (`:8085`) | Autenticado (`?token=` o `Authorization`) |
| `/api/comunidades/**` *(excepto `/chat`)* | `artagram-lienzo` (`:8084`) | Autenticado (JWT) |
| `/api/fiestas/**` | `artagram-lienzo` (`:8084`) | Autenticado (JWT) |
| `/api/admin/**` | `artagram-lienzo` (`:8084`) | `ROLE_ADMIN` |
| `/ws/**` (WebSocket STOMP) | `artagram-lienzo` (`:8084`) | Handshake validado con `?token=` |
| `/internal/**` | **BLOQUEADO (`403 Forbidden`)** | Solo red interna de contenedores |

---

## 3. Contrato de Autenticación JWT (RS256 + JWKS)

- **Algoritmo:** `RS256` (llave privada RSA de 2048 bits en `artagram-auth`; llave pública publicada en `GET /.well-known/jwks.json` con `kid = "artagram-key-1"`).
- **Header:**
  ```json
  {
    "alg": "RS256",
    "typ": "JWT",
    "kid": "artagram-key-1"
  }
  ```
- **Payload (Claims):**
  ```json
  {
    "iss": "artagram-auth",
    "sub": "a1b2c3d4-0000-4000-8000-000000000002",
    "nombre": "sam_pixel",
    "rol": "USUARIO",
    "premium": true,
    "iat": 1760812800,
    "exp": 1760820000
  }
  ```
- **Propagación:** El Gateway valida la firma con el JWKS de `artagram-auth` y reenvía el header `Authorization: Bearer <token>` (además de `X-Trace-Id`) a los servicios internos.

---

## 4. Contrato de Error Estándar y Trazabilidad

Todos los servicios y el Gateway responden errores con la misma estructura JSON:

```json
{
  "code": "NO_AUTENTICADO",
  "message": "Tu sesión expiró o no enviaste un token válido",
  "traceId": "4f8b9c1a2d3e4f50",
  "violations": []
}
```

- `401 Unauthorized` -> `code: "NO_AUTENTICADO"`
- `403 Forbidden` -> `code: "SIN_PERMISO"` (o códigos de negocio como `"TOPE_COMUNIDADES"`)
- `404 Not Found` -> `code: "RECURSO_NO_ENCONTRADO"` (o específicos de dominio)
- Cabecera HTTP/AMQP de trazabilidad: `X-Trace-Id`.

---

## 5. Contratos de Eventos en RabbitMQ (`artagram.events`)

- **Exchange principal:** `artagram.events` (`topic`, `durable: true`)
- **Dead-Letter Exchange:** `artagram.dlx` (`topic`, `durable: true`)
- **Sobre (Envelope) estándar para todos los eventos:**

```json
{
  "eventId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "type": "user.registered",
  "occurredAt": "2026-10-18T19:30:00Z",
  "traceId": "4f8b9c1a2d3e4f50",
  "payload": {}
}
```

### 5.1 Catálogo de Eventos y Payloads

| Routing Key | Productor | Consumidores (Colas) | Payload JSON (`payload`) |
|---|---|---|---|
| `user.registered` | `artagram-auth` | `users.user.registered`, `feed.user.registered`, `lienzo.user.registered` | `{"userId": "UUID", "correo": "string", "nombreArtista": "string", "rolGlobal": "USUARIO\|ADMIN", "premium": false}` |
| `user.deleted` | `artagram-auth` | `users.user.deleted`, `feed.user.deleted`, `lienzo.user.deleted`, `chat.user.deleted` | `{"userId": "UUID"}` |
| `follow.created` | `artagram-users` | `feed.follow.created`, `chat.follow.created` | `{"followerId": "UUID", "followerNombre": "string", "followedId": "UUID", "followedNombre": "string"}` |
| `follow.deleted` | `artagram-users` | `feed.follow.deleted` | `{"followerId": "UUID", "followedId": "UUID"}` |
| `subscription.updated` | `artagram-users` | `chat.subscription.updated`, `lienzo.subscription.updated` | `{"userId": "UUID", "nombreArtista": "string", "premium": true, "plan": "PREMIUM", "estado": "ACTIVO"}` |
| `post.published` | `artagram-feed` | `media.post.published` | `{"postId": "UUID", "autorId": "UUID", "autorNombre": "string", "titulo": "string", "claveS3": "publicaciones/.../obra.jpg"}` |
| `media.processed` | `artagram-media-worker` | `feed.media.processed` | `{"postId": "UUID", "estado": "OK\|ERROR", "blurhash": "LEHV6nWB2yk8pyo0adR*.7kCMdnj", "claveWatermark": "string", "clavesMiniaturas": {"sm": "string", "md": "string"}}` |
| `like.created` | `artagram-feed` | `chat.like.created` | `{"postId": "UUID", "postTitulo": "string", "autorId": "UUID", "likerId": "UUID", "likerNombre": "string", "contadorLikes": 12}` |
| `like.updated` | `artagram-feed` | `lienzo.like.updated` | `{"tipo": "LIKES_ACTUALIZADOS", "publicacionId": "UUID", "contadorLikes": 12}` *(retransmitido a `/topic/publicaciones/{id}/likes`)* |
| `comment.created` | `artagram-feed` | `chat.comment.created`, `lienzo.comment.created` | `{"tipo": "COMENTARIO_CREADO", "publicacionId": "UUID", "autorPublicacionId": "UUID", "comentario": {"id": "UUID", "publicacionId": "UUID", "autorId": "UUID", "autorNombre": "string", "contenido": "string", "creadoEn": "ISO-8601"}, "contadorComentarios": 5}` |
| `comment.deleted` | `artagram-feed` | `lienzo.comment.deleted` | `{"tipo": "COMENTARIO_ELIMINADO", "publicacionId": "UUID", "comentario": {"id": "UUID", "publicacionId": "UUID", "autorId": "UUID", "autorNombre": "string", "contenido": "", "creadoEn": "ISO-8601"}, "contadorComentarios": 4}` |
| `room.message` | `artagram-lienzo` | `chat.room.message` | `{"mensajeId": "UUID", "comunidadId": "UUID", "remitenteId": "UUID", "remitenteNombre": "string", "contenido": "string", "creadoEn": "ISO-8601"}` |
| `canvas.closed` | `artagram-lienzo` | `feed.canvas.closed` | `{"comunidadId": "UUID", "salaId": "UUID", "anfitrionId": "UUID", "anfitrionNombre": "string", "titulo": "string", "claveS3": "string", "participantes": ["UUID"]}` |
| `ai.analyze` | `artagram-feed` | `ai.ai.analyze` | `{"solicitudId": "UUID", "postId": "UUID\|null", "solicitanteId": "UUID", "tipo": "TECNICO\|SUGERENCIA_ETIQUETAS", "claveS3": "string\|null", "imagenDataUri": "string\|null"}` |
| `ai.completed` | `artagram-ai-worker` | `feed.ai.completed`, `chat.ai.completed` | `{"solicitudId": "UUID", "postId": "UUID\|null", "solicitanteId": "UUID", "tipo": "TECNICO\|SUGERENCIA_ETIQUETAS", "estado": "COMPLETADO\|ERROR", "modelo": "qwen/qwen3.8-27b", "resultadoJson": "{...}"}` |

---

## 6. Endpoints Internos (`/internal/**`)

No se publican en el Gateway; solo se invocan dentro de la red de contenedores Docker:

1. **En `artagram-lienzo` (`:8084`):**
   - `GET /internal/communities/{comunidadId}/members/{usuarioId}`
   - **Respuesta `200 OK`:** `{"comunidadId": "UUID", "usuarioId": "UUID", "miembroActivo": true, "rol": "MIEMBRO|MODERADOR|ADMIN", "comunidadPublica": true}`
   - Usado por `artagram-chat` para autorizar lectura/escritura del historial de chat de comunidad.

2. **En `artagram-users` (`:8082`):**
   - `GET /internal/users/{usuarioId}/plan`
   - **Respuesta `200 OK`:** `{"usuarioId": "UUID", "nombreArtista": "string", "premium": false, "comunidadesCreadas": 1, "salasFiestaActivas": 0, "maxComunidadesGratis": 3}`
   - `POST /internal/users/{usuarioId}/quota/communities/reserve` y `/release`
   - Usado por `artagram-lienzo` al crear o eliminar comunidades/salas de fiesta.

---

## 7. Identificadores Fijos de Demostración (`@Profile("seed")` y `V17`)

Contraseña común de todas las cuentas de demostración: `clavesegura123`.

### 7.1 Los 12 Usuarios de Demostración

| # | UUID Fijo | `nombre_artista` | `correo` | Rol Global | Premium | Origen |
|---|---|---|---|---|---|---|
| 1 | `a1b2c3d4-0000-4000-8000-000000000001` | `lucia_acuarela` | `lucia.mora@correo.com` | `USUARIO` | `false` | `DemoDataSeeder` |
| 2 | `a1b2c3d4-0000-4000-8000-000000000002` | `sam_pixel` | `sam.rivera@correo.com` | `USUARIO` | **`true`** (`V16`) | `DemoDataSeeder` |
| 3 | `a1b2c3d4-0000-4000-8000-000000000003` | `noa_tinta` | `noa.delgado@correo.com` | `USUARIO` | `false` | `DemoDataSeeder` |
| 4 | `a1b2c3d4-0000-4000-8000-000000000004` | `ivan_urbano` | `ivan.rueda@correo.com` | `USUARIO` | `false` | `DemoDataSeeder` |
| 5 | `a1b2c3d4-0000-4000-8000-000000000005` | `maria_paz_art` | `maria.paz@correo.com` | `USUARIO` | `false` | `DemoDataSeeder` |
| 6 | `a1b2c3d4-0000-4000-8000-000000000006` | `diego_grabado` | `diego.leon@correo.com` | `USUARIO` | `false` | `DemoDataSeeder` |
| 7 | `a1b2c3d4-0000-4000-8000-000000000007` | `pincel_artagram` | `prueba.artagram@correo.com` | **`ADMIN`** | `false` | `DemoDataSeeder` |
| 8 | `a1b2c3d4-0001-4000-8000-000000000001` | `camila_oleo` | `camila.oleo@correo.com` | `USUARIO` | `false` | `V17` + `DemoDataSeeder` |
| 9 | `a1b2c3d4-0002-4000-8000-000000000002` | `mateo_3d` | `mateo.3d@correo.com` | `USUARIO` | `false` | `V17` + `DemoDataSeeder` |
| 10 | `a1b2c3d4-0003-4000-8000-000000000003` | `valeria_botanica` | `valeria.botanica@correo.com` | `USUARIO` | `false` | `V17` + `DemoDataSeeder` |
| 11 | `a1b2c3d4-0004-4000-8000-000000000004` | `andres_concept` | `andres.concept@correo.com` | `USUARIO` | `false` | `V17` + `DemoDataSeeder` |
| 12 | `a1b2c3d4-0005-4000-8000-000000000005` | `elena_collage` | `elena.collage@correo.com` | `USUARIO` | `false` | `V17` + `DemoDataSeeder` |

### 7.2 Las 3 Comunidades de Demostración

| # | UUID Fijo | Nombre | Creador (`nombre_artista`) |
|---|---|---|---|
| 1 | `c0ffee00-0000-4000-8000-000000000001` | `Jardines Colaborativos` | `lucia_acuarela` |
| 2 | `c0ffee00-0000-4000-8000-000000000002` | `Pixel Studio` | `sam_pixel` |
| 3 | `c0ffee00-0000-4000-8000-000000000003` | `Tinta y Papel` | `noa_tinta` |

### 7.3 Las 6 Publicaciones de Demostración

| # | UUID Fijo | Autor | Título | Archivo Principal |
|---|---|---|---|---|
| 1 | `b0000000-0000-4000-8000-000000000001` | `lucia_acuarela` | `Jardín al amanecer` | `jardin_abstracto.jpg` |
| 2 | `b0000000-0000-4000-8000-000000000002` | `sam_pixel` | `Atardecer en 8-bit` | `atardecer_coral.jpg` |
| 3 | `b0000000-0000-4000-8000-000000000003` | `noa_tinta` | `Estudio en violeta` | `estudio_violeta.jpg` |
| 4 | `b0000000-0000-4000-8000-000000000004` | `ivan_urbano` | `Mural cálido` | `acuarela_calida.jpg` |
| 5 | `b0000000-0000-4000-8000-000000000005` | `maria_paz_art` | `Lienzo nocturno` | `lienzo_nocturno.jpg` |
| 6 | `b0000000-0000-4000-8000-000000000006` | `diego_grabado` | `Brotes de color` | `brotes_de_color.jpg` |
