// Create server in port 3000 and register all routes

const express = require('express');
const { getMetricsText, getContentType } = require('./collectors/metricsCollector');
const ingestRouter = require('./routes/ingest');
const healthRouter = require('./routes/health');

const PORT = 3000;
const app = express();

app.use(express.json());

// Req logs
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// Ingest metrics 
app.use('/ingest', ingestRouter);

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
    endpoints: {
      'POST /ingest':   'Envia snapshot de métricas de um serviço',
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

// ─── Init ───────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('════════════════════════════════════════════');
  console.log('  Microservice Health Dashboard');
  console.log(`  Agente coletor rodando na porta ${PORT}`);
  console.log('════════════════════════════════════════════');
  console.log(`  POST http://localhost:${PORT}/ingest`);
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(`  GET  http://localhost:${PORT}/metrics`);
  console.log('════════════════════════════════════════════');
});

module.exports = app;
