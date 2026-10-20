// =====================================================================
// Configuração de acesso ao Supabase — escolha AUTOMÁTICA do banco
// =====================================================================
// Existem dois bancos:
//   * "teste"    = projeto racha-teste, só com dados fictícios;
//   * "producao" = banco real do racha.
//
// COMO A ESCOLHA É FEITA: pelo endereço em que a página está aberta.
//   * localhost, 127.0.0.1, [::1] ou qualquer "algo.localhost"
//       -> é o computador de quem está desenvolvendo -> banco de TESTE
//         (e aparece a faixa "AMBIENTE DE TESTE" no topo);
//   * qualquer outro endereço (ex.: viniciusesousa.github.io)
//       -> banco REAL, sem faixa.
// Ou seja: só quem roda o app no próprio computador cai no teste; o site
// publicado sempre usa o banco real.
//
// As chaves abaixo são PÚBLICAS ("publishable"): foram feitas para ficar
// no navegador. Quem protege os dados é o próprio banco (RLS + permissões).
// Nunca coloque aqui uma chave secreta ("sb_secret_...").
//
// A URL é só o endereço do projeto, SEM o "/rest/v1/" no final.

(function () {
  const AMBIENTES = {
    producao: {
      SUPABASE_URL: "https://javfqneviqtcmhaamxkb.supabase.co",
      SUPABASE_CHAVE_PUBLICA: "sb_publishable_6hkbT9Ha5CQeDRP-JE4Ppw_f8rrTQNR",
    },
    teste: {
      SUPABASE_URL: "https://vijufuqgulymwiikdbxm.supabase.co",
      SUPABASE_CHAVE_PUBLICA: "sb_publishable_iywAEOFwVF14o2MAQ9A18g_SrF1vscr",
    },
  };

  // Endereços considerados "o computador de quem desenvolve".
  const ENDERECOS_DE_TESTE = ["localhost", "127.0.0.1", "[::1]", "::1"];

  // Decide o ambiente a partir do nome do endereço (hostname).
  function escolherAmbiente(endereco) {
    const nome = String(endereco || "").toLowerCase();
    return ENDERECOS_DE_TESTE.includes(nome) || nome.endsWith(".localhost") ? "teste" : "producao";
  }

  const ambiente = escolherAmbiente(window.location.hostname);
  window.CONFIG = { AMBIENTE: ambiente, ...AMBIENTES[ambiente] };
  window.escolherAmbiente = escolherAmbiente;  // usado também nos testes

  // No banco de teste, mostra uma faixa bem visível no topo de qualquer página.
  if (ambiente === "teste") {
    document.documentElement.classList.add("ambiente-teste");
    const colocarFaixa = () => {
      if (document.querySelector(".faixa-teste")) return;
      const faixa = document.createElement("div");
      faixa.className = "faixa-teste";
      faixa.setAttribute("role", "status");
      faixa.textContent = "AMBIENTE DE TESTE · dados fictícios";
      document.body.prepend(faixa);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", colocarFaixa);
    else colocarFaixa();
  }
})();
