// Hash de senha (argon2) e a interface AuthProvider plugável (§3).
// Hoje: e-mail/senha. Amanhã (gov.br): basta uma nova implementação de
// AuthProvider, sem reescrever as rotas.
import { hash, verify } from '@node-rs/argon2';
import prisma from '../db.js';

export async function hashSenha(senha) {
  return hash(senha);
}

export async function verificarSenha(hashArmazenado, senha) {
  try {
    return await verify(hashArmazenado, senha);
  } catch {
    return false;
  }
}

/** Contrato de autenticação de candidato. */
export class AuthProvider {
  async autenticar(_identificador, _credencial) {
    throw new Error('Não implementado');
  }
}

/** Implementação padrão: e-mail + senha contra a tabela candidato. */
export class SenhaAuthProvider extends AuthProvider {
  async autenticar(email, senha) {
    const candidato = await prisma.candidato.findUnique({ where: { email } });
    if (!candidato) {
      // Evita timing trivial de enumeração de e-mails.
      await verify('$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$0000000000000000000000000000000000000000000', senha).catch(() => false);
      return null;
    }
    const ok = await verificarSenha(candidato.senhaHash, senha);
    return ok ? candidato : null;
  }
}

export const authProvider = new SenhaAuthProvider();
