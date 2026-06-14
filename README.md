# 📊 Dashboard de Saúde de Microsserviços

Servidor centralizado (Agente Coletor) que recebe heartbeats e métricas de telemetria de múltiplos microsserviços via **MQTT (arquitetura pub/sub)**, consolida as informações em um dicionário global em memória RAM e expõe os dados consolidados via HTTP para raspagem (*scrape*) do Prometheus. O Grafana consome as séries temporais do Prometheus para renderização de dashboards em tempo real.

---

## 🔄 Como Funciona a Arquitetura

```text
[Microsserviços / Probes]
    │ (Publica ativamente via MQTT no broker)
    ▼
[Eclipse Mosquitto Broker] (Porta 1883)
    │ (Agente Node.js assina o tópico 'probes/+/metrics')
    ▼
[Agente Coletor Node.js] (Processa, valida e salva no dicionário em memória)
    │ (Expõe endpoint HTTP Express na Porta 3000)
    ▼
[Prometheus Server] (Faz o pull/scrape HTTP em /metrics a cada 15s)
    │
    ▼
[Grafana Dashboards] (Consome o banco temporal do Prometheus)
```

Em vez de conexões abertas por socket puro ou requisições síncronas HTTP puras para ingestão, cada microsserviço (Probe) atua de forma assíncrona mandando pacotes de pulsação estruturados em JSON contendo identificação, tempo de atividade e latência de rede.

---

## 🛠️ Tecnologias Utilizadas

| Tecnologia | Papel no Ecossistema Distribuído |
|---|---|
| Node.js + Express | Servidor central estável para gerenciar o dicionário em memória e servir a API HTTP de leitura. |
| MQTT.js | Biblioteca client para conexão assíncrona, escuta de eventos e parsing de buffers de mensagens do Broker. |
| Eclipse Mosquitto | Broker MQTT leve responsável pelo roteamento desacoplado das mensagens da malha de serviços. |
| prom-client | Biblioteca de instrumentação para expor contadores e gauges no formato nativo OpenMetrics. |
| Prometheus | Banco de dados de série temporal (TSDB) para persistência histórica e amostragem das métricas. |
| Grafana | Camada visual de consumo de dados e plotagem de gráficos analíticos de desempenho. |
| Docker Compose | Orquestrador de contêineres para provisionamento automatizado de toda a infraestrutura com um único comando. |

---

## 📂 Estrutura de Pastas

```text
microservice-dashboard/
├── docs/
│   ├── protocol.md                  # Contrato das rotas HTTP e payloads MQTT
│   └── state-model.md               # Modelagem detalhada das estruturas em memória
├── mosquitto/
│   └── mosquitto.conf               # Configurações de portas e permissões do Broker
├── probes/
│   ├── autenticacao.js              # Simulador do Microsserviço de Autenticação
│   ├── pagamentos.js                # Simulador do Microsserviço de Pagamentos
│   └── pedidos.js                   # Simulador do Microsserviço de Pedidos
├── prometheus/
│   └── prometheus.yml               # Configuração de alvos e intervalos de scrape
├── src/
│   ├── collectors/
│   │   └── metricsCollector.js      # Tradutor do dicionário para formato do Prometheus
│   ├── handlers/
│   │   └── mqttHandler.js           # Escutador de eventos MQTT e orquestrador de fluxo
│   ├── routes/
│   │   └── monitoring.js            # Endpoints REST (/health, /services, /events)
│   ├── state/
│   │   └── store.js                 # Armazenamento em memória (Maps globais + Fila FIFO)
│   ├── validators/
│   │   └── metricValidator.js       # Middleware de validação sintática do JSON
│   └── server.js                    # Inicializador do Express (Porta 3000) e Ingestor MQTT
├── docker-compose.yml               # Manifest de criação de contêineres da infraestrutura
├── package.json                     # Manifest de scripts e dependências do ecossistema
└── run_probes.js                    # Script Maestro Interativo para controle de Probes
```

---

## 🚀 Como Executar o Projeto

### 1. Preparação das Dependências Locais

Para rodar os microsserviços simulados diretamente na sua máquina host, garanta as dependências instaladas:

```bash
npm install
```

### 2. Inicialização da Infraestrutura Docker (Modo Automático)

Para baixar e levantar o servidor Node.js, o broker Mosquitto, o Prometheus e o Grafana isolados em rede, execute:

```bash
docker-compose up -d --build
```

### 3. Execução Centralizada dos Microsserviços (Script Maestro)

Para não ter que abrir múltiplos terminais separados, utilize o script interativo desenvolvido para gerenciar e injetar os dados na rede distribuída:

```bash
node run_probes.js
```

**Controles do teclado durante a execução:**

- `1` — Interromper/Ressuscitar o microsserviço de Pagamentos
- `2` — Interromper/Ressuscitar o microsserviço de Autenticação
- `3` — Interromper/Ressuscitar o microsserviço de Pedidos
- `Ctrl + C` — Derrubar todos os processos filhos e sair

---

## 🎯 Endpoints da API REST de Diagnóstico

| Serviço / Endpoint | Método | Descrição |
|---|---|---|
| `http://localhost:3000/health` | GET | Diagnóstico operacional do Agente Coletor, tempo de atividade global e taxa de erros. |
| `http://localhost:3000/services` | GET | Dump completo em formato JSON do dicionário mantido em memória RAM. |
| `http://localhost:3000/events` | GET | Histórico temporal circular contendo os últimos 100 eventos relevantes do sistema. |
| `http://localhost:3000/metrics` | GET | Endpoint bruto OpenMetrics formatado para raspagem do Prometheus Server. |
| `http://localhost:9090` | HTTP Web | Console nativo de expressões do Prometheus Server. |
| `http://localhost:3001` | HTTP Web | Interface do Grafana para visualização de Dashboards (Credenciais: `admin/admin`). |

---

## 🗃️ Modelo de Dados em Memória

O arquivo `src/state/store.js` isola e gerencia o estado volátil através de coleções otimizadas do ECMAScript:

- **Dicionário Global (`Map`):** Estrutura indexada por strings únicas (`probe_id`), garantindo inserções e atualizações em complexidade algorítmica constante O(1).
- **Fila de Eventos Circular (`Array`):** Armazena estritamente até 100 logs temporais operando em modelo FIFO (First-In, First-Out).
- **Contadores Globais (`Object`):** Computadores numéricos primitivos para auditoria interna de pacotes trafegados e descartes por falhas de esquema JSON.

---

## 👥 Equipe e Desenvolvimento

**Eduarda Rodrigues de Moura Santana**

**Elinaldo Emanoel de Melo Macêdo**

**Gabriel Nascimento da Silva Sousa**

**Isabelle Tenorio Vaz Bezerra**