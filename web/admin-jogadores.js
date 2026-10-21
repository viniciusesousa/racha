// =====================================================================
// App do Racha — área do admin: JOGADORES
// =====================================================================
// * Lista com busca (ativos e inativos).
// * Cadastrar e editar: nome, apelido, posição, tipo (linha/goleiro), ativo.
//   Ao cadastrar, avisa se já existe alguém com nome parecido.
// * Foto: o celular corta a imagem em quadrado e reduz o tamanho ANTES de
//   enviar (fica bem abaixo de 2 MB). Só envia com a caixa "o jogador
//   autorizou o uso da foto" marcada — isso grava a data do consentimento.
//   Remover a foto apaga o arquivo e também limpa o consentimento.
// * Ajustes manuais de estatística (gols, assistências, vitórias,
//   presenças) com motivo obrigatório. Ajustes não são apagados (são o
//   registro do que foi corrigido): para desfazer, lança um ajuste contrário.
// =====================================================================

window.SecaoJogadores = (() => {
  const estado = {
    el: null,
    jogadores: [],     // todos os cadastros
    busca: "",
    mostrarInativos: false,
    editando: null,    // id do jogador aberto, "novo" para cadastro, ou null (lista)
    ajustes: [],       // ajustes do jogador aberto
  };

  const BUCKET = "fotos-jogadores";
  const POSICOES = ["", "Goleiro", "Zagueiro", "Meio Campo", "Atacante"];
  const TIPOS_AJUSTE = [["gols", "Gols"], ["assistencias", "Assistências"], ["vitorias", "Vitórias"], ["presencas", "Presenças"]];
  const LADO_FOTO = 512;                  // a foto final tem 512 x 512 pixels
  const LIMITE_FOTO = 2 * 1024 * 1024;    // 2 MB (regra do bucket)

  // ---------------------------------------------------------------
  // Auxiliares
  // ---------------------------------------------------------------
  function hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const dataBR = (iso) => { const [a, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${a}`; };
  const normalizar = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const porNome = (a, b) => a.nome.localeCompare(b.nome, "pt-BR");

  // Iniciais e cor do círculo (mesma regra da área pública).
  const CORES_AVATAR = ["#6d1f2f", "#1f5f7a", "#5b4b8a", "#8a4b2a", "#6b2f5a", "#44506b", "#7a4f0e"];
  function iniciais(nome) {
    const p = String(nome ?? "").trim().split(/\s+/).filter(Boolean);
    if (!p.length) return "?";
    return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
  }
  function avatar(j, classe = "") {
    if (j?.foto_url) return `<img class="avatar ${classe}" src="${esc(j.foto_url)}" alt="">`;
    return `<span class="avatar ${classe}" style="background:${CORES_AVATAR[(j?.id ?? 0) % CORES_AVATAR.length]}" aria-hidden="true">${esc(iniciais(j?.nome))}</span>`;
  }

  // Caminho do arquivo dentro do bucket, a partir do endereço público da foto.
  function caminhoDaFoto(url) {
    const marca = `/${BUCKET}/`;
    const i = String(url ?? "").indexOf(marca);
    return i >= 0 ? decodeURIComponent(url.slice(i + marca.length).split("?")[0]) : null;
  }

  // ---------------------------------------------------------------
  // Carregamento
  // ---------------------------------------------------------------
  async function carregarJogadores() {
    const { data, error } = await banco.from("jogadores")
      .select("id, nome, apelido, posicao, tipo, ativo, foto_url, foto_consentimento_em").order("nome");
    if (error) throw error;
    estado.jogadores = data;
  }

  async function carregarAjustes(id) {
    const { data, error } = await banco.from("ajustes")
      .select("id, tipo, quantidade, motivo, data, criado_em").eq("jogador_id", id).order("data", { ascending: false }).order("id", { ascending: false });
    if (error) throw error;
    estado.ajustes = data;
  }

  // ---------------------------------------------------------------
  // Desenho: lista
  // ---------------------------------------------------------------
  function desenharLista() {
    estado.el.innerHTML = `
      <button type="button" class="botao botao-largo" data-acao="novo">+ Cadastrar jogador</button>
      <input class="busca" id="busca-jogadores" type="search" placeholder="Buscar por nome ou apelido"
             value="${esc(estado.busca)}" autocomplete="off" aria-label="Buscar jogador" style="margin-top:12px">
      <label class="checkbox-linha"><input type="checkbox" id="mostrar-inativos" ${estado.mostrarInativos ? "checked" : ""}>
        Mostrar também os inativos</label>
      <ul class="lista" id="lista-jogadores-admin">${htmlLinhas()}</ul>`;
    estado.el.querySelector("#busca-jogadores").addEventListener("input", (e) => {
      estado.busca = e.target.value;
      estado.el.querySelector("#lista-jogadores-admin").innerHTML = htmlLinhas();
    });
    estado.el.querySelector("#mostrar-inativos").addEventListener("change", (e) => {
      estado.mostrarInativos = e.target.checked;
      estado.el.querySelector("#lista-jogadores-admin").innerHTML = htmlLinhas();
    });
  }

  function htmlLinhas() {
    const busca = normalizar(estado.busca);
    const lista = estado.jogadores
      .filter((j) => estado.mostrarInativos || j.ativo)
      .filter((j) => !busca || normalizar(`${j.nome} ${j.apelido ?? ""}`).includes(busca));
    if (!lista.length) return `<li class="vazio">Ninguém encontrado.</li>`;
    return lista.map((j) => `
      <li>
        <button type="button" class="linha linha-botao" data-acao="abrir" data-jogador="${j.id}">
          ${avatar(j, "avatar-pequeno")}
          <span class="linha-principal">
            <span class="linha-nome">${esc(j.nome)}
              ${j.tipo === "goleiro" ? '<span class="selo selo-goleiro">goleiro</span>' : ""}
              ${!j.ativo ? '<span class="selo selo-origem">inativo</span>' : ""}</span>
            <span class="linha-sub">${[j.apelido ? `“${esc(j.apelido)}”` : "", esc(j.posicao ?? "")].filter(Boolean).join(" · ") || "&nbsp;"}</span>
          </span>
          <span aria-hidden="true" class="seta">›</span>
        </button>
      </li>`).join("");
  }

  // ---------------------------------------------------------------
  // Desenho: ficha de edição
  // ---------------------------------------------------------------
  function desenharFicha() {
    const novo = estado.editando === "novo";
    const j = novo ? { id: 0, nome: "", apelido: "", posicao: "", tipo: "linha", ativo: true } : estado.jogadores.find((x) => x.id === estado.editando);
    estado.el.innerHTML = `
      <button type="button" class="link-botao voltar-lista" data-acao="voltar">‹ Jogadores</button>

      <div class="cartao">
        <h2 class="secao-titulo" style="margin-top:0">${novo ? "Cadastrar jogador" : "Dados do jogador"}</h2>
        <form id="form-jogador" class="form-grade" novalidate>
          <label class="campo"><span>Nome</span>
            <input type="text" id="j-nome" value="${esc(j.nome)}" required maxlength="80" autocapitalize="words"></label>
          <div id="j-parecidos"></div>
          <label class="campo"><span>Apelido (opcional)</span>
            <input type="text" id="j-apelido" value="${esc(j.apelido ?? "")}" maxlength="40"></label>
          <label class="campo"><span>Posição</span>
            <select id="j-posicao">${POSICOES.map((p) => `<option value="${p}" ${(j.posicao ?? "") === p ? "selected" : ""}>${p || "—"}</option>`).join("")}</select></label>
          <label class="campo"><span>Tipo</span>
            <select id="j-tipo">
              <option value="linha" ${j.tipo === "linha" ? "selected" : ""}>Linha</option>
              <option value="goleiro" ${j.tipo === "goleiro" ? "selected" : ""}>Goleiro</option>
            </select></label>
          <label class="checkbox-linha"><input type="checkbox" id="j-ativo" ${j.ativo ? "checked" : ""}>
            Ativo (aparece na lista do dia)</label>
          <button type="submit" class="botao botao-largo">${novo ? "Cadastrar" : "Salvar alterações"}</button>
        </form>
      </div>

      ${novo ? "" : htmlFoto(j) + htmlAjustes()}`;

    if (novo) {
      estado.el.querySelector("#j-nome").addEventListener("input", (e) => {
        estado.el.querySelector("#j-parecidos").innerHTML = htmlParecidos(e.target.value);
      });
    }
  }

  // Nomes parecidos já cadastrados (para evitar duplicatas ao cadastrar).
  function htmlParecidos(texto) {
    if (normalizar(texto).length < 3) return "";
    // Mesma comparação do "+ novo jogador" (função comum em admin.js).
    const achados = nomesParecidos(texto, estado.jogadores).slice(0, 5);
    if (!achados.length) return "";
    return `<p class="mensagem mensagem-aviso">Já existe(m) com nome parecido: ${achados.map((j) => esc(j.nome) + (j.ativo ? "" : " (inativo)")).join(", ")}.
      Confira antes de cadastrar outra pessoa.</p>`;
  }

  function htmlFoto(j) {
    return `
      <div class="cartao foto-cartao">
        <h2 class="secao-titulo" style="margin-top:0">Foto</h2>
        <div class="foto-atual">
          ${avatar(j, "avatar-gigante")}
          <span class="legenda">${j.foto_url && j.foto_consentimento_em
            ? `Uso autorizado em ${new Date(j.foto_consentimento_em).toLocaleDateString("pt-BR")}.` : "Sem foto: aparecem as iniciais."}</span>
        </div>
        <label class="campo"><span>${j.foto_url ? "Trocar a foto" : "Escolher foto"}</span>
          <input type="file" id="foto-arquivo" accept="image/*"></label>
        <label class="checkbox-linha"><input type="checkbox" id="foto-consentimento">
          O jogador autorizou o uso da foto no app do racha</label>
        <div class="foto-botoes">
          <button type="button" class="botao" data-acao="enviar-foto">Enviar foto</button>
          ${j.foto_url ? '<button type="button" class="botao botao-secundario" data-acao="remover-foto">Remover foto</button>' : ""}
        </div>
        <p class="legenda">A foto é cortada em quadrado e reduzida no próprio celular antes de enviar.</p>
      </div>`;
  }

  function htmlAjustes() {
    const nomeTipo = Object.fromEntries(TIPOS_AJUSTE);
    return `
      <div class="cartao">
        <h2 class="secao-titulo" style="margin-top:0">Ajustes manuais de estatística</h2>
        <form id="form-ajuste" class="form-grade" novalidate>
          <div class="ajuste-linha">
            <label class="campo"><span>Tipo</span>
              <select id="a-tipo">${TIPOS_AJUSTE.map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select></label>
            <label class="campo"><span>Quantidade</span>
              <input type="text" id="a-quantidade" inputmode="numeric" placeholder="Ex.: 1 ou -1" autocomplete="off"></label>
          </div>
          <label class="campo"><span>Motivo (obrigatório)</span>
            <input type="text" id="a-motivo" maxlength="200" placeholder="Ex.: gol não anotado no racha de 10/09"></label>
          <label class="campo"><span>Data</span><input type="date" id="a-data" value="${hojeISO()}"></label>
          <button type="submit" class="botao botao-largo">Lançar ajuste</button>
        </form>
        <p class="legenda">Use número negativo para tirar (ex.: -1). Ajustes não são apagados: para desfazer,
          lance um ajuste contrário com o motivo.</p>
        ${estado.ajustes.length ? `<ul class="lista lista-ajustes">${estado.ajustes.map((a) => `
          <li class="ajuste-item">
            <b class="num ${a.quantidade < 0 ? "negativo" : ""}">${a.quantidade > 0 ? "+" : ""}${a.quantidade}</b>
            <span><b>${nomeTipo[a.tipo] ?? a.tipo}</b> · ${dataBR(a.data)}<br><small>${esc(a.motivo)}</small></span>
          </li>`).join("")}</ul>` : `<p class="vazio" style="padding:4px 0">Nenhum ajuste.</p>`}
      </div>`;
  }

  // ---------------------------------------------------------------
  // Ações
  // ---------------------------------------------------------------
  function salvarJogador() {
    const val = (id) => estado.el.querySelector(id).value.trim();
    const dados = {
      nome: val("#j-nome").replace(/\s+/g, " "),
      apelido: val("#j-apelido") || null,
      posicao: val("#j-posicao") || null,
      tipo: val("#j-tipo"),
      ativo: estado.el.querySelector("#j-ativo").checked,
    };
    if (dados.nome.length < 2) return mostrarFalha("Informe o nome do jogador.");
    const novo = estado.editando === "novo";
    if (novo && htmlParecidos(dados.nome) && !confirm(`Já existe alguém com nome parecido. Cadastrar "${dados.nome}" mesmo assim?`)) return;
    gravar(
      () => (novo
        ? banco.from("jogadores").insert(dados).select("id").single()
        : banco.from("jogadores").update(dados).eq("id", estado.editando).select("id").single()),
      async (salvo) => {
        await carregarJogadores();
        estado.editando = salvo.id;
        await carregarAjustes(salvo.id);
        desenharFicha();
        mostrarAvisoTopo(novo ? "Jogador cadastrado." : "Alterações salvas.");
      });
  }

  // Lê a imagem escolhida, corta o quadrado do meio e reduz para 512 x 512.
  async function prepararFoto(arquivo) {
    if (!arquivo.type.startsWith("image/")) throw new Error("O arquivo escolhido não é uma imagem.");
    const bitmap = await createImageBitmap(arquivo).catch(() => { throw new Error("Não foi possível ler esta imagem. Tente outra foto."); });
    const lado = Math.min(bitmap.width, bitmap.height);
    const tela = document.createElement("canvas");
    tela.width = LADO_FOTO; tela.height = LADO_FOTO;
    tela.getContext("2d").drawImage(bitmap,
      (bitmap.width - lado) / 2, (bitmap.height - lado) / 2, lado, lado,  // recorte quadrado central
      0, 0, LADO_FOTO, LADO_FOTO);
    // Começa com boa qualidade e só reduz se passar de 2 MB.
    for (const qualidade of [0.85, 0.7, 0.55]) {
      const blob = await new Promise((ok) => tela.toBlob(ok, "image/jpeg", qualidade));
      if (blob && blob.size <= LIMITE_FOTO) return blob;
    }
    throw new Error("A foto ficou maior que 2 MB mesmo reduzida. Tente outra foto.");
  }

  async function enviarFoto() {
    const j = estado.jogadores.find((x) => x.id === estado.editando);
    const arquivo = estado.el.querySelector("#foto-arquivo").files[0];
    if (!arquivo) return mostrarFalha("Escolha uma foto primeiro.");
    if (!estado.el.querySelector("#foto-consentimento").checked) {
      return mostrarFalha("Marque a caixa confirmando que o jogador autorizou o uso da foto.");
    }
    let blob;
    try { blob = await prepararFoto(arquivo); } catch (erro) { return mostrarFalha(erro.message); }
    const caminho = `jogador-${j.id}-${Date.now()}.jpg`;  // nome novo a cada envio (evita foto antiga em cache)
    const fotoAntiga = caminhoDaFoto(j.foto_url);
    gravar(
      async () => {
        const envio = await banco.storage.from(BUCKET).upload(caminho, blob, { contentType: "image/jpeg", upsert: false });
        if (envio.error) return envio;
        const url = banco.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl;
        // Foto e consentimento gravados juntos (o banco exige os dois).
        const atualizado = await banco.from("jogadores")
          .update({ foto_url: url, foto_consentimento_em: new Date().toISOString() })
          .eq("id", j.id).select("id").single();
        // Se o cadastro não gravou, apaga o arquivo recém-enviado (assim o
        // "Tentar de novo" envia de novo sem dar "arquivo já existe").
        if (atualizado.error) await banco.storage.from(BUCKET).remove([caminho]);
        return atualizado;
      },
      async () => {
        // A foto anterior não é mais usada: apaga o arquivo antigo.
        if (fotoAntiga) await banco.storage.from(BUCKET).remove([fotoAntiga]);
        await carregarJogadores();
        desenharFicha();
        mostrarAvisoTopo("Foto enviada.");
      });
  }

  function removerFoto() {
    const j = estado.jogadores.find((x) => x.id === estado.editando);
    if (!confirm(`Remover a foto de ${j.nome}? O consentimento registrado também será apagado.`)) return;
    const caminho = caminhoDaFoto(j.foto_url);
    gravar(
      async () => {
        const atualizado = await banco.from("jogadores")
          .update({ foto_url: null, foto_consentimento_em: null }).eq("id", j.id).select("id").single();
        if (atualizado.error) return atualizado;
        if (caminho) return banco.storage.from(BUCKET).remove([caminho]);
        return atualizado;
      },
      async () => { await carregarJogadores(); desenharFicha(); mostrarAvisoTopo("Foto removida."); });
  }

  function lancarAjuste() {
    const val = (id) => estado.el.querySelector(id).value.trim();
    const quantidade = Number(val("#a-quantidade").replace("+", ""));
    const motivo = val("#a-motivo");
    const data = val("#a-data");
    if (!Number.isInteger(quantidade) || quantidade === 0) return mostrarFalha("A quantidade deve ser um número inteiro diferente de zero (ex.: 1 ou -1).");
    if (motivo.length < 3) return mostrarFalha("O motivo do ajuste é obrigatório.");
    if (!data) return mostrarFalha("Informe a data do ajuste.");
    const registro = { jogador_id: estado.editando, tipo: val("#a-tipo"), quantidade, motivo, data };
    gravar(
      () => banco.from("ajustes").insert(registro).select("id").single(),
      async () => { await carregarAjustes(estado.editando); desenharFicha(); mostrarAvisoTopo("Ajuste lançado."); });
  }

  function mostrarAvisoTopo(texto) {
    const aviso = document.createElement("p");
    aviso.className = "mensagem mensagem-aviso";
    aviso.style.margin = "0 0 12px";
    aviso.textContent = `✔ ${texto}`;
    estado.el.querySelector(".voltar-lista")?.after(aviso);
  }

  async function abrirFicha(id) {
    estado.editando = id;
    estado.ajustes = [];
    if (id !== "novo") {
      const ok = await gravar(() => carregarAjustes(id));
      if (!ok.ok) return;
    }
    desenharFicha();
    window.scrollTo(0, 0);
  }

  function aoTocar(evento) {
    const b = evento.target.closest("button");
    if (!b || b.disabled) return;
    switch (b.dataset.acao) {
      case "novo": abrirFicha("novo"); break;
      case "abrir": abrirFicha(Number(b.dataset.jogador)); break;
      case "voltar": estado.editando = null; desenharLista(); break;
      case "enviar-foto": enviarFoto(); break;
      case "remover-foto": removerFoto(); break;
      default: break;
    }
  }

  function aoEnviar(evento) {
    evento.preventDefault();
    if (evento.target.id === "form-jogador") salvarJogador();
    if (evento.target.id === "form-ajuste") lancarAjuste();
  }

  // ---------------------------------------------------------------
  // Entrada da seção
  // ---------------------------------------------------------------
  async function abrir(painel) {
    painel.innerHTML = `<div id="secao-jogadores"><p class="vazio">Carregando…</p></div>`;
    estado.el = painel.querySelector("#secao-jogadores");
    estado.el.addEventListener("click", aoTocar);
    estado.el.addEventListener("submit", aoEnviar);
    estado.editando = null;
    try {
      await carregarJogadores();
      desenharLista();
    } catch (erro) {
      estado.el.innerHTML = "";
      mostrarFalha(explicarErro(erro), () => abrir(painel));
    }
  }

  return { abrir };
})();
