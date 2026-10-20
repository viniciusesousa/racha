"""
Gera as imagens do app a partir do escudo original.

O que este script faz:
  1. Lê o escudo original (web/img/escudo.png.jfif — na verdade um JPEG
     com fundo preto). O ORIGINAL NÃO É ALTERADO.
  2. Cria web/img/escudo.png com fundo transparente: apaga apenas o preto
     LIGADO ÀS BORDAS da imagem (como um "balde de tinta" a partir dos
     cantos). O preto que faz parte do desenho, cercado pelo escudo,
     é preservado.
  3. Cria web/img/escudo-256.png: versão pequena e leve do escudo
     transparente, usada nas telas (cabeçalho, aba Início, ícone da aba).
  4. Mostra no terminal as cores principais do escudo (para a paleta).

Como rodar (na pasta principal do projeto):
    python scripts/gerar_imagens.py
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

# Garante que acentos apareçam corretamente no terminal do Windows.
sys.stdout.reconfigure(encoding="utf-8")


# =====================================================================
# CONFIGURAÇÕES
# =====================================================================

PASTA_PROJETO = Path(__file__).resolve().parent.parent
ESCUDO_ORIGINAL = PASTA_PROJETO / "web" / "img" / "escudo.png.jfif"
ESCUDO_TRANSPARENTE = PASTA_PROJETO / "web" / "img" / "escudo.png"
ESCUDO_LEVE = PASTA_PROJETO / "web" / "img" / "escudo-256.png"

# Até que brilho um pixel é considerado "quase preto" (0 a 255).
# O JPEG tem ruído, então o fundo não é preto puro.
LIMITE_QUASE_PRETO = 45

# Faixa de suavização da borda: pixels escuros encostados no fundo
# removido ficam semitransparentes (evita contorno serrilhado).
LIMITE_SUAVIZACAO = 110
LARGURA_SUAVIZACAO = 2  # em pixels


# =====================================================================
# FUNÇÕES
# =====================================================================

def vizinhos(mascara):
    """Expande uma máscara em 1 pixel para cima, baixo, esquerda e direita."""
    m = mascara.copy()
    m[1:, :] |= mascara[:-1, :]
    m[:-1, :] |= mascara[1:, :]
    m[:, 1:] |= mascara[:, :-1]
    m[:, :-1] |= mascara[:, 1:]
    return m


def fundo_ligado_as_bordas(quase_preto):
    """
    "Balde de tinta": parte de todos os pixels quase pretos da borda da
    imagem e vai se espalhando só por pixels quase pretos vizinhos.
    Devolve a máscara do fundo (o preto que toca as bordas).
    """
    fundo = np.zeros_like(quase_preto)
    fundo[0, :] = quase_preto[0, :]
    fundo[-1, :] = quase_preto[-1, :]
    fundo[:, 0] = quase_preto[:, 0]
    fundo[:, -1] = quase_preto[:, -1]
    while True:
        novo = vizinhos(fundo) & quase_preto
        if (novo == fundo).all():
            return fundo
        fundo = novo


def gerar_escudo_transparente():
    """Cria o escudo com fundo transparente e devolve a imagem RGBA."""
    original = Image.open(ESCUDO_ORIGINAL).convert("RGB")
    rgb = np.asarray(original).astype(np.int16)
    brilho = rgb.max(axis=2)  # o canal mais forte de cada pixel

    fundo = fundo_ligado_as_bordas(brilho <= LIMITE_QUASE_PRETO)

    # Transparência: fundo = 0 (invisível); resto = 255 (opaco).
    alfa = np.where(fundo, 0, 255).astype(np.int16)

    # Suaviza a borda: perto do fundo, pixels escuros ficam semitransparentes
    # de acordo com o brilho (quanto mais escuro, mais transparente).
    faixa = fundo.copy()
    for _ in range(LARGURA_SUAVIZACAO):
        faixa = vizinhos(faixa)
    faixa &= ~fundo
    escuros = faixa & (brilho < LIMITE_SUAVIZACAO)
    proporcao = (brilho - LIMITE_QUASE_PRETO) / (LIMITE_SUAVIZACAO - LIMITE_QUASE_PRETO)
    alfa = np.where(escuros, np.clip(proporcao * 255, 0, 255), alfa)

    rgba = np.dstack([rgb, alfa]).astype(np.uint8)
    imagem = Image.fromarray(rgba, "RGBA")

    # Corta as sobras transparentes em volta do escudo (com 2% de margem).
    caixa = imagem.getbbox()
    margem = int(max(imagem.size) * 0.02)
    caixa = (max(caixa[0] - margem, 0), max(caixa[1] - margem, 0),
             min(caixa[2] + margem, imagem.width), min(caixa[3] + margem, imagem.height))
    imagem = imagem.crop(caixa)

    imagem.save(ESCUDO_TRANSPARENTE, optimize=True)
    removido = fundo.mean() * 100
    print(f"Gerado: {ESCUDO_TRANSPARENTE.relative_to(PASTA_PROJETO)} "
          f"({imagem.width}x{imagem.height}; {removido:.0f}% da imagem original era fundo)")
    return imagem


def gerar_escudo_leve(imagem, lado=256):
    """Salva uma cópia pequena do escudo (o maior lado com `lado` pixels)."""
    copia = imagem.copy()
    copia.thumbnail((lado, lado), Image.LANCZOS)
    copia.save(ESCUDO_LEVE, optimize=True)
    tamanho_kb = ESCUDO_LEVE.stat().st_size / 1024
    print(f"Gerado: {ESCUDO_LEVE.relative_to(PASTA_PROJETO)} "
          f"({copia.width}x{copia.height}; {tamanho_kb:.0f} KB)")


def cores_principais(imagem, quantidade=8):
    """Mostra as cores mais presentes no escudo (ignorando o transparente)."""
    rgba = np.asarray(imagem)
    pixels = rgba[rgba[:, :, 3] == 255][:, :3]
    amostra = Image.fromarray(pixels.reshape(-1, 1, 3))
    reduzida = amostra.quantize(colors=quantidade, method=Image.Quantize.MEDIANCUT)
    paleta = reduzida.getpalette()[: quantidade * 3]
    contagem = sorted(reduzida.getcolors(), reverse=True)
    print("\nCores principais do escudo (da mais presente para a menos):")
    for total, indice in contagem:
        r, g, b = paleta[indice * 3: indice * 3 + 3]
        print(f"  #{r:02x}{g:02x}{b:02x}  {total / len(pixels) * 100:5.1f}%")


# =====================================================================
# EXECUÇÃO
# =====================================================================

if __name__ == "__main__":
    escudo = gerar_escudo_transparente()
    gerar_escudo_leve(escudo)
    cores_principais(escudo)
