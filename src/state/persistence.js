const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const TMP_FILE = `${STATE_FILE}.tmp`;

// Garante que o diretório de dados existe antes de tentar escrever nele. 
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * @param {object} snapshot - Salva o snapshot do estado atual no disco de forma atômica.
 */

function saveSnapshot(snapshot) {
  try {
    ensureDataDir();
    fs.writeFileSync(TMP_FILE, JSON.stringify(snapshot, null, 2));
    fs.renameSync(TMP_FILE, STATE_FILE);
  } catch (err) {
    console.error('[Persistência] Falha ao salvar snapshot em disco:', err.message);
  }
}

/**
 * @returns {object|null} - Carrega o snapshot salvo anteriormente, se existir.
 */

function loadSnapshot() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return null;
    }
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[Persistência] Falha ao carregar snapshot do disco:', err.message);
    return null;
  }
}

module.exports = { saveSnapshot, loadSnapshot };