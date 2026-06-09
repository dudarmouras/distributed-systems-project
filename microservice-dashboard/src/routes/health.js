/**
 * health.js — Rotas GET /health e GET /services
 */

const express = require('express');
const router = express.Router();

const { getStats, getAllServices, getRecentEvents } = require('../state/store');

/** GET /health — Status do próprio agente */
router.get('/health', (req, res) => {
  const stats = getStats();
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: stats.uptimeSeconds,
    servicesMonitored: stats.servicesMonitored,
    totalIngestsReceived: stats.totalIngestsReceived,
    totalValidationErrors: stats.totalValidationErrors,
    serverStartedAt: stats.serverStartedAt,
  });
});

/** GET /services — Lista todos os serviços monitorados */
router.get('/services', (req, res) => {
  const services = getAllServices();
  res.status(200).json({
    services,
    count: services.length,
  });
});

/** GET /events — Últimos eventos registrados */
router.get('/events', (req, res) => {
  const n = Math.min(parseInt(req.query.n) || 20, 100);
  res.status(200).json({
    events: getRecentEvents(n),
  });
});

module.exports = router;
