const mqtt = require("mqtt");

const PROBE_ID = "probe_relatorios";
const METRICS_TOPIC = `probes/${PROBE_ID}/metrics`;
const CONTROL_TOPIC = `probes/control`;
const BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";

// Faixa de latência base do serviço (ms). Relatórios fazem processamento
// pesado (agregações, exportações), é o serviço mais lento (100ms a 500ms).
const LAT_MIN = 100;
const LAT_MAX = 500;

let uptimeSeconds = 0;
let intervalMs = 5000; // Começa com 5 segundos
let intervalId = null;

console.log(`🚀 Iniciando Microsserviço: ${PROBE_ID} (broker: ${BROKER_URL})`);
const client = mqtt.connect(BROKER_URL);

// Gera uma latência dentro da faixa do serviço com ±20% de variação aleatória
// a cada heartbeat, para simular o jitter de um serviço real.
function gerarLatencia() {
  const base = Math.random() * (LAT_MAX - LAT_MIN) + LAT_MIN;
  const jitter = 0.8 + Math.random() * 0.4; // fator entre 0.8 e 1.2 (±20%)
  return Math.max(1, Math.round(base * jitter));
}

function startHeartbeat() {
  if (intervalId) clearInterval(intervalId);

  intervalId = setInterval(() => {
    uptimeSeconds += intervalMs / 1000;
    const latencia = gerarLatencia();

    const payload = {
      probe_id: PROBE_ID,
      uptime: Math.floor(uptimeSeconds),
      latencia: latencia,
      ultimo_heartbeat: new Date().toISOString(),
    };

    client.publish(METRICS_TOPIC, JSON.stringify(payload), (err) => {
      if (!err)
        console.log(`[${PROBE_ID}] Heartbeat enviado -> Latência: ${latencia}ms`);
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
      // Comando de parada direcionado a este probe
      if (data.action === "stop" && data.target === PROBE_ID) {
        console.log(`[${PROBE_ID}] Comando de parada recebido. Encerrando...`);
        if (intervalId) clearInterval(intervalId);
        client.end(true, () => process.exit(0));
        return;
      }
      if (data.novo_intervalo && typeof data.novo_intervalo === "number") {
        intervalMs = data.novo_intervalo;
        console.log(`[${PROBE_ID}] Intervalo de coleta atualizado para ${intervalMs}ms`);
        startHeartbeat();
      }
    } catch (e) {
      console.error(`[${PROBE_ID}] Erro ao ler comando de controle`);
    }
  }
});