const { spawn } = require('child_process');
const readline = require('readline');

// Lista dos nossos serviços com IDs para o teclado
const probes = [
  { id: '1', name: 'pagamentos.js', ref: null },
  { id: '2', name: 'autenticacao.js', ref: null },
  { id: '3', name: 'pedidos.js', ref: null },
  { id: '4', name: 'estoque.js', ref: null },
  { id: '5', name: 'gateway.js', ref: null },
  { id: '6', name: 'notificacoes.js', ref: null },
  { id: '7', name: 'relatorios.js', ref: null },
  { id: '8', name: 'cache.js', ref: null }
];

console.log('🚀 Iniciando o Maestro dos Probes...\n');
console.log('CONTROLES DO TECLADO:');
console.log(' [1] Ligar/Desligar pagamentos');
console.log(' [2] Ligar/Desligar autenticação');
console.log(' [3] Ligar/Desligar pedidos');
console.log(' [4] Ligar/Desligar estoque');
console.log(' [5] Ligar/Desligar gateway');
console.log(' [6] Ligar/Desligar notificações');
console.log(' [7] Ligar/Desligar relatórios');
console.log(' [8] Ligar/Desligar cache');
console.log(' [Ctrl+C] Encerrar tudo e sair\n');
console.log('--------------------------------------------------');

function startProbe(probe) {
  if (probe.ref) return;
  
  probe.ref = spawn('node', [`probes/${probe.name}`]);
  
  probe.ref.stdout.on('data', data => process.stdout.write(`[${probe.name}] ${data}`));
  probe.ref.stderr.on('data', data => process.stderr.write(`[${probe.name}] ${data}`));
  
  probe.ref.on('close', () => {
    console.log(`\n>>> O serviço ${probe.name} caiu/foi interrompido! <<<\n`);
    probe.ref = null;
  });
}

// Inicia os 3 automaticamente no começo
probes.forEach(startProbe);

// Configura o Node para escutar as teclas do teclado em tempo real
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);

process.stdin.on('keypress', (str, key) => {
  // Se apertar Ctrl+C, fecha tudo
  if (key.ctrl && key.name === 'c') {
    console.log('\nDesligando o Maestro...');
    process.exit(); 
  }
  
  const targetProbe = probes.find(p => p.id === str);
  
  if (targetProbe) {
    if (targetProbe.ref) {
      console.log(`\nComando recebido: Desligando ${targetProbe.name}...`);
      targetProbe.ref.kill(); // Mata apenas este processo
    } else {
      console.log(`\nComando recebido: Ligando ${targetProbe.name} novamente...`);
      startProbe(targetProbe); // Liga ele de novo
    }
  }
});