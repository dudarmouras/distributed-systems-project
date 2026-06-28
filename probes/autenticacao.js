const mqtt = require("mqtt");

const PROBE_ID = "probe_autenticacao";
const METRICS_TOPIC = `probes/${PROBE_ID}/metrics`;
const CONTROL_TOPIC = `probes/control`;
const BROKER_URL = "mqtt://localhost:1883";

let uptimeSeconds = 0;
let intervalMs = 5000; // Começa com 5 segundos
let intervalId = null;

console.log(`🚀 Iniciando Microsserviço: ${PROBE_ID}`);
const client = mqtt.connect(BROKER_URL);

// Função que gerencia o envio contínuo com base no intervalo atual
function startHeartbeat() {
  if (intervalId) clearInterval(intervalId);

  intervalId = setInterval(() => {
    // Incrementa o uptime dinamicamente baseado no intervalo atual
    uptimeSeconds += intervalMs / 1000;

    // Autenticação costuma ser muito rápida (10ms a 30ms)
    const latencia = Math.floor(Math.random() * 20) + 10;

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

  // Assina o tópico de controle
  client.subscribe(CONTROL_TOPIC);

  // Inicia o batimento
  startHeartbeat();
});

// Escuta os comandos vindos do Grafana/Servidor
client.on("message", (topic, message) => {
  if (topic === CONTROL_TOPIC) {
    try {
      const data = JSON.parse(message.toString());
      if (data.novo_intervalo && typeof data.novo_intervalo === "number") {
        intervalMs = data.novo_intervalo;
        console.log(
          `[${PROBE_ID}] Intervalo de coleta atualizado para ${intervalMs}ms`,
        );
        startHeartbeat(); // Reinicia com o novo tempo
      }
    } catch (e) {
      console.error(`[${PROBE_ID}] Erro ao ler comando de controle`);
    }
  }
});
