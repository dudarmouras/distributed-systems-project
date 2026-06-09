// POST /ingest routes

const express = require('express');
const router = express.Router();

const { validateIngestPayload } = require('../validators/metricValidator');
const { upsertService, recordValidationError } = require('../state/store');
const { updateMetrics } = require('../collectors/metricsCollector');

router.post('/', (req, res) => {
  const body = req.body;

  // 1.
  const { valid, errors } = validateIngestPayload(body);

  if (!valid) {
    recordValidationError();
    return res.status(400).json({
      ok: false,
      error: 'VALIDATION_ERROR',
      details: errors,
    });
  }

  // 2. 
  const entry = upsertService(body.serviceId, {
    status: body.status,
    metrics: body.metrics,
  });

  // 3.
  updateMetrics(entry);

  // 4.
  return res.status(200).json({
    ok: true,
    serviceId: body.serviceId,
    receivedAt: new Date().toISOString(),
  });
});

module.exports = router;
