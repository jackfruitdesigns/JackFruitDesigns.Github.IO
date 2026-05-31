// Jackfruit Designs — game.js
// DRAWING MODE active: click+drag to place wall rectangles, then submit.
// GAME MODE: swap the entry point line at the bottom once walls are submitted.

(function () {
  'use strict';

  function rm(id) { document.getElementById(id)?.remove(); }
  function lockScroll()   { document.body.style.overflow = 'hidden'; }
  function unlockScroll() { document.body.style.overflow = ''; }
  function normalizeAngle(a) {
    while (a >  Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
  function btnCSS(border, color, filled = false) {
    return `background:${filled ? border : 'none'};border:1px solid ${filled ? 'transparent' : border};
      color:${color};font-family:inherit;font-size:.63rem;font-weight:700;letter-spacing:.1em;
      text-transform:uppercase;padding:6px 14px;border-radius:4px;cursor:pointer;white-space:nowrap`;
  }

  // ── Entry point ─────────────────────────────────────────────
  // Wall editor: startDrawingMode  |  Game: startGame
  window.startJackfruitGame = startGame;

  // Custom walls drawn in the wall editor — hero headline area
  const CUSTOM_WALLS = [
    { x:680, y:675, w:260, h:102 },
    { x:676, y:261, w:338, h:27  },
    { x:676, y:328, w:653, h:123 },
    { x:676, y:505, w:320, h:106 },
    { x:678, y:940, w:444, h:21  },
    { x:678, y:960, w:349, h:25  },
    { x:937, y:735, w:37,  h:42  },
    { x:1029,y:505, w:401, h:104 },
  ];

  // ════════════════════════════════════════════════════════════
  //  DRAWING MODE  — select · move · resize · delete
  // ════════════════════════════════════════════════════════════
  let dc = null, dctx = null;
  let drawRects  = loadSaved();
  let selIdx     = null;
  let editorMode = 'idle';         // 'idle' | 'drawing' | 'moving' | 'resizing' | 'rotating'
  let drawTool   = 'rect';         // 'rect' | 'circle'
  let dragHandle = null;
  let dragStart  = null;
  let origRect   = null;
  let previewR   = null;
  let drawOrigin = null;

  const HR = 8;  // handle hit radius px

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem('jfWalls') || '[]'); } catch { return []; }
  }
  function persistRects() { localStorage.setItem('jfWalls', JSON.stringify(drawRects)); }

  function rotPt(px, py, cx, cy, a) {
    const dx = px-cx, dy = py-cy;
    return { x: cx + dx*Math.cos(a) - dy*Math.sin(a), y: cy + dx*Math.sin(a) + dy*Math.cos(a) };
  }

  function handles(r) {
    if (r.type === 'circle') {
      return { n:{x:r.x,y:r.y-r.r}, e:{x:r.x+r.r,y:r.y}, s:{x:r.x,y:r.y+r.r}, w:{x:r.x-r.r,y:r.y} };
    }
    const cx = r.x+r.w/2, cy = r.y+r.h/2, a = r.angle||0;
    const P = (px,py) => rotPt(px,py,cx,cy,a);
    return {
      nw:P(r.x,       r.y       ), n:P(r.x+r.w/2, r.y       ), ne:P(r.x+r.w, r.y       ),
      e: P(r.x+r.w,   r.y+r.h/2 ),
      se:P(r.x+r.w,   r.y+r.h   ), s:P(r.x+r.w/2, r.y+r.h   ), sw:P(r.x,     r.y+r.h   ),
      w: P(r.x,       r.y+r.h/2 ),
      rot: P(r.x+r.w/2, r.y-30),   // rotation handle above top edge
    };
  }

  function hitHandle(mx, my, r) {
    for (const [name, h] of Object.entries(handles(r)))
      if ((mx-h.x)**2 + (my-h.y)**2 <= HR**2) return name;
    return null;
  }

  function insideShape(mx, my, r) {
    if (r.type === 'circle') return (mx-r.x)**2 + (my-r.y)**2 <= r.r**2;
    const a = r.angle||0;
    if (!a) return mx>=r.x && mx<=r.x+r.w && my>=r.y && my<=r.y+r.h;
    const cx=r.x+r.w/2, cy=r.y+r.h/2;
    const lx=(mx-cx)*Math.cos(-a)-(my-cy)*Math.sin(-a)+cx;
    const ly=(mx-cx)*Math.sin(-a)+(my-cy)*Math.cos(-a)+cy;
    return lx>=r.x && lx<=r.x+r.w && ly>=r.y && ly<=r.y+r.h;
  }
  function insideRect(mx,my,r) { return insideShape(mx,my,r); }

  function applyResize(handle, orig, dx, dy) {
    if (orig.type === 'circle') {
      const nr = Math.hypot(dx, dy) * (handle==='w'||handle==='n' ? -1 : 1);
      return { ...orig, r: Math.max(12, orig.r + nr) };
    }
    let {x, y, w, h, angle} = orig;
    if (handle.includes('n')) { y += dy; h -= dy; }
    if (handle.includes('s')) { h += dy; }
    if (handle.includes('w')) { x += dx; w -= dx; }
    if (handle.includes('e')) { w += dx; }
    if (w < 12) { if (handle.includes('w')) x = orig.x + orig.w - 12; w = 12; }
    if (h < 12) { if (handle.includes('n')) y = orig.y + orig.h - 12; h = 12; }
    return { x, y, w, h, angle: angle||0 };
  }

  const CURSOR_MAP = {
    nw:'nw-resize', n:'n-resize', ne:'ne-resize', e:'e-resize',
    se:'se-resize', s:'s-resize', sw:'sw-resize', w:'w-resize',
    rot:'crosshair',
  };

  function startDrawingMode() {
    window.scrollTo(0, 0);
    lockScroll();
    buildDrawCanvas();
    buildDrawHUD();
  }

  function buildDrawCanvas() {
    rm('jfDC');
    dc = document.createElement('canvas');
    dc.id = 'jfDC';
    dc.width = innerWidth; dc.height = innerHeight;
    Object.assign(dc.style, {
      position:'fixed', top:0, left:0, width:'100%', height:'100%',
      zIndex:9998, cursor:'crosshair',
    });
    document.body.appendChild(dc);
    dctx = dc.getContext('2d');

    const mpos = e => ({ x:e.clientX, y:e.clientY });
    const tpos = e => ({ x:e.touches[0].clientX, y:e.touches[0].clientY });

    dc.addEventListener('mousedown', e => onDown(mpos(e)));
    dc.addEventListener('mousemove', e => onMove(mpos(e)));
    dc.addEventListener('mouseup',   ()  => onUp());
    dc.addEventListener('touchstart', e => { e.preventDefault(); onDown(tpos(e)); }, {passive:false});
    dc.addEventListener('touchmove',  e => { e.preventDefault(); onMove(tpos(e)); }, {passive:false});
    dc.addEventListener('touchend',   e => { e.preventDefault(); onUp(); },          {passive:false});

    // Keyboard: Delete/Backspace deletes selected rect, Escape deselects
    window._jfKeyDraw = e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selIdx !== null) {
        drawRects.splice(selIdx, 1);
        selIdx = null; editorMode = 'idle';
        persistRects(); renderDraw(); e.preventDefault();
      }
      if (e.key === 'Escape') { selIdx = null; editorMode = 'idle'; renderDraw(); }
    };
    window.addEventListener('keydown', window._jfKeyDraw);

    renderDraw();
  }

  function onDown({ x, y }) {
    if (selIdx !== null) {
      const handle = hitHandle(x, y, drawRects[selIdx]);
      if (handle === 'rot') {
        editorMode = 'rotating'; dragStart = {x,y}; origRect = {...drawRects[selIdx]}; return;
      }
      if (handle) {
        editorMode = 'resizing'; dragHandle = handle;
        dragStart = {x,y}; origRect = {...drawRects[selIdx]}; return;
      }
      if (insideShape(x, y, drawRects[selIdx])) {
        editorMode = 'moving'; dragStart = {x,y}; origRect = {...drawRects[selIdx]}; return;
      }
    }
    for (let i = drawRects.length - 1; i >= 0; i--) {
      if (insideShape(x, y, drawRects[i])) { selIdx = i; editorMode = 'idle'; renderDraw(); return; }
    }
    selIdx = null; editorMode = 'drawing'; drawOrigin = {x,y}; previewR = null;
  }

  function onMove({ x, y }) {
    if (editorMode === 'drawing') {
      if (drawTool === 'circle') {
        previewR = { type:'circle', x:drawOrigin.x, y:drawOrigin.y, r:Math.max(8, Math.hypot(x-drawOrigin.x, y-drawOrigin.y)) };
      } else {
        previewR = { x:Math.min(drawOrigin.x,x), y:Math.min(drawOrigin.y,y), w:Math.abs(x-drawOrigin.x), h:Math.abs(y-drawOrigin.y), angle:0 };
      }
      renderDraw();
    } else if (editorMode === 'moving') {
      const s = origRect;
      drawRects[selIdx] = s.type==='circle'
        ? { ...s, x:s.x+(x-dragStart.x), y:s.y+(y-dragStart.y) }
        : { ...s, x:s.x+(x-dragStart.x), y:s.y+(y-dragStart.y) };
      renderDraw();
    } else if (editorMode === 'resizing') {
      const s = origRect;
      if (s.type === 'circle') {
        drawRects[selIdx] = { ...s, r: Math.max(12, Math.hypot(x-s.x, y-s.y)) };
      } else {
        drawRects[selIdx] = applyResize(dragHandle, s, x-dragStart.x, y-dragStart.y);
      }
      renderDraw();
    } else if (editorMode === 'rotating') {
      const s = origRect;
      const cx = s.x+s.w/2, cy = s.y+s.h/2;
      drawRects[selIdx] = { ...s, angle: Math.atan2(y-cy, x-cx) + Math.PI/2 };
      renderDraw();
    } else {
      if (selIdx !== null) {
        const h = hitHandle(x, y, drawRects[selIdx]);
        if (h) { dc.style.cursor = CURSOR_MAP[h]||'crosshair'; return; }
        if (insideShape(x, y, drawRects[selIdx])) { dc.style.cursor = 'move'; return; }
      }
      for (let i = drawRects.length-1; i >= 0; i--)
        if (insideShape(x, y, drawRects[i])) { dc.style.cursor = 'move'; return; }
      dc.style.cursor = 'crosshair';
    }
  }

  function onUp() {
    if (editorMode === 'drawing') {
      const valid = previewR && (previewR.type==='circle' ? previewR.r>8 : previewR.w>8 && previewR.h>8);
      if (valid) { drawRects.push({...previewR}); selIdx = drawRects.length-1; persistRects(); }
      previewR = null; editorMode = 'idle';
    } else if (editorMode === 'moving' || editorMode === 'resizing' || editorMode === 'rotating') {
      persistRects(); editorMode = 'idle';
    }
    renderDraw();
  }

  function renderDraw() {
    if (!dctx) return;
    dctx.clearRect(0, 0, dc.width, dc.height);

    drawRects.forEach((r, i) => {
      const sel = i === selIdx;
      dctx.fillStyle   = sel ? 'rgba(111,184,51,0.22)' : 'rgba(111,184,51,0.13)';
      dctx.strokeStyle = sel ? '#7ECF40' : '#6FB833';
      dctx.lineWidth   = sel ? 2.5 : 1.5;

      dctx.save();
      if (r.type === 'circle') {
        dctx.beginPath(); dctx.arc(r.x, r.y, r.r, 0, Math.PI*2); dctx.fill(); dctx.stroke();
        dctx.fillStyle = sel ? 'rgba(126,207,64,0.9)' : 'rgba(111,184,51,0.7)';
        dctx.font = 'bold 11px Montserrat,sans-serif';
        dctx.textAlign = 'center'; dctx.textBaseline = 'middle';
        dctx.fillText(`#${i+1}`, r.x, r.y);
      } else {
        const a = r.angle||0, cx = r.x+r.w/2, cy = r.y+r.h/2;
        dctx.translate(cx,cy); dctx.rotate(a);
        dctx.fillRect(-r.w/2,-r.h/2,r.w,r.h);
        dctx.strokeRect(-r.w/2,-r.h/2,r.w,r.h);
        dctx.fillStyle = sel ? 'rgba(126,207,64,0.9)' : 'rgba(111,184,51,0.7)';
        dctx.font = 'bold 11px Montserrat,sans-serif';
        dctx.textAlign = 'center'; dctx.textBaseline = 'middle';
        dctx.fillText(`#${i+1}`, 0, 0);
      }
      dctx.restore();

      if (sel) {
        const hs = handles(r);
        // Dashed line from top to rotation handle (rects only)
        if (!r.type && hs.n && hs.rot) {
          dctx.save(); dctx.strokeStyle='rgba(255,220,0,0.5)'; dctx.lineWidth=1; dctx.setLineDash([4,3]);
          dctx.beginPath(); dctx.moveTo(hs.n.x,hs.n.y); dctx.lineTo(hs.rot.x,hs.rot.y); dctx.stroke();
          dctx.setLineDash([]); dctx.restore();
        }
        Object.entries(hs).forEach(([name, h]) => {
          if (name === 'rot') {
            dctx.fillStyle='#FFD700'; dctx.strokeStyle='#3A6B1A'; dctx.lineWidth=2;
            dctx.beginPath(); dctx.arc(h.x,h.y,HR,0,Math.PI*2); dctx.fill(); dctx.stroke();
            dctx.strokeStyle='#1A1A1A'; dctx.lineWidth=1.5;
            dctx.beginPath(); dctx.arc(h.x,h.y,HR*.5,-Math.PI*.8,Math.PI*.2); dctx.stroke();
          } else {
            dctx.fillStyle='#fff'; dctx.strokeStyle='#6FB833'; dctx.lineWidth=2;
            dctx.beginPath(); dctx.arc(h.x,h.y,HR-2,0,Math.PI*2); dctx.fill(); dctx.stroke();
          }
        });
      }
    });

    if (previewR) {
      dctx.fillStyle='rgba(244,169,53,0.13)'; dctx.strokeStyle='#F4A935'; dctx.lineWidth=2;
      dctx.setLineDash([6,4]);
      if (previewR.type==='circle') {
        dctx.beginPath(); dctx.arc(previewR.x,previewR.y,previewR.r,0,Math.PI*2); dctx.fill(); dctx.stroke();
      } else {
        dctx.fillRect(previewR.x,previewR.y,previewR.w,previewR.h);
        dctx.strokeRect(previewR.x,previewR.y,previewR.w,previewR.h);
      }
      dctx.setLineDash([]);
    }

    dctx.fillStyle='rgba(255,255,255,.25)'; dctx.font='11px Montserrat,sans-serif';
    dctx.textAlign='right'; dctx.textBaseline='bottom';
    dctx.fillText(
      `${drawRects.length} shape${drawRects.length!==1?'s':''} · select to move/resize · yellow handle = rotate · Del to delete`,
      dc.width-14, dc.height-14
    );

    rm('jfDelBtn');
    if (selIdx !== null) {
      const r = drawRects[selIdx];
      const bx = r.type==='circle' ? r.x+r.r+8 : r.x+r.w+8;
      const by = r.type==='circle' ? r.y-r.r   : r.y;
      const btn = document.createElement('button');
      btn.id = 'jfDelBtn';
      btn.textContent = '✕ Delete';
      Object.assign(btn.style, {
        position:'fixed', left:Math.min(bx,innerWidth-90)+'px', top:by+'px',
        zIndex:10002, background:'rgba(200,50,50,0.88)', color:'#fff', border:'none',
        padding:'5px 12px', borderRadius:'4px',
        fontFamily:"'Montserrat',sans-serif", fontSize:'11px', fontWeight:700,
        cursor:'pointer', letterSpacing:'.06em',
      });
      btn.addEventListener('click', () => {
        drawRects.splice(selIdx,1); selIdx=null; editorMode='idle'; persistRects(); renderDraw();
      });
      document.body.appendChild(btn);
    }
  }

  function buildDrawHUD() {
    rm('jfDrawHUD');
    const hud = document.createElement('div');
    hud.id = 'jfDrawHUD';
    Object.assign(hud.style, {
      position:'fixed', top:0, left:0, right:0, height:'52px',
      zIndex:10000, display:'flex', alignItems:'center', gap:'10px',
      padding:'0 18px', background:'rgba(10,10,10,0.93)',
      backdropFilter:'blur(10px)', fontFamily:"'Montserrat',sans-serif",
    });
    hud.innerHTML = `
      <span style="color:#6FB833;font-weight:900;font-size:.78rem;letter-spacing:.15em;white-space:nowrap">WALL EDITOR</span>
      <button id="jfToolRect"   style="${btnCSS('#6FB833','#fff',true)}">▭ Rect</button>
      <button id="jfToolCircle" style="${btnCSS('rgba(255,255,255,.18)','rgba(255,255,255,.6)')}">● Circle</button>
      <span style="color:rgba(255,255,255,.32);font-size:.63rem;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        Drag to draw &nbsp;·&nbsp; Click to select &nbsp;·&nbsp; Drag handles to resize &nbsp;·&nbsp; Yellow handle = rotate
      </span>
      <button id="jfClearD" style="${btnCSS('rgba(255,80,80,.3)','rgba(255,110,110,.8)')}">Clear All</button>
      <button id="jfSubmit" style="${btnCSS('#3A6B1A','#fff',true)}">Submit Walls</button>
      <button id="jfQuitD"  style="${btnCSS('rgba(255,255,255,.18)','rgba(255,255,255,.5)')}">Quit</button>
    `;
    document.body.appendChild(hud);

    function setTool(t) {
      drawTool = t;
      document.getElementById('jfToolRect').style.cssText   = btnCSS(t==='rect'   ? '#6FB833' : 'rgba(255,255,255,.18)', t==='rect'   ? '#fff' : 'rgba(255,255,255,.6)', t==='rect');
      document.getElementById('jfToolCircle').style.cssText = btnCSS(t==='circle' ? '#6FB833' : 'rgba(255,255,255,.18)', t==='circle' ? '#fff' : 'rgba(255,255,255,.6)', t==='circle');
    }
    document.getElementById('jfToolRect').addEventListener('click',   () => setTool('rect'));
    document.getElementById('jfToolCircle').addEventListener('click', () => setTool('circle'));
    document.getElementById('jfClearD').addEventListener('click', () => {
      if (!confirm(`Delete all ${drawRects.length} shapes?`)) return;
      drawRects = []; selIdx = null; persistRects(); renderDraw();
    });
    document.getElementById('jfSubmit').addEventListener('click', submitWalls);
    document.getElementById('jfQuitD').addEventListener('click',  quitDrawing);
  }

  function submitWalls() {
    persistRects();
    const json = JSON.stringify(drawRects, null, 2);

    rm('jfModal');
    const modal = document.createElement('div');
    modal.id = 'jfModal';
    Object.assign(modal.style, {
      position: 'fixed', inset: '60px 16px 16px', zIndex: 10001,
      background: 'rgba(10,10,10,0.97)', border: '1px solid #3A6B1A',
      borderRadius: '10px', padding: '22px', display: 'flex',
      flexDirection: 'column', gap: '12px',
      fontFamily: "'Montserrat',sans-serif",
    });
    modal.innerHTML = `
      <div style="color:#6FB833;font-weight:900;font-size:.85rem;letter-spacing:.1em">
        ✓ ${drawRects.length} wall${drawRects.length !== 1 ? 's' : ''} saved to this browser — share the JSON below
      </div>
      <textarea readonly id="jfJson" style="
        flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
        border-radius:6px;padding:12px;color:rgba(255,255,255,.75);font-family:monospace;
        font-size:.72rem;line-height:1.6;resize:none;outline:none;">${json}</textarea>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="jfCopyJ" style="${btnCSS('#3A6B1A','#fff',true)}">Copy JSON</button>
        <button id="jfCloseM" style="${btnCSS('rgba(255,255,255,.2)','rgba(255,255,255,.6)')}">Close</button>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById('jfCopyJ').addEventListener('click', () => {
      navigator.clipboard.writeText(json).then(() => {
        document.getElementById('jfCopyJ').textContent = 'Copied ✓';
      });
    });
    document.getElementById('jfCloseM').addEventListener('click', () => rm('jfModal'));

    // Select all text for easy copy
    setTimeout(() => document.getElementById('jfJson')?.select(), 50);
  }

  function quitDrawing() {
    rm('jfDC'); rm('jfDrawHUD'); rm('jfModal'); rm('jfDelBtn');
    if (window._jfKeyDraw) { window.removeEventListener('keydown', window._jfKeyDraw); window._jfKeyDraw = null; }
    selIdx = null; editorMode = 'idle';
    unlockScroll();
    dc = dctx = null;
  }

  // ════════════════════════════════════════════════════════════
  //  PAC-MAN GAME ENGINE
  // ════════════════════════════════════════════════════════════
  const MCOLS = 21, MROWS = 21;
  // 0=wall  1=dot  2=power pellet  3=empty walkable
  const MAZE_SRC = [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,0],
    [0,2,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,2,0],
    [0,1,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,1,0],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
    [0,1,0,0,1,0,1,0,0,0,0,0,0,0,1,0,1,0,0,1,0],
    [0,1,1,1,1,0,1,1,1,0,0,0,1,1,1,0,1,1,1,1,0],
    [0,0,0,0,1,0,0,0,3,0,0,0,3,0,0,0,1,0,0,0,0],
    [0,0,0,0,1,0,3,3,3,3,3,3,3,3,3,0,1,0,0,0,0],
    [3,3,3,3,1,3,3,0,3,3,3,3,3,0,3,3,1,3,3,3,3],
    [0,0,0,0,1,0,3,0,3,3,3,3,3,0,3,0,1,0,0,0,0],
    [0,0,0,0,1,0,3,3,3,3,3,3,3,3,3,0,1,0,0,0,0],
    [0,1,1,1,1,1,1,1,1,0,3,0,1,1,1,1,1,1,1,1,0],
    [0,1,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,1,0],
    [0,2,1,0,1,1,1,1,1,1,3,1,1,1,1,1,1,0,1,2,0],
    [0,0,1,0,1,0,1,0,0,0,0,0,0,0,1,0,1,0,1,0,0],
    [0,1,1,1,1,0,1,1,1,0,0,0,1,1,1,0,1,1,1,1,0],
    [0,1,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,1,0],
    [0,1,1,1,1,1,1,1,1,1,3,1,1,1,1,1,1,1,1,1,0],
    [0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  ];

  let CELL, OX, OY;
  let maze, totalDots, score;
  let powerTicks, jfTicks, jfBonus, jfImage;
  let pac, ghosts;
  let canvas, ctx;
  let gameState = 'idle', raf = null, tick = 0, lastFrameTime = 0;
  let mouthA = 0.25, mouthD = 1, facing = 0;
  let keys = {};
  let joystickVec = { dx: 0, dy: 0 };
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const GHOST_EMOJIS = ['🍎','🍌','🍐','🍑','🍇'];
  const PAC_SPD = 2.0, GHOST_SPD = 1.5;

  function startGame() {
    if (gameState === 'playing') return;
    window.scrollTo({ top: 0, behavior: 'instant' });
    requestAnimationFrame(() => {
      animateExplode(() => {
        buildGameCanvas();
        buildGameHUD();
        initMaze();
        spawnEntities();
        lockScroll();
        bindKeys();
        if (isTouch) buildJoystick();
        gameState = 'playing'; tick = 0;
        raf = requestAnimationFrame(gameLoop);
      });
    });
  }

  function animateExplode(cb) {
    const inner = document.querySelector('.hero__inner');
    if (!inner) { cb(); return; }
    const cx = innerWidth/2, cy = innerHeight/2;
    inner.querySelectorAll('.hw').forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const ang = Math.atan2(r.top + r.height/2 - cy, r.left + r.width/2 - cx);
      const dist = 120 + Math.random()*100;
      el.style.transition = `transform 0.4s cubic-bezier(0.55,0,1,0.45) ${i*40}ms, opacity 0.3s ease ${i*40}ms`;
      el.style.transform  = `translate(${Math.cos(ang)*dist}px,${Math.sin(ang)*dist}px) scale(0.4)`;
      el.style.opacity    = '0';
    });
    ['.hero__eyebrow','.hero__sub','.hero__actions','.hero__fruit-lineup'].forEach(sel => {
      const el = inner.querySelector(sel);
      if (el) { el.style.transition = 'opacity 0.3s ease'; el.style.opacity = '0'; }
    });
    setTimeout(cb, 550);
  }

  function resetExplode() {
    const inner = document.querySelector('.hero__inner');
    if (!inner) return;
    inner.querySelectorAll('.hw').forEach(el => {
      el.style.transition = el.style.transform = el.style.opacity = '';
    });
    ['.hero__eyebrow','.hero__sub','.hero__actions','.hero__fruit-lineup'].forEach(sel => {
      const el = inner.querySelector(sel);
      if (el) el.style.transition = el.style.opacity = '';
    });
  }

  function buildGameCanvas() {
    rm('jfCanvas');
    canvas = document.createElement('canvas');
    canvas.id = 'jfCanvas';
    canvas.width = innerWidth; canvas.height = innerHeight;
    Object.assign(canvas.style, {
      position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      zIndex: 9998, pointerEvents: 'none',
    });
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
  }

  function buildGameHUD() {
    rm('jfHUD'); rm('jfBlocker');
    const hud = document.createElement('div');
    hud.id = 'jfHUD';
    Object.assign(hud.style, {
      position: 'fixed', top: 0, left: 0, right: 0, height: '48px',
      zIndex: 10000, display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', padding: '0 20px',
      background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(10px)',
      fontFamily: "'Montserrat',sans-serif", pointerEvents: 'all',
    });
    hud.innerHTML = `
      <span style="color:#6FB833;font-weight:900;font-size:.78rem;letter-spacing:.16em">JACKFRUIT CHASE</span>
      <span id="jfScore" style="color:#fff;font-weight:700;font-size:.85rem;letter-spacing:.08em">0</span>
      <button id="jfQuit" style="${btnCSS('rgba(255,255,255,.22)','rgba(255,255,255,.55)')}">Quit</button>`;
    document.body.appendChild(hud);
    document.getElementById('jfQuit').addEventListener('click', () => finishGame('quit'));
    const blocker = document.createElement('div');
    blocker.id = 'jfBlocker';
    Object.assign(blocker.style, { position:'fixed', inset:0, zIndex:9997, pointerEvents:'all', cursor:'default' });
    blocker.addEventListener('click', e => e.stopPropagation());
    blocker.addEventListener('mousedown', e => e.stopPropagation());
    document.body.appendChild(blocker);
  }

  function initMaze() {
    maze = MAZE_SRC.map(row => [...row]);
    totalDots = maze.flat().filter(c => c===1||c===2).length;
    score = 0; powerTicks = 0; jfTicks = 480; jfBonus = null;
    const HUD = 48;
    CELL = Math.max(16, Math.min(Math.floor(innerWidth/MCOLS), Math.floor((innerHeight-HUD)/MROWS)));
    OX = Math.floor((innerWidth  - CELL*MCOLS) / 2);
    OY = HUD + Math.floor((innerHeight - HUD - CELL*MROWS) / 2);
  }

  function spawnEntities() {
    pac = { x:OX+10*CELL+CELL/2, y:OY+18*CELL+CELL/2, tileX:10, tileY:18, dx:0, dy:0, nextDx:-1, nextDy:0 };
    const starts = [[1,2],[1,18],[4,10],[12,2],[12,18]];
    ghosts = GHOST_EMOJIS.map((emoji, i) => {
      const [r,c] = starts[i];
      return { emoji, x:OX+c*CELL+CELL/2, y:OY+r*CELL+CELL/2, tileX:c, tileY:r, dx:i%2===0?1:-1, dy:0, scared:false };
    });
  }

  function isWall(col, row) {
    if (row<0||row>=MROWS) return true;
    return maze[row][((col%MCOLS)+MCOLS)%MCOLS] === 0;
  }
  function tileOf(px, py) {
    return { col:Math.max(0,Math.min(MCOLS-1,Math.floor((px-OX)/CELL))), row:Math.max(0,Math.min(MROWS-1,Math.floor((py-OY)/CELL))) };
  }
  function centerOf(col, row) { return { x:OX+col*CELL+CELL/2, y:OY+row*CELL+CELL/2 }; }

  function movePac() {
    if      (keys['ArrowLeft'] ||keys.a||keys.A||joystickVec.dx<-.3) { pac.nextDx=-1; pac.nextDy=0; }
    else if (keys['ArrowRight']||keys.d||keys.D||joystickVec.dx> .3) { pac.nextDx= 1; pac.nextDy=0; }
    else if (keys['ArrowUp']   ||keys.w||keys.W||joystickVec.dy<-.3) { pac.nextDx=0; pac.nextDy=-1; }
    else if (keys['ArrowDown'] ||keys.s||keys.S||joystickVec.dy> .3) { pac.nextDx=0; pac.nextDy= 1; }

    // Move toward the center of pac.tileX/tileY
    const tx = OX+pac.tileX*CELL+CELL/2, ty = OY+pac.tileY*CELL+CELL/2;
    const dist = Math.hypot(pac.x-tx, pac.y-ty);

    if (dist <= PAC_SPD) {
      pac.x = tx; pac.y = ty;
      const cell = maze[pac.tileY]?.[pac.tileX];
      if (cell===1) { maze[pac.tileY][pac.tileX]=3; score+=10; totalDots--; }
      else if (cell===2) { maze[pac.tileY][pac.tileX]=3; score+=50; totalDots--; powerTicks=300; }
      // Try queued turn
      if (!isWall(pac.tileX+pac.nextDx, pac.tileY+pac.nextDy)) { pac.dx=pac.nextDx; pac.dy=pac.nextDy; }
      // Advance to next tile
      if (pac.dx||pac.dy) {
        if (!isWall(pac.tileX+pac.dx, pac.tileY+pac.dy)) { pac.tileX+=pac.dx; pac.tileY+=pac.dy; }
        else { pac.dx=0; pac.dy=0; }
      }
      // Tunnel wrap
      if (pac.tileX < 0) { pac.tileX=MCOLS-1; pac.x=OX+(MCOLS-1)*CELL+CELL/2; }
      if (pac.tileX >= MCOLS) { pac.tileX=0; pac.x=OX+CELL/2; }
    } else {
      const dx=tx-pac.x, dy=ty-pac.y;
      pac.x += dx/dist*PAC_SPD; pac.y += dy/dist*PAC_SPD;
    }
    if (pac.dx>0) facing=0; else if (pac.dx<0) facing=Math.PI;
    else if (pac.dy>0) facing=Math.PI/2; else if (pac.dy<0) facing=-Math.PI/2;
  }

  function moveGhost(g) {
    const tx=OX+g.tileX*CELL+CELL/2, ty=OY+g.tileY*CELL+CELL/2;
    const spd=g.scared?GHOST_SPD*.5:GHOST_SPD;
    const dist=Math.hypot(g.x-tx,g.y-ty);

    if (dist<=spd) {
      g.x=tx; g.y=ty;
      const dirs=[{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
      let valid=dirs.filter(d=>!(d.dx===-g.dx&&d.dy===-g.dy)&&!isWall(g.tileX+d.dx,g.tileY+d.dy));
      if (!valid.length) valid=dirs.filter(d=>!isWall(g.tileX+d.dx,g.tileY+d.dy));
      if (valid.length) {
        valid.sort((a,b)=>{
          const da=(g.tileX+a.dx-pac.tileX)**2+(g.tileY+a.dy-pac.tileY)**2;
          const db=(g.tileX+b.dx-pac.tileX)**2+(g.tileY+b.dy-pac.tileY)**2;
          return g.scared?db-da:da-db;
        });
        g.dx=valid[0].dx; g.dy=valid[0].dy;
        g.tileX+=g.dx; g.tileY+=g.dy;
        if (g.tileX<0) { g.tileX=MCOLS-1; g.x=OX+(MCOLS-1)*CELL+CELL/2; }
        if (g.tileX>=MCOLS) { g.tileX=0; g.x=OX+CELL/2; }
      }
    } else {
      const dxx=tx-g.x, dyy=ty-g.y;
      g.x+=dxx/dist*spd; g.y+=dyy/dist*spd;
    }
  }

  function updateJFBonus() {
    if (--jfTicks<=0) {
      if (!jfBonus) { jfBonus={col:10,row:14}; jfTicks=300; }
      else          { jfBonus=null; jfTicks=480; }
    }
    if (jfBonus) {
      const bc=centerOf(jfBonus.col,jfBonus.row);
      if (Math.hypot(pac.x-bc.x,pac.y-bc.y)<CELL*.85) { score+=1000; jfBonus=null; jfTicks=360; }
    }
  }

  function gameLoop(timestamp) {
    if (gameState!=='playing') return;
    raf = requestAnimationFrame(gameLoop);
    if (timestamp - lastFrameTime < 15.5) return; // cap at ~60fps even on 120Hz displays
    lastFrameTime = timestamp;
    tick++;
    updateGame(); drawGame();
  }

  function updateGame() {
    movePac();
    powerTicks=Math.max(0,powerTicks-1);
    ghosts.forEach(g=>{ g.scared=powerTicks>0; });
    ghosts.forEach(moveGhost);
    updateJFBonus();
    mouthA+=0.14*mouthD; if (mouthA>.38||mouthA<.02) mouthD*=-1;
    const el=document.getElementById('jfScore'); if (el) el.textContent=score;
    for (const g of ghosts) {
      if (Math.hypot(pac.x-g.x,pac.y-g.y)<CELL*.65) {
        if (g.scared) {
          g.scared=false; score+=200;
          const rc=g.dx<0?18:2;
          g.tileX=rc; g.tileY=1; g.x=OX+rc*CELL+CELL/2; g.y=OY+CELL+CELL/2; g.dx=0; g.dy=1;
        } else { finishGame('lost'); return; }
      }
    }
    if (totalDots<=0) { finishGame('won'); return; }
  }

  function drawGame() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#060808'; ctx.fillRect(0,0,canvas.width,canvas.height);
    drawMaze(); drawJFBonus(); ghosts.forEach(drawGhost); drawPacman();
  }

  function drawMaze() {
    for (let r=0;r<MROWS;r++) for (let c=0;c<MCOLS;c++) {
      const x=OX+c*CELL, y=OY+r*CELL, cell=maze[r][c];
      if (cell===0) {
        ctx.fillStyle='#0d2d0a'; ctx.fillRect(x,y,CELL,CELL);
        ctx.fillStyle='#1a4f12'; ctx.fillRect(x+1,y+1,CELL-2,CELL-2);
      } else if (cell===1) {
        ctx.fillStyle='rgba(255,238,160,0.9)';
        ctx.beginPath(); ctx.arc(x+CELL/2,y+CELL/2,Math.max(2,CELL*.1),0,Math.PI*2); ctx.fill();
      } else if (cell===2) {
        const p=.85+.15*Math.sin(tick*.1);
        ctx.fillStyle=`rgba(111,184,51,${p})`;
        ctx.beginPath(); ctx.arc(x+CELL/2,y+CELL/2,CELL*.24,0,Math.PI*2); ctx.fill();
        const g=ctx.createRadialGradient(x+CELL/2,y+CELL/2,0,x+CELL/2,y+CELL/2,CELL*.6);
        g.addColorStop(0,`rgba(111,184,51,${.25*p})`); g.addColorStop(1,'rgba(111,184,51,0)');
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x+CELL/2,y+CELL/2,CELL*.6,0,Math.PI*2); ctx.fill();
      }
    }
  }

  function drawPacman() {
    const {x,y}=pac, r=CELL*.44, a=facing, m=mouthA;
    ctx.fillStyle='rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(x+2,y+4,r*.9,r*.38,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#6FB833'; ctx.beginPath(); ctx.moveTo(x,y); ctx.arc(x,y,r,a+m,a+Math.PI*2-m); ctx.closePath(); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.18)'; ctx.beginPath(); ctx.arc(x-r*.28,y-r*.28,r*.36,0,Math.PI*2); ctx.fill();
    const ex=x+Math.cos(a-.42)*r*.52, ey=y+Math.sin(a-.42)*r*.52;
    ctx.fillStyle='#1A1A1A'; ctx.beginPath(); ctx.arc(ex,ey,r*.14,0,Math.PI*2); ctx.fill();
  }

  function drawGhost(g) {
    const sz=CELL*.9, wb=Math.sin(tick*.09+GHOST_EMOJIS.indexOf(g.emoji))*.06;
    ctx.save(); ctx.translate(g.x,g.y); ctx.rotate(wb);
    ctx.filter=g.scared?'grayscale(1) brightness(0.22) sepia(1) hue-rotate(190deg)':'grayscale(1) brightness(0.14)';
    ctx.font=`${Math.floor(sz)}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(g.emoji,0,2); ctx.filter='none';
    if (!g.scared) {
      const eyeR=sz*.2, pa=Math.atan2(pac.y-g.y,pac.x-g.x);
      [[-sz*.22,sz*.05],[sz*.22,sz*.05]].forEach(([ox,oy])=>{
        ctx.fillStyle='#fff'; ctx.strokeStyle='rgba(0,0,0,.3)'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.arc(ox,oy,eyeR,0,Math.PI*2); ctx.fill(); ctx.stroke();
        const px=ox+Math.cos(pa)*eyeR*.44, py=oy+Math.sin(pa)*eyeR*.44;
        ctx.fillStyle='#111'; ctx.beginPath(); ctx.arc(px,py,eyeR*.5,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='rgba(255,255,255,.6)'; ctx.beginPath(); ctx.arc(px-1,py-1,eyeR*.2,0,Math.PI*2); ctx.fill();
      });
    }
    ctx.restore();
  }

  function drawJFBonus() {
    if (!jfBonus) return;
    const {x,y}=centerOf(jfBonus.col,jfBonus.row), sz=CELL*1.8, pulse=1+.08*Math.sin(tick*.14);
    // Glow ring
    const g=ctx.createRadialGradient(x,y,0,x,y,sz);
    g.addColorStop(0,'rgba(111,184,51,0.35)'); g.addColorStop(1,'rgba(111,184,51,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,sz,0,Math.PI*2); ctx.fill();
    ctx.save(); ctx.translate(x,y); ctx.scale(pulse,pulse);
    // Clip to circle so white PNG background disappears
    ctx.beginPath(); ctx.arc(0,0,sz/2,0,Math.PI*2); ctx.clip();
    if (jfImage&&jfImage.complete&&jfImage.naturalWidth>0) {
      ctx.drawImage(jfImage,-sz/2,-sz/2,sz,sz);
    } else {
      ctx.fillStyle='#4A8A20'; ctx.fillRect(-sz/2,-sz/2,sz,sz);
    }
    ctx.restore();
    ctx.fillStyle='rgba(111,184,51,.9)'; ctx.font=`bold ${Math.floor(CELL*.5)}px Montserrat,sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('+1000',x,y+sz*.6+CELL*.4);
  }

  function finishGame(result) {
    gameState = result;
    cancelAnimationFrame(raf);
    unlockScroll(); unbindKeys();
    resetExplode();
    document.querySelector('.hero__fruit-lineup')?.classList.remove('game-on');
    if (ctx) ctx.clearRect(0,0,canvas.width,canvas.height);
    rm('jfCanvas'); rm('jfHUD'); rm('jfDpad'); rm('jfJoystick'); rm('jfBlocker');
    joystickVec.dx = joystickVec.dy = 0;
    if (result==='won'||result==='lost') {
      showBanner(result==='won');
      setTimeout(()=>document.getElementById('contact')?.scrollIntoView({behavior:'smooth'}),350);
    }
  }

  function showBanner(won) {
    rm('jfBanner');
    const div = document.createElement('div');
    div.id = 'jfBanner';
    Object.assign(div.style, {
      background:won?'rgba(111,184,51,0.13)':'rgba(200,50,50,0.1)',
      border:`1px solid ${won?'#6FB833':'rgba(200,50,50,.4)'}`,
      borderRadius:'10px', padding:'28px 32px', marginBottom:'28px',
      textAlign:'center', fontFamily:"'Montserrat',sans-serif", color:'#fff',
    });
    div.innerHTML = won
      ? `<div style="font-size:2.2rem;margin-bottom:10px">🏆</div>
         <div style="font-weight:900;font-size:1rem;color:#6FB833;letter-spacing:.08em;margin-bottom:10px">YOU ATE ALL THE DOTS!</div>
         <div style="font-size:.88rem;color:rgba(255,255,255,.78);line-height:1.8">
           Score: <strong style="color:#6FB833">${score}</strong> — You've won a <strong style="color:#6FB833">10% discount</strong> on your first project.<br>
           Complete the form below today to claim it.</div>`
      : `<div style="font-size:2.2rem;margin-bottom:10px">👻</div>
         <div style="font-weight:900;font-size:1rem;color:#e05555;letter-spacing:.08em;margin-bottom:10px">THE FRUIT GHOSTS GOT YOU!</div>
         <div style="font-size:.88rem;color:rgba(255,255,255,.5);line-height:1.8">
           Better luck next time. Let's still build something great together.</div>`;
    document.querySelector('.contact__form')?.insertAdjacentElement('beforebegin', div);
  }

  function onKD(e) {
    keys[e.key] = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
  }
  function onKU(e) { delete keys[e.key]; }
  function bindKeys()   { window.addEventListener('keydown',onKD); window.addEventListener('keyup',onKU); }
  function unbindKeys() { window.removeEventListener('keydown',onKD); window.removeEventListener('keyup',onKU); keys={}; }

  function buildJoystick() {
    rm('jfJoystick');
    const ZR = 58;
    const jz = document.createElement('div');
    jz.id = 'jfJoystick';
    Object.assign(jz.style, {
      position: 'fixed', bottom: '24px', right: '24px',
      width: ZR * 2 + 'px', height: ZR * 2 + 'px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.07)',
      border: '2px solid rgba(255,255,255,0.18)',
      zIndex: 10001, touchAction: 'none', userSelect: 'none',
    });
    const knob = document.createElement('div');
    Object.assign(knob.style, {
      position: 'absolute',
      width: '44px', height: '44px',
      borderRadius: '50%',
      background: 'rgba(111,184,51,0.65)',
      border: '2px solid rgba(111,184,51,0.9)',
      left: ZR - 22 + 'px', top: ZR - 22 + 'px',
      pointerEvents: 'none',
    });
    jz.appendChild(knob);
    document.body.appendChild(jz);

    function update(touch) {
      const rect = jz.getBoundingClientRect();
      const ox = touch.clientX - rect.left - ZR;
      const oy = touch.clientY - rect.top - ZR;
      const dist = Math.hypot(ox, oy);
      const nx = dist > ZR ? ox / dist * ZR : ox;
      const ny = dist > ZR ? oy / dist * ZR : oy;
      knob.style.transition = 'none';
      knob.style.left = ZR - 22 + nx + 'px';
      knob.style.top  = ZR - 22 + ny + 'px';
      joystickVec.dx  = nx / ZR;
      joystickVec.dy  = ny / ZR;
    }

    jz.addEventListener('touchstart', e => { e.preventDefault(); update(e.touches[0]); }, { passive: false });
    jz.addEventListener('touchmove',  e => { e.preventDefault(); update(e.touches[0]); }, { passive: false });
    jz.addEventListener('touchend',   e => {
      e.preventDefault();
      knob.style.transition = 'left 0.15s, top 0.15s';
      knob.style.left = ZR - 22 + 'px';
      knob.style.top  = ZR - 22 + 'px';
      joystickVec.dx  = joystickVec.dy = 0;
    }, { passive: false });
  }
})();
