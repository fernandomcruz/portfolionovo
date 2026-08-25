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
     7. Retrato do "sobre mim" — revela ao entrar na tela
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

  /* A AGENDA VEM DO js/script.js — um ouvinte de scroll e um de resize para o
     site inteiro, em vez de um par por módulo. Ver o comentário longo lá.

     O plano B existe porque este arquivo se declara aditivo: se o script.js
     não tiver carregado, cada módulo volta a registrar o seu próprio ouvinte e
     nada aqui deixa de funcionar. */
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
    resize(fn){ window.addEventListener('resize', fn); return fn; }
  };

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

    /* A ALTURA DO DOCUMENTO É GUARDADA, NÃO PERGUNTADA A CADA QUADRO.

       `document.documentElement.scrollHeight` é leitura de layout — daquelas
       que obrigam o navegador a resolver a página inteira antes de responder.
       Isso acontecia em TODO quadro de rolagem, e para um número que só muda
       quando a janela muda de tamanho ou quando o trilho horizontal é
       remedido.

       Guardado aqui, o quadro de scroll vira uma divisão e uma escrita de
       transform: nenhuma leitura de layout. A altura é refeita no resize —
       que é quando o hsLayout também reescreve a altura da seção "Sobre", e
       por isso a fila do resize recalcula depois dela. */
    let alturaRolavel = 0;

    function medirAltura(){
      alturaRolavel = document.documentElement.scrollHeight - window.innerHeight;
    }

    function pintar(){
      const p = alturaRolavel > 0 ? clamp(window.scrollY / alturaRolavel, 0, 1) : 0;
      fill.style.transform = `scaleX(${p})`;
    }

    Agenda.scroll(pintar);
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

    /* Esconde AGORA, ainda no carregamento, antes de qualquer pintura.
       Na versão anterior isso só acontecia no instante de animar, o que dava
       pra ler o texto e depois vê-lo piscar pra sumir antes da barra passar.
       O texto agora só nasce depois que a barra passou por cima dele. */
    alvos.forEach((el) => el.classList.add('br-pronto'));

    /* Tempo maior que a mais longa das varreduras (a do hero: .25s de espera
       + 1.05s de barra). Passado isso, o texto TEM que estar legível. */
    const BR_TETO_MS = 1600;

    function revelar(el){
      if (el.dataset.brFeito) return;
      el.dataset.brFeito = '1';
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

    /* A rede de segurança mudou de forma. Antes eu escondia tarde justamente
       pra nunca deixar conteúdo invisível — só que isso custava o efeito.
       Agora escondo cedo e garanto a leitura por outro caminho: além do
       observer, uma conferência manual por geometria. Se o
       IntersectionObserver falhar ou nem existir, qualquer título que esteja
       na tela é revelado do mesmo jeito. */
    function noCampoDeVisao(el){
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight * 0.92;
    }

    function conferir(){
      for (const el of alvos) {
        if (el.dataset.brFeito || !noCampoDeVisao(el)) continue;
        // o título do hero está visível desde o começo, mas atrás da cortina
        // do preloader — sem esperar, a barra passaria escondida
        quandoPronto(() => revelar(el));
      }
    }

    Agenda.scroll(conferir);
    Agenda.resize(conferir);
    setTimeout(conferir, 1200);

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          quandoPronto(() => revelar(entry.target));
        }
      }, { threshold: 0.35 });

      alvos.forEach((el) => io.observe(el));
    } else {
      conferir();
    }
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

    Agenda.scroll(() => {
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
     escondido mora atrás de uma classe que só o JS põe, e a chegada tem dois
     caminhos independentes — o observer e um teto de tempo. Se o observer não
     disparar, o setTimeout revela do mesmo jeito; se o script nem rodar, a
     classe nunca é posta e as bandeiras nascem visíveis.
     ===================================================================== */

  (function initEntradaIdiomas(){
    const blocos = Array.from(document.querySelectorAll('.idioma'));
    if (!blocos.length) return;
    if (MENOS_MOVIMENTO) return;   // sem viagem: as bandeiras já estão no lugar

    document.documentElement.classList.add('idiomas-prontos');

    /* Maior que a transição (1.05s) mais o atraso do lado direito, contado a
       partir da primeira conferência. Passado isso, as bandeiras TÊM que estar
       na tela — setTimeout continua correndo mesmo com animação congelada. */
    const TETO_MS = 2600;

    function entrar(el){
      if (el.dataset.idiomaFeito) return;
      el.dataset.idiomaFeito = '1';
      el.classList.add('idioma-entra');
      setTimeout(() => el.classList.add('idioma-visivel'), TETO_MS);
    }

    function noCampoDeVisao(el){
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight * 0.9;
    }

    function conferir(){
      for (const el of blocos) {
        if (!el.dataset.idiomaFeito && noCampoDeVisao(el)) entrar(el);
      }
    }

    Agenda.scroll(conferir);
    Agenda.resize(conferir);

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          entrar(entry.target);
        }
      }, { threshold: 0.3 });

      blocos.forEach((el) => io.observe(el));
    }

    // último recurso, independente de scroll e de observer
    setTimeout(conferir, 1400);
    setTimeout(() => blocos.forEach(entrar), TETO_MS * 2);
  })();


  /* =======================================================================
     7. RETRATO DO "SOBRE MIM" — REVELA AO ENTRAR NA TELA
     Aqui NÃO é scrub. A diferença importa: no scrub a imagem anda para frente
     e para trás conforme se rola, e fica no meio do caminho se a pessoa parar
     no meio. Aqui é um disparo único — assim que ela aparece na tela, a
     revelação acontece inteira, no ritmo dela, e não se desfaz.

     Mesma rede de segurança dos outros módulos que escondem conteúdo: o
     estado escondido só existe sob uma classe que este script coloca, e a
     chegada tem dois caminhos independentes (o observer e um teto de tempo).
     Sem script, a foto simplesmente aparece.
     ===================================================================== */

  (function initRetratoReveal(){
    const fig = document.querySelector('.bio-retrato');
    if (!fig) return;
    if (MENOS_MOVIMENTO) return;   // a foto já está no lugar

    fig.classList.add('retrato-pronto');

    let feito = false;
    function revelar(){
      if (feito) return;
      feito = true;
      fig.classList.add('retrato-entra');
      // teto: setTimeout corre mesmo com animação congelada
      setTimeout(() => fig.classList.add('retrato-visivel'), 2200);
    }

    /* QUANDO DISPARAR — e por que não é "assim que encosta na tela".

       Na primeira versão eu soltava com o topo da foto a 88% da altura da
       tela e 25% dela visível. Só que 25% visível é a foto ESPIANDO pela
       borda de baixo: a revelação de 1,15s corria enquanto ela ainda estava
       quase toda fora, e quando a pessoa terminava de rolar já tinha
       acabado. O efeito acontecia, mas ninguém via.

       Agora ela precisa estar de fato na tela: mais da metade visível e o
       topo acima de 70% da altura. Como a foto é alta, isso quer dizer que a
       revelação começa com ela mais ou menos enquadrada, e o percurso todo
       acontece à vista. */
    const PARTE_VISIVEL = 0.55;

    function noCampoDeVisao(){
      const r = fig.getBoundingClientRect();
      const h = window.innerHeight || 1;
      if (r.height <= 0) return false;
      const visivel = Math.min(r.bottom, h) - Math.max(r.top, 0);
      return visivel / r.height >= PARTE_VISIVEL && r.top < h * 0.7;
    }

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io.disconnect();
          revelar();
        }
      }, {
        threshold: PARTE_VISIVEL,
        /* encolhe a "tela" do observer por baixo: assim ele não conta como
           visível a faixa que ainda está no rodapé do campo de visão */
        rootMargin: '0px 0px -14% 0px'
      });
      io.observe(fig);
    }

    // caminhos independentes do observer
    Agenda.scroll(() => { if (!feito && noCampoDeVisao()) revelar(); });
    Agenda.resize(() => { if (!feito && noCampoDeVisao()) revelar(); });
    // caso a seção já esteja na tela no carregamento (página curta, link direto)
    setTimeout(() => { if (noCampoDeVisao()) revelar(); }, 1200);

    /* Último recurso, e ele é LONGO de propósito. Antes eram 6 segundos, e
       isso brigava com o efeito: seis segundos não dão nem pra chegar na
       seção de contato, então a foto se revelava sozinha lá embaixo e a
       pessoa encontrava tudo já pronto. Trinta segundos sem ninguém chegar
       lá significa que a revelação não vai ser vista de qualquer forma —
       aí o que importa é só a foto não ficar escondida para sempre. */
    setTimeout(revelar, 30000);
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

    /* PAUSADO É O ESTADO INICIAL, e essa inversão é o conserto.

       Antes o módulo confiava no IntersectionObserver para descobrir o que
       estava fora da tela. Só que a classe nascia AUSENTE, ou seja: tudo
       começava rodando, e só parava quando o observer resolvesse avisar. Medi
       o resultado com a página no topo — 68 animações das bandeiras e 8 dos
       marquees girando a mais de 3.700px abaixo da dobra, desde o primeiro
       quadro. Justamente o trabalho que este módulo existe pra evitar.

       Marcando tudo como fora da tela antes de qualquer coisa, o padrão passa
       a ser o barato: só volta a rodar o que for visto de fato. Pausar
       animação não esconde conteúdo nenhum, então não há risco em errar para
       o lado de pausar demais. */
    secoes.forEach((s) => s.classList.add('fora-da-tela'));

    // conta pela geometria, sem depender do observer
    function conferir(){
      const h = window.innerHeight || 1;
      for (const s of secoes) {
        const r = s.getBoundingClientRect();
        const perto = r.bottom > -MARGEM && r.top < h + MARGEM;
        s.classList.toggle('fora-da-tela', !perto);
      }
    }

    Agenda.scroll(conferir);
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
