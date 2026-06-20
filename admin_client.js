const http = require('http');

const SERVER_URL   = process.env.SERVER_URL  || 'http://localhost:3000';
const REFRESH_SEC  = parseInt(process.env.REFRESH || '5', 10);
const REFRESH_MS   = REFRESH_SEC * 1000;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Faz uma requisição GET e resolve com o JSON parseado.
 * @param {string} url
 * @returns {Promise<object>}
*/
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(new Error(`Falha ao fazer parse da resposta de ${url}: ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

// Limpa o terminal para reescrever o dashboard.
function clearConsole() {
  process.stdout.write('\x1Bc');
}

// ─── Exibição Principal ──────────────────────────────────────────────────────

async function displayStatus() {
  try {
    // Busca /health e /services em paralelo para minimizar latência de exibição
    const [healthData, servicesData] = await Promise.all([
      fetchJson(`${SERVER_URL}/health`),
      fetchJson(`${SERVER_URL}/services`),
    ]);

    clearConsole();

    const now = new Date().toISOString();
    console.log('════════════════════════════════════════════════════════════════');
    console.log('  DASHBOARD ADMINISTRADOR — Saúde de Microsserviços');
    console.log(`  Atualizado em: ${now}`);
    console.log('════════════════════════════════════════════════════════════════');
    console.log();

    // ── Seção 1: Status do Agente Coletor ─────────────────────────────────
    const statusIcon = healthData.status === 'ok' ? '[OK]' : '[DEGRADADO]';
    console.log('  ── AGENTE COLETOR ──────────────────────────────────────────');
    console.log(`  Status:            ${statusIcon}`);
    console.log(`  Uptime:            ${healthData.uptimeSeconds}s`);
    console.log(`  Probes Monitorados:${healthData.servicesMonitored}`);
    console.log(`  Ingestões MQTT:    ${healthData.totalIngestsReceived}`);
    console.log(`  Erros de Validação:${healthData.totalValidationErrors}`);
    console.log(`  Servidor iniciado: ${new Date(healthData.serverStartedAt).toISOString()}`);
    console.log();

    // ── Seção 2: Tabela de Microsserviços ─────────────────────────────────
    console.log('  ── MICROSSERVIÇOS MONITORADOS ──────────────────────────────');

    if (servicesData.services.length === 0) {
      console.log('  Nenhum probe conectado. Aguardando heartbeats MQTT...');
    } else {
      const col1 = 'PROBE_ID'.padEnd(25);
      const col2 = 'UPTIME(s)'.padEnd(12);
      const col3 = 'LATENCIA(ms)'.padEnd(14);
      const col4 = 'ULTIMO HEARTBEAT';
      console.log(`  ${col1} ${col2} ${col3} ${col4}`);
      console.log('  ' + '─'.repeat(72));

      for (const svc of servicesData.services) {
        const id     = svc.probe_id.padEnd(25);
        const uptime = String(svc.uptime).padEnd(12);
        const latMs  = `${svc.latencia}ms`.padEnd(14);
        const hb     = new Date(svc.ultimo_heartbeat).toISOString();
        console.log(`  ${id} ${uptime} ${latMs} ${hb}`);
      }
    }

    console.log();
    console.log('════════════════════════════════════════════════════════════════');
    console.log(`  Servidor: ${SERVER_URL} | Atualizando a cada ${REFRESH_SEC}s | Ctrl+C para sair`);
    console.log('════════════════════════════════════════════════════════════════');

  } catch (error) {
    clearConsole();
    console.error('  ERRO: Nao foi possivel conectar ao servidor.');
    console.error(`  Detalhe: ${error.message}`);
    console.log();
    console.log(`  Verifique se o servidor esta rodando em: ${SERVER_URL}`);
    console.log('  Dica: execute "docker-compose up -d" e tente novamente.');
    console.log();
    console.log(`  Tentando reconectar em ${REFRESH_SEC}s...`);
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────

console.log(`Conectando ao servidor em ${SERVER_URL}...`);
displayStatus();
setInterval(displayStatus, REFRESH_MS);