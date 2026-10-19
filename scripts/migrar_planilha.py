"""
Migração da planilha do Mocha para o banco do App do Racha.

O que este script faz:
  1. Lê a planilha BASE_RACHA_CONSOLIDADA_2026.xlsx (pasta principal do projeto).
  2. Gera banco/02_dados_historicos.sql com todos os INSERTs do histórico,
     prontos para colar no SQL Editor do Supabase (depois do 01_estrutura.sql).
  3. Gera relatorios/conferencia_migracao.xlsx, um relatório para conferir
     os números ANTES de carregar qualquer coisa no banco.

Este script NÃO se conecta ao Supabase: ele só cria arquivos.

Como rodar (na pasta principal do projeto):
    python scripts/migrar_planilha.py
"""

import sys
from datetime import date
from pathlib import Path

import pandas as pd

# Garante que acentos apareçam corretamente no terminal do Windows.
sys.stdout.reconfigure(encoding="utf-8")


# =====================================================================
# CONFIGURAÇÕES — valores fáceis de editar
# =====================================================================

# Pastas e arquivos (calculados a partir da localização deste script).
PASTA_PROJETO = Path(__file__).resolve().parent.parent
ARQUIVO_PLANILHA = PASTA_PROJETO / "BASE_RACHA_CONSOLIDADA_2026.xlsx"
ARQUIVO_SQL = PASTA_PROJETO / "banco" / "02_dados_historicos.sql"
ARQUIVO_RELATORIO = PASTA_PROJETO / "relatorios" / "conferencia_migracao.xlsx"

# Valor cobrado por racha no histórico (só informativo: não geramos cobranças).
VALOR_COBRADO = 15

# Partidas do Mocha que devem ser descartadas (duplicatas).
PARTIDAS_DESCARTADAS = {22: "duplicata da partida 21 (erro do Mocha)"}

# Datas reais dos jogos lançados com atraso no Mocha.
# Nestes casos a data de criação do registro NÃO é a data do jogo.
# Formato: match_id: data do jogo.
DATAS_CORRIGIDAS = {
    5: date(2026, 2, 12),
    6: date(2026, 2, 19),
    9: date(2026, 3, 12),
}

# Apelidos a definir na importação (id do jogador: apelido).
APELIDOS = {45: "Apelido Exemplo"}

# Padronização de nomes de posição (como está na planilha: como fica no app).
POSICOES_PADRONIZADAS = {"Meia": "Meio Campo"}

# Gols contra registrados na aba "Auditoria Consolidação", que não estão
# na aba "Partidas Recuperadas". Formato: (data do jogo, id do jogador): quantidade.
GOLS_CONTRA_RECUPERADOS = {(date(2026, 8, 20), 6): 1}  # Jogador Exemplo

# Textos usados nos registros.
OBS_RECUPERADO = "Reconstruído de anotações; sem times e placar"
MOTIVO_AJUSTE = "Ajuste manual importado do Mocha"

# Correspondência entre os campos manuais do Mocha e os tipos de ajuste do banco.
CAMPOS_AJUSTE = {
    "manual_goals": "gols",
    "manual_assists": "assistencias",
    "manual_wins": "vitorias",
}


# =====================================================================
# FUNÇÕES AUXILIARES
# =====================================================================

DIAS_SEMANA = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]


def sql_valor(valor):
    """Converte um valor do Python para o formato de texto do SQL."""
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return "null"
    if isinstance(valor, bool):
        return "true" if valor else "false"
    if isinstance(valor, (int, float)):
        return str(valor)
    if isinstance(valor, date):
        return f"'{valor.isoformat()}'"
    # Texto: aspas simples dentro do texto precisam ser duplicadas no SQL.
    return "'" + str(valor).replace("'", "''") + "'"


def sql_insert(tabela, colunas, linhas):
    """Monta um único INSERT com várias linhas para a tabela informada."""
    if not linhas:
        return f"-- (nenhum registro para {tabela})\n"
    valores = ",\n".join(
        "  (" + ", ".join(sql_valor(v) for v in linha) + ")" for linha in linhas
    )
    return f"insert into public.{tabela} ({', '.join(colunas)}) values\n{valores};\n"


def texto_ou_nada(valor):
    """Devolve o texto sem espaços nas pontas, ou None se a célula estiver vazia."""
    if valor is None or pd.isna(valor) or str(valor).strip() == "":
        return None
    return str(valor).strip()


def para_inteiro(valor):
    """Converte para inteiro do Python (células vazias viram 0)."""
    return 0 if pd.isna(valor) else int(valor)


def ler_data_br(texto):
    """Converte '20/08/2026' em uma data do Python."""
    dia, mes, ano = str(texto).strip().split("/")
    return date(int(ano), int(mes), int(dia))


def conferir(condicao, mensagem):
    """Interrompe o script com uma mensagem clara se algo estiver errado."""
    if not condicao:
        raise SystemExit(f"ERRO NA CONFERÊNCIA: {mensagem}")


# =====================================================================
# LEITURA DA PLANILHA
# =====================================================================

print(f"Lendo {ARQUIVO_PLANILHA.name} ...")
abas = pd.read_excel(ARQUIVO_PLANILHA, sheet_name=None)

aba_consolidados = abas["Jogadores Consolidados"]
aba_cadastro = abas["Cadastro Jogadores"]
aba_partidas = abas["Partidas"]
aba_rachas_rec = abas["Rachas Recuperados"]
aba_partidas_rec = abas["Partidas Recuperadas"]


# =====================================================================
# 1. JOGADORES
# =====================================================================
# Fonte: aba "Jogadores Consolidados" (inclui os 2 jogadores novos, 44 e 45).
# A idade não é importada (dado não confiável).

jogadores = []  # cada item: dicionário com os campos da tabela jogadores
for _, linha in aba_consolidados.sort_values("id").iterrows():
    posicao = texto_ou_nada(linha["preferred_position"])
    posicao = POSICOES_PADRONIZADAS.get(posicao, posicao)
    jogadores.append({
        "id": int(linha["id"]),
        "nome": texto_ou_nada(linha["name"]),
        "apelido": APELIDOS.get(int(linha["id"])),
        "posicao": posicao,
        "tipo": "goleiro" if posicao == "Goleiro" else "linha",
        "ativo": True,
    })

ids_jogadores = {j["id"] for j in jogadores}
conferir(len(ids_jogadores) == len(jogadores), "há ids de jogador repetidos")
conferir(all(j["nome"] for j in jogadores), "há jogador sem nome")


# =====================================================================
# 2. RACHAS DO MOCHA (aba "Partidas")
# =====================================================================
# Cada match_id vira um racha com uma única partida (número 1).

partidas_mocha = aba_partidas[~aba_partidas["match_id"].isin(list(PARTIDAS_DESCARTADAS))]

rachas = []      # cada item: dados do racha + lista de escalações e presenças
for match_id, grupo in partidas_mocha.groupby("match_id"):
    match_id = int(match_id)
    data_criacao = grupo["created_at"].min().date()
    data_jogo = DATAS_CORRIGIDAS.get(match_id, data_criacao)

    observacao = f"Importado do Mocha (partida {match_id})"
    if match_id in DATAS_CORRIGIDAS:
        observacao += f"; data corrigida (lançado em {data_criacao:%d/%m/%Y})"

    escalacoes = [{
        "jogador_id": int(l["player_id"]),
        "equipe": str(l["team"]).strip().upper(),
        "gols": int(l["goals"]),
        "assistencias": int(l["assists"]),
        "gols_contra": 0,  # o Mocha não registrava gol contra
    } for _, l in grupo.iterrows()]

    rachas.append({
        "data_jogo": data_jogo,
        "origem": "mocha",
        "tem_times": True,
        "observacao": observacao,
        "match_id": match_id,
        "escalacoes": escalacoes,
        # No Mocha, todo mundo que jogou estava presente.
        "presencas": [e["jogador_id"] for e in escalacoes],
    })


# =====================================================================
# 3. RACHAS RECUPERADOS (abas "Rachas Recuperados" e "Partidas Recuperadas")
# =====================================================================
# Sem times e sem placar. Presença só quando confirmada ('sim').

aba_partidas_rec = aba_partidas_rec.assign(
    data_jogo=aba_partidas_rec["data"].map(ler_data_br)
)

for texto_data in aba_rachas_rec["data"]:
    data_jogo = ler_data_br(texto_data)
    grupo = aba_partidas_rec[aba_partidas_rec["data_jogo"] == data_jogo]

    escalacoes = [{
        "jogador_id": int(l["player_id"]),
        "equipe": None,
        "gols": int(l["goals"]),
        "assistencias": int(l["assists"]),
        "gols_contra": 0,
    } for _, l in grupo.iterrows()]

    # Gols contra que vieram da aba de auditoria.
    for (data_gc, jogador_id), quantidade in GOLS_CONTRA_RECUPERADOS.items():
        if data_gc != data_jogo:
            continue
        existente = next((e for e in escalacoes if e["jogador_id"] == jogador_id), None)
        if existente:
            existente["gols_contra"] += quantidade
        else:
            # O jogador não estava na lista daquele dia: cria a escalação dele.
            escalacoes.append({"jogador_id": jogador_id, "equipe": None, "gols": 0,
                               "assistencias": 0, "gols_contra": quantidade})

    presencas = [int(l["player_id"]) for _, l in grupo.iterrows()
                 if str(l["presenca_confirmada"]).strip().lower() == "sim"]

    rachas.append({
        "data_jogo": data_jogo,
        "origem": "recuperado",
        "tem_times": False,
        "observacao": OBS_RECUPERADO,
        "match_id": None,
        "escalacoes": escalacoes,
        "presencas": presencas,
    })


# Ordena por data e numera os rachas (id do racha = id da sua única partida).
rachas.sort(key=lambda r: r["data_jogo"])
for numero, racha in enumerate(rachas, start=1):
    racha["id"] = numero


# Conferências de segurança (as mesmas regras que o banco vai exigir).
datas = [r["data_jogo"] for r in rachas]
conferir(len(datas) == len(set(datas)), "há dois rachas na mesma data")
for r in rachas:
    ids = [e["jogador_id"] for e in r["escalacoes"]]
    conferir(len(ids) == len(set(ids)), f"jogador repetido no racha de {r['data_jogo']}")
    conferir(len(r["presencas"]) == len(set(r["presencas"])),
             f"presença repetida no racha de {r['data_jogo']}")
    conferir(set(ids) <= ids_jogadores and set(r["presencas"]) <= ids_jogadores,
             f"jogador desconhecido no racha de {r['data_jogo']}")
    for e in r["escalacoes"]:
        conferir(min(e["gols"], e["assistencias"], e["gols_contra"]) >= 0,
                 f"número negativo no racha de {r['data_jogo']}")


# =====================================================================
# 4. AJUSTES MANUAIS (aba "Cadastro Jogadores")
# =====================================================================
# Cada campo manual diferente de zero vira um ajuste auditável.
# Data do ajuste: última atualização do cadastro do jogador no Mocha.

ajustes = []
for _, linha in aba_cadastro.sort_values("id").iterrows():
    for campo, tipo in CAMPOS_AJUSTE.items():
        quantidade = para_inteiro(linha[campo])
        if quantidade != 0:
            ajustes.append({
                "jogador_id": int(linha["id"]),
                "tipo": tipo,
                "quantidade": quantidade,
                "motivo": MOTIVO_AJUSTE,
                "data": linha["updated_at"].date(),
            })

conferir({a["jogador_id"] for a in ajustes} <= ids_jogadores, "ajuste de jogador desconhecido")


# =====================================================================
# 5. GERAÇÃO DO ARQUIVO SQL
# =====================================================================

total_escalacoes = sum(len(r["escalacoes"]) for r in rachas)
total_presencas = sum(len(r["presencas"]) for r in rachas)

partes = [
    "-- =====================================================================\n"
    "-- App do Racha — carga dos dados históricos (planilha do Mocha)\n"
    "-- =====================================================================\n"
    "-- ARQUIVO GERADO AUTOMATICAMENTE por scripts/migrar_planilha.py.\n"
    "-- Não edite à mão: corrija o script ou a planilha e gere de novo.\n"
    "--\n"
    "-- Deve ser executado UMA VEZ, depois do 01_estrutura.sql, e só depois\n"
    "-- de conferido o relatório relatorios/conferencia_migracao.xlsx.\n"
    "-- Tudo fica dentro de uma transação: se algo der erro, nada é gravado.\n"
    "--\n"
    f"-- Conteúdo: {len(jogadores)} jogadores, {len(rachas)} rachas, {len(rachas)} partidas,\n"
    f"-- {total_escalacoes} escalações, {total_presencas} presenças, {len(ajustes)} ajustes.\n"
    "-- Não há cobranças nem pagamentos: não existia controle financeiro.\n"
    "-- =====================================================================\n\n"
    "begin;\n",

    "\n-- Jogadores (com os mesmos ids da planilha)\n",
    sql_insert("jogadores", ["id", "nome", "apelido", "posicao", "tipo", "ativo"],
               [[j["id"], j["nome"], j["apelido"], j["posicao"], j["tipo"], j["ativo"]]
                for j in jogadores]),

    "\n-- Rachas (um por data)\n",
    sql_insert("rachas", ["id", "data_jogo", "valor_cobrado", "situacao", "origem",
                          "tem_times", "observacao"],
               [[r["id"], r["data_jogo"], VALOR_COBRADO, "realizado", r["origem"],
                 r["tem_times"], r["observacao"]] for r in rachas]),

    "\n-- Partidas (uma por racha, sempre número 1)\n",
    sql_insert("partidas", ["id", "racha_id", "numero"],
               [[r["id"], r["id"], 1] for r in rachas]),

    "\n-- Escalações (quem jogou, equipe, gols, assistências e gols contra)\n",
    sql_insert("escalacoes", ["partida_id", "jogador_id", "equipe", "gols",
                              "assistencias", "gols_contra"],
               [[r["id"], e["jogador_id"], e["equipe"], e["gols"], e["assistencias"],
                 e["gols_contra"]] for r in rachas for e in r["escalacoes"]]),

    "\n-- Presenças (Mocha: todos que jogaram; recuperados: só as confirmadas)\n",
    sql_insert("presencas", ["racha_id", "jogador_id", "atuou_como_goleiro"],
               [[r["id"], jid, False] for r in rachas for jid in r["presencas"]]),

    "\n-- Ajustes manuais do Mocha (autor vazio: vieram da importação)\n",
    sql_insert("ajustes", ["jogador_id", "tipo", "quantidade", "motivo", "data", "autor"],
               [[a["jogador_id"], a["tipo"], a["quantidade"], a["motivo"], a["data"], None]
                for a in ajustes]),

    "\n-- Acerta os contadores automáticos de id para continuarem depois do\n"
    "-- maior id importado (evita erro de id repetido nos próximos cadastros).\n"
    "select setval(pg_get_serial_sequence('public.jogadores', 'id'),\n"
    "              (select coalesce(max(id), 1) from public.jogadores));\n"
    "select setval(pg_get_serial_sequence('public.rachas', 'id'),\n"
    "              (select coalesce(max(id), 1) from public.rachas));\n"
    "select setval(pg_get_serial_sequence('public.partidas', 'id'),\n"
    "              (select coalesce(max(id), 1) from public.partidas));\n",

    "\ncommit;\n",
]

ARQUIVO_SQL.parent.mkdir(parents=True, exist_ok=True)
ARQUIVO_SQL.write_text("".join(partes), encoding="utf-8")
print(f"Gerado: {ARQUIVO_SQL.relative_to(PASTA_PROJETO)}")


# =====================================================================
# 6. RELATÓRIO DE CONFERÊNCIA
# =====================================================================

# --- 6.1 Placar e resultado de cada racha ---------------------------
# Placar de uma equipe = gols dos seus jogadores + gols contra do adversário.
# Só os rachas do Mocha têm equipes, então só eles têm placar e vitórias.
linhas_rachas = []
resultado_por_jogador = {}  # (racha id, jogador id): 'V', 'E' ou 'D'
for r in rachas:
    placar_txt = "sem placar"
    if r["tem_times"]:
        gols = {"A": 0, "B": 0}
        for e in r["escalacoes"]:
            adversario = "B" if e["equipe"] == "A" else "A"
            gols[e["equipe"]] += e["gols"]
            gols[adversario] += e["gols_contra"]
        placar_txt = f"A {gols['A']} x {gols['B']} B"
        for e in r["escalacoes"]:
            meus = gols[e["equipe"]]
            deles = gols["B" if e["equipe"] == "A" else "A"]
            resultado_por_jogador[(r["id"], e["jogador_id"])] = (
                "V" if meus > deles else "E" if meus == deles else "D")

    linhas_rachas.append({
        "racha id": r["id"],
        "data do jogo": r["data_jogo"].strftime("%d/%m/%Y"),
        "dia da semana": DIAS_SEMANA[r["data_jogo"].weekday()],
        "origem": r["origem"],
        "partida no Mocha": r["match_id"],
        "placar": placar_txt,
        "nº de jogadores": len(r["escalacoes"]),
        "nº de presenças": len(r["presencas"]),
        "gols": sum(e["gols"] for e in r["escalacoes"]),
        "assistências": sum(e["assistencias"] for e in r["escalacoes"]),
        "gols contra": sum(e["gols_contra"] for e in r["escalacoes"]),
        "observação": r["observacao"],
    })

# --- 6.2 Números por jogador ----------------------------------------
# Quanto o histórico bruto do Mocha tinha nas partidas descartadas
# (usado para explicar as diferenças).
descartadas = aba_partidas[aba_partidas["match_id"].isin(list(PARTIDAS_DESCARTADAS))]
gols_descartados = descartadas.groupby("player_id")["goals"].sum()
assist_descartadas = descartadas.groupby("player_id")["assists"].sum()

consolidados = aba_consolidados.set_index("id")
linhas_jogadores = []
for j in jogadores:
    jid = j["id"]
    minhas = [(r, e) for r in rachas for e in r["escalacoes"] if e["jogador_id"] == jid]
    resultados = [resultado_por_jogador.get((r["id"], jid)) for r, _ in minhas]
    ajuste = {tipo: sum(a["quantidade"] for a in ajustes
                        if a["jogador_id"] == jid and a["tipo"] == tipo)
              for tipo in CAMPOS_AJUSTE.values()}

    gols = sum(e["gols"] for _, e in minhas)
    assist = sum(e["assistencias"] for _, e in minhas)
    vitorias = resultados.count("V")
    gols_total = gols + ajuste["gols"]
    assist_total = assist + ajuste["assistencias"]

    gols_planilha = para_inteiro(consolidados.loc[jid, "goals_historico_consolidado"])
    assist_planilha = para_inteiro(consolidados.loc[jid, "assists_historico_consolidado"])
    dif_gols = gols_total - gols_planilha
    dif_assist = assist_total - assist_planilha

    # Monta a explicação, parte por parte, a partir das causas conhecidas.
    explicacoes = []
    g22, a22 = int(gols_descartados.get(jid, 0)), int(assist_descartadas.get(jid, 0))
    if g22 or a22:
        explicacoes.append(f"partida 22 removida (−{g22} gols, −{a22} assist.)")
    if ajuste["gols"] or ajuste["assistencias"]:
        explicacoes.append(f"ajuste manual somado ({ajuste['gols']:+d} gols, "
                           f"{ajuste['assistencias']:+d} assist.)")
    sobra_gols = dif_gols - (ajuste["gols"] - g22)
    sobra_assist = dif_assist - (ajuste["assistencias"] - a22)
    if sobra_gols or sobra_assist:
        explicacoes.append(f"ATENÇÃO: diferença não explicada ({sobra_gols:+d} gols, "
                           f"{sobra_assist:+d} assist.)")

    linhas_jogadores.append({
        "id": jid,
        "nome": j["nome"],
        "apelido": j["apelido"],
        "posição": j["posicao"],
        "tipo": j["tipo"],
        "presenças": sum(jid in r["presencas"] for r in rachas),
        "jogos registrados": len(minhas),
        "gols": gols,
        "assistências": assist,
        "gols contra": sum(e["gols_contra"] for _, e in minhas),
        "vitórias": vitorias,
        "empates": resultados.count("E"),
        "derrotas": resultados.count("D"),
        "ajuste gols": ajuste["gols"],
        "ajuste assist.": ajuste["assistencias"],
        "ajuste vitórias": ajuste["vitorias"],
        "gols com ajuste": gols_total,
        "assist. com ajuste": assist_total,
        "vitórias com ajuste": vitorias + ajuste["vitorias"],
        "gols planilha (consolidado)": gols_planilha,
        "assist. planilha (consolidado)": assist_planilha,
        "diferença gols": dif_gols,
        "diferença assist.": dif_assist,
        "explicação": "; ".join(explicacoes) or "sem diferença",
    })

# --- 6.3 Avisos para o usuário conferir ------------------------------
avisos = []
for r in rachas:
    if r["data_jogo"].weekday() != 3:  # 3 = quinta-feira
        avisos.append({"aviso": "Racha fora de quinta-feira",
                       "detalhe": f"{r['data_jogo']:%d/%m/%Y} é {DIAS_SEMANA[r['data_jogo'].weekday()]} "
                                  f"(origem: {r['origem']}). Conferir se a data está certa."})
for match_id, motivo in PARTIDAS_DESCARTADAS.items():
    avisos.append({"aviso": f"Partida {match_id} do Mocha descartada", "detalhe": motivo})
for match_id, data_jogo in DATAS_CORRIGIDAS.items():
    avisos.append({"aviso": f"Data corrigida da partida {match_id}",
                   "detalhe": f"Data do jogo considerada: {data_jogo:%d/%m/%Y}"})
for (data_gc, jogador_id), qtd in GOLS_CONTRA_RECUPERADOS.items():
    avisos.append({"aviso": "Gol contra vindo da auditoria",
                   "detalhe": f"Jogador {jogador_id} em {data_gc:%d/%m/%Y}: {qtd} gol(s) contra. "
                              "Se ele não estava na lista do dia, a escalação foi criada só para isso."})
avisos.append({"aviso": "Presenças dos rachas recuperados",
               "detalhe": "Só 24/09/2026 tem presença confirmada; nos demais recuperados "
                          "ninguém recebe presença (lista incompleta)."})

# --- 6.4 Grava o Excel ------------------------------------------------
ARQUIVO_RELATORIO.parent.mkdir(parents=True, exist_ok=True)
with pd.ExcelWriter(ARQUIVO_RELATORIO, engine="openpyxl") as planilha:
    for nome_aba, linhas in [("Jogadores", linhas_jogadores),
                             ("Rachas", linhas_rachas),
                             ("Avisos", avisos)]:
        tabela = pd.DataFrame(linhas)
        tabela.to_excel(planilha, sheet_name=nome_aba, index=False)
        aba = planilha.sheets[nome_aba]
        aba.freeze_panes = "A2"  # deixa o cabeçalho fixo ao rolar
        # Ajusta a largura das colunas ao conteúdo (com limite).
        for i, coluna in enumerate(tabela.columns, start=1):
            largura = max([len(str(coluna))] + [len(str(v)) for v in tabela[coluna]])
            aba.column_dimensions[aba.cell(1, i).column_letter].width = min(largura + 2, 70)

print(f"Gerado: {ARQUIVO_RELATORIO.relative_to(PASTA_PROJETO)}")


# =====================================================================
# 7. RESUMO NO TERMINAL
# =====================================================================

print("\nResumo do que foi gerado:")
print(f"  jogadores:   {len(jogadores)}")
print(f"  rachas:      {len(rachas)} "
      f"({sum(r['origem'] == 'mocha' for r in rachas)} do Mocha, "
      f"{sum(r['origem'] == 'recuperado' for r in rachas)} recuperados)")
print(f"  partidas:    {len(rachas)}")
print(f"  escalações:  {total_escalacoes}")
print(f"  presenças:   {total_presencas}")
print(f"  ajustes:     {len(ajustes)}")

tabela = pd.DataFrame(linhas_jogadores)
tabela["maior diferença"] = tabela["diferença gols"].abs() + tabela["diferença assist."].abs()
print("\n5 maiores diferenças em relação à planilha:")
for _, l in tabela.sort_values("maior diferença", ascending=False).head(5).iterrows():
    print(f"  {l['nome']:<20} gols {l['diferença gols']:+d} | assist. {l['diferença assist.']:+d}"
          f" | {l['explicação']}")
