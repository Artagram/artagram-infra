// Escenario 2: 500 usuarios cargan el feed y hacen scroll mientras se cae una
// réplica de feed. Correr con 2 o más réplicas de feed y del gateway, y a la
// mitad de la prueba detener una tarea de feed (ver README).
//
//   k6 run -e BASE_URL=http://<alb> -e TOKENS=tokens.json escenario2-feed.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { BASE_URL, cabeceras, cargarTokens } from './lib/comun.js';

const tokens = cargarTokens();
const atendidas = new Rate('peticiones_atendidas');

export const options = {
  scenarios: {
    pico: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: Number(__ENV.USUARIOS || 500) },
        { duration: __ENV.DURACION || '4m', target: Number(__ENV.USUARIOS || 500) },
        { duration: '20s', target: 0 },
      ],
    },
  },
  thresholds: {
    peticiones_atendidas: ['rate>=0.99'],
    'http_req_duration{pagina:feed}': ['p(95)<1000'],
  },
};

export default function () {
  const token = tokens[(__VU - 1) % tokens.length];
  const pestana = Math.random() < 0.5 ? 'explorar' : 'siguiendo';
  for (let pagina = 0; pagina < 3; pagina++) {
    const r = http.get(`${BASE_URL}/api/feed/${pestana}?pagina=${pagina}`, {
      ...cabeceras(token),
      tags: { pagina: 'feed' },
    });
    const ok = r.status === 200;
    atendidas.add(ok);
    check(r, { 'feed 200': () => ok });
    sleep(1 + Math.random() * 2); // scroll
  }
}
