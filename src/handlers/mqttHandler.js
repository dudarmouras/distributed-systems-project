// mqttHandler.js — Processa a mensagem recebida do Broker MQTT

const { validateIngestPayload } = require('../validators/metricValidator');
const { upsertService, recordValidationError } = require('../state/store');
const { updateMetrics } = require('../collectors/metricsCollector');

/**
 * Processa a mensagem recebida do Broker MQTT
 * @param {string} topic - Tópico MQTT (ex: probes/probe_pagamentos/metrics)
 * @param {Buffer} message - Payload da mensagem em Buffer
 */
function handleMqttMessage(topic, message) {
  try {
    const body = JSON.parse(message.toString());

    // 1. Validação (Garante que probe_id, uptime, latencia e ultimo_heartbeat estão certos)
    const { valid, errors } = validateIngestPayload(body);

    if (!valid) {
      recordValidationError();
      console.error(`[MQTT] Erro de validação no tópico ${topic}:`, errors);
      return; 
    }

    // 2. Atualiza a estrutura em memória
    const entry = upsertService(body.probe_id, body);

    // 3. Atualiza as métricas para o Prometheus conseguir ler
    updateMetrics(entry);

    console.log(`[MQTT] Dados recebidos de: ${body.probe_id} | Latência: ${body.latencia}ms`);

  } catch (error) {
    console.error(`[MQTT] Erro ao fazer parse do JSON no tópico ${topic}:`, error.message);
  }
}

module.exports = { handleMqttMessage };