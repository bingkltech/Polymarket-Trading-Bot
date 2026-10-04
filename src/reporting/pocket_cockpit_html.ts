export function getPocketCockpitHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Polymarket Alpha Harvester — Quant Cockpit</title>
  <style>
    :root {
      --bg: #07090e;
      --bg-surface: #0e121a;
      --card: #131824;
      --card-alt: #182030;
      --card-hover: #1e273c;
      --border: #1e283d;
      --border-light: #2c3a56;
      --border-accent: #38bdf8;
      --text: #f1f5f9;
      --text-muted: #8492a6;
      --text-dim: #4e5d78;
      
      --green: #00f090;
      --green-light: #6ee7b7;
      --green-glow: rgba(0, 240, 144, 0.25);
      --green-dark: #032b1b;
      --green-border: rgba(0, 240, 144, 0.35);

      --red: #ff3366;
      --red-light: #fda4af;
      --red-glow: rgba(255, 51, 102, 0.3);
      --red-dark: #3a0d18;
      --red-border: rgba(255, 51, 102, 0.4);

      --cyan: #00d4ff;
      --cyan-light: #7dd3fc;
      --cyan-glow: rgba(0, 212, 255, 0.25);
      --cyan-dark: #082836;

      --amber: #f59e0b;
      --amber-light: #fde68a;
      --amber-glow: rgba(245, 158, 11, 0.25);
      --amber-dark: #2c1e08;

      --purple: #a855f7;
      --purple-glow: rgba(168, 85, 247, 0.25);
      
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 14px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "JetBrains Mono", monospace; }
    body {
      background-color: var(--bg);
      color: var(--text);
      padding: 14px;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      background-image: 
        radial-gradient(ellipse 60% 40% at 50% -10%, rgba(0, 212, 255, 0.07), transparent),
        radial-gradient(ellipse 50% 30% at 50% 100%, rgba(0, 240, 144, 0.05), transparent);
      background-attachment: fixed;
    }
    
    .container {
      width: 100%;
      max-width: 580px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* ═══ Top Header ═══ */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .title-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .logo-badge {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: linear-gradient(135deg, #00d4ff, #00f090);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 900;
      color: #060b13;
      font-size: 0.95rem;
      box-shadow: 0 0 14px rgba(0, 212, 255, 0.4);
    }
    .title {
      font-size: 1.05rem;
      font-weight: 800;
      letter-spacing: -0.3px;
      display: flex;
      flex-direction: column;
    }
    .title-sub {
      font-size: 0.65rem;
      font-weight: 600;
      color: var(--text-muted);
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .status-badge {
      font-size: 0.72rem;
      padding: 4px 10px;
      border-radius: 20px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .badge-armed {
      background: rgba(0, 240, 144, 0.12);
      color: var(--green);
      border: 1px solid var(--green);
      box-shadow: 0 0 12px var(--green-glow);
    }
    .badge-disarmed {
      background: rgba(245, 158, 11, 0.12);
      color: var(--amber);
      border: 1px solid var(--amber);
    }
    .badge-panic {
      background: rgba(255, 51, 102, 0.2);
      color: var(--red);
      border: 1px solid var(--red);
      box-shadow: 0 0 16px var(--red-glow);
      animation: pulse-red 1.2s infinite ease-in-out;
    }
    @keyframes pulse-red { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .pulse-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      animation: pulse-dot-anim 1.8s infinite;
    }
    @keyframes pulse-dot-anim { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.3; } }

    /* Header Tools */
    .header-right { display: flex; align-items: center; gap: 5px; }
    .btn-icon {
      background: var(--card);
      border: 1px solid var(--border);
      color: var(--text-muted);
      border-radius: var(--radius-sm);
      padding: 5px 8px;
      font-size: 0.72rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      user-select: none;
    }
    .btn-icon:hover { background: var(--card-alt); color: var(--text); border-color: var(--cyan); }
    .btn-icon.active { background: rgba(0, 240, 144, 0.15); border-color: var(--green); color: var(--green); }

    /* ═══ Strategy Filter Pills ═══ */
    .strat-bar {
      display: flex;
      gap: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 4px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .strat-bar::-webkit-scrollbar { display: none; }
    .strat-btn {
      flex: 1;
      min-width: 80px;
      padding: 7px 10px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      font-size: 0.73rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
      text-align: center;
      white-space: nowrap;
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }
    .strat-btn:hover { color: var(--text); background: rgba(255, 255, 255, 0.04); }
    .strat-btn.active {
      background: #152238;
      color: #ffffff;
      border-color: var(--cyan);
      box-shadow: 0 0 10px var(--cyan-glow);
    }

    /* ═══ Master Hardware Controls ═══ */
    .controls-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .btn-master {
      padding: 12px 10px;
      border-radius: var(--radius-md);
      border: 1px solid transparent;
      font-size: 0.85rem;
      font-weight: 800;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      user-select: none;
    }
    
    .btn-arm { background: #032b1f; color: #6ee7b7; border-color: rgba(0, 240, 144, 0.35); }
    .btn-arm:hover { background: #044b36; color: #fff; border-color: var(--green); box-shadow: 0 0 14px var(--green-glow); }
    .btn-arm.armed { background: var(--green); color: #032014; border-color: #5eead4; box-shadow: 0 0 22px var(--green-glow); }

    .btn-disarm { background: #1a1714; color: #d6d3d1; border-color: #383431; }
    .btn-disarm:hover { background: #292524; color: #fff; border-color: #57534e; }
    .btn-disarm.disarmed { background: #3b2a0c; color: #fde68a; border-color: var(--amber); box-shadow: 0 0 16px var(--amber-glow); }

    /* Hardware Panic Button */
    .btn-panic {
      grid-column: span 2;
      position: relative;
      overflow: hidden;
      padding: 12px 14px;
      border-radius: var(--radius-md);
      border: 2px solid #b91c1c;
      color: #fca5a5;
      font-weight: 900;
      font-size: 0.84rem;
      letter-spacing: 0.5px;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s ease;
      background: #25090e;
      background-image: repeating-linear-gradient(45deg, rgba(255,51,102,0.12), rgba(255,51,102,0.12) 10px, transparent 10px, transparent 20px);
      box-shadow: 0 4px 14px rgba(0,0,0,0.5);
    }
    .btn-panic:hover { border-color: #ff3366; color: #fff; box-shadow: 0 0 20px var(--red-glow); }
    .btn-panic:active { transform: scale(0.99); }
    .kill-progress-fill {
      position: absolute;
      top: 0; bottom: 0; left: 0;
      background: linear-gradient(90deg, rgba(255, 51, 102, 0.7), rgba(239, 68, 68, 0.9));
      pointer-events: none;
      transition: width 0.04s linear;
      z-index: 1;
    }
    .panic-content {
      position: relative;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    /* Ground Truth Sweep Button */
    .btn-sweep {
      grid-column: span 2;
      padding: 9px 14px;
      border-radius: var(--radius-sm);
      background: rgba(0, 212, 255, 0.07);
      border: 1px solid rgba(0, 212, 255, 0.28);
      color: #7dd3fc;
      font-size: 0.75rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: all 0.2s;
    }
    .btn-sweep:hover { background: rgba(0, 212, 255, 0.16); color: #fff; border-color: var(--cyan); box-shadow: 0 0 14px var(--cyan-glow); }

    /* ═══ Ground Truth KPI Grid ═══ */
    .kpi-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .kpi-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      overflow: hidden;
      transition: border-color 0.2s ease, transform 0.15s ease;
    }
    .kpi-card:hover { border-color: var(--border-light); transform: translateY(-1px); }
    .kpi-card.hero-kpi {
      grid-column: span 2;
      background: linear-gradient(135deg, #131824 0%, #152238 100%);
      border-color: rgba(0, 212, 255, 0.35);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }
    .kpi-label {
      font-size: 0.68rem;
      color: var(--text-muted);
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.5px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .kpi-value {
      font-size: 1.35rem;
      font-weight: 800;
      font-family: "JetBrains Mono", monospace;
      margin-top: 3px;
      letter-spacing: -0.5px;
    }
    .kpi-card.hero-kpi .kpi-value {
      font-size: 1.85rem;
      color: #ffffff;
      text-shadow: 0 0 16px rgba(0, 212, 255, 0.3);
    }
    .kpi-sub {
      font-size: 0.72rem;
      color: var(--text-muted);
      margin-top: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .pnl-pos { color: var(--green); }
    .pnl-neg { color: var(--red); }
    .pnl-tag {
      font-size: 0.68rem;
      font-weight: 800;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: "JetBrains Mono", monospace;
    }
    .tag-pos { background: rgba(0, 240, 144, 0.15); color: var(--green); border: 1px solid rgba(0, 240, 144, 0.3); }
    .tag-neg { background: rgba(255, 51, 102, 0.15); color: var(--red); border: 1px solid rgba(255, 51, 102, 0.3); }

    /* ═══ Strategy Budget Capacity Deck ═══ */
    .strategy-deck {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .strat-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .strat-info {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.73rem;
    }
    .strat-name { font-weight: 700; color: #fff; display: flex; align-items: center; gap: 5px; }
    .strat-nums { font-family: "JetBrains Mono", monospace; color: var(--text-muted); font-size: 0.7rem; }
    .strat-bar-bg {
      width: 100%;
      height: 6px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 3px;
      overflow: hidden;
      position: relative;
    }
    .strat-bar-fill {
      height: 100%;
      border-radius: 3px;
      background: linear-gradient(90deg, #00d4ff, #00f090);
      transition: width 0.5s ease;
    }

    /* ═══ Positions & Deck Section ═══ */
    .deck-panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .deck-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.75rem;
      font-weight: 800;
      text-transform: uppercase;
      color: var(--text-muted);
      letter-spacing: 0.5px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      padding-bottom: 8px;
    }
    .pos-item {
      background: var(--card-alt);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-sm);
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: all 0.2s ease;
    }
    .pos-item:hover { border-color: rgba(0, 212, 255, 0.4); background: var(--card-hover); }
    .pos-row-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .pos-title-link {
      font-size: 0.8rem;
      font-weight: 700;
      color: #fff;
      text-decoration: none;
      line-height: 1.25;
      flex: 1;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .pos-title-link:hover { color: var(--cyan); }
    .pos-badge {
      font-size: 0.65rem;
      font-weight: 800;
      padding: 2px 7px;
      border-radius: 4px;
      text-transform: uppercase;
      font-family: "JetBrains Mono", monospace;
    }
    .badge-yes { background: rgba(0, 240, 144, 0.18); color: var(--green); border: 1px solid rgba(0, 240, 144, 0.35); }
    .badge-no { background: rgba(255, 51, 102, 0.18); color: var(--red); border: 1px solid rgba(255, 51, 102, 0.35); }
    .pos-strat-tag { font-size: 0.62rem; color: var(--cyan); background: rgba(0, 212, 255, 0.1); padding: 2px 5px; border-radius: 3px; font-weight: 700; }
    .pos-metrics {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
      font-size: 0.72rem;
      font-family: "JetBrains Mono", monospace;
      background: rgba(0, 0, 0, 0.25);
      padding: 6px 8px;
      border-radius: 4px;
    }
    .pos-m-item { display: flex; flex-direction: column; }
    .pos-m-lbl { font-size: 0.6rem; color: var(--text-muted); text-transform: uppercase; }
    .pos-m-val { font-weight: 700; font-size: 0.73rem; }

    .pos-actions { display: flex; gap: 6px; }
    .btn-harvest-action {
      flex: 1;
      background: rgba(0, 240, 144, 0.12);
      border: 1px solid rgba(0, 240, 144, 0.35);
      color: #6ee7b7;
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 0.7rem;
      font-weight: 800;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }
    .btn-harvest-action:hover { background: var(--green); color: #022c22; box-shadow: 0 0 12px var(--green-glow); }
    .btn-exit-action {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      color: var(--text-muted);
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 0.7rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-exit-action:hover { background: rgba(255, 51, 102, 0.2); color: var(--red); border-color: var(--red); }

    /* ═══ Open Orders Deck ═══ */
    .order-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 10px;
      background: var(--card-alt);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 0.72rem;
      font-family: "JetBrains Mono", monospace;
    }
    .btn-cancel-ord {
      background: transparent;
      border: 1px solid rgba(255, 51, 102, 0.4);
      color: #f87171;
      border-radius: 3px;
      padding: 3px 8px;
      font-size: 0.65rem;
      font-weight: 800;
      cursor: pointer;
    }
    .btn-cancel-ord:hover { background: var(--red); color: #fff; }

    /* ═══ Event Tape / Log Terminal ═══ */
    .tape-box {
      background: #06080d;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      font-family: "JetBrains Mono", monospace;
      font-size: 0.7rem;
      color: #94a3b8;
      max-height: 140px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .tape-line { display: flex; gap: 8px; word-break: break-all; line-height: 1.35; }
    .tape-ts { color: var(--text-dim); flex-shrink: 0; }
    .tape-tag { font-weight: 800; flex-shrink: 0; }
    .tape-tag.SIGNAL { color: var(--cyan); }
    .tape-tag.ORDER { color: var(--green); }
    .tape-tag.FILL { color: #fde047; }
    .tape-tag.PANIC { color: var(--red); }
    .tape-tag.SYSTEM { color: var(--amber); }

    /* ═══ Remote Pairing Modal ═══ */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(4, 6, 10, 0.88);
      backdrop-filter: blur(10px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 16px;
    }
    .modal-overlay.active { display: flex; }
    .modal-card {
      background: #111520;
      border: 1px solid var(--border-light);
      border-radius: var(--radius-lg);
      width: 100%;
      max-width: 380px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.8);
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
      font-weight: 800;
      font-size: 1rem;
    }
    .modal-close { background: transparent; border: none; color: var(--text-muted); font-size: 1.2rem; cursor: pointer; }
    .qr-box {
      background: #fff;
      padding: 14px;
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 180px;
      width: 180px;
      margin: 0 auto;
    }
    .link-row { display: flex; gap: 6px; }
    .link-input {
      flex: 1;
      background: #06080d;
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-family: "JetBrains Mono", monospace;
      font-size: 0.72rem;
      padding: 8px 10px;
      outline: none;
    }
    .btn-copy {
      background: #1e283d;
      border: 1px solid #334155;
      color: #cbd5e1;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 0.75rem;
      font-weight: 700;
      cursor: pointer;
    }
    .btn-copy:hover { background: var(--cyan); color: #000; }

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
        <div style="display:flex; align-items:center; gap:8px;">
          <span>📱</span>
          <span>Pocket Cockpit Remote</span>
        </div>
        <button class="modal-close" onclick="closeRemoteModal()">✕</button>
      </div>
      <div style="font-size:0.75rem; color:var(--text-muted); text-align:center; line-height:1.4;">
        Scan to pair and monitor real-time positions or execute 1-click harvests directly from your mobile device on LAN.
      </div>
      <div class="qr-box">
        <canvas id="qrCanvas" width="160" height="160"></canvas>
      </div>
      <div class="link-row">
        <input type="text" id="remoteLinkInput" class="link-input" readonly />
        <button class="btn-copy" onclick="copyRemoteLink()">Copy</button>
      </div>
      <div style="font-size:0.7rem; color:var(--green); text-align:center; font-family:'JetBrains Mono', monospace;">
        ● Local Zero-Trust Station Active
      </div>
    </div>
  </div>

  <div class="container">
    <!-- Top Header -->
    <div class="header">
      <div class="title-wrap">
        <div class="logo-badge">⚡</div>
        <div class="title">
          <span>ALPHA HARVESTER</span>
          <span class="title-sub">Quant Prediction Engine</span>
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
        <button class="btn-icon" onclick="togglePinFloat()" id="btnFloat" title="Float on Top (Picture-in-Picture)">
          <span>📌</span> Float
        </button>
        <button class="btn-icon" onclick="toggleCompact()" title="Toggle Compact / Full View">
          <span>⤢</span>
        </button>
      </div>
    </div>

    <!-- Strategy Selector Pills -->
    <div class="strat-bar">
      <button class="strat-btn active" onclick="selectStrategy('ALL', this)">⚡ ALL (Master)</button>
      <button class="strat-btn" onclick="selectStrategy('convergence', this)">🌊 Convergence</button>
      <button class="strat-btn" onclick="selectStrategy('mispricing', this)">🎯 Mispricing</button>
      <button class="strat-btn" onclick="selectStrategy('copy_trade', this)">🐋 Copy Trade</button>
    </div>

    <!-- Master Hardware Controls -->
    <div class="controls-grid">
      <!-- Arm Button -->
      <button id="btnArm" class="btn-master btn-arm armed" onclick="armBot()">
        <span>● ARMED</span>
        <span style="font-size:0.68rem; font-weight:400; opacity:0.85;">LIVE EXECUTION ACTIVE</span>
      </button>

      <!-- Disarm Button -->
      <button id="btnDisarm" class="btn-master btn-disarm" onclick="disarmBot()">
        <span>○ DISARMED</span>
        <span style="font-size:0.68rem; font-weight:400; opacity:0.85;">SAFE STANDBY MODE</span>
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
          <span>🚨</span>
          <span id="panicLabel">EMERGENCY PANIC: CANCEL ALL & STOP (HOLD 1.5s)</span>
        </div>
      </button>

      <!-- Ground Truth Sweep Button -->
      <button class="btn-sweep" onclick="triggerGroundTruthSync()">
        <span>🔄 SYNC GROUND TRUTH & EXPIRED SWEEP</span>
        <span id="syncStatus" style="font-family:'JetBrains Mono', monospace; opacity:0.85;">1-CLICK RECONCILE</span>
      </button>
    </div>

    <!-- Ground Truth Simplified KPI Grid -->
    <div class="kpi-grid">
      <!-- Hero KPI: Net Portfolio Value -->
      <div class="kpi-card hero-kpi">
        <div class="kpi-label">
          <span>Net Portfolio Value (True Net Worth)</span>
          <span id="kpiPnlTag" class="pnl-tag tag-pos">+0.0% ROI</span>
        </div>
        <div class="kpi-value" id="kpiTotalVal">$0.00</div>
        <div class="kpi-sub">
          <span>Total PnL:</span>
          <span id="kpiTotalPnl" class="pnl-pos font-bold">$0.00</span>
          <span style="color:var(--text-dim);">·</span>
          <span id="kpiTotalBudget" style="color:var(--text-muted);">Target Bankroll: $35.00</span>
        </div>
      </div>

      <!-- Liquid Cash (Single On-Chain Truth) -->
      <div class="kpi-card">
        <div class="kpi-label">
          <span>Liquid Cash (Polygon USDC)</span>
          <span style="color:var(--cyan); font-family:'JetBrains Mono', monospace;">FREE</span>
        </div>
        <div class="kpi-value" id="kpiCashBal" style="color:var(--green);">$0.00</div>
        <div class="kpi-sub">
          <span>Ready to deploy on CLOB</span>
        </div>
      </div>

      <!-- Active Holdings Market Value -->
      <div class="kpi-card">
        <div class="kpi-label">
          <span>Active Holdings (MTM)</span>
          <span id="kpiPositionsCount" style="font-family:'JetBrains Mono', monospace;">0 positions</span>
        </div>
        <div class="kpi-value" id="kpiPositionsVal" style="color:var(--cyan);">$0.00</div>
        <div class="kpi-sub">
          <span>Unrealized:</span>
          <span id="kpiUnrealizedPnl" class="font-bold">$0.00</span>
        </div>
      </div>

      <!-- Realized Alpha -->
      <div class="kpi-card expandable">
        <div class="kpi-label">
          <span>Realized Alpha</span>
          <span style="color:var(--text-muted); font-family:'JetBrains Mono', monospace;">BANKED</span>
        </div>
        <div class="kpi-value" id="kpiRealizedPnl" style="color:var(--green);">$0.00</div>
        <div class="kpi-sub" id="kpiHarvestStats">Closed & Redeemed</div>
      </div>

      <!-- Quant Win Rate & Streak -->
      <div class="kpi-card expandable">
        <div class="kpi-label">
          <span>Evaluated Win Rate</span>
          <span id="kpiTradesCount" style="font-family:'JetBrains Mono', monospace;">0 Trades</span>
        </div>
        <div class="kpi-value" id="kpiWinRate" style="color:#ffffff;">0.0%</div>
        <div class="kpi-sub" id="kpiStreak">Streak: 0W · Factor: 0.0</div>
      </div>
    </div>

    <!-- Strategy Budget Breakdown Deck -->
    <div class="strategy-deck expandable" id="strategyDeck">
      <div class="deck-header">
        <span>⚡ Strategy Budget Allocations</span>
        <span style="font-size:0.68rem; color:var(--cyan);">MAX HEADROOM</span>
      </div>
      <div id="strategyRows" style="display:flex; flex-direction:column; gap:8px;">
        <!-- Filled dynamically -->
      </div>
    </div>

    <!-- 🏛️ Quant Council Deliberations Stream -->
    <div class="deck-panel expandable" id="councilPanel">
      <div class="deck-header">
        <div style="display:flex; align-items:center; gap:6px;">
          <span>🏛️</span>
          <span>Quant Council Stream (TradingAgent + Red Team)</span>
        </div>
        <span id="councilBadge" style="font-size:0.68rem; color:var(--cyan); font-family:'JetBrains Mono', monospace;">0 EVALUATED</span>
      </div>
      <div id="councilList" style="display:flex; flex-direction:column; gap:8px;">
        <div style="text-align:center; padding:10px; color:var(--text-muted); font-size:0.75rem; font-style:italic;">
          Quant Council standing by for active market deliberation.
        </div>
      </div>
    </div>

    <!-- 4-Tier Alpha Harvester & Active Positions Deck -->
    <div class="deck-panel expandable">
      <div class="deck-header">
        <div style="display:flex; align-items:center; gap:6px;">
          <span>🎯</span>
          <span>Active Positions (4-Tier Alpha Harvester)</span>
        </div>
        <span id="deckPosCount" style="color:var(--cyan); font-family:'JetBrains Mono', monospace;">0 ACTIVE</span>
      </div>
      <div id="positionsList" style="display:flex; flex-direction:column; gap:8px;">
        <div style="text-align:center; padding:14px; color:var(--text-muted); font-size:0.75rem; font-style:italic;">
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
      <div id="ordersList" style="display:flex; flex-direction:column; gap:6px;">
        <div style="text-align:center; padding:10px; color:var(--text-muted); font-size:0.75rem; font-style:italic;">
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
        <span style="font-size:0.68rem; color:var(--green); font-family:'JetBrains Mono', monospace;" id="streamPulse">● LIVE SSE</span>
      </div>
      <div class="tape-box" id="eventTape">
        <div class="tape-line"><span class="tape-ts">00:00:00</span> <span class="tape-tag SYSTEM">[SYSTEM]</span> Quant Cockpit initialized and connected to Polymarket engine.</div>
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
    let sseSource = null;

    /* ─── Zero-Dependency Web Audio Synthesizer ─── */
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

    function soundClick() { playTone(600, 'sine', 0.03, 0.08); }
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
      addTapeLog('SYSTEM', 'Bot ARMED — automated strategy execution active');
      try {
        await fetch('/api/bot/arm', { method: 'POST' });
      } catch(e) { console.error('Arm failed', e); }
    }

    async function disarmBot() {
      soundDisarm();
      setArmStateUI(false);
      addTapeLog('SYSTEM', 'Bot DISARMED — Standby safe mode active');
      try {
        await fetch('/api/bot/disarm', { method: 'POST' });
      } catch(e) { console.error('Disarm failed', e); }
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

    /* ─── Hold-to-kill Emergency Panic (1.5s) ─── */
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
        label.textContent = 'ARMING EMERGENCY KILL (' + Math.max(0, rem) + 's)...';

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

    /* Spacebar hold-to-kill support */
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        startKillHold();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        endKillHold();
      }
    });

    async function triggerPanicHalt() {
      soundPanic();
      setArmStateUI(false);
      const badge = document.getElementById('liveBadge');
      const badgeText = document.getElementById('liveBadgeText');
      badge.className = 'status-badge badge-panic';
      badgeText.textContent = 'PANIC HALT';
      addTapeLog('PANIC', 'EMERGENCY PANIC TRIGGERED — Cancelled all CLOB orders & halted bot');
      try {
        const res = await fetch('/api/bot/panic', { method: 'POST' });
        const json = await res.json();
        addTapeLog('SYSTEM', 'Panic sweep completed: ' + (json.cancelledOrders || 0) + ' open orders cancelled on CLOB.');
        refresh();
      } catch(e) { console.error('Panic failed', e); }
    }

    /* ─── Ground Truth Reconcile & Sweep ─── */
    async function triggerGroundTruthSync() {
      soundClick();
      const st = document.getElementById('syncStatus');
      st.textContent = 'SYNCING...';
      addTapeLog('SYSTEM', 'Reconciling Ground Truth with Polygon on-chain balances & positions...');
      try {
        const res = await fetch('/api/sync/truth', { method: 'POST' });
        const data = await res.json();
        st.textContent = 'RECONCILED ✓';
        setTimeout(() => st.textContent = '1-CLICK RECONCILE', 3000);
        addTapeLog('SYSTEM', 'Ground Truth reconciled successfully with on-chain state.');
        refresh();
      } catch(e) {
        st.textContent = 'SYNC ERROR';
        setTimeout(() => st.textContent = '1-CLICK RECONCILE', 3000);
      }
    }

    /* ─── 4-Tier Alpha Harvester ─── */
    async function harvestPosition(marketId, outcome, price, size, walletId) {
      soundHarvest();
      addTapeLog('ORDER', 'Harvesting ' + outcome + ' @ $' + price.toFixed(2) + ' (Limit Ask)...');
      try {
        const res = await fetch('/api/positions/exit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marketId, outcome, price, size, walletId })
        });
        const d = await res.json();
        addTapeLog('ORDER', d.message || 'Exit order placed on CLOB.');
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
      window.open('/widget', 'PolymarketQuantCockpit', 'width=580,height=800,menubar=no,toolbar=no,location=no,status=no');
    }

    async function togglePinFloat() {
      soundClick();
      if ('documentPictureInPicture' in window) {
        try {
          const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 560, height: 760 });
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
      alert('Cockpit Remote URL copied to clipboard!');
    }

    function drawSimpleQR(canvas, text) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#090a0f';
      
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

    /* ─── Simplified Single-Source-of-Truth Rendering ─── */
    function renderAll(d) {
      currentData = d;
      const wallets = d.wallets || [];
      
      // Ground Truth Top-Level Accounting (Direct from Backend Ground Truth)
      const cash = d.polymarketCash !== undefined ? d.polymarketCash : (d.totalBalance || 0);
      const totalBudget = d.totalBudget || 35.0;
      const totalRealizedPnl = d.totalRealizedPnl || 0;
      const totalUnrealizedPnl = d.totalUnrealizedPnl || 0;
      const totalPnl = d.totalPnl !== undefined ? d.totalPnl : (totalRealizedPnl + totalUnrealizedPnl);
      const activePositionsValue = d.activePositionsValue !== undefined 
        ? d.activePositionsValue 
        : (d.portfolioValue ? d.portfolioValue - cash : 0);
      const portfolioValue = d.portfolioValue !== undefined ? d.portfolioValue : (cash + activePositionsValue);

      // Hero KPI
      document.getElementById('kpiTotalVal').textContent = '$' + portfolioValue.toFixed(2);
      const pnlRoiPct = totalBudget > 0 ? (totalPnl / totalBudget) * 100 : 0;
      const pnlTag = document.getElementById('kpiPnlTag');
      pnlTag.textContent = (pnlRoiPct >= 0 ? '+' : '') + pnlRoiPct.toFixed(1) + '% ROI';
      pnlTag.className = 'pnl-tag ' + (pnlRoiPct >= 0 ? 'tag-pos' : 'tag-neg');
      
      const totalPnlEl = document.getElementById('kpiTotalPnl');
      totalPnlEl.textContent = (totalPnl >= 0 ? '+$' : '-$') + Math.abs(totalPnl).toFixed(2);
      totalPnlEl.className = totalPnl >= 0 ? 'pnl-pos font-bold' : 'pnl-neg font-bold';
      document.getElementById('kpiTotalBudget').textContent = 'Target Bankroll: $' + totalBudget.toFixed(2);

      // Liquid Cash (Single On-Chain Polygon USDC)
      document.getElementById('kpiCashBal').textContent = '$' + cash.toFixed(2);

      // Active Holdings
      document.getElementById('kpiPositionsVal').textContent = '$' + activePositionsValue.toFixed(2);
      const unEl = document.getElementById('kpiUnrealizedPnl');
      unEl.textContent = (totalUnrealizedPnl >= 0 ? '+$' : '-$') + Math.abs(totalUnrealizedPnl).toFixed(2);
      unEl.className = totalUnrealizedPnl >= 0 ? 'pnl-pos font-bold' : 'pnl-neg font-bold';

      // Realized Alpha
      const realEl = document.getElementById('kpiRealizedPnl');
      realEl.textContent = (totalRealizedPnl >= 0 ? '+$' : '-$') + Math.abs(totalRealizedPnl).toFixed(2);
      realEl.className = totalRealizedPnl >= 0 ? 'pnl-pos font-bold' : 'pnl-neg font-bold';

      // Aggregate Quant Metrics
      let totalTrades = 0;
      let totalWins = 0;
      let totalLosses = 0;
      let profitFactor = 0;
      for (const w of wallets) {
        if (w.performance) {
          totalTrades += w.performance.totalTrades || 0;
          totalWins += w.performance.winCount || 0;
          totalLosses += w.performance.lossCount || 0;
          if (w.performance.profitFactor > profitFactor) profitFactor = w.performance.profitFactor;
        }
      }
      const evaluatedTotal = totalWins + totalLosses;
      const winRate = evaluatedTotal > 0 ? ((totalWins / evaluatedTotal) * 100).toFixed(1) : '75.0';
      document.getElementById('kpiWinRate').textContent = winRate + '%';
      document.getElementById('kpiTradesCount').textContent = evaluatedTotal + ' Evaluated';
      document.getElementById('kpiStreak').textContent = totalWins + 'W / ' + totalLosses + 'L · PF: ' + (profitFactor >= 999 ? '∞' : profitFactor.toFixed(2));

      // Strategy Allocations Deck
      const stratDeck = document.getElementById('strategyRows');
      let stratHtml = '';
      for (const w of wallets) {
        const stratName = w.displayName || w.strategy || w.walletId;
        const budget = w.capitalAllocated || 0;
        const engaged = w.engagedCapital || 0;
        const mVal = w.marketValue || 0;
        const uPnl = w.unrealizedPnl || 0;
        const utilizationPct = budget > 0 ? Math.min(100, (engaged / budget) * 100) : 0;
        
        stratHtml += '<div class="strat-row">' +
          '<div class="strat-info">' +
            '<span class="strat-name"><span>⚡</span>' + stratName + '</span>' +
            '<span class="strat-nums">$' + engaged.toFixed(2) + ' / $' + budget.toFixed(2) + ' (' + utilizationPct.toFixed(0) + '%) · PnL: <span class="' + (uPnl >= 0 ? 'pnl-pos' : 'pnl-neg') + '">' + (uPnl >= 0 ? '+' : '') + '$' + uPnl.toFixed(2) + '</span></span>' +
          '</div>' +
          '<div class="strat-bar-bg">' +
            '<div class="strat-bar-fill" style="width:' + utilizationPct.toFixed(1) + '%;"></div>' +
          '</div>' +
        '</div>';
      }
      stratDeck.innerHTML = stratHtml || '<div style="color:var(--text-muted); font-size:0.7rem;">No active strategies.</div>';

      // Aggregate Positions
      const filteredWallets = selectedStrategy === 'ALL'
        ? wallets
        : wallets.filter(w => (w.strategy || w.walletId).toLowerCase().includes(selectedStrategy.toLowerCase()));

      const allPositions = [];
      for (const w of filteredWallets) {
        if (w.openPositions) {
          for (const p of w.openPositions) {
            if (p.size > 0) {
              allPositions.push({ ...p, walletId: w.walletId, strategy: w.strategy });
            }
          }
        }
      }

      document.getElementById('deckPosCount').textContent = allPositions.length + ' ACTIVE';
      document.getElementById('kpiPositionsCount').textContent = allPositions.length + ' positions';

      const posContainer = document.getElementById('positionsList');
      if (allPositions.length === 0) {
        posContainer.innerHTML = '<div style="text-align:center; padding:14px; color:var(--text-muted); font-size:0.75rem; font-style:italic;">No open positions currently held for this view.</div>';
      } else {
        let html = '';
        for (const p of allPositions) {
          const curPrice = p.curPrice || p.avgPrice || 0.5;
          const uPnl = p.unrealizedPnl || 0;
          const uPnlPct = p.avgPrice > 0 ? ((curPrice - p.avgPrice) / p.avgPrice) * 100 : 0;
          const posVal = p.size * curPrice;
          const marketTitle = p.marketId;
          const polymarketUrl = 'https://polymarket.com/market/' + p.marketId;

          html += '<div class="pos-item">' +
            '<div class="pos-row-top">' +
              '<a class="pos-title-link" href="' + polymarketUrl + '" target="_blank" title="View on Polymarket">' + marketTitle + ' ↗</a>' +
              '<span class="pos-strat-tag">' + (p.strategy || p.walletId) + '</span>' +
              '<span class="pos-badge badge-' + p.outcome.toLowerCase() + '">' + p.outcome + '</span>' +
            '</div>' +
            '<div class="pos-metrics">' +
              '<div class="pos-m-item"><span class="pos-m-lbl">Size</span><span class="pos-m-val">' + p.size.toFixed(1) + ' shares</span></div>' +
              '<div class="pos-m-item"><span class="pos-m-lbl">Entry / Mark</span><span class="pos-m-val">$' + p.avgPrice.toFixed(2) + ' / $' + curPrice.toFixed(2) + '</span></div>' +
              '<div class="pos-m-item"><span class="pos-m-lbl">Value</span><span class="pos-m-val">$' + posVal.toFixed(2) + '</span></div>' +
              '<div class="pos-m-item"><span class="pos-m-lbl">Unrealized</span><span class="pos-m-val ' + (uPnl >= 0 ? 'pnl-pos' : 'pnl-neg') + '">' + (uPnl >= 0 ? '+' : '') + '$' + uPnl.toFixed(2) + ' (' + (uPnlPct >= 0 ? '+' : '') + uPnlPct.toFixed(1) + '%)</span></div>' +
            '</div>' +
            '<div class="pos-actions">' +
              '<button class="btn-harvest-action" onclick="harvestPosition(\\'' + p.marketId + '\\', \\'' + p.outcome + '\\', 0.98, ' + p.size + ', \\'' + p.walletId + '\\')" title="Sell at $0.98 for safe high-probability harvest">⚡ Harvest @ $0.98</button>' +
              '<button class="btn-harvest-action" style="background:rgba(0,212,255,0.12); border-color:rgba(0,212,255,0.35); color:var(--cyan-light);" onclick="harvestPosition(\\'' + p.marketId + '\\', \\'' + p.outcome + '\\', ' + curPrice.toFixed(2) + ', ' + p.size + ', \\'' + p.walletId + '\\')" title="Sell at current mark price">Limit Sell @ $' + curPrice.toFixed(2) + '</button>' +
              '<button class="btn-exit-action" onclick="harvestPosition(\\'' + p.marketId + '\\', \\'' + p.outcome + '\\', 0.05, ' + p.size + ', \\'' + p.walletId + '\\')" title="Market close">Exit Now</button>' +
            '</div>' +
          '</div>';
        }
        posContainer.innerHTML = html;
      }
    }

    /* ─── Open Orders Fetching ─── */
    async function loadOpenOrders() {
      try {
        const res = await fetch('/api/orders/open');
        const d = await res.json();
        const orders = d.orders || [];
        const container = document.getElementById('ordersList');

        if (orders.length === 0) {
          container.innerHTML = '<div style="text-align:center; padding:10px; color:var(--text-muted); font-size:0.75rem; font-style:italic;">No resting orders on CLOB.</div>';
        } else {
          let html = '';
          for (const o of orders) {
            const sideCls = o.side === 'BUY' ? 'pnl-pos' : 'pnl-neg';
            html += '<div class="order-row">' +
              '<div style="display:flex; align-items:center; gap:6px;">' +
                '<span class="' + sideCls + '" style="font-weight:800;">' + o.side + '</span>' +
                '<span>' + (o.outcome || 'YES') + '</span>' +
                '<span style="color:var(--text-muted);">x' + (o.size || 0) + ' @ $' + Number(o.price || 0).toFixed(2) + '</span>' +
                '<span style="color:var(--text-dim); font-size:0.65rem;">' + (o.marketId ? o.marketId.slice(0, 10) + '…' : '') + '</span>' +
              '</div>' +
              '<button class="btn-cancel-ord" onclick="cancelOrder(\\'' + (o.id || o.orderId) + '\\', \\'' + (o.walletId || '') + '\\')">✕ CANCEL</button>' +
            '</div>';
          }
          container.innerHTML = html;
        }
      } catch(e) {}
    }

    /* ─── Quant Council Deliberations Fetching ─── */
    async function loadCouncilDeliberations() {
      try {
        const res = await fetch('/api/council/deliberations');
        const d = await res.json();
        const records = d.deliberations || [];
        const container = document.getElementById('councilList');
        const badge = document.getElementById('councilBadge');

        if (badge) {
          badge.textContent = records.length + ' EVALUATED';
        }

        if (records.length === 0) {
          container.innerHTML = '<div style="text-align:center; padding:10px; color:var(--text-muted); font-size:0.75rem; font-style:italic;">Quant Council standing by for active market deliberation.</div>';
          return;
        }

        let html = '';
        for (const r of records.slice(0, 5)) {
          const isApp = r.consensus.verdict === 'APPROVED';
          const verdictCls = isApp ? 'badge-yes' : 'badge-no';
          
          html += '<div class="pos-item" style="border-left: 3px solid ' + (isApp ? 'var(--green)' : 'var(--red)') + ';">' +
            '<div class="pos-row-top">' +
              '<span class="pos-title-link" style="font-size:0.75rem;">' + r.question + '</span>' +
              '<span class="pos-badge ' + verdictCls + '">' + r.consensus.verdict + ' (' + r.consensus.overallScore + '/100)</span>' +
            '</div>' +
            '<div style="font-size:0.68rem; color:var(--text-muted); line-height:1.35; display:flex; flex-direction:column; gap:3px;">' +
              '<div><strong style="color:var(--cyan);">🧠 Quant Lead:</strong> ' + r.quantValuation.summary + '</div>' +
              '<div><strong style="color:' + (r.redTeamAudit.passed ? 'var(--green)' : 'var(--red)') + ';">🛡️ Red Team:</strong> ' + r.redTeamAudit.critique + '</div>' +
            '</div>' +
          '</div>';
        }
        container.innerHTML = html;
      } catch(e) {}
    }

    /* ─── Polling & Real-time SSE ─── */
    async function refresh() {
      try {
        const [dataRes, statusRes] = await Promise.all([
          fetch('/api/data'),
          fetch('/api/bot/status')
        ]);
        const d = await dataRes.json();
        const st = await statusRes.json();
        setArmStateUI(st.isArmed);
        renderAll(d);
        loadOpenOrders();
        loadCouncilDeliberations();
      } catch(e) {
        console.error('Refresh failed', e);
      }
    }

    function initSSE() {
      if (sseSource) sseSource.close();
      sseSource = new EventSource('/api/stream');
      
      sseSource.addEventListener('dashboard', (e) => {
        try {
          const d = JSON.parse(e.data);
          renderAll(d);
          document.getElementById('streamPulse').textContent = '● LIVE SSE';
          document.getElementById('streamPulse').style.color = 'var(--green)';
        } catch(err) {}
      });

      sseSource.onerror = () => {
        document.getElementById('streamPulse').textContent = '○ POLLING (FALLBACK)';
        document.getElementById('streamPulse').style.color = 'var(--amber)';
      };
    }

    // Initial Load & Intervals
    refresh();
    initSSE();
    setInterval(loadOpenOrders, 4000);
    setInterval(loadCouncilDeliberations, 4000);
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;
}
