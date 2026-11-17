# Mercado Pago: credenciales, webhook y activación

El código ya está completo en `artagram-payment` y en el frontend. Falta crear
las credenciales y activar el proveedor real. Todo lo de esta guía es en modo
de prueba: ningún pago mueve dinero real.

## Cómo funciona el cobro

1. El botón **PRO** llama a `POST /api/suscripcion/checkout`. `payment` crea una
   preferencia de Checkout Pro (20 000 COP, `external_reference` = id del
   usuario) y el navegador va a la página de pago de Mercado Pago.
2. Al pagar, Mercado Pago:
   - devuelve al navegador a `/suscripcion/resultado?payment_id=…&status=…`, y
   - envía un **webhook** firmado a `/api/pagos/webhook/mercadopago`.
3. Las dos vías terminan en lo mismo: `payment` **consulta el pago a la API de
   Mercado Pago** (nunca confía en lo que trae el navegador o el webhook),
   comprueba estado `approved`, monto, moneda y que no se haya procesado antes,
   activa PRO por 30 días y publica `subscription.updated`.
   - Webhook: la firma `x-signature` (HMAC-SHA256 con la clave secreta) se
     verifica antes de todo.
   - Retorno del navegador: `POST /api/suscripcion/verificar?pagoId=` exige
     además que el pago sea del usuario que pregunta. Así el plan se activa
     aunque el webhook tarde o no llegue.
4. El frontend refresca el JWT hasta que trae `premium: true`.

## 1. Crear la aplicación y las cuentas de prueba

1. Entra a <https://www.mercadopago.com.co/developers/panel/app> con tu cuenta
   de Mercado Pago y pulsa **Crear aplicación**:
   - Nombre: `Artagram`.
   - Tipo de solución: **Pagos online** → **Checkout Pro**.
2. Dentro de la aplicación, ve a **Cuentas de prueba** y crea dos, con país
   **Colombia**:
   - **Vendedor** (cobra los pagos).
   - **Comprador** (con el que pagarás en las pruebas).
   Guarda usuario y contraseña de cada una.
3. Abre una ventana privada, inicia sesión en
   <https://www.mercadopago.com.co/developers> **con la cuenta de prueba
   vendedora** y crea ahí otra aplicación igual (`Artagram`, Checkout Pro).
4. En esa aplicación del vendedor de prueba, abre **Credenciales de
   producción** y copia el **Access Token** (`APP_USR-…`). Al pertenecer a una
   cuenta de prueba, todos sus cobros son ficticios.

> Si prefieres las **credenciales de prueba** (`TEST-…`) de tu aplicación
> principal, también sirven para crear la preferencia; si el checkout no deja
> pagar con el comprador de prueba, usa el camino de los pasos 3 y 4.

## 2. Configurar el webhook

En la aplicación del vendedor de prueba:

1. **Webhooks → Configurar notificaciones**.
2. URL (modo productivo):
   `https://dm9jdgs6nc89v.cloudfront.net/api/pagos/webhook/mercadopago`
3. Evento: **Pagos**. Guarda.
4. Copia la **clave secreta** que aparece: es `MERCADOPAGO_WEBHOOK_SECRET`.
5. El botón **Simular** debe responder `200` cuando `payment` esté encendido
   (con una firma inválida responde `401 FIRMA_INVALIDA`, que también prueba
   que la verificación funciona).

CloudFront debe pasar al ALB las cabeceras `x-signature` y `x-request-id` y la
query string (`data.id`, `type`) en el comportamiento `/api/*`. Con la política
de origen `AllViewer` (o `AllViewerExceptHostHeader`) ya ocurre. Si el webhook
siempre falla con `401`, revisa esa política en la distribución
`E2FJFS7QLT0BH6`.

## 3. Secretos y variables en GitHub

En la organización `Artagram` (o en el repo `artagram-payment`):

| Tipo | Nombre | Valor |
|---|---|---|
| Secret | `MP_ACCESS_TOKEN` | Access Token del paso 1.4 |
| Secret | `MERCADOPAGO_WEBHOOK_SECRET` | Clave secreta del paso 2.4 |
| Secret | `PAGO_PROVEEDOR` | `mercadopago` |

En `ARTAGRAM-frontv1`:

| Tipo | Nombre | Valor |
|---|---|---|
| Variable | `PAGOS_ACTIVOS` | `true` |

`PAGO_RETORNO_URL`, `PRO_PRECIO` y `PRO_MONEDA` ya están en la task definition
de `payment`. Ojo: `PAGO_PROVEEDOR` no puede quedar vacío (Spring no aplica el
valor por defecto a una variable presente pero vacía y `payment` no arranca).

## 4. Desplegar y encender

1. Fusiona a `main` los PR de `artagram-payment` y `ARTAGRAM-frontv1`, o haz
   un commit vacío en cada uno, para que el CI/CD tome los secretos nuevos.
2. Sube `artagram-payment` a 1 tarea (hasta ahora quedaba en 0 porque el
   proveedor era `fake`):
   `aws ecs update-service --cluster artagram-cluster --service artagram-payment --desired-count 1`
3. Comprueba en `/ecs/artagram-payment` que no aparezca
   `PAGO_PROVEEDOR=mercadopago requiere MP_ACCESS_TOKEN`.

## 5. Probar una compra

1. Ingresa a Artagram con tu cuenta y pulsa **PRO**.
2. En Mercado Pago, inicia sesión con el **comprador de prueba** y paga con
   una tarjeta de prueba de Colombia (lista oficial en
   <https://www.mercadopago.com.co/developers/es/docs/checkout-pro/additional-content/your-integrations/test/cards>).
   El nombre del titular decide el resultado: `APRO` aprobado, `OTHE`
   rechazado, `CONT` pendiente. Documento: `CC` `123456789`.
3. Debes volver a `/suscripcion/resultado` con "¡Ya eres PRO!".
4. En `/ecs/artagram-payment` verás la verificación del pago; si llega el
   webhook después, se registra como `ya procesado` (no se cobra ni se
   extiende dos veces).

Para pasar a pagos reales bastaría reemplazar `MP_ACCESS_TOKEN` y la clave del
webhook por los de tu aplicación principal (credenciales de producción).
