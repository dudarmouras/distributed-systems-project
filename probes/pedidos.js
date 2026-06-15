const mqtt = require('mqtt');

const PROBE_ID = 'probe_pedidos';
const TOPIC = `probes/${PROBE_ID}/metrics`;
const BROKER_URL = 'mqtt://localhost:1883';

let uptimeSeconds = 0;

console.log(`🚀 Iniciando Microsserviço: ${PROBE_ID}`);
const client = mqtt.connect(BROKER_URL);

client.on('connect', () => {
  console.log(`[${PROBE_ID}] Conectado ao broker MQTT.`);

  setInterval(() => {
    uptimeSeconds += 5;
    
    // Pedidos têm latência média (40ms a 80ms)
    const latencia = Math.floor(Math.random() * 40) + 40; 

    const payload = {
      probe_id: PROBE_ID,
      uptime: uptimeSeconds,
      latencia: latencia,
      ultimo_heartbeat: new Date().toISOString()
    };

    client.publish(TOPIC, JSON.stringify(payload), (err) => {
      if (!err) console.log(`[${PROBE_ID}] Heartbeat enviado -> Latência: ${latencia}ms`);
    });
  }, 5000);
});