// =====================================================================
// App do Racha — área do admin: CONFIGURAÇÕES
// =====================================================================
// * Valor padrão do racha (tabela configuracoes, uma única linha): é o
//   valor sugerido ao abrir um racha novo. Mudar aqui NÃO altera rachas
//   já abertos nem cobranças já feitas.
// =====================================================================

window.SecaoConfig = (() => {
  const estado = { el: null, valor: null };

  const reais = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  async function carregar() {
    const { data, error } = await banco.from("configuracoes").select("valor_padrao_racha").limit(1);
    if (error) throw error;
    estado.valor = data && data[0] ? Number(data[0].valor_padrao_racha) : 0;
  }

  function desenhar(aviso = "") {
    estado.el.innerHTML = `
      ${aviso ? `<p class="mensagem mensagem-aviso" style="margin:0 0 12px">✔ ${esc(aviso)}</p>` : ""}
      <div class="cartao">
        <h2 class="secao-titulo" style="margin-top:0">Valor do racha</h2>
        <p class="legenda" style="margin-top:0">Valor atual: <b>${reais(estado.valor)}</b> por jogador.</p>
        ${estado.valor === 0 ? `<p class="mensagem mensagem-aviso">O valor está zerado: ajuste antes de abrir o próximo racha (R$ 15 em 2026).</p>` : ""}
        <form id="form-config" class="form-grade" novalidate>
          <label class="campo"><span>Novo valor padrão (R$)</span>
            <input type="text" inputmode="decimal" autocomplete="off" id="cfg-valor" value="${valorCampo(estado.valor)}"></label>
          <button type="submit" class="botao botao-largo">Salvar valor</button>
        </form>
        <p class="legenda">É o valor sugerido ao abrir um racha novo. Mudar aqui não altera os rachas já
          abertos nem as cobranças já feitas. Goleiro continua não pagando.</p>
      </div>`;
  }

  function salvar() {
    const texto = estado.el.querySelector("#cfg-valor").value.trim();
    const valor = lerValor(texto);
    if (texto === "" || !(valor >= 0)) return mostrarFalha("Informe um valor válido (ex.: 15 ou 17,50).");
    if (!confirm(`Mudar o valor padrão do racha para ${reais(valor)}?`)) return;
    gravar(
      () => banco.from("configuracoes").update({ valor_padrao_racha: valor }).eq("id", true)
        .select("valor_padrao_racha").single(),
      async () => { await carregar(); desenhar("Valor padrão salvo."); });
  }

  async function abrir(painel) {
    painel.innerHTML = `<div id="secao-config"><p class="vazio">Carregando…</p></div>`;
    estado.el = painel.querySelector("#secao-config");
    estado.el.addEventListener("submit", (e) => { e.preventDefault(); salvar(); });
    await gravar(() => carregar(), () => desenhar());
  }

  return { abrir };
})();
