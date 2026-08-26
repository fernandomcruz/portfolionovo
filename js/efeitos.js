/* =========================================================================
   EFEITOS AVANÇADOS — motor
   Companheiro do css/efeitos.css. Tudo aqui é aditivo: nenhum módulo depende
   de outro, e todos saem de cena sozinhos se o navegador for antigo, se for
   um celular (nos casos que só fazem sentido com mouse) ou se a pessoa tiver
   "reduzir movimento" ligado no sistema.

   Índice:
     1. Preloader (contador + cortina)
     2. Barra de progresso do scroll
     3. Botões magnéticos
     4. Block reveal
     5. Stack — marquee que reage à velocidade do scroll
     6. Idiomas — os mastros entram pelas laterais
     7. Retrato do "sobre mim" — revela acompanhando o scroll
     8. Idiomas — a rajada do hover
     9. Pausa de animações fora da tela
   ========================================================================= */

(function efeitos(){
  'use strict';

  const MENOS_MOVIMENTO =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // "tem mouse de verdade?" — evita ligar cursor/tilt/parallax em touch, onde
  // além de não fazer sentido eles só gastam bateria
  const TEM_MOUSE = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  const lerp  = (a, b, t) => a + (b - a) * t;
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  /* A Agenda vem do js/script.js. O plano B existe porque este arquivo se
     declara aditivo: sem o script.js cada módulo volta a registrar o seu
     próprio ouvinte e nada aqui deixa de funcionar. */
  const Agenda = window.Agenda || {
    scroll(fn){
      let esperando = false;
      window.addEventListener('scroll', () => {
        if (esperando) return;
        esperando = true;
        requestAnimationFrame(() => { esperando = false; fn(); });
      }, { passive: true });
      return fn;
    },
    pintar(fn){ return this.scroll(fn); },
    pedirQuadro(){},
    resize(fn){ window.addEventListener('resize', fn); return fn; },
    parar(){}
  };

  /* A RÉGUA DE VISIBILIDADE TAMBÉM VEM DO js/script.js.

     Havia aqui uma cópia da conta de "quanto do elemento está na tela", e uma
     cópia é uma regra a mais para sair de sincronia com as outras — foi
     exatamente assim que o block reveal acabou com dois critérios discordando.
     Agora existe um lugar só, e este arquivo consome.

     Sem o script.js não há régua, e aí os três módulos de entrada abaixo
     simplesmente não rodam. Isso é o comportamento seguro, não uma falha: todos
     eles escondem conteúdo por meio de uma classe que só o JS coloca, então não
     rodar quer dizer nascer visível — a foto aparece, as bandeiras aparecem, os
     títulos aparecem. É a mesma rede que já valia pra quem tem o JS desligado. */
  const Viewport = window.Viewport || null;

  /* "a cortina já saiu?" — vários efeitos só devem começar depois disso, ou
     rodam escondidos atrás do preloader e a pessoa nunca chega a ver.
     O listener precisa ser registrado AQUI, antes do módulo do preloader:
     quando não existe preloader nenhum, o evento dispara na mesma hora e um
     listener registrado depois já perderia o barco. */
  let sitePronto = false;
  document.addEventListener('site:pronto', () => { sitePronto = true; });

  function quandoPronto(fn){
    if (sitePronto) { fn(); return; }
    document.addEventListener('site:pronto', fn, { once: true });
  }


  /* =======================================================================
     1. PRELOADER — contador 0→100 e cortina subindo
     O número não sobe em ritmo constante: acelera e engasga um pouco, como
     um carregamento real. Ao terminar, dispara o evento `site:pronto`, que
     os outros módulos usam pra começar na hora certa.
     ===================================================================== */

  const preloader = document.getElementById('preloader');

  /* Precisa bater com a `transition: transform .8s` do .preloader no
     css/efeitos.css. Se um mudar, o outro muda junto — é essa duração que
     define quando a página fica de fato visível. */
  const DURACAO_CORTINA = 800;

  function avisarPronto(){
    document.body.classList.remove('is-loading');
    document.dispatchEvent(new CustomEvent('site:pronto'));
  }

  (function initPreloader(){
    if (!preloader) { avisarPronto(); return; }

    if (MENOS_MOVIMENTO) {
      preloader.remove();
      avisarPronto();
      return;
    }

    const contador = document.getElementById('plCounter');
    const barra    = document.getElementById('plBarFill');

    document.body.classList.add('is-loading');

    let valor = 0;
    let ultimo = performance.now();
    let fechado = false;

    /* Rede de segurança: o contador anda em requestAnimationFrame, e rAF fica
       CONGELADO enquanto a aba está em segundo plano. Quem abre o link numa
       aba de fundo e volta depois encontraria a página travada no 0, sem
       conseguir nem rolar (body.is-loading trava o scroll). Este timeout
       garante que o site sempre libera, aconteça o que acontecer. */
    const salvaVidas = setTimeout(fechar, 2200);

    function passo(agora){
      const dt = Math.min((agora - ultimo) / 1000, 0.1);
      ultimo = agora;

      // desacelera perto do fim: sobe rápido até ~70 e vai se arrastando.
      // Os números foram acelerados: a curva antiga levava ~1,7s só pra
      // contar, e com a cortina dava quase 3s de espera antes de ver o site.
      const velocidade = 62 + (100 - valor) * 1.7;
      valor = Math.min(100, valor + velocidade * dt);

      contador.textContent = Math.round(valor);
      barra.style.transform = `scaleX(${valor / 100})`;

      if (valor < 100) { requestAnimationFrame(passo); return; }

      // segura um instante no 100 pra leitura não ficar atropelada
      setTimeout(fechar, 200);
    }

    function fechar(){
      if (fechado) return;              // o salva-vidas e o contador podem
      fechado = true;                   // chegar aqui os dois
      clearTimeout(salvaVidas);

      preloader.classList.add('pl-done');

      // o scroll é liberado junto com a cortina: a página já está aparecendo
      document.body.classList.remove('is-loading');

      /* O aviso `site:pronto` PRECISA sair só quando a cortina terminou de
         subir, não quando ela começa. Disparando no começo, tudo que espera
         por ele rodava durante a subida — e o block reveal do título do hero
         (780ms) cabia inteirinho dentro dos 800ms da cortina, terminando
         20ms antes de ela sair. O efeito acontecia, mas escondido: não dava
         pra ver acontecer.
         A assinatura já era protegida por este mesmo setTimeout; o erro foi
         não ter estendido a proteção ao evento. */
      setTimeout(() => {
        preloader.remove();
        avisarPronto();
        if (window.__assinatura) window.__assinatura.play();
      }, DURACAO_CORTINA);
    }

    requestAnimationFrame((t) => { ultimo = t; requestAnimationFrame(passo); });
  })();


  /* =======================================================================
     2. BARRA DE PROGRESSO DO SCROLL
     ===================================================================== */

  (function initProgresso(){
    const fill = document.getElementById('scrollProgressFill');
    if (!fill) return;

    /* A altura rolável é guardada: `scrollHeight` é leitura de layout, e era
       paga em todo quadro de rolagem para um número que só muda no resize. */
    let alturaRolavel = 0;

    function medirAltura(){
      alturaRolavel = document.documentElement.scrollHeight - window.innerHeight;
    }

    function pintar(){
      const p = alturaRolavel > 0 ? clamp(window.scrollY / alturaRolavel, 0, 1) : 0;
      fill.style.transform = `scaleX(${p})`;
    }

    Agenda.pintar(pintar);
    Agenda.resize(() => { medirAltura(); pintar(); });

    /* a altura final só existe depois que as fontes assentam e o hsLayout
       roda; até lá, algumas conferências baratas */
    medirAltura();
    pintar();
    window.addEventListener('load', () => { medirAltura(); pintar(); }, { once: true });
    if (document.fonts) document.fonts.ready.then(() => { medirAltura(); pintar(); });
  })();


  /* =======================================================================
     3. BOTÕES MAGNÉTICOS
     O botão é "puxado" na direção do mouse quando ele chega perto, e volta
     sozinho quando sai. Escreve em `translate` (não em `transform`) pra não
     apagar os transforms que esses botões já usam nos próprios hovers.
     ===================================================================== */

  (function initMagnetico(){
    const alvos = Array.from(document.querySelectorAll('[data-magnetic]'));
    if (!alvos.length || !TEM_MOUSE || MENOS_MOVIMENTO) return;

    const RAIO_EXTRA = 70;   // quantos px além da borda o ímã já começa a puxar
    let agendado = false;
    let mx = 0, my = 0;

    /* A posição dos botões na tela só muda com scroll, resize ou quando o
       menu abre — NÃO a cada pixel que o mouse anda. Antes eram 10 leituras
       de getBoundingClientRect por quadro de mousemove, e leitura de layout
       é justamente a operação que obriga o navegador a recalcular tudo.
       Medindo só quando algo de fato mexeu, os quadros de puro movimento do
       mouse viram matemática pura, sem tocar no layout. */
    let medidas = [];
    let precisaMedir = true;

    function medir(){
      precisaMedir = false;
      medidas = [];

      for (const el of alvos) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;                    // escondido: fica de fora

        medidas.push({
          el,
          cx: r.left + r.width  / 2,
          cy: r.top  + r.height / 2,
          alcance: Math.max(r.width, r.height) / 2 + RAIO_EXTRA,
          forca: parseFloat(el.dataset.magnetic) || 12
        });
      }
    }

    /* A ida E a volta são interpoladas aqui, quadro a quadro, em vez de
       deixar uma `transition` do CSS cuidar da volta. O motivo está no
       css/efeitos.css: qualquer `transition` declarada em [data-magnetic]
       apagaria as transições de hover que .ms-icon e .button-icon já têm.
       Interpolando no JS, o ímã escreve só `translate` e não encosta em
       mais nada. */
    const estados = new Map(alvos.map((el) => [el, { x: 0, y: 0, alvoX: 0, alvoY: 0 }]));

    function atualizar(){
      agendado = false;
      if (precisaMedir) medir();

      // 1) define pra onde cada botão quer ir
      for (const el of alvos) estados.get(el).alvoX = estados.get(el).alvoY = 0;

      for (const m of medidas) {
        const dx = mx - m.cx;
        const dy = my - m.cy;
        const dist = Math.hypot(dx, dy);
        if (dist > m.alcance) continue;

        const peso = 1 - dist / m.alcance;         // mais perto, puxa mais
        const k = (m.forca * peso * 2) / m.alcance;
        const st = estados.get(m.el);
        st.alvoX = dx * k;
        st.alvoY = dy * k;
      }

      // 2) caminha até lá e descobre se ainda falta alguém chegar
      let mexendo = false;

      for (const [el, st] of estados) {
        st.x = lerp(st.x, st.alvoX, 0.22);
        st.y = lerp(st.y, st.alvoY, 0.22);

        if (Math.abs(st.x - st.alvoX) > 0.1 || Math.abs(st.y - st.alvoY) > 0.1) {
          mexendo = true;
        } else {
          st.x = st.alvoX;
          st.y = st.alvoY;
        }

        el.style.translate = (st.x || st.y)
          ? `${st.x.toFixed(2)}px ${st.y.toFixed(2)}px`
          : '';                                    // parado: devolve ao CSS
      }

      // continua sozinho até tudo assentar — é isso que dá a volta suave
      if (mexendo && !agendado) {
        agendado = true;
        requestAnimationFrame(atualizar);
      }
    }

    const invalidar = () => { precisaMedir = true; };
    Agenda.scroll(invalidar);
    Agenda.resize(invalidar);
    document.getElementById('menu-toggle')?.addEventListener('click', () => {
      // o menu leva ~1.4s pra assentar; remede quando os ícones pararem
      setTimeout(invalidar, 1500);
    });

    window.addEventListener('mousemove', (e) => {
      mx = e.clientX;
      my = e.clientY;
      if (agendado) return;
      agendado = true;
      requestAnimationFrame(atualizar);
    }, { passive: true });
  })();


  /* =======================================================================
     4. BLOCK REVEAL — barra varrendo o texto
     O JS só embrulha o texto (para a barra ter uma caixa do tamanho exato
     da palavra) e liga a animação quando o título entra na tela.

     A ordem aqui é deliberada: a classe que ESCONDE o texto (.br-pronto) e a
     que ANIMA (.br-anima) entram no mesmo quadro. Nunca existe um momento em
     que o texto está escondido esperando algo — que foi o erro do reveal
     anterior, onde um observer que não disparava deixava o título invisível
     pra sempre.
     ===================================================================== */

  (function initBlockReveal(){
    const alvos = Array.from(document.querySelectorAll('[data-block-reveal]'));
    if (!alvos.length) return;

    // embrulha o texto: <h2><span.br-wrap><span.br-txt>TEXTO</span></span></h2>
    // o wrapper é inline-block, então ele mede exatamente a palavra — e a
    // barra (::after do wrapper) cobre só ela, não a linha inteira
    for (const el of alvos) {
      const texto = el.textContent.trim();
      if (!texto) continue;

      el.textContent = '';

      const wrap = document.createElement('span');
      wrap.className = 'br-wrap';

      const txt = document.createElement('span');
      txt.className = 'br-txt';
      txt.textContent = texto;

      wrap.appendChild(txt);
      el.appendChild(wrap);
    }

    if (MENOS_MOVIMENTO) return;   // texto normal, sem barra nenhuma
    if (!Viewport) return;         // sem régua não se esconde nada — ver o topo

    /* Esconde AGORA, ainda no carregamento, antes de qualquer pintura.
       Na versão anterior isso só acontecia no instante de animar, o que dava
       pra ler o texto e depois vê-lo piscar pra sumir antes da barra passar.
       O texto agora só nasce depois que a barra passou por cima dele. */
    alvos.forEach((el) => el.classList.add('br-pronto'));

    /* Tempo maior que a mais longa das varreduras (a do hero: .25s de espera
       + 1.05s de barra). Passado isso, o texto TEM que estar legível. */
    const BR_TETO_MS = 1600;

    /* Sem a trava `dataset.brFeito` que havia aqui: ela existia porque três
       gatilhos independentes podiam chamar esta função pro mesmo título. Hoje
       quem chama é só o `aoEntrar`, e ele entrega uma vez por elemento. */
    function revelar(el){
      el.classList.add('br-anima');

      /* Cinto de segurança: quem revela o texto hoje é o `forwards` da
         animação. Se ela não rodar — aba em segundo plano, animação
         bloqueada, o que for — o texto ficaria invisível pra sempre, que é
         exatamente o problema que já apareceu antes.
         setTimeout continua disparando mesmo com as animações congeladas,
         então esta classe é um caminho independente pra leitura. Quando a
         animação roda normal, ela já terminou aqui e a classe não muda nada. */
      setTimeout(() => el.classList.add('br-visivel'), BR_TETO_MS);
    }

    /* O TÍTULO PRECISA ESTAR NA ÁREA DE LEITURA, não espiando pela borda.

       Este módulo era o pior caso do problema todo, e por um motivo que não
       estava à vista: ele tinha DUAS regras dizendo quando começar. Uma
       conferência por geometria pedindo 0.95 — e um IntersectionObserver com
       `threshold: 0.35` que revelava por conta própria, sem consultá-la.

       Quem chegava primeiro era sempre o observer, e 0.35 num título quer
       dizer o topo dele espiando pela beirada de baixo. A varredura da barra
       leva 0,78s (1,05s no título do hero) e corria inteira ali embaixo, fora
       do campo de visão. Quem descia até o título encontrava a barra já ida e
       o texto já posto — o efeito acontecia, mas para ninguém.

       Agora a regra é uma só, e o observer virou avisador: quem decide é
       sempre a régua do Viewport. Os 0.95 continuam iguais aos de antes, então
       nada muda para quem já via o efeito acontecer na hora certa. Como os
       títulos são baixos (17 a 103px), 95% acontece assim que ele termina de
       entrar — que é exatamente quando a barra deve varrer. */
    Viewport.aoEntrar(alvos, { fracao: 0.95 }, (el) => {
      // o título do hero está visível desde o começo, mas atrás da cortina
      // do preloader — sem esperar, a barra passaria escondida
      quandoPronto(() => revelar(el));
    });
  })();


  /* =======================================================================
     5. STACK — MARQUEE QUE REAGE À VELOCIDADE DO SCROLL
     Rolando rápido, as faixas disparam; rolando pra cima, elas invertem o
     sentido. Feito com playbackRate da Web Animations API, então a animação
     CSS original (e a velocidade calculada no script.js) continuam valendo:
     o que muda é só o RITMO em que ela toca, sem nenhum pulo na emenda.
     ===================================================================== */

  (function initMarqueeReativo(){
    if (MENOS_MOVIMENTO) return;

    const trilhas = Array.from(document.querySelectorAll('.stack-marquee-track'));
    if (!trilhas.length) return;

    const MAX_BOOST = 5;     // multiplicador máximo de velocidade
    const SENSIB    = 0.055; // px de scroll -> quanto acelera
    const VOLTA     = 0.06;  // quão rápido desacelera de volta ao normal

    let ultimoY = window.scrollY;
    let alvo = 1;            // para onde a velocidade está indo
    let atual = 1;           // velocidade aplicada agora
    let rodando = false;
    let visivel = false;

    /* getAnimations() aloca um array novo a cada chamada. Chamando pras 8
       trilhas a cada quadro, era lixo de memória sendo gerado 60x por segundo
       só pra pegar sempre os mesmos objetos. Guardamos as animações uma vez;
       elas continuam as mesmas mesmo quando o script.js troca a duração. */
    let anims = null;

    function pegarAnims(){
      anims = trilhas.flatMap((t) => t.getAnimations());
    }

    Agenda.resize(() => { anims = null; });
    if (document.fonts) document.fonts.ready.then(() => { anims = null; });

    function definirRitmo(v){
      if (!anims) pegarAnims();
      for (const a of anims) a.playbackRate = v;
    }

    function quadro(){
      atual = lerp(atual, alvo, VOLTA);
      alvo  = lerp(alvo, 1, VOLTA);   // sem scroll, tudo volta ao ritmo normal

      // mexer no playbackRate não reinicia a animação nem quebra o loop
      definirRitmo(atual);

      if (Math.abs(atual - 1) > 0.01 && visivel) { requestAnimationFrame(quadro); return; }

      atual = 1;
      definirRitmo(1);
      rodando = false;
    }

    Agenda.pintar(() => {
      const delta = window.scrollY - ultimoY;
      ultimoY = window.scrollY;

      if (!visivel) return;

      // rolando pra cima o sinal fica negativo: as faixas andam ao contrário
      alvo = clamp(1 + delta * SENSIB, -MAX_BOOST, MAX_BOOST);

      if (rodando) return;
      rodando = true;
      requestAnimationFrame(quadro);
    }, { passive: true });

    const secao = document.querySelector('.stack-section');
    if (secao) {
      new IntersectionObserver((entries) => {
        visivel = entries[0].isIntersecting;
      }, { threshold: 0 }).observe(secao);
    }
  })();


  /* =======================================================================
     6. IDIOMAS — OS MASTROS ENTRAM PELAS LATERAIS
     Quando a stack aparece, cada conjunto (mastro + bandeira + rótulo) desliza
     da sua própria parede até o lugar. Fica em CSS porque é uma transição de
     transform e opacidade: o compositor dá conta sozinho, sem custo por quadro.

     A mesma disciplina dos outros módulos que escondem conteúdo: o estado
     escondido mora atrás de uma classe que só o JS põe, então se o script não
     rodar as bandeiras nascem visíveis. Quem decide a hora de entrar é a régua
     do Viewport, e o `resgatar` dela cobre o caso de a pessoa ter passado
     direto pela seção — nenhuma bandeira fica escondida por isso.
     ===================================================================== */

  (function initEntradaIdiomas(){
    const blocos = Array.from(document.querySelectorAll('.idioma'));
    if (!blocos.length) return;
    if (MENOS_MOVIMENTO) return;   // sem viagem: as bandeiras já estão no lugar
    if (!Viewport) return;         // sem régua não se esconde nada — ver o topo

    document.documentElement.classList.add('idiomas-prontos');

    /* Maior que a transição (1.05s) mais o atraso do lado direito, contado a
       partir da primeira conferência. Passado isso, as bandeiras TÊM que estar
       na tela — setTimeout continua correndo mesmo com animação congelada. */
    const TETO_MS = 2600;

    function entrar(el){
      el.classList.add('idioma-entra');
      setTimeout(() => el.classList.add('idioma-visivel'), TETO_MS);
    }

    /* Os 0.75 são os mesmos de antes — o que muda é que agora só existe UM
       caminho até eles. A conta já estava certa aqui; o que fazia o efeito
       escapar no celular era o observer ter o próprio conjunto de limiares e
       a própria lista de conferências, cada um podendo chegar primeiro.

       ATENÇÃO, e é o motivo de não haver `horizontal: true` nesta chamada: o
       estado escondido destas bandeiras é um `translateX` que as joga pra fora
       da tela (`-100% - 14vw`). O rect delas já nasce deslocado pros lados,
       então uma conta que olhasse o eixo X daria zero para sempre e a viagem
       nunca começaria. A vertical não sofre com o translate lateral — é ela
       que sabe onde o bloco está. */
    Viewport.aoEntrar(blocos, { fracao: 0.75 }, entrar);
  })();


  /* =======================================================================
     7. RETRATO DO "SOBRE MIM" — REVELA ACOMPANHANDO O SCROLL

     A janela do clip-path sobe da base conforme a foto entra na tela: rolar
     revela, rolar de volta esconde. Antes era um disparo único; agora quem
     conduz é o dedo.

     Duas coisas que essa troca precisa resolver, e que são o motivo do
     `percurso` abaixo não ser a fração visível direta:

     · NÃO PODE COMEÇAR ANTES DE APARECER. Como o progresso é medido a partir
       da borda de baixo da área visível, com a foto fora da tela ele é
       negativo e vira zero. Não há palpite de quando ela vai aparecer — ou ela
       já entrou, ou o progresso é zero. É a mesma régua dos outros módulos.

     · NÃO PODE DESFAZER AO PASSAR. Fração visível cai de novo quando a foto
       sai por cima, e a foto se apagaria depois de já ter sido vista. O
       percurso conta só o quanto ela SUBIU, sem olhar a borda de baixo dela,
       então continua crescendo depois de entrar e trava em 1.

     Durante a entrada as duas contas dão exatamente o mesmo número — a
     diferença só aparece depois.

     Mesma rede de segurança dos outros módulos que escondem conteúdo: o estado
     escondido só existe sob uma classe que este script coloca. Sem script, a
     foto simplesmente aparece.
     ===================================================================== */

  (function initRetratoScrub(){
    const fig = document.querySelector('.bio-retrato');
    if (!fig) return;
    if (MENOS_MOVIMENTO) return;   // a foto já está no lugar
    if (!Viewport) return;         // sem régua não se esconde nada — ver o topo

    const img = fig.querySelector('img');
    if (!img) return;

    /* A classe é `retrato-scrub` e não o `retrato-pronto` de antes de
       propósito: ela nomeia ESTA implementação. Os dois arquivos podem chegar
       ao navegador em versões diferentes — foi o que aconteceu aqui, com o CSS
       novo e o js/efeitos.js ainda em cache —, e com o nome antigo o resultado
       era a foto escondida para sempre: o CSS novo pendurava a animação pausada
       na classe que o JS velho colocava, e nada movia o ponteiro dela. Com o
       nome novo, qualquer descompasso entre os dois dá no mesmo resultado
       inofensivo: nenhuma classe casa, a foto simplesmente aparece. */
    fig.classList.add('retrato-scrub');

    /* A animação nasce no próximo cálculo de estilo, e `getAnimations` só
       enxerga o que já existe — daí a leitura de offsetHeight, que força esse
       cálculo agora. Filtrar pelo nome, e não pegar o [0], porque a transição
       do filtro do hover mora no mesmo elemento e também aparece nessa lista
       enquanto estiver correndo. */
    void img.offsetHeight;
    const anim = img.getAnimations()
      .find((a) => a.animationName === 'retratoRevela') || null;

    /* Sem animação a foto ficaria escondida para sempre no fim da página.
       Devolve ela e sai. */
    if (!anim) { fig.classList.remove('retrato-scrub'); return; }

    const DUR = 1000;              // a régua da animação pausada, em ms
    const COMECA  = 0.10;          // zona morta: uma nesga de foto não começa nada
    const TERMINA = 0.90;          // revelada por inteiro com 90% dela dentro

    let ultimo = -1;

    function pintar(){
      const r = fig.getBoundingClientRect();
      if (r.height <= 0) return;
      const a = Viewport.area();

      const percurso = (a.top + a.altura - r.top) / Math.min(r.height, a.altura);

      let p = (percurso - COMECA) / (TERMINA - COMECA);
      p = p < 0 ? 0 : (p > 1 ? 1 : p);
      p = p * p * (3 - 2 * p);     // assenta as duas pontas; o meio segue o dedo

      /* Arredondar dá 1000 degraus — mais do que a tela resolve — e evita
         reescrever a animação quando o scroll não mudou nada de fato. */
      const t = Math.round(p * DUR);
      if (t === ultimo) return;
      ultimo = t;
      anim.currentTime = t;
    }

    Agenda.pintar(pintar);
    Agenda.resize(pintar);
    window.addEventListener('load', pintar, { once: true });
    if (document.fonts) document.fonts.ready.then(pintar);
    pintar();
  })();


  /* =======================================================================
     8. IDIOMAS — A RAJADA DO HOVER
     A parte visual da rajada é toda CSS (o --vento). Aqui mora só o que o CSS
     não faz bem: acelerar a onda sem que ela salte.

     Trocar `animation-duration` no meio do ciclo reposiciona a animação em
     outro ponto do percurso — a onda pula. O playbackRate mexe só no ritmo e
     a fase segue de onde estava, que é o mesmo truque já usado no marquee da
     stack logo acima.
     ===================================================================== */

  (function initVentoNoHover(){
    if (MENOS_MOVIMENTO) return;
    if (!window.matchMedia || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const blocos = document.querySelectorAll('.idioma');
    if (!blocos.length) return;

    const RAJADA = 2.1;

    function ritmo(bloco, taxa){
      // getAnimations pega a animação de cada fatia do pano
      for (const el of bloco.querySelectorAll('.fio')) {
        for (const anim of el.getAnimations()) anim.playbackRate = taxa;
      }
    }

    for (const bloco of blocos) {
      bloco.addEventListener('pointerenter', () => ritmo(bloco, RAJADA));
      bloco.addEventListener('pointerleave', () => ritmo(bloco, 1));
    }
  })();


  /* =======================================================================
     9. PAUSA DE ANIMAÇÕES FORA DA TELA
     Os marquees são `animation: ... infinite`. Sem isso, as 8 trilhas da
     stack e as 2 dos projetos ficam sendo compostas quadro a quadro durante
     a página inteira, mesmo a três telas de distância — o navegador não tem
     como saber que ninguém está olhando. Pausar quando saem da tela é de
     longe o corte mais barato de trabalho por quadro que dá pra fazer aqui.
     ===================================================================== */

  (function initPausarForaDaTela(){
    const secoes = Array.from(document.querySelectorAll('.stack-marquee, .idioma'));
    if (!secoes.length) return;

    const MARGEM = 150;   // retoma um pouco antes de aparecer, pra nunca
                          // "nascer" parado na tela

    /* Pausado é o estado inicial. Antes a classe nascia ausente: tudo começava
       rodando e só parava quando o observer avisasse — medi 68 animações das
       bandeiras e 8 dos marquees girando a 3.700px abaixo da dobra desde o
       primeiro quadro. Pausar não esconde conteúdo, então não há risco em
       errar para o lado de pausar demais. */
    secoes.forEach((s) => s.classList.add('fora-da-tela'));

    /* Medir e escrever em passadas separadas: alternar `getBoundingClientRect`
       com `classList.toggle` nas seis seções fazia o navegador resolver o
       layout de novo a cada volta do laço. Aqui o laço só mede, guarda o
       resultado, e a escrita acontece depois. */
    const perto = new Array(secoes.length);

    function medir(){
      const h = window.innerHeight || 1;
      for (let i = 0; i < secoes.length; i++) {
        const r = secoes[i].getBoundingClientRect();
        perto[i] = r.bottom > -MARGEM && r.top < h + MARGEM;
      }
    }

    function aplicar(){
      for (let i = 0; i < secoes.length; i++) {
        secoes[i].classList.toggle('fora-da-tela', !perto[i]);
      }
    }

    function conferir(){ medir(); aplicar(); }

    Agenda.scroll(medir);
    Agenda.pintar(aplicar);
    Agenda.resize(conferir);
    conferir();

    /* O observer continua, mas agora como atalho e não como fonte da verdade:
       ele avisa na hora certa sem custo de scroll. Se não existir no
       navegador, a conferência por geometria acima já dá conta. */
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          entry.target.classList.toggle('fora-da-tela', !entry.isIntersecting);
        }
      }, { rootMargin: MARGEM + 'px 0px' });

      secoes.forEach((s) => io.observe(s));
    }
  })();

})();
