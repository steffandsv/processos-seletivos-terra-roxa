// Configuração central — lê e valida variáveis de ambiente (fail-fast).
import path from 'node:path';

function req(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return v.trim();
}

function opt(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null ? fallback : v;
}

function bool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const NODE_ENV = opt('NODE_ENV', 'development');
const isProd = NODE_ENV === 'production';

// Chave de criptografia de documentos: 32 bytes em hexadecimal (64 chars).
const docKeyHex = req('DOC_ENCRYPTION_KEY');
if (!/^[0-9a-fA-F]{64}$/.test(docKeyHex)) {
  throw new Error('DOC_ENCRYPTION_KEY deve conter 64 caracteres hexadecimais (32 bytes). Gere com: openssl rand -hex 32');
}

const sessionSecret = req('SESSION_SECRET');
if (sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET deve ter ao menos 32 caracteres. Gere com: openssl rand -hex 32');
}

export const config = {
  env: NODE_ENV,
  isProd,
  port: Number(opt('PORT', '3000')),
  host: opt('HOST', '0.0.0.0'),
  baseUrl: opt('APP_BASE_URL', 'http://localhost:3000').replace(/\/$/, ''),

  sessionSecret,
  docEncryptionKey: Buffer.from(docKeyHex, 'hex'),
  cookieSecure: bool('COOKIE_SECURE', isProd),

  uploadDir: path.resolve(opt('UPLOAD_DIR', './data/uploads')),
  maxUploadBytes: 8 * 1024 * 1024, // 8 MB (premissa 9)
  // MIME aceitos para documento com foto e anexos de candidato
  mimesDocumento: ['application/pdf', 'image/jpeg', 'image/png'],
  // MIME aceitos para publicações oficiais (admin) — inclui CSV
  mimesPublicacao: ['application/pdf', 'text/csv', 'application/vnd.ms-excel', 'image/jpeg', 'image/png'],

  smtp: {
    host: opt('SMTP_HOST', ''),
    port: Number(opt('SMTP_PORT', '587')),
    secure: bool('SMTP_SECURE', false),
    user: opt('SMTP_USER', ''),
    pass: opt('SMTP_PASS', ''),
    from: opt('MAIL_FROM', 'Processos Seletivos <nao-responda@example.gov.br>'),
  },

  orgao: {
    nome: opt('ORGAO_NOME', 'Prefeitura Municipal'),
    uf: opt('ORGAO_UF', 'SP'),
    dpoContato: opt('DPO_CONTATO', ''),
  },
};

export default config;
