/* Falling snow — soft, layered, reacts to the mouse like a breeze. */
(function () {
  const canvas = document.getElementById('snow');
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W, H, dpr, flakes = [], wind = 0, targetWind = 0, running = !reduce, raf;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.width = innerWidth * dpr;
    H = canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    const target = Math.round(Math.min(220, (innerWidth * innerHeight) / 9000));
    while (flakes.length < target) flakes.push(make(true));
    flakes.length = target;
  }

  function make(anywhere) {
    const depth = Math.random();               // 0 = far, 1 = near
    return {
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : -10 * dpr,
      r: (0.6 + depth * 2.6) * dpr,
      vy: (0.25 + depth * 1.1) * dpr,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.004 + Math.random() * 0.012,
      swayAmp: (0.2 + depth * 0.8) * dpr,
      a: 0.35 + depth * 0.6,
      depth
    };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    wind += (targetWind - wind) * 0.02;
    for (const f of flakes) {
      f.sway += f.swaySpeed;
      f.y += f.vy;
      f.x += Math.sin(f.sway) * f.swayAmp + wind * (0.4 + f.depth) * dpr;
      if (f.y > H + 10) Object.assign(f, make(false));
      if (f.x > W + 10) f.x = -10;
      if (f.x < -10) f.x = W + 10;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${f.a})`;
      if (f.depth > 0.8) { ctx.shadowColor = 'rgba(255,255,255,.8)'; ctx.shadowBlur = 6 * dpr; }
      else ctx.shadowBlur = 0;
      ctx.fill();
    }
    raf = requestAnimationFrame(draw);
  }

  addEventListener('mousemove', e => { targetWind = ((e.clientX / innerWidth) - 0.5) * 1.6; });
  addEventListener('resize', resize);
  resize();
  if (running) draw();

  // public toggle + burst
  window.Snow = {
    toggle() {
      running = !running;
      if (running) draw(); else { cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H); }
      return running;
    },
    burst() {          // a short flurry, used after a successful booking
      for (let i = 0; i < 120; i++) {
        const f = make(false);
        f.y = -Math.random() * H * 0.4; f.vy *= 1.8; flakes.push(f);
      }
      setTimeout(resize, 9000);
    },
    get on() { return running; }
  };
})();
