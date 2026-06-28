const mqtt = require("mqtt");

const PROBE_ID = "probe_pagamentos";
const METRICS_TOPIC = `probes/${PROBE_ID}/metrics`;
const CONTROL_TOPIC = `probes/control`;
const BROKER_URL = "mqtt://localhost:1883";

let uptimeSeconds = 0;
let intervalMs = 5000;
let intervalId = null;

console.log(`🚀 Iniciando Microsserviço: ${PROBE_ID}`);
const client = mqtt.connect(BROKER_URL);

function startHeartbeat() {
  if (intervalId) clearInterval(intervalId);

  intervalId = setInterval(() => {
    uptimeSeconds += intervalMs / 1000;

    // Pagamentos geralmente envolvem bancos externos, latência mais alta (100ms a 200ms)
    const latencia = Math.floor(Math.random() * 100) + 100;

    const payload = {
      probe_id: PROBE_ID,
      uptime: Math.floor(uptimeSeconds),
      latencia: latencia,
      ultimo_heartbeat: new Date().toISOString(),
    };

    client.publish(METRICS_TOPIC, JSON.stringify(payload), (err) => {
      if (!err)
        console.log(
          `[${PROBE_ID}] Heartbeat enviado -> Latência: ${latencia}ms`,
        );
    });
  }, intervalMs);
}

client.on("connect", () => {
  console.log(`[${PROBE_ID}] Conectado ao broker MQTT.`);
  client.subscribe(CONTROL_TOPIC);
  startHeartbeat();
});

client.on("message", (topic, message) => {
  if (topic === CONTROL_TOPIC) {
    try {
      const data = JSON.parse(message.toString());
      if (data.novo_intervalo && typeof data.novo_intervalo === "number") {
        intervalMs = data.novo_intervalo;
        console.log(
          `[${PROBE_ID}] Intervalo de coleta atualizado para ${intervalMs}ms`,
        );
        startHeartbeat();
      }
    } catch (e) {
      console.error(`[${PROBE_ID}] Erro ao ler comando de controle`);
    }
  }
});
