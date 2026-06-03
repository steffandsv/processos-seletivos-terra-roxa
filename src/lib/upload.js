// Camada de upload: cifra o conteúdo (§6) e delega a gravação ao driver de
// storage (local ou WebDAV/Nextcloud — ver storage.js). No banco guardamos
// apenas o nome opaco do arquivo.
import path from 'node:path';
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

/** Cifra e grava um Buffer; retorna o nome opaco (a ser salvo no banco). */
export async function salvarArquivo(buffer, mime) {
  const nome = nomeArquivoOpaco(extDeMime(mime));
  await storage.put(nome, encryptBuffer(buffer));
  return nome;
}

/** Lê e decifra um arquivo. Protege contra path traversal via basename. */
export async function lerArquivo(nome) {
  const seguro = path.basename(String(nome));
  const cifrado = await storage.get(seguro);
  return decryptBuffer(cifrado);
}

/** Remove um arquivo do storage (usado no expurgo LGPD e em reenvios). */
export async function removerArquivo(nome) {
  if (!nome) return;
  await storage.del(path.basename(String(nome)));
}
