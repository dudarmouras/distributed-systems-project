
const express = require('express');
const mqtt = require('mqtt');
const { getMetricsText, getContentType } = require('./collectors/metricsCollector');
const healthRouter = require('./routes/monitoring');
const { handleMqttMessage } = require('./handlers/mqttHandler');

const PORT = 3000;
const app = express();

app.use(express.json());

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
  console.log(`  Agente coletor rodando na porta ${PORT} [cite: 18]`);
  console.log('════════════════════════════════════════════');
  console.log(`  MQTT Escutando mosquitto:1883`);
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(`  GET  http://localhost:${PORT}/metrics`);
  console.log('════════════════════════════════════════════');
});

module.exports = app;