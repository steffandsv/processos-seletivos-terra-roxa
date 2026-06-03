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
})();
