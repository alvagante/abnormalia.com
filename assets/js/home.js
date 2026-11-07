// Home page: drifting binary field + dashed edge graph (fig.01), life highlight (fig.02).
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- fig.02: light a life's line on hover/focus
  var iam = document.getElementById('iam-graph');
  if (iam) {
    var label = iam.querySelector('.hm-hover-label');
    var setLife = function (i, title) {
      iam.querySelectorAll('[data-life]').forEach(function (el) {
        if (el.classList.contains('hm-node')) return;
        el.classList.toggle('lit', i !== null && el.dataset.life === i);
      });
      label.textContent = '// ' + (i === null ? label.dataset.default : 'living ' + title);
    };
    iam.querySelectorAll('.hm-node').forEach(function (n) {
      var on = function () { setLife(n.dataset.life, n.dataset.title); };
      var off = function () { setLife(null); };
      n.addEventListener('mouseenter', on); n.addEventListener('mouseleave', off);
      n.addEventListener('focusin', on); n.addEventListener('focusout', off);
    });
  }

  // ---- fig.01: canvas
  var box = document.getElementById('ixen-graph');
  if (!box) return;
  var canvas = box.querySelector('canvas');
  var ctx = canvas.getContext('2d');
  var edges = JSON.parse(document.getElementById('ixen-edges').textContent);
  var nodes = [].slice.call(box.querySelectorAll('.hm-node'));
  var hoverLabel = box.querySelector('.hm-hover-label');
  var hover = null, t = 0, W = 0, H = 0, particles = [];
  var ink = '27,24,21', accent = '214,69,31';

  function setHover(i) {
    hover = i;
    hoverLabel.textContent = '// ' + (i === null ? hoverLabel.dataset.default : 'tracing ' + nodes[i].dataset.title);
  }
  nodes.forEach(function (n, i) {
    n.addEventListener('mouseenter', function () { setHover(i); });
    n.addEventListener('mouseleave', function () { setHover(null); });
    n.addEventListener('focusin', function () { setHover(i); });
    n.addEventListener('focusout', function () { setHover(null); });
  });

  function resize() {
    var r = box.getBoundingClientRect();
    W = r.width; H = r.height;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.max(36, Math.min(140, Math.round(W * H / 15000)));
    particles = [];
    for (var i = 0; i < n; i++) particles.push({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.16, vy: (Math.random() - 0.5) * 0.16,
      bit: Math.random() < 0.5 ? '0' : '1', a: 0.05 + Math.random() * 0.12
    });
  }
  new ResizeObserver(resize).observe(box);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);

  function centers() {
    var br = box.getBoundingClientRect();
    return nodes.map(function (el) {
      var r = el.getBoundingClientRect();
      return { x: r.left - br.left + r.width / 2, y: r.top - br.top + r.height / 2, hw: r.width / 2, hh: r.height / 2 };
    });
  }

  function draw() {
    if (!W) return;
    t += reduce ? 0 : 0.016;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    particles.forEach(function (p) {
      if (!reduce) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < -4) p.x += W + 8; if (p.x > W + 4) p.x -= W + 8;
        if (p.y < -4) p.y += H + 8; if (p.y > H + 4) p.y -= H + 8;
      }
      ctx.fillStyle = 'rgba(' + ink + ',' + p.a + ')';
      ctx.fillText(p.bit, p.x, p.y);
    });
    if (W < 760) return;
    var C = centers();
    edges.forEach(function (e, ei) {
      var A = C[e[0]], B = C[e[1]];
      var dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      var sA = 1 / Math.max(Math.abs(ux) / A.hw, Math.abs(uy) / A.hh);
      var sB = 1 / Math.max(Math.abs(ux) / B.hw, Math.abs(uy) / B.hh);
      var x1 = A.x + ux * (sA + 6), y1 = A.y + uy * (sA + 6);
      var x2 = B.x - ux * (sB + 10), y2 = B.y - uy * (sB + 10);
      if ((x2 - x1) * ux + (y2 - y1) * uy < 20) return;
      var hov = hover === e[0] || hover === e[1];
      ctx.save();
      ctx.setLineDash([5, 6]); ctx.lineDashOffset = -t * 20;
      ctx.strokeStyle = hov ? 'rgba(' + accent + ',0.85)' : 'rgba(' + ink + ',0.22)';
      ctx.lineWidth = hov ? 1.6 : 1;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
      var ah = 7;
      ctx.fillStyle = hov ? 'rgba(' + accent + ',0.95)' : 'rgba(' + ink + ',0.4)';
      ctx.beginPath(); ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - ux * ah - uy * ah * 0.6, y2 - uy * ah + ux * ah * 0.6);
      ctx.lineTo(x2 - ux * ah + uy * ah * 0.6, y2 - uy * ah - ux * ah * 0.6);
      ctx.closePath(); ctx.fill();
      var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      ctx.textAlign = 'center';
      var tw = ctx.measureText(e[2]).width;
      ctx.fillStyle = 'rgba(239,236,227,0.92)';
      ctx.fillRect(mx - tw / 2 - 5, my - 7, tw + 10, 14);
      ctx.fillStyle = hov ? 'rgba(' + accent + ',1)' : 'rgba(' + ink + ',0.6)';
      ctx.fillText(e[2], mx, my);
      ctx.textAlign = 'left';
      if (hov) {
        var tt = (t * 0.35 + ei * 0.2) % 1, px = x1 + (x2 - x1) * tt, py = y1 + (y2 - y1) * tt;
        ctx.fillStyle = 'rgba(' + accent + ',1)'; ctx.beginPath(); ctx.arc(px, py, 2.6, 0, 6.2832); ctx.fill();
        ctx.fillStyle = 'rgba(' + accent + ',0.22)'; ctx.beginPath(); ctx.arc(px, py, 6, 0, 6.2832); ctx.fill();
      }
    });
    if (hover !== null && C[hover]) {
      var N = C[hover], g = ctx.createRadialGradient(N.x, N.y, 2, N.x, N.y, 160);
      g.addColorStop(0, 'rgba(' + accent + ',0.10)'); g.addColorStop(1, 'rgba(' + accent + ',0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(N.x, N.y, 160, 0, 6.2832); ctx.fill();
    }
  }
  (function loop() { draw(); requestAnimationFrame(loop); })();
})();
