// Escenario 4: dos navegadores en el mismo lienzo; al navegador A se le corta
// la red, dibuja sin conexión y se le devuelve. Mide la reconexión y compara
// los lienzos. Guarda capturas reales de la app en OUT.
//
//   npm i --no-save playwright@1.49.1 && npx playwright install firefox
//   node generar-tokens.mjs --cantidad 2 --llave <jwt.pem> > tokens-e4.json
//   PAR=0 node escenario4-navegador.mjs <carpeta-salida> tokens-e4.json
//
// PAR es el índice del primer token (A); B usa el siguiente. Cada usuario
// gratis puede crear hasta 3 comunidades, así que cambia PAR o los tokens.
import { firefox } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const FRONT = process.env.FRONT ?? 'https://dm9jdgs6nc89v.cloudfront.net';
const API = process.env.API ?? 'http://artagram-alb-1008759631.us-east-1.elb.amazonaws.com';
const OUT = process.argv[2];
const tokens = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const base = Number(process.env.PAR || 0);
const [tA, tB] = [tokens[base], tokens[base + 1]];
const log = [];
const nota = (m) => { const l = `${new Date().toLocaleTimeString('es-CO', { hour12: false })}.${String(Date.now() % 1000).padStart(3, '0')}  ${m}`; console.log(l); log.push(l); };

const claims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
const sesion = (t) => { const c = claims(t); return { accessToken: t, usuarioId: c.sub, nombreArtista: c.nombreArtista, rolGlobal: 'USUARIO', premium: false }; };
const api = async (t, metodo, ruta, cuerpo) => {
  const r = await fetch(API + ruta, { method: metodo, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  if (r.status >= 300 && r.status !== 409) throw new Error(`${metodo} ${ruta} -> ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
};

const comunidad = await api(tA, 'POST', '/api/comunidades', { nombre: `Escenario 4 ${Date.now() % 100000}`, publica: true });
await api(tB, 'POST', `/api/comunidades/${comunidad.id}/miembros`);
nota(`Comunidad ${comunidad.id}: A=${sesion(tA).nombreArtista} B=${sesion(tB).nombreArtista}`);

const navegador = await firefox.launch();
// Red simulada del navegador A: su WebSocket pasa por un proxy de Playwright.
// "Cortar la red" cierra los sockets abiertos, rechaza las reconexiones y
// bloquea el HTTP (setOffline) hasta que se devuelve.
const redA = { sinRed: false, sockets: [] };
async function abrir(t, simularRed) {
  const ctx = await navegador.newContext({ viewport: { width: 1100, height: 760 } });
  await ctx.addInitScript((s) => localStorage.setItem('artagram.sesion', s), JSON.stringify(sesion(t)));
  if (simularRed) {
    await ctx.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      if (redA.sinRed) { ws.close({ code: 4000, reason: 'sin red' }); return; }
      redA.sockets.push({ ws, servidor: ws.connectToServer() });
    });
  }
  const page = await ctx.newPage();
  await page.goto(`${FRONT}/comunidades/${comunidad.id}/lienzo`, { waitUntil: 'domcontentloaded' });
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30000 });
  return { ctx, page };
}
const A = await abrir(tA, true);
await A.page.exposeFunction('notaOnline', () => nota('   [A] el navegador disparó el evento online'));
await A.page.evaluate(() => window.addEventListener('online', () => window.notaOnline()));
// evento online
const B = await abrir(tB);
A.page.on('request', (r) => { if (r.url().includes('/lienzo/trazos')) nota(`   [A] GET ${r.url().replace(/.*\/api/, '/api')}`); });
A.page.on('response', (r) => { if (r.url().includes('/lienzo/trazos')) r.json().then((d) => nota(`   [A] respuesta ${r.status()} con ${Array.isArray(d) ? d.length : '?'} trazos`)).catch(() => nota(`   [A] respuesta ${r.status()}`)); });
A.page.on('requestfailed', (r) => { if (r.url().includes('/api/')) nota(`   [A] FALLÓ ${r.url().replace(/.*\/api/, '/api')}: ${r.failure()?.errorText}`); });
A.page.on('console', (m) => { if (/error|warn/i.test(m.type())) nota(`   [A consola] ${m.text().slice(0, 160)}`); });
await A.page.waitForTimeout(3000);

async function trazo(page, x0, y0, x1, y1) {
  const caja = await page.locator('canvas').first().boundingBox();
  await page.mouse.move(caja.x + x0, caja.y + y0);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(caja.x + x0 + ((x1 - x0) * i) / 20, caja.y + y0 + ((y1 - y0) * i) / 20);
  await page.mouse.up();
}
const huella = async (page) => createHash('sha256').update(await page.locator('canvas').first().evaluate((c) => c.toDataURL())).digest('hex').slice(0, 16);
const capturar = async (nombre) => {
  await A.page.screenshot({ path: `${OUT}/${nombre}-A.png` });
  await B.page.screenshot({ path: `${OUT}/${nombre}-B.png` });
};

nota('1. Los dos navegadores abren el mismo lienzo');
await capturar('1-inicio');

await trazo(A.page, 150, 150, 450, 250);
await B.page.waitForTimeout(1500);
nota('2. A dibuja con conexión: el trazo llega a B en vivo');
await capturar('2-con-conexion');

const banner = A.page.getByText('Se perdió la conexión');
redA.sinRed = true;
await A.ctx.setOffline(true);
for (const { ws, servidor } of redA.sockets.splice(0)) { ws.close({ code: 4000, reason: 'corte de red' }); servidor.close(); }
const tCorte = Date.now();
nota('3. Se corta la red del navegador A');
await banner.waitFor({ state: 'visible', timeout: 30000 });
nota(`   A muestra el aviso de reconexión ${Date.now() - tCorte} ms después del corte`);
await capturar('3-sin-red');

await trazo(A.page, 150, 400, 450, 300);
await trazo(B.page, 600, 150, 800, 450);
await B.page.waitForTimeout(1500);
nota('4. Sin red, A dibuja un trazo (queda en su cola) y B dibuja otro');
await capturar('4-dibujando-sin-red');

redA.sinRed = false;
await A.ctx.setOffline(false);
const tVuelta = Date.now();
nota('5. Vuelve la red del navegador A');
await banner.waitFor({ state: 'hidden', timeout: 30000 });
const reconexion = Date.now() - tVuelta;
nota(`   A reconectó en ${reconexion} ms (el aviso desaparece)`);
await A.page.waitForTimeout(3000);
await capturar('5-reconectado');

const [hA, hB] = [await huella(A.page), await huella(B.page)];
nota(`6. Huella del lienzo (SHA-256 de los píxeles): A=${hA} B=${hB} -> ${hA === hB ? 'IDÉNTICOS' : 'DISTINTOS'}`);
nota(`RESULTADO: reconexión ${reconexion} ms (pide < 5000 ms); lienzos ${hA === hB ? 'idénticos' : 'distintos'}`);
writeFileSync(`${OUT}/resumen.txt`, log.join('\n') + '\n');
await navegador.close();
