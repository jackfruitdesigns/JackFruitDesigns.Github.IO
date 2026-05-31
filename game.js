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
  let selIdx     = null;           // index of selected rect, or null
  let editorMode = 'idle';         // 'idle' | 'drawing' | 'moving' | 'resizing'
  let dragHandle = null;           // which handle is being dragged
  let dragStart  = null;           // {x,y} mouse position at drag start
  let origRect   = null;           // copy of rect at drag start
  let previewR   = null;           // rect being drawn (not yet committed)
  let drawOrigin = null;           // {x,y} where new-rect drag began

  const HR = 8;  // handle hit radius px

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem('jfWalls') || '[]'); } catch { return []; }
  }
  function persistRects() { localStorage.setItem('jfWalls', JSON.stringify(drawRects)); }

  // 8 resize handles around a rect
  function handles(r) {
    return {
      nw:{ x:r.x,       y:r.y       }, n:{ x:r.x+r.w/2, y:r.y       }, ne:{ x:r.x+r.w, y:r.y       },
      e: { x:r.x+r.w,   y:r.y+r.h/2 },
      se:{ x:r.x+r.w,   y:r.y+r.h   }, s:{ x:r.x+r.w/2, y:r.y+r.h   }, sw:{ x:r.x,     y:r.y+r.h   },
      w: { x:r.x,       y:r.y+r.h/2 },
    };
  }

  // Which handle (if any) is within HR pixels of (mx,my)?
  function hitHandle(mx, my, r) {
    for (const [name, h] of Object.entries(handles(r)))
      if ((mx-h.x)**2 + (my-h.y)**2 <= HR**2) return name;
    return null;
  }

  function insideRect(mx, my, r) {
    return mx >= r.x && mx <= r.x+r.w && my >= r.y && my <= r.y+r.h;
  }

  // Apply a resize drag: handle name tells us which edges move
  function applyResize(handle, orig, dx, dy) {
    let {x, y, w, h} = orig;
    if (handle.includes('n')) { y += dy; h -= dy; }
    if (handle.includes('s')) { h += dy; }
    if (handle.includes('w')) { x += dx; w -= dx; }
    if (handle.includes('e')) { w += dx; }
    if (w < 12) { if (handle.includes('w')) x = orig.x + orig.w - 12; w = 12; }
    if (h < 12) { if (handle.includes('n')) y = orig.y + orig.h - 12; h = 12; }
    return { x, y, w, h };
  }

  const CURSOR_MAP = {
    nw:'nw-resize', n:'n-resize', ne:'ne-resize', e:'e-resize',
    se:'se-resize', s:'s-resize', sw:'sw-resize', w:'w-resize',
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
    // 1 — if a rect is selected, check its handles first
    if (selIdx !== null) {
      const handle = hitHandle(x, y, drawRects[selIdx]);
      if (handle) {
        editorMode = 'resizing'; dragHandle = handle;
        dragStart = {x,y}; origRect = {...drawRects[selIdx]};
        return;
      }
      // click inside selected rect → move it
      if (insideRect(x, y, drawRects[selIdx])) {
        editorMode = 'moving';
        dragStart = {x,y}; origRect = {...drawRects[selIdx]};
        return;
      }
    }

    // 2 — click any other rect → select it
    for (let i = drawRects.length - 1; i >= 0; i--) {
      if (insideRect(x, y, drawRects[i])) {
        selIdx = i; editorMode = 'idle';
        renderDraw(); return;
      }
    }

    // 3 — empty space → deselect + start drawing new rect
    selIdx = null;
    editorMode = 'drawing';
    drawOrigin = {x,y}; previewR = null;
  }

  function onMove({ x, y }) {
    if (editorMode === 'drawing') {
      previewR = {
        x: Math.min(drawOrigin.x, x), y: Math.min(drawOrigin.y, y),
        w: Math.abs(x - drawOrigin.x), h: Math.abs(y - drawOrigin.y),
      };
      renderDraw();
    } else if (editorMode === 'moving') {
      drawRects[selIdx] = {
        x: origRect.x + (x - dragStart.x),
        y: origRect.y + (y - dragStart.y),
        w: origRect.w, h: origRect.h,
      };
      renderDraw();
    } else if (editorMode === 'resizing') {
      drawRects[selIdx] = applyResize(dragHandle, origRect, x - dragStart.x, y - dragStart.y);
      renderDraw();
    } else {
      // Update cursor on hover
      if (selIdx !== null) {
        const h = hitHandle(x, y, drawRects[selIdx]);
        if (h)                              { dc.style.cursor = CURSOR_MAP[h]; return; }
        if (insideRect(x, y, drawRects[selIdx])) { dc.style.cursor = 'move';  return; }
      }
      for (let i = drawRects.length-1; i >= 0; i--)
        if (insideRect(x, y, drawRects[i])) { dc.style.cursor = 'move'; return; }
      dc.style.cursor = 'crosshair';
    }
  }

  function onUp() {
    if (editorMode === 'drawing') {
      if (previewR && previewR.w > 8 && previewR.h > 8) {
        drawRects.push({...previewR});
        selIdx = drawRects.length - 1;
        persistRects();
      }
      previewR = null;
      editorMode = 'idle';
    } else if (editorMode === 'moving' || editorMode === 'resizing') {
      persistRects();
      editorMode = 'idle';
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
      dctx.fillRect(r.x, r.y, r.w, r.h);
      dctx.strokeRect(r.x, r.y, r.w, r.h);

      // Label
      dctx.fillStyle = sel ? 'rgba(126,207,64,0.9)' : 'rgba(111,184,51,0.7)';
      dctx.font = 'bold 11px Montserrat,sans-serif';
      dctx.textAlign = 'left'; dctx.textBaseline = 'top';
      dctx.fillText(`#${i+1}`, r.x + 5, r.y + 4);

      // Resize handles on selected rect
      if (sel) {
        Object.values(handles(r)).forEach(h => {
          dctx.fillStyle   = '#ffffff';
          dctx.strokeStyle = '#6FB833';
          dctx.lineWidth   = 2;
          dctx.beginPath(); dctx.arc(h.x, h.y, HR - 2, 0, Math.PI*2); dctx.fill(); dctx.stroke();
        });
      }
    });

    // Drawing preview
    if (previewR) {
      dctx.fillStyle   = 'rgba(244,169,53,0.13)';
      dctx.strokeStyle = '#F4A935';
      dctx.lineWidth   = 2;
      dctx.setLineDash([6,4]);
      dctx.fillRect(previewR.x, previewR.y, previewR.w, previewR.h);
      dctx.strokeRect(previewR.x, previewR.y, previewR.w, previewR.h);
      dctx.setLineDash([]);
    }

    // Counter + hint
    dctx.fillStyle = 'rgba(255,255,255,.25)';
    dctx.font = '11px Montserrat,sans-serif';
    dctx.textAlign = 'right'; dctx.textBaseline = 'bottom';
    dctx.fillText(
      `${drawRects.length} wall${drawRects.length !== 1 ? 's' : ''} · click rect to select · drag handles to resize · Del to delete`,
      dc.width - 14, dc.height - 14
    );

    // Floating delete button next to selected rect
    rm('jfDelBtn');
    if (selIdx !== null) {
      const r = drawRects[selIdx];
      const btn = document.createElement('button');
      btn.id = 'jfDelBtn';
      btn.textContent = '✕ Delete';
      Object.assign(btn.style, {
        position:'fixed',
        left: Math.min(r.x + r.w + 8, innerWidth - 90) + 'px',
        top:  r.y + 'px',
        zIndex:10002,
        background:'rgba(200,50,50,0.88)', color:'#fff', border:'none',
        padding:'5px 12px', borderRadius:'4px',
        fontFamily:"'Montserrat',sans-serif", fontSize:'11px', fontWeight:700,
        cursor:'pointer', letterSpacing:'.06em',
      });
      btn.addEventListener('click', () => {
        drawRects.splice(selIdx, 1);
        selIdx = null; editorMode = 'idle';
        persistRects(); renderDraw();
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
      <span style="color:rgba(255,255,255,.32);font-size:.63rem;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        Drag empty space to draw &nbsp;·&nbsp; Click rect to select &nbsp;·&nbsp; Drag handles to resize &nbsp;·&nbsp; Drag body to move
      </span>
      <button id="jfClearD" style="${btnCSS('rgba(255,80,80,.3)','rgba(255,110,110,.8)')}">Clear All</button>
      <button id="jfSubmit" style="${btnCSS('#3A6B1A','#fff',true)}">Submit Walls</button>
      <button id="jfQuitD"  style="${btnCSS('rgba(255,255,255,.18)','rgba(255,255,255,.5)')}">Quit</button>
    `;
    document.body.appendChild(hud);
    document.getElementById('jfClearD').addEventListener('click', () => {
      if (!confirm(`Delete all ${drawRects.length} walls?`)) return;
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
  //  GAME ENGINE  (wall-following AI — re-enable when walls ready)
  //  To activate: change the entry point at the top to startGame()
  // ════════════════════════════════════════════════════════════
  const PAC_R     = 14;
  const ENEMY_R   = 16;
  const JF_R      = 20;
  const PAC_SPD   = 2.8;
  const ENEMY_SPD = 1.55;
  const JF_SPD    = 2.2;
  const CELL      = 24;   // pathfinding grid resolution (px per cell)

  const EMOJIS = ['🍎', '🍌', '🍐', '🍑', '🍇'];

  let canvas, ctx;
  let gameWalls = [], grid = null, gridCols = 0, gridRows = 0;
  let pac, enemies, jf;
  let gameState = 'idle', raf = null, keys = {};
  let facing = 0, mouthA = 0.25, mouthD = 1, tick = 0;
  let joystickVec = { dx: 0, dy: 0 };
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  function startGame() {
    if (gameState === 'playing') return;
    window.scrollTo({ top: 0, behavior: 'instant' });
    // Wait one frame so the browser finishes the scroll before measuring DOM positions
    requestAnimationFrame(() => {
      buildGameCanvas();
      buildGameHUD();
      buildWalls();
      buildGrid();
      spawnAll();
      lockScroll();
      bindKeys();
      if (isTouch) buildJoystick();
      document.querySelector('.hero__fruit-lineup')?.classList.add('game-on');
      gameState = 'playing'; tick = 0;
      raf = requestAnimationFrame(gameLoop);
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
    rm('jfHUD'); rm('jfDpad'); rm('jfBlocker');

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
      <span style="color:rgba(255,255,255,.4);font-size:.67rem">
        ${isTouch ? 'Joystick' : 'WASD / ARROWS'} · Catch the jackfruit · Avoid the fruit ghosts
      </span>
      <button id="jfQuit" style="${btnCSS('rgba(255,255,255,.22)','rgba(255,255,255,.55)')}">Quit</button>`;
    document.body.appendChild(hud);
    document.getElementById('jfQuit').addEventListener('click', () => finishGame('quit'));

    // Click blocker — stops mouse reaching links/buttons under the game
    const blocker = document.createElement('div');
    blocker.id = 'jfBlocker';
    Object.assign(blocker.style, {
      position:'fixed', inset:0, zIndex:9997, pointerEvents:'all', cursor:'default',
    });
    blocker.addEventListener('click',     e => e.stopPropagation());
    blocker.addEventListener('mousedown', e => e.stopPropagation());
    document.body.appendChild(blocker);
  }

  function buildWalls() {
    gameWalls = [];

    // Headline words — measured live so they work at any screen size
    document.querySelectorAll('.hw').forEach(el => {
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) return;
      gameWalls.push({ x: b.left - 4, y: b.top - 4, w: b.width + 8, h: b.height + 8 });
    });

    // Auto-detected DOM walls for nav, buttons, cards etc.
    const add = (sel, P) => document.querySelectorAll(sel).forEach(el => {
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2 || b.bottom < 0 || b.top > innerHeight) return;
      gameWalls.push({ x:b.left-P, y:b.top-P, w:b.width+P*2, h:b.height+P*2 });
    });

    ['#nav','#jfHUD','.hero__eyebrow','.hero__sub','.hero__actions',
     '.section-header','.service-card','.about__text .eyebrow','.about__text h2',
     '.about__body','.about__text .btn','.about__stats-card',
     '.contact__heading','.contact__sub','.contact__form','.footer__inner',
    ].forEach(s => add(s, 4));
  }

  function hitWall(cx, cy, cr, { x, y, w, h }) {
    const nx = Math.max(x, Math.min(cx, x + w));
    const ny = Math.max(y, Math.min(cy, y + h));
    return (cx-nx)**2 + (cy-ny)**2 < cr*cr;
  }
  function isOpen(x, y, r) {
    if (x-r<0||x+r>innerWidth||y-r<0||y+r>innerHeight) return false;
    return !gameWalls.some(w => hitWall(x, y, r, w));
  }
  function findSpot(x0, x1, y0, y1, r, avoid, minD) {
    for (let i=0; i<800; i++) {
      const x=x0+Math.random()*(x1-x0), y=y0+Math.random()*(y1-y0);
      if (!isOpen(x,y,r+2)) continue;
      if (avoid && (x-avoid.x)**2+(y-avoid.y)**2 < minD**2) continue;
      return {x,y};
    }
    for (let yy=y0+r; yy<y1; yy+=8)
      for (let xx=x0+r; xx<x1; xx+=8)
        if (isOpen(xx,yy,r+2)) return {x:xx,y:yy};
    return {x:(x0+x1)/2,y:(y0+y1)/2};
  }

  // ── Pathfinding grid ─────────────────────────────────────
  function buildGrid() {
    gridCols = Math.ceil(innerWidth  / CELL);
    gridRows = Math.ceil(innerHeight / CELL);
    // 1 = walkable, 0 = blocked
    grid = Array.from({length: gridRows}, () => new Uint8Array(gridCols).fill(1));
    gameWalls.forEach(w => {
      const c0 = Math.max(0, Math.floor(w.x / CELL));
      const r0 = Math.max(0, Math.floor(w.y / CELL));
      const c1 = Math.min(gridCols, Math.ceil((w.x + w.w) / CELL));
      const r1 = Math.min(gridRows, Math.ceil((w.y + w.h) / CELL));
      for (let r = r0; r < r1; r++)
        for (let c = c0; c < c1; c++)
          grid[r][c] = 0;
    });
  }

  function cellOf(x, y) {
    return {
      col: Math.max(0, Math.min(gridCols-1, Math.floor(x / CELL))),
      row: Math.max(0, Math.min(gridRows-1, Math.floor(y / CELL))),
    };
  }
  function centerOf(col, row) {
    return { x: col*CELL + CELL/2, y: row*CELL + CELL/2 };
  }

  // BFS pathfind — returns array of {x,y} world waypoints, empty = no path
  function findPath(fx, fy, tx, ty) {
    const start = cellOf(fx, fy);
    const goal  = cellOf(tx, ty);
    if (start.col===goal.col && start.row===goal.row) return [];

    const N   = gridRows * gridCols;
    const vis = new Uint8Array(N);
    const pC  = new Int16Array(N).fill(-1);
    const pR  = new Int16Array(N).fill(-1);
    const idx = (c, r) => r * gridCols + c;
    const queue = [[start.col, start.row]];
    vis[idx(start.col, start.row)] = 1;

    const dirs = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[-1,1],[1,-1],[1,1]];
    let found = false;

    outer: while (queue.length) {
      const [cc, cr] = queue.shift();
      for (const [dc, dr] of dirs) {
        const nc = cc+dc, nr = cr+dr;
        if (nc<0||nc>=gridCols||nr<0||nr>=gridRows) continue;
        if (!grid[nr][nc] || vis[idx(nc,nr)]) continue;
        // No diagonal wall-clipping
        if (dc!==0 && dr!==0 && (!grid[cr+dr][cc] || !grid[cr][cc+dc])) continue;
        vis[idx(nc,nr)] = 1;
        pC[idx(nc,nr)] = cc; pR[idx(nc,nr)] = cr;
        if (nc===goal.col && nr===goal.row) { found=true; break outer; }
        queue.push([nc, nr]);
      }
    }

    if (!found) return [];
    const path = [];
    let c = goal.col, r = goal.row;
    while (!(c===start.col && r===start.row)) {
      path.unshift(centerOf(c, r));
      const pc = pC[idx(c,r)], pr = pR[idx(c,r)];
      c = pc; r = pr;
    }
    return path;
  }

  // Pick a walkable cell that is as far from pac as possible
  function findFleeTarget() {
    const pacCell = cellOf(pac.x, pac.y);
    let best = null, bestDist = -1;
    for (let attempt = 0; attempt < 100; attempt++) {
      const r = 1 + Math.floor(Math.random() * (gridRows-2));
      const c = 1 + Math.floor(Math.random() * (gridCols-2));
      if (!grid[r][c]) continue;
      const d = (r-pacCell.row)**2 + (c-pacCell.col)**2;
      if (d > bestDist) { bestDist = d; best = {r, c}; }
    }
    return best ? centerOf(best.c, best.r) : centerOf(gridCols>>1, gridRows>>1);
  }

  // Move entity one step along its stored path
  function stepPath(entity, spd) {
    if (!entity.path || entity.pathIdx >= entity.path.length) return;
    const wp = entity.path[entity.pathIdx];
    const dx = wp.x - entity.x, dy = wp.y - entity.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= spd + 1) { entity.x = wp.x; entity.y = wp.y; entity.pathIdx++; }
    else { entity.x += dx/dist * spd; entity.y += dy/dist * spd; }
  }

  function spawnAll() {
    const W=innerWidth, H=innerHeight;
    // Pac-Man from the green J icon
    const jEl = document.querySelector('.fruit-jackfruit');
    if (jEl) {
      const b = jEl.getBoundingClientRect();
      const cx = b.left+b.width/2, cy = b.top+b.height/2;
      pac = isOpen(cx,cy,PAC_R) ? {x:cx,y:cy} : findSpot(W*.3,W-20,60,H*.5,PAC_R+2,null,0);
    } else {
      pac = findSpot(W*.3,W-20,60,H*.5,PAC_R+2,null,0);
    }
    // Jackfruit — spawn far from pac, no path yet (calculated on first update)
    const jp = findSpot(20,W-20,H*.4,H-20,JF_R+2,pac,180);
    jf = { x:jp.x, y:jp.y, path:[], pathIdx:0, pathTick:0 };
    // Enemies — start at each .fruit-icon's DOM position
    const iconEls = document.querySelectorAll('.fruit-icon');
    enemies = Array.from(iconEls).map((el, i) => {
      const b = el.getBoundingClientRect();
      return {
        x: b.left+b.width/2, y: b.top+b.height/2,
        emoji: EMOJIS[i]||'🍎',
        path: [], pathIdx: 0, pathTick: i*8, // stagger so they don't all recalc same frame
        wobble: Math.random()*Math.PI*2,
      };
    });
  }

  function gameLoop() {
    if (gameState !== 'playing') return;
    tick++;
    updateGame(); drawGame();
    raf = requestAnimationFrame(gameLoop);
  }

  function updateGame() {
    movePac();
    moveEnemies();
    fleeJackfruit();
    mouthA += 0.14*mouthD;
    if (mouthA>.38||mouthA<.02) mouthD*=-1;
    if ((pac.x-jf.x)**2+(pac.y-jf.y)**2 < (PAC_R+JF_R)**2) { finishGame('won'); return; }
    for (const e of enemies)
      if ((pac.x-e.x)**2+(pac.y-e.y)**2 < (PAC_R+ENEMY_R-2)**2) { finishGame('lost'); return; }
  }

  function movePac() {
    let dx=0, dy=0;
    if (keys['ArrowLeft'] ||keys.a||keys.A) dx=-PAC_SPD;
    if (keys['ArrowRight']||keys.d||keys.D) dx= PAC_SPD;
    if (keys['ArrowUp']   ||keys.w||keys.W) dy=-PAC_SPD;
    if (keys['ArrowDown'] ||keys.s||keys.S) dy= PAC_SPD;
    if (Math.abs(joystickVec.dx) > 0.15) dx = joystickVec.dx * PAC_SPD;
    if (Math.abs(joystickVec.dy) > 0.15) dy = joystickVec.dy * PAC_SPD;
    if (dx && isOpen(pac.x+dx,pac.y,PAC_R)) { pac.x+=dx; facing=dx>0?0:Math.PI; }
    if (dy && isOpen(pac.x,pac.y+dy,PAC_R)) { pac.y+=dy; facing=dy>0?Math.PI/2:-Math.PI/2; }
  }

  // BFS chase — recalculate path to pac every 30 ticks
  function moveEnemies() {
    enemies.forEach(e => {
      if (tick - e.pathTick >= 30 || e.pathIdx >= e.path.length) {
        e.path    = findPath(e.x, e.y, pac.x, pac.y);
        e.pathIdx = 0;
        e.pathTick = tick;
      }
      stepPath(e, ENEMY_SPD);
    });
  }

  // BFS flee — pick a far-away cell and pathfind there.
  // Recalculate when pac is close or path is exhausted.
  function fleeJackfruit() {
    const distToPac = Math.hypot(jf.x-pac.x, jf.y-pac.y);
    const pathDone  = jf.pathIdx >= jf.path.length;
    const pacClose  = distToPac < 220;

    if (pathDone || (pacClose && tick - jf.pathTick >= 25)) {
      const target  = findFleeTarget();
      jf.path    = findPath(jf.x, jf.y, target.x, target.y);
      jf.pathIdx = 0;
      jf.pathTick = tick;
    }

    const spd = JF_SPD * (1 + Math.max(0,(220-distToPac)/220)*0.8);
    stepPath(jf, spd);
  }

  function drawGame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawJFTarget();
    enemies.forEach(drawEnemy);
    drawPacman();
  }

  function drawPacman() {
    const {x,y}=pac, a=facing, m=mouthA;
    ctx.fillStyle='rgba(0,0,0,.18)';
    ctx.beginPath(); ctx.ellipse(x+2,y+4,PAC_R*.9,PAC_R*.38,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#6FB833';
    ctx.beginPath(); ctx.moveTo(x,y); ctx.arc(x,y,PAC_R,a+m,a+Math.PI*2-m); ctx.closePath(); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.2)';
    ctx.beginPath(); ctx.arc(x-PAC_R*.28,y-PAC_R*.28,PAC_R*.36,0,Math.PI*2); ctx.fill();
    const ex=x+Math.cos(a-.42)*PAC_R*.52, ey=y+Math.sin(a-.42)*PAC_R*.52;
    ctx.fillStyle='#1A1A1A';
    ctx.beginPath(); ctx.arc(ex,ey,2.4,0,Math.PI*2); ctx.fill();
  }

  function drawEnemy(e) {
    const {x,y,emoji}=e;
    const w = Math.sin(tick*.09+e.wobble)*2.5;
    ctx.save(); ctx.translate(x,y); ctx.rotate(w*.06);
    ctx.filter = 'grayscale(1) brightness(0.12)';
    ctx.font='28px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(emoji, 0, 2);
    ctx.filter = 'none';
    const eyeR=7.5, pa=Math.atan2(pac.y-e.y, pac.x-e.x);
    [[-7,-16],[7,-16]].forEach(([ox,oy]) => {
      ctx.fillStyle='#fff'; ctx.strokeStyle='rgba(0,0,0,.35)'; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.arc(ox,oy,eyeR,0,Math.PI*2); ctx.fill(); ctx.stroke();
      const px=ox+Math.cos(pa)*eyeR*.44, py=oy+Math.sin(pa)*eyeR*.44;
      ctx.fillStyle='#111';
      ctx.beginPath(); ctx.arc(px,py,eyeR*.48,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,.55)';
      ctx.beginPath(); ctx.arc(px-1.5,py-1.5,eyeR*.18,0,Math.PI*2); ctx.fill();
    });
    ctx.restore();
  }

  function drawJFTarget() {
    const {x,y}=jf, r=JF_R, sc=1+.06*Math.sin(tick*.042);
    const g=ctx.createRadialGradient(x,y,r*.2,x,y,r*2.8);
    g.addColorStop(0,`rgba(111,184,51,${.28+.14*Math.sin(tick*.042)})`);
    g.addColorStop(1,'rgba(111,184,51,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r*2.8,0,Math.PI*2); ctx.fill();
    ctx.save(); ctx.translate(x,y); ctx.scale(sc,sc);
    ctx.fillStyle='#3A6B1A'; ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#6FB833';
    for (let i=0;i<10;i++) {
      const a=(i/10)*Math.PI*2;
      ctx.beginPath(); ctx.arc(Math.cos(a)*r*.62,Math.sin(a)*r*.62,r*.22,0,Math.PI*2); ctx.fill();
    }
    ctx.fillStyle='#7ECF40';
    for (let i=0;i<5;i++) {
      const a=(i/5)*Math.PI*2+.3;
      ctx.beginPath(); ctx.arc(Math.cos(a)*r*.3,Math.sin(a)*r*.3,r*.14,0,Math.PI*2); ctx.fill();
    }
    ctx.fillStyle='#fff'; ctx.font=`bold ${r*.88}px Montserrat,sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('J',0,0);
    ctx.restore();
  }

  function finishGame(result) {
    gameState = result;
    cancelAnimationFrame(raf);
    unlockScroll(); unbindKeys();
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
         <div style="font-weight:900;font-size:1rem;color:#6FB833;letter-spacing:.08em;margin-bottom:10px">YOU CAUGHT THE JACKFRUIT!</div>
         <div style="font-size:.88rem;color:rgba(255,255,255,.78);line-height:1.8">
           Congratulations — you've won a <strong style="color:#6FB833">10% discount</strong> on your first project.<br>
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
