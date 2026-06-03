// Driver de armazenamento de bytes (já cifrados). Selecionável por ambiente:
//   STORAGE_DRIVER=local   -> volume Docker (fs)            [padrão]
//   STORAGE_DRIVER=webdav  -> Nextcloud via WebDAV (fetch)
// As "chaves" (keys) são caminhos relativos com subpastas, ex.:
//   "2026/001-2026/<hash>.pdf.enc"  (organização por ANO/NÚMERO do edital).
// Em ambos os drivers as pastas são criadas automaticamente se não existirem.
// A criptografia acontece em upload.js ANTES de chamar o driver.
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config.js';

function segmentos(p) {
  return String(p).split('/').map((s) => s.trim()).filter(Boolean);
}

// ----------------------------- Local (fs) ----------------------------------
const localDriver = {
  async init() {
    await fs.mkdir(config.uploadDir, { recursive: true });
  },
  async put(key, buffer) {
    const destino = path.join(config.uploadDir, key);
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(destino, buffer, { mode: 0o600 });
  },
  async get(key) {
    return fs.readFile(path.join(config.uploadDir, key));
  },
  async del(key) {
    try {
      await fs.unlink(path.join(config.uploadDir, key));
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
  return { w, auth };
}

// Monta a URL completa codificando cada segmento (preservando as barras).
function urlDe(caminho) {
  const { w } = webdavCfg();
  const partes = [...segmentos(w.root), ...segmentos(caminho)].map(encodeURIComponent);
  return `${w.baseUrl}/${partes.join('/')}`;
}

const _pastasCriadas = new Set();

async function garantirPastas(dirRelativo) {
  const { w, auth } = webdavCfg();
  const partes = [...segmentos(w.root), ...segmentos(dirRelativo)];
  let acc = '';
  for (const parte of partes) {
    acc = acc ? `${acc}/${parte}` : parte;
    if (_pastasCriadas.has(acc)) continue;
    const url = `${w.baseUrl}/${acc.split('/').map(encodeURIComponent).join('/')}`;
    const r = await fetch(url, { method: 'MKCOL', headers: { Authorization: auth } });
    // 201 = criada; 405 = já existe; 301 = já existe (redir). Tudo aceitável.
    if (![201, 405, 301, 200].includes(r.status)) {
      throw new Error(`WebDAV MKCOL falhou (${r.status}) em ${acc}`);
    }
    _pastasCriadas.add(acc);
  }
}

const webdavDriver = {
  async init() {
    await garantirPastas(''); // garante a pasta raiz configurada
  },
  async put(key, buffer) {
    const { auth } = webdavCfg();
    const dir = segmentos(key).slice(0, -1).join('/');
    if (dir) await garantirPastas(dir);
    const r = await fetch(urlDe(key), {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/octet-stream' },
      body: buffer,
    });
    if (![200, 201, 204].includes(r.status)) throw new Error(`WebDAV PUT falhou (${r.status})`);
  },
  async get(key) {
    const { auth } = webdavCfg();
    const r = await fetch(urlDe(key), { headers: { Authorization: auth } });
    if (!r.ok) throw new Error(`WebDAV GET falhou (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  },
  async del(key) {
    const { auth } = webdavCfg();
    const r = await fetch(urlDe(key), { method: 'DELETE', headers: { Authorization: auth } });
    if (![200, 204, 404].includes(r.status)) throw new Error(`WebDAV DELETE falhou (${r.status})`);
  },
};

export const storage = config.storage.driver === 'webdav' ? webdavDriver : localDriver;
export const storageDriver = config.storage.driver === 'webdav' ? 'webdav' : 'local';
