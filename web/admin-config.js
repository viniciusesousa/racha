// =====================================================================
// App do Racha — área do admin: CONFIGURAÇÕES
// =====================================================================
// Tabela configuracoes (uma única linha):
// * valor padrão do racha: sugerido ao abrir um racha novo;
// * valor da quadra (script 09): lançado no Crédito na quadra ao abrir
//   cada racha (0 = não lança);
// * valor do goleiro de aluguel (script 09): usado pelo botão
//   "+ goleiro de aluguel" do fechamento (sai do Banco).
// Mudar aqui NÃO altera rachas, cobranças nem despesas já lançados.
// =====================================================================

window.SecaoConfig = (() => {
  const estado = { el: null, cfg: null };

  const CAMPOS = [
    { coluna: "valor_padrao_racha", id: "cfg-valor", rotulo: "Valor do racha por jogador (R$)",
      ajuda: "Sugerido ao abrir um racha novo. Goleiro continua não pagando." },
    { coluna: "valor_quadra", id: "cfg-quadra", rotulo: "Aluguel da quadra por racha (R$)",
      ajuda: "Lançado sozinho no Crédito na quadra ao abrir cada racha. Use 0 para não lançar." },
    { coluna: "valor_goleiro_aluguel", id: "cfg-goleiro", rotulo: "Goleiro de aluguel (R$)",
      ajuda: "Usado pelo botão “+ goleiro de aluguel” do fechamento; sai do Banco." },
  ];

  const reais = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  async function carregar() {
    const { data, error } = await banco.from("configuracoes")
      .select(CAMPOS.map((c) => c.coluna).join(", ")).limit(1);
    if (error) throw error;
    const linha = data && data[0] ? data[0] : {};
    estado.cfg = Object.fromEntries(CAMPOS.map((c) => [c.coluna, Number(linha[c.coluna] ?? 0)]));
  }

  function desenhar(aviso = "") {
    const cfg = estado.cfg;
    estado.el.innerHTML = `
      ${aviso ? `<p class="mensagem mensagem-aviso" style="margin:0 0 12px">✔ ${esc(aviso)}</p>` : ""}
      <div class="cartao">
        <h2 class="secao-titulo" style="margin-top:0">Valores</h2>
        ${cfg.valor_padrao_racha === 0 ? `<p class="mensagem mensagem-aviso">O valor do racha está zerado: ajuste antes de abrir o próximo racha (R$ 15 em 2026).</p>` : ""}
        <form id="form-config" class="form-grade" novalidate>
          ${CAMPOS.map((c) => `
            <label class="campo"><span>${c.rotulo}</span>
              <input type="text" inputmode="decimal" autocomplete="off" id="${c.id}" value="${valorCampo(cfg[c.coluna])}">
              <small class="legenda" style="margin:0;font-weight:400">${c.ajuda} Atual: ${reais(cfg[c.coluna])}.</small></label>`).join("")}
          <button type="submit" class="botao botao-largo">Salvar valores</button>
        </form>
        <p class="legenda">Mudar aqui não altera rachas, cobranças nem despesas já lançados.</p>
      </div>`;
  }

  function salvar() {
    const novos = {};
    for (const c of CAMPOS) {
      const texto = estado.el.querySelector(`#${c.id}`).value.trim();
      const valor = lerValor(texto);
      if (texto === "" || !(valor >= 0)) return mostrarFalha(`${c.rotulo}: informe um valor válido (ex.: 15 ou 37,49).`);
      novos[c.coluna] = valor;
    }
    const mudou = CAMPOS.filter((c) => Math.round(novos[c.coluna] * 100) !== Math.round(estado.cfg[c.coluna] * 100));
    if (!mudou.length) return desenhar("Nada mudou.");
    if (!confirm(`Salvar?\n${mudou.map((c) => `${c.rotulo}: ${reais(estado.cfg[c.coluna])} → ${reais(novos[c.coluna])}`).join("\n")}`)) return;
    gravar(
      () => banco.from("configuracoes").update(novos).eq("id", true).select("id").single(),
      async () => { await carregar(); desenhar("Valores salvos."); });
  }

  async function abrir(painel) {
    painel.innerHTML = `<div id="secao-config"><p class="vazio">Carregando…</p></div>`;
    estado.el = painel.querySelector("#secao-config");
    estado.el.addEventListener("submit", (e) => { e.preventDefault(); salvar(); });
    await gravar(() => carregar(), () => desenhar());
  }

  return { abrir };
})();
