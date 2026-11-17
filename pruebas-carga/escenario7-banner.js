// Escenario 7: un usuario con un script envía 1000 eventos por segundo al
// banner mientras 30 artistas dibujan. El servidor acepta 100/s del atacante y
// los artistas deben mantener p95 < 200 ms en sus propios trazos.
//
//   k6 run -e BASE_URL=http://<alb> -e TOKENS=tokens.json escenario7-banner.js
import ws from 'k6/ws';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { WS_URL, cargarTokens, crearComunidad, frame, leerFrames, sujeto, unirse } from './lib/comun.js';

const ARTISTAS = Number(__ENV.ARTISTAS || 30);
const DURACION_S = Number(__ENV.DURACION_S || 90);
const tokens = cargarTokens();
const latencia = new Trend('banner_artistas_ms', true);
const ataqueEnviados = new Counter('ataque_eventos_enviados');
const ataqueRechazados = new Counter('ataque_eventos_rechazados');

export const options = {
  scenarios: {
    artistas: { executor: 'per-vu-iterations', vus: ARTISTAS, iterations: 1, exec: 'artista', maxDuration: `${DURACION_S + 60}s` },
    atacante: { executor: 'per-vu-iterations', vus: 1, iterations: 1, exec: 'atacante', startTime: '10s', maxDuration: `${DURACION_S + 60}s` },
  },
  thresholds: { banner_artistas_ms: ['p(95)<200'] },
};

export function setup() {
  const id = crearComunidad(tokens[0], `carga-e7-${Date.now()}`);
  for (let i = 1; i <= ARTISTAS; i++) unirse(tokens[i], id);
  return { comunidad: id };
}

function pintar(comunidad, color) {
  return frame('SEND', { destination: `/app/banner/${comunidad}/pintar`, 'content-type': 'application/json' },
    JSON.stringify({ regionIndex: Math.floor(Math.random() * 16), tipoPincel: 'MARCADOR', colorHex: color,
      grosor: 6, opacidad: 1, puntos: [{ x: Math.random(), y: Math.random() }, { x: Math.random(), y: Math.random() }] }));
}

function sesion(token, alConectar, alMensaje) {
  return ws.connect(`${WS_URL}?token=${encodeURIComponent(token)}`, {}, (socket) => {
    socket.on('open', () => socket.send(frame('CONNECT', { 'accept-version': '1.2', 'heart-beat': '0,0', host: 'artagram' })));
    socket.on('message', (datos) => {
      for (const f of leerFrames(datos)) {
        if (f.comando === 'CONNECTED') alConectar(socket);
        else alMensaje(f, socket);
      }
    });
    socket.setTimeout(() => socket.close(), DURACION_S * 1000);
  });
}

// Cada artista dibuja 5 trazos por segundo y mide cuánto tarda en volver el
// suyo: el color lleva un contador para reconocerlo.
export function artista({ comunidad }) {
  const token = tokens[__VU];
  const yo = sujeto(token);
  const enviados = new Map();
  let contador = 0;
  const res = sesion(token, (socket) => {
    socket.send(frame('SUBSCRIBE', { id: 'banner', destination: `/topic/banner/${comunidad}` }));
    socket.setInterval(() => {
      contador = (contador + 1) % 0xffffff;
      const color = `#${contador.toString(16).padStart(6, '0')}FF`;
      enviados.set(color.toUpperCase(), Date.now());
      socket.send(pintar(comunidad, color));
    }, 200);
  }, (f) => {
    if (f.comando !== 'MESSAGE') return;
    const evento = JSON.parse(f.cuerpo);
    const inicio = evento.autorId === yo && enviados.get(String(evento.colorHex).toUpperCase());
    if (inicio) latencia.add(Date.now() - inicio);
  });
  check(res, { 'WebSocket abierto (101)': (r) => r && r.status === 101 });
}

export function atacante({ comunidad }) {
  const token = tokens[0];
  const res = sesion(token, (socket) => {
    socket.send(frame('SUBSCRIBE', { id: 'errores', destination: '/user/queue/errores' }));
    // 1000 eventos por segundo: 50 cada 50 ms.
    socket.setInterval(() => {
      for (let i = 0; i < 50; i++) socket.send(pintar(comunidad, '#000000FF'));
      ataqueEnviados.add(50);
    }, 50);
  }, (f) => {
    if (f.comando === 'MESSAGE' && f.encabezados.destination?.includes('errores')) ataqueRechazados.add(1);
  });
  check(res, { 'WebSocket abierto (101)': (r) => r && r.status === 101 });
}
