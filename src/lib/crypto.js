// Criptografia em repouso de documentos (AES-256-GCM) e utilitários de token.
// Formato do arquivo cifrado: [12 bytes IV][16 bytes authTag][ciphertext].
import crypto from 'node:crypto';
import config from '../config.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

/** Cifra um Buffer de conteúdo, retornando o Buffer pronto para gravar em disco. */
export function encryptBuffer(plain) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, config.docEncryptionKey, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

/** Decifra um Buffer lido do disco, retornando o conteúdo original. */
export function decryptBuffer(stored) {
  const iv = stored.subarray(0, IV_LEN);
  const tag = stored.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = stored.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, config.docEncryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Token aleatório url-safe (para links de verificação/reset). */
export function tokenAleatorio(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Hash determinístico de um token, para guardar no banco sem armazenar o token cru. */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Comparação em tempo constante de duas strings hex/utf8. */
export function compararSeguro(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Nome de arquivo opaco para armazenamento (não revela conteúdo). */
export function nomeArquivoOpaco(ext = 'bin') {
  return `${crypto.randomBytes(16).toString('hex')}.${ext}.enc`;
}

/** Código numérico de n dígitos (ex.: "048213") para recuperação de senha. */
export function gerarCodigoNumerico(n = 6) {
  let s = '';
  for (let i = 0; i < n; i++) s += String(crypto.randomInt(0, 10));
  return s;
}

/** Protocolo curto legível, ex.: "REC-2026-AB12CD". */
export function gerarProtocolo(prefixo, ano) {
  const sufixo = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefixo}-${ano}-${sufixo}`;
}
