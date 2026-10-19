# Documentación del Módulo de IA Actual en `ARTAGRAM-backv1` (`com.artagram.platform.ia`)

Este documento registra el funcionamiento exacto del módulo de Inteligencia Artificial en el monolito antes de su extracción hacia `artagram-ai-worker` y `artagram-feed` (Fase 5b).

---

## 1. Hallazgo Principal

A diferencia de lo que suponía el borrador inicial (que asumía un JSON de trazos del lienzo), el módulo `com.artagram.platform.ia` utiliza **modelos multimodales con visión artificial** a través de la API compatible con OpenAI de **Groq** (`https://api.groq.com/openai/v1/chat/completions`), enviando la **imagen de la obra codificada en Base64 Data URI** (`data:image/png;base64,...`).

---

## 2. Componentes Actuales en el Monolito

| Clase | Responsabilidad |
|---|---|
| `ia.IaController` | Expone los 4 endpoints REST de IA para el frontend. |
| `ia.IaService` | Orquesta la lectura de la imagen desde `StorageService` (o desde un `MultipartFile`), selecciona la `EstrategiaAnalisis` según el `TipoAnalisis`, invoca al `ProveedorIa` y persiste el resultado en la tabla `analisis_obra`. |
| `ia.AnalisisObra` / `AnalisisObraRepository` | Entidad JPA mapeada a la tabla `analisis_obra` (migración `V14__analisis_ia.sql`). |
| `ia.TipoAnalisis` | Enum con dos valores: `TECNICO` y `SUGERENCIA_ETIQUETAS`. |
| `ia.prompt.PromptIa` / `PromptIaBuilder` | Patrón **Builder** inmutable con `systemPrompt`, `instruccionUsuario`, `imagenDataUriOUrl`, `maxTokens`, `temperatura`, `modoJson`. |
| `ia.estrategia.EstrategiaAnalisis<T>` | Interfaz del patrón **Strategy** (`getTipo()`, `analizar(imagenDataUriOUrl, proveedor)`, `aJson(resultado)`). |
| `ia.estrategia.AnalisisTecnicoEstrategia` | Estrategia para `TipoAnalisis.TECNICO`. Devuelve `AnalisisTecnicoResultado(puntosFuertes, areasMejora, consejos, scoreEstimado)`. |
| `ia.estrategia.SugerenciaEtiquetasEstrategia` | Estrategia para `TipoAnalisis.SUGERENCIA_ETIQUETAS`. Devuelve `SugerenciaEtiquetasResultado(tituloSugerido, descripcionSugerida, etiquetas)`. |
| `ia.proveedor.ProveedorIa` | Interfaz del cliente LLM (`completar(PromptIa)`, `getNombreModelo()`). |
| `ia.proveedor.GroqProveedorIa` | Cliente HTTP (`java.net.http.HttpClient`) que llama a Groq con payload multimodal (`text` + `image_url`) y `response_format: {"type": "json_object"}`. |
| `ia.proveedor.FakeProveedorIa` | Proveedor determinista para pruebas y desarrollo sin API key (`artagram.ia.proveedor=fake`). |
| `ia.IaProperties` | Propiedades `artagram.ia.*` (`proveedor`, `groq-api-key`, `groq-url`, `modelo`, `timeout-segundos`). |

---

## 3. Endpoints Expuestos y Consumo en `ARTAGRAM-frontv1`

### 3.1 `POST /api/publicaciones/{id}/analisis?tipo=TECNICO`
- **Consumido en:** `PostCard.tsx` (`pedirAnalisisIa()`).
- **Entrada:** `id` de la publicación (UUID) y query param `tipo` (default `TECNICO`).
- **Proceso:**
  1. Busca la `Publicacion` y lee el archivo en `publicacion.getObraFinalRuta()` mediante `StorageService.leer(...)`.
  2. Convierte los bytes a `data:image/png;base64,...`.
  3. Ejecuta `AnalisisTecnicoEstrategia` (`maxTokens = 450`, `temperatura = 0.2`, `modoJson = true`).
  4. Guarda una fila en `analisis_obra` y devuelve `AnalisisObraDto(id, publicacionId, solicitanteId, tipo, resultadoJson, modelo, creadoEn)`.

### 3.2 `GET /api/publicaciones/{id}/analisis/ultimo?tipo=TECNICO`
- **Consumido en:** `PostCard.tsx` (`toggleIa()` al abrir el panel "✨ Feedback IA").
- **Proceso:** Devuelve el último `AnalisisObraDto` guardado para esa publicación y tipo, o `404 ANALISIS_NO_ENCONTRADO` si aún no se ha analizado.

### 3.3 `GET /api/publicaciones/{id}/analisis`
- **Proceso:** Devuelve `List<AnalisisObraDto>` ordenado por `creadoEn DESC`.

### 3.4 `POST /api/ia/sugerencias` (`multipart/form-data`)
- **Consumido en:** `PublishWizard.tsx` (`sugerirConIa()` al pulsar "✨ Sugerir con IA" tras elegir la imagen de la obra, **antes** de publicar).
- **Entrada:** `@RequestParam("imagen") MultipartFile imagen`.
- **Proceso:**
  1. Convierte los bytes del `MultipartFile` a `data:<mime>;base64,...`.
  2. Ejecuta `SugerenciaEtiquetasEstrategia` (`maxTokens = 350`, `temperatura = 0.4`, `modoJson = true`).
  3. Devuelve directamente `SugerenciaEtiquetasResultado(tituloSugerido, descripcionSugerida, etiquetas)` sin guardar en base de datos.

---

## 4. Prompts Exactos (Se conservan idénticos en `artagram-ai-worker`)

### 4.1 `AnalisisTecnicoEstrategia` (`TECNICO`)
- **System Prompt:**
  `"Eres un maestro de bellas artes y crítico de pintura digital enfocado en feedback pedagógico y constructivo."`
- **Instrucción de Usuario:**
  ```text
  Analiza críticamente esta obra visual en español. Evalúa composición, paleta de color, trazo, luz/sombra y perspectiva.
  Responde EXCLUSIVAMENTE con un objeto JSON válido con esta estructura:
  {
    "puntosFuertes": ["puntos positivos..."],
    "areasMejora": ["aspectos a mejorar..."],
    "consejos": ["3 consejos pedagógicos constructivos..."],
    "scoreEstimado": 85
  }
  ```

### 4.2 `SugerenciaEtiquetasEstrategia` (`SUGERENCIA_ETIQUETAS`)
- **System Prompt:**
  `"Eres un curador de arte digital y redactor de portafolios artísticos."`
- **Instrucción de Usuario:**
  ```text
  Observa esta ilustración y genera en español un título evocador, una descripción artística corta y 4 a 6 etiquetas relevantes.
  Responde EXCLUSIVAMENTE con un JSON con esta estructura:
  {
    "tituloSugerido": "Título sugerido...",
    "descripcionSugerida": "Descripción de la obra...",
    "etiquetas": ["estilo", "tecnica", "tema"]
  }
  ```

---

## 5. Diseño de Extracción a `artagram-ai-worker` (Fase 5b)

1. **`artagram-feed`** conserva los 4 endpoints REST (`/api/publicaciones/{id}/analisis*` y `/api/ia/sugerencias`) para que el frontend no cambie.
2. Cuando se invoca `POST /api/publicaciones/{id}/analisis` o `POST /api/ia/sugerencias`, `artagram-feed` publica un mensaje en RabbitMQ (`exchange: artagram.events`, routing key `ai.analyze`) con `replyTo` y `correlationId` (`RabbitTemplate.convertSendAndReceive`, timeout 15 s):
   - Para una publicación existente: envía `postId`, `autorId`, `solicitanteId`, `tipo = TECNICO` y `claveS3 = publicacion.getObraFinalRuta()`.
   - Para `/api/ia/sugerencias`: envía `tipo = SUGERENCIA_ETIQUETAS` e `imagenDataUri` (o clave temporal en S3 si supera 256 KB).
3. **`artagram-ai-worker`** consume `ai.analyze`:
   - Si viene `claveS3`, descarga los bytes desde MinIO/S3 y arma el `data:image/png;base64,...`.
   - Ejecuta el `PromptIaBuilder` + `EstrategiaAnalisis` contra `GroqProveedorIa` (modelo configurable por `GROQ_MODELO`, default `qwen/qwen3.8-27b`) o `FakeProveedorIa` (`LLM_PROVIDER=fake`).
   - Registra la solicitud y métricas (latencia, modelo, estado, resultado) en **MongoDB `db_ia`** (colección `solicitudes_ia`).
   - Responde por el canal `replyTo` de RabbitMQ y además publica `ai.completed` para que `artagram-feed` actualice `analisis_obra` y `artagram-chat` envíe notificación SSE si corresponde.
