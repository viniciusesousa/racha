// =====================================================================
// App do Racha — área do admin: DEVEDORES
// =====================================================================
// * Lista de quem deve, do maior para o menor valor.
// * Para cada um, os RACHAS EM ABERTO: os pagamentos quitam primeiro as
//   cobranças mais antigas; o que sobra sem quitar está em aberto (pode
//   ser um racha inteiro ou só parte dele).
// * Registrar pagamento/quitação (total ou parcial) em qualquer data, com
//   forma obrigatória (Pix / Dinheiro / Cartão).
// * "Copiar mensagem": lembrete educado para mandar no WhatsApp, só com a
//   dívida daquela pessoa (sem expor a de ninguém mais).
// =====================================================================

window.SecaoDevedores = (() => {
  const estado = {
    el: null,
    devedores: [],      // [{ jogador_id, nome, apelido, saldo, abertos: [{ data, aberto, valor }] }]
    pagando: null,      // { id, forma, valor, data }
    copiado: null,      // jogador id cuja mensagem acabou de ser copiada
  };

  const FORMAS = [["pix", "Pix"], ["dinheiro", "Dinheiro"], ["cartao", "Cartão"]];

  // ---------------------------------------------------------------
  // Auxiliares
  // ---------------------------------------------------------------
  function hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const dataBR = (iso) => { const [a, m, d] = iso.split("-"); return `${d}/${m}/${a}`; };
  const diaMes = (iso) => dataBR(iso).slice(0, 5);
  const reais = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const centavos = (v) => Math.round(Number(v) * 100);  // contas em centavos, sem erro de arredondamento

  // ---------------------------------------------------------------
  // Carregamento e cálculo dos rachas em aberto
  // ---------------------------------------------------------------
  async function carregar() {
    const sal = await banco.from("v_saldos_jogadores")
      .select("jogador_id, nome, apelido, saldo, total_pago").gt("saldo", 0).order("saldo", { ascending: false });
    if (sal.error) throw sal.error;
    const ids = sal.data.map((x) => x.jogador_id);
    let cobrancas = [];
    if (ids.length) {
      const cob = await banco.from("cobrancas")
        .select("jogador_id, valor, rachas(data_jogo)").in("jogador_id", ids);
      if (cob.error) throw cob.error;
      cobrancas = cob.data;
    }
    estado.devedores = sal.data.map((d) => {
      // Cobranças do jogador, da mais antiga para a mais nova.
      const minhas = cobrancas
        .filter((c) => c.jogador_id === d.jogador_id)
        .map((c) => ({ data: c.rachas.data_jogo, valor: centavos(c.valor) }))
        .sort((a, b) => a.data.localeCompare(b.data));
      // O total pago quita as mais antigas primeiro.
      let pago = centavos(d.total_pago);
      const abertos = [];
      for (const c of minhas) {
        const quitado = Math.min(pago, c.valor);
        pago -= quitado;
        if (quitado < c.valor) abertos.push({ data: c.data, aberto: (c.valor - quitado) / 100, valor: c.valor / 100 });
      }
      return { ...d, saldo: Number(d.saldo), abertos };
    });
  }

  // ---------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------
  function desenhar() {
    const total = estado.devedores.reduce((a, d) => a + d.saldo, 0);
    if (!estado.devedores.length) {
      estado.el.innerHTML = `<div class="cartao"><p class="vazio" style="padding:8px 0">Ninguém está devendo. 🎉</p></div>`;
      return;
    }
    estado.el.innerHTML = `
      <div class="cartao resumo-devedores">
        <span>${estado.devedores.length} jogador(es) devendo</span>
        <b class="num">${reais(total)}</b>
      </div>
      <ul class="lista lista-fin">${estado.devedores.map(htmlDevedor).join("")}</ul>
      <p class="legenda">Rachas em aberto: os pagamentos quitam primeiro os rachas mais antigos.</p>`;
    const valor = estado.el.querySelector("#quitar-valor");
    if (valor) valor.addEventListener("input", (e) => { estado.pagando.valor = e.target.value; });
    const data = estado.el.querySelector("#quitar-data");
    if (data) data.addEventListener("input", (e) => { estado.pagando.data = e.target.value; });
  }

  function htmlDevedor(d) {
    const abertos = d.abertos.map((a) => a.aberto < a.valor
      ? `${diaMes(a.data)} (falta ${reais(a.aberto)})` : diaMes(a.data)).join(" · ");
    return `
      <li class="fin-linha">
        <div class="fin-topo">
          <span class="dia-nome">${esc(d.nome)}${d.apelido ? ` <small>“${esc(d.apelido)}”</small>` : ""}</span>
          <span class="saldo saldo-deve">deve ${reais(d.saldo)}</span>
        </div>
        <span class="abertos"><b>Rachas em aberto:</b> ${abertos || "—"}</span>
        ${estado.pagando?.id === d.jogador_id ? htmlFormPagamento(d) : `
          <div class="devedor-botoes">
            <button type="button" class="botao botao-pagou" data-acao="abrir-pagamento" data-jogador="${d.jogador_id}">Registrar pagamento</button>
            <button type="button" class="botao botao-secundario" data-acao="copiar" data-jogador="${d.jogador_id}">Copiar mensagem</button>
          </div>
          ${estado.copiado === d.jogador_id ? `
            <div class="mensagem-copiada">
              <b>✔ Mensagem copiada.</b> Cole no WhatsApp da pessoa:
              <p>${esc(textoLembrete(d))}</p>
            </div>` : ""}`}
      </li>`;
  }

  function htmlFormPagamento(d) {
    const pg = estado.pagando;
    return `
      <div class="form-pagou">
        <span class="form-pagou-rotulo">Forma de pagamento (obrigatório)</span>
        <div class="status-botoes formas" role="group" aria-label="Forma de pagamento">
          ${FORMAS.map(([f, nome]) => `
            <button type="button" class="status ${pg.forma === f ? "ativa status-presente" : ""}" data-acao="forma" data-forma="${f}"
                    aria-pressed="${pg.forma === f}">${nome}</button>`).join("")}
        </div>
        <label class="campo"><span>Valor (R$) — dívida total: ${reais(d.saldo)}</span>
          <input type="number" id="quitar-valor" min="0.01" step="0.5" inputmode="decimal" value="${pg.valor}"></label>
        <label class="campo"><span>Data do pagamento</span>
          <input type="date" id="quitar-data" value="${pg.data}"></label>
        <div class="form-pagou-botoes">
          <button type="button" class="link-botao" data-acao="cancelar-pagamento">Cancelar</button>
          <button type="button" class="botao" data-acao="confirmar-pagamento" ${pg.forma ? "" : "disabled"}>Confirmar pagamento</button>
        </div>
      </div>`;
  }

  // Lembrete educado, só com a dívida da própria pessoa.
  function textoLembrete(d) {
    const primeiroNome = (d.apelido || d.nome).split(" ")[0];
    const datas = d.abertos.map((a) => diaMes(a.data));
    const quais = datas.length === 1 ? `do racha de ${datas[0]}`
      : datas.length > 1 ? `dos rachas de ${datas.slice(0, -1).join(", ")} e ${datas[datas.length - 1]}` : "do racha";
    return `Oi, ${primeiroNome}! Tudo bem? Passando só para lembrar que ficou em aberto ${reais(d.saldo)} ${quais}. ` +
      `Quando puder, é só acertar com a organização. Valeu, e até quinta! ⚽`;
  }

  // ---------------------------------------------------------------
  // Ações
  // ---------------------------------------------------------------
  async function copiar(id) {
    const d = estado.devedores.find((x) => x.jogador_id === id);
    const texto = textoLembrete(d);
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      // Navegadores antigos: copia por um campo de texto escondido.
      const campo = document.createElement("textarea");
      campo.value = texto;
      campo.setAttribute("readonly", "");
      campo.style.position = "fixed"; campo.style.opacity = "0";
      document.body.appendChild(campo);
      campo.select();
      try { document.execCommand("copy"); } catch { /* segue mostrando o texto na tela */ }
      campo.remove();
    }
    estado.copiado = id;
    desenhar();
  }

  function abrirPagamento(id) {
    const d = estado.devedores.find((x) => x.jogador_id === id);
    // Valor sugerido: a dívida toda (editável para pagamento parcial).
    estado.pagando = { id, forma: null, valor: d.saldo, data: hojeISO() };
    estado.copiado = null;
    desenhar();
  }

  function confirmarPagamento() {
    const pg = estado.pagando;
    const valor = Number(String(estado.el.querySelector("#quitar-valor")?.value ?? pg.valor).replace(",", "."));
    const data = estado.el.querySelector("#quitar-data")?.value || pg.data;
    if (!pg.forma) return mostrarFalha("Escolha a forma de pagamento: Pix, Dinheiro ou Cartão.");
    if (!(valor > 0)) return mostrarFalha("Informe um valor maior que zero.");
    if (!data) return mostrarFalha("Informe a data do pagamento.");
    const registro = { jogador_id: pg.id, valor, forma: pg.forma, data_pagamento: data, observacao: "Pagamento de dívida (Devedores)" };
    gravar(
      () => banco.from("pagamentos").insert(registro).select("id").single(),
      async () => { estado.pagando = null; await carregar(); desenhar(); });
  }

  function aoTocar(evento) {
    const b = evento.target.closest("button");
    if (!b || b.disabled) return;
    const id = Number(b.dataset.jogador);
    switch (b.dataset.acao) {
      case "abrir-pagamento": abrirPagamento(id); break;
      case "copiar": copiar(id); break;
      case "cancelar-pagamento": estado.pagando = null; desenhar(); break;
      case "confirmar-pagamento": confirmarPagamento(); break;
      case "forma": {
        const v = estado.el.querySelector("#quitar-valor")?.value;
        const dt = estado.el.querySelector("#quitar-data")?.value;
        if (v) estado.pagando.valor = v;
        if (dt) estado.pagando.data = dt;
        estado.pagando.forma = b.dataset.forma;
        desenhar();
        break;
      }
      default: break;
    }
  }

  // ---------------------------------------------------------------
  // Entrada da seção
  // ---------------------------------------------------------------
  async function abrir(painel) {
    painel.innerHTML = `<div id="secao-devedores"><p class="vazio">Carregando…</p></div>`;
    estado.el = painel.querySelector("#secao-devedores");
    estado.el.addEventListener("click", aoTocar);
    estado.pagando = null;
    estado.copiado = null;
    try {
      await carregar();
      desenhar();
    } catch (erro) {
      estado.el.innerHTML = "";
      mostrarFalha(explicarErro(erro), () => abrir(painel));
    }
  }

  return { abrir };
})();
