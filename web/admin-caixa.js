// =====================================================================
// App do Racha — área do admin: CAIXA (duas contas)
// =====================================================================
// O caixa tem DUAS CONTAS (script 09):
//   * Banco: conta exclusiva do racha. Entra Pix, rendimentos e entradas
//     avulsas; sai goleiro de aluguel, material etc.
//   * Crédito na quadra: entra dinheiro e cartão (pagos direto na quadra);
//     sai o aluguel da quadra de cada racha (lançado ao abrir o racha).
// Nesta tela:
//   * saldo atual de cada conta (visão v_saldo_contas);
//   * lançar despesa (escolhendo a conta), transferência entre contas
//     (não é despesa), entrada avulsa ou rendimento;
//   * conferência da quadra: compara com o saldo da ficha da quadra e lança
//     a diferença no saldo inicial da quadra (01/07/2026);
//   * extrato do mês (visão v_extrato_caixa), com filtro por conta.
//     Despesas e movimentos lançados errado podem ser excluídos.
// =====================================================================

window.SecaoCaixa = (() => {
  const estado = {
    el: null,
    mes: null,           // "2026-10"
    filtro: "todas",     // todas | banco | quadra
    saldos: { banco: 0, quadra: 0 },
    linhas: [],          // extrato do mês: { origem, id, data, conta, valor, descricao, detalhe }
    categorias: [],      // categorias de despesa já usadas (sugestões)
    form: null,          // null | despesa | transferencia | entrada | conferencia
    conferencia: null,   // { data, ficha, calculado, inicial: { id, valor, data } | null }
    aviso: "",
  };

  const DATA_INICIO_CAIXA = "2026-07-01";   // início do controle financeiro
  const CATEGORIAS_PADRAO = ["Quadra", "Goleiro de aluguel", "Material", "Bola", "Coletes", "Confraternização", "Outros"];
  const NOME_CONTA = { banco: "Banco", quadra: "Crédito na quadra" };
  const CONTA_CURTA = { banco: "Banco", quadra: "Quadra" };
  const NOME_FORMA = { pix: "Pix", dinheiro: "Dinheiro", cartao: "Cartão", dinheiro_ou_cartao: "Dinheiro/cartão", nao_informado: "Dinheiro/cartão" };
  const NOME_MOVIMENTO = { saldo_inicial: "Saldo inicial", rendimento: "Rendimento", entrada_avulsa: "Entrada avulsa", transferencia: "Transferência" };
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
  const soma = (lista) => lista.reduce((a, x) => a + centavos(x.valor), 0) / 100;
  const outra = (conta) => (conta === "banco" ? "quadra" : "banco");
  function nomeMes(anoMes) { const [a, m] = anoMes.split("-").map(Number); return `${NOMES_MESES[m - 1]} de ${a}`; }
  function fimDoMes(anoMes) { const [a, m] = anoMes.split("-").map(Number); return `${anoMes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`; }
  const opcoesConta = (escolhida) => ["banco", "quadra"].map((c) =>
    `<option value="${c}" ${c === escolhida ? "selected" : ""}>${NOME_CONTA[c]}</option>`).join("");

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
    const [sal, linhas, cats] = await Promise.all([
      banco.from("v_saldo_contas").select("conta, saldo"),
      buscarTodas(() => banco.from("v_extrato_caixa").select("origem, id, data, conta, valor, descricao, detalhe")
        .gte("data", de).lte("data", ate).order("data").order("id")),
      buscarTodas(() => banco.from("despesas").select("categoria").order("id")),
    ]);
    if (sal.error) throw sal.error;
    estado.saldos = { banco: 0, quadra: 0 };
    for (const s of sal.data) estado.saldos[s.conta] = Number(s.saldo);
    estado.linhas = linhas.map((l) => ({ ...l, valor: Number(l.valor) }));
    estado.categorias = [...new Set([...CATEGORIAS_PADRAO, ...cats.map((d) => d.categoria).filter(Boolean)])];
  }

  // Saldo calculado da quadra até uma data e o saldo inicial já lançado.
  async function carregarConferencia(data) {
    const [linhas, ini] = await Promise.all([
      buscarTodas(() => banco.from("v_extrato_caixa").select("valor").eq("conta", "quadra").lte("data", data).order("data").order("id")),
      banco.from("movimentos_conta").select("id, valor, data").eq("tipo", "saldo_inicial").eq("conta_destino", "quadra").maybeSingle(),
    ]);
    if (ini.error) throw ini.error;
    estado.conferencia.calculado = soma(linhas);
    estado.conferencia.inicial = ini.data ? { ...ini.data, valor: Number(ini.data.valor) } : null;
  }

  // ---------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------
  function textoLinha(l) {
    if (l.origem === "pagamento") return `${l.descricao} (${NOME_FORMA[l.detalhe] ?? l.detalhe})`;
    // Categoria entre parênteses, só se ainda não estiver na descrição.
    if (l.origem === "despesa") {
      const mostraCategoria = l.detalhe && !l.descricao.toLowerCase().includes(l.detalhe.toLowerCase());
      return `${l.descricao}${mostraCategoria ? ` (${l.detalhe})` : ""}`;
    }
    if (l.detalhe === "transferencia") {
      return `${l.valor < 0 ? `Transferência para o ${NOME_CONTA[outra(l.conta)]}` : `Transferência do ${NOME_CONTA[outra(l.conta)]}`} — ${l.descricao}`;
    }
    return `${NOME_MOVIMENTO[l.detalhe] ?? l.detalhe} — ${l.descricao}`;
  }

  function desenhar() {
    const visiveis = estado.linhas.filter((l) => estado.filtro === "todas" || l.conta === estado.filtro);
    const entradas = soma(visiveis.filter((l) => l.valor > 0));
    const saidas = -soma(visiveis.filter((l) => l.valor < 0));
    // Extrato: da data mais recente para a mais antiga.
    const ordenadas = [...visiveis].sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);

    estado.el.innerHTML = `
      ${estado.aviso ? `<p class="mensagem mensagem-aviso" style="margin:0 0 12px">✔ ${esc(estado.aviso)}</p>` : ""}
      <div class="contas-saldo">
        ${["banco", "quadra"].map((c) => `
          <div class="cartao saldo-caixa saldo-conta">
            <span>${NOME_CONTA[c]}</span>
            <b class="num ${estado.saldos[c] < 0 ? "negativo" : ""}">${reais(estado.saldos[c])}</b>
          </div>`).join("")}
      </div>
      <p class="legenda" style="margin:4px 0 12px">Total: <b>${reais(estado.saldos.banco + estado.saldos.quadra)}</b>.
        Pix entra no Banco; dinheiro e cartão, no Crédito na quadra.</p>

      ${estado.form ? htmlForm() : `
        <div class="botoes-caixa">
          <button type="button" class="botao" data-acao="abrir-form" data-form="despesa">+ Despesa</button>
          <button type="button" class="botao botao-secundario" data-acao="abrir-form" data-form="transferencia">Transferência</button>
          <button type="button" class="botao botao-secundario" data-acao="abrir-form" data-form="entrada">+ Entrada avulsa</button>
          <button type="button" class="botao botao-secundario" data-acao="abrir-form" data-form="conferencia">Conferir quadra</button>
        </div>`}

      <div class="cartao extrato-cabecalho">
        <label class="campo"><span>Extrato do mês</span>
          <input type="month" id="caixa-mes" value="${estado.mes}"></label>
        <div class="status-botoes filtro-conta" role="group" aria-label="Conta do extrato">
          ${[["todas", "Todas"], ["banco", "Banco"], ["quadra", "Quadra"]].map(([f, nome]) => `
            <button type="button" class="status ${estado.filtro === f ? "ativa status-presente" : ""}" data-acao="filtro"
                    data-filtro="${f}" aria-pressed="${estado.filtro === f}">${nome}</button>`).join("")}
        </div>
        <div class="extrato-totais">
          <div><span>Entradas</span><b class="num">${reais(entradas)}</b></div>
          <div><span>Saídas</span><b class="num">${reais(saidas)}</b></div>
          <div><span>Resultado</span><b class="num ${entradas - saidas < 0 ? "negativo" : ""}">${reais(entradas - saidas)}</b></div>
        </div>
      </div>

      ${ordenadas.length ? `<ul class="lista extrato">${ordenadas.map((l) => `
        <li class="extrato-linha">
          <span class="extrato-data">${dataBR(l.data).slice(0, 5)}</span>
          <span class="extrato-texto">${esc(textoLinha(l))} <span class="tag-conta tag-${l.conta}">${CONTA_CURTA[l.conta]}</span></span>
          <span class="extrato-valor ${l.valor < 0 ? "saida" : "entrada"}">${l.valor < 0 ? "−" : "+"} ${reais(Math.abs(l.valor))}</span>
          ${l.origem !== "pagamento" ? `<button type="button" class="extrato-excluir" data-acao="excluir" data-origem="${l.origem}"
              data-id="${l.id}" aria-label="Excluir ${esc(l.descricao)}">✕</button>` : ""}
        </li>`).join("")}</ul>`
        : `<p class="vazio">Nenhum lançamento em ${nomeMes(estado.mes)}${estado.filtro !== "todas" ? ` no ${NOME_CONTA[estado.filtro]}` : ""}.</p>`}
      <p class="legenda">Pagamentos são registrados no Racha do dia ou em Devedores (para corrigir, exclua-os no fechamento).
        A transferência aparece nas duas contas: sai de uma e entra na outra.</p>`;

    estado.el.querySelector("#caixa-mes").addEventListener("change", (e) => {
      if (!e.target.value) return;
      estado.mes = e.target.value;
      recarregar();
    });
    const origem = estado.el.querySelector("#tr-origem");
    if (origem) origem.addEventListener("change", () => {
      estado.el.querySelector("#tr-destino").textContent = NOME_CONTA[outra(origem.value)];
    });
    const tipo = estado.el.querySelector("#en-tipo");
    if (tipo) tipo.addEventListener("change", () => {
      const desc = estado.el.querySelector("#en-descricao");
      if (tipo.value === "rendimento" && !desc.value) desc.value = "Rendimento da conta";
    });
  }

  function htmlForm() {
    const botoes = (rotulo) => `
      <div class="form-pagou-botoes">
        <button type="button" class="link-botao" data-acao="cancelar">Cancelar</button>
        <button type="submit" class="botao">${rotulo}</button>
      </div>`;
    const campoData = (id, valor = hojeISO()) => `<label class="campo"><span>Data</span><input type="date" id="${id}" value="${valor}" required></label>`;
    const campoValor = (id, rotulo = "Valor (R$)") => `<label class="campo"><span>${rotulo}</span>
      <input type="text" inputmode="decimal" autocomplete="off" id="${id}" placeholder="Ex.: 89,90" required></label>`;

    if (estado.form === "despesa") return `
      <div class="cartao"><h3 class="secao-titulo" style="margin-top:0">Nova despesa</h3>
        <form id="form-caixa" class="form-grade" novalidate>
          ${campoData("desp-data")}
          <label class="campo"><span>Descrição</span>
            <input type="text" id="desp-descricao" placeholder="Ex.: bola nova" required maxlength="120"></label>
          <label class="campo"><span>Categoria</span>
            <input type="text" id="desp-categoria" list="lista-categorias" placeholder="Escolha ou digite" maxlength="40">
            <datalist id="lista-categorias">${estado.categorias.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
          <label class="campo"><span>Saiu de qual conta?</span><select id="desp-conta">${opcoesConta("banco")}</select></label>
          ${campoValor("desp-valor")}
          ${botoes("Lançar despesa")}
        </form>
        <p class="legenda">O aluguel da quadra de cada racha já é lançado sozinho ao abrir o racha.
          O goleiro de aluguel tem botão próprio no fechamento do racha.</p>
      </div>`;

    if (estado.form === "transferencia") return `
      <div class="cartao"><h3 class="secao-titulo" style="margin-top:0">Transferência entre contas</h3>
        <form id="form-caixa" class="form-grade" novalidate>
          ${campoData("tr-data")}
          <label class="campo"><span>Sai de</span><select id="tr-origem">${opcoesConta("banco")}</select></label>
          <p class="legenda" style="margin:0">Entra em: <b id="tr-destino">${NOME_CONTA.quadra}</b></p>
          ${campoValor("tr-valor")}
          <label class="campo"><span>Descrição</span>
            <input type="text" id="tr-descricao" value="Adiantamento à quadra" required maxlength="120"></label>
          ${botoes("Lançar transferência")}
        </form>
        <p class="legenda">Transferência não é despesa: o total do caixa não muda.</p>
      </div>`;

    if (estado.form === "entrada") return `
      <div class="cartao"><h3 class="secao-titulo" style="margin-top:0">Entrada avulsa ou rendimento</h3>
        <form id="form-caixa" class="form-grade" novalidate>
          <label class="campo"><span>Tipo</span><select id="en-tipo">
            <option value="entrada_avulsa">Entrada avulsa (não é pagamento de racha)</option>
            <option value="rendimento">Rendimento da conta</option></select></label>
          ${campoData("en-data")}
          <label class="campo"><span>Entrou em qual conta?</span><select id="en-conta">${opcoesConta("banco")}</select></label>
          ${campoValor("en-valor")}
          <label class="campo"><span>Descrição</span>
            <input type="text" id="en-descricao" placeholder="Ex.: reembolso absorvido pelo caixa" required maxlength="120"></label>
          ${botoes("Lançar entrada")}
        </form>
        <p class="legenda">Pagamento de jogador não entra aqui: registre no Racha do dia ou em Devedores.</p>
      </div>`;

    // Conferência da quadra
    const cf = estado.conferencia;
    let resultado = "";
    if (cf.calculado !== null && cf.ficha !== null) {
      const dif = (centavos(cf.ficha) - centavos(cf.calculado)) / 100;
      const inicialAtual = cf.inicial ? cf.inicial.valor : 0;
      const novoInicial = (centavos(inicialAtual) + centavos(dif)) / 100;
      resultado = `
        <div class="conferencia-resultado">
          <div><span>App em ${dataBR(cf.data).slice(0, 5)}</span><b class="num">${reais(cf.calculado)}</b></div>
          <div><span>Ficha da quadra</span><b class="num">${reais(cf.ficha)}</b></div>
          <div><span>Diferença</span><b class="num ${dif < 0 ? "negativo" : ""}">${reais(dif)}</b></div>
        </div>
        ${dif === 0 ? `<p class="mensagem mensagem-aviso">✔ Confere com a ficha da quadra.</p>` : `
          <p class="legenda">Saldo inicial da quadra hoje: <b>${reais(inicialAtual)}</b>
            ${cf.inicial ? `(em ${dataBR(cf.inicial.data)})` : "(não lançado)"}. Com a diferença, passa a
            <b>${reais(novoInicial)}</b> em ${dataBR(cf.inicial ? cf.inicial.data : DATA_INICIO_CAIXA)}.</p>
          <button type="button" class="botao botao-largo" data-acao="lancar-diferenca">Lançar diferença no saldo inicial da quadra</button>`}`;
    }
    return `
      <div class="cartao"><h3 class="secao-titulo" style="margin-top:0">Conferir com a ficha da quadra</h3>
        <form id="form-caixa" class="form-grade" novalidate>
          ${campoData("cf-data", cf.data)}
          <label class="campo"><span>Saldo na ficha da quadra (R$)</span>
            <input type="text" inputmode="decimal" autocomplete="off" id="cf-ficha" placeholder="Ex.: 350,00"
                   value="${cf.ficha !== null ? valorCampo(cf.ficha) : ""}" required></label>
          <div class="form-pagou-botoes">
            <button type="button" class="link-botao" data-acao="cancelar">Fechar</button>
            <button type="submit" class="botao">Comparar</button>
          </div>
        </form>
        ${resultado}
        <p class="legenda">A diferença vira (ou corrige) o saldo inicial da quadra em ${dataBR(DATA_INICIO_CAIXA)},
          início do controle financeiro. Use o saldo da ficha no fim do dia escolhido.</p>
      </div>`;
  }

  // ---------------------------------------------------------------
  // Ações
  // ---------------------------------------------------------------
  const val = (id) => estado.el.querySelector(id)?.value.trim() ?? "";

  // Grava e, se der certo, fecha o formulário, mostra o aviso e recarrega.
  function gravarEFechar(acao, aviso, mesDoLancamento) {
    gravar(acao, async () => {
      estado.form = null;
      estado.aviso = aviso;
      if (mesDoLancamento) estado.mes = mesDoLancamento.slice(0, 7);
      await carregar();
      desenhar();
    });
  }

  function lancarDespesa() {
    const r = { data: val("#desp-data"), descricao: val("#desp-descricao"), categoria: val("#desp-categoria") || null,
                conta: val("#desp-conta"), valor: lerValor(val("#desp-valor")) };
    if (!r.data) return mostrarFalha("Informe a data da despesa.");
    if (!r.descricao) return mostrarFalha("Informe a descrição da despesa.");
    if (!(r.valor > 0)) return mostrarFalha("Informe um valor maior que zero.");
    gravarEFechar(() => banco.from("despesas").insert(r).select("id").single(),
      `Despesa lançada no ${NOME_CONTA[r.conta]}.`, r.data);
  }

  function lancarTransferencia() {
    const origem = val("#tr-origem");
    const r = { data: val("#tr-data"), tipo: "transferencia", conta_origem: origem, conta_destino: outra(origem),
                valor: lerValor(val("#tr-valor")), descricao: val("#tr-descricao") };
    if (!r.data) return mostrarFalha("Informe a data da transferência.");
    if (!(r.valor > 0)) return mostrarFalha("Informe um valor maior que zero.");
    if (!r.descricao) return mostrarFalha("Informe a descrição da transferência.");
    gravarEFechar(() => banco.from("movimentos_conta").insert(r).select("id").single(),
      `Transferência lançada: ${NOME_CONTA[r.conta_origem]} → ${NOME_CONTA[r.conta_destino]}.`, r.data);
  }

  function lancarEntrada() {
    const r = { data: val("#en-data"), tipo: val("#en-tipo"), conta_destino: val("#en-conta"),
                valor: lerValor(val("#en-valor")), descricao: val("#en-descricao") };
    if (!r.data) return mostrarFalha("Informe a data da entrada.");
    if (!(r.valor > 0)) return mostrarFalha("Informe um valor maior que zero.");
    if (!r.descricao) return mostrarFalha("Informe a descrição da entrada.");
    gravarEFechar(() => banco.from("movimentos_conta").insert(r).select("id").single(),
      `${NOME_MOVIMENTO[r.tipo]} ${r.tipo === "rendimento" ? "lançado" : "lançada"} no ${NOME_CONTA[r.conta_destino]}.`, r.data);
  }

  async function compararFicha() {
    const data = val("#cf-data");
    const texto = val("#cf-ficha");
    const ficha = lerValor(texto);
    if (!data) return mostrarFalha("Informe a data da ficha da quadra.");
    if (texto === "" || Number.isNaN(ficha)) return mostrarFalha("Informe o saldo da ficha (ex.: 350,00 ou -50).");
    estado.conferencia = { data, ficha, calculado: null, inicial: null };
    await gravar(() => carregarConferencia(data), () => desenhar());
  }

  function lancarDiferenca() {
    const cf = estado.conferencia;
    const dif = (centavos(cf.ficha) - centavos(cf.calculado)) / 100;
    if (dif === 0) return;
    const novo = (centavos(cf.inicial ? cf.inicial.valor : 0) + centavos(dif)) / 100;
    if (!confirm(`Lançar a diferença de ${reais(dif)}? O saldo inicial da quadra passa a ${reais(novo)}.`)) return;
    let acao;
    if (cf.inicial && novo === 0) {
      acao = () => banco.from("movimentos_conta").delete().eq("id", cf.inicial.id);
    } else if (cf.inicial) {
      acao = () => banco.from("movimentos_conta").update({ valor: novo }).eq("id", cf.inicial.id).select("id").single();
    } else {
      acao = () => banco.from("movimentos_conta").insert({
        data: DATA_INICIO_CAIXA, tipo: "saldo_inicial", conta_destino: "quadra", valor: novo,
        descricao: `Saldo inicial ajustado pela ficha da quadra de ${dataBR(cf.data)}`,
      }).select("id").single();
    }
    gravar(acao, async () => {
      await Promise.all([carregar(), carregarConferencia(cf.data)]);
      estado.aviso = "Saldo inicial da quadra lançado.";
      desenhar();
    });
  }

  function excluir(origem, id) {
    const l = estado.linhas.find((x) => x.origem === origem && x.id === id);
    if (!l) return;
    const tabela = origem === "despesa" ? "despesas" : "movimentos_conta";
    const extra = l.detalhe === "transferencia" ? " (sai das duas contas)" : "";
    if (!confirm(`Excluir "${l.descricao}" de ${dataBR(l.data)} (${reais(Math.abs(l.valor))})${extra}?`)) return;
    gravar(() => banco.from(tabela).delete().eq("id", id), async () => {
      estado.aviso = "Lançamento excluído.";
      await carregar();
      desenhar();
    });
  }

  async function recarregar() {
    estado.el.innerHTML = `<p class="vazio">Carregando…</p>`;
    await gravar(() => carregar(), () => desenhar());
  }

  function aoTocar(evento) {
    const b = evento.target.closest("button");
    if (!b || b.disabled) return;
    switch (b.dataset.acao) {
      case "abrir-form":
        estado.form = b.dataset.form;
        estado.aviso = "";
        if (estado.form === "conferencia") estado.conferencia = { data: hojeISO(), ficha: null, calculado: null, inicial: null };
        desenhar();
        estado.el.querySelector("#form-caixa input:not([type=date]), #form-caixa select")?.focus();
        break;
      case "cancelar": estado.form = null; desenhar(); break;
      case "filtro": estado.filtro = b.dataset.filtro; desenhar(); break;
      case "excluir": excluir(b.dataset.origem, Number(b.dataset.id)); break;
      case "lancar-diferenca": lancarDiferenca(); break;
      default: break;
    }
  }

  function aoEnviar(evento) {
    evento.preventDefault();
    if (estado.form === "despesa") lancarDespesa();
    else if (estado.form === "transferencia") lancarTransferencia();
    else if (estado.form === "entrada") lancarEntrada();
    else if (estado.form === "conferencia") compararFicha();
  }

  // ---------------------------------------------------------------
  // Entrada da seção
  // ---------------------------------------------------------------
  async function abrir(painel) {
    painel.innerHTML = `<div id="secao-caixa"></div>`;
    estado.el = painel.querySelector("#secao-caixa");
    estado.el.addEventListener("click", aoTocar);
    estado.el.addEventListener("submit", aoEnviar);
    estado.mes = estado.mes || hojeISO().slice(0, 7);
    estado.form = null;
    estado.aviso = "";
    await recarregar();
  }

  return { abrir };
})();
