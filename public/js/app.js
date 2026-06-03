// Aprimoramentos progressivos (sem framework). Tudo é defensivo: se os
// elementos não existirem na página, nada acontece.
(function () {
  'use strict';

  // ---- 1) Mostrar a descrição de deficiência apenas se a pessoa declarar ----
  document.querySelectorAll('[data-toggle-by]').forEach(function (bloco) {
    var chk = document.getElementById(bloco.getAttribute('data-toggle-by'));
    if (!chk) return;
    var sync = function () { bloco.hidden = !chk.checked; };
    chk.addEventListener('change', sync);
    sync(); // estado inicial
  });

  // ---- 2) Autopreenchimento de endereço pelo CEP (ViaCEP) ----
  var cepInput = document.getElementById('endereco_cep');
  if (cepInput) {
    var campos = {
      logradouro: document.getElementById('endereco_logradouro'),
      bairro: document.getElementById('endereco_bairro'),
      localidade: document.getElementById('endereco_cidade'),
      uf: document.getElementById('endereco_uf'),
    };
    var numero = document.getElementById('endereco_numero');

    var buscar = function () {
      var cep = (cepInput.value || '').replace(/\D/g, '');
      if (cep.length !== 8) return;
      cepInput.setAttribute('aria-busy', 'true');
      fetch('https://viacep.com.br/ws/' + cep + '/json/')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data || data.erro) return; // CEP inexistente: deixa o usuário digitar
          // Preenche cidade/UF sempre; logradouro/bairro só quando a API traz
          // (CEPs genéricos terminados em -000 não têm rua/bairro).
          ['logradouro', 'bairro', 'localidade', 'uf'].forEach(function (k) {
            var el = campos[k];
            if (el && data[k]) el.value = data[k];
          });
          // Foca o número quando a rua veio pronta (fluxo natural de digitação).
          if (numero && data.logradouro) numero.focus();
        })
        .catch(function () { /* offline / bloqueado: silencioso */ })
        .finally(function () { cepInput.removeAttribute('aria-busy'); });
    };

    cepInput.addEventListener('blur', buscar);
    cepInput.addEventListener('change', buscar);
  }

  // ---- 3) Máscara de moeda BRL (estilo app de banco) ----
  function formatarBRL(digits) {
    digits = (digits || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    while (digits.length < 3) digits = '0' + digits;
    var cent = digits.slice(-2);
    var reais = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return 'R$ ' + reais + ',' + cent;
  }
  document.querySelectorAll('[data-moeda]').forEach(function (inp) {
    var aplicar = function () {
      var d = inp.value.replace(/\D/g, '');
      inp.value = d ? formatarBRL(d) : '';
    };
    inp.addEventListener('input', aplicar);
    inp.addEventListener('blur', aplicar);
    if (inp.value.trim()) aplicar(); // formata o valor que veio do servidor
  });

  // ---- 4) Inscrição: baixar edital libera o aceite; aceite libera o envio ----
  var form = document.querySelector('[data-form-inscricao]');
  if (form) {
    var aceite = form.querySelector('#aceiteTermos');
    var enviar = form.querySelector('#btn-enviar');
    var baixar = form.querySelector('#baixar-edital');
    var dica = form.querySelector('#dica-aceite');
    var temEdital = form.hasAttribute('data-tem-edital');
    var sync = function () { if (enviar) enviar.disabled = !(aceite && aceite.checked && !aceite.disabled); };
    if (temEdital && baixar && aceite) {
      aceite.disabled = true;
      if (dica) dica.textContent = '⬆️ Primeiro baixe o edital (botão roxo acima). Depois este aceite é liberado.';
      baixar.addEventListener('click', function () {
        aceite.disabled = false;
        if (dica) dica.textContent = '✓ Edital baixado. Agora marque o aceite e clique em "Enviar inscrição".';
        sync();
      });
    }
    if (aceite) aceite.addEventListener('change', sync);
    sync();
  }
})();
