// Utilidades compartidas por las pruebas de carga: STOMP sobre WebSocket
// crudo (k6 no trae cliente STOMP) e ids que llevan la hora de envío.
import http from 'k6/http';
import encoding from 'k6/encoding';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
export const WS_URL = __ENV.WS_URL || BASE_URL.replace(/^http/, 'ws') + '/ws';

/** Tokens de prueba (uno por usuario virtual), generados con generar-tokens.mjs. */
export function cargarTokens() {
  return JSON.parse(open(__ENV.TOKENS || './tokens.json'));
}

export function cabeceras(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

export function sujeto(token) {
  return JSON.parse(encoding.b64decode(token.split('.')[1], 'rawurl', 's')).sub;
}

export function frame(comando, encabezados, cuerpo = '') {
  const lineas = Object.entries(encabezados).map(([k, v]) => `${k}:${v}`);
  return `${comando}\n${lineas.join('\n')}\n\n${cuerpo}\0`;
}

/** Separa los frames STOMP de un mensaje WebSocket (puede traer varios o heartbeats). */
export function leerFrames(datos) {
  return datos
    .split('\0')
    .map((f) => f.replace(/^\n+/, ''))
    .filter((f) => f.length > 0)
    .map((f) => {
      const fin = f.indexOf('\n\n');
      const [comando, ...lineas] = f.slice(0, fin).split('\n');
      const encabezados = {};
      for (const l of lineas) {
        const i = l.indexOf(':');
        encabezados[l.slice(0, i)] = l.slice(i + 1);
      }
      return { comando, encabezados, cuerpo: f.slice(fin + 2) };
    });
}

function hex(n, largo) {
  return n.toString(16).padStart(largo, '0');
}

/**
 * UUID versión 7: los primeros 48 bits son la hora en milisegundos. El que
 * recibe el trazo calcula la latencia de punta a punta sin coordinar relojes
 * con el emisor, porque todos los usuarios virtuales corren en la misma máquina.
 */
export function uuidConHora(ahora = Date.now()) {
  const t = hex(ahora, 12);
  const r = () => hex(Math.floor(Math.random() * 0x10000), 4);
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-7${r().slice(1)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${r().slice(1)}-${r()}${r()}${r()}`;
}

export function horaDeUuid(uuid) {
  return parseInt(uuid.replace(/-/g, '').slice(0, 12), 16);
}

export function crearComunidad(token, nombre) {
  const r = http.post(`${BASE_URL}/api/comunidades`, JSON.stringify({ nombre, publica: true }), cabeceras(token));
  if (r.status !== 201) throw new Error(`No se pudo crear la comunidad (${r.status}): ${r.body}`);
  return r.json('id');
}

export function unirse(token, comunidadId) {
  const r = http.post(`${BASE_URL}/api/comunidades/${comunidadId}/miembros`, null, cabeceras(token));
  if (r.status >= 300 && r.status !== 409) throw new Error(`No se pudo unir a ${comunidadId} (${r.status})`);
}
