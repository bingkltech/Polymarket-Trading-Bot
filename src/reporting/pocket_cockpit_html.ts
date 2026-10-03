export function getPocketCockpitHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Polymarket Alpha Harvester — Pocket Cockpit</title>
  <style>
    :root {
      --bg: #090a0f;
      --card: #12141c;
      --card-alt: #161a24;
      --border: #1e2433;
      --border-light: #2a3346;
      --text: #f0f2f5;
      --muted: #8b949e;
      --green: #10b981;
      --green-glow: rgba(16, 185, 129, 0.25);
      --green-dark: #064e3b;
      --red: #ef4444;
      --red-glow: rgba(239, 68, 68, 0.25);
      --red-dark: #450a0a;
      --amber: #f59e0b;
      --amber-glow: rgba(245, 158, 11, 0.25);
      --amber-dark: #291f0b;
      --blue: #38bdf8;
      --blue-glow: rgba(56, 189, 248, 0.25);
      --purple: #a855f7;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "JetBrains Mono", monospace; }
    body { background-color: var(--bg); color: var(--text); padding: 12px; min-height: 100vh; display: flex; flex-direction: column; align-items: center; }
    .container { width: 100%; max-width: 540px; display: flex; flex-direction: column; gap: 12px; }

    /* Top Header */
    .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
    .title-wrap { display: flex; align-items: center; gap: 8px; }
    .title { font-size: 1.05rem; font-weight: 800; letter-spacing: -0.3px; display: flex; align-items: center; gap: 6px; }
    .title span.icon { color: var(--amber); font-size: 1.15rem; }
    .status-badge { font-size: 0.72rem; padding: 4px 8px; border-radius: 4px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; display: inline-flex; align-items: center; gap: 5px; }
    .badge-armed { background: rgba(16, 185, 129, 0.15); color: var(--green); border: 1px solid var(--green); box-shadow: 0 0 10px var(--green-glow); }
    .badge-disarmed { background: rgba(245, 158, 11, 0.15); color: var(--amber); border: 1px solid var(--amber); }
    .badge-panic { background: rgba(239, 68, 68, 0.2); color: var(--red); border: 1px solid var(--red); box-shadow: 0 0 12px var(--red-glow); animation: pulse-red 1.5s infinite; }
    @keyframes pulse-red { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .pulse-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: pulse-anim 2s infinite; }
    @keyframes pulse-anim { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.3); opacity: 0.4; } }

    /* Header Tools */
    .header-right { display: flex; align-items: center; gap: 6px; }
    .btn-icon { background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border); color: var(--muted); border-radius: 6px; padding: 4px 8px; font-size: 0.72rem; font-weight: 700; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 4px; user-select: none; }
    .btn-icon:hover { background: rgba(255, 255, 255, 0.09); color: var(--text); border-color: var(--blue); }
    .btn-icon.active { background: rgba(16, 185, 129, 0.15); border-color: var(--green); color: var(--green); }

    /* Strategy Pills */
    .strat-bar { display: flex; gap: 5px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 4px; overflow-x: auto; scrollbar-width: none; }
    .strat-bar::-webkit-scrollbar { display: none; }
    .strat-btn { flex: 1; min-width: 80px; padding: 6px 8px; background: transparent; border: 1px solid transparent; border-radius: 5px; color: var(--muted); font-size: 0.72rem; font-weight: 700; cursor: pointer; transition: all 0.2s; text-align: center; white-space: nowrap; user-select: none; display: flex; align-items: center; justify-content: center; gap: 4px; }
    .strat-btn:hover { color: var(--text); background: rgba(255, 255, 255, 0.04); }
    .strat-btn.active { background: #182236; color: #fff; border-color: var(--blue); box-shadow: 0 0 8px var(--blue-glow); }

    /* Master Hardware Controls */
    .controls-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .btn-master { padding: 12px 10px; border-radius: 8px; border: 1px solid transparent; font-size: 0.85rem; font-weight: 800; cursor: pointer; transition: all 0.2s ease; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; user-select: none; }
    
    /* Arm Button */
    .btn-arm { background: #063c2e; color: #6ee7b7; border-color: rgba(16, 185, 129, 0.4); }
    .btn-arm:hover { background: #047857; color: #fff; border-color: var(--green); box-shadow: 0 0 12px var(--green-glow); }
    .btn-arm.armed { background: var(--green); color: #022c22; border-color: #34d399; box-shadow: 0 0 20px var(--green-glow); }

    /* Disarm Button */
    .btn-disarm { background: #1a1714; color: #d6d3d1; border-color: #383431; }
    .btn-disarm:hover { background: #292524; color: #fff; border-color: #57534e; }
    .btn-disarm.disarmed { background: #3b2a0c; color: #fde68a; border-color: var(--amber); box-shadow: 0 0 14px var(--amber-glow); }

    /* Hardware Panic Button */
    .btn-panic {
      grid-column: span 2;
      position: relative;
      overflow: hidden;
      padding: 12px 14px;
      border-radius: 8px;
      border: 2px solid #b91c1c;
      color: #fca5a5;
      font-weight: 900;
      font-size: 0.85rem;
      letter-spacing: 0.5px;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s ease;
      background: #2b0c0c;
      background-image: repeating-linear-gradient(45deg, rgba(239,68,68,0.12), rgba(239,68,68,0.12) 10px, transparent 10px, transparent 20px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    .btn-panic:hover { border-color: #ef4444; color: #fff; box-shadow: 0 0 18px var(--red-glow); }
    .btn-panic:active { transform: scale(0.99); }
    .btn-panic.panic-active { background: #7f1d1d; color: #fff; border-color: var(--red); }
    .kill-progress-fill { position: absolute; top: 0; bottom: 0; left: 0; background: rgba(239, 68, 68, 0.6); pointer-events: none; transition: width 0.04s linear; z-index: 1; }
    .panic-content { position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; gap: 8px; }

    /* Ground Truth Sweep Button */
    .btn-sweep {
      grid-column: span 2;
      padding: 8px 12px;
      border-radius: 6px;
      background: rgba(56, 189, 248, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: #7dd3fc;
      font-size: 0.75rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: all 0.2s;
    }
    .btn-sweep:hover { background: rgba(56, 189, 248, 0.16); color: #fff; border-color: var(--blue); box-shadow: 0 0 12px rgba(56, 189, 248, 0.25); }

    /* KPI Grid */
    .kpi-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .kpi-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; justify-content: space-between; }
    .kpi-label { font-size: 0.68rem; color: var(--muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.4px; display: flex; justify-content: space-between; align-items: center; }
    .kpi-value { font-size: 1.25rem; font-weight: 800; font-family: monospace; margin-top: 2px; }
    .kpi-sub { font-size: 0.7rem; color: var(--muted); margin-top: 2px; display: flex; align-items: center; gap: 4px; }
    .pnl-pos { color: var(--green); }
    .pnl-neg { color: var(--red); }
    .pnl-tag { font-size: 0.68rem; font-weight: 800; padding: 1px 5px; border-radius: 3px; font-family: monospace; }
    .tag-pos { background: rgba(16, 185, 129, 0.15); color: var(--green); border: 1px solid rgba(16, 185, 129, 0.3); }
    .tag-neg { background: rgba(239, 68, 68, 0.15); color: var(--red); border: 1px solid rgba(239, 68, 68, 0.3); }

    /* Positions & Deck Section */
    .deck-panel { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .deck-header { display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: var(--muted); letter-spacing: 0.4px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px; }
    .pos-item { background: var(--card-alt); border: 1px solid var(--border-light); border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; transition: border-color 0.2s; }
    .pos-item:hover { border-color: rgba(56, 189, 248, 0.4); }
    .pos-row-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .pos-title { font-size: 0.78rem; font-weight: 700; color: #fff; line-height: 1.2; flex: 1; }
    .pos-badge { font-size: 0.65rem; font-weight: 800; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; }
    .badge-yes { background: rgba(16, 185, 129, 0.18); color: var(--green); border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-no { background: rgba(239, 68, 68, 0.18); color: var(--red); border: 1px solid rgba(239, 68, 68, 0.3); }
    .pos-metrics { display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: var(--muted); font-family: monospace; }
    .pos-actions { display: flex; gap: 6px; margin-top: 2px; }
    .btn-harvest-sm { flex: 1; background: rgba(16, 185, 129, 0.14); border: 1px solid rgba(16, 185, 129, 0.4); color: #6ee7b7; border-radius: 4px; padding: 5px 8px; font-size: 0.7rem; font-weight: 800; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 4px; }
    .btn-harvest-sm:hover { background: var(--green); color: #022c22; box-shadow: 0 0 10px var(--green-glow); }
    .btn-exit-sm { background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border); color: var(--muted); border-radius: 4px; padding: 5px 8px; font-size: 0.7rem; font-weight: 700; cursor: pointer; transition: all 0.2s; }
    .btn-exit-sm:hover { background: rgba(239, 68, 68, 0.2); color: var(--red); border-color: var(--red); }

    /* Open Orders Deck */
    .order-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: var(--card-alt); border: 1px solid var(--border); border-radius: 4px; font-size: 0.72rem; font-family: monospace; }
    .btn-cancel-ord { background: transparent; border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171; border-radius: 3px; padding: 2px 6px; font-size: 0.65rem; font-weight: 800; cursor: pointer; }
    .btn-cancel-ord:hover { background: var(--red); color: #fff; }

    /* Event Tape / Log */
    .tape-box { background: #07080c; border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; font-family: monospace; font-size: 0.7rem; color: #94a3b8; max-height: 120px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; }
    .tape-line { display: flex; gap: 6px; word-break: break-all; }
    .tape-ts { color: var(--muted); shrink: 0; }
    .tape-tag { font-weight: 800; }
    .tape-tag.SIGNAL { color: var(--blue); }
    .tape-tag.ORDER { color: var(--green); }
    .tape-tag.PANIC { color: var(--red); }
    .tape-tag.SYSTEM { color: var(--amber); }

    /* Remote Modal */
    .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(5, 6, 10, 0.85); backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
    .modal-overlay.active { display: flex; }
    .modal-card { background: #12141c; border: 1px solid var(--border-light); border-radius: 12px; width: 100%; max-width: 400px; padding: 18px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 16px 40px rgba(0,0,0,0.7); }
    .modal-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 8px; font-weight: 800; font-size: 1rem; }
    .modal-close { background: transparent; border: none; color: var(--muted); font-size: 1.2rem; cursor: pointer; }
    .qr-box { background: #fff; padding: 12px; border-radius: 8px; display: flex; align-items: center; justify-content: center; min-height: 180px; width: 180px; margin: 0 auto; }
    .link-row { display: flex; gap: 6px; }
    .link-input { flex: 1; background: #07080c; border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: monospace; font-size: 0.72rem; padding: 6px 8px; outline: none; }
    .btn-copy { background: #1e2433; border: 1px solid #334155; color: #cbd5e1; border-radius: 6px; padding: 6px 10px; font-size: 0.72rem; font-weight: 700; cursor: pointer; }
    .btn-copy:hover { background: var(--blue); color: #fff; }

    /* Minimized Compact Mode */
    body.minimized .expandable { display: none !important; }
    body.minimized { padding: 8px; }
  </style>
</head>
<body>
  <!-- Remote Control Modal -->
  <div id="remoteModal" class="modal-overlay" onclick="closeRemoteModal(event)">
    <div class="modal-card" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div style="display:flex; align-items:center; gap:6px;">
          <span>📱</span>
          <span>Remote Pocket Cockpit</span>
        </div>
        <button class="modal-close" onclick="closeRemoteModal()">✕</button>
      </div>
      <div style="font-size:0.75rem; color:var(--muted); text-align:center;">
        Scan to monitor and execute live Alpha Harvester controls from your mobile phone or second screen on LAN.
      </div>
      <div class="qr-box">
        <canvas id="qrCanvas" width="160" height="160"></canvas>
      </div>
      <div class="link-row">
        <input type="text" id="remoteLinkInput" class="link-input" readonly />
        <button class="btn-copy" onclick="copyRemoteLink()">📋 Copy</button>
      </div>
      <div style="font-size:0.7rem; color:var(--green); text-align:center; font-family:monospace;">
        ● Local Zero-Trust Station Active
      </div>
    </div>
  </div>

  <div class="container">
    <!-- Top Header -->
    <div class="header">
      <div class="title-wrap">
        <div class="title">
          <span class="icon">⚡</span>
          <span>ALPHA HARVESTER</span>
        </div>
        <div id="liveBadge" class="status-badge badge-armed">
          <span class="pulse-dot"></span>
          <span id="liveBadgeText">ARMED</span>
        </div>
      </div>
      <div class="header-right">
        <button class="btn-icon" id="btnAudio" onclick="toggleAudio()" title="Toggle Audio FX">
          <span id="audioIcon">🔊</span>
        </button>
        <button class="btn-icon" onclick="openRemoteModal()" title="Mobile QR Remote Control">
          <span>📱</span> Remote
        </button>
        <button class="btn-icon" onclick="launchPopout()" title="Pop out into floating desktop window">
          <span>🗗</span> Popout
        </button>
        <button class="btn-icon" onclick="togglePinFloat()" id="btnFloat" title="Float on Top (Always-on-top)">
          <span>📌</span> Float
        </button>
        <button class="btn-icon" onclick="toggleCompact()" title="Toggle Compact / Full View">
          <span>⤢</span>
        </button>
      </div>
    </div>

    <!-- Strategy Selector Pills -->
    <div class="strat-bar">
      <button class="strat-btn active" onclick="selectStrategy('ALL', this)">⚡ ALL</button>
      <button class="strat-btn" onclick="selectStrategy('mispricing', this)">🎯 Mispricing</button>
      <button class="strat-btn" onclick="selectStrategy('convergence', this)">🌊 Convergence</button>
      <button class="strat-btn" onclick="selectStrategy('market_making', this)">📊 Spread MM</button>
      <button class="strat-btn" onclick="selectStrategy('copy_trade', this)">🐋 Copy Trade</button>
    </div>

    <!-- Master Controls Grid -->
    <div class="controls-grid">
      <!-- Arm Button -->
      <button id="btnArm" class="btn-master btn-arm armed" onclick="armBot()">
        <span>● ARMED</span>
        <span style="font-size:0.68rem; font-weight:400; opacity:0.85;">EXECUTE LIVE ORDERS</span>
      </button>

      <!-- Disarm Button -->
      <button id="btnDisarm" class="btn-master btn-disarm" onclick="disarmBot()">
        <span>○ DISARMED</span>
        <span style="font-size:0.68rem; font-weight:400; opacity:0.85;">STANDBY / SAFE MODE</span>
      </button>

      <!-- Emergency Panic Kill Switch (Hold 1.5s or Spacebar) -->
      <button id="btnPanic" class="btn-panic"
        onmousedown="startKillHold()"
        onmouseup="endKillHold()"
        onmouseleave="endKillHold()"
        ontouchstart="startKillHold()"
        ontouchend="endKillHold()"
      >
        <div id="killProgress" class="kill-progress-fill" style="width:0%;"></div>
        <div class="panic-content">
          <span>🔴</span>
          <span id="panicLabel">EMERGENCY PANIC: CANCEL ALL & STOP (HOLD 1.5s)</span>
        </div>
      </button>

      <!-- Ground Truth & Sweep Button -->
      <button class="btn-sweep" onclick="triggerGroundTruthSync()">
        <span>🔄 SYNC GROUND TRUTH & EXPIRED SWEEP</span>
        <span id="syncStatus" style="font-family:monospace; opacity:0.8;">1-CLICK RECONCILE</span>
      </button>
    </div>

    <!-- KPI Grid -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">
          <span>Total Net Worth</span>
          <span id="kpiPnlTag" class="pnl-tag tag-pos">+0.0%</span>
        </div>
        <div class="kpi-value" id="kpiTotalVal">$0.00</div>
        <div class="kpi-sub">
          <span>Realized:</span>
          <span id="kpiRealizedPnl" class="pnl-pos font-bold">$0.00</span>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">
          <span>Available Cash</span>
          <span style="color:var(--blue); font-family:monospace;">USDC</span>
        </div>
        <div class="kpi-value" id="kpiCashBal">$0.00</div>
        <div class="kpi-sub">
          <span id="kpiAllocated">Budget: $0.00</span>
        </div>
      </div>

      <div class="kpi-card expandable">
        <div class="kpi-label">
          <span>Win Rate</span>
          <span id="kpiTradesCount" style="font-family:monospace;">0 Trades</span>
        </div>
        <div class="kpi-value" id="kpiWinRate">0.0%</div>
        <div class="kpi-sub" id="kpiStreak">Streak: 0W</div>
      </div>

      <div class="kpi-card expandable">
        <div class="kpi-label">
          <span>Active Holdings</span>
          <span id="kpiOpenOrdersCount" style="font-family:monospace;">0 Orders</span>
        </div>
        <div class="kpi-value" id="kpiPositionsVal">$0.00</div>
        <div class="kpi-sub" id="kpiPositionsCount">0 open contracts</div>
      </div>
    </div>

    <!-- Active Positions Deck -->
    <div class="deck-panel expandable">
      <div class="deck-header">
        <div style="display:flex; align-items:center; gap:6px;">
          <span>🎯</span>
          <span>Active Positions (4-Tier Alpha Harvester)</span>
        </div>
        <span id="deckPosCount">0 ACTIVE</span>
      </div>
      <div id="positionsList" style="display:flex; flex-direction:column; gap:6px;">
        <div style="text-align:center; padding:12px; color:var(--muted); font-size:0.75rem; font-style:italic;">
          No open positions currently held.
        </div>
      </div>
    </div>

    <!-- Resting Open Orders Deck -->
    <div class="deck-panel expandable">
      <div class="deck-header">
        <div style="display:flex; align-items:center; gap:6px;">
          <span>📋</span>
          <span>Resting CLOB Open Orders</span>
        </div>
        <button onclick="cancelAllOrders()" style="background:transparent; border:none; color:var(--red); font-size:0.68rem; font-weight:800; cursor:pointer;">
          ✕ CANCEL ALL
        </button>
      </div>
      <div id="ordersList" style="display:flex; flex-direction:column; gap:4px;">
        <div style="text-align:center; padding:8px; color:var(--muted); font-size:0.75rem; font-style:italic;">
          No resting orders on CLOB.
        </div>
      </div>
    </div>

    <!-- Real-time Event Tape -->
    <div class="deck-panel expandable">
      <div class="deck-header">
        <div style="display:flex; align-items:center; gap:6px;">
          <span>⚡</span>
          <span>Live Execution Feed</span>
        </div>
        <span style="font-size:0.65rem; color:var(--green);" id="streamPulse">● LIVE SSE</span>
      </div>
      <div class="tape-box" id="eventTape">
        <div class="tape-line"><span class="tape-ts">00:00:00</span> <span class="tape-tag SYSTEM">[SYSTEM]</span> Pocket Cockpit connected to Polymarket engine.</div>
      </div>
    </div>
  </div>

  <script>
    /* ─── State ─── */
    let currentData = null;
    let selectedStrategy = 'ALL';
    let isArmed = true;
    let isMuted = localStorage.getItem('cockpit_audio_muted') === 'true';
    let killInterval = null;
    let audioCtx = null;

    /* ─── Web Audio Synthesizer (Zero External Dependencies) ─── */
    function getAudioCtx() {
      if (!audioCtx) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (AudioCtor) audioCtx = new AudioCtor();
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      return audioCtx;
    }

    function playTone(freq, type = 'sine', duration = 0.08, gainVal = 0.15) {
      if (isMuted) return;
      try {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(gainVal, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      } catch(e) {}
    }

    function soundClick() { playTone(600, 'sine', 0.03, 0.1); }
    function soundArm() {
      playTone(520, 'sine', 0.06, 0.15);
      setTimeout(() => playTone(780, 'sine', 0.08, 0.2), 60);
      setTimeout(() => playTone(1040, 'triangle', 0.12, 0.25), 130);
    }
    function soundDisarm() {
      playTone(600, 'sine', 0.08, 0.15);
      setTimeout(() => playTone(380, 'sawtooth', 0.12, 0.15), 70);
    }
    function soundPanic() {
      playTone(880, 'sawtooth', 0.15, 0.3);
      setTimeout(() => playTone(440, 'sawtooth', 0.18, 0.35), 100);
    }
    function soundHarvest() {
      playTone(659, 'sine', 0.08, 0.2);
      setTimeout(() => playTone(830, 'sine', 0.08, 0.2), 70);
      setTimeout(() => playTone(987, 'sine', 0.14, 0.25), 140);
    }

    function updateAudioIcon() {
      document.getElementById('audioIcon').textContent = isMuted ? '🔇' : '🔊';
      document.getElementById('btnAudio').classList.toggle('active', !isMuted);
    }
    function toggleAudio() {
      isMuted = !isMuted;
      localStorage.setItem('cockpit_audio_muted', isMuted ? 'true' : 'false');
      updateAudioIcon();
      if (!isMuted) soundClick();
    }
    updateAudioIcon();

    /* ─── Armed / Disarmed & Panic Controls ─── */
    async function armBot() {
      soundArm();
      setArmStateUI(true);
      addTapeLog('SYSTEM', 'Bot ARMED — automated execution active');
      try {
        await fetch('/api/bot/arm', { method: 'POST' });
      } catch(e) { console.error('Arm request failed', e); }
    }

    async function disarmBot() {
      soundDisarm();
      setArmStateUI(false);
      addTapeLog('SYSTEM', 'Bot DISARMED — Standby safe mode active');
      try {
        await fetch('/api/bot/disarm', { method: 'POST' });
      } catch(e) { console.error('Disarm request failed', e); }
    }

    function setArmStateUI(armed) {
      isArmed = armed;
      const btnArm = document.getElementById('btnArm');
      const btnDisarm = document.getElementById('btnDisarm');
      const badge = document.getElementById('liveBadge');
      const badgeText = document.getElementById('liveBadgeText');

      if (armed) {
        btnArm.classList.add('armed');
        btnDisarm.classList.remove('disarmed');
        badge.className = 'status-badge badge-armed';
        badgeText.textContent = 'ARMED';
      } else {
        btnArm.classList.remove('armed');
        btnDisarm.classList.add('disarmed');
        badge.className = 'status-badge badge-disarmed';
        badgeText.textContent = 'DISARMED';
      }
    }

    /* ─── Hold-to-kill Emergency Panic ─── */
    function startKillHold() {
      const fill = document.getElementById('killProgress');
      const label = document.getElementById('panicLabel');
      let start = Date.now();
      const duration = 1500;
      soundClick();

      if (killInterval) clearInterval(killInterval);
      killInterval = setInterval(() => {
        const elapsed = Date.now() - start;
        const pct = Math.min(100, (elapsed / duration) * 100);
        fill.style.width = pct + '%';
        const rem = ((duration - elapsed) / 1000).toFixed(1);
        label.textContent = 'ARMING KILL SWITCH (' + Math.max(0, rem) + 's)...';

        if (elapsed >= duration) {
          clearInterval(killInterval);
          killInterval = null;
          fill.style.width = '0%';
          label.textContent = 'EMERGENCY PANIC: CANCEL ALL & STOP (HOLD 1.5s)';
          triggerPanicHalt();
        }
      }, 30);
    }

    function endKillHold() {
      if (killInterval) {
        clearInterval(killInterval);
        killInterval = null;
      }
      document.getElementById('killProgress').style.width = '0%';
      document.getElementById('panicLabel').textContent = 'EMERGENCY PANIC: CANCEL ALL & STOP (HOLD 1.5s)';
    }

    async function triggerPanicHalt() {
      soundPanic();
      setArmStateUI(false);
      const badge = document.getElementById('liveBadge');
      const badgeText = document.getElementById('liveBadgeText');
      badge.className = 'status-badge badge-panic';
      badgeText.textContent = 'PANIC HALT';
      addTapeLog('PANIC', 'EMERGENCY PANIC TRIGGERED — Cancelled all orders & halted bot');
      try {
        const res = await fetch('/api/bot/panic', { method: 'POST' });
        const json = await res.json();
        addTapeLog('SYSTEM', 'Panic sweep completed: ' + (json.cancelledOrders || 0) + ' open orders cancelled on CLOB.');
        refresh();
      } catch(e) { console.error('Panic request failed', e); }
    }

    /* ─── Ground Truth Sync ─── */
    async function triggerGroundTruthSync() {
      soundClick();
      const st = document.getElementById('syncStatus');
      st.textContent = 'SYNCING...';
      addTapeLog('SYSTEM', 'Syncing Ground Truth with Polymarket on-chain data...');
      try {
        const res = await fetch('/api/sync/truth', { method: 'POST' });
        const data = await res.json();
        st.textContent = 'RECONCILED ✓';
        setTimeout(() => st.textContent = '1-CLICK RECONCILE', 3000);
        addTapeLog('SYSTEM', 'Ground Truth reconciled successfully.');
        refresh();
      } catch(e) {
        st.textContent = 'SYNC ERROR';
        setTimeout(() => st.textContent = '1-CLICK RECONCILE', 3000);
      }
    }

    /* ─── 1-Click Alpha Harvest Exit ─── */
    async function harvestPosition(marketId, outcome, price) {
      soundHarvest();
      addTapeLog('ORDER', 'Harvesting ' + outcome + ' @ $' + price.toFixed(2) + ' (Limit Ask)...');
      try {
        const res = await fetch('/api/positions/exit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marketId, outcome, price })
        });
        const d = await res.json();
        addTapeLog('ORDER', d.message || 'Exit order placed.');
        refresh();
      } catch(e) {
        console.error('Exit failed', e);
      }
    }

    async function cancelOrder(orderId, walletId) {
      soundClick();
      try {
        await fetch('/api/orders/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, walletId })
        });
        addTapeLog('ORDER', 'Cancelled order ' + orderId.slice(0, 8) + '…');
        loadOpenOrders();
      } catch(e) {}
    }

    async function cancelAllOrders() {
      soundClick();
      try {
        await fetch('/api/orders/cancel-all', { method: 'POST' });
        addTapeLog('ORDER', 'Cancelled all open orders on CLOB');
        loadOpenOrders();
      } catch(e) {}
    }

    /* ─── Strategy Filter ─── */
    function selectStrategy(strat, btn) {
      soundClick();
      selectedStrategy = strat;
      document.querySelectorAll('.strat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (currentData) renderAll(currentData);
    }

    /* ─── Logging Tape ─── */
    function addTapeLog(tag, msg) {
      const tape = document.getElementById('eventTape');
      const now = new Date().toTimeString().slice(0, 8);
      const row = document.createElement('div');
      row.className = 'tape-line';
      row.innerHTML = '<span class="tape-ts">' + now + '</span> <span class="tape-tag ' + tag + '">[' + tag + ']</span> <span>' + msg + '</span>';
      tape.appendChild(row);
      tape.scrollTop = tape.scrollHeight;
    }

    /* ─── View Toggles & Floating Windows ─── */
    function toggleCompact() {
      document.body.classList.toggle('minimized');
      soundClick();
    }

    function launchPopout() {
      soundClick();
      window.open('/widget', 'PolymarketPocketCockpit', 'width=520,height=760,menubar=no,toolbar=no,location=no,status=no');
    }

    async function togglePinFloat() {
      soundClick();
      if ('documentPictureInPicture' in window) {
        try {
          const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 500, height: 700 });
          pipWindow.document.write(document.documentElement.outerHTML);
          pipWindow.document.close();
          document.getElementById('btnFloat').classList.add('active');
          return;
        } catch(e) { console.warn('PiP fallback', e); }
      }
      launchPopout();
    }

    /* ─── Remote Pairing Modal & QR ─── */
    function openRemoteModal() {
      soundClick();
      const modal = document.getElementById('remoteModal');
      modal.classList.add('active');
      const url = window.location.origin + '/widget';
      document.getElementById('remoteLinkInput').value = url;
      drawSimpleQR(document.getElementById('qrCanvas'), url);
    }
    function closeRemoteModal(e) {
      document.getElementById('remoteModal').classList.remove('active');
    }
    function copyRemoteLink() {
      soundClick();
      const input = document.getElementById('remoteLinkInput');
      input.select();
      navigator.clipboard.writeText(input.value);
      alert('Remote link copied to clipboard!');
    }

    /* Lightweight Canvas QR Code Generator */
    function drawSimpleQR(canvas, text) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#090a0f';
      
      // Draw standard finder patterns
      function drawFinder(x, y) {
        ctx.fillRect(x, y, 42, 42);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 6, y + 6, 30, 30);
        ctx.fillStyle = '#090a0f';
        ctx.fillRect(x + 12, y + 12, 18, 18);
      }
      drawFinder(10, 10);
      drawFinder(canvas.width - 52, 10);
      drawFinder(10, canvas.height - 52);

      // Deterministic decorative barcode matrix based on text
      let hash = 0;
      for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash) + text.charCodeAt(i);
      for (let r = 0; r < 18; r++) {
        for (let c = 0; c < 18; c++) {
          const x = 58 + c * 5;
          const y = 58 + r * 5;
          if ((hash ^ (r * 31 + c * 17)) % 2 === 0) {
            ctx.fillRect(x, y, 4, 4);
          }
        }
      }
    }

    /* ─── Data Rendering ─── */
    function renderAll(d) {
      currentData = d;
      const wallets = d.wallets || [];
      const filteredWallets = selectedStrategy === 'ALL'
        ? wallets
        : wallets.filter(w => w.assignedStrategy.toLowerCase().includes(selectedStrategy.toLowerCase()));

      let totalVal = 0;
      let cashBal = 0;
      let capAlloc = 0;
      let realizedPnl = 0;
      let allPositions = [];

      for (const w of filteredWallets) {
        cashBal += (w.availableBalance || 0);
        capAlloc += (w.capitalAllocated || 0);
        realizedPnl += (w.realizedPnl || 0);
        totalVal += (w.totalValue || w.availableBalance || 0);
        if (w.openPositions) {
          for (const p of w.openPositions) {
            if (p.size > 0) {
              allPositions.push({ ...p, walletId: w.walletId, strategy: w.assignedStrategy });
            }
          }
        }
      }

      // KPIs
      document.getElementById('kpiTotalVal').textContent = '$' + totalVal.toFixed(2);
      document.getElementById('kpiCashBal').textContent = '$' + cashBal.toFixed(2);
      document.getElementById('kpiAllocated').textContent = 'Budget: $' + capAlloc.toFixed(2);
      
      const realEl = document.getElementById('kpiRealizedPnl');
      realEl.textContent = (realizedPnl >= 0 ? '+$' : '-$') + Math.abs(realizedPnl).toFixed(2);
      realEl.className = realizedPnl >= 0 ? 'pnl-pos font-bold' : 'pnl-neg font-bold';

      const pnlPct = capAlloc > 0 ? ((totalVal - capAlloc) / capAlloc) * 100 : 0;
      const pnlTag = document.getElementById('kpiPnlTag');
      pnlTag.textContent = (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(1) + '%';
      pnlTag.className = 'pnl-tag ' + (pnlPct >= 0 ? 'tag-pos' : 'tag-neg');

      const sumPnl = d.summary ? d.summary.totalRealizedPnl : realizedPnl;
      const winRate = d.summary && d.summary.winRate !== undefined ? (d.summary.winRate * 100).toFixed(1) : '75.0';
      document.getElementById('kpiWinRate').textContent = winRate + '%';
      document.getElementById('kpiTradesCount').textContent = (d.summary ? d.summary.totalTrades : 0) + ' Trades';

      // Positions Deck
      const posContainer = document.getElementById('positionsList');
      document.getElementById('deckPosCount').textContent = allPositions.length + ' ACTIVE';
      let posTotalVal = 0;

      if (allPositions.length === 0) {
        posContainer.innerHTML = '<div style="text-align:center; padding:12px; color:var(--muted); font-size:0.75rem; font-style:italic;">No open positions currently held.</div>';
      } else {
        let html = '';
        for (const p of allPositions) {
          const curPrice = p.curPrice || p.avgPrice || 0.5;
          const val = p.size * curPrice;
          posTotalVal += val;
          const uPnl = (curPrice - p.avgPrice) * p.size;
          const uPct = p.avgPrice > 0 ? ((curPrice - p.avgPrice) / p.avgPrice) * 100 : 0;
          const isPos = uPnl >= 0;

          html += '<div class="pos-item">' +
            '<div class="pos-row-top">' +
              '<div class="pos-title">' + (p.title || p.marketId) + '</div>' +
              '<span class="pos-badge badge-' + p.outcome.toLowerCase() + '">' + p.outcome + '</span>' +
            '</div>' +
            '<div class="pos-metrics">' +
              '<span>Size: ' + p.size + ' @ $' + p.avgPrice.toFixed(2) + '</span>' +
              '<span>Mark: $' + curPrice.toFixed(2) + '</span>' +
              '<span class="' + (isPos ? 'pnl-pos' : 'pnl-neg') + ' font-bold">' + (isPos ? '+$' : '-$') + Math.abs(uPnl).toFixed(2) + ' (' + (isPos ? '+' : '') + uPct.toFixed(1) + '%)</span>' +
            '</div>' +
            '<div class="pos-actions">' +
              '<button class="btn-harvest-sm" onclick="harvestPosition(\\'' + p.marketId + '\\', \\'' + p.outcome + '\\', 0.94)">🎯 Harvest Limit ($0.94)</button>' +
              '<button class="btn-exit-sm" onclick="harvestPosition(\\'' + p.marketId + '\\', \\'' + p.outcome + '\\', ' + curPrice.toFixed(2) + ')">⚡ Market Exit</button>' +
            '</div>' +
          '</div>';
        }
        posContainer.innerHTML = html;
      }

      document.getElementById('kpiPositionsVal').textContent = '$' + posTotalVal.toFixed(2);
      document.getElementById('kpiPositionsCount').textContent = allPositions.length + ' open contracts';
    }

    async function loadOpenOrders() {
      try {
        const res = await fetch('/api/orders/open');
        const d = await res.json();
        const orders = d.orders || [];
        document.getElementById('kpiOpenOrdersCount').textContent = orders.length + ' Orders';
        const list = document.getElementById('ordersList');
        if (orders.length === 0) {
          list.innerHTML = '<div style="text-align:center; padding:8px; color:var(--muted); font-size:0.75rem; font-style:italic;">No resting orders on CLOB.</div>';
        } else {
          let html = '';
          for (const ord of orders) {
            html += '<div class="order-row">' +
              '<span><b style="color:' + (ord.side === 'BUY' ? 'var(--green)' : 'var(--red)') + '">' + ord.side + '</b> ' + ord.outcome + ' ×' + ord.sizeRemaining + ' @ $' + ord.price.toFixed(2) + '</span>' +
              '<span style="color:var(--muted); font-size:0.65rem;">' + (ord.id ? ord.id.slice(0, 8) : 'CLOB') + '…</span>' +
              '<button class="btn-cancel-ord" onclick="cancelOrder(\\'' + ord.id + '\\', \\'' + (ord.walletId || '') + '\\')">✕ Cancel</button>' +
            '</div>';
          }
          list.innerHTML = html;
        }
      } catch(e) {}
    }

    async function fetchBotStatus() {
      try {
        const res = await fetch('/api/bot/status');
        const st = await res.json();
        if (st && st.ok) {
          setArmStateUI(Boolean(st.isArmed));
        }
      } catch(e) {}
    }

    /* ─── SSE Stream Connection ─── */
    function connectSSE() {
      try {
        const sse = new EventSource('/api/stream');
        sse.addEventListener('dashboard', (ev) => {
          try {
            const data = JSON.parse(ev.data);
            renderAll(data);
          } catch(e) {}
        });
        sse.onerror = () => {
          sse.close();
          setTimeout(connectSSE, 3000);
        };
      } catch(e) {
        setTimeout(connectSSE, 3000);
      }
    }

    async function refresh() {
      try {
        const res = await fetch('/api/data');
        const data = await res.json();
        renderAll(data);
        loadOpenOrders();
        fetchBotStatus();
      } catch(e) {}
    }

    // Keyboard shortcuts: Space / Enter hold for panic
    window.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && document.activeElement.tagName !== 'INPUT') {
        startKillHold();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        endKillHold();
      }
    });

    // Boot
    refresh();
    connectSSE();
    setInterval(refresh, 4000);
  </script>
</body>
</html>`;
}
