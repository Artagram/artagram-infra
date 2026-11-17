#!/usr/bin/env node
// Genera N tokens de acceso de usuarios de prueba, firmados RS256 con la llave
// privada de artagram-auth, para las pruebas de carga (el ingreso real es solo
// con Google y no se pueden crear cientos de cuentas a mano).
//
//   node generar-tokens.mjs --cantidad 400 --llave ../secrets-dev/jwt-private.pem > tokens.json
//
// En AWS usa la llave del secret JWT_PRIVATE_KEY_PEM y NO subas tokens.json al
// repositorio (está en .gitignore): son credenciales válidas durante --minutos.
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pares, v, i, a) => (v.startsWith('--') ? [...pares, [v.slice(2), a[i + 1]]] : pares), []),
);
const cantidad = Number(args.cantidad ?? 400);
const minutos = Number(args.minutos ?? 120);
const kid = args.kid ?? 'artagram-key-1';
const emisor = args.emisor ?? 'artagram-auth';
const llave = createPrivateKey(readFileSync(args.llave ?? '../secrets-dev/jwt-private.pem'));

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const ahora = Math.floor(Date.now() / 1000);
const corrida = randomUUID().slice(0, 6);

const tokens = Array.from({ length: cantidad }, (_, i) => {
  const nombre = `carga_${corrida}_${i}`;
  const cabecera = b64({ alg: 'RS256', typ: 'JWT', kid });
  const cuerpo = b64({
    sub: randomUUID(), iss: emisor, iat: ahora, exp: ahora + minutos * 60,
    nombreArtista: nombre, nombre, rolGlobal: 'USUARIO', rol: 'USUARIO', premium: false,
  });
  const firma = sign('RSA-SHA256', Buffer.from(`${cabecera}.${cuerpo}`), llave).toString('base64url');
  return `${cabecera}.${cuerpo}.${firma}`;
});
process.stdout.write(JSON.stringify(tokens));
