// Camada de upload: cifra o conteúdo (§6) e delega a gravação ao driver de
// storage (local ou WebDAV/Nextcloud — ver storage.js). No banco guardamos a
// "chave" relativa do arquivo, que inclui a subpasta (ex.: ANO/NÚMERO do edital).
import { encryptBuffer, decryptBuffer, nomeArquivoOpaco } from './crypto.js';
import { storage } from './storage.js';

export async function garantirDiretorio() {
  await storage.init();
}

export function extDeMime(mime) {
  return {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'text/csv': 'csv',
    'application/vnd.ms-excel': 'csv',
  }[mime] || 'bin';
}

// Sanitiza um pedaço de caminho vindo de dados (sem barras, sem "..", sem acentos problemáticos).
export function sanitizarSegmento(s) {
  return String(s || '')
    .replace(/[\\/]+/g, '-')
    .replace(/\.\.+/g, '.')
    .replace(/[^\w.\- ]/g, '')
    .trim()
    .slice(0, 80) || 'sem-nome';
}

// Rejeita travessia de diretório; normaliza a chave para uso no storage.
function chaveSegura(key) {
  const limpa = String(key).replace(/^\/+/, '');
  if (limpa.split('/').some((seg) => seg === '..')) throw new Error('Chave de arquivo inválida.');
  return limpa;
}

/**
 * Cifra e grava um Buffer; retorna a chave relativa (a ser salva no banco).
 * @param {object} [opts]
 * @param {string} [opts.subpasta] caminho relativo, ex.: "2026/001-2026"
 */
export async function salvarArquivo(buffer, mime, opts = {}) {
  const nome = nomeArquivoOpaco(extDeMime(mime));
  const sub = opts.subpasta ? String(opts.subpasta).replace(/^\/+|\/+$/g, '') : '';
  const key = chaveSegura(sub ? `${sub}/${nome}` : nome);
  await storage.put(key, encryptBuffer(buffer));
  return key;
}

/** Lê e decifra um arquivo pela sua chave. */
export async function lerArquivo(key) {
  const cifrado = await storage.get(chaveSegura(key));
  return decryptBuffer(cifrado);
}

/** Remove um arquivo do storage (usado no expurgo LGPD e em reenvios). */
export async function removerArquivo(key) {
  if (!key) return;
  await storage.del(chaveSegura(key));
}
