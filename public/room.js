const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const code = (params.get("code") || "").trim().toUpperCase();
const nick = (params.get("nick") || "").trim();
const hostKey = (params.get("hostKey") || "").trim();

if (!code || !nick) {
  alert("code/nick missing. Go back to main.");
  location.href = "/";
  throw new Error("Missing code/nick");
}

const roomBadge = $("roomBadge");
const boardCardsEl = $("boardCards");
const potEl = $("pot");
const curBetEl = $("curBet");
const youEl = $("you"); // This is just the name label now
const youChipsEl = $("youChips");
const youCardsEl = $("youCards");
const playersEl = $("players");
const eventEl = $("event");
const showdownEl = $("showdown");

const startBtn = $("startBtn");
const copyInviteBtn = $("copyInvite");
const foldBtn = $("foldBtn");
const checkBtn = $("checkBtn");
const callBtn = $("callBtn");
const raiseToEl = $("raiseTo");
const raiseBtn = $("raiseBtn");
const allinBtn = $("allinBtn");

function storageKey() {
  return `chip-holdem:${code}:${nick.toLowerCase()}:playerKey`;
}

let playerKey = localStorage.getItem(storageKey()) || "";
let isHost = false;
let lastState = null;

function wsUrl() {
  const u = new URL(`/api/room/${code}/ws`, location.origin);
  u.searchParams.set("nick", nick);
  if (playerKey) u.searchParams.set("playerKey", playerKey);
  if (hostKey) u.searchParams.set("hostKey", hostKey);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

function parseCard(c) {
  if (!c || c.length < 2) return null;
  const rank = c[0].replace('T', '10');
  const suit = c[c.length - 1];
  const suitChar =
    suit === "S" ? "♠" : suit === "H" ? "♥" : suit === "D" ? "♦" : suit === "C" ? "♣" : "?";
  const color = suit === "H" || suit === "D" ? "red" : "black";
  return { rank, suit, suitChar, color };
}

function renderCards(el, cards, opts = {}) {
  const { backs = 0 } = opts;
  el.innerHTML = "";

  for (let i = 0; i < backs; i++) {
    const d = document.createElement("div");
    d.className = "card-unit back";
    el.appendChild(d);
  }

  for (const c of cards || []) {
    const info = parseCard(c);
    if (!info) continue;
    const d = document.createElement("div");
    d.className = `card-unit ${info.color}`;
    d.innerHTML = `
      <div class="card-rank">${info.rank}</div>
      <div class="card-lg-suit">${info.suitChar}</div>
      <div class="card-suit">${info.suitChar}</div>
    `;
    el.appendChild(d);
  }
}

function render(state) {
  lastState = state;
  roomBadge.textContent = `${state.room.code} · ${state.room.sb}/${state.room.bb}`;
  
  renderCards(boardCardsEl, state.game.board || []);
  potEl.textContent = state.game.pot ?? 0;
  curBetEl.textContent = state.game.currentBet ?? 0;

  // Render "My" section
  if (state.you) {
    // Avoid innerHTML (XSS + breaks references). Update text nodes in place.
    youEl.textContent = state.you.nick;
    if (youChipsEl) youChipsEl.textContent = `${state.you.chips} 🪙`;
    
    renderCards(youCardsEl, state.you.hole || [], { backs: (state.you.hole?.length ? 0 : 2) });
  } else {
    youEl.textContent = "-";
    if (youChipsEl) youChipsEl.textContent = "-";
    renderCards(youCardsEl, [], { backs: 2 });
  }

  eventEl.textContent = state.game.lastEvent || "Game ready";

  const canStart = state.isHost && state.game.phase === "waiting" && (state.players?.length ?? 0) >= 2;
  
  // Show start button only if host and waiting
  startBtn.style.display = (state.isHost && state.game.phase === "waiting") ? "block" : "none";
  startBtn.disabled = !canStart;
  startBtn.textContent = state.game.phase === "waiting" ? "Start Game" : "In Progress";

  const myTurn = state.players.some((p) => p.id === state.you?.id && p.isTurn);
  const inHand = !!state.you?.inHand && !state.you?.folded && state.game.phase !== "waiting";
  const canAct = myTurn && inHand && !state.you?.allIn;

  foldBtn.disabled = !canAct;
  checkBtn.disabled = !canAct;
  callBtn.disabled = !canAct;
  raiseBtn.disabled = !canAct;
  allinBtn.disabled = !canAct;

  // Dim buttons when not active
  const actionOp = canAct ? "1" : "0.5";
  [foldBtn, checkBtn, callBtn, raiseBtn, allinBtn].forEach(b => b.style.opacity = actionOp);

  raiseToEl.placeholder = `Min ${state.game.minRaiseTo ?? 0}`;

  // RENDER OTHER PLAYERS
  playersEl.innerHTML = "";
  const sd = state.game.lastShowdown;
  const revealed = sd?.revealed || {};
  
  // Filter out "You" from the opponents list to avoid duplication if desired, 
  // BUT visually it's often better to see everyone relative to the table. 
  // For now, we render everyone in the 'players-grid' for simplicity, 
  // but "you" is also anchored at the bottom. 
  // We will MARK "you" in the grid as hidden or highlighted.
  // Actually, let's just render OPPONENTS in the grid.
  
  const opponents = state.players.filter(p => p.id !== state.you?.id);
  
  for (const p of opponents) {
    const el = document.createElement("div");
    el.className = `player-node ${p.isTurn ? "active" : ""} ${p.folded ? "folded" : ""}`;

    // Avatar (First 2 chars of nick)
    const avatar = document.createElement("div");
    avatar.className = "player-avatar";
    avatar.textContent = p.nick.substring(0, 2).toUpperCase();
    if (p.isDealer) {
      const db = document.createElement("div");
      db.className = "dealer-btn";
      db.textContent = "D";
      el.appendChild(db);
    }
    el.appendChild(avatar);

    const name = document.createElement("div");
    name.className = "player-name";
    name.textContent = p.nick;
    el.appendChild(name);

    const chips = document.createElement("div");
    chips.className = "player-chips";
    chips.textContent = `${p.chips} 🪙`;
    el.appendChild(chips);
    
    // Status Pills/Text
    if (p.betThisRound > 0) {
      const bet = document.createElement("div");
      bet.style.fontSize = "11px";
      bet.style.color = "#99f6e4";
      bet.textContent = `Bet: ${p.betThisRound}`;
      el.appendChild(bet);
    }
    if (p.allIn) {
      const allin = document.createElement("div");
      allin.style.color = "#ef4444";
      allin.style.fontWeight = "bold";
      allin.style.fontSize = "11px";
      allin.textContent = "ALL IN";
      el.appendChild(allin);
    }

    // Cards
    const cardsWrap = document.createElement("div");
    cardsWrap.className = "player-cards";
    const rev = revealed[p.id];
    if (rev && Array.isArray(rev) && rev.length) {
      renderCards(cardsWrap, rev);
    } else if (p.inHand && !p.folded && state.game.phase !== "waiting") {
      renderCards(cardsWrap, [], { backs: 2 });
    }
    el.appendChild(cardsWrap);

    playersEl.appendChild(el);
  }

  // Showdown info
  showdownEl.textContent = "";
  if (sd) {
    if (sd.winners?.length) {
      showdownEl.textContent = `🏆 Winners: ${sd.winners.map((w) => `${w.nick} (+${w.amount})`).join(", ")}`;
    }
  }
}

let ws;
let reconnectTimer = null;

function connect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  ws = new WebSocket(wsUrl());

  ws.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "welcome") {
      isHost = !!msg.isHost;
      playerKey = msg.playerKey || playerKey;
      localStorage.setItem(storageKey(), playerKey);
      return;
    }
    if (msg.type === "error") {
      alert(msg.message || "error");
      return;
    }
    if (msg.type === "state") {
      render(msg.state);
      return;
    }
  });

  ws.addEventListener("close", () => {
    reconnectTimer = setTimeout(connect, 600);
  });
}

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

startBtn.addEventListener("click", () => {
  send({ type: "start_hand" });
});

copyInviteBtn.addEventListener("click", async () => {
  const u = new URL("/room.html", location.origin);
  u.searchParams.set("code", code);
  await navigator.clipboard.writeText(u.toString());
  copyInviteBtn.textContent = "Copied!";
  setTimeout(() => (copyInviteBtn.textContent = "Invite Link"), 1200);
});

foldBtn.addEventListener("click", () => send({ type: "action", action: "fold" }));
checkBtn.addEventListener("click", () => send({ type: "action", action: "check" }));
callBtn.addEventListener("click", () => send({ type: "action", action: "call" }));
allinBtn.addEventListener("click", () => send({ type: "action", action: "allin" }));
raiseBtn.addEventListener("click", () => {
  const raiseTo = Number(raiseToEl.value || 0);
  send({ type: "action", action: "raise", raiseTo });
});

connect();
