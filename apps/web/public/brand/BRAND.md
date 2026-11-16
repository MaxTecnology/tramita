# Tramita — Identidade visual

Gestão de processos contábeis. Todos os SVGs são 100% vetoriais (texto já convertido em contorno, sem dependência de fonte).

## Arquivos

| Arquivo | Uso |
|---|---|
| `tramita-simbolo.svg` / `-branco.svg` | Só o símbolo (T + r). Fundo claro / escuro |
| `tramita-logo-horizontal.svg` / `-branco.svg` | Logo completo com tagline. Tela de login, landing, documentos |
| `tramita-logo-compacto.svg` / `-branco.svg` | Símbolo + nome, sem tagline. Header/sidebar do app |
| `tramita-icone-navy.svg` / `-azul.svg` / `-branco.svg` | Ícone de app 512×512 com cantos arredondados |
| `png/tramita-icone-{16,32,180,192,512}.png` | Favicon, apple-touch-icon, PWA |
| `png/tramita-logo-horizontal*.png` | Logo raster (e-mail, onde SVG não funciona) |

## Cores

| Token | Hex | Uso |
|---|---|---|
| `navy` | `#0B1F3F` | Cor principal da marca, texto do logo, fundo escuro |
| `blue` | `#0B57A4` | Fundo do ícone, botões primários |
| `accent` | `#1A73D9` | Barra divisória do logo, links, foco |
| `muted` | `#4A5D78` | Tagline e texto secundário |
| `muted-on-dark` | `#B8C4D6` | Tagline em fundo escuro |

## Tipografia

Plus Jakarta Sans (Google Fonts) — ExtraBold 800 no nome, SemiBold 600 na tagline (caixa alta, tracking largo).

## Símbolo inline (para componente React)

```svg
<svg viewBox="-2 -2 336 361" fill="currentColor" aria-hidden="true">
  <path d="M0 0H332C332 23.2 313.2 42 290 42H45V80H332C332 103.2 313.2 122 290 122H150V357H105V122H0Z"/>
  <path d="M178 200C178 176.8 196.8 157 220 157H332C332 180.2 313.2 200 290 200Z"/>
  <path d="M178 237H224V357H178Z"/>
</svg>
```

## Regras

- Área de respiro mínima ao redor do logo: a largura da haste do T.
- Não esticar, não recolorir o símbolo fora das cores acima, não aplicar sombra/gradiente.
- Tamanho mínimo do símbolo: 16 px (favicon); logo horizontal: 160 px de largura.
