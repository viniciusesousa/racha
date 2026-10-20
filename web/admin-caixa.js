// =====================================================================
// App do Racha — área do admin: CAIXA
// =====================================================================
// * Lançar despesa (data, descrição, categoria, valor).
// * Saldo atual do caixa = tudo o que entrou (pagamentos) − tudo o que
//   saiu (despesas), desde o começo.
// * Extrato do mês escolhido: entradas e saídas em ordem de data, com os
//   totais do mês. Despesa lançada errada pode ser excluída (com confirmação).
// =====================================================================

window.SecaoCaixa = (() => {
  const estado = {
    el: null,
    mes: null,           // "2026-10"
    saldo: 0,            // saldo atual (todas as datas)
    entradas: [],        // pagamentos do mês: { id, data, valor, forma, nome }
    saidas: [],          // despesas do mês: { id, data, valor, descricao, categoria }
    categorias: [],      // categorias já usadas (sugestões)
    formAberto: false,
  };

  const CATEGORIAS_PADRAO = ["Quadra", "Bola", "Coletes", "Arbitragem", "Confraternização", "Outros"];
  const NOME_FORMA = { pix: "Pix", dinheiro: "Dinheiro", cartao: "Cartão", nao_informado: "não informado" };
  const NOMES_MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
    "agosto", "setembro", "outubro", "novembro", "dezembro"];

  // ---------------------------------------------------------------
  // Auxiliares
  // ---------------------------------------------------------------
  function hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const dataBR = (iso) => { const [a, m, d] = iso.split("-"); return `${d}/${m}/${a}`; };
  const reais = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const centavos = (v) => Math.round(Number(v) * 100);
  function nomeMes(anoMes) { const [a, m] = anoMes.split("-").map(Number); return `${NOMES_MESES[m - 1]} de ${a}`; }
  function fimDoMes(anoMes) { const [a, m] = anoMes.split("-").map(Number); return `${anoMes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`; }

  // O banco entrega no máximo 1000 linhas por pedido: busca página por página.
  async function buscarTodas(montar) {
    const todas = [];
    for (let i = 0; ; i += 1000) {
      const { data, error } = await montar().range(i, i + 999);
      if (error) throw error;
      todas.push(...data);
      if (data.length < 1000) return todas;
    }
  }

  // ---------------------------------------------------------------
  // Carregamento
  // ---------------------------------------------------------------
  async function carregar() {
    const de = `${estado.mes}-01`, ate = fimDoMes(estado.mes);
    const [todosPag, todasDesp, pagMes, despMes] = await Promise.all([
      buscarTodas(() => banco.from("pagamentos").select("valor").order("id")),
      buscarTodas(() => banco.from("despesas").select("valor, categoria").order("id")),
      buscarTodas(() => banco.from("pagamentos").select("id, data_pagamento, valor, forma, jogadores(nome)")
        .gte("data_pagamento", de).lte("data_pagamento", ate).order("data_pagamento").order("id")),
      buscarTodas(() => banco.from("despesas").select("id, data, valor, descricao, categoria")
        .gte("data", de).lte("data", ate).order("data").order("id")),
    ]);
    // Saldo em centavos, para não acumular erro de arredondamento.
    estado.saldo = (todosPag.reduce((a, p) => a + centavos(p.valor), 0)
                  - todasDesp.reduce((a, d) => a + centavos(d.valor), 0)) / 100;
    estado.entradas = pagMes.map((p) => ({ id: p.id, data: p.data_pagamento, valor: Number(p.valor), forma: p.forma, nome: p.jogadores?.nome ?? "?" }));
    estado.saidas = despMes.map((d) => ({ ...d, valor: Number(d.valor) }));
    estado.categorias = [...new Set([...CATEGORIAS_PADRAO, ...todasDesp.map((d) => d.categoria).filter(Boolean)])];
  }

  // ---------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------
  function desenhar() {
    const totalEntradas = estado.entradas.reduce((a, e) => a + centavos(e.valor), 0) / 100;
    const totalSaidas = estado.saidas.reduce((a, s) => a + centavos(s.valor), 0) / 100;
    const resultado = totalEntradas - totalSaidas;

    // Extrato: entradas e saídas juntas, da data mais recente para a mais antiga.
    const linhas = [
      ...estado.entradas.map((e) => ({ ...e, tipo: "entrada", texto: `Pagamento — ${e.nome} (${NOME_FORMA[e.forma] ?? e.forma})` })),
      ...estado.saidas.map((s) => ({ ...s, tipo: "saida", texto: `${s.descricao}${s.categoria ? ` (${s.categoria})` : ""}` })),
    ].sort((a, b) => b.data.localeCompare(a.data) || (a.tipo === b.tipo ? b.id - a.id : a.tipo === "saida" ? -1 : 1));

    estado.el.innerHTML = `
      <div class="cartao saldo-caixa">
        <span>Saldo atual do caixa</span>
        <b class="num ${estado.saldo < 0 ? "negativo" : ""}">${reais(estado.saldo)}</b>
        <small>tudo o que entrou − tudo o que saiu, desde o começo</small>
      </div>

      ${estado.formAberto ? htmlFormDespesa() : `
        <button type="button" class="botao botao-largo" data-acao="abrir-despesa">+ Lançar despesa</button>`}

      <div class="cartao extrato-cabecalho">
        <label class="campo"><span>Extrato do mês</span>
          <input type="month" id="caixa-mes" value="${estado.mes}"></label>
        <div class="extrato-totais">
          <div><span>Entradas</span><b class="num">${reais(totalEntradas)}</b></div>
          <div><span>Saídas</span><b class="num">${reais(totalSaidas)}</b></div>
          <div><span>Resultado</span><b class="num ${resultado < 0 ? "negativo" : ""}">${reais(resultado)}</b></div>
        </div>
      </div>

      ${linhas.length ? `<ul class="lista extrato">${linhas.map((l) => `
        <li class="extrato-linha">
          <span class="extrato-data">${dataBR(l.data).slice(0, 5)}</span>
          <span class="extrato-texto">${esc(l.texto)}</span>
          <span class="extrato-valor ${l.tipo}">${l.tipo === "entrada" ? "+" : "−"} ${reais(l.valor)}</span>
          ${l.tipo === "saida" ? `<button type="button" class="extrato-excluir" data-acao="excluir-despesa" data-despesa="${l.id}"
              aria-label="Excluir despesa ${esc(l.descricao)}">✕</button>` : ""}
        </li>`).join("")}</ul>`
        : `<p class="vazio">Nenhum lançamento em ${nomeMes(estado.mes)}.</p>`}
      <p class="legenda">Entradas = pagamentos dos jogadores (registrados no Racha do dia ou em Devedores).
        Saídas = despesas lançadas aqui. Para corrigir um pagamento, exclua-o no fechamento do racha.</p>`;

    estado.el.querySelector("#caixa-mes").addEventListener("change", (e) => {
      if (!e.target.value) return;
      estado.mes = e.target.value;
      recarregar();
    });
  }

  function htmlFormDespesa() {
    return `
      <div class="cartao">
        <h3 class="secao-titulo" style="margin-top:0">Nova despesa</h3>
        <form id="form-despesa" class="form-grade" novalidate>
          <label class="campo"><span>Data</span><input type="date" id="desp-data" value="${hojeISO()}" required></label>
          <label class="campo"><span>Descrição</span>
            <input type="text" id="desp-descricao" placeholder="Ex.: aluguel da quadra" required maxlength="120"></label>
          <label class="campo"><span>Categoria</span>
            <input type="text" id="desp-categoria" list="lista-categorias" placeholder="Escolha ou digite" maxlength="40">
            <datalist id="lista-categorias">${estado.categorias.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
          <label class="campo"><span>Valor (R$)</span>
            <input type="text" inputmode="decimal" autocomplete="off" id="desp-valor" placeholder="Ex.: 89,90" required></label>
          <div class="form-pagou-botoes">
            <button type="button" class="link-botao" data-acao="cancelar-despesa">Cancelar</button>
            <button type="submit" class="botao">Lançar despesa</button>
          </div>
        </form>
      </div>`;
  }

  // ---------------------------------------------------------------
  // Ações
  // ---------------------------------------------------------------
  function lancarDespesa() {
    const val = (id) => estado.el.querySelector(id).value.trim();
    const registro = {
      data: val("#desp-data"),
      descricao: val("#desp-descricao"),
      categoria: val("#desp-categoria") || null,
      valor: lerValor(val("#desp-valor")),
    };
    if (!registro.data) return mostrarFalha("Informe a data da despesa.");
    if (!registro.descricao) return mostrarFalha("Informe a descrição da despesa.");
    if (!(registro.valor > 0)) return mostrarFalha("Informe um valor maior que zero.");
    // A despesa entra no extrato do mês dela.
    gravar(
      () => banco.from("despesas").insert(registro).select("id").single(),
      async () => { estado.formAberto = false; estado.mes = registro.data.slice(0, 7); await carregar(); desenhar(); });
  }

  function excluirDespesa(id) {
    const d = estado.saidas.find((x) => x.id === id);
    if (!d) return;
    if (!confirm(`Excluir a despesa "${d.descricao}" de ${dataBR(d.data)} (${reais(d.valor)})?`)) return;
    gravar(
      () => banco.from("despesas").delete().eq("id", id),
      async () => { await carregar(); desenhar(); });
  }

  async function recarregar() {
    estado.el.innerHTML = `<p class="vazio">Carregando…</p>`;
    await gravar(() => carregar(), () => desenhar());
  }

  function aoTocar(evento) {
    const b = evento.target.closest("button");
    if (!b || b.disabled) return;
    switch (b.dataset.acao) {
      case "abrir-despesa": estado.formAberto = true; desenhar(); estado.el.querySelector("#desp-descricao")?.focus(); break;
      case "cancelar-despesa": estado.formAberto = false; desenhar(); break;
      case "excluir-despesa": excluirDespesa(Number(b.dataset.despesa)); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------
  // Entrada da seção
  // ---------------------------------------------------------------
  async function abrir(painel) {
    painel.innerHTML = `<div id="secao-caixa"></div>`;
    estado.el = painel.querySelector("#secao-caixa");
    estado.el.addEventListener("click", aoTocar);
    estado.el.addEventListener("submit", (e) => { e.preventDefault(); lancarDespesa(); });
    estado.mes = estado.mes || hojeISO().slice(0, 7);
    estado.formAberto = false;
    await recarregar();
  }

  return { abrir };
})();
