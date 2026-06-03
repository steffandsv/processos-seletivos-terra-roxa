// Armazenamento de arquivos no volume dedicado, CIFRADOS em repouso (§6).
// No banco guardamos apenas o nome opaco do arquivo; o conteúdo nunca toca
// a raiz web e é decifrado sob demanda apenas para o admin/dono.
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config.js';
import { encryptBuffer, decryptBuffer, nomeArquivoOpaco } from './crypto.js';

export async function garantirDiretorio() {
  await fs.mkdir(config.uploadDir, { recursive: true });
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

/**
 * Grava um Buffer cifrado e retorna o nome de arquivo (a ser salvo no banco).
 */
export async function salvarArquivo(buffer, mime) {
  await garantirDiretorio();
  const nome = nomeArquivoOpaco(extDeMime(mime));
  const destino = path.join(config.uploadDir, nome);
  await fs.writeFile(destino, encryptBuffer(buffer), { mode: 0o600 });
  return nome;
}

/** Lê e decifra um arquivo. Protege contra path traversal via basename. */
export async function lerArquivo(nome) {
  const seguro = path.basename(String(nome));
  const origem = path.join(config.uploadDir, seguro);
  const cifrado = await fs.readFile(origem);
  return decryptBuffer(cifrado);
}

/** Remove um arquivo do volume (usado no expurgo LGPD). */
export async function removerArquivo(nome) {
  if (!nome) return;
  const seguro = path.basename(String(nome));
  try {
    await fs.unlink(path.join(config.uploadDir, seguro));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}
