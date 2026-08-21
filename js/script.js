/* =========================================================================
   PREFERÊNCIA DE MOVIMENTO
   Um único ponto de verdade: quem tem "reduzir movimento" ligado no sistema
   recebe a versão estática de tudo (nada de loop infinito, parallax, etc).
   ========================================================================= */

const PREFERE_MENOS_MOVIMENTO =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;


/* =========================================================================
   TEXTO DIGITADO — "I'm a ___" (Typed.js)
   ========================================================================= */

/* no Typed.js `loop` é BOOLEANO e `loopCount` é o número de repetições.
   Com `loop: 3` o 3 vira apenas "verdadeiro" e o texto ficava digitando pra
   sempre, sem parar nunca no último título. */

/* A digitação NÃO pode começar no carregamento do script: o preloader ainda
   está cobrindo a tela, e quando a cortina sobe o texto já está no fim de
   "Web Developer" — a pessoa nunca vê a frase sendo escrita do começo.
   Por isso ela espera o mesmo aviso que a assinatura e o block reveal já
   esperavam. O evento vem do js/efeitos.js, que carrega depois deste arquivo,
   então dá tempo de registrar o ouvinte antes de ele disparar. */
let typedIniciado = false;

function iniciarTyped(){
  if (typedIniciado) return;
  typedIniciado = true;

  new Typed('.auto-type', {
    strings: [' Web Developer', ' Designer', ' Front-end Developer'],
    typeSpeed: 90,
    backSpeed: 60,
    backDelay: 1400,
    loop: !PREFERE_MENOS_MOVIMENTO,
    loopCount: 3
  });
}

document.addEventListener('site:pronto', iniciarTyped, { once: true });

/* Rede de segurança: se o js/efeitos.js não carregar, o aviso nunca vem e a
   frase ficaria vazia pra sempre. Passado o tempo máximo do preloader
   (2,2s de salva-vidas + 0,8s de cortina), a digitação começa de qualquer
   jeito. */
setTimeout(iniciarTyped, 3200);


/* =========================================================================
   MENU HAMBÚRGUER — abrir / fechar overlay
   ========================================================================= */

const menuToggle = document.getElementById('menu-toggle');
const menuPanel  = document.getElementById('menu-panel');

/* trava o scroll do fundo enquanto o overlay está aberto. Sem isso dava pra
   rolar a página inteira "por trás" do menu — ao fechar, você caía num lugar
   completamente diferente de onde estava. O padding compensa a largura da
   barra de rolagem que some, senão a página toda dá um pulo lateral. */
function travarScroll(travar){
  const larguraBarra = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.overflow     = travar ? 'hidden' : '';
  document.body.style.paddingRight = travar && larguraBarra > 0 ? `${larguraBarra}px` : '';
}

/* o parallax das fotos escreve `transform` inline, e a animação de entrada do
   menu (css/efeitos.css) também usa transform. Se o mouse se mexer enquanto as
   fotos ainda estão subindo, o inline atropela a animação e elas aparecem de
   estalo. A classe `menu-pronto` só entra quando a entrada acabou — antes
   disso o parallax fica quieto. */
let menuProntoTimer = 0;

/* AS FOTOS DO MENU SÓ CARREGAM QUANDO FOREM PRECISAS.

   São oito, e somavam cerca de 780KB baixados no primeiro acesso — para um
   overlay que começa fechado e que muita gente nem abre. Elas competiam por
   banda com o que estava na tela, e num celular em rede ruim isso é o
   suficiente para o começo da página parecer travado.

   `loading="lazy"` NÃO resolve isto, e vale registrar por quê: o overlay é
   `position: fixed` empurrado para fora por um transform, e o navegador não
   leva transforms em conta ao decidir o que está longe da tela. Para ele as
   oito fotos estão bem ali na viewport — medi, e as oito continuavam baixando
   no primeiro acesso mesmo marcadas como lazy.

   O jeito que funciona é a URL não estar no `src`: ela mora em `data-src` e
   só vira `src` na hora certa. E essa hora é o primeiro sinal de intenção — o
   dedo encostando no botão, o mouse chegando perto —, que acontece antes do
   clique, então quem abre o menu encontra tudo pronto. Como garantia, elas
   também são carregadas sozinhas um pouco depois do `load`, quando o caminho
   crítico já acabou e ninguém mais está esperando por banda.

   Sem JS o menu nem abre (o botão é script), então não há caso em que essas
   fotos precisem existir e este código não tenha rodado. */
let fotosAquecidas = false;

function aquecerFotosDoMenu(){
  if (fotosAquecidas) return;
  fotosAquecidas = true;
  /* consulta o DOM aqui em vez de usar a lista lá de baixo: aquela é um
     `const` declarado depois desta função, e depender da ordem de execução
     pra não cair na zona morta é o tipo de armadilha que só aparece quando
     alguém move uma linha */
  document.querySelectorAll('.menu-photos img[data-src]').forEach((img) => {
    img.src = img.dataset.src;
    img.removeAttribute('data-src');
  });
}

if (menuToggle) {
  for (const evento of ['pointerenter', 'pointerdown', 'touchstart', 'focus']) {
    menuToggle.addEventListener(evento, aquecerFotosDoMenu, { once: true, passive: true });
  }
}

// depois que a página terminou de carregar, sem pressa: se ninguém encostou no
// menu até aqui, as fotos entram na fila sem disputar nada
window.addEventListener('load', () => {
  setTimeout(aquecerFotosDoMenu, 2500);
}, { once: true });

function openMenu(){
  aquecerFotosDoMenu();   // rede de segurança: abriu, carrega de qualquer jeito
  menuToggle.classList.add('open');
  menuPanel.classList.add('open');
  menuToggle.setAttribute('aria-expanded', 'true');
  menuPanel.setAttribute('aria-hidden', 'false');
  menuToggle.setAttribute('aria-label', 'Fechar menu');
  travarScroll(true);

  clearTimeout(menuProntoTimer);
  menuProntoTimer = setTimeout(() => menuPanel.classList.add('menu-pronto'), 1400);
}

function closeMenu(){
  if (!menuPanel.classList.contains('open')) return;

  menuToggle.classList.remove('open');
  menuPanel.classList.remove('open');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuPanel.setAttribute('aria-hidden', 'true');
  menuToggle.setAttribute('aria-label', 'Abrir menu');
  travarScroll(false);

  clearTimeout(menuProntoTimer);
  menuPanel.classList.remove('menu-pronto');

  // devolve as fotos ao transform da folha de estilo, senão o inline do
  // parallax congela elas fora do lugar na próxima abertura
  menuPhotoImgs.forEach((img) => { img.style.transform = ''; });
  alvoPX = alvoPY = atualPX = atualPY = 0;
}

menuToggle.addEventListener('click', () => {
  const isOpen = menuToggle.classList.contains('open');
  isOpen ? closeMenu() : openMenu();

  // dispara o "bounce" elástico do botão a cada clique — remove e
  // readiciona a classe (forçando um reflow no meio) pra garantir que a
  // animação reinicie do zero mesmo em cliques seguidos rápidos
  menuToggle.classList.remove('mt-bounce');
  void menuToggle.offsetWidth;
  menuToggle.classList.add('mt-bounce');
});

// fecha o menu ao clicar em algum link lá dentro
menuPanel.querySelectorAll('[data-menu-link]').forEach((link) => {
  link.addEventListener('click', closeMenu);
});

// fecha com a tecla ESC e devolve o foco pro botão (senão o foco fica preso
// num link que acabou de ficar invisível)
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !menuPanel.classList.contains('open')) return;
  closeMenu();
  menuToggle.focus();
});


/* =========================================================================
   EFEITO "TEXT REVEAL" — quebra o texto em caracteres animáveis
   ========================================================================= */

function initTextReveal(root = document){
  root.querySelectorAll('[data-text-reveal]').forEach((el) => {
    if (el.dataset.trInit) return; // evita rodar duas vezes no mesmo elemento
    el.dataset.trInit = '1';

    const text = el.getAttribute('data-text') || el.textContent.trim();
    el.textContent = '';
    el.setAttribute('aria-label', text);
    if (!el.hasAttribute('data-direction')) el.setAttribute('data-direction', 'up');

    const track = document.createElement('span');
    track.className = 'tr-track';
    track.setAttribute('aria-hidden', 'true');

    const chars = (typeof Intl !== 'undefined' && Intl.Segmenter)
      ? Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text), s => s.segment)
      : [...text];

    chars.forEach((ch, i) => {
      const span = document.createElement('span');
      span.className = 'tr-char';
      span.style.setProperty('--tr-i', i);
      span.textContent = ch === ' ' ? '\u00A0' : ch;
      track.appendChild(span);
    });

    el.appendChild(track);
  });
}

document.addEventListener('DOMContentLoaded', () => initTextReveal());


/* =========================================================================
   MENU — parallax das fotos ao mover o mouse
   ========================================================================= */

const menuPhotoImgs = Array.from(document.querySelectorAll('.menu-photos img'));

/* Este efeito tinha parado de funcionar por culpa da animação de entrada que
   eu havia adicionado no css/efeitos.css: as fotos ganharam
   `transition: transform .7s` com `transition-delay` de até .68s. Como o
   parallax escreve justamente em `transform`, cada movimento do mouse passava
   a esperar meio segundo e depois levar mais 0.7s pra chegar — o efeito
   continuava lá, mas tão atrasado e mole que parecia desligado.
   O css/estilo.css agora zera essa transição assim que a entrada termina
   (regra `.menu-panel.menu-pronto .menu-photos img`), e a suavização passa a
   ser feita aqui, por interpolação.

   Melhorias em relação à versão original:
     · move nos DOIS eixos, não só na vertical;
     · a posição perseguida é interpolada, então o movimento tem inércia em
       vez de grudar no ponteiro;
     · cada foto ganha uma leve inclinação proporcional à profundidade, o que
       vende melhor a ideia de camadas;
     · o laço só roda enquanto o menu está aberto e ainda há movimento. */

const PARALLAX_FORCA_X = 0.55; // o eixo X anda menos que o Y, fica mais natural
const PARALLAX_INCLINA = 0.9;  // graus de inclinação na foto mais "próxima"
const PARALLAX_SUAVIDADE = 0.09;

let alvoPX = 0, alvoPY = 0;   // para onde o mouse quer levar (-1 a 1)
let atualPX = 0, atualPY = 0; // onde as fotos estão agora
let parallaxRodando = false;

function pintarMenuParallax(){
  parallaxRodando = false;

  atualPX += (alvoPX - atualPX) * PARALLAX_SUAVIDADE;
  atualPY += (alvoPY - atualPY) * PARALLAX_SUAVIDADE;

  for (const img of menuPhotoImgs) {
    const depth = parseFloat(img.dataset.depth || 18);
    const rot = parseFloat(img.style.getPropertyValue('--rot')) || 0;

    const x = -atualPX * depth * PARALLAX_FORCA_X;
    const y = -atualPY * depth;
    // profundidade normalizada (os data-depth vão de ~34 a ~76)
    const inclina = -atualPX * (depth / 76) * PARALLAX_INCLINA;

    img.style.transform =
      `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${(rot + inclina).toFixed(2)}deg)`;
  }

  // continua até assentar — é o que dá a inércia
  if (Math.abs(alvoPX - atualPX) > 0.001 || Math.abs(alvoPY - atualPY) > 0.001) {
    parallaxRodando = true;
    requestAnimationFrame(pintarMenuParallax);
  }
}

function acordarParallax(){
  if (parallaxRodando) return;
  parallaxRodando = true;
  requestAnimationFrame(pintarMenuParallax);
}

function updateMenuParallax(e){
  if (PREFERE_MENOS_MOVIMENTO) return;
  if (!menuPanel.classList.contains('menu-pronto')) return;

  alvoPX = (e.clientX / window.innerWidth  - 0.5) * 2;
  alvoPY = (e.clientY / window.innerHeight - 0.5) * 2;
  acordarParallax();
}

window.addEventListener('mousemove', updateMenuParallax, { passive: true });


/* =========================================================================
   ONDA ENTRE HERO E SOBRE — desenha o path do SVG conforme o scroll
   ========================================================================= */

const waveCap     = document.querySelector('.wave-cap');
const waveCapSvg  = document.getElementById('waveCapSvg');
const waveCapPath = document.getElementById('waveCapPath');
const conteudoEl  = document.querySelector('.conteudo');

const CAP_HEIGHT    = 1;
const WAVE_COUNT     = 1.5;
const MAX_AMPLITUDE = 240;
const TOP_PAD        = MAX_AMPLITUDE;
const OVERLAP        = 1;
const SVG_HEIGHT     = CAP_HEIGHT + TOP_PAD + OVERLAP;
const FLOOR_Y         = SVG_HEIGHT;
const BASELINE_LOCAL = CAP_HEIGHT + TOP_PAD;

// AJUSTE AQUI pra controlar quando a onda começa/termina:
// TRIGGER_START = distância (em px) do topo da tela onde a onda começa a nascer
//                 (quanto MAIOR, mais cedo ela começa a aparecer no scroll)
// TRIGGER_END   = distância onde ela termina totalmente formada (geralmente 0)
// TRIGGER_START era uma const lida uma única vez no carregamento: girar o
// celular ou redimensionar a janela deixava a onda calibrada pra altura antiga.
let TRIGGER_START = window.innerHeight; // começa assim que o .conteudo entra na tela
const TRIGGER_END = 140;

/* A onda é sempre 1,5 ciclos na largura da tela, e é daí que vinha o problema
   no celular: em 1440px cada ciclo tem 960px de comprimento para 240px de
   altura — uma curva mansa. Em 390px o mesmo 1,5 ciclos dá 260px de
   comprimento para os MESMOS 240px de altura. A onda não fica menor, fica
   ESPREMIDA: vira um bico.

   A altura passa a acompanhar a largura, então a proporção entre comprimento
   e altura se mantém e a curva continua com o mesmo temperamento em qualquer
   tela. De 1200px pra cima nada muda — o desktop é exatamente o que já era. */
function amplitudeDaTela(width){
  const fator = Math.min(1, width / 1200);
  return MAX_AMPLITUDE * fator;
}

function buildCapWavePath(progress, width){
  const rise = (amplitudeDaTela(width) / 2) * Math.pow(progress, 2);
  const segments = 60;
  let d = `M0,${FLOOR_Y} L0,${BASELINE_LOCAL}`;

  for (let i = 0; i <= segments; i++) {
    const x = (i / segments) * width;
    const angle = (x / width) * Math.PI * 2 * WAVE_COUNT;
    const y = BASELINE_LOCAL - rise * (1 + Math.sin(angle));
    d += ` L${x.toFixed(1)},${y.toFixed(1)}`;
  }

  d += ` L${width},${BASELINE_LOCAL} L${width},${FLOOR_Y} Z`;
  return d;
}

waveCapSvg.setAttribute('viewBox', `0 0 1 ${SVG_HEIGHT}`);

/* A versão anterior chamava requestAnimationFrame em cadeia pra sempre: mesmo
   com a página parada, ou com a onda a 6 telas de distância, o navegador
   recalculava getBoundingClientRect 60x por segundo — leitura de layout cara,
   ligada o tempo todo, que segurava a CPU e derrubava o FPS das outras
   animações. Agora o desenho acontece só quando existe motivo (scroll ou
   resize) e apenas enquanto a onda está perto da tela. */
let lastWaveKey = '';
let waveAgendado = false;

function desenharWaveCap(){
  waveAgendado = false;

  const vw = window.innerWidth;
  const rect = conteudoEl.getBoundingClientRect();

  // fora de alcance: a onda já está formada ou nem começou — nada a redesenhar
  if (rect.top > TRIGGER_START + 200 || rect.bottom < -200) return;

  // progress = 0 quando rect.top == TRIGGER_START, progress = 1 quando rect.top == TRIGGER_END
  let progress = (TRIGGER_START - rect.top) / (TRIGGER_START - TRIGGER_END);
  progress = Math.min(1, Math.max(0, progress));

  const key = progress.toFixed(3) + '_' + vw;
  if (key === lastWaveKey) return;

  lastWaveKey = key;
  waveCapSvg.setAttribute('viewBox', `0 0 ${vw} ${SVG_HEIGHT}`);
  waveCapPath.setAttribute('d', buildCapWavePath(progress, vw));
}

function updateWaveCap(){
  if (waveAgendado) return;
  waveAgendado = true;
  requestAnimationFrame(desenharWaveCap);
}

window.addEventListener('scroll', updateWaveCap, { passive: true });
window.addEventListener('resize', () => {
  TRIGGER_START = window.innerHeight;
  lastWaveKey = '';               // força o redesenho na nova largura
  updateWaveCap();
});
updateWaveCap();


/* =========================================================================
   SOBRE — scroll horizontal pinado (hs-outer / hs-track)
   ========================================================================= */

const hsOuter = document.getElementById('hsOuter');
const hsTrack = document.getElementById('hsTrack');
const hsPanelCount = hsTrack.children.length;

let hsCurrent = 0;
let hsTarget = 0;
let hsTicking = false;

const EXTRA_PIN_VH = 0.2; // nº de telas extras de pausa antes do .stack começar a subir — ajuste aqui

/* O pin vale em TODAS as larguras agora. Antes havia um desvio aqui que, no
   celular, limpava a altura e deixava o CSS trocar o efeito por rolagem
   horizontal nativa. O fallback saiu do CSS, então o desvio saiu daqui junto —
   se um dos dois ficasse para trás, a seção ficaria com uma altura enorme e
   nenhum movimento dentro, ou seja, várias telas de branco.

   POR QUE A ALTURA NÃO É MAIS "TANTAS TELAS":

   A conta antiga reservava um número fixo de alturas de tela para o percurso
   horizontal. O problema é que o percurso horizontal se mede em LARGURAS, e a
   proporção entre a largura e a altura da tela muda muito entre um monitor e
   um celular. No desktop davam 4 x 1425px de caminho para 3600px de rolagem:
   1,58px de painel para cada pixel rolado. No celular o mesmo esquema dava
   4 x 390px de caminho para 3376px de rolagem — 0,46. Ou seja, o mesmo gesto
   de dedo movia os painéis TRÊS VEZES E MEIA menos, e a seção parecia pesada,
   emperrada, como se o site tivesse travado ali.

   Agora a altura sai do caminho a percorrer, e não do formato da tela: o
   ritmo é o mesmo em qualquer aparelho. O 1,58 é exatamente a proporção que o
   desktop já tinha, então lá nada muda. */
const VELOCIDADE_PAINEL = 1.58;   // px de painel por px de rolagem

function hsLayout(){
  const H = window.innerHeight;
  const percurso = (hsPanelCount - 1) * window.innerWidth;
  const rolagemHorizontal = percurso / VELOCIDADE_PAINEL;

  // + 1 tela de pin padrão + EXTRA_PIN_VH telas de pausa + a própria tela presa
  hsOuter.style.height =
    `${Math.round(rolagemHorizontal + H * (1 + EXTRA_PIN_VH) + H)}px`;
}

/* Escreve em cada painel marcado com [data-progresso] quanto dele já
   atravessou a tela, de 0 a 1. O css/estilo.css usa esse número como agulha
   das animações do jardim (via animation-delay negativo), então a flor se
   desenha e se desfaz acompanhando o scroll, nos dois sentidos.

   A conta é a posição da borda esquerda do painel dentro da janela:
     painel encostando na direita da tela -> 0
     painel encostado na esquerda         -> 1
   Serve tanto pro pin do desktop quanto pro scroll horizontal nativo do
   mobile, porque nos dois casos é o painel que se move na tela. */
const paineisComProgresso = Array.from(document.querySelectorAll('[data-progresso]'));

function atualizarProgressoPaineis(){
  if (!paineisComProgresso.length) return;

  const largura = window.innerWidth || 1;

  /* O percurso termina quando o painel ENCHE a tela:

       rect.left = largura -> 0   (painel entrando pela direita)
       rect.left = 0       -> 1   (painel inteiro na tela)

     Antes ele era 1.6, ou seja continuava depois da chegada — e o efeito das
     flores só fechava com o painel já saindo pela esquerda. Encurtando pra 1,
     tudo acontece durante a entrada, que é quando se está olhando. Os --ini e
     --dur de cada flor no HTML estão calibrados nessa escala. */
  /* 1.35 e nao 1.0: com o percurso curto tudo acontecia num tranco, porque
     o mesmo efeito passava a caber em menos scroll. Esticado, cada florada
     se espalha por mais caminho — e ainda fecha por volta de prog .78, que e
     quando o painel acaba de encher a tela. */
  const PERCURSO = 1.35;

  /* ESCREVER --prog É A OPERAÇÃO CARA DESTA PÁGINA.

     Medi: mover o trilho custa 0,013ms por quadro; escrever o --prog custa
     0,9ms — setenta vezes mais. E o motivo é justo: mudar essa variável
     invalida o estilo de tudo que depende dela, e o que depende dela são as
     4 flores (24 formas de SVG) e as 8 letras do "DEVELOP". Desligando as
     duas coisas o custo cai 76%, o que mostra que o peso está aí e não no
     movimento em si. Num celular, que é 4 a 8 vezes mais lento, esses 0,9ms
     viram 4 a 7 — de um orçamento de 16,7ms por quadro.

     Não dá pra tirar as flores nem as letras: são o efeito. Dá pra escrever
     menos, e é o que as duas guardas abaixo fazem. */
  for (const painel of paineisComProgresso) {
    const rect = painel.getBoundingClientRect();

    /* 1. PAINEL LONGE DA TELA NÃO PRECISA DE CONTA NENHUMA.
       São dois painéis, e no scroll horizontal quase nunca os dois estão à
       vista ao mesmo tempo — escrever no que está fora é trabalho jogado
       fora. A folga de meia tela garante que ele já chegue com o valor certo
       antes de aparecer. */
    if (rect.right < -largura * 0.5 || rect.left > largura * 1.5) continue;

    let p = (largura - rect.left) / (largura * PERCURSO);
    p = Math.min(1, Math.max(0, p));

    /* 2. SÓ ESCREVE SE MUDOU O BASTANTE PRA SE VER.
       O valor vinha com quatro casas, então praticamente todo quadro trazia
       um número diferente e pagava a invalidação inteira — inclusive na
       cauda do lerp, quando o trilho já está parando e anda frações de pixel.
       Em 500 passos o efeito continua contínuo ao olho e as escritas
       repetidas somem. */
    const passo = Math.round(p * 500) / 500;
    if (painel.__prog === passo) continue;
    painel.__prog = passo;

    painel.style.setProperty('--prog', passo.toFixed(3));
  }
}

/* O LERP SÓ EXISTE ONDE ELE RESOLVE ALGUMA COISA.

   Ele suaviza o pulo grosso da roda do mouse: cada clique da roda salta uns
   100px de uma vez, e sem amortecer os painéis andam aos trancos. No toque
   não existe esse pulo — o dedo já entrega o movimento contínuo, e o
   navegador ainda dá a inércia por cima.

   O preço dele é o rabo: depois de cada evento de scroll, o lerp continua
   pedindo quadros até a diferença cair abaixo de meio pixel. Cada um desses
   quadros extras pagava a escrita do --prog, que é a operação cara daqui.
   Amortecer o que já é suave era gastar quadro para não melhorar nada.

   No toque, então, o trilho acompanha o scroll direto, sem rabo nenhum. */
const HS_SUAVIZA = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

function hsRender(){
  if (!HS_SUAVIZA) {
    hsCurrent = hsTarget;
    hsTrack.style.transform = `translate3d(${-hsCurrent}px, 0, 0)`;
    atualizarProgressoPaineis();
    hsTicking = false;
    return;
  }

  hsCurrent += (hsTarget - hsCurrent) * 0.12;
  hsTrack.style.transform = `translate3d(${-hsCurrent}px, 0, 0)`;
  atualizarProgressoPaineis();

  if (Math.abs(hsTarget - hsCurrent) > 0.5) {
    requestAnimationFrame(hsRender);
  } else {
    hsCurrent = hsTarget;
    hsTrack.style.transform = `translate3d(${-hsCurrent}px, 0, 0)`;
    atualizarProgressoPaineis();
    hsTicking = false;
  }
}

function hsUpdate(){
  const rect = hsOuter.getBoundingClientRect();
  const total = hsOuter.offsetHeight - window.innerHeight;

  // reserva (1 + EXTRA_PIN_VH) telas pro pin/pausa, sem esticar o ritmo do scroll horizontal
  const horizontalTotal = Math.max(total - window.innerHeight * (1 + EXTRA_PIN_VH), 1);
  const progress = Math.min(Math.max(-rect.top / horizontalTotal, 0), 1);

  hsTarget = progress * (hsPanelCount - 1) * window.innerWidth;

  if (!hsTicking) {
    hsTicking = true;
    requestAnimationFrame(hsRender);
  }
}

hsLayout();
hsUpdate();
atualizarProgressoPaineis();

window.addEventListener('scroll', hsUpdate, { passive: true });

/* O .hs-sticky não rola mais sozinho em largura nenhuma — quem move os
   painéis é sempre o pin, comandado pelo scroll da janela. O ouvinte de
   scroll dele e a dica "arraste →" saíram junto com o fallback: não há mais
   arrasto lateral pra ouvir, e avisar pra arrastar seria mentira. */

window.addEventListener('scroll', atualizarProgressoPaineis, { passive: true });
window.addEventListener('resize', atualizarProgressoPaineis);
window.addEventListener('resize', () => {
  hsLayout();
  hsUpdate();
});



/* =========================================================================
   PAINÉIS "I DESIGN." E "I DEVELOP."
   Só liga e desliga a classe que dispara as animações. Todo o efeito mora no
   CSS; aqui não há nada medindo nem escrevendo estilo.

   Sem `unobserve` de propósito: são painéis de um scroll horizontal, e a
   pessoa passa por eles indo e voltando. Tirar e repor a classe faz a
   animação tocar de novo a cada visita, em vez de só na primeira.

   Se este bloco não rodar, os dois painéis aparecem no estado final — a
   palavra cheia no design, a palavra inteira no develop.
   ========================================================================= */

(function initPaineisSobre(){
  const paineis = document.querySelectorAll('.painel-design, .painel-develop');
  if (!paineis.length) return;
  if (PREFERE_MENOS_MOVIMENTO || !('IntersectionObserver' in window)) return;

  /* Autoriza o CSS a esconder as letras do "I DEVELOP." antes de elas se
     montarem. Sem esta classe nenhuma animação entra e a palavra fica
     legível do jeito normal — é o que garante que ela nunca suma caso este
     script não rode. O que faz as letras assentarem é o --prog do scroll,
     escrito por atualizarProgressoPaineis(). */
  const develop = document.querySelector('.painel-develop');
  if (develop) develop.classList.add('dev-scrub');

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      entry.target.classList.toggle('painel-vivo', entry.isIntersecting);
    }
  }, { threshold: 0.55 });

  paineis.forEach((p) => io.observe(p));
})();


/* =========================================================================
   FLORES ANCORADAS NAS LETRAS

   POR QUE ISTO EXISTE: as flores ficavam posicionadas em PORCENTAGEM do
   painel, mas a palavra não acompanha a largura da tela do mesmo jeito —
   `.texto` tem margem FIXA de 200px e a fonte é 16vw. Resultado: uma flor
   calibrada num monitor saía do lugar em outro. Medido num painel de 1920,
   a rosa ficava 262px longe do "I" que ela deveria encostar.

   Aqui a posição de cada flor é calculada a partir da TINTA REAL das letras,
   medida com o canvas na fonte que está valendo. Assim ela gruda no alvo em
   qualquer largura de tela.

   No HTML cada flor traz `data-ancora="ponto,deslocX,deslocY"`. Com
   `data-borda="esq"`, o deslocX passa a valer para a BORDA ESQUERDA da flor
   em vez do centro — é o que permite pedir "encoste cortando o I".
   ========================================================================= */

(function ancorarFloresNasLetras(){
  const painel = document.querySelector('.painel-design');
  if (!painel) return;

  const flores = Array.from(painel.querySelectorAll('.flor[data-ancora]'));
  const h2 = painel.querySelector('.texto h2');
  const letras = Array.from(painel.querySelectorAll('.d-letra'));
  if (!flores.length || !h2 || letras.length < 7) return;

  const ctx = document.createElement('canvas').getContext('2d');

  /* A caixa do ELEMENTO não serve de referência para o "I" solto: o <h2> é um
     bloco e ocupa a linha inteira, então centralizar a tinta nele jogava a
     âncora pro meio do painel em vez de encostar na letra. O Range devolve a
     caixa do TEXTO — a do avanço da fonte — que é o que vale tanto pro <h2>
     quanto pros <span> de cada letra. */
  function caixaDoTexto(el){
    const no = el.firstChild;
    if (no && no.nodeType === 3) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const b = range.getBoundingClientRect();
      if (b.width) return b;
    }
    return el.getBoundingClientRect();
  }

  /* A caixa do avanço ainda é maior que o desenho. Aqui pegamos a TINTA:
     onde o traço começa e termina de fato. */
  function tinta(el, ch){
    const cs = getComputedStyle(el);
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = ctx.measureText(ch);
    const larg = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const r = caixaDoTexto(el);
    const fs = parseFloat(cs.fontSize);
    const base = r.top + (r.height - fs) / 2 + fs * 0.78;
    return {
      esq: r.left + (r.width - larg) / 2,
      dir: r.left + (r.width + larg) / 2,
      topo: base - m.actualBoundingBoxAscent,
      baixo: base + m.actualBoundingBoxDescent
    };
  }

  /* Os deslocamentos do data-ancora foram medidos no olho com a palavra no
     corpo que ela tem numa tela de ~1440px: 230,4px. Eles são px ABSOLUTOS, e
     era daí que vinha o problema no celular — lá a palavra tem uns 50px, mas
     um "+162px" continuava valendo 162px. Isso joga a flor a três larguras de
     letra de distância do ponto onde ela deveria encostar.

     Escalando pelo corpo da letra, o mesmo número passa a significar "tantas
     letras de distância" em vez de "tantos pixels", e o encaixe se mantém em
     qualquer tela. Em 1440px a conta dá 1 e nada muda do que já estava
     calibrado; em telas maiores as flores acompanham a palavra crescendo, o
     que antes também não acontecia. */
  const FONTE_DE_REFERENCIA = 230.4;

  function escalaDoTexto(){
    const fs = parseFloat(getComputedStyle(letras[0]).fontSize);
    return fs > 0 ? fs / FONTE_DE_REFERENCIA : 1;
  }

  /* A referência é o .jardim, NÃO o painel. As flores são filhas dele e o
     `left` delas conta a partir da borda dele — e no celular ele não coincide
     com o painel: leva `inset: 0 11%`, ou seja, começa 43px pra dentro numa
     tela de 390. Medindo pelo painel, todas nasciam 43px à direita do lugar.
     No desktop o inset é 0 e os dois são a mesma caixa, então lá não muda
     nada. */
  const jardim = painel.querySelector('.jardim');

  function posicionar(){
    const rp = (jardim || painel).getBoundingClientRect();
    if (!rp.width) return;                 // painel ainda sem caixa

    const k = escalaDoTexto();

    /* O tamanho da flor acompanha o tamanho da palavra pelo mesmo fator do
       deslocamento. Antes era um `--escala: .40` fixo no CSS, calibrado no
       olho: com ele a flor rosa dava 3,8 larguras de letra no celular contra
       2,07 no desktop — quase o dobro, e era isso que fazia ela engolir
       metade de "DESIGN". Com o fator, dá 2,10: o mesmo do desktop. */
    if (jardim) jardim.style.setProperty('--escala', k.toFixed(4));
    const I = tinta(h2, 'I');
    const S = tinta(letras[2], 'S');
    const N = tinta(letras[5], 'N');

    const pontos = {
      'I':     { x: I.esq, y: (I.topo + I.baixo) / 2 },
      'S-esq': { x: S.esq, y: S.baixo },
      'N-esq': { x: N.esq, y: N.baixo },
      'N-dir': { x: N.dir, y: N.topo }
    };

    for (const f of flores) {
      const [nome, dx, dy] = f.dataset.ancora.split(',');
      const p = pontos[nome];
      if (!p) continue;

      const cs = getComputedStyle(f);
      const tam = parseFloat(cs.getPropertyValue('--tam')) || 0;
      const escala = parseFloat(cs.getPropertyValue('--escala')) || 1;
      const meio = tam * escala / 2;

      // --e e --t são o CENTRO da flor (o margin negativo já desconta a metade)
      const cx = p.x - rp.left + Number(dx) * k + (f.dataset.borda === 'esq' ? meio : 0);
      const cy = p.y - rp.top + Number(dy) * k;

      f.style.setProperty('--e', Math.round(cx) + 'px');
      f.style.setProperty('--t', Math.round(cy) + 'px');
    }
  }

  posicionar();
  window.addEventListener('resize', posicionar);

  // a medida muda quando a fonte real entra no lugar da de fallback
  if (document.fonts) document.fonts.ready.then(posicionar);
  if ('ResizeObserver' in window) new ResizeObserver(posicionar).observe(painel);
})();


/* =========================================================================
   OLHO NO "O" DE SHOW — pisca ao passar o mouse e a pupila acompanha o cursor
   O piscar usa a Web Animations API (element.animate()) em vez de alternar
   uma classe CSS: criar uma animação nova a cada chamada é 100% confiável,
   diferente do truque de "forçar reflow" (offsetWidth), que não funciona
   direito em elementos SVG como o <rect> das pálpebras.
   ========================================================================= */

(function initShowEye(){
  const eyeO     = document.querySelector('.eye-o');
  const showWord = document.querySelector('.show-word');
  if (!eyeO || !showWord) return;

  const eyeLidTop    = eyeO.querySelector('.eye-lid-top');
  const eyeLidBottom = eyeO.querySelector('.eye-lid-bottom');
  const eyeLook      = eyeO.querySelector('.eye-look'); // grupo com íris + pupila + brilho

  if (PREFERE_MENOS_MOVIMENTO) return;

  /* O olho fica no ÚLTIMO painel de um scroll horizontal: durante quase toda a
     página ele está fora da tela. Mesmo assim, antes ele piscava sem parar e
     recalculava a própria posição a cada movimento do mouse. Este observer é
     a chave geral: só liga o olho quando ele realmente aparece. */
  let eyeVisivel = false;
  new IntersectionObserver((entries) => {
    eyeVisivel = entries[0].isIntersecting;
    if (eyeVisivel) medirOlho();
  }, { threshold: 0 }).observe(eyeO);

  /* ---------- Piscar ---------- */
  if (eyeLidTop && eyeLidBottom) {

    // AJUSTE AQUI:
    const BLINK_DURATION_MS = 900;  // quanto tempo dura cada piscada (fechar + abrir)
    const BLINK_REPEAT_MS   = 4000; // intervalo entre uma piscada e a próxima (independe do mouse)

    const blinkKeyframes = [
      { transform: 'scaleY(0)' },
      { transform: 'scaleY(1)', offset: 0.5 },
      { transform: 'scaleY(0)' }
    ];

    function triggerBlink(){
      if (!eyeVisivel || document.hidden) return;   // não gasta quadro à toa
      eyeLidTop.animate(blinkKeyframes, { duration: BLINK_DURATION_MS, easing: 'ease-in-out' });
      eyeLidBottom.animate(blinkKeyframes, { duration: BLINK_DURATION_MS, easing: 'ease-in-out' });
    }

    setInterval(triggerBlink, BLINK_REPEAT_MS);
  }

  /* ---------- Pupila seguindo o cursor (sem sair do olho) ---------- */

  // a posição do olho na tela muda com scroll/resize, não a cada pixel do
  // mouse. Medir uma vez e reaproveitar evita forçar o navegador a recalcular
  // o layout inteiro dezenas de vezes por segundo (o famoso layout thrashing).
  let olhoCx = 0, olhoCy = 0;

  function medirOlho(){
    const rect = eyeO.getBoundingClientRect();
    olhoCx = rect.left + rect.width / 2;
    olhoCy = rect.top  + rect.height / 2;
  }

  window.addEventListener('scroll', () => { if (eyeVisivel) medirOlho(); }, { passive: true });
  window.addEventListener('resize', () => { if (eyeVisivel) medirOlho(); });

  if (eyeLook) {

    // AJUSTE AQUI:
    const MAX_LOOK_OFFSET   = 8;   // deslocamento máximo da pupila, em unidades do SVG (viewBox 0 0 100 100)
    const MAX_LOOK_DISTANCE = 500; // distância do mouse (em px na tela) a partir da qual já usa o deslocamento máximo

    let mouseX = 0, mouseY = 0, olharAgendado = false;

    function aplicarOlhar(){
      olharAgendado = false;

      const dx = mouseX - olhoCx;
      const dy = mouseY - olhoCy;
      const distance = Math.min(Math.hypot(dx, dy), MAX_LOOK_DISTANCE);
      const angle = Math.atan2(dy, dx);
      const ratio = distance / MAX_LOOK_DISTANCE;

      const offsetX = Math.cos(angle) * ratio * MAX_LOOK_OFFSET;
      const offsetY = Math.sin(angle) * ratio * MAX_LOOK_OFFSET;

      eyeLook.style.transform = `translate(${offsetX.toFixed(2)}px, ${offsetY.toFixed(2)}px)`;
    }

    window.addEventListener('mousemove', (e) => {
      if (!eyeVisivel) return;
      mouseX = e.clientX;
      mouseY = e.clientY;

      if (!olharAgendado) {
        olharAgendado = true;
        requestAnimationFrame(aplicarOlhar);
      }
    }, { passive: true });
  }
})();


/* =========================================================================
   STACK — velocidade constante do marquee (px/segundo)
   Como cada linha tem uma quantidade de texto diferente, usar a mesma
   duração (ex: 34s) pra todas fazia cada uma "andar" numa velocidade
   visual diferente. Aqui calculamos a duração de cada linha com base na
   largura real do conteúdo, garantindo que todas rodem na mesma velocidade.
   ========================================================================= */

(function syncStackMarqueeSpeed(){
  const PX_PER_SECOND = 90; // ajuste aqui pra deixar tudo mais rápido ou mais devagar
  const marquees = document.querySelectorAll('.stack-marquee');
  if (!marquees.length) return;

  function applySpeed(){
    marquees.forEach((marquee) => {
      const track = marquee.querySelector('.stack-marquee-track');
      if (!track) return;

      const trackWidth = track.getBoundingClientRect().width;
      const duration = trackWidth / PX_PER_SECOND;

      marquee.querySelectorAll('.stack-marquee-track').forEach((t) => {
        t.style.animationDuration = `${duration}s`;
      });
    });
  }

  /* só o evento `load` não bastava: as fontes (JetBrains Mono / Font Awesome /
     devicon) costumam chegar DEPOIS dele, e é a fonte que define a largura
     real do texto. Medindo cedo demais, a velocidade saía calculada em cima
     da fonte de fallback e cada linha andava num ritmo diferente. */
  window.addEventListener('load', applySpeed);
  window.addEventListener('resize', applySpeed);
  if (document.fonts) document.fonts.ready.then(applySpeed);
  applySpeed();
})();


/* =========================================================================
   "I ANIMATE." — dispara a animação de cada letra ao clicar, e também
   sozinho quando a palavra aparece na tela (esperando 1s antes de começar)
   ========================================================================= */

(function initAnimateLetters(){
  const wordEl = document.querySelector('.word');
  if (!wordEl) return;

  const spans = wordEl.querySelectorAll('span');

  // AJUSTE AQUI:
  const START_DELAY_MS = 100; // espera (em ms) depois que a palavra aparece na tela
  const STAGGER_MS     = 350;  // intervalo entre uma letra e a próxima na sequência inicial

  spans.forEach((span) => {
    span.addEventListener('click', (e) => {
      e.target.classList.add('active');
    });
    span.addEventListener('animationend', (e) => {
      e.target.classList.remove('active');
    });
  });

  let triggered = false;

  function playInitialSequence(){
    spans.forEach((span, idx) => {
      setTimeout(() => {
        span.classList.add('active');
      }, START_DELAY_MS + STAGGER_MS * idx);
    });
  }

  const wordObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && !triggered) {
        triggered = true;
        playInitialSequence();
        wordObserver.disconnect();
      }
    });
  }, { threshold: 0.5 });

  wordObserver.observe(wordEl);
})();

/* =========================================================================
   CONTATO — bio animada (reveal palavra a palavra ao entrar na tela)
   ========================================================================= */

(function initBioReveal(){
  const bioEl = document.querySelector('[data-bio-reveal]');
  if (!bioEl) return;

  const words = bioEl.textContent.trim().split(/\s+/);
  bioEl.textContent = '';

  words.forEach((word, i) => {
    const span = document.createElement('span');
    span.className = 'bio-word';
    span.style.setProperty('--bw-i', i);
    span.textContent = word;
    bioEl.appendChild(span);
    bioEl.appendChild(document.createTextNode(' '));
  });

  if (PREFERE_MENOS_MOVIMENTO) return;   // texto normal, sem desfoque

  /* O texto se revela COM O SCROLL, não de uma vez ao entrar na tela.
     Mesma técnica do jardim: uma animação pausada cujo ponto é escolhido por
     um `animation-delay` negativo. O --prog aqui vem da posição vertical do
     parágrafo — quanto mais ele sobe na tela, mais palavras já saíram do
     desfoque. Rolar de volta desfaz.

     A classe `bio-scrub` só entra agora: é ela que autoriza o CSS a esconder
     as palavras. Se este trecho não rodar, o parágrafo fica legível do jeito
     normal em vez de sumir esperando um --prog que nunca viria. */
  bioEl.classList.add('bio-scrub');

  /* O passo entre uma palavra e a seguinte sai da contagem real, e não de um
     número fixo: assim a última palavra fecha exatamente em --prog 1, sem
     depender de quantas palavras o texto tem. O .22 é a duração da animação
     de cada palavra no CSS — a última precisa COMEÇAR cedo o bastante para
     ainda caber inteira dentro do percurso. */
  const DURACAO_PALAVRA = 0.22;
  const passo = words.length > 1
    ? (1 - DURACAO_PALAVRA) / (words.length - 1)
    : 0;

  /* AS PALAVRAS SÃO MOVIDAS UMA A UMA, PELA WEB ANIMATIONS API.

     A versão anterior punha o percurso num `--prog` e deixava o CSS calcular
     o atraso de cada palavra a partir dele. Funcionava, mas mudar uma
     variável de que 57 elementos dependem obriga o navegador a recalcular o
     estilo dos 57 — todo quadro de scroll. Medi 3,16ms por quadro, de um
     orçamento de 16,7; num celular isso estoura o quadro sozinho, e era a
     seção de contato travando.

     Escrever `currentTime` direto na animação não passa por recálculo de
     estilo nenhum. Mesma animação, mesmos keyframes, mesmo resultado na tela:
     0,055ms por quadro, 98% mais barato.

     A lista é montada uma vez. Se vier vazia (a animação ainda não existe no
     primeiro quadro), tenta de novo — sem ela as palavras ficariam paradas no
     começo, que é justamente o estado invisível. */
  const DUR_MS = DURACAO_PALAVRA * 1000;
  let animacoes = [];

  function pegarAnimacoes(){
    animacoes = Array.from(bioEl.querySelectorAll('.bio-word'))
      .map((w) => w.getAnimations()[0])
      .filter(Boolean);
    animacoes.forEach((a) => a.pause());
    return animacoes.length > 0;
  }

  function posicionarPalavras(p){
    for (let i = 0; i < animacoes.length; i++) {
      const t = (p - i * passo) * 1000;
      animacoes[i].currentTime = t < 0 ? 0 : (t > DUR_MS ? DUR_MS : t);
    }
  }

  let agendado = false;

  function medir(){
    agendado = false;
    const h = window.innerHeight || 1;
    const r = bioEl.getBoundingClientRect();
    const y = window.scrollY || window.pageYOffset || 0;

    // posições de scroll (em coordenadas do documento) onde o efeito começa e
    // onde ele deveria terminar: topo do parágrafo a 88% e a 38% da tela
    const topoDoc = r.top + y;
    const inicio = topoDoc - h * 0.88;
    let fim = topoDoc - h * 0.38;

    /* ESTA SEÇÃO É A ÚLTIMA DA PÁGINA, e é por isso que a conta não pode
       parar aqui. O parágrafo nunca chega a subir até 38% da tela: o scroll
       termina antes, e as últimas palavras ficavam borradas para sempre,
       esperando um --prog que não tinha como acontecer.

       Limitando o fim ao último pixel rolável, o percurso passa a caber no
       que existe de scroll — a leitura fecha junto com a página. */
    const maxScroll = Math.max(
      0, document.documentElement.scrollHeight - h);
    if (fim > maxScroll) fim = maxScroll;

    const curso = fim - inicio;
    let p = curso > 0 ? (y - inicio) / curso : 1;
    p = Math.min(1, Math.max(0, p));

    if (!animacoes.length && !pegarAnimacoes()) return;
    posicionarPalavras(p);
  }

  window.addEventListener('scroll', () => {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(medir);
  }, { passive: true });

  window.addEventListener('resize', medir);

  /* A animação só existe depois que o CSS da .bio-scrub foi aplicado, o que
     não acontece no mesmo instante em que a classe entra. Estas tentativas
     cobrem o intervalo; a partir daí o `medir` cuida sozinho. */
  requestAnimationFrame(() => { pegarAnimacoes(); medir(); });
  setTimeout(() => { pegarAnimacoes(); medir(); }, 400);
  medir();
})();