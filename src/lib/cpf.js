// Validação de CPF (dígito verificador) — antifraude limitado por decisão de
// escopo (premissa/risco residual 2: sem validação oficial gov.br).

/** Remove tudo que não for dígito. */
export function somenteDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

/**
 * Valida CPF pelos dois dígitos verificadores.
 * Rejeita sequências repetidas (000..., 111..., etc.) e tamanho != 11.
 */
export function cpfValido(valor) {
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // todos iguais

  const calcDV = (base, pesoInicial) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * (pesoInicial - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const dv1 = calcDV(cpf.slice(0, 9), 10);
  if (dv1 !== Number(cpf[9])) return false;

  const dv2 = calcDV(cpf.slice(0, 10), 11);
  if (dv2 !== Number(cpf[10])) return false;

  return true;
}

/** Formata como 000.000.000-00 (assume 11 dígitos já validados). */
export function formatarCpf(valor) {
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11) return valor;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}
