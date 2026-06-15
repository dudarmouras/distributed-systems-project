const mqtt = require('mqtt');

const PROBE_ID = 'probe_autenticacao';
const TOPIC = `probes/${PROBE_ID}/metrics`;
const BROKER_URL = 'mqtt://localhost:1883';

let uptimeSeconds = 0;

console.log(`🚀 Iniciando Microsserviço: ${PROBE_ID}`);
const client = mqtt.connect(BROKER_URL);

client.on('connect', () => {
  console.log(`[${PROBE_ID}] Conectado ao broker MQTT.`);

  setInterval(() => {
    uptimeSeconds += 5;
    
    // Autenticação costuma ser muito rápida (10ms a 30ms)
    const latencia = Math.floor(Math.random() * 20) + 10; 

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