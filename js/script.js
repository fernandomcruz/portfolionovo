/* =========================================================================
   PREFERÊNCIA DE MOVIMENTO
   Um único ponto de verdade: quem tem "reduzir movimento" ligado no sistema
   recebe a versão estática de tudo (nada de loop infinito, parallax, etc).
   ========================================================================= */

const PREFERE_MENOS_MOVIMENTO =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;


/* =========================================================================
   AGENDA — UM ÚNICO OUVINTE DE SCROLL E UM ÚNICO DE RESIZE

   POR QUE ISTO EXISTE

   Contei o que havia antes, somando este arquivo e o js/efeitos.js:
   NOVE ouvintes de `scroll` e DOZE de `resize`, cada módulo com o seu próprio
   `requestAnimationFrame` e a sua própria trava de agendamento.

   No scroll isso significava até oito callbacks de rAF disputando o mesmo
   quadro, cada um lendo o layout por conta própria. Pior: dois deles nem
   agendavam — rodavam direto no evento, e evento de scroll chega bem mais
   vezes que quadro.

   No resize era mais grave. Nenhum dos doze estava amortecido, e vários fazem
   trabalho pesado (medir texto no canvas, reescrever a altura do trilho
   horizontal, recalcular a velocidade dos marquees). Arrastar a borda da
   janela disparava os doze a cada pixel. E no celular `resize` não é um gesto
   raro: ele dispara toda vez que a barra do navegador some ou volta, ou seja,
   no meio da rolagem.

   Aqui os dois viram um só de cada, coalescido num único quadro. Cada módulo
   continua com a sua função exatamente como estava — muda só quem a chama.

   O `resize` ainda ganha um atraso curto por cima do rAF: redimensionar é uma
   rajada de eventos, e o que interessa é o tamanho final, não os intermediários.
   ========================================================================= */

const Agenda = (() => {
  const noScroll = [];
  const noResize = [];
  let scrollAgendado = false;
  let resizeAgendado = false;
  let resizeTimer = 0;

  let precisaCompactar = false;

  function compactar(){
    precisaCompactar = false;
    for (const lista of [noScroll, noResize]) {
      for (let i = lista.length - 1; i >= 0; i--) if (!lista[i]) lista.splice(i, 1);
    }
  }

  function rodar(lista){
    for (let i = 0; i < lista.length; i++) {
      const fn = lista[i];
      if (!fn) continue;   // vaga aberta por Agenda.parar
      /* um módulo que estoure não pode levar os outros junto: sem este try o
         primeiro erro derrubaria todo o resto do quadro, e o site inteiro
         congelaria em silêncio */
      try { fn(); } catch (e) { console.error(e); }
    }
    if (precisaCompactar) compactar();
  }

  function quadroScroll(){ scrollAgendado = false; rodar(noScroll); }
  function quadroResize(){ resizeAgendado = false; rodar(noResize); }

  window.addEventListener('scroll', () => {
    if (scrollAgendado) return;
    scrollAgendado = true;
    requestAnimationFrame(quadroScroll);
  }, { passive: true });

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (resizeAgendado) return;
      resizeAgendado = true;
      requestAnimationFrame(quadroResize);
    }, 60);
  }, { passive: true });

  return {
    /* fn roda uma vez por quadro em que houve scroll, na ordem de registro */
    scroll(fn){ noScroll.push(fn); return fn; },
    resize(fn){ noResize.push(fn); return fn; },

    /* Tira uma função das duas listas. Um efeito de ENTRADA só precisa ser
       conferido até acontecer; sem isto ele seguiria sendo chamado — pra não
       fazer nada — em todo quadro de scroll pelo resto da visita.

       A vaga é aberta com `null` em vez de removida na hora porque `parar`
       quase sempre é chamado de DENTRO do `rodar`: mexer no array no meio da
       varredura pularia a função seguinte. A limpeza vem no fim do quadro. */
    parar(fn){
      for (const lista of [noScroll, noResize]) {
        const i = lista.indexOf(fn);
        if (i >= 0) { lista[i] = null; precisaCompactar = true; }
      }
    }
  };
})();

window.Agenda = Agenda;   // o js/efeitos.js usa a mesma agenda


/* =========================================================================
   VIEWPORT — "ISTO ESTÁ MESMO NA TELA?"

   POR QUE ISTO EXISTE

   Cada efeito de entrada tinha o seu próprio jeito de decidir a hora de
   começar, e vários decidiam com um IntersectionObserver — quer dizer, com um
   `threshold`. Dois problemas, os dois piores no celular:

     · O observer mede contra o viewport de LAYOUT, que inclui a faixa atrás
       das barras do navegador. No telefone essa faixa não é pequena, e um
       elemento "35% dentro da janela" pode estar 35% dentro de uma região que
       a barra de baixo cobre. O elemento satisfaz a conta sem estar à vista.

     · Onde havia as DUAS coisas — um threshold e uma conferência por
       geometria — elas discordavam, e quem ganhava era sempre a mais frouxa.
       No block reveal o observer soltava com 0.35 e revelava direto, então a
       regra de 0.95 logo abaixo nunca chegava a ser consultada. A varredura
       da barra (0,78s a 1,05s) corria inteira embaixo da dobra: quem descia
       encontrava o título já pronto.

   A saída não é afrouxar nem apertar cronômetro nenhum: é ter UMA régua só, e
   fazer todo caminho passar por ela. O observer continua — mas rebaixado a
   avisador barato ("a geometria mudou, confere aí"), sem direito a decidir.
   ========================================================================= */

const Viewport = (() => {

  /* A ÁREA QUE A PESSOA ENXERGA DE FATO.

     `innerHeight` conta a tela inteira, barras do navegador incluídas.
     `visualViewport` é a medida que exclui essas barras e ainda acompanha o
     zoom por pinça. O `offsetTop`/`offsetLeft` traz as duas para o mesmo
     referencial do getBoundingClientRect, que é o viewport de layout. */
  function area(){
    const vv = window.visualViewport;
    if (!vv) {
      return { top: 0, left: 0,
               altura: window.innerHeight || 1, largura: window.innerWidth || 1 };
    }
    return { top: vv.offsetTop, left: vv.offsetLeft,
             altura: vv.height || 1, largura: vv.width || 1 };
  }

  /* QUE FRAÇÃO DO ELEMENTO ESTÁ DENTRO DESSA ÁREA.

     Não é "o topo já passou de tantos por cento da tela?" — essa pergunta não
     distingue um título baixo de um bloco alto com o mesmo topo, que estão em
     situações completamente diferentes. É quanto do elemento apareceu.

     Elemento maior que a tela nunca chegaria a 90% visível, então nesse caso
     a conta passa a ser sobre a faixa visível e não sobre ele.

     O eixo horizontal é OPCIONAL, e de propósito. Para a página que rola pra
     baixo ele daria 1 sempre (nada está fora da tela pros lados) e só custaria
     duas contas por chamada. Mas dentro do scroll horizontal os painéis são
     empurrados pro lado por um transform, e ali a vertical sozinha diria "está
     na tela" com o painel ainda inteiro fora, à direita. Quem mora lá pede o
     eixo; o resto não paga por ele.

     ATENÇÃO ao ligar `horizontal` num elemento cujo estado escondido é um
     translate lateral (as bandeiras do .idioma, por exemplo): o rect já vem
     deslocado, a fração daria zero para sempre e o efeito nunca aconteceria. */
  function fracaoVisivel(el, horizontal){
    const r = el.getBoundingClientRect();
    if (r.height <= 0 || r.width <= 0) return 0;

    const a = area();

    const dentroY = Math.min(r.bottom, a.top + a.altura) - Math.max(r.top, a.top);
    if (dentroY <= 0) return 0;

    const fracao = dentroY / Math.min(r.height, a.altura);
    if (!horizontal) return fracao;

    const dentroX = Math.min(r.right, a.left + a.largura) - Math.max(r.left, a.left);
    if (dentroX <= 0) return 0;

    return fracao * (dentroX / Math.min(r.width, a.largura));
  }

  /* JÁ SUBIU ACIMA DA TELA — foi passado sem ser visto.

     Isto é o que substitui os cronômetros cegos que existiam aqui. Um efeito
     que esconde conteúdo não pode deixá-lo escondido para sempre, e a garantia
     disso era um setTimeout. Só que tempo não sabe onde a pessoa está: a stack
     fica no fim de uma página de quase 7000px, ninguém chega lá em trinta
     segundos, e o cronômetro revelava tudo sozinho lá embaixo — quem descia
     encontrava o efeito já feito e concluía, com razão, que ele não existia.

     Posição sabe. Se o elemento ficou para trás, revela na hora; se não
     ficou, ninguém tem pressa. */
  function jaPassou(el){
    return el.getBoundingClientRect().bottom <= area().top;
  }

  /* Um conjunto generoso de limiares: o observer avisa a cada faixa cruzada,
     então a régua é consultada várias vezes durante a entrada em vez de uma
     só. Ele não decide nada com esses números — só acorda. */
  const LIMIARES = [0, 0.25, 0.5, 0.75, 0.9, 0.95, 1];

  /* CHAMA `entrou(el)` UMA VEZ POR ELEMENTO, no primeiro instante em que ele
     está de verdade dentro da área visível.

     Quatro caminhos independentes alimentam a MESMA conta — observer, scroll,
     resize e os dois momentos em que o layout ainda se mexe (o `load` e a
     troca de fontes). Nenhum deles tem critério próprio, então não há como um
     disparar antes do outro: ou a régua aprova, ou nada acontece.

     Os dois momentos de layout entram no lugar dos `setTimeout(conferir, 1200)`
     que cada módulo tinha. São o mesmo cuidado — "a posição de agora ainda vai
     mudar" — só que ancorados no evento real em vez de num palpite de
     milissegundos que acerta ou erra conforme a conexão.

     opcoes.fracao      quanto do elemento precisa estar visível (0 a 1)
     opcoes.horizontal  considerar também o eixo X (só o scroll horizontal)
     opcoes.resgatar    revelar quem já passou da tela; ligado por padrão.
                        Desligue quando o efeito não esconde nada — aí não há
                        conteúdo em risco, e disparar fora da tela é só gastar
                        uma animação que ninguém vai ver. */
  function aoEntrar(elementos, opcoes, entrou){
    const restantes = new Set(elementos);
    if (!restantes.size) return null;

    const fracao     = opcoes.fracao;
    const horizontal = opcoes.horizontal === true;
    const resgatar   = opcoes.resgatar !== false;
    let io = null;

    function chegou(el){
      if (resgatar && jaPassou(el)) return true;
      return fracaoVisivel(el, horizontal) >= fracao;
    }

    function conferir(){
      if (!restantes.size) return;

      for (const el of restantes) {
        if (!chegou(el)) continue;
        restantes.delete(el);          // apagar o item corrente durante o
        if (io) io.unobserve(el);      // for..of de um Set é seguro
        entrou(el);
      }

      // nada mais a esperar: desliga tudo em vez de seguir conferindo à toa
      if (restantes.size) return;
      if (io) { io.disconnect(); io = null; }
      Agenda.parar(conferir);
    }

    Agenda.scroll(conferir);
    Agenda.resize(conferir);
    window.addEventListener('load', conferir, { once: true });
    if (document.fonts) document.fonts.ready.then(conferir);

    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(conferir, { threshold: LIMIARES });
      restantes.forEach((el) => io.observe(el));
    } else {
      /* Sem observer o scroll e o resize já cobrem o percurso; esta chamada é
         só pro elemento que já nasce na tela. */
      conferir();
    }

    return conferir;
  }

  return { area, fracaoVisivel, jaPassou, aoEntrar };
})();

window.Viewport = Viewport;   // o js/efeitos.js usa a mesma régua


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

/* O AQUECIMENTO AUTOMÁTICO TEM UMA CONDIÇÃO AGORA.

   As oito fotos são 249 KB (eram 829 KB antes de virarem WebP do tamanho
   certo). Baixá-las sozinho, para um menu que a pessoa talvez nem abra, é
   barato numa rede boa e caro numa ruim — e em plano limitado é gastar dado
   de alguém sem ele ter pedido.

   Quem sinaliza isso é a Network Information API: `saveData` quando o
   aparelho está em economia de dados, e `effectiveType` quando a conexão é
   lenta. Nesses casos o aquecimento automático simplesmente não acontece.

   Isto NÃO desliga o efeito: os gatilhos de intenção (o dedo encostando no
   botão, o mouse chegando perto, o foco pelo teclado) continuam valendo, e o
   próprio `openMenu` carrega como rede de segurança. Quem abre o menu vê as
   fotos do mesmo jeito — só quem nunca abre é que deixa de pagar por elas. */
function conexaoPedeEconomia(){
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return false;                                  // sem informação: segue o padrão
  if (c.saveData) return true;
  return /(^|-)(2g|slow-2g)$/.test(c.effectiveType || '');
}

// depois que a página terminou de carregar, sem pressa: se ninguém encostou no
// menu até aqui, as fotos entram na fila sem disputar nada
window.addEventListener('load', () => {
  if (conexaoPedeEconomia()) return;
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
  /* O piso de 0,55 é o que dá presença à onda no celular.

     Só a rampa `width/1200` deixava a amplitude em 32% numa tela de 390px —
     a curva ficava mansa demais, quase um vinco. O piso segura a altura
     mínima e a rampa continua valendo acima de 660px, onde ela já passa de
     0,55: as duas se encontram nesse ponto, então não há degrau.

     De 1200px pra cima o fator é 1 e o desktop é exatamente o que já era. */
  const fator = Math.max(0.55, Math.min(1, width / 1200));
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
let tentativasDaOnda = 0;

function desenharWaveCap(){
  const vw = window.innerWidth;

  /* LARGURA ZERO NÃO SE DESENHA — e sem esta linha ela não falha em silêncio,
     ela envenena o path.

     Em `buildCapWavePath` o ângulo sai de `x / width`, e x vale
     `(i / segments) * width`. Com width 0 isso é 0/0, ou seja NaN, e o NaN
     atravessa tudo: `Math.sin(NaN)` é NaN, `0 * NaN` é NaN. O `d` do <path>
     terminava com "L0.0,NaN" e o navegador rejeitava o atributo inteiro —
     erro no console e onda nenhuma na tela.

     Vale notar por que o clamp do `progress` não segurava isso: `Math.max(0,
     NaN)` devolve NaN, não 0. Clamp não sanitiza NaN, e é fácil supor que sim.

     Uma janela real nunca tem largura 0. Mas a primeira chamada acontece na
     execução do script, antes da primeira pintura, e existe contexto (iframe
     recém-criado, aba ainda não composta) em que a medida ainda não chegou.

     Sair fora não basta, porém: se as primeiras chamadas caírem todas aqui, e
     a pessoa não rolar nem redimensionar, ninguém mais desenha e a faixa fica
     vazia. Por isso a guarda REAGENDA em vez de só desistir — no próximo
     quadro a medida já existe. O teto de tentativas evita transformar isso num
     laço eterno num contexto que nunca vai ter largura. */
  if (!vw) {
    if (tentativasDaOnda++ < 30) requestAnimationFrame(desenharWaveCap);
    return;
  }
  tentativasDaOnda = 0;

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

/* A trava `waveAgendado` que existia aqui saiu: quem coalesce agora é a
   Agenda, que já entrega no máximo uma passada por quadro. */
Agenda.scroll(desenharWaveCap);
Agenda.resize(() => {
  TRIGGER_START = window.innerHeight;
  lastWaveKey = '';               // força o redesenho na nova largura
  desenharWaveCap();
});
desenharWaveCap();

/* Rede de segurança para o caso acima: se a primeira chamada caiu na guarda de
   largura zero, ninguém mais desenharia até a pessoa rolar ou redimensionar.
   Uma passada no `load`, com a medida já boa, fecha esse buraco. */
window.addEventListener('load', () => {
  TRIGGER_START = window.innerHeight;
  lastWaveKey = '';
  desenharWaveCap();
}, { once: true });


/* =========================================================================
   SOBRE — scroll horizontal pinado (hs-outer / hs-track)
   ========================================================================= */

const hsOuter = document.getElementById('hsOuter');
const hsTrack = document.getElementById('hsTrack');
// conta só os painéis: o trilho tem também o SVG da linha desenhada
const hsPanelCount = hsTrack.querySelectorAll(':scope > .hs-panel').length;

let hsCurrent = 0;
let hsTarget = 0;
/* quanto o trilho anda do começo ao fim, em px — é o que transforma a posição
   atual em progresso de 0 a 1 pra linha */
let hsPercurso = 0;
let hsTicking = false;

const EXTRA_PIN_VH = 0.2; // nº de telas extras de pausa antes do .stack começar a subir — ajuste aqui

/* =========================================================================
   LINHA DESENHADA PELO SCROLL

   Um traço único atravessando os cinco painéis do scroll horizontal, que vai
   sendo desenhado conforme eles passam.

   ---------------------------------------------------------------------
   COMO ESTÁ ORGANIZADO
   ---------------------------------------------------------------------
     AJUSTES        todos os números que valem a pena mexer, num lugar só
     GEOMETRIA      os pontos por onde o traço passa (a composição)
     TRAÇADO        os pontos viram uma curva suave (Catmull-Rom → Bézier)
     MONTAGEM       cria o SVG uma vez; recalcula só no resize
     DESENHO        o quadro: uma escrita, nada mais

   ---------------------------------------------------------------------
   AS TRÊS DECISÕES QUE SUSTENTAM ISTO
   ---------------------------------------------------------------------
   1. UMA UNIDADE SÓ (U) NOS DOIS EIXOS.
      Escrever x em larguras de painel e y em alturas parece prático e é
      justamente o defeito: o painel muda de formato entre telas (1440x900 num
      monitor, 390x844 num celular), então um passo na vertical não vale o
      mesmo que um na horizontal e a MESMA descrição gera desenhos diferentes.
      Círculo vira elipse, arco manso vira espeto. Aqui todo GESTO é medido em
      múltiplos de U; só a POSIÇÃO de cada gesto vem da largura do painel,
      porque é o que faz o traço acompanhar a seção.

   2. A COMPOSIÇÃO É UMA LISTA DE PONTOS, NÃO UMA LISTA DE CURVAS.
      Os pontos viram curva por Catmull-Rom, que garante tangente contínua nas
      emendas — é isso que faz a linha parecer um traço só, contínuo, em vez
      de trechos costurados. E editar a composição passa a ser mover pontos.

   3. QUEM MOVE O PONTEIRO É A WEB ANIMATIONS API.
      O desenho é um `stroke-dashoffset` animado em CSS, pausado, e o quadro
      só escreve `currentTime`. Não passa por recálculo de estilo. Medido:
      0,059ms por quadro. Não há ouvinte de scroll nem requestAnimationFrame
      próprios — ele pega carona no ciclo que já move o trilho, que é o único
      jeito de garantir que a linha e os painéis nunca saiam de sincronia.

   Sem JS, este arquivo não roda e o SVG nem chega a existir: a seção continua
   inteira e funcional. A linha é enfeite, não estrutura.
   ========================================================================= */

const LINHA = {
  /* ---- composição ---- */
  // os dois pontos de adaptação. Poucos de propósito: dentro de cada
  // categoria a geometria responde sozinha, porque as coordenadas são
  // frações do painel
  pontoCelular: 768,
  pontoDesktop: 1180,
  // o quanto a composição ocupa da altura do painel. 1 = como foi desenhada;
  // abaixo disso ela se recolhe em direção ao meio, sem mudar de forma
  amplitude: 1,

  /* ---- traço ---- */
  espessuraMin: 10,
  espessuraMax: 30,
  espessuraDivisor: 34,   // largura da tela / isto = espessura desejada
  opacidade: 0.85,

  /* ---- curva ---- */
  // 0 = quinas; 0.5 = Catmull-Rom clássico; acima disso começa a inchar
  tensao: 0.5,

  /* ---- entrada e saída ---- */
  comecaEm: -0.18,   // em larguras de painel, antes da borda esquerda


  /* ---- resize ---- */
  // variação de altura menor que isto não remonta nada: é a barra do
  // navegador do celular aparecendo e sumindo, não uma tela nova
  toleranciaDeAltura: 0.18
};


/* =========================================================================
   GEOMETRIA — a composição

   O QUE MUDOU E POR QUÊ

   A versão anterior mantinha o traço inteiro numa faixa entre 0,59 e 0,90 da
   altura — 31% do painel, sempre abaixo das palavras. Por mais curva que
   tivesse, lia como uma linha horizontal, porque nunca mudava de região.

   Medindo o painel, o texto ocupa de 0,34 a 0,66 da altura. Sobram DUAS
   faixas livres, uma acima e outra abaixo, com cerca de um terço da altura
   cada. A composição agora usa as duas e atravessa entre elas em pontos
   escolhidos — passando POR TRÁS das palavras, já que o SVG está em z-index 0
   e o texto em 1. Isso triplica a altura ocupada e é o que transforma o traço
   de "atravessa a página" em "percorre a página".

   AS TRÊS COMPOSIÇÕES

   Os pontos são normalizados: x em larguras de painel (0 a 5), y em frações
   da altura (0 = topo, 1 = base). Não há escala nem `transform` envolvidos —
   cada composição é desenhada para o formato do painel dela:

     · CELULAR   painel em pé (390x844, formato 0,46). Os mesmos 0,6 de
                 largura valem 234px, e 0,6 de altura valem 506px: o gesto
                 sai naturalmente íngreme. A composição aproveita isso com
                 subidas e mergulhos quase verticais.
     · TABLET    formato intermediário. Gestos mais largos que no celular,
                 menos extremos que no desktop.
     · DESKTOP   painel deitado (1440x900, formato 1,60). Aqui a mesma
                 subida vira uma diagonal ampla, que é o que o espaço pede.

   Mesma direção artística nos três — sobe, plana no alto, mergulha, estica
   embaixo, sobe de novo, desce em diagonal — com o ritmo recalibrado para o
   espaço de cada um. Nenhuma é a outra reduzida.

   As alturas ficam entre 0,10 e 0,92 e nunca encostam nas bordas.
   ========================================================================= */

const COMPOSICOES = {
  /* CELULAR — uma travessia inteira por painel.

     A chave está em lembrar o que a pessoa vê: no celular o trilho mostra UM
     painel de cada vez, uma tela cheia. Então o gesto tem que caber num
     painel e valer por si — se a composição espalha uma curva por dois
     painéis, cada tela recebe metade de um movimento e é isso que lê como
     "linha passando", não como linha percorrendo.

     Aqui cada painel recebe UMA travessia de altura quase inteira, com
     inclinação e feitio próprios. Nenhum trecho plano, nenhum platô: a linha
     está sempre em trânsito, e muda de caráter a cada tela.

       painel 0  diagonal longa subindo da base até o topo
       painel 1  mergulho, mais reto e mais rápido que a subida anterior
       painel 2  um degrau curto embaixo e então a subida mais íngreme de todas
       painel 3  descida em S, com a curva se abrindo no meio do caminho
       painel 4  sobe de volta e MERGULHA até a base na saída

     O mergulho final não é enfeite: a versão anterior subia e parava em
     0,44 — no meio da tela — e o traço terminava no ar, como se tivesse sido
     cortado. Ele agora fecha na base, junto com a borda direita, do mesmo
     jeito que o desktop faz.

     E termina em x exatamente 5,00, nem um triz além. Passar da borda parece
     inofensivo — o que está depois de 5,00 nunca chega a ser visto —, mas
     desalinha a ponta do lápis: a janela visível não passa de 5,00, então o
     traço precisaria correr um trecho que a tela nunca alcança, e os últimos
     instantes voltariam a se desenhar fora do campo de visão.

     As alturas ficam entre 0,08 e 0,92: nunca encostam nas bordas. A travessia
     da faixa das palavras (0,34 a 0,66) acontece uma vez por painel, por trás
     do texto, que é o que costura a linha ao conteúdo. */
  celular: [
    [-0.08, 0.92], [0.30, 0.86], [0.62, 0.52], [0.90, 0.16],
    [1.16, 0.08], [1.44, 0.22], [1.72, 0.60], [1.96, 0.90],
    [2.16, 0.92], [2.38, 0.78], [2.56, 0.86], [2.82, 0.52], [2.98, 0.20],
    [3.24, 0.10], [3.52, 0.28], [3.70, 0.56], [3.94, 0.88],
    [4.18, 0.92], [4.40, 0.62], [4.56, 0.34], [4.74, 0.26], [4.90, 0.54], [5.00, 0.90]
  ],

  /* Tablet: o mesmo percurso, com as transições mais espalhadas na
     horizontal — o painel é menos alto em proporção. */
  tablet: [
    [-0.12, 0.88], [0.28, 0.76], [0.58, 0.42], [0.92, 0.16],
    [1.30, 0.12], [1.66, 0.28], [1.96, 0.62], [2.28, 0.86],
    [2.66, 0.90], [3.00, 0.80], [3.26, 0.48], [3.54, 0.16],
    [3.88, 0.12], [4.22, 0.38], [4.56, 0.70], [4.84, 0.88],
    [5.00, 0.84]
  ],

  /* Desktop: diagonais amplas. As travessias da faixa do texto são poucas e
     escolhidas — uma por painel e meio —, e entre elas o traço tem trechos
     de descanso: o platô alto no painel 1 e a esticada baixa no painel 2,
     que é o espaço negativo da composição. */
  desktop: [
    [-0.15, 0.86], [0.30, 0.78], [0.62, 0.46], [0.95, 0.18],
    [1.35, 0.12], [1.72, 0.22], [2.02, 0.52], [2.32, 0.82],
    [2.70, 0.90], [3.05, 0.86], [3.30, 0.58], [3.55, 0.20],
    [3.90, 0.10], [4.20, 0.30], [4.50, 0.62], [4.80, 0.84],
    [5.00, 0.90]
  ]
};

/* Poucos pontos de adaptação, e escolhidos pelo FORMATO do painel e não só
   pela largura: é a proporção que decide se um gesto sai íngreme ou deitado,
   e é ela que um tablet deitado e um monitor têm em comum. */
function linhaComposicao(W, H){
  const formato = W / H;
  if (W < LINHA.pontoCelular || formato < 0.72) return COMPOSICOES.celular;
  if (W < LINHA.pontoDesktop || formato < 1.25) return COMPOSICOES.tablet;
  return COMPOSICOES.desktop;
}


/* =========================================================================
   TRAÇADO — pontos viram curva

   Catmull-Rom passa POR todos os pontos (diferente de Bézier, onde os pontos
   de controle ficam fora da curva) e entrega tangente contínua nas emendas.
   Na prática: eu movo um ponto, a curva inteira se reacomoda sozinha e
   continua suave. É o que permite editar a composição sem recalcular
   controles à mão.

   A conversão para Bézier cúbica é a fórmula padrão; a tensão controla o
   quanto a curva "abre" nas passagens.
   ========================================================================= */

function linhaCaminho(pontos, tensao){
  if (pontos.length < 2) return '';

  const n = (i) => pontos[Math.max(0, Math.min(pontos.length - 1, i))];
  const f = (v) => v.toFixed(1);
  const partes = [`M${f(pontos[0][0])},${f(pontos[0][1])}`];

  for (let i = 0; i < pontos.length - 1; i++) {
    const p0 = n(i - 1), p1 = n(i), p2 = n(i + 1), p3 = n(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6 * tensao * 2;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6 * tensao * 2;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6 * tensao * 2;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6 * tensao * 2;
    partes.push(` C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2[0])},${f(p2[1])}`);
  }
  return partes.join('');
}


/* =========================================================================
   MONTAGEM
   ========================================================================= */

let hsLinhaRetentativa = 0;

const hsLinha = (() => {
  if (!hsTrack) return null;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'hs-linha');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'none');
  const path = document.createElementNS(NS, 'path');
  svg.appendChild(path);
  hsTrack.insertBefore(svg, hsTrack.firstChild);
  return { svg, path, anim: null, larguraMedida: 0, alturaMedida: 0, prog: 0 };
})();

function hsLinhaLayout(){
  if (!hsLinha) return;

  const W = window.innerWidth || 0;
  const H = hsTrack.getBoundingClientRect().height || window.innerHeight || 0;

  /* MEDIDA DEGENERADA NÃO VIRA DESENHO.

     Aqui havia `|| 1` nos dois valores, o que parecia uma proteção e era o
     contrário: quando a janela reportava 0 — aba em segundo plano, momento
     do carregamento, ancestral ainda sem caixa —, o caminho era construído
     num painel de 1x1 pixel. Vi isso acontecer: o viewBox saiu "0 0 5 1" e a
     linha inteira coube em 8 pixels de comprimento.

     Pior que o erro em si, o guarda de resize logo abaixo guardava essa
     medida como boa e não remontava mais. Um instante ruim no carregamento
     deixava a linha quebrada para sempre.

     Agora medida inválida não é aceita: nada é construído e uma nova tentativa
     é agendada. Enquanto isso a linha fica sem a classe que a esconde, ou
     seja, visível e inteira — que é o estado seguro. */
  if (W < 2 || H < 2) {
    clearTimeout(hsLinhaRetentativa);
    hsLinhaRetentativa = setTimeout(hsLinhaLayout, 250);
    return;
  }

  /* Só remonta quando muda o que importa. A largura sempre importa; a altura
     só quando muda de verdade, porque no celular a barra do navegador some e
     volta o tempo todo e cada uma dessas mexidas dispara um resize. Remontar
     ali reiniciaria o desenho no meio da rolagem — o pulo que a pessoa vê. */
  const mudouLargura = W !== hsLinha.larguraMedida;
  const mudouAltura = hsLinha.alturaMedida > 0 &&
    Math.abs(H - hsLinha.alturaMedida) / hsLinha.alturaMedida > LINHA.toleranciaDeAltura;
  if (!mudouLargura && !mudouAltura && hsLinha.anim) return;

  hsLinha.larguraMedida = W;
  hsLinha.alturaMedida = H;

  /* As coordenadas já vêm normalizadas: x em larguras de painel, y em frações
     da altura. Converter é multiplicar — não há escala, nem viewBox esticado,
     nem transform. Cada composição foi desenhada no formato em que vai ser
     usada, então o que chega aqui já está certo para esta tela.

     A `amplitude` recolhe o desenho em direção ao meio vertical sem mudar a
     forma dele, e existe só como ajuste fino: em 1 vale o que foi desenhado. */
  const meio = 0.5;
  const emPixels = linhaComposicao(W, H).map(([x, y]) => [
    x * W,
    (meio + (y - meio) * LINHA.amplitude) * H
  ]);
  hsLinha.path.setAttribute('d', linhaCaminho(emPixels, LINHA.tensao));
  hsLinha.svg.setAttribute('viewBox', `0 0 ${W * hsPanelCount} ${H}`);

  const traco = Math.max(LINHA.espessuraMin,
                Math.min(LINHA.espessuraMax, W / LINHA.espessuraDivisor));
  hsLinha.svg.style.setProperty('--traco', traco.toFixed(2) + 'px');
  hsLinha.svg.style.setProperty('--opacidade', String(LINHA.opacidade));
  const comprimento = hsLinha.path.getTotalLength();
  hsLinha.svg.style.setProperty('--comprimento', comprimento.toFixed(0));

  /* TABELA DE X POR COMPRIMENTO — montada aqui, usada no quadro.

     O desenho anda por comprimento de arco; a tela anda por X. Os dois não
     são proporcionais: onde o traço sobe quase na vertical ele gasta muito
     comprimento sem avançar quase nada em X. Medi o efeito disso: até 70% do
     percurso a ponta do lápis estava dentro da janela visível, mas a partir
     dos 80% ela disparava na frente — a janela mostrava de 3,20 a 4,20 e a
     ponta já estava em 4,37. Da metade do "I ANIMATE" em diante você via a
     linha pronta em vez de vê-la sendo feita.

     Com esta tabela dá pra fazer o caminho inverso: sei onde a ponta precisa
     estar em X e descubro que fração do comprimento corresponde. O X é
     forçado a crescer (Math.max) porque a curva pode recuar um triz nas
     viradas, e sem isso a busca ficaria ambígua.

     São 256 amostras, medidas uma vez por layout. */
  const N = 256;
  const tabela = new Float32Array(N + 1);
  let maiorX = -Infinity;
  for (let i = 0; i <= N; i++) {
    const pt = hsLinha.path.getPointAtLength(comprimento * i / N);
    maiorX = Math.max(maiorX, pt.x);
    tabela[i] = maiorX;
  }
  hsLinha.tabelaX = tabela;
  hsLinha.xInicial = tabela[0];
  hsLinha.xFinal = tabela[N];
  hsLinha.larguraPainel = W;

  /* A classe é o que autoriza esconder o traço, e entra só aqui, com o
     caminho já pronto. Sem este trecho a linha nasce inteira e visível — o
     estado seguro. */
  hsLinha.svg.classList.add('linha-viva');

  if (PREFERE_MENOS_MOVIMENTO) { hsLinha.anim = null; return; }

  hsLinha.anim = hsLinha.path.getAnimations()[0] || null;
  if (hsLinha.anim) {
    hsLinha.anim.pause();
    // devolve o desenho ao ponto em que estava: sem isto, todo resize (e toda
    // mexida na barra do navegador) apagaria a linha e recomeçaria do zero
    hsLinhaDesenhar(hsLinha.prog);
  }
}


/* =========================================================================
   DESENHO — o quadro

   `prog` é o mesmo 0..1 que move o trilho, então a linha e os painéis são
   comandados pelo mesmo número e não têm como dessincronizar. A animação dura
   1s de propósito: o progresso vira milissegundos direto, sem conta.
   ========================================================================= */

/* Acha a fração do comprimento cuja ponta está em `alvoX`. Busca binária em
   256 valores: oito comparações, sem tocar no DOM nem no layout. */
function hsLinhaFracaoEm(alvoX){
  const t = hsLinha.tabelaX;
  if (!t) return 0;
  const ultimo = t.length - 1;
  if (alvoX <= t[0]) return 0;
  if (alvoX >= t[ultimo]) return 1;
  let lo = 0, hi = ultimo;
  while (hi - lo > 1) {
    const meio = (lo + hi) >> 1;
    if (t[meio] <= alvoX) lo = meio; else hi = meio;
  }
  // interpola entre as duas amostras, pra não andar aos degraus
  const faixa = t[hi] - t[lo];
  const dentro = faixa > 0 ? (alvoX - t[lo]) / faixa : 0;
  return (lo + dentro) / ultimo;
}

function hsLinhaDesenhar(prog){
  if (!hsLinha) return;
  hsLinha.prog = prog;
  if (!hsLinha.anim || !hsLinha.tabelaX) return;

  /* A PONTA DO LÁPIS ANDA EM X, não em comprimento de traço.

     Ela vai do COMEÇO DO CAMINHO até o fim dele, proporcional ao progresso.
     Começar no começo é o que faz o traço entrar pela lateral: em prog 0 nada
     está desenhado e a linha nasce da borda esquerda, fora da tela.

     Cheguei a pôr a ponta num ponto fixo da janela visível (62% da largura),
     achando que garantia visibilidade. Garantia, e ao preço de estragar a
     entrada: 62% do primeiro painel já nascia pronto, e a linha começava no
     meio da tela em vez de vir da lateral.

     Não era necessário. Fazendo a conta: a janela cobre de 4·prog a
     4·prog+1 painéis, e a ponta vai de -0,08 a 5,00. A ponta só fica à
     esquerda da janela enquanto prog < 0,074 — ou seja, durante os primeiros
     7% ela está entrando pela borda — e daí até o fim ela está sempre dentro
     do campo de visão. Os dois objetivos ao mesmo tempo, sem truque. */
  const alvoX = hsLinha.xInicial + (hsLinha.xFinal - hsLinha.xInicial) * prog;

  const t = hsLinhaFracaoEm(alvoX) * 1000;
  hsLinha.anim.currentTime = t < 0 ? 0 : (t > 1000 ? 1000 : t);
}

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

/* A altura é GUARDADA, e não lida de volta do elemento. Antes o hsUpdate
   perguntava `hsOuter.offsetHeight` a cada quadro de scroll — e offsetHeight
   é leitura de layout, das que obrigam o navegador a recalcular. O número já
   é conhecido aqui, no instante em que o escrevemos; perguntar de volta era
   pagar por uma informação que já estava na mão. */
let hsAltura = 0;

function hsLayout(){
  hsLinhaLayout();   // o caminho é remontado junto com o layout do trilho

  const H = window.innerHeight;
  const percurso = (hsPanelCount - 1) * window.innerWidth;
  const rolagemHorizontal = percurso / VELOCIDADE_PAINEL;

  // + 1 tela de pin padrão + EXTRA_PIN_VH telas de pausa + a própria tela presa
  hsAltura = Math.round(rolagemHorizontal + H * (1 + EXTRA_PIN_VH) + H);
  hsOuter.style.height = hsAltura + 'px';
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
/* A POSIÇÃO DO PAINEL É CALCULADA, NÃO MEDIDA — e é aqui que estava o pior
   engarrafamento da página.

   O `hsRender` faz duas coisas em sequência: ESCREVE o transform do trilho e
   logo em seguida chamava esta função, que MEDIA `getBoundingClientRect()` dos
   painéis. Ler o layout depois de escrever nele é o gatilho clássico do
   "forced synchronous layout": o navegador é obrigado a parar tudo e
   recalcular a página inteira ali mesmo, antes de devolver o número. E não
   era uma vez por quadro — o lerp chama o hsRender de novo enquanto o trilho
   não assenta, então na cauda de cada rolagem isso se repetia.

   Só que a posição dos painéis não precisa ser perguntada ao navegador: ela é
   uma conta de uma linha. Os painéis são irmãos de larguras iguais dentro de
   um flex sem espaçamento, e o trilho anda só na horizontal:

       esquerda do painel i = borda do trilho + i * largura - deslocamento

   A borda e a largura só mudam quando a janela muda de tamanho, então são
   medidas uma vez por resize (em `medirGeometriaDoTrilho`) e reaproveitadas.
   O deslocamento é o `hsCurrent`, que já está na mão — é justamente o número
   que acabamos de escrever.

   Resultado: escrita e leitura deixam de se atropelar, e o quadro do scroll
   horizontal não força mais nenhum recálculo de layout. */
/* O índice é contado entre os PAINÉIS, não entre os filhos do trilho.

   A diferença não é cosmética: o trilho tem outro filho além dos painéis — o
   SVG da linha desenhada, que é absoluto e cobre o trilho inteiro. Contando
   por `children`, ele virava o "painel 0", empurrava todos os índices em um e
   a conta da posição saía inteira errada. O sintoma foi o "I DEVELOP" parar
   de aparecer: com a posição errada, o painel era considerado fora da tela e
   nunca recebia o --prog que revela as letras. */
const paineisDoTrilho = Array.from(hsTrack.querySelectorAll(':scope > .hs-panel'));

const paineisComProgresso = Array.from(document.querySelectorAll('[data-progresso]'))
  .map((el) => ({ el, idx: paineisDoTrilho.indexOf(el) }))
  .filter((p) => p.idx >= 0);

let trilhoEsquerda = 0;      // borda esquerda do trilho, sem o transform
let trilhoLarguraPainel = 0; // largura de um painel

function medirGeometriaDoTrilho(){
  const r = hsTrack.getBoundingClientRect();
  // o trilho está deslocado de -hsCurrent; somando de volta, temos a borda "parada"
  trilhoEsquerda = r.left + hsCurrent;

  /* Mede um PAINEL, não o primeiro filho qualquer: o SVG da linha também é
     filho do trilho e tem a largura do trilho inteiro. Medindo ele, a
     "largura de um painel" saía cinco vezes maior. */
  const primeiro = paineisDoTrilho[0];
  trilhoLarguraPainel = primeiro
    ? primeiro.getBoundingClientRect().width
    : (window.innerWidth || 1);
}

function atualizarProgressoPaineis(){
  if (!paineisComProgresso.length) return;
  if (!trilhoLarguraPainel) medirGeometriaDoTrilho();

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
     se espalha por mais caminho.

     A RÉGUA, para quem for calibrar --ini/--dur no HTML: com PERCURSO 1.35, a
     fração do painel que já entrou na tela é 1,35 x prog. Ou seja

         prog .20 -> 27% do painel visível
         prog .40 -> 54%
         prog .74 -> o painel ENCHE a tela
         prog 1.0 -> o painel já saiu 35% pela esquerda

     Hoje as flores vão de .10 (rosa nascendo) a .94 (lilás fechando), com
     .50s de florada cada uma. */
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
  for (const item of paineisComProgresso) {
    const painel = item.el;

    // a mesma esquerda que o getBoundingClientRect devolvia, sem perguntar
    const esquerda = trilhoEsquerda + item.idx * trilhoLarguraPainel - hsCurrent;
    const direita  = esquerda + trilhoLarguraPainel;

    /* 1. PAINEL LONGE DA TELA NÃO PRECISA DE CONTA NENHUMA.
       São dois painéis, e no scroll horizontal quase nunca os dois estão à
       vista ao mesmo tempo — escrever no que está fora é trabalho jogado
       fora. A folga de meia tela garante que ele já chegue com o valor certo
       antes de aparecer. */
    if (direita < -largura * 0.5 || esquerda > largura * 1.5) continue;

    let p = (largura - esquerda) / (largura * PERCURSO);
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
    hsLinhaDesenhar(hsPercurso ? hsCurrent / hsPercurso : 0);
    hsTicking = false;
    return;
  }

  hsCurrent += (hsTarget - hsCurrent) * 0.12;
  hsTrack.style.transform = `translate3d(${-hsCurrent}px, 0, 0)`;
  atualizarProgressoPaineis();
  hsLinhaDesenhar(hsPercurso ? hsCurrent / hsPercurso : 0);

  if (Math.abs(hsTarget - hsCurrent) > 0.5) {
    requestAnimationFrame(hsRender);
  } else {
    hsCurrent = hsTarget;
    hsTrack.style.transform = `translate3d(${-hsCurrent}px, 0, 0)`;
    atualizarProgressoPaineis();
    hsLinhaDesenhar(hsPercurso ? hsCurrent / hsPercurso : 0);
    hsTicking = false;
  }
}

function hsUpdate(){
  const rect = hsOuter.getBoundingClientRect();
  // hsAltura no lugar de hsOuter.offsetHeight: mesmo número, sem leitura de layout
  const total = hsAltura - window.innerHeight;

  // reserva (1 + EXTRA_PIN_VH) telas pro pin/pausa, sem esticar o ritmo do scroll horizontal
  const horizontalTotal = Math.max(total - window.innerHeight * (1 + EXTRA_PIN_VH), 1);
  const progress = Math.min(Math.max(-rect.top / horizontalTotal, 0), 1);

  hsPercurso = (hsPanelCount - 1) * window.innerWidth;
  hsTarget = progress * hsPercurso;

  if (!hsTicking) {
    hsTicking = true;
    requestAnimationFrame(hsRender);
  }
}

hsLayout();
medirGeometriaDoTrilho();
hsUpdate();
atualizarProgressoPaineis();

/* O .hs-sticky não rola mais sozinho em largura nenhuma — quem move os
   painéis é sempre o pin, comandado pelo scroll da janela. O ouvinte de
   scroll dele e a dica "arraste →" saíram junto com o fallback: não há mais
   arrasto lateral pra ouvir, e avisar pra arrastar seria mentira. */
Agenda.scroll(hsUpdate);

/* Aqui havia um SEGUNDO ouvinte de scroll chamando `atualizarProgressoPaineis`
   direto, sem passar por requestAnimationFrame nenhum — ou seja, medindo o
   layout a cada evento de scroll, que chega bem mais vezes que quadro. E era
   redundante: o hsUpdate agenda o hsRender, e o hsRender já chama essa mesma
   função. Saiu.

   As duas medidas do trilho são refeitas no resize, que é a única coisa capaz
   de mudá-las. */
Agenda.resize(() => {
  hsLayout();
  medirGeometriaDoTrilho();
  hsUpdate();
  atualizarProgressoPaineis();
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
  Agenda.resize(posicionar);

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
  /* preenchido mais abaixo pelo bloco do piscar; fica aqui em cima porque o
     observer precisa avisá-lo, e o observer é declarado antes */
  let aoMudarVisibilidadeDoOlho = null;

  new IntersectionObserver((entries) => {
    eyeVisivel = entries[0].isIntersecting;
    if (eyeVisivel) medirOlho();
    if (aoMudarVisibilidadeDoOlho) aoMudarVisibilidadeDoOlho();
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

    /* setInterval seria um timer eterno para um olho que passa quase a página
       inteira fora da tela — ele acordava o main thread a cada 4s pra
       descobrir que não tinha nada a fazer, inclusive com a aba em segundo
       plano. Reagendando só depois de cada piscada, e só enquanto o olho está
       à vista, o timer some junto com o motivo dele. */
    let blinkTimer = 0;

    function agendarPiscada(){
      clearTimeout(blinkTimer);
      if (!eyeVisivel) return;
      blinkTimer = setTimeout(() => { triggerBlink(); agendarPiscada(); }, BLINK_REPEAT_MS);
    }

    aoMudarVisibilidadeDoOlho = agendarPiscada;
    document.addEventListener('visibilitychange', agendarPiscada);
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

  Agenda.scroll(() => { if (eyeVisivel) medirOlho(); });
  Agenda.resize(() => { if (eyeVisivel) medirOlho(); });

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
  window.addEventListener('load', applySpeed, { once: true });
  Agenda.resize(applySpeed);
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

  function playInitialSequence(){
    spans.forEach((span, idx) => {
      setTimeout(() => {
        span.classList.add('active');
      }, START_DELAY_MS + STAGGER_MS * idx);
    });
  }

  /* QUANDO COMEÇAR — a palavra espera estar de fato na tela.

     Aqui havia um IntersectionObserver com `threshold: 0.5` decidindo
     sozinho, e ele estava errado por dois motivos que se somam justamente no
     celular:

       · esta palavra mora no QUARTO painel do scroll horizontal. Os painéis
         entram deslizando pela direita, empurrados pelo transform do trilho,
         então metade da caixa dentro da janela quer dizer metade das letras
         ainda fora, à direita. A sequência dura 2,5s do "A" ao ponto final —
         cabia inteira antes de a palavra chegar ao centro.

       · o eixo vertical não ajudava a perceber isso: o painel tem a altura da
         tela e fica preso nela durante todo o percurso, então a conta
         vertical dá "cheio" o tempo inteiro, com a palavra ainda longe.

     A régua do Viewport resolve os dois: `horizontal: true` faz a conta valer
     nos dois eixos, e o 0.9 espera a palavra estar praticamente inteira à
     vista — que é quando o painel assenta no centro.

     `resgatar: false` porque este efeito não esconde nada: as letras estão
     legíveis o tempo todo, só param quietas. Não há conteúdo em risco, então
     não faz sentido "resgatar" tocando a sequência para uma palavra que já
     passou — seria gastar 2,5s de animação onde ninguém está olhando. */
  Viewport.aoEntrar([wordEl], { fracao: 0.9, horizontal: true, resgatar: false },
    () => playInitialSequence());
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

  /* a trava `agendado` continua onde estava só porque `medir` também é
     chamada solta (nas tentativas iniciais); quem coalesce o scroll agora é a
     Agenda */
  Agenda.scroll(medir);
  Agenda.resize(medir);

  /* A animação só existe depois que o CSS da .bio-scrub foi aplicado, o que
     não acontece no mesmo instante em que a classe entra. Estas tentativas
     cobrem o intervalo; a partir daí o `medir` cuida sozinho. */
  requestAnimationFrame(() => { pegarAnimacoes(); medir(); });
  setTimeout(() => { pegarAnimacoes(); medir(); }, 400);
  medir();
})();