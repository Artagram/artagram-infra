// Escenario 6: 20 peticiones por minuto a una ruta protegida sin token, con
// token vencido, con la firma alterada y firmado con otra llave. Todas deben
// recibir 401 del gateway y, desde el intento 10 del minuto, 429 con el origen
// bloqueado.
//
//   k6 run -e BASE_URL=http://<alb> -e TOKEN_VALIDO=<jwt> escenario6-token-invalido.js
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import encoding from 'k6/encoding';
import { BASE_URL } from './lib/comun.js';

const rechazadas = new Counter('rechazadas_401');
const bloqueadas = new Counter('bloqueadas_429');
const filtradas = new Counter('respuestas_no_esperadas');
// Sin respuesta (status 0): la conexión no se abrió, así que la petición no
// llegó a nada. Se cuenta aparte para no confundirla con una que se coló.
const sinConexion = new Counter('sin_conexion');

export const options = {
  scenarios: {
    atacante: { executor: 'constant-arrival-rate', rate: 20, timeUnit: '1m', duration: __ENV.DURACION || '3m', preAllocatedVUs: 2 },
  },
  thresholds: {
    respuestas_no_esperadas: ['count==0'],
    bloqueadas_429: ['count>0'],
  },
};

function b64(obj) {
  return encoding.b64encode(JSON.stringify(obj), 'rawurl');
}

// Token con la firma de otro (no la de artagram-auth) y uno ya vencido.
const valido = __ENV.TOKEN_VALIDO || '';
const partes = valido.split('.');
const tokens = [
  null,
  `${b64({ alg: 'RS256', kid: 'artagram-key-1' })}.${b64({ sub: 'x', exp: 1 })}.${partes[2] || 'firma'}`,
  partes.length === 3 ? `${partes[0]}.${b64({ sub: '00000000-0000-0000-0000-000000000000', rol: 'ADMIN', exp: 4102444800 })}.${partes[2]}` : 'a.b.c',
  `${b64({ alg: 'RS256', kid: 'otra-llave' })}.${b64({ sub: 'x', exp: 4102444800 })}.${encoding.b64encode('firma-falsa', 'rawurl')}`,
];

export default function () {
  const token = tokens[Math.floor(Math.random() * tokens.length)];
  const r = http.get(`${BASE_URL}/api/feed/siguiendo`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  if (r.status === 401) rechazadas.add(1);
  else if (r.status === 429) bloqueadas.add(1);
  else if (r.status === 0) sinConexion.add(1);
  else filtradas.add(1);
  check(r, { 'no llegó al microservicio (401/429)': () => r.status === 401 || r.status === 429 || r.status === 0 });
}
