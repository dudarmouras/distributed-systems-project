'use strict';

const http = require('http');

const BASE = process.env.SERVER_URL || 'http://localhost:3000';

function req(method, path, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload && { 'Content-Length': Buffer.byteLength(payload) }),
      },
    };
    const r = http.request(options, (res) => { res.resume(); resolve(res.statusCode); });
    r.on('error', () => resolve(0));
    if (payload) r.write(payload);
    r.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function hammering(durationMs, concurrency = 20) {
  const end = Date.now() + durationMs;
  let total = 0;
  while (Date.now() < end) {
    await Promise.all(
      Array.from({ length: concurrency }, () =>
        Promise.all([
          req('GET', '/health'),
          req('GET', '/services'),
          req('GET', '/events'),
        ])
      )
    );
    total += concurrency * 3;
  }
  return total;
}

async function run() {
  console.log(`Alvo: ${BASE}\n`);

  // ── Fase 1: probes rápidos, tudo ONLINE ──────────────────────────────────
  console.log('🟢 Fase 1 — intervalo 1000ms: probes ativos com alta frequência (20s)');
  await req('POST', '/api/control/interval', { intervalo: 1000 });
  const r1 = await hammering(20_000, 20);
  console.log(`   ${r1} requests enviadas\n`);

  // ── Fase 2: intervalo > PROBE_TIMEOUT_MS → probes ficam DOWN ────────────
  console.log('🔴 Fase 2 — intervalo 20000ms: probes ficam silenciosos → watchdog marca DOWN (25s)');
  await req('POST', '/api/control/interval', { intervalo: 20_000 });
  const r2 = await hammering(25_000, 20);
  console.log(`   ${r2} requests enviadas\n`);

  // ── Fase 3: volta rápido → probes voltam ONLINE ──────────────────────────
  console.log('🟢 Fase 3 — intervalo 1000ms: probes voltam ONLINE (20s)');
  await req('POST', '/api/control/interval', { intervalo: 1000 });
  const r3 = await hammering(20_000, 20);
  console.log(`   ${r3} requests enviadas\n`);

  // ── Fase 4: repete a queda ────────────────────────────────────────────────
  console.log('🔴 Fase 4 — intervalo 20000ms: segunda queda (25s)');
  await req('POST', '/api/control/interval', { intervalo: 20_000 });
  const r4 = await hammering(25_000, 20);
  console.log(`   ${r4} requests enviadas\n`);

  // ── Fase 5: normaliza ────────────────────────────────────────────────────
  console.log('🟢 Fase 5 — intervalo 5000ms: voltando ao normal (15s)');
  await req('POST', '/api/control/interval', { intervalo: 5_000 });
  const r5 = await hammering(15_000, 10);
  console.log(`   ${r5} requests enviadas\n`);

  console.log('✅ Carga finalizada.');
}

run();