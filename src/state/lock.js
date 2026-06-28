// Este módulo implementa uma fila de exclusão mútua (mutex) por chave: cada probe_id tem sua própria 
// fila, então probes diferentes continuam sendo processados em paralelo sem se bloquearem mutuamente.

const queues = new Map(); 
/**
 * @param {string} key - Geralmente o probe_id
 * @param {() => Promise<any>} fn - A operação crítica a ser protegida
 * @returns {Promise<any>}
 */
function withLock(key, fn) {
  const previous = queues.get(key) || Promise.resolve();

  const current = previous.catch(() => {}).then(() => fn()); // Encadeia a nova operação para rodar só depois da anterior terminar

  queues.set(key, current); // Atualiza a fila com a operação atual

  // Rremove a entrada da fila quando não houver mais nada pendente
  current.finally(() => {
    if (queues.get(key) === current) {
      queues.delete(key);
    }
  });

  return current;
}

module.exports = { withLock };