#!/usr/bin/env bash
#
# run_all_probes.sh — Inicia TODOS os probes simulados em background (nohup).
#
# Uso:
#   chmod +x run_all_probes.sh && ./run_all_probes.sh
#
# O broker pode ser configurado via variável de ambiente:
#   MQTT_BROKER_URL=mqtt://localhost:1883 ./run_all_probes.sh
#

# Garante que rodamos a partir da raiz do projeto (onde este script está).
cd "$(dirname "$0")" || exit 1

PROBES=(autenticacao pagamentos pedidos estoque gateway notificacoes relatorios cache)
PID_FILE=".probe_pids"
LOG_DIR="logs"

export MQTT_BROKER_URL="${MQTT_BROKER_URL:-mqtt://localhost:1883}"

mkdir -p "$LOG_DIR"

# ── 1. Mata processos de probe anteriores (se houver) ───────────────────────
echo "🧹 Encerrando probes anteriores (se houver)..."
if [ -f "$PID_FILE" ]; then
  while read -r oldpid; do
    [ -n "$oldpid" ] && kill "$oldpid" 2>/dev/null
  done < "$PID_FILE"
  rm -f "$PID_FILE"
fi
# Rede de segurança: mata qualquer node rodando arquivos da pasta probes/.
pkill -f "node .*probes/.*\.js" 2>/dev/null

echo ""
echo "🔌 Broker MQTT: $MQTT_BROKER_URL"
echo "📡 Iniciando ${#PROBES[@]} probes em background..."
echo ""

# ── 2. Inicia todos os probes em background com nohup ───────────────────────
: > "$PID_FILE"
for p in "${PROBES[@]}"; do
  nohup node "probes/$p.js" > "$LOG_DIR/$p.log" 2>&1 &
  pid=$!
  echo "$pid" >> "$PID_FILE"
  printf "  ▶ %-22s PID %-7s → %s/%s.log\n" "probe_$p" "$pid" "$LOG_DIR" "$p"
done

echo ""
echo "✅ Todos os probes estão rodando."
echo "   Logs em: $LOG_DIR/"
echo "   Dashboard: http://localhost:3000"
echo ""
echo "🛑 Para parar todos: ./stop_probes.sh"
echo "   (ou manualmente: kill \$(cat $PID_FILE))"
