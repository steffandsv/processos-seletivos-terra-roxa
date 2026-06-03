// Driver de armazenamento de bytes (já cifrados). Selecionável por ambiente:
//   STORAGE_DRIVER=local   -> volume Docker (fs)            [padrão]
//   STORAGE_DRIVER=webdav  -> Nextcloud via WebDAV (fetch)  [pronto p/ ativar]
// A criptografia acontece em upload.js ANTES de chamar o driver — assim o
// Nextcloud só armazena conteúdo cifrado (proteção LGPD em repouso).
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config.js';

// ----------------------------- Local (fs) ----------------------------------
const localDriver = {
  async init() {
    await fs.mkdir(config.uploadDir, { recursive: true });
  },
  async put(nome, buffer) {
    await fs.mkdir(config.uploadDir, { recursive: true });
    await fs.writeFile(path.join(config.uploadDir, nome), buffer, { mode: 0o600 });
  },
  async get(nome) {
    return fs.readFile(path.join(config.uploadDir, nome));
  },
  async del(nome) {
    try {
      await fs.unlink(path.join(config.uploadDir, nome));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  },
};

// --------------------------- WebDAV (Nextcloud) -----------------------------
function webdavCfg() {
  const w = config.storage.webdav;
  if (!w.baseUrl) throw new Error('STORAGE_DRIVER=webdav requer WEBDAV_BASE_URL (e WEBDAV_USER/WEBDAV_PASS).');
  const auth = 'Basic ' + Buffer.from(`${w.user}:${w.pass}`).toString('base64');
  const base = `${w.baseUrl}/${w.root}`.replace(/\/+$/, '');
  return { w, auth, base };
}

let _rootGarantido = false;

const webdavDriver = {
  async init() {
    // Cria a subpasta raiz (MKCOL é idempotente: 405 se já existir).
    const { auth, base } = webdavCfg();
    if (_rootGarantido) return;
    const r = await fetch(base, { method: 'MKCOL', headers: { Authorization: auth } });
    if (![201, 405, 301, 200].includes(r.status)) {
      // 409 = pai inexistente; deixamos explícito para diagnóstico.
      throw new Error(`WebDAV MKCOL falhou (${r.status}) em ${base}`);
    }
    _rootGarantido = true;
  },
  async put(nome, buffer) {
    const { auth, base } = webdavCfg();
    await this.init();
    const r = await fetch(`${base}/${encodeURIComponent(nome)}`, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/octet-stream' },
      body: buffer,
    });
    if (![200, 201, 204].includes(r.status)) throw new Error(`WebDAV PUT falhou (${r.status})`);
  },
  async get(nome) {
    const { auth, base } = webdavCfg();
    const r = await fetch(`${base}/${encodeURIComponent(nome)}`, { headers: { Authorization: auth } });
    if (!r.ok) throw new Error(`WebDAV GET falhou (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  },
  async del(nome) {
    const { auth, base } = webdavCfg();
    const r = await fetch(`${base}/${encodeURIComponent(nome)}`, { method: 'DELETE', headers: { Authorization: auth } });
    if (![200, 204, 404].includes(r.status)) throw new Error(`WebDAV DELETE falhou (${r.status})`);
  },
};

export const storage = config.storage.driver === 'webdav' ? webdavDriver : localDriver;
export const storageDriver = config.storage.driver === 'webdav' ? 'webdav' : 'local';
