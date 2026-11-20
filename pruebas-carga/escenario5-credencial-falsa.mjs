#!/usr/bin/env node
// Escenario 5: un atacante intenta entrar mandando a POST /api/auth/google
// tokens de Google que no son válidos. Cada intento debe responder 401 (o 403
// si el correo no está verificado) y NO traer token de acceso de Artagram.
//
//   node escenario5-credencial-falsa.mjs [--base http://<alb>] [--vencido <token>] [--otra-app <token>]
//
// Casos que arma solo:
//   1. malformado: texto que ni siquiera es un JWT.
//   2. firma falsa: JWT con todos los datos "correctos" (emisor de Google,
//      audiencia de Artagram, vigente, correo verificado) pero firmado con una
//      llave RSA del atacante, no de Google.
//   3. alterado: el mismo JWT con el correo cambiado en el cuerpo después de
//      firmarlo.
// Casos opcionales con tokens reales de Google:
//   --vencido  un ID token de Google de hace más de 1 hora (por ejemplo uno
//              copiado de la pestaña Red del navegador al iniciar sesión).
//   --otra-app un ID token emitido para otra aplicación (por ejemplo desde
//              https://developers.google.com/oauthplayground con el alcance
//              "openid email").
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pares, v, i, a) => (v.startsWith('--') ? [...pares, [v.slice(2), a[i + 1]]] : pares), []),
);
const BASE = args.base ?? 'http://artagram-alb-1008759631.us-east-1.elb.amazonaws.com';
const CLIENT_ID = args['client-id'] ?? '65529847783-8c36bgbd2b4qooo2dtu6qg13e7lvalke.apps.googleusercontent.com';

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const ahora = Math.floor(Date.now() / 1000);
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

function firmarComoAtacante(cuerpo) {
  const cabecera = b64({ alg: 'RS256', typ: 'JWT', kid: randomUUID().replace(/-/g, '') });
  const datos = `${cabecera}.${b64(cuerpo)}`;
  return `${datos}.${sign('RSA-SHA256', Buffer.from(datos), privateKey).toString('base64url')}`;
}

const victima = {
  iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1' + String(Date.now()).padStart(20, '0'),
  email: 'victima@gmail.com', email_verified: true, name: 'Victima', iat: ahora, exp: ahora + 3600,
};
const falsificado = firmarComoAtacante(victima);
const [h, , f] = falsificado.split('.');
const alterado = `${h}.${b64({ ...victima, email: 'admin@artagram.app' })}.${f}`;

const casos = [
  ['malformado', 'esto-no-es-un-jwt'],
  ['firma falsa (llave del atacante)', falsificado],
  ['alterado después de firmar', alterado],
];
if (args.vencido) casos.push(['token real de Google vencido', args.vencido]);
if (args['otra-app']) casos.push(['token real de Google de otra aplicación', args['otra-app']]);

let rechazados = 0;
let emitidos = 0;
console.log(`Escenario 5 contra ${BASE}/api/auth/google\n`);
for (const [nombre, idToken] of casos) {
  const r = await fetch(`${BASE}/api/auth/google`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
  });
  const texto = await r.text();
  let cuerpo = {};
  try { cuerpo = JSON.parse(texto); } catch { /* respuesta no JSON */ }
  const trajoToken = /accessToken|"token"/i.test(texto);
  if (trajoToken) emitidos++;
  if (r.status === 401 || r.status === 403) rechazados++;
  console.log(`${r.status === 401 || r.status === 403 ? '✔' : '✘'} ${nombre.padEnd(42)} HTTP ${r.status}  ${cuerpo.code ?? ''}  token emitido: ${trajoToken ? 'SÍ' : 'no'}  traceId=${cuerpo.traceId ?? '-'}`);
}
console.log(`\nRechazados: ${rechazados}/${casos.length} (${Math.round((rechazados / casos.length) * 100)} %)`);
console.log(`Tokens de acceso emitidos: ${emitidos}`);
console.log('Los motivos quedan en CloudWatch, grupo /ecs/artagram-auth: "Ingreso con Google rechazado"');
process.exit(rechazados === casos.length && emitidos === 0 ? 0 : 1);
