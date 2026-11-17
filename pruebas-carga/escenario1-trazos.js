// Escenario 1: 400 usuarios en 50 salas de 8, 30 eventos de trazo por segundo
// cada uno. Mide de punta a punta (emisión -> recepción en los otros 7 de la
// sala, aunque estén en otra réplica) y cuenta los trazos perdidos.
//
//   k6 run -e BASE_URL=http://<alb> -e TOKENS=tokens.json escenario1-trazos.js
import ws from 'k6/ws';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { WS_URL, cargarTokens, crearComunidad, frame, horaDeUuid, leerFrames, sujeto, unirse, uuidConHora } from './lib/comun.js';

const SALAS = Number(__ENV.SALAS || 50);
const POR_SALA = Number(__ENV.POR_SALA || 8);
const EVENTOS_POR_SEG = Number(__ENV.EVENTOS_POR_SEG || 30);
const DURACION_S = Number(__ENV.DURACION_S || 120);
const USUARIOS = SALAS * POR_SALA;

const tokens = cargarTokens();
const latencia = new Trend('trazo_e2e_ms', true);
const enviados = new Counter('trazos_enviados');
const recibidos = new Counter('trazos_recibidos_de_otros');
const errores = new Rate('errores_stomp');

export const options = {
  scenarios: {
    salas: { executor: 'per-vu-iterations', vus: USUARIOS, iterations: 1, maxDuration: `${DURACION_S + 120}s` },
  },
  thresholds: {
    trazo_e2e_ms: ['p(95)<200'],
    errores_stomp: ['rate<0.01'],
  },
  setupTimeout: '5m',
};

export function setup() {
  if (tokens.length < USUARIOS) throw new Error(`Se necesitan ${USUARIOS} tokens y hay ${tokens.length}`);
  const salas = [];
  for (let s = 0; s < SALAS; s++) {
    const id = crearComunidad(tokens[s * POR_SALA], `carga-e1-${Date.now()}-${s}`);
    for (let i = 1; i < POR_SALA; i++) unirse(tokens[s * POR_SALA + i], id);
    salas.push(id);
  }
  return { salas };
}

export default function ({ salas }) {
  const indice = __VU - 1;
  const token = tokens[indice];
  const yo = sujeto(token);
  const sala = salas[Math.floor(indice / POR_SALA)];
  const destinoTopico = `/topic/lienzo/${sala}`;

  const res = ws.connect(`${WS_URL}?token=${encodeURIComponent(token)}`, {}, (socket) => {
    socket.on('open', () => {
      socket.send(frame('CONNECT', { 'accept-version': '1.2', 'heart-beat': '0,0', host: 'artagram' }));
    });
    socket.on('message', (datos) => {
      for (const f of leerFrames(datos)) {
        if (f.comando === 'CONNECTED') {
          socket.send(frame('SUBSCRIBE', { id: 'lienzo', destination: destinoTopico }));
          // Esperar a que todos se suscriban antes de dibujar.
          socket.setTimeout(() => {
            socket.setInterval(() => {
              const cuerpo = JSON.stringify({
                trazoEnProgresoId: uuidConHora(), tipoPincel: 'MARCADOR', colorHex: '#FF6B57',
                grosor: 4, opacidad: 1, capa: 0, puntos: [{ x: Math.random(), y: Math.random() }],
              });
              socket.send(frame('SEND', { destination: `/app/lienzo/${sala}/parcial`, 'content-type': 'application/json' }, cuerpo));
              enviados.add(1);
            }, 1000 / EVENTOS_POR_SEG);
          }, 5000);
          socket.setTimeout(() => socket.close(), (DURACION_S + 10) * 1000);
        } else if (f.comando === 'MESSAGE') {
          const evento = JSON.parse(f.cuerpo);
          if (evento.autorId !== yo && evento.trazoEnProgresoId) {
            latencia.add(Date.now() - horaDeUuid(evento.trazoEnProgresoId));
            recibidos.add(1);
          }
          errores.add(false);
        } else if (f.comando === 'ERROR') {
          errores.add(true);
        }
      }
    });
    socket.on('error', () => errores.add(true));
  });
  check(res, { 'WebSocket abierto (101)': (r) => r && r.status === 101 });
}

export function handleSummary(data) {
  const env = data.metrics.trazos_enviados?.values.count ?? 0;
  const rec = data.metrics.trazos_recibidos_de_otros?.values.count ?? 0;
  // Cada trazo debe llegar a los otros POR_SALA - 1 de su sala. Al final
  // quedan algunos en vuelo al cerrar, por eso se reporta en vez de exigir 0.
  const esperados = env * (POR_SALA - 1);
  const perdidos = Math.max(0, esperados - rec);
  const resumen = {
    enviados: env, recibidos: rec, esperados, perdidos,
    porcentaje_perdido: esperados ? ((perdidos / esperados) * 100).toFixed(3) : '0',
    p95_ms: data.metrics.trazo_e2e_ms?.values['p(95)'],
  };
  return { stdout: `\nEscenario 1\n${JSON.stringify(resumen, null, 2)}\n`, 'resultado-escenario1.json': JSON.stringify(data) };
}
