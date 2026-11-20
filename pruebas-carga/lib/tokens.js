// Firma tokens de usuarios de prueba dentro de k6, igual que generar-tokens.mjs,
// para correr las pruebas desde una tarea de ECS donde no hay un tokens.json a
// mano: la llave privada llega en la variable LLAVE_PEM (PKCS#8, la misma del
// secret JWT_PRIVATE_KEY_PEM de artagram-auth).
import encoding from 'k6/encoding';

function base64url(texto) {
  return encoding.b64encode(texto, 'rawurl');
}

function bytesDePem(pem) {
  const cuerpo = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return new Uint8Array(encoding.b64decode(cuerpo, 'std'));
}

function uuid() {
  return crypto.randomUUID();
}

export async function generarTokens(cantidad, pem, minutos = 180) {
  const llave = await crypto.subtle.importKey(
    'pkcs8', bytesDePem(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const ahora = Math.floor(Date.now() / 1000);
  const corrida = uuid().slice(0, 6);
  const cabecera = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: __ENV.KID || 'artagram-key-1' }));
  const tokens = [];
  for (let i = 0; i < cantidad; i++) {
    const nombre = `carga_${corrida}_${i}`;
    const cuerpo = base64url(JSON.stringify({
      sub: uuid(), iss: __ENV.EMISOR || 'artagram-auth', iat: ahora, exp: ahora + minutos * 60,
      nombreArtista: nombre, nombre, rolGlobal: 'USUARIO', rol: 'USUARIO', premium: false,
    }));
    const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', llave, new TextEncoder().encode(`${cabecera}.${cuerpo}`));
    tokens.push(`${cabecera}.${cuerpo}.${encoding.b64encode(firma, 'rawurl')}`);
  }
  return tokens;
}
