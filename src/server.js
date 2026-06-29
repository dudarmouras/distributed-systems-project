const express = require('express');
const mqtt = require('mqtt');
const path = require('path');
const { spawn } = require('child_process');
const { getMetricsText, getContentType } = require('./collectors/metricsCollector');
const { updateStatusMetric } = require('./collectors/metricsCollector');
const healthRouter = require('./routes/monitoring');
const { handleMqttMessage } = require('./handlers/mqttHandler');
const {
  getAllServices,
  getStats,
  restoreFromDisk,
  persistSnapshot,
  checkStaleProbes,
  STALE_TIMEOUT_MS,
} = require('./state/store');

// ─── Gerenciamento de Processos de Probes ────────────────────────────────────

// Mapa de probe_id -> script filename
const PROBE_SCRIPTS = {
  'probe_pagamentos':   'pagamentos.js',
  'probe_autenticacao': 'autenticacao.js',
  'probe_pedidos':      'pedidos.js',
  'probe_estoque':      'estoque.js',
  'probe_gateway':      'gateway.js',
  'probe_notificacoes': 'notificacoes.js',
  'probe_relatorios':   'relatorios.js',
  'probe_cache':        'cache.js',
};

// Rastreia processos filhos iniciados pelo servidor
const managedProbes = new Map(); // probe_id -> ChildProcess

function spawnProbe(probe_id) {
  const script = PROBE_SCRIPTS[probe_id];
  if (!script) return { ok: false, error: `probe_id desconhecido: ${probe_id}` };
  if (managedProbes.has(probe_id)) return { ok: false, error: `${probe_id} ja esta sendo gerenciado.` };

  const probePath = path.join(__dirname, '..', 'probes', script);
  const child = spawn('node', [probePath], {
    env: { ...process.env },
    stdio: 'inherit',
  });

  managedProbes.set(probe_id, child);
  console.log(`[PROBE MANAGER] Iniciado: ${probe_id} (PID ${child.pid})`);

  child.on('close', (code) => {
    console.log(`[PROBE MANAGER] Encerrado: ${probe_id} (codigo ${code})`);
    managedProbes.delete(probe_id);
  });

  return { ok: true };
}

function getManagedStatus() {
  const result = {};
  for (const probe_id of Object.keys(PROBE_SCRIPTS)) {
    result[probe_id] = managedProbes.has(probe_id) ? 'managed' : 'unmanaged';
  }
  return result;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = 3000;
const ADMIN_TABLE_INTERVAL = 10 * 1000;
const WATCHDOG_INTERVAL = 5 * 1000;
const PERSIST_INTERVAL = 10 * 1000;

restoreFromDisk();

const app = express();
app.use(express.json());

// CORS para o Grafana
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Conexao MQTT ─────────────────────────────────────────────────────────────

const mqttClient = mqtt.connect('mqtt://mosquitto:1883');

mqttClient.on('connect', () => {
  console.log('MQTT: Conectado ao Broker Mosquitto');
  mqttClient.subscribe('probes/+/metrics', (err) => {
    if (!err) console.log('MQTT: Escutando dados no barramento probes/+/metrics');
  });
});

mqttClient.on('message', (topic, message) => {
  handleMqttMessage(topic, message);
});

// ─── Routes HTTP ──────────────────────────────────────────────────────────────

// Altera o intervalo N de todos os probes via MQTT
app.post('/api/control/interval', (req, res) => {
  const { intervalo } = req.body;

  if (intervalo === undefined || intervalo === null)
    return res.status(400).json({ error: 'O campo "intervalo" e obrigatorio.' });
  if (typeof intervalo !== 'number' || !Number.isFinite(intervalo))
    return res.status(400).json({ error: 'O intervalo deve ser um numero.' });
  if (!Number.isInteger(intervalo))
    return res.status(400).json({ error: 'O intervalo deve ser um numero inteiro de milissegundos.' });
  if (intervalo < 1000)
    return res.status(400).json({ error: 'O intervalo minimo permitido e 1000ms.' });
  if (intervalo > 300000)
    return res.status(400).json({ error: 'O intervalo maximo permitido e 300000ms (5 minutos).' });

  mqttClient.publish('probes/control', JSON.stringify({ novo_intervalo: intervalo }));
  console.log(`\n[ADMIN] Comando remoto enviado via MQTT: Novo intervalo de ${intervalo}ms\n`);
  res.json({ success: true, message: `Intervalo de ${intervalo}ms ativado nos probes!` });
});

// Liga/desliga um probe individual
app.post('/api/control/probe', (req, res) => {
  const { probe_id, action } = req.body;

  if (!probe_id || !action)
    return res.status(400).json({ error: 'Os campos "probe_id" e "action" sao obrigatorios.' });
  if (!['start', 'stop'].includes(action))
    return res.status(400).json({ error: 'O campo "action" deve ser "start" ou "stop".' });
  if (!PROBE_SCRIPTS[probe_id])
    return res.status(400).json({ error: `probe_id desconhecido: ${probe_id}` });

  if (action === 'stop') {
    // Publica comando MQTT para o probe se encerrar
    mqttClient.publish('probes/control', JSON.stringify({ action: 'stop', target: probe_id }));
    // Se for gerenciado localmente, aguarda o close event remover do Map
    console.log(`[PROBE MANAGER] Comando de parada enviado para: ${probe_id}`);
    return res.json({ success: true, message: `Comando de parada enviado para ${probe_id}.` });
  }

  if (action === 'start') {
    const result = spawnProbe(probe_id);
    if (!result.ok) return res.status(409).json({ error: result.error });
    return res.json({ success: true, message: `${probe_id} iniciado pelo servidor.` });
  }
});

// Retorna quais probes estao sendo gerenciados localmente pelo servidor
app.get('/api/control/probe/status', (req, res) => {
  res.json({ managed: getManagedStatus() });
});

app.use('/', healthRouter);

app.get('/metrics', async (req, res) => {
  res.setHeader('Content-Type', getContentType());
  res.send(await getMetricsText());
});

app.get('/', (req, res) => {
  res.json({
    name: 'Microservice Health Dashboard',
    version: '0.1.0',
    endpoints: {
      'MQTT Subscribe':              'probes/+/metrics',
      'GET  /health':                'Status do agente',
      'GET  /services':              'Lista todos os servicos monitorados',
      'GET  /events':                'Ultimos eventos registrados',
      'GET  /metrics':               'Endpoint Prometheus (scrape)',
      'POST /api/control/interval':  'Altera intervalo de coleta de todos os probes',
      'POST /api/control/probe':     'Liga/desliga um probe individual',
      'GET  /api/control/probe/status': 'Status dos probes gerenciados localmente',
    },
  });
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'NOT_FOUND' });
});

app.use((err, req, res, next) => {
  console.error(`[ERRO HTTP] ${req.method} ${req.path}:`, err.message);
  res.status(400).json({ ok: false, error: 'Requisicao invalida: ' + err.message });
});

// ─── Init ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('============================================');
  console.log('  Microservice Health Dashboard');
  console.log(`  Agente coletor rodando na porta ${PORT}`);
  console.log('============================================');
});

// ─── Console do Administrador ─────────────────────────────────────────────────

function printAdminTable() {
  const services = getAllServices();
  const stats = getStats();
  const now = new Date().toISOString();

  console.log('\n================================================================');
  console.log(`  [ADMIN] STATUS DOS MICROSSERVICOS — ${now}`);
  console.log('================================================================');

  if (services.length === 0) {
    console.log('  Nenhum probe conectado ainda. Aguardando heartbeats via MQTT...');
  } else {
    const col1 = 'PROBE_ID'.padEnd(25);
    const col2 = 'STATUS'.padEnd(8);
    const col3 = 'UPTIME(s)'.padEnd(12);
    const col4 = 'LATENCIA(ms)'.padEnd(14);
    const col5 = 'ULTIMO HEARTBEAT';
    console.log(`  ${col1} ${col2} ${col3} ${col4} ${col5}`);
    console.log('  ' + '-'.repeat(80));

    for (const svc of services) {
      const id     = svc.probe_id.padEnd(25);
      const status = (svc.status === 'DOWN' ? 'DOWN' : 'UP').padEnd(8);
      const uptime = String(svc.uptime).padEnd(12);
      const latMs  = `${svc.latencia}ms`.padEnd(14);
      const hb     = new Date(svc.ultimo_heartbeat).toISOString();
      console.log(`  ${id} ${status} ${uptime} ${latMs} ${hb}`);
    }
  }

  console.log('-'.repeat(66));
  console.log(
    `  Probes ativos: ${stats.servicesMonitored} | ` +
    `Total ingestoes: ${stats.totalIngestsReceived} | ` +
    `Erros de validacao: ${stats.totalValidationErrors}`
  );
  console.log('================================================================\n');
}

setTimeout(() => {
  printAdminTable();
  setInterval(printAdminTable, ADMIN_TABLE_INTERVAL);
}, 5000);

setInterval(() => {
  const changed = checkStaleProbes();
  for (const entry of changed) {
    updateStatusMetric(entry.probe_id, 'DOWN');
    console.log(`[WATCHDOG] Probe ${entry.probe_id} esta DOWN (sem heartbeat ha mais de ${STALE_TIMEOUT_MS}ms)`);
  }
}, WATCHDOG_INTERVAL);

setInterval(() => {
  persistSnapshot();
}, PERSIST_INTERVAL);

module.exports = app;