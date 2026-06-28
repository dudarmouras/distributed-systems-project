const express = require('express');
const mqtt = require('mqtt');
const { getMetricsText, getContentType } = require('./collectors/metricsCollector');
const healthRouter = require('./routes/monitoring');
const { handleMqttMessage } = require('./handlers/mqttHandler');
const { getAllServices, getStats } = require('./state/store');

const PORT = 3000;
const ADMIN_TABLE_INTERVAL = 10 * 1000; // Exibe a tabela de status a cada 10 segundos

const app = express();

// Lê o corpo das requisições em JSON
app.use(express.json());

// 1. Libera o CORS para o botão do Grafana conseguir acessar a API (DEVE VIR ANTES DAS ROTAS)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// Req logs (Apenas para as requisições HTTP restantes)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Conexão MQTT ───

// Conecta ao Mosquitto (usando o nome do serviço no docker-compose)
const mqttClient = mqtt.connect('mqtt://mosquitto:1883');

mqttClient.on('connect', () => {
  console.log('MQTT: Conectado ao Broker Mosquitto');
  
  // Assina o barramento de tópicos exigido (O '+' captura qualquer probe_id) 
  mqttClient.subscribe('probes/+/metrics', (err) => {
    if (!err) {
      console.log('MQTT: Escutando dados no barramento probes/+/metrics');
    }
  });
});

// Aciona o handler sempre que uma mensagem chega de um probe
mqttClient.on('message', (topic, message) => {
  handleMqttMessage(topic, message);
});

// ─── Routes HTTP ───

// 2. Rota que recebe o comando do botão do Grafana e repassa pro MQTT
app.post('/api/control/interval', (req, res) => {
  const { intervalo } = req.body;
  if (!intervalo || typeof intervalo !== 'number') {
    return res.status(400).json({ error: 'Intervalo inválido.' });
  }
  
  // Dispara o comando para o barramento MQTT (tópico: probes/control)
  mqttClient.publish('probes/control', JSON.stringify({ novo_intervalo: intervalo }));
  console.log(`\n📡 [ADMIN] Comando remoto enviado via MQTT: Novo intervalo de ${intervalo}ms\n`);
  
  res.json({ success: true, message: `Intervalo de ${intervalo}ms ativado nos probes!` });
});

// Agente status and service list
app.use('/', healthRouter);

// Prometheus scrape
app.get('/metrics', async (req, res) => {
  res.setHeader('Content-Type', getContentType());
  res.send(await getMetricsText());
});

// Informative root route
app.get('/', (req, res) => {
  res.json({
    name: 'Microservice Health Dashboard — Agente Coletor',
    version: '0.1.0',
    protocolo_mensageria: 'MQTT',
    endpoints: {
      'MQTT Subscribe': 'probes/+/metrics (Recebe snapshot de métricas dos probes) ',
      'GET  /health':   'Status do agente',
      'GET  /services': 'Lista todos os serviços monitorados',
      'GET  /events':   'Últimos eventos registrados',
      'GET  /metrics':  'Endpoint Prometheus (scrape)',
    },
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'NOT_FOUND' });
});

// ─── Init ───

app.listen(PORT, () => {
  console.log('════════════════════════════════════════════');
  console.log('  Microservice Health Dashboard');
  console.log(`  Agente coletor rodando na porta ${PORT}`);
  console.log('════════════════════════════════════════════');
  console.log(`  MQTT Escutando mosquitto:1883`);
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(`  GET  http://localhost:${PORT}/metrics`);
  console.log('════════════════════════════════════════════');
});

// ─── Console do Administrador — Tabela Periódica ───────────────────────────

function printAdminTable() {
  const services = getAllServices();
  const stats = getStats();
  const now = new Date().toISOString();

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(`  [ADMIN] STATUS DOS MICROSSERVIÇOS — ${now}`);
  console.log('════════════════════════════════════════════════════════════════');

  if (services.length === 0) {
    console.log('  Nenhum probe conectado ainda. Aguardando heartbeats via MQTT...');
  } else {
    // Cabeçalho da tabela
    const col1 = 'PROBE_ID'.padEnd(25);
    const col2 = 'UPTIME(s)'.padEnd(12);
    const col3 = 'LATÊNCIA(ms)'.padEnd(14);
    const col4 = 'ÚLTIMO HEARTBEAT';
    console.log(`  ${col1} ${col2} ${col3} ${col4}`);
    console.log('  ' + '─'.repeat(72));

    // Uma linha por probe registrado no dicionário em memória
    for (const svc of services) {
      const id      = svc.probe_id.padEnd(25);
      const uptime  = String(svc.uptime).padEnd(12);
      const latMs   = `${svc.latencia}ms`.padEnd(14);
      const hb      = new Date(svc.ultimo_heartbeat).toISOString();
      console.log(`  ${id} ${uptime} ${latMs} ${hb}`);
    }
  }

  console.log('────────────────────────────────────────────────────────────────');
  console.log(
    `  Probes ativos: ${stats.servicesMonitored} | ` +
    `Total ingestões: ${stats.totalIngestsReceived} | ` +
    `Erros de validação: ${stats.totalValidationErrors}`
  );
  console.log('════════════════════════════════════════════════════════════════\n');
}

// Dispara a primeira exibição após 5s (tempo para os probes conectarem) e repete a cada ADMIN_TABLE_INTERVAL ms
setTimeout(() => {
  printAdminTable();
  setInterval(printAdminTable, ADMIN_TABLE_INTERVAL);
}, 5000);

module.exports = app;