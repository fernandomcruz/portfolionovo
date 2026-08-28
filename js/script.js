/* =========================================================================
   PREFERÊNCIA DE MOVIMENTO
   Um único ponto de verdade: quem tem "reduzir movimento" ligado no sistema
   recebe a versão estática de tudo (nada de loop infinito, parallax, etc).
   ========================================================================= */

/* APARELHO DE TOQUE — declarado aqui em cima porque dois módulos precisam dele
   antes de o arquivo terminar de ser lido (a onda, lá pelo meio, e o scroll
   horizontal, mais adiante). Ele existe por causa de UMA diferença de
   comportamento que só o toque tem: a barra de endereço, que aparece e some
   durante a rolagem e dispara `resize` sem que nada de layout tenha mudado de
   verdade. */
const APARELHO_DE_TOQUE =
  !window.matchMedia || window.matchMedia('(hover: none), (pointer: coarse)').matches;

/* QUEM MOVE O TRILHO: o navegador ou este arquivo.

   A condição é a MESMA do bloco `@supports (animation-timeline: view())` no
   css/estilo.css — se as duas saírem de sincronia, ou o trilho não anda, ou
   anda duas vezes. Uma constante de cada lado, com a mesma pergunta.

   Quando o CSS assume, este arquivo não escreve mais o transform do trilho.
   Continua calculando `hsCurrent`, porque a linha desenhada e o jardim dos
   painéis dependem dele — mas esses dois moram DENTRO dos painéis, então
   viajam junto com o trilho de graça. Um quadro de atraso na florada, com a
   flor já indo no lugar certo, não se vê; um quadro de atraso no trilho
   inteiro é justamente o que se estava vendo. */
const HS_CSS_MOVE =
  !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: view()')) &&
  APARELHO_DE_TOQUE;

const PREFERE_MENOS_MOVIMENTO =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;


/* =========================================================================
   AGENDA — UM OUVINTE DE SCROLL E UM DE RESIZE PARA O SITE INTEIRO

   Antes eram nove de scroll e doze de resize, cada módulo com o seu próprio
   requestAnimationFrame. No resize nenhum estava amortecido, e vários fazem
   trabalho pesado (medir texto no canvas, reescrever a altura do trilho) —
   no celular `resize` dispara toda vez que a barra do navegador some ou volta,
   ou seja, no meio da rolagem.

   O resize leva um atraso curto por cima do rAF: o que interessa é o tamanho
   final, não os intermediários.
   ========================================================================= */

const Agenda = (() => {
  /* DUAS FILAS POR QUADRO, E A ORDEM ENTRE ELAS É O PONTO.

     Antes havia uma lista só, e os módulos se alternavam entre ler e escrever
     layout dentro dela: a onda media o .conteudo e escrevia o <path>, o pin
     media o hs-outer, o trilho escrevia o transform, a pausa media dez rects.
     Toda leitura que vem depois de uma escrita obriga o navegador a resolver
     o layout ali na hora — o "forced synchronous layout". Medido neste site:
     0,40ms por quadro só nisso, o que num celular vira 1,6 a 3,2ms.

     Separando em duas passadas — todo mundo mede primeiro, todo mundo escreve
     depois — o navegador resolve o layout UMA vez por quadro, no fim, e as
     escritas não invalidam nada que ainda vá ser lido. */
  const noLer = [];
  const noPintar = [];
  const noResize = [];
  /* O HANDLE DO rAF, E NÃO UM BOOLEANO.

     Aqui havia `agendado = true` antes do requestAnimationFrame e
     `agendado = false` DENTRO do callback. Parece a mesma coisa e não é: se o
     callback nunca chega a rodar — aba em segundo plano, janela escondida, o
     Safari do iPhone suspendendo o rAF no meio de um gesto —, a trava fica
     ligada para sempre e o site inteiro PARA de responder ao scroll pelo resto
     da visita. Não trava um efeito: trava todos, porque esta é a única agenda.

     Foi exatamente o que se viu medindo esta página: carregada com a aba ao
     fundo, o `resizeAgendado` ficou preso em `true`, nenhum resize voltou a
     ser processado e o `#hsOuter` ficou com `height: 0px` — a seção do scroll
     horizontal simplesmente não existia, e não havia gesto capaz de consertar.

     Guardando o handle dá pra CANCELAR e repedir. E o `visibilitychange`
     abaixo é a rede: ao voltar pra frente, qualquer quadro que tenha ficado
     pendurado é descartado e um novo é pedido. */
  let idQuadro = 0;
  let idResize = 0;
  let resizeTimer = 0;

  /* A JANELA É LIDA UMA VEZ POR QUADRO.

     `window.scrollY` NÃO é uma variável: o navegador precisa de layout limpo
     pra responder, e por isso ele força o recálculo se algo sujou a página.
     Medido nesta página, com layout sujo: 0,40ms por leitura. A barra de
     progresso lia uma vez, o marquee lia duas, e as três leituras aconteciam
     na passada de DESENHO — ou seja, depois de o trilho, o retrato e as
     classes de pausa já terem escrito. Era o "forced synchronous layout" que
     esta agenda existe justamente para evitar, três vezes por quadro.

     Agora a leitura acontece uma vez só, no começo da passada de medida, que é
     onde o layout é recalculado de qualquer jeito. Todo mundo consome o mesmo
     número — e, de quebra, todos os módulos passam a ver exatamente a mesma
     posição no mesmo quadro.

     Fora de um quadro (chamadas avulsas no `load`, no `fonts.ready`, na
     inicialização) o valor volta a ser lido na hora: ali não há passada
     nenhuma para se apoiar. */
  let dentroDoQuadro = false;
  let jY = 0, jW = 0, jH = 0;

  function medirJanela(){
    jY = window.scrollY;
    jW = window.innerWidth;
    jH = window.innerHeight;
  }

  let precisaCompactar = false;

  function compactar(){
    precisaCompactar = false;
    for (const lista of [noLer, noPintar, noResize]) {
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

  /* O `finally` não é zelo à toa: `dentroDoQuadro` preso em `true` faria o
     `Agenda.y` devolver a posição de um quadro antigo pelo resto da visita, e
     todo efeito ligado ao scroll passaria a desenhar no lugar errado. */
  function quadro(){
    idQuadro = 0;
    dentroDoQuadro = true;
    try {
      medirJanela();
      rodar(noLer);
      rodar(noPintar);
    } finally {
      dentroDoQuadro = false;
    }
  }

  function pedirQuadro(){
    if (idQuadro) return;
    idQuadro = requestAnimationFrame(quadro);
  }

  function quadroResize(){
    idResize = 0;
    dentroDoQuadro = true;
    try {
      medirJanela();
      rodar(noResize);
    } finally {
      dentroDoQuadro = false;
    }
  }

  function pedirResize(){
    if (idResize) return;
    idResize = requestAnimationFrame(quadroResize);
  }

  window.addEventListener('scroll', pedirQuadro, { passive: true });

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(pedirResize, 60);
  }, { passive: true });

  /* A REDE DE SEGURANÇA DA TRAVA (ver o comentário do `idQuadro`).

     Ao voltar pra frente, um quadro pedido enquanto a aba estava escondida
     pode nunca ter rodado. Cancelar o handle pendurado devolve a agenda ao
     estado limpo; pedir um quadro e um resize logo em seguida recoloca o site
     em dia, porque enquanto a aba esteve fora a janela pode ter mudado de
     tamanho sem que ninguém processasse o evento. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (idQuadro) { cancelAnimationFrame(idQuadro); idQuadro = 0; }
    if (idResize) { cancelAnimationFrame(idResize); idResize = 0; }
    pedirQuadro();
    pedirResize();
  });

  return {
    /* MEDE: pode ler layout, não pode escrever. */
    scroll(fn){ noLer.push(fn); return fn; },
    /* DESENHA: pode escrever, não pode ler layout. Roda depois de todo mundo
       ter medido. */
    pintar(fn){ noPintar.push(fn); return fn; },
    resize(fn){ noResize.push(fn); return fn; },

    /* Pede mais um quadro sem que tenha havido scroll — é o que sustenta a
       cauda do lerp do trilho depois que o dedo/roda já parou. */
    pedirQuadro,

    /* A JANELA DESTE QUADRO — ver `medirJanela` acima.
       `y` no lugar de `window.scrollY`, `w`/`h` no lugar de
       `window.innerWidth`/`innerHeight`. Dentro de um quadro é a leitura já
       feita; fora dele, a leitura de agora. */
    get y(){ return dentroDoQuadro ? jY : window.scrollY; },
    get w(){ return dentroDoQuadro ? jW : window.innerWidth; },
    get h(){ return dentroDoQuadro ? jH : window.innerHeight; },

    /* Tira uma função das duas listas. Um efeito de ENTRADA só precisa ser
       conferido até acontecer; sem isto ele seguiria sendo chamado — pra não
       fazer nada — em todo quadro de scroll pelo resto da visita.

       A vaga é aberta com `null` em vez de removida na hora porque `parar`
       quase sempre é chamado de DENTRO do `rodar`: mexer no array no meio da
       varredura pularia a função seguinte. A limpeza vem no fim do quadro. */
    parar(fn){
      for (const lista of [noLer, noPintar, noResize]) {
        const i = lista.indexOf(fn);
        if (i >= 0) { lista[i] = null; precisaCompactar = true; }
      }
    }
  };
})();

window.Agenda = Agenda;   // o js/efeitos.js usa a mesma agenda


/* =========================================================================
   VIEWPORT — "ISTO ESTÁ MESMO NA TELA?"

   Uma régua só para todos os efeitos de entrada. O IntersectionObserver sozinho
   não servia por dois motivos, os dois piores no celular: ele mede contra o
   viewport de LAYOUT, que inclui a faixa atrás das barras do navegador (um
   elemento "35% dentro da janela" pode estar 35% atrás da barra de baixo); e
   onde havia threshold E conferência por geometria, as duas discordavam e
   ganhava sempre a mais frouxa.

   Aqui o observer continua, mas rebaixado a avisador barato ("a geometria
   mudou, confere aí"), sem direito a decidir.
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

/* As oito fotos do menu não entram no primeiro carregamento.

   `loading="lazy"` NÃO resolve isto: o overlay é `position: fixed` empurrado
   para fora por um transform, e o navegador não leva transforms em conta ao
   decidir o que está longe da tela — medi, e as oito continuavam baixando.
   O jeito que funciona é a URL morar em `data-src` e só virar `src` no
   primeiro sinal de intenção (dedo no botão, mouse chegando perto), que
   acontece antes do clique. */
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

/* O aquecimento automático não acontece em economia de dados nem em conexão
   lenta: são 249 KB para um menu que a pessoa talvez nem abra. Os gatilhos de
   intenção continuam valendo, então quem abre o menu vê as fotos do mesmo
   jeito — só quem nunca abre deixa de pagar por elas. */
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

/* A suavização é feita aqui por interpolação, e não por `transition` no CSS:
   o parallax escreve em `transform` a cada quadro, e uma transição de .7s com
   delay fazia cada movimento do mouse chegar meio segundo atrasado — o efeito
   parecia desligado. O css/estilo.css zera a transição quando a entrada do
   menu termina (`.menu-panel.menu-pronto`). */

const PARALLAX_FORCA_X = 0.55; // o eixo X anda menos que o Y, fica mais natural
const PARALLAX_INCLINA = 0.9;  // graus de inclinação na foto mais "próxima"
const PARALLAX_SUAVIDADE = 0.09;

let alvoPX = 0, alvoPY = 0;   // para onde o mouse quer levar (-1 a 1)
let atualPX = 0, atualPY = 0; // onde as fotos estão agora
let parallaxRodando = false;

/* ESTE É UM DOS DOIS LAÇOS DE ANIMAÇÃO QUE DEIXARAM DE TER rAF PRÓPRIO.

   A função em si não mudou; o que mudou é quem a chama. Antes ela pedia o
   próprio `requestAnimationFrame` e girava em paralelo com o da Agenda, o que
   significa dois ciclos de animação disputando o mesmo quadro sempre que
   alguém mexesse o mouse enquanto rolava — que é o caso normal de quem usa
   roda de mouse.

   Agora ela é uma função de DESENHO da Agenda: roda dentro do mesmo ciclo de
   todo mundo, depois de todas as medidas, e sai na frente com uma comparação
   quando não há nada para mover. Quando ainda falta caminho, ela pede o
   próximo quadro pela Agenda em vez de abrir um laço novo. */
function pintarMenuParallax(){
  if (!parallaxRodando) return;
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
    Agenda.pedirQuadro();
  }
}

/* só escreve `transform`, não lê layout nenhum: por isso mora na passada de
   desenho, ao lado do trilho do scroll horizontal */
Agenda.pintar(pintarMenuParallax);

function acordarParallax(){
  if (parallaxRodando) return;
  parallaxRodando = true;
  Agenda.pedirQuadro();
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

/* O CAMINHO É CONSTRUÍDO NA AMPLITUDE MÁXIMA, UMA VEZ POR LARGURA.

   Antes ele recebia o `progress` e era remontado a cada quadro de rolagem: 62
   comandos `L` concatenados em texto, o atributo `d` reescrito, o caminho
   reanalisado pelo navegador e a faixa inteira repintada. Medido no celular
   emulado: 375x206px de repintura por quadro — 25% da tela, na thread
   principal, exatamente enquanto o dedo rola.

   E era trabalho desnecessário, porque a FORMA nunca muda. Olhando a conta:

       y = base - rise * (1 + sin(x))       rise = (amp/2) * progress²

   o `progress` aparece só como um fator multiplicando a altura inteira. Ou
   seja, a onda de qualquer progresso é a onda máxima achatada na vertical —
   e achatar na vertical é `scaleY`, que o compositor faz sem repintar nada.

   Então o caminho passa a ser montado na amplitude cheia (progress = 1) e o
   scroll só escreve `transform: scaleY(progress²)` no <svg>, com a origem na
   linha de base (ver `--onda-base` no css/estilo.css). O resultado na tela é
   o mesmo pixel a pixel — a conta acima é a mesma, só reagrupada. */
function buildCapWavePath(width){
  const rise = amplitudeDaTela(width) / 2;
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

/* A ORIGEM DO scaleY, ENTREGUE AO CSS.

   O achatamento tem de girar em torno da LINHA DE BASE da onda, não do fundo
   da caixa: abaixo da base ainda há a saia de `CAP_HEIGHT + OVERLAP` que
   emenda a faixa com a seção branca, e ela não pode encolher junto.

   A conta é a mesma dos dois lados e sai daqui, das constantes que já
   definem o viewBox — assim o CSS não guarda um número copiado que possa
   ficar velho se o desenho mudar. Quem cobre a saia é o `.wave-cap::after`,
   que é estático. */
waveCap?.style.setProperty('--onda-base', (BASELINE_LOCAL / SVG_HEIGHT).toFixed(6));

/* A versão anterior chamava requestAnimationFrame em cadeia pra sempre: mesmo
   com a página parada, ou com a onda a 6 telas de distância, o navegador
   recalculava getBoundingClientRect 60x por segundo — leitura de layout cara,
   ligada o tempo todo, que segurava a CPU e derrubava o FPS das outras
   animações. Agora o desenho acontece só quando existe motivo (scroll ou
   resize) e apenas enquanto a onda está perto da tela. */
let lastWaveKey = '';
let tentativasDaOnda = 0;

function medirWaveCap(){
  const vw = window.innerWidth;

  /* Largura zero envenena o path em vez de falhar em silêncio: o ângulo sai de
     `x / width` com x = 0, ou seja 0/0 = NaN, e o `d` termina em "L0.0,NaN",
     que o navegador rejeita inteiro. Repare que o clamp do progress não segura
     isso — `Math.max(0, NaN)` devolve NaN.

     Reagenda em vez de só desistir: se as primeiras chamadas caírem aqui e
     ninguém rolar, a faixa ficaria vazia para sempre. */
  if (!vw) {
    if (tentativasDaOnda++ < 30) requestAnimationFrame(desenharWaveCap);
    return null;
  }
  tentativasDaOnda = 0;

  const rect = conteudoEl.getBoundingClientRect();

  // fora de alcance: a onda já está formada ou nem começou — nada a redesenhar
  if (rect.top > TRIGGER_START + 200 || rect.bottom < -200) return null;

  // progress = 0 quando rect.top == TRIGGER_START, progress = 1 quando rect.top == TRIGGER_END
  let progress = (TRIGGER_START - rect.top) / (TRIGGER_START - TRIGGER_END);
  progress = Math.min(1, Math.max(0, progress));

  const key = progress.toFixed(3) + '_' + vw;
  if (key === lastWaveKey) return null;

  return { progress, vw, key };
}

/* A largura para a qual o caminho atual foi montado. Só ela obriga a remontar
   — e ela só muda no resize. */
let larguraDaOnda = 0;

function montarOnda(vw){
  if (vw === larguraDaOnda) return;
  larguraDaOnda = vw;
  waveCapSvg.setAttribute('viewBox', `0 0 ${vw} ${SVG_HEIGHT}`);
  waveCapPath.setAttribute('d', buildCapWavePath(vw));
}

/* Quem escreve o scaleY: o navegador ou este arquivo. Mesma pergunta do
   HS_CSS_MOVE, e sem o recorte de "só no toque" — aqui não há amortecimento
   nenhum para preservar no desktop, então o compositor é melhor em todo lugar
   que o suporta. A condição espelha o `@supports` do css/estilo.css. */
const ONDA_CSS =
  !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll(root block)'));

function aplicarWaveCap(onda){
  lastWaveKey = onda.key;
  montarOnda(onda.vw);
  if (ONDA_CSS) return;   // o transform vem da animação ligada à rolagem
  /* progress² é o mesmo expoente que estava no `rise` — ver buildCapWavePath */
  const p = onda.progress;
  waveCapSvg.style.transform = `scaleY(${(p * p).toFixed(5)})`;
}

/* AS ÂNCORAS DA ONDA, EM POSIÇÃO DE ROLAGEM.

   `--onda-inicio` é o scrollY em que a crista começa a subir e `--onda-fim`
   onde ela termina de se formar — as mesmas duas fronteiras que o
   `medirWaveCap` usa, só que resolvidas para posições absolutas do documento
   em vez de recalculadas a cada quadro contra a tela.

   O `offsetTop` somado até a raiz, e não `rect.top + scrollY`, pelo mesmo
   motivo do trilho: no iPhone as duas leituras podem discordar por uma
   fração de segundo enquanto a barra de endereço se move, e a âncora sairia
   deslocada pela altura dela.

   O GUARDA DE RESIZE É A OUTRA METADE. `TRIGGER_START` é a altura da tela, e
   no celular ela muda toda vez que a barra recolhe. Recalcular ali no meio
   moveria as âncoras com a rolagem em curso — que é exatamente o salto que se
   quer evitar. Largura igual e altura praticamente igual: não é resize, é a
   barra do navegador. Passa direto. */
let ondaLarguraLayout = -1;
let ondaAlturaLayout = -1;

function ondaLayout(forcar){
  const W = window.innerWidth || 0;
  const H = window.innerHeight || 0;
  if (W < 2 || H < 2) return;

  /* O guarda vale SÓ no toque. Num computador, mudar a altura da janela é
     sempre um resize de verdade e o layout tem de acompanhar — ignorá-lo
     deixaria a onda calibrada para uma tela que não existe mais. */
  if (!forcar && APARELHO_DE_TOQUE &&
      W === ondaLarguraLayout && ondaAlturaLayout > 0 &&
      Math.abs(H - ondaAlturaLayout) / ondaAlturaLayout < 0.05) {
    return;
  }

  ondaLarguraLayout = W;
  ondaAlturaLayout = H;
  TRIGGER_START = H;

  montarOnda(W);

  let topo = 0;
  for (let el = conteudoEl; el; el = el.offsetParent) topo += el.offsetTop;
  waveCap?.style.setProperty('--onda-inicio', Math.round(topo - TRIGGER_START) + 'px');
  waveCap?.style.setProperty('--onda-fim', Math.round(topo - TRIGGER_END) + 'px');

  lastWaveKey = '';   // força o redesenho na nova medida, no caminho sem CSS
}

function desenharWaveCap(){
  const onda = medirWaveCap();
  if (onda) aplicarWaveCap(onda);
}

/* A trava `waveAgendado` que existia aqui saiu: quem coalesce agora é a
   Agenda, que já entrega no máximo uma passada por quadro. */
/* A onda mede numa passada e escreve na outra. O `d` do <path> e o viewBox são
   escritas que invalidam layout; medir o .conteudo depois delas custava um
   reflow. Aqui a medida sai na fila de leitura e o desenho fica guardado até a
   fila de escrita. */
let ondaPendente = null;

/* Com o CSS no comando não há nada a medir por quadro: o caminho é montado no
   layout e o resto é do compositor. Sem ele, a dupla medir/pintar de sempre. */
if (!ONDA_CSS) {
  Agenda.scroll(() => { ondaPendente = medirWaveCap(); });
  Agenda.pintar(() => {
    if (!ondaPendente) return;
    aplicarWaveCap(ondaPendente);
    ondaPendente = null;
  });
}

Agenda.resize(() => ondaLayout());
ondaLayout(true);
if (!ONDA_CSS) desenharWaveCap();

/* Rede de segurança para o caso acima: se a primeira chamada caiu na guarda de
   largura zero, ninguém mais desenharia até a pessoa rolar ou redimensionar.
   Uma passada no `load`, com a medida já boa, fecha esse buraco. */
window.addEventListener('load', () => {
  ondaLayout(true);
  if (!ONDA_CSS) desenharWaveCap();
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
/* O último `hsCurrent` que chegou a virar pixel na tela. Enquanto ele for
   igual ao atual não há nada para redesenhar — ver o `hsRender`. `NaN` força
   a primeira passada, e é também como o resize invalida o que já foi feito
   (NaN nunca é igual a nada, nem a si mesmo). */
let hsDesenhado = NaN;
/* quanto o trilho anda do começo ao fim, em px — é o que transforma a posição
   atual em progresso de 0 a 1 pra linha. Medido no layout, junto com a altura
   da seção, para ser exatamente o mesmo número que vai no `--hs-percurso` lido
   pela animação do CSS. */
let hsPercurso = 0;

/* AS DUAS ÂNCORAS DO PERCURSO, EM POSIÇÃO DE ROLAGEM DO DOCUMENTO.

   `hsInicioDoc` é o scrollY em que o topo da seção encosta no topo da tela;
   `hsParadaDoc` é onde o trilho termina de andar e começa a pausa com o último
   painel parado. Entre os dois, o progresso vai de 0 a 1.

   São POSIÇÕES DE ROLAGEM, e não alturas de tela, e é justamente esse o
   ponto: no iPhone a barra de endereço muda a altura da tela no meio do gesto,
   e qualquer conta que dependesse dela mudaria de resultado no meio do
   caminho. Estes dois números só mudam quando o layout muda.

   Os mesmos dois vão para o CSS como `--hs-inicio` e `--hs-parada`, que é o
   que faz a animação do compositor e a conta daqui chegarem sempre ao mesmo
   ponto. */
let hsInicioDoc = 0;
let hsParadaDoc = 1;

/* A seção está à vista? Posto por um IntersectionObserver mais abaixo
   (`hsPromoverTrilho`). Serve para duas coisas: a camada de GPU do trilho e o
   ritmo de atualização do conteúdo — ver `hsBombear`. */
let hsVisivel = false;

/* Ainda falta ligar alguém à rolagem? As animações do CSS só existem depois
   que o estilo resolve, o que não acontece no primeiro quadro — então a
   ligação do jardim é tentada de novo até dar certo. Enquanto isso a bomba de
   quadros continua acordando; assim que tudo está ligado, ela desliga e a
   seção passa a não custar quadro nenhum de JavaScript. */
let hsFaltaLigar = true;

const EXTRA_PIN_VH = 0.2; // nº de telas extras de pausa antes do .stack começar a subir — ajuste aqui

/* =========================================================================
   LINHA DESENHADA PELO SCROLL

   Um traço único atravessando os cinco painéis do scroll horizontal, que vai
   sendo desenhado conforme eles passam.

   O QUE ESTAVA QUEBRADO, e não era o desenho: o SVG é `position: absolute`, e
   elemento posicionado pinta DEPOIS do conteúdo em fluxo dos irmãos — mesmo
   com z-index menor, mesmo vindo antes no DOM. Como só dois dos cinco painéis
   tinham `.texto` posicionado (o do "I DESIGN." e o do "I DEVELOP."), a linha
   passava atrás da palavra nesses dois e POR CIMA das letras nos outros três.
   A correção não é remendar painel por painel: é levantar o painel inteiro
   para z-index 1 (a regra está em `.hs-panel`) e deixar a linha no 0. Assim
   qualquer coisa que entre num painel já nasce na frente dela.

   A COR E A ESPESSURA SÃO AS ORIGINAIS, e agora elas fazem sentido. São
   1,02:1 de contraste contra o fundo da seção — o traço não é para ser lido
   como linha, é uma faixa larga de `--lightgreen` passando POR TRÁS das
   palavras, que aparece pelo movimento e pelo matiz, não pela luminância.
   Antes ela passava por cima das letras em três painéis, e aí a mesma massa
   de cor virava um risco. É por isso que a correção de empilhamento vinha
   primeiro: era ela que estava errada, não a paleta. Ver o cabeçalho do
   css/estilo.css para os dois knobs.

   O desenho em si se apoia em quatro decisões:

     · A composição é uma lista de PONTOS normalizados — x em larguras de
       painel (0 a 5), y em frações da altura. Converter para pixel é
       multiplicar: não há viewBox esticado, escala nem transform.
     · A curva sai dos pontos por Catmull-Rom, que passa POR todos eles e dá
       tangente contínua nas emendas — é o que faz parecer um traço só em vez
       de trechos costurados. As composições atuais são todas redondas; se um
       dia um ponto precisar virar bico (um degrau, um quique de bola), ele
       aceita a marca `Q` no terceiro item e a tangente ali passa a seguir a
       corda. Sem tocar no traçado.
     · O traço é montado como um <path> POR SEGMENTO. `stroke-dashoffset`
       invalida a caixa INTEIRA do caminho a cada mudança; em 6400px de
       percurso isso é a curva toda rasterizada de novo a cada quadro de
       scroll. Fatiado, só a fatia onde a ponta do lápis está muda de estado —
       as de trás ficam paradas em 0, as da frente paradas no comprimento
       delas.
     · A ponta anda em X, não em comprimento de arco. Os dois não são
       proporcionais: num trecho íngreme o traço gasta muito comprimento sem
       avançar quase nada em X. Sem corrigir isso a ponta dispara na frente da
       janela e, do meio do percurso em diante, você vê a linha pronta em vez
       de vê-la sendo feita. A tabela de X mais abaixo faz o caminho inverso.

   Sem JS o SVG nem chega a existir: a linha é enfeite, não estrutura.
   ========================================================================= */

const LINHA_NS = 'http://www.w3.org/2000/svg';

const LINHA = {
  /* ---- composição ---- */
  // os dois pontos de adaptação. Poucos de propósito: dentro de cada categoria
  // a geometria responde sozinha, porque as coordenadas são frações do painel
  pontoCelular: 768,
  pontoDesktop: 1180,
  // o quanto a composição ocupa da altura do painel. 1 = como foi desenhada;
  // abaixo disso ela se recolhe em direção ao meio, sem mudar de forma
  amplitude: 1,

  /* ---- traço ---- */
  // Espessura e cor são as originais de volta, a pedido. Elas fazem sentido
  // AGORA porque o empilhamento foi corrigido: um traço largo de --lightgreen
  // passando POR TRÁS das palavras é uma faixa tonal costurando o conteúdo. O
  // mesmo traço por cima das letras, que era o estado anterior, era um risco.
  /* >>> TESTE DE ESPESSURA — voltar para 34 / 10 / 30 quando terminar <<< */
  espessuraDivisor: 30,   // largura da tela / isto = espessura desejada
  espessuraMin: 11,
  espessuraMax: 46,

  /* ---- curva ---- */
  tensao: 0.5,   // 0 = tudo quina; 0.5 = Catmull-Rom clássico; acima disso incha
  corda: 0.3,    // o quanto a curva sai reta ao passar por um ponto de quina

  /* ---- entrada e saída ----
     Onde fica a ponta do lápis, em larguras de painel contadas da BORDA
     ESQUERDA DA TELA (não do caminho). Ver o comentário do hsLinhaDesenhar.
       · entradaEm negativo esconde a ponta atrás da borda no instante 0, e o
         valor tem que cobrir o raio do traço, senão a bolinha da ponta
         aparece espiando. Em -0.05 sobra folga até a espessura máxima.
       · saidaEm 1 = borda direita: a última pincelada acontece na saída.
       · aceleracao controla COMO ela vai de um ao outro. 1 = reta. Acima
         disso, ela corre nas duas pontas e cruza o meio devagar: descola
         rápido da borda esquerda no começo, passeia pelo miolo da tela, e só
         corre pra borda direita no fim. É esse "devagar no meio" que mantém
         espaço em branco na frente da ponta — sem ele o traço chega no fim de
         cada trecho antes da tela mostrar aquele trecho. */
  entradaEm: -0.05,
  saidaEm: 1,
  aceleracao: 2,

  /* ---- medição ---- */
  amostras: 256,
  // variação de altura menor que isto não remonta nada: é a barra do navegador
  // do celular aparecendo e sumindo, não uma tela nova. Remontar ali
  // reiniciaria o desenho no meio da rolagem — o pulo que a pessoa vê.
  toleranciaDeAltura: 0.18
};


/* =========================================================================
   GEOMETRIA — a composição

   Pontos normalizados: x em larguras de painel (0 a 5), y em frações da altura
   (0 = topo, 1 = base). Sem escala nem transform — cada composição é desenhada
   para o formato do painel dela.

   O texto ocupa de 0,34 a 0,66 da altura, sobrando uma faixa livre acima e
   outra abaixo. A composição usa as duas e atravessa entre elas POR TRÁS das
   palavras. Isso agora é verdade de fato: com o painel no z-index 1 e a linha
   no 0, a travessia passa atrás das letras em todos os cinco painéis, e não só
   nos dois que por acaso tinham o `.texto` posicionado.

   As três variantes seguem a mesma direção — sobe, plana, mergulha, estica,
   sobe, desce em diagonal — recalibrada para o espaço de cada formato.
   Nenhuma é a outra reduzida.
   ========================================================================= */

/* Marca de quina, lida pelo `linhaSegmentos` no terceiro item do ponto: ali a
   tangente segue a corda em vez do vizinho, o que dá bico em vez de curva.
   Nenhum ponto das composições abaixo usa — elas são todas redondas de
   propósito —, mas fica aqui porque é assim que se pede um degrau ou um
   quique sem mexer no traçado. */
const Q = 1;

const COMPOSICOES = {
  /* CELULAR — uma travessia inteira por painel.

     No celular o trilho mostra um painel de cada vez, tela cheia: o gesto tem
     que caber num painel e valer por si. Espalhar uma curva por dois painéis
     faria cada tela receber meia ideia.

     Termina em x exatamente 5,00. Passar da borda parece inofensivo, mas
     desalinha a ponta do lápis — a janela visível não passa de 5,00, e o traço
     precisaria correr um trecho que a tela nunca alcança. Pelo mesmo motivo o
     último painel tem UMA descida só: com duas travessias nos mesmos 0,8 de
     largura, o traço se acumulava no fim e a linha ficava pendurada no meio
     da altura. */
  celular: [
    [-0.08, 0.92], [0.30, 0.86], [0.62, 0.52], [0.90, 0.16],
    [1.16, 0.08], [1.44, 0.22], [1.72, 0.60], [1.96, 0.90],
    [2.16, 0.92], [2.38, 0.78], [2.56, 0.86], [2.82, 0.52], [2.98, 0.20],
    [3.24, 0.10], [3.48, 0.36], [3.68, 0.64], [3.86, 0.42], [4.02, 0.18],
    [4.30, 0.36], [4.58, 0.58], [4.82, 0.78], [5.00, 0.92]
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

/* As coordenadas já vêm normalizadas: converter é multiplicar. A `amplitude`
   recolhe o desenho em direção ao meio vertical sem mudar a forma dele, e
   existe só como ajuste fino: em 1 vale o que foi desenhado. */
function linhaPontos(W, H){
  const meio = 0.5;
  return linhaComposicao(W, H).map(([x, y, quina]) => [
    x * W,
    (meio + (y - meio) * LINHA.amplitude) * H,
    quina
  ]);
}


/* =========================================================================
   TRAÇADO — pontos viram curva

   Catmull-Rom passa POR todos os pontos (diferente de Bézier, onde os pontos
   de controle ficam fora da curva) e entrega tangente contínua nas emendas. Na
   prática: eu movo um ponto, a curva inteira se reacomoda sozinha e continua
   suave. É o que permite editar a composição acima sem recalcular controles à
   mão.

   A QUINA é a única exceção, e é local: num ponto marcado, o controle daquele
   lado sai pela CORDA do segmento em vez de pela tangente do vizinho. A outra
   ponta do mesmo segmento continua curva — por isso o quique tem bico no chão
   e barriga no ar, com o mesmo par de fórmulas.
   ========================================================================= */

function linhaSegmentos(pontos){
  if (pontos.length < 2) return [];

  const k = LINHA.tensao / 3;    // (p2-p0)/6 * tensao * 2, simplificado
  const c = LINHA.corda;
  const em = (i) => pontos[Math.max(0, Math.min(pontos.length - 1, i))];
  const fora = [];

  for (let i = 0; i < pontos.length - 1; i++) {
    const p0 = em(i - 1), p1 = em(i), p2 = em(i + 1), p3 = em(i + 2);
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];

    // sair de p1: pela corda se p1 é quina, senão pela tangente de Catmull-Rom
    const c1x = p1[2] ? p1[0] + dx * c : p1[0] + (p2[0] - p0[0]) * k;
    const c1y = p1[2] ? p1[1] + dy * c : p1[1] + (p2[1] - p0[1]) * k;
    // chegar em p2: mesma regra, do outro lado
    const c2x = p2[2] ? p2[0] - dx * c : p2[0] - (p3[0] - p1[0]) * k;
    const c2y = p2[2] ? p2[1] - dy * c : p2[1] - (p3[1] - p1[1]) * k;

    /* Devolve os OITO NÚMEROS da cúbica, e não o `d` pronto. Quem monta o
       texto é o `linhaSubdividir` abaixo, porque ele precisa dos pontos de
       controle para cortar a curva sem deformá-la. */
    fora.push([p1[0], p1[1], c1x, c1y, c2x, c2y, p2[0], p2[1]]);
  }
  return fora;
}


/* =========================================================================
   SUBDIVISÃO — POR QUE O TRAÇO É PICADO EM MUITOS PEDAÇOS

   Desenhar é animar `stroke-dashoffset`, e mexer no dashoffset de um <path>
   REPINTA a caixa inteira daquele <path>. Essa é a conta que decide o custo
   do scroll horizontal, porque acontece em todo quadro em que a linha anda.

   Medido nesta página com um <path> por segmento de curva (16 no total):
   caixa média de 80.354px², máxima de 123.501px² — 8,7% e 13,4% de uma tela
   de 1280x720. Cada quadro repintava esse tanto de traço antialiasado de
   42,7px de espessura. Num celular com DPR 3 são ~720 mil pixels de
   dispositivo por quadro, só na linha.

   Cortar cada cúbica em pedaços menores não muda NADA do desenho — a curva é
   idêntica, ponto a ponto — e divide essa área por volta de cinco. Como o
   `hsLinhaAplicar` só toca no pedaço ATIVO, o resto do traço fica parado na
   camada, já rasterizado.

   O corte é De Casteljau, que é o algoritmo exato: cortar uma Bézier cúbica
   em t devolve duas cúbicas cuja união é a curva original, sem aproximação.
   Por isso dá pra picar à vontade sem risco de a linha mudar de forma.

   O limite é a própria espessura: com 42,7px de traço, um pedaço muito curto
   tem a caixa dominada pelo `stroke-width` e a divisão para de compensar. 5
   é onde a curva de retorno achata nesta composição.
   ========================================================================= */
const LINHA_PEDACOS = 5;

function linhaSubdividir(seg, n){
  const f = (v) => v.toFixed(1);
  const fora = [];
  let [x0, y0, x1, y1, x2, y2, x3, y3] = seg;

  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      fora.push(`M${f(x0)},${f(y0)}C${f(x1)},${f(y1)} ${f(x2)},${f(y2)} ${f(x3)},${f(y3)}`);
      break;
    }

    /* corta o que SOBROU em t: o primeiro corte tira 1/n do todo, o segundo
       tira 1/(n-1) do que restou, e assim por diante — no fim os n pedaços
       cobrem faixas iguais do parâmetro original */
    const t = 1 / (n - i);
    const ax = x0 + (x1 - x0) * t, ay = y0 + (y1 - y0) * t;
    const bx = x1 + (x2 - x1) * t, by = y1 + (y2 - y1) * t;
    const cx = x2 + (x3 - x2) * t, cy = y2 + (y3 - y2) * t;
    const dx = ax + (bx - ax) * t, dy = ay + (by - ay) * t;
    const ex = bx + (cx - bx) * t, ey = by + (cy - by) * t;
    const gx = dx + (ex - dx) * t, gy = dy + (ey - dy) * t;

    fora.push(`M${f(x0)},${f(y0)}C${f(ax)},${f(ay)} ${f(dx)},${f(dy)} ${f(gx)},${f(gy)}`);

    x0 = gx; y0 = gy;
    x1 = ex; y1 = ey;
    x2 = cx; y2 = cy;
  }
  return fora;
}


/* =========================================================================
   MONTAGEM

   Uma fatia por segmento de curva. O motivo é de pintura, não de geometria —
   está no cabeçalho lá em cima. Duas coisas que isto exige, e que moram no CSS:

     · a opacidade fica no <svg>, não no path. Com ela no path, as pontas
       arredondadas de fatias vizinhas se sobrepõem e o alfa compõe duas vezes
       — um ponto mais escuro em cada emenda. No <svg> as fatias compõem entre
       si em alfa cheio e a opacidade vale pro conjunto.
     · as fatias compartilham exatamente o ponto de emenda e usam
       `stroke-linecap: round`, então as duas meias-luas coincidem e a junta
       fica idêntica a um `stroke-linejoin: round`.
   ========================================================================= */

const hsLinha = (() => {
  if (!hsTrack) return null;
  const svg = document.createElementNS(LINHA_NS, 'svg');
  svg.setAttribute('class', 'hs-linha');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'none');
  /* ÚLTIMO filho, e não o primeiro. Os painéis estão no z-index 1 e a linha no
     0, então entre eles a ordem do DOM não muda nada — mas os painéis que
     ficam ATRÁS do traço ("I DEVELOP." e "LET ME SHOW YOU") descem pro mesmo
     z-index 0 da linha, e aí quem vem depois no DOM é quem pinta por cima.
     É assim que a linha passa na FRENTE dessas duas e por trás das outras
     três, sem um segundo SVG e sem recortar nada. As exceções são declaradas
     no css/estilo.css, junto com o `.hs-panel`. */
  hsTrack.appendChild(svg);
  return {
    svg,
    fatias: [], ativa: -1, comprimento: 0,
    tabelaX: null,
    larguraMedida: 0, alturaMedida: 0,
    prog: 0, pronta: false
  };
})();

/* O DASHARRAY TEM FOLGA — e é isto que mata o ponto amarelo.

   O jeito óbvio de esconder uma fatia é `dasharray: comp` com
   `dashoffset: comp`. Só que o valor vai pro estilo como texto, e ele era
   escrito com `comp.toFixed(1)`: um comprimento de 579,94 virava 579,9. O
   traço passa a valer 579,9 e o caminho tem 579,94 — sobram 0,04px de traço
   LIGADO no fim da fatia. Com `stroke-linecap: round`, 0,04px de traço não
   desenham um risquinho de 0,04px: desenham o CÍRCULO da ponta inteira, ou
   seja, uma bolinha do diâmetro do traço (30px no desktop).
   Medido nesta composição: 9 das 16 fatias vazavam. Quase todas caíam por
   trás das letras e não davam na vista; a da fatia 0 caía no vazio embaixo do
   "DEVELOPER" e virava aquele ponto amarelo. E sumia ao rolar porque, quando
   a ponta do lápis passa pela fatia, ela vira traço desenhado de verdade.

   A correção não é arredondar melhor — é dar FOLGA. O período do tracejado
   passa a ser `ceil(comp) + 1`, sempre maior que o caminho:

     · escondida  -> offset = D. A fatia inteira (0..comp) cai dentro da banda
       apagada [D, 2D), com pelo menos 1px de margem. Não tem como vazar.
     · desenhada até `s` -> offset = D - s. O trecho 0..s cai na banda acesa e
       o resto na apagada, com a mesma folga.

   Como D é inteiro, ele vai pro estilo exato, sem arredondamento nenhum. */
function hsLinhaFatiar(emPixels){
  for (const f of hsLinha.fatias) f.el.remove();
  hsLinha.fatias = [];
  hsLinha.ativa = -1;

  let acumulado = 0;
  const ds = [];
  for (const seg of linhaSegmentos(emPixels)) {
    for (const d of linhaSubdividir(seg, LINHA_PEDACOS)) ds.push(d);
  }

  for (const d of ds) {
    const el = document.createElementNS(LINHA_NS, 'path');
    el.setAttribute('d', d);
    hsLinha.svg.appendChild(el);

    const comp = el.getTotalLength();
    const dash = Math.ceil(comp) + 1;
    el.style.strokeDasharray = dash + ' ' + dash;

    const f = { el, inicio: acumulado, comp, dash, feito: -1 };
    hsLinhaFatiaEm(f, 0);          // nasce escondida
    hsLinha.fatias.push(f);
    acumulado += comp;
  }
  hsLinha.comprimento = acumulado;
}

/* Único lugar que escreve `stroke-dashoffset`. `feito` é o quanto DESTA fatia
   já está desenhado — em vez do offset invertido, que era fácil de trocar de
   sinal sem perceber. */
function hsLinhaFatiaEm(f, feito){
  if (f.feito === feito) return;
  f.feito = feito;
  f.el.style.strokeDashoffset = (f.dash - feito).toFixed(1);
}

/* TABELA DE X POR COMPRIMENTO — montada uma vez por layout, usada no quadro.

   Anda pelas próprias fatias, sem caminho-mestre escondido: a versão anterior
   mantinha um <path> a mais no DOM só pra servir de régua, e ele era a única
   razão de existir um `stroke: none` no meio do código.

   O X é forçado a crescer (Math.max) porque a curva pode recuar um triz nas
   viradas, e sem isso a busca binária ficaria ambígua. */
function hsLinhaMedirX(){
  const fatias = hsLinha.fatias;
  const total = hsLinha.comprimento;
  if (!fatias.length || total <= 0) { hsLinha.tabelaX = null; return; }

  const N = LINHA.amostras;
  const tabela = new Float32Array(N + 1);
  let fatia = 0, maiorX = -Infinity;

  for (let i = 0; i <= N; i++) {
    const s = total * i / N;
    while (fatia < fatias.length - 1 && s >= fatias[fatia].inicio + fatias[fatia].comp) fatia++;
    const f = fatias[fatia];
    const dentro = Math.min(f.comp, Math.max(0, s - f.inicio));
    maiorX = Math.max(maiorX, f.el.getPointAtLength(dentro).x);
    tabela[i] = maiorX;
  }

  hsLinha.tabelaX = tabela;
}

/* Põe as fatias no estado correspondente a `s` (comprimento de arco já
   percorrido). Só toca no que mudou: numa rolagem contínua isso é uma fatia
   por quadro, e nas travessias de emenda, duas. */
function hsLinhaAplicar(s){
  const fatias = hsLinha.fatias;
  if (!fatias.length) return;

  let ativa = hsLinha.ativa < 0 ? 0 : hsLinha.ativa;
  while (ativa > 0 && s < fatias[ativa].inicio) ativa--;
  while (ativa < fatias.length - 1 && s >= fatias[ativa].inicio + fatias[ativa].comp) ativa++;

  if (ativa !== hsLinha.ativa) {
    for (let i = 0; i < fatias.length; i++) {
      if (i === ativa) continue;
      // as de trás ficam inteiras, as da frente ficam escondidas
      hsLinhaFatiaEm(fatias[i], i < ativa ? fatias[i].comp : 0);
    }
    hsLinha.ativa = ativa;
  }

  const f = fatias[ativa];
  hsLinhaFatiaEm(f, Math.min(f.comp, Math.max(0, s - f.inicio)));
}


let hsLinhaRetentativa = 0;

function hsLinhaLayout(){
  if (!hsLinha) return;

  const W = window.innerWidth || 0;
  const H = hsTrack.getBoundingClientRect().height || window.innerHeight || 0;

  /* MEDIDA DEGENERADA NÃO VIRA DESENHO.

     Aqui já houve um `|| 1` nos dois valores, que parecia proteção e era o
     contrário: quando a janela reportava 0 — aba em segundo plano, momento do
     carregamento, ancestral ainda sem caixa —, o caminho era construído num
     painel de 1x1 pixel e o viewBox saía "0 0 5 1". Pior: o guarda de resize
     logo abaixo guardava essa medida como boa e não remontava mais, então um
     instante ruim no carregamento deixava a linha quebrada pra sempre.
     Medida inválida agora não é aceita: nada é construído e uma nova tentativa
     é agendada. */
  if (W < 2 || H < 2) {
    clearTimeout(hsLinhaRetentativa);
    hsLinhaRetentativa = setTimeout(hsLinhaLayout, 250);
    return;
  }

  /* Só remonta quando muda o que importa. A largura sempre importa; a altura
     só quando muda de verdade — ver `toleranciaDeAltura`. */
  const mudouLargura = W !== hsLinha.larguraMedida;
  const mudouAltura = hsLinha.alturaMedida > 0 &&
    Math.abs(H - hsLinha.alturaMedida) / hsLinha.alturaMedida > LINHA.toleranciaDeAltura;
  if (!mudouLargura && !mudouAltura && hsLinha.fatias.length) return;

  hsLinha.larguraMedida = W;
  hsLinha.alturaMedida = H;

  const traco = Math.min(LINHA.espessuraMax,
                Math.max(LINHA.espessuraMin, W / LINHA.espessuraDivisor));
  hsLinha.svg.setAttribute('viewBox', `0 0 ${W * hsPanelCount} ${H}`);
  hsLinha.svg.style.setProperty('--linha-traco', traco.toFixed(2) + 'px');

  hsLinhaFatiar(linhaPontos(W, H));
  hsLinhaMedirX();

  if (PREFERE_MENOS_MOVIMENTO) {
    /* sem movimento a linha aparece inteira, sem ser desenhada — e o `pronta`
       é o que impede o quadro de voltar a escondê-la */
    hsLinha.pronta = false;
    for (const f of hsLinha.fatias) hsLinhaFatiaEm(f, f.comp);
    return;
  }

  hsLinha.pronta = true;

  // devolve o desenho ao ponto em que estava: sem isto, todo resize (e toda
  // mexida na barra do navegador) apagaria a linha e recomeçaria do zero
  hsLinhaDesenhar(hsLinha.prog);
}


/* =========================================================================
   DESENHO — o quadro

   `prog` é o mesmo 0..1 que move o trilho, então linha e painéis são comandados
   pelo mesmo número e não têm como dessincronizar. Nada aqui lê layout: é uma
   busca binária sobre um Float32Array e uma escrita de estilo.
   ========================================================================= */

/* Acha a fração do comprimento cuja ponta está em `alvoX`. Oito comparações
   sobre as 256 amostras, sem tocar no DOM. */
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

/* Comprimento de arco já desenhado para um dado progresso do trilho.

   Era o miolo do `hsLinhaDesenhar`; virou função própria porque agora tem dois
   consumidores: o desenho quadro a quadro (onde o JavaScript ainda comanda) e
   o `hsLinhaLigarNoScroll`, que precisa INVERTER esta conta uma vez por layout
   para descobrir em que ponto da rolagem cada fatia é traçada. */
function hsLinhaArcoEm(prog){

  /* A PONTA DO LÁPIS É POSICIONADA NA JANELA, não no caminho.

     POR QUE MUDOU: antes a ponta ia do começo do caminho (-0,15 larguras) até
     o fim (5,00), proporcional ao progresso. Parece certo e não é, porque a
     JANELA também está andando — ela cobre de 4·prog a 4·prog+1. Fazendo a
     conta, a ponta ficava à esquerda da borda visível enquanto
     -0,15 + 5,15·prog < 4·prog, ou seja, até prog 0,13. Traduzindo: os
     primeiros 13% do scroll lateral não mostravam NADA, e a linha só brotava
     no meio do "MORE THAN A DEVELOPER". Era exatamente o que se via.

     Agora a ponta é medida A PARTIR DA BORDA ESQUERDA DA JANELA, e não do
     caminho. `entradaEm` é onde ela está quando o painel começa a andar,
     `saidaEm` onde ela termina — os dois em larguras de painel, contados da
     borda esquerda da tela. Como a conta já embute o deslocamento da janela,
     a ponta não tem mais como ficar para trás dela.

     A CURVA É RÁPIDA NAS PONTAS E LENTA NO MEIO, e isso resolve os dois
     problemas de uma vez. Só desacelerar no fim (que foi a primeira tentativa)
     colava a ponta na borda direita a partir de uns 75% do percurso: a ponta
     ficava fora da tela até o painel chegar, então você via a linha PRONTA em
     vez de vê-la sendo feita. Só acelerar no começo trazia de volta o atraso
     na entrada.

     Aqui a ponta corre nas duas bordas e passeia devagar pelo miolo:

        prog     0.05    0.25    0.50    0.75    1.00
        na tela    5%     34%     48%     61%     100%

     Ela entra logo, atravessa a parte central sempre com meia tela de espaço
     em branco na frente — que é onde o desenho acontece à vista — e só corre
     pra borda direita no fim, fechando o traço em cima do último painel.
     Com `aceleracao: 1` a curva vira uma reta e some tudo isso. */
  const janela = (hsPanelCount - 1) * prog;          // borda esquerda, em larguras
  const meio = 2 * prog - 1;                         // -1 na entrada, +1 na saída
  const entrada = 0.5 + 0.5 * Math.sign(meio) * Math.pow(Math.abs(meio), LINHA.aceleracao);
  const desloc = LINHA.entradaEm + (LINHA.saidaEm - LINHA.entradaEm) * entrada;

  const alvoX = (janela + desloc) * hsLinha.larguraMedida;
  const fracao = Math.max(0, Math.min(1, hsLinhaFracaoEm(alvoX)));
  return fracao * hsLinha.comprimento;
}

function hsLinhaDesenhar(prog){
  if (!hsLinha) return;
  hsLinha.prog = prog;
  /* Com as fatias ligadas à rolagem, quem escreve o `stroke-dashoffset` é o
     navegador — e ele o faz no mesmo quadro em que o trilho anda, que é o
     ponto todo. Ver `hsLinhaLigarNoScroll`. */
  if (HS_CSS_MOVE) return;
  if (!hsLinha.pronta || !hsLinha.tabelaX) return;
  hsLinhaAplicar(hsLinhaArcoEm(prog));
}

/* =========================================================================
   CADA FATIA GANHA A SUA FAIXA DE ROLAGEM

   ESTE É O CONSERTO DO ÚLTIMO TELETRANSPORTE, e a explicação é a mesma que já
   apareceu três vezes neste arquivo, agora no último lugar onde ela ainda
   valia.

   O trilho passou a ser movido pelo compositor, a partir do deslocamento
   verdadeiro da rolagem. A linha continuava sendo desenhada aqui, a partir do
   `window.scrollY` lido na thread principal. No iOS a rolagem acontece em
   outro processo e esse número chega atrasado — normalmente por pouco, às
   vezes por vários quadros. Enquanto o painel deslizava certinho, a ponta do
   lápis ficava para trás e depois pulava para alcançá-lo. Não era o painel que
   se teletransportava: era o traço em cima dele.

   Duas contas diferentes, lidas de dois lugares diferentes, nunca ficam
   juntas. A saída é não ter duas contas: as fatias passam a ser animadas pela
   MESMA `scroll(root block)` do trilho, então elas são amostradas no mesmo
   quadro, do mesmo valor. Ficar fora de sincronia deixa de ser possível.

   COMO A FAIXA DE CADA FATIA É ENCONTRADA: o percurso do lápis não é linear no
   progresso (há a curva de entrada e saída do `LINHA.aceleracao`, e o
   comprimento de arco não acompanha o X), então não dá para dividir a régua em
   partes iguais. A conta é invertida por amostragem: varre-se o progresso de 0
   a 1 e anota-se em que ponto o arco desenhado cruza a fronteira de cada
   fatia. Como o arco só cresce, uma passada resolve todas.

   Dentro de UMA fatia a interpolação volta a ser linear, e isso é exato o
   bastante: são 80 a 105 fatias, cada uma cobrindo cerca de 1% do traço.
   ========================================================================= */
const LINHA_AMOSTRAS_FAIXA = 900;

function hsLinhaLigarNoScroll(){
  if (!hsLinha || !hsLinha.pronta || !hsLinha.tabelaX) return;

  const fatias = hsLinha.fatias;
  if (!fatias.length) return;

  const span = hsParadaDoc - hsInicioDoc;
  if (span <= 0) return;

  const marcos = new Float64Array(fatias.length + 1);
  const fronteira = (i) => (i < fatias.length ? fatias[i].inicio : hsLinha.comprimento);

  let alvo = 0;
  for (let i = 0; i <= LINHA_AMOSTRAS_FAIXA && alvo <= fatias.length; i++) {
    const s = hsLinhaArcoEm(i / LINHA_AMOSTRAS_FAIXA);
    while (alvo <= fatias.length && s >= fronteira(alvo)) marcos[alvo++] = i / LINHA_AMOSTRAS_FAIXA;
  }
  while (alvo <= fatias.length) marcos[alvo++] = 1;

  for (let i = 0; i < fatias.length; i++) {
    const f = fatias[i];
    const a = hsInicioDoc + marcos[i] * span;
    const b = Math.max(hsInicioDoc + marcos[i + 1] * span, a + 0.5);
    const e = f.el.style;

    /* escondida -> offset = dash; inteira -> offset = dash - comprimento.
       São os mesmos dois valores do `hsLinhaFatiaEm`, só que agora entregues
       aos quadros da animação em vez de escritos a cada rolagem. */
    e.setProperty('--dash', f.dash + 'px');
    e.setProperty('--feito', (f.dash - f.comp).toFixed(2) + 'px');
    e.animationName = 'hsLinhaDesenha';
    e.animationTimingFunction = 'linear';
    e.animationFillMode = 'both';
    e.animationDuration = 'auto';
    e.animationTimeline = 'scroll(root block)';
    e.animationRange = a.toFixed(1) + 'px ' + b.toFixed(1) + 'px';
  }
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

/* A ALTURA DE REFERÊNCIA DO PIN NÃO PODE SER `window.innerHeight`.

   Esta é a única altura do site que o JAVASCRIPT escreve na página — todo o
   resto sai de `vh`/`svh`, que são fixos. E ela entra na conta TRÊS vezes
   (a tela presa, a tela de pausa e a fração do EXTRA_PIN_VH), ou seja, cada
   pixel de diferença aqui vira 2,2 pixels de altura de documento.

   No celular a barra do navegador recolhe e volta durante a rolagem, e nesse
   instante `innerHeight` muda: num iPhone 14 ela vai de 664 para 745. O
   navegador dispara `resize`, o hsLayout roda de novo e a seção do "sobre"
   passa de 2448px para 2626px — a página inteira abaixo dela, PROJETOS,
   STACK e CONTATO, desliza 178px enquanto o dedo está no meio do gesto.

   Por que só aparecia no iPhone, e só perto da Contact:

     · no desktop não existe barra retrátil, então `resize` nunca acontece
       durante o scroll e a altura jamais se mexe;
     · o Chrome do Android implementa SCROLL ANCHORING — ele percebe que o
       conteúdo acima da tela mudou de tamanho e compensa a posição sozinho,
       de modo que nada se move na tela. O WebKit não implementa;
     · a barra do Safari fica recolhida durante toda a descida e volta a
       aparecer justamente ao CHEGAR NO FIM DA PÁGINA — que é onde mora a
       Contact. É ali que o recolhe-e-volta acontece, e é ali que a página
       salta para cima e depois para baixo. Pior: encurtando o documento no
       fim do percurso, o Safari ainda precisa grampear o scroll para não
       passar do último pixel, e esse grampo é o "teletransporte" seco.

   A medida certa já existe e é a da PRÓPRIA TELA PRESA: o CSS declara
   `.hs-track`/`.hs-sticky` em `100svh` exatamente para isso ("Com svh ele
   fica quieto", diz o comentário lá). `svh` é a menor altura que a tela pode
   ter — com a barra à mostra — e não muda quando ela recolhe. Lendo a altura
   do trilho em vez de perguntar ao `window`, a conta passa a usar o mesmo
   número que o pino ocupa de verdade, e o documento para de respirar.

   No desktop `svh`, `vh` e `innerHeight` são o mesmo número (conferido: 720
   nos três), então lá nada muda — nem a altura da seção, nem o ritmo dos
   painéis, nem um pixel de layout. É a mesma fonte de medida que o
   `hsLinhaLayout` logo acima já usa, então os dois também deixam de poder
   discordar.

   O último valor bom é guardado: se o trilho for medido num instante em que
   ele ainda não tem caixa (aba em segundo plano, carregamento), a conta usa
   o que já sabia em vez de zerar a seção. */
let hsAlturaTela = 0;

function medirAlturaDaTelaPresa(){
  const h = hsTrack.getBoundingClientRect().height;
  if (h > 1) hsAlturaTela = h;
  else if (!hsAlturaTela) hsAlturaTela = window.innerHeight || 0;
  return hsAlturaTela;
}

/* MEDIDA DEGENERADA NÃO VIRA ALTURA — o mesmo cuidado que o `hsLinhaLayout`
   logo acima já tomava, e que faltava aqui.

   Toda a altura da seção sai de duas medidas: a largura da janela e a altura
   do trilho. Quando as duas chegam zeradas — aba aberta em segundo plano, o
   instante do carregamento, um ancestral ainda sem caixa — a conta devolve
   zero e o `#hsOuter` recebe `height: 0px`. E aí a seção do scroll horizontal
   deixa de existir: o pin não tem percurso, os painéis nunca andam, a linha
   nunca é desenhada e a página inteira abaixo sobe 4800px.

   Foi o que se mediu nesta página aberta com a aba ao fundo: `hsAltura` 0,
   `hsOuter.style.height` "0px". Junto com a trava do agendador (ver o
   comentário do `idQuadro` na Agenda), o estrago era permanente, porque o
   resize que consertaria nunca era processado.

   Zero não é uma medida: é a ausência dela. Nada é escrito e uma nova
   tentativa é agendada. */
let hsLayoutRetentativa = 0;

function hsLayout(){
  hsLinhaLayout();   // o caminho é remontado junto com o layout do trilho

  const W = window.innerWidth || 0;
  const H = medirAlturaDaTelaPresa();

  if (W < 2 || H < 2) {
    clearTimeout(hsLayoutRetentativa);
    /* refaz a SEQUÊNCIA inteira, e não só esta função: a geometria do trilho e
       o alvo do pin saem das mesmas medidas que acabaram de faltar */
    hsLayoutRetentativa = setTimeout(() => hsRefazerLayout(true), 250);
    return;
  }
  clearTimeout(hsLayoutRetentativa);

  const percurso = (hsPanelCount - 1) * W;
  const rolagemHorizontal = percurso / VELOCIDADE_PAINEL;

  // + 1 tela de pin padrão + EXTRA_PIN_VH telas de pausa + a própria tela presa
  hsAltura = Math.round(rolagemHorizontal + H * (1 + EXTRA_PIN_VH) + H);
  hsOuter.style.height = hsAltura + 'px';

  /* OS TRÊS NÚMEROS QUE A ANIMAÇÃO DO CSS PRECISA (ver o bloco
     `animation-timeline` no css/estilo.css).

       --hs-percurso  quanto o trilho anda de ponta a ponta, em px;
       --hs-inicio    a posição de rolagem em que ele começa a andar;
       --hs-parada    a posição em que ele termina e a pausa começa.

     Os dois últimos são POSIÇÕES DE ROLAGEM em coordenadas do documento, e
     não frações da tela — é isso que deixa a animação imune à barra de
     endereço do celular, que muda a altura da tela no meio do gesto.

     Escritos em TODO layout, e não só quando o CSS está no comando: custa três
     escritas por resize e evita que as variáveis fiquem velhas se o aparelho
     mudar de categoria (girar um tablet, plugar um mouse). */
  hsPercurso = percurso;

  /* A ÂNCORA SAI DO LAYOUT PURO, SEM A POSIÇÃO DE ROLAGEM NA CONTA.

     Aqui estava `rect.top + scrollY`, que dá o mesmo número — desde que as
     duas leituras enxerguem o mesmo instante. No iPhone elas nem sempre
     enxergam: a barra de endereço recolhe, o Safari ajusta a rolagem para
     manter o conteúdo no lugar, e por uma fração de segundo o `rect.top` já é
     o novo e o `scrollY` ainda é o antigo (ou o contrário). A soma sai errada
     pela altura da barra, a âncora inteira desliza e o trilho salta.

     A soma dos `offsetTop` até a raiz é geometria pura: não passa perto da
     rolagem, então não tem como discordar dela. Confere com a outra conta ao
     pixel quando as duas estão em dia. */
  let topo = 0;
  for (let el = hsOuter; el; el = el.offsetParent) topo += el.offsetTop;
  hsInicioDoc = Math.round(topo);
  hsParadaDoc = hsInicioDoc + Math.max(rolagemHorizontal, 1);

  hsTrack.style.setProperty('--hs-percurso', percurso.toFixed(2) + 'px');
  hsTrack.style.setProperty('--hs-inicio', hsInicioDoc + 'px');
  hsTrack.style.setProperty('--hs-parada', hsParadaDoc + 'px');

  /* A altura acabou de mudar, então o percurso e o progresso também mudaram:
     o próximo quadro tem de desenhar mesmo que o trilho esteja no mesmo px. */
  hsDesenhado = NaN;
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
/* A posição do painel é calculada, não medida. O `hsRender` escreve o
   transform do trilho e logo em seguida precisaria do rect dos painéis — ler
   layout depois de escrever nele força o navegador a recalcular a página ali
   mesmo. E não era uma vez por quadro: o lerp repete enquanto o trilho não
   assenta.

   Mas os painéis são irmãos de larguras iguais num flex sem espaçamento, e o
   trilho só anda na horizontal:

       esquerda do painel i = borda do trilho + i * largura - deslocamento

   A borda e a largura só mudam no resize (`medirGeometriaDoTrilho`); o
   deslocamento é o `hsCurrent`, que já está na mão. */
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

/* Quantas larguras de painel o efeito do jardim leva para acontecer. Estava
   dentro do `atualizarProgressoPaineis`; subiu porque o `ligarCenaNoScroll`
   inverte a mesma conta e os dois têm de usar o mesmo número. A explicação da
   régua está lá embaixo, junto do uso original. */
const PERCURSO_PAINEL = 1.35;

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

/* As animações do scroll são movidas por `currentTime`, não por uma variável
   CSS. Escrever `--prog` no painel invalidava o estilo de 61 elementos (as 4
   flores com as suas 24 formas de SVG, as 8 letras do "DEVELOP" e a régua de
   build) em TODO quadro de rolagem: 0,70ms medidos aqui, contra 0,10ms por
   `currentTime`. Mesmas animações, mesmos keyframes, mesmo resultado.

   Os números continuam no CSS, que é onde se calibra o efeito: `--ini` de cada
   flor vem do HTML, o começo e o passo das letras de `--dev-inicio`/
   `--dev-passo`, e a duração sai da própria animação. Nada repetido dos dois
   lados para sair de sincronia. */
function coletarCena(painel){
  const itens = [];

  const anim = (el) => el.getAnimations().find((a) => a.playState !== 'finished') || el.getAnimations()[0];

  for (const flor of painel.querySelectorAll('.flor')) {
    const a = anim(flor);
    if (!a) return null;                     // o CSS ainda não pegou: tenta no próximo quadro
    itens.push({ a, el: flor, inicio: parseFloat(getComputedStyle(flor).getPropertyValue('--ini')) || 0 });
  }

  const letras = painel.querySelectorAll('.dv-letra');
  if (letras.length) {
    const cs = getComputedStyle(painel);
    const inicio = parseFloat(cs.getPropertyValue('--dev-inicio')) || 0;
    const passo  = parseFloat(cs.getPropertyValue('--dev-passo'))  || 0;

    letras.forEach((letra, i) => {
      const a = anim(letra);
      if (a) itens.push({ a, el: letra, inicio: inicio + i * passo });
    });
    if (itens.length !== letras.length) return null;

    const barra = painel.querySelector('.build-barra i');
    const ab = barra && anim(barra);
    if (ab) itens.push({ a: ab, el: barra, inicio });
  }

  if (!itens.length) return null;

  for (const it of itens) {
    const d = it.a.effect.getTiming().duration;
    it.duracao = typeof d === 'number' && isFinite(d) ? d : 0;
    /* Pausar só faz sentido quando é este arquivo que vai empurrar o ponteiro.
       Ligadas à rolagem, elas continuam correndo — quem decide o instante é a
       faixa de cada uma. */
    if (!HS_CSS_MOVE) it.a.pause();
  }
  return itens;
}

/* =========================================================================
   O JARDIM TAMBÉM VAI PARA A ROLAGEM

   Mesma história da linha desenhada, e pelo mesmo motivo: escrever
   `currentTime` a partir do `window.scrollY` da thread principal enquanto o
   trilho é movido pelo compositor é ter duas réguas, e duas réguas
   inevitavelmente discordam. Cada flor, cada letra do "DEVELOP" e a régua de
   build ganham a sua própria faixa de rolagem e passam a ser amostradas junto
   com o painel em que estão.

   A CONTA É A INVERSA DA QUE JÁ EXISTIA. O `atualizarProgressoPaineis` faz:

       prog = (largura - esquerda) / (largura * PERCURSO_PAINEL)
       esquerda = borda do trilho + i * largura do painel - deslocamento

   Como o deslocamento é `P * hsPercurso`, `prog` é LINEAR em P — e uma reta se
   inverte sem aproximação nenhuma. Dado o `--ini` de um elemento, sai o P em
   que ele começa; do P sai a posição de rolagem. É a mesma calibração do HTML,
   lida do outro lado.
   ========================================================================= */
function ligarCenaNoScroll(item, largura){
  const span = hsParadaDoc - hsInicioDoc;
  if (span <= 0 || !hsPercurso) return false;

  const rolagemEm = (prog) => {
    const deslocamento = prog * largura * PERCURSO_PAINEL - largura
                       + trilhoEsquerda + item.idx * trilhoLarguraPainel;
    return hsInicioDoc + (deslocamento / hsPercurso) * span;
  };

  for (const it of item.cena) {
    if (!it.el) continue;
    const a = rolagemEm(it.inicio);
    const b = Math.max(rolagemEm(it.inicio + it.duracao / 1000), a + 0.5);
    const e = it.el.style;
    e.animationDelay = '0s';
    e.animationDuration = 'auto';
    e.animationFillMode = 'both';
    e.animationPlayState = 'running';
    e.animationTimeline = 'scroll(root block)';
    e.animationRange = a.toFixed(1) + 'px ' + b.toFixed(1) + 'px';
  }
  return true;
}

/* A coleta é adiada porque as animações só existem depois que o CSS resolve —
   e num caso ela nunca vai existir: com "reduzir movimento" ligado o jardim é
   `display: none` e a classe `dev-scrub` nunca entra, então não há animação
   nenhuma para pegar. Sem um teto, este caminho ficaria varrendo o DOM em todo
   quadro de rolagem à procura de algo que não vem. Depois de 120 tentativas
   (uns dois segundos de rolagem) o painel é marcado como "sem cena" e sai da
   conta de vez. */
function posicionarCena(item, prog){
  if (item.cena === false) return;

  if (!item.cena) {
    item.cena = coletarCena(item.el);
    if (!item.cena) {
      if ((item.tentativas = (item.tentativas || 0) + 1) > 120) item.cena = false;
      return;
    }
  }

  for (let i = 0; i < item.cena.length; i++) {
    const it = item.cena[i];
    const t = (prog - it.inicio) * 1000;
    it.a.currentTime = t < 0 ? 0 : (t > it.duracao ? it.duracao : t);
  }
}

function atualizarProgressoPaineis(){
  if (!paineisComProgresso.length) return;
  if (!trilhoLarguraPainel) medirGeometriaDoTrilho();

  const largura = Agenda.w || 1;

  /* NO CAMINHO DO COMPOSITOR NÃO HÁ NADA A MOVER POR QUADRO.

     Cada elemento do jardim recebeu a sua faixa de rolagem e é o navegador que
     o anima, junto com o painel em que ele está. O que resta aqui é garantir
     que a ligação foi feita — e ela é feita UMA vez por elemento, assim que as
     animações do CSS passam a existir (o que não acontece no primeiro quadro).
     Depois disso este laço não escreve mais nada. */
  if (HS_CSS_MOVE) {
    for (const item of paineisComProgresso) {
      if (item.ligado || item.cena === false) continue;

      if (!item.cena) {
        item.cena = coletarCena(item.el);
        if (!item.cena) {
          if ((item.tentativas = (item.tentativas || 0) + 1) > 120) item.cena = false;
          continue;
        }
      }

      if (ligarCenaNoScroll(item, largura)) item.ligado = true;
    }

    hsFaltaLigar = paineisComProgresso.some((it) => !it.ligado && it.cena !== false);
    return;
  }

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
  const PERCURSO = PERCURSO_PAINEL;

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

    posicionarCena(item, passo);
  }
}

/* O lerp existe só onde resolve: ele amortece o pulo de ~100px de cada clique
   da roda do mouse. No toque o dedo já entrega movimento contínuo e o navegador
   ainda dá a inércia por cima, então lá o trilho acompanha o scroll direto —
   amortecer o que já é suave só custaria os quadros da cauda. */
const HS_SUAVIZA = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/* O AMORTECIMENTO É POR TEMPO, NÃO POR QUADRO.

   O 0.12 é o valor original e continua valendo: ele é a fração do caminho que
   o trilho anda A CADA QUADRO DE 60Hz. O problema é que ele era aplicado uma
   vez por quadro, fosse qual fosse a duração do quadro — e aí a constante de
   tempo do amortecimento passava a depender do monitor e do humor do aparelho:

     · 60Hz  -> ~130ms de cauda (o que foi calibrado)
     · 120Hz -> ~65ms: metade da suavização, o pulo da roda volta a aparecer
     ·  30Hz -> ~260ms: o DOBRO do atraso, e justamente no aparelho que já
                está sofrendo. É esse laço que faz a rolagem parecer "de
                gelatina" quando o quadro cai — quanto pior o desempenho,
                mais lerdo o trilho fica, e mais lerdo ele PARECE.

   `1 - (1 - k)^(dt/16.667)` desfaz isso: em 16,667ms o resultado é exatamente
   0.12, então a 60Hz não muda um pixel do que já existia; em 8,3ms ele dá
   0,062 e dois quadros de 120Hz somam o mesmo caminho de um de 60Hz. A cauda
   passa a durar o mesmo tempo em qualquer tela, que é o que se calibrou.

   O teto de 100ms no dt é para a volta de uma aba em segundo plano: sem ele o
   primeiro quadro depois da pausa traria um dt gigante, o fator saturaria em 1
   e o trilho daria um salto seco até o alvo. */
const HS_SUAVIDADE = 0.12;   // por quadro a 60Hz — o número original
const HS_QUADRO_60 = 1000 / 60;
const HS_DT_MAX = 100;
let hsUltimoT = 0;

/* Escreve o estado do trilho. NÃO lê layout — nem aqui, nem no que ele chama:
   o `atualizarProgressoPaineis` faz aritmética sobre medidas do resize e o
   `hsLinhaDesenhar` só escreve currentTime. É o que permite esta função morar
   na passada de desenho, depois de todo mundo ter medido. */
function hsDesenhar(){
  /* Com o CSS no comando o transform vem da animação ligada à rolagem, e uma
     escrita inline aqui seria ignorada de qualquer forma (animação ganha de
     estilo inline na cascata). Pular a escrita economiza a invalidação. */
  if (!HS_CSS_MOVE) hsTrack.style.transform = `translate3d(${-hsCurrent}px, 0, 0)`;
  atualizarProgressoPaineis();
  hsLinhaDesenhar(hsPercurso ? hsCurrent / hsPercurso : 0);
}

/* Desenha só se o trilho de fato saiu do lugar desde a última vez.

   O `hsRender` mora na passada de desenho da Agenda, então ele roda em TODO
   quadro de rolagem da página — inclusive nos 3200px de hero, projetos, stack
   e contato, onde o trilho está parado no mesmo pixel há muito tempo. E ele
   redesenhava assim mesmo: reescrevia o transform, varria os painéis e
   recalculava a posição da ponta da linha para chegar, toda vez, exatamente no
   estado em que já estava. Uma comparação de dois números apaga esse trabalho
   inteiro fora da seção. */
function hsAplicar(){
  if (hsCurrent === hsDesenhado) return;
  hsDesenhado = hsCurrent;
  hsDesenhar();
}

/* O RITMO DO CONTEÚDO NÃO PODE SER O RITMO DOS EVENTOS DE SCROLL.

   Esta é a outra metade do conserto do celular, e sem ela o primeiro conserto
   fica pela metade — foi exatamente o que se viu: o trilho liso e o que está
   dentro dele engasgando.

   O trilho agora é movido pelo compositor, que entrega 60 ou 120 quadros por
   segundo. Mas a linha desenhada e o jardim dos painéis continuam sendo
   posicionados aqui, e este código só acordava quando chegava um EVENTO de
   scroll. Durante o arremesso de um dedo o iOS entrega esses eventos aos
   punhados — algo como 20 por segundo, e em rajadas. Resultado: o painel
   deslizando a 120Hz com o conteúdo dele atualizando a 20Hz. Não é queda de
   FPS, mas é indistinguível de uma.

   `window.scrollY`, por outro lado, está sempre em dia: quem o atualiza é o
   compositor, evento ou não. Basta pedir quadros por conta própria enquanto a
   seção estiver à vista e ler a posição em cada um deles — o conteúdo passa a
   andar no mesmo ritmo do trilho.

   O contador de parada existe para isto não virar um laço eterno: com a
   página quieta, doze quadros sem mudança (uns 200ms) e a bomba desliga
   sozinha. O próximo evento de scroll religa. Ou seja, ela roda enquanto há
   movimento e some quando não há.

   Vale para TODO celular, e não só para os que têm `animation-timeline`. Onde
   o CSS não assume, quem move o trilho é este mesmo código — e aí ele sofre
   duas vezes com o ritmo dos eventos: no trilho e no conteúdo. A bomba é o
   que ele tem. Por isso a única condição aqui é a seção estar à vista: quem
   decide que isto é um aparelho de toque é o caminho que chama a função, que
   só existe no ramo sem amortecimento.

   No desktop ela nunca é chamada: lá o evento de scroll já chega uma vez por
   quadro, e quem sustenta a cauda do lerp é o `Agenda.pedirQuadro` do próprio
   lerp. */
const HS_PARADA_MAX = 12;
let hsQuadrosParados = 0;
let hsYAnterior = -1;

function hsBombear(){
  if (!hsVisivel) return;

  /* Com a linha e o jardim ligados à rolagem, não sobra nada para atualizar
     por quadro: o trilho, o traço e as flores são todos amostrados pelo
     compositor, do mesmo valor e no mesmo quadro. A bomba existia para o
     conteúdo acompanhar o trilho, e o conteúdo não precisa mais dela.

     Ela continua valendo nos aparelhos de toque SEM `animation-timeline`, onde
     este arquivo ainda é quem move tudo. */
  if (HS_CSS_MOVE && !hsFaltaLigar) return;

  const y = Agenda.y;
  if (y !== hsYAnterior) {
    hsYAnterior = y;
    hsQuadrosParados = 0;
  } else if (++hsQuadrosParados >= HS_PARADA_MAX) {
    return;
  }
  Agenda.pedirQuadro();
}

function hsRender(){
  if (!HS_SUAVIZA) {
    hsCurrent = hsTarget;
    hsAplicar();
    hsBombear();
    return;
  }

  /* já assentado: nada de lerp, nada de desenho, nada de pedir outro quadro.
     O relógio zera para que o próximo movimento comece com um dt limpo. */
  if (hsCurrent === hsTarget) {
    hsUltimoT = 0;
    hsAplicar();
    return;
  }

  const agora = performance.now();
  const dt = hsUltimoT ? Math.min(agora - hsUltimoT, HS_DT_MAX) : HS_QUADRO_60;
  hsUltimoT = agora;

  // ver HS_SUAVIDADE: a 60Hz este fator é o 0.12 de sempre
  hsCurrent += (hsTarget - hsCurrent) *
               (1 - Math.pow(1 - HS_SUAVIDADE, dt / HS_QUADRO_60));

  if (Math.abs(hsTarget - hsCurrent) > 0.5) {
    hsAplicar();
    /* o dedo/roda já parou mas o lerp ainda tem caminho: pede o próximo quadro
       pela Agenda, para continuar dentro do mesmo ciclo de todo mundo */
    Agenda.pedirQuadro();
  } else {
    hsCurrent = hsTarget;
    hsAplicar();
  }
}

function hsUpdate(){
  /* COM O CSS NO COMANDO, A CONTA É EXATAMENTE A MESMA DA ANIMAÇÃO.

     A linha desenhada e o jardim dos painéis continuam sendo posicionados
     aqui, e eles precisam concordar com onde o trilho de fato está — se as
     duas contas divergirem em um por cento que seja, a ponta do lápis descola
     do painel e o efeito se desmancha.

     Por isso a conta usa as MESMAS duas âncoras que foram para o CSS, e nada
     mais: nem altura de tela, nem altura da seção. Duas posições de rolagem e
     uma regra de três. */
  if (HS_CSS_MOVE) {
    const p = Math.min(Math.max(
      (Agenda.y - hsInicioDoc) / (hsParadaDoc - hsInicioDoc), 0), 1);
    hsTarget = p * hsPercurso;
    return;
  }

  /* Só o caminho de JavaScript precisa do rect — e ele fica DEPOIS da saída
     acima de propósito: no celular esta função roda em todo quadro, e uma
     leitura de layout que ninguém usa é uma leitura a menos que se pode ter. */
  const rect = hsOuter.getBoundingClientRect();

  // hsAltura no lugar de hsOuter.offsetHeight: mesmo número, sem leitura de layout
  /* `hsAlturaTela`, e não `window.innerHeight`, PELO MESMO MOTIVO do hsLayout
     — e aqui a consistência é obrigatória, não preferência: esta conta desfaz
     a que montou o hsAltura. Com dois números diferentes ela não devolve o
     percurso desenhado. Medido num iPhone com a barra recolhida, o `total`
     saía com 745 onde o hsAltura tinha usado 664, e o percurso horizontal
     encolhia de 987px para 809px: os painéis andavam 22% mais rápido do que o
     projetado e a faixa fechava antes da hora, mudando de ritmo toda vez que
     a barra do navegador ia e voltava. Com a mesma altura dos dois lados a
     conta se fecha exata no percurso desenhado, em qualquer aparelho.
     Continua sendo leitura de variável, não de layout — o custo por quadro é
     o mesmo de antes. */
  const total = hsAltura - hsAlturaTela;

  // reserva (1 + EXTRA_PIN_VH) telas pro pin/pausa, sem esticar o ritmo do scroll horizontal
  const horizontalTotal = Math.max(total - hsAlturaTela * (1 + EXTRA_PIN_VH), 1);
  const progress = Math.min(Math.max(-rect.top / horizontalTotal, 0), 1);

  hsTarget = progress * hsPercurso;
}

/* Tudo o que depende de uma medida da janela, na ordem: a altura da seção
   (que é o percurso do pin), a geometria do trilho e o alvo. É a mesma
   sequência do resize e da retentativa do `hsLayout` — um lugar só, para as
   três não poderem sair de sincronia. */
/* A BARRA DE ENDEREÇO DO CELULAR NÃO É UM RESIZE DE VERDADE.

   E é ela a causa do salto que sobrava. No iPhone, recolher ou mostrar a barra
   dispara `resize` — dezenas de vezes durante uma rolagem, sempre no instante
   em que se solta o dedo. Cada um desses eventos refazia o layout inteiro da
   seção: reescrevia a altura do `#hsOuter`, remedia a âncora, recalculava o
   percurso. Tudo isso no meio do gesto, com a página em movimento.

   O que a seção realmente precisa saber é: a LARGURA mudou (o percurso é
   medido em larguras de painel) ou a altura presa mudou de verdade (girar o
   aparelho)? A barra de endereço não muda nem uma nem outra — a largura fica
   igual e a altura presa é `100svh`, que por definição já é a altura COM a
   barra à mostra e não se mexe quando ela recolhe.

   O piso de 5% na altura é a folga: separa a barra do navegador (uns 8% numa
   tela de celular, mas sem tocar no svh) de uma rotação de tela, que muda
   tudo. Qualquer mudança real passa; a barra não passa. */
let hsLarguraLayout = -1;
let hsAlturaLayout = -1;

function hsRefazerLayout(forcar){
  const W = window.innerWidth || 0;
  const H = medirAlturaDaTelaPresa();

  /* Mesma ressalva da onda: no computador todo resize é de verdade e passa. */
  if (!forcar && APARELHO_DE_TOQUE &&
      W === hsLarguraLayout && hsAlturaLayout > 0 &&
      Math.abs(H - hsAlturaLayout) / hsAlturaLayout < 0.05) {
    return;
  }

  hsLarguraLayout = W;
  hsAlturaLayout = H;

  hsLayout();
  medirGeometriaDoTrilho();
  hsUpdate();

  /* As faixas de rolagem são medidas em pixels do documento, então TODAS elas
     mudam quando o layout muda. Refazer as ligações é o que impede a linha e o
     jardim de continuarem apontando para a página antiga. */
  if (HS_CSS_MOVE) {
    hsLinhaLigarNoScroll();
    for (const item of paineisComProgresso) item.ligado = false;
    hsFaltaLigar = true;
  }

  atualizarProgressoPaineis();
}

hsRefazerLayout(true);

/* O .hs-sticky não rola mais sozinho em largura nenhuma — quem move os
   painéis é sempre o pin, comandado pelo scroll da janela. O ouvinte de
   scroll dele e a dica "arraste →" saíram junto com o fallback: não há mais
   arrasto lateral pra ouvir, e avisar pra arrastar seria mentira. */
Agenda.scroll(hsUpdate);      // mede
Agenda.pintar(hsRender);      // desenha, depois de todas as medidas

/* A CAMADA DE GPU DO TRILHO SÓ EXISTE PERTO DA SEÇÃO.

   O `will-change: transform` do `.hs-track` (css/estilo.css) reserva uma
   camada de 5 telas de largura. Deixá-la de pé a visita inteira é memória de
   vídeo parada por causa de uma seção que ocupa um quinto da página — e num
   celular é justamente essa memória que falta.

   A margem é de UMA TELA para cada lado: a camada nasce e morre longe da
   vista, então o repintar que a troca custa nunca cai num quadro que alguém
   esteja olhando. Sem observer (navegador antigo), a classe entra de vez e o
   comportamento volta a ser o de antes — nada quebra. */
(function hsPromoverTrilho(){
  if (!('IntersectionObserver' in window)) {
    hsOuter.classList.add('hs-perto');
    hsVisivel = true;
    return;
  }

  new IntersectionObserver((entradas) => {
    const perto = entradas[0].isIntersecting;
    hsOuter.classList.toggle('hs-perto', perto);
    hsVisivel = perto;
    /* ao entrar, dá o primeiro empurrão: a bomba se sustenta a partir daí */
    if (perto) Agenda.pedirQuadro();
  }, { rootMargin: '100% 0px' }).observe(hsOuter);
})();

/* Aqui havia um SEGUNDO ouvinte de scroll chamando `atualizarProgressoPaineis`
   direto, sem passar por requestAnimationFrame nenhum — ou seja, medindo o
   layout a cada evento de scroll, que chega bem mais vezes que quadro. E era
   redundante: o hsUpdate agenda o hsRender, e o hsRender já chama essa mesma
   função. Saiu.

   As duas medidas do trilho são refeitas no resize, que é a única coisa capaz
   de mudá-las. */
Agenda.resize(hsRefazerLayout);

/* A restauração de posição do navegador (F5 no meio da página) acontece depois
   do script e nem sempre vem acompanhada de um evento de scroll. Sem um quadro
   aqui, o trilho ficaria no zero com a página já dentro da seção — os painéis
   parados no primeiro e a linha por desenhar, até o primeiro gesto. */
window.addEventListener('load', () => {
  hsRefazerLayout(true);
  Agenda.pedirQuadro();
}, { once: true });



/* =========================================================================
   PAINÉIS "I DESIGN." E "I DEVELOP."

   Só liga e desliga a classe que dispara as animações; o efeito mora no CSS.
   Sem `unobserve` de propósito: a pessoa passa por eles indo e voltando, e
   repor a classe faz a animação tocar de novo a cada visita.
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

  /* Range, e não o rect do elemento: o <h2> é um bloco e ocupa a linha inteira,
     então centralizar a tinta nele jogava a âncora pro meio do painel em vez de
     encostar na letra. */
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

  /* Os deslocamentos do data-ancora são px medidos com a palavra a 230,4px
     (uma tela de ~1440). Escalando pelo corpo da letra, o mesmo número passa a
     significar "tantas letras de distância" e o encaixe se mantém em qualquer
     tela — no celular a palavra tem uns 50px e um "+162px" fixo jogava a flor a
     três larguras de letra do alvo. */
  const FONTE_DE_REFERENCIA = 230.4;

  function escalaDoTexto(){
    const fs = parseFloat(getComputedStyle(letras[0]).fontSize);
    return fs > 0 ? fs / FONTE_DE_REFERENCIA : 1;
  }

  /* A referência é o .jardim, não o painel: no celular ele leva `inset: 0 11%`
     e as duas caixas não coincidem. */
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

  /* O olho fica no último painel do scroll horizontal: quase toda a página ele
     está fora da tela. O observer é a chave geral. */
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

    /* Reagendado a cada piscada e só enquanto o olho está à vista: um
       setInterval acordaria o main thread a cada 4s pelo resto da visita. */
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

    /* O SEGUNDO laço que perdeu o rAF próprio — mesma história do parallax do
       menu. `olhoCx`/`olhoCy` já vinham da passada de MEDIDA da Agenda (ali
       em cima), então aqui não há leitura de layout nenhuma: é só conta e uma
       escrita de `transform`. Lugar certo, passada de desenho. */
    function aplicarOlhar(){
      if (!olharAgendado) return;
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

    Agenda.pintar(aplicarOlhar);

    window.addEventListener('mousemove', (e) => {
      if (!eyeVisivel) return;
      mouseX = e.clientX;
      mouseY = e.clientY;

      if (!olharAgendado) {
        olharAgendado = true;
        Agenda.pedirQuadro();
      }
    }, { passive: true });
  }
})();


/* =========================================================================
   STACK — a duração das faixas, medida uma vez

   As quatro linhas têm quantidades diferentes de texto. Uma duração única
   faria cada uma andar numa velocidade visual diferente, então a duração de
   cada uma sai da largura real do seu conteúdo — é a mesma ideia de antes.

   O QUE MUDOU: isto é TUDO o que restou de JavaScript nos marquees. O sistema
   que reagia à velocidade do scroll (playbackRate por quadro, rAF próprio,
   inversão de sentido) saiu inteiro do js/efeitos.js; a animação em si é
   `animation: stackMarquee` no css/estilo.css e roda no compositor, sem
   acordar a thread principal uma vez sequer.

   Esta função não roda em quadro nenhum de rolagem: ela mede no `load`, no
   `fonts.ready` e no resize — três vezes numa visita inteira. E mede QUATRO
   trilhas, não oito: as duas de cada faixa são cópias idênticas, então a
   segunda leitura só repetia a primeira.

   Medir tudo antes de escrever qualquer coisa é de propósito: intercalar
   `getBoundingClientRect` com escrita de estilo obrigaria o navegador a
   resolver o layout a cada volta do laço.
   ========================================================================= */

(function marqueeVelocidade(){
  /* px por segundo. Calibrado no ritmo que as faixas JÁ tinham na tela
     (~128px/s), e não no valor que o código antigo pretendia: ele media antes
     de as fontes de ícone chegarem e nunca alcançava o número que pedia. */
  const PX_POR_SEGUNDO = 128;

  const faixas = Array.from(document.querySelectorAll('.stack-marquee'));
  if (!faixas.length) return;

  const larguras = new Array(faixas.length);

  function medir(){
    for (let i = 0; i < faixas.length; i++) {
      const trilha = faixas[i].firstElementChild;
      larguras[i] = trilha ? trilha.getBoundingClientRect().width : 0;
    }
    for (let i = 0; i < faixas.length; i++) {
      if (larguras[i] > 0) {
        faixas[i].style.setProperty(
          '--marquee-dur', (larguras[i] / PX_POR_SEGUNDO).toFixed(2) + 's');
      }
    }
  }

  /* só o `load` não bastava: as fontes (JetBrains Mono / Font Awesome /
     devicon) costumam chegar DEPOIS dele, e é a fonte que define a largura
     real do texto. Medindo cedo demais, a velocidade sai calculada em cima da
     fonte de fallback e cada linha anda num ritmo diferente. */
  window.addEventListener('load', medir, { once: true });
  Agenda.resize(medir);
  if (document.fonts) document.fonts.ready.then(medir);
  medir();
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

  /* A palavra espera estar de fato na tela. */
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

  /* As palavras são movidas uma a uma por `currentTime`. Deixar o CSS calcular
     o atraso a partir de um `--prog` obrigava a recalcular o estilo das 57
     palavras em todo quadro de scroll: 3,16ms contra 0,055ms daqui.

     A lista é montada uma vez; se vier vazia (a animação ainda não existe no
     primeiro quadro), tenta de novo — sem ela as palavras ficariam paradas no
     estado invisível. */
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

  /* O ÚLTIMO PROGRESSO QUE VIROU ESCRITA.

     Sem isto, as 57 palavras recebiam `currentTime` em TODO quadro de rolagem
     da página inteira — inclusive dentro do scroll horizontal, com o parágrafo
     três telas abaixo e o `p` grudado em 0 o tempo todo. Escrever `currentTime`
     invalida o estilo daquele elemento, e são 57 deles com `filter: blur()` nos
     seus quadros: trabalho puro jogado fora, no quadro de outra seção.

     A comparação apaga isso inteiro. Acima do parágrafo o `p` fica em 0 e
     abaixo em 1; nos dois casos a primeira escrita é a única.

     O passo de 1/500 é o mesmo do jardim do scroll horizontal, e pelo mesmo
     motivo: com quatro casas decimais praticamente todo quadro trazia um
     número diferente e pagava a invalidação inteira, mesmo na cauda em que a
     rolagem anda frações de pixel. Em 500 degraus o efeito segue contínuo ao
     olho. */
  let bioDesenhado = -1;

  /* `p` medido neste quadro, à espera da passada de desenho. */
  let bioPendente = -1;

  /* O topo do parágrafo e o último pixel rolável só mudam quando a página muda
     de tamanho — não a cada quadro. Medidos aqui uma vez, saem do caminho do
     scroll: eram um getBoundingClientRect e um scrollHeight (leituras de
     layout das caras) pagos em TODO quadro da página inteira, inclusive
     durante o scroll horizontal, onde este parágrafo está a telas de
     distância. */
  let bioTopoDoc = 0, bioMaxScroll = 0, bioMedido = false;

  function medirGeometriaBio(){
    const y = window.scrollY || window.pageYOffset || 0;
    bioTopoDoc = bioEl.getBoundingClientRect().top + y;
    bioMaxScroll = Math.max(0, document.documentElement.scrollHeight - (window.innerHeight || 1));
    bioMedido = true;
  }

  function medir(){
    agendado = false;
    if (!bioMedido) medirGeometriaBio();

    /* pela Agenda: `scrollY` obriga o navegador a ter layout limpo pra
       responder, e este quadro já pagou essa leitura uma vez */
    const h = Agenda.h || 1;
    const y = Agenda.y || 0;

    // posições de scroll (em coordenadas do documento) onde o efeito começa e
    // onde ele deveria terminar: topo do parágrafo a 88% e a 38% da tela
    const inicio = bioTopoDoc - h * 0.88;
    let fim = bioTopoDoc - h * 0.38;

    /* ESTA SEÇÃO É A ÚLTIMA DA PÁGINA, e é por isso que a conta não pode
       parar aqui. O parágrafo nunca chega a subir até 38% da tela: o scroll
       termina antes, e as últimas palavras ficavam borradas para sempre.
       Limitando o fim ao último pixel rolável, o percurso cabe no que existe
       de scroll e a leitura fecha junto com a página. */
    if (fim > bioMaxScroll) fim = bioMaxScroll;

    const curso = fim - inicio;
    let p = curso > 0 ? (y - inicio) / curso : 1;
    p = Math.min(1, Math.max(0, p));

    bioPendente = Math.round(p * 500) / 500;
  }

  /* ESCREVE — e só na passada de DESENHO.

     Aqui estava a última inversão de ordem que sobrava nesta página:
     `posicionarPalavras` era chamada de dentro do `medir`, que roda na passada
     de MEDIDA da Agenda. Escrever estilo no meio das medidas suja a árvore
     para todo mundo que ainda vai medir depois — e o js/efeitos.js carrega
     DEPOIS deste arquivo, então os `getBoundingClientRect` do ímã, do retrato
     e da pausa fora-da-tela vinham logo em seguida e obrigavam o navegador a
     recalcular o estilo ali mesmo, em todo quadro de rolagem da página.

     Medida numa passada, escrita na outra: é a regra da Agenda, e este era o
     único módulo que ainda a quebrava. */
  function aplicar(){
    if (bioPendente < 0 || bioPendente === bioDesenhado) return;
    if (!animacoes.length && !pegarAnimacoes()) return;
    bioDesenhado = bioPendente;
    posicionarPalavras(bioPendente);
  }

  Agenda.scroll(medir);
  Agenda.pintar(aplicar);
  Agenda.resize(() => { medirGeometriaBio(); medir(); aplicar(); });

  /* Fora de um quadro da Agenda não há duas passadas onde se apoiar: aqui
     mede-se e escreve-se em seguida, na mesma chamada. */
  function pintar(){ medir(); aplicar(); }

  /* a altura da página só assenta depois das fontes e do hsLayout */
  window.addEventListener('load', () => { medirGeometriaBio(); pintar(); }, { once: true });
  if (document.fonts) document.fonts.ready.then(() => { medirGeometriaBio(); pintar(); });

  /* A animação só existe depois que o CSS da .bio-scrub foi aplicado, o que
     não acontece no mesmo instante em que a classe entra. Estas tentativas
     cobrem o intervalo; a partir daí o `medir` cuida sozinho. */
  requestAnimationFrame(() => { pegarAnimacoes(); pintar(); });
  setTimeout(() => { pegarAnimacoes(); pintar(); }, 400);
  pintar();
})();