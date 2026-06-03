// Cria/atualiza a conta administradora.
// Uso:
//   node --env-file=.env scripts/create-admin.js <email> "<nome>" <senha>
// ou via ambiente: ADMIN_EMAIL, ADMIN_NOME, ADMIN_SENHA
import prisma from '../src/db.js';
import { hashSenha } from '../src/lib/seguranca.js';

async function main() {
  const [, , argEmail, argNome, argSenha] = process.argv;
  const email = (argEmail || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const nome = (argNome || process.env.ADMIN_NOME || 'Administrador').trim();
  const senha = argSenha || process.env.ADMIN_SENHA || '';

  if (!email || !senha) {
    console.error('Uso: node --env-file=.env scripts/create-admin.js <email> "<nome>" <senha>');
    console.error('  (ou defina ADMIN_EMAIL, ADMIN_NOME, ADMIN_SENHA no ambiente)');
    process.exit(1);
  }
  if (senha.length < 8) {
    console.error('A senha deve ter ao menos 8 caracteres.');
    process.exit(1);
  }

  const senhaHash = await hashSenha(senha);
  const admin = await prisma.usuarioAdmin.upsert({
    where: { email },
    update: { nome, senhaHash },
    create: { email, nome, senhaHash },
  });
  console.log(`✔ Conta administradora pronta: ${admin.email} (id ${admin.id})`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
