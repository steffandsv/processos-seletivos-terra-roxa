// Validação de entrada nos limites do sistema (CLAUDE.md / §3).
import { z } from 'zod';
import { cpfValido, somenteDigitos } from './cpf.js';

const strTrim = (max) => z.string().trim().max(max);

const senhaSchema = z
  .string()
  .min(8, 'A senha deve ter ao menos 8 caracteres')
  .max(200)
  .refine((s) => /[A-Za-z]/.test(s) && /[0-9]/.test(s), 'A senha deve conter letras e números');

export const enderecoSchema = z
  .object({
    cep: strTrim(12).optional().or(z.literal('')),
    logradouro: strTrim(160).optional().or(z.literal('')),
    numero: strTrim(20).optional().or(z.literal('')),
    complemento: strTrim(80).optional().or(z.literal('')),
    bairro: strTrim(80).optional().or(z.literal('')),
    cidade: strTrim(80).optional().or(z.literal('')),
    uf: strTrim(2).optional().or(z.literal('')),
  })
  .partial();

export const cadastroSchema = z
  .object({
    nomeCompleto: z.string().trim().min(3, 'Informe o nome completo').max(160),
    cpf: z.string().transform(somenteDigitos).refine(cpfValido, 'CPF inválido'),
    email: z.string().trim().toLowerCase().email('E-mail inválido').max(160),
    telefone: strTrim(20).optional().or(z.literal('')),
    endereco: enderecoSchema.optional(),
    temDeficiencia: z.coerce.boolean().optional().default(false),
    descricaoDeficiencia: strTrim(500).optional().or(z.literal('')),
    senha: senhaSchema,
    confirmaSenha: z.string(),
    aceiteTermos: z.literal('on', { errorMap: () => ({ message: 'É necessário aceitar os Termos e o Aviso de Privacidade' }) }),
  })
  .refine((d) => d.senha === d.confirmaSenha, { message: 'As senhas não conferem', path: ['confirmaSenha'] });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  senha: z.string().min(1, 'Informe a senha'),
});

export const perfilSchema = z.object({
  nomeCompleto: z.string().trim().min(3).max(160),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(160),
  telefone: strTrim(20).optional().or(z.literal('')),
  endereco: enderecoSchema.optional(),
  temDeficiencia: z.coerce.boolean().optional().default(false),
  descricaoDeficiencia: strTrim(500).optional().or(z.literal('')),
});

export const trocaSenhaSchema = z
  .object({
    senhaAtual: z.string().min(1, 'Informe a senha atual'),
    novaSenha: senhaSchema,
    confirmaSenha: z.string(),
  })
  .refine((d) => d.novaSenha === d.confirmaSenha, { message: 'As senhas não conferem', path: ['confirmaSenha'] });

export const esqueciSenhaSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
});

export const resetSenhaSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('E-mail inválido'),
    codigo: z.string().trim().regex(/^\d{6}$/, 'Informe o código de 6 dígitos que enviamos por e-mail'),
    novaSenha: senhaSchema,
    confirmaSenha: z.string(),
  })
  .refine((d) => d.novaSenha === d.confirmaSenha, { message: 'As senhas não conferem', path: ['confirmaSenha'] });

// ---- Admin ----------------------------------------------------------------

export const adminLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  senha: z.string().min(1, 'Informe a senha'),
});

export const editalSchema = z.object({
  titulo: z.string().trim().min(3, 'Informe o título').max(200),
  numero: z.string().trim().min(1, 'Informe o número/identificador').max(60),
  descricao: strTrim(5000).optional().or(z.literal('')),
  dataAberturaInscricao: z.string().optional().or(z.literal('')),
  dataEncerramentoInscricao: z.string().optional().or(z.literal('')),
});

export const cargoSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome do cargo').max(160),
  descricao: strTrim(2000).optional().or(z.literal('')),
  qtdVagas: z.coerce.number().int().min(0).max(100000).default(1),
  requisitos: strTrim(2000).optional().or(z.literal('')),
  // Salário: aceita "1412,00", "1.412,00" ou "1412.00"; vazio = sem informação.
  salario: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .transform((s) => {
      if (!s) return null;
      const limpo = s.replace(/[R$\s.]/g, '').replace(',', '.');
      const n = Number(limpo);
      return Number.isFinite(n) ? n : null;
    }),
  cargaHoraria: strTrim(60).optional().or(z.literal('')),
});

export const recursoSchema = z.object({
  texto: z.string().trim().min(10, 'Descreva a fundamentação do recurso (mín. 10 caracteres)').max(8000),
});

export const respostaRecursoSchema = z.object({
  status: z.enum(['deferido', 'indeferido']),
  respostaAdmin: z.string().trim().min(3, 'Escreva a resposta fundamentada').max(8000),
});

export const indeferimentoSchema = z.object({
  motivo: z.string().trim().min(3, 'Informe o motivo do indeferimento').max(2000),
});

export const adminCandidatoSchema = z.object({
  nomeCompleto: z.string().trim().min(3, 'Informe o nome completo').max(160),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(160),
  telefone: strTrim(20).optional().or(z.literal('')),
  endereco: enderecoSchema.optional(),
  descricaoDeficiencia: strTrim(500).optional().or(z.literal('')),
});

export const adminSenhaSchema = z
  .object({
    novaSenha: senhaSchema,
    confirmaSenha: z.string(),
  })
  .refine((d) => d.novaSenha === d.confirmaSenha, { message: 'As senhas não conferem', path: ['confirmaSenha'] });

export const publicacaoSchema = z.object({
  tipo: z.enum([
    'edital',
    'retificacao',
    'gabarito_preliminar',
    'gabarito_definitivo',
    'resultado',
    'classificacao',
    'convocacao',
    'outro',
  ]),
  titulo: z.string().trim().min(2, 'Informe um título').max(200),
});

export const configSmtpSchema = z.object({
  smtpHost: strTrim(160).optional().or(z.literal('')),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
  smtpUser: strTrim(160).optional().or(z.literal('')),
  smtpPass: z.string().max(400).optional().or(z.literal('')),
  smtpFrom: strTrim(200).optional().or(z.literal('')),
});

export const emailTesteSchema = z.object({
  destino: z.string().trim().toLowerCase().email('Informe um e-mail válido para o teste'),
});

/** Achata erros do zod em { campo: mensagem }. */
export function errosZod(parsed) {
  const out = {};
  for (const issue of parsed.error.issues) {
    const campo = issue.path.join('.') || '_';
    if (!out[campo]) out[campo] = issue.message;
  }
  return out;
}
