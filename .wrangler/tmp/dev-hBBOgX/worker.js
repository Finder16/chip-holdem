var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/room_do.ts
function normalizeNick(nick) {
  const trimmed = nick.trim();
  return trimmed.slice(0, 20);
}
__name(normalizeNick, "normalizeNick");
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
__name(jsonResponse, "jsonResponse");
function makeDeck() {
  const suits = ["S", "H", "D", "C"];
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  const deck = [];
  for (const r of ranks) for (const s of suits) deck.push(`${r}${s}`);
  return deck;
}
__name(makeDeck, "makeDeck");
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const b = new Uint32Array(1);
    crypto.getRandomValues(b);
    const j = b[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
__name(shuffle, "shuffle");
function rankValue(card) {
  const r = card[0];
  if (r === "A") return 14;
  if (r === "K") return 13;
  if (r === "Q") return 12;
  if (r === "J") return 11;
  if (r === "T") return 10;
  return Number(r);
}
__name(rankValue, "rankValue");
function suitValue(card) {
  return card[1];
}
__name(suitValue, "suitValue");
function compareLex(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}
__name(compareLex, "compareLex");
function best5of7(cards7) {
  let best = null;
  for (let a = 0; a < 7; a++) {
    for (let b = a + 1; b < 7; b++) {
      for (let c = b + 1; c < 7; c++) {
        for (let d = c + 1; d < 7; d++) {
          for (let e = d + 1; e < 7; e++) {
            const five = [cards7[a], cards7[b], cards7[c], cards7[d], cards7[e]];
            const r = rank5(five);
            if (!best) best = r;
            else if (r.cat !== best.cat ? r.cat > best.cat : compareLex(r.tiebreak, best.tiebreak) > 0) best = r;
          }
        }
      }
    }
  }
  return best ?? { cat: 0, tiebreak: [0] };
}
__name(best5of7, "best5of7");
function rank5(cards5) {
  const ranks = cards5.map(rankValue).sort((a, b) => b - a);
  const suits = cards5.map(suitValue);
  const isFlush = suits.every((s) => s === suits[0]);
  const uniq = Array.from(new Set(ranks)).sort((a, b) => b - a);
  let isStraight = false;
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) {
      isStraight = true;
      straightHigh = uniq[0];
    } else if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) {
      isStraight = true;
      straightHigh = 5;
    }
  }
  const counts = /* @__PURE__ */ new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const pattern = groups.map(([, c]) => c).join(",");
  if (isStraight && isFlush) return { cat: 8, tiebreak: [straightHigh] };
  if (pattern === "4,1") {
    const quad = groups[0][0];
    const kicker = groups[1][0];
    return { cat: 7, tiebreak: [quad, kicker] };
  }
  if (pattern === "3,2") {
    const trips = groups[0][0];
    const pair = groups[1][0];
    return { cat: 6, tiebreak: [trips, pair] };
  }
  if (isFlush) return { cat: 5, tiebreak: ranks };
  if (isStraight) return { cat: 4, tiebreak: [straightHigh] };
  if (pattern === "3,1,1") {
    const trips = groups[0][0];
    const kickers = groups.slice(1).map(([r]) => r).sort((a, b) => b - a);
    return { cat: 3, tiebreak: [trips, ...kickers] };
  }
  if (pattern === "2,2,1") {
    const p1 = groups[0][0];
    const p2 = groups[1][0];
    const hi = Math.max(p1, p2);
    const lo = Math.min(p1, p2);
    const kicker = groups[2][0];
    return { cat: 2, tiebreak: [hi, lo, kicker] };
  }
  if (pattern === "2,1,1,1") {
    const pair = groups[0][0];
    const kickers = groups.slice(1).map(([r]) => r).sort((a, b) => b - a);
    return { cat: 1, tiebreak: [pair, ...kickers] };
  }
  return { cat: 0, tiebreak: ranks };
}
__name(rank5, "rank5");
function nextSeatAfter(seat, seats) {
  const idx = seats.indexOf(seat);
  if (idx === -1) return seats[0];
  return seats[(idx + 1) % seats.length];
}
__name(nextSeatAfter, "nextSeatAfter");
function firstOccupiedSeat(players) {
  if (players.length === 0) return null;
  return players.map((p) => p.seat).sort((a, b) => a - b)[0] ?? null;
}
__name(firstOccupiedSeat, "firstOccupiedSeat");
var RoomDO = class {
  static {
    __name(this, "RoomDO");
  }
  state;
  config = null;
  players = [];
  game = null;
  sockets = /* @__PURE__ */ new Map();
  // connId -> socket
  connPlayer = /* @__PURE__ */ new Map();
  // connId -> playerId
  connIsHost = /* @__PURE__ */ new Map();
  // connId -> isHost
  constructor(state, _env) {
    this.state = state;
  }
  async load() {
    if (this.config && this.game) return;
    const [cfg, pls, g] = await Promise.all([
      this.state.storage.get("config"),
      this.state.storage.get("players"),
      this.state.storage.get("game")
    ]);
    this.config = cfg ?? null;
    this.players = (pls ?? []).map((p) => ({ ...p, ready: true }));
    this.game = g ?? {
      handNumber: 0,
      phase: "waiting",
      dealerSeat: null,
      sbSeat: null,
      bbSeat: null,
      turnSeat: null,
      deck: [],
      board: [],
      pot: 0,
      currentBet: 0,
      minRaiseTo: 0,
      acted: {}
    };
  }
  async persist() {
    await this.state.storage.put({
      config: this.config,
      players: this.players,
      game: this.game
    });
  }
  send(connId, msg) {
    const ws = this.sockets.get(connId);
    if (!ws) return;
    ws.send(JSON.stringify(msg));
  }
  broadcastState() {
    if (!this.config || !this.game) return;
    for (const [connId] of this.sockets) {
      const playerId = this.connPlayer.get(connId) ?? null;
      const isHost = this.connIsHost.get(connId) ?? false;
      this.send(connId, { type: "state", state: this.viewFor(playerId, isHost) });
    }
  }
  viewFor(playerId, isHost) {
    if (!this.config || !this.game) return { ok: false };
    const me = playerId ? this.players.find((p) => p.id === playerId) ?? null : null;
    const players = this.players.slice().sort((a, b) => a.seat - b.seat).map((p) => ({
      id: p.id,
      nick: p.nick,
      seat: p.seat,
      chips: p.chips,
      ready: p.ready,
      connected: p.connected,
      inHand: p.inHand,
      folded: p.folded,
      allIn: p.allIn,
      betThisRound: p.betThisRound,
      committed: p.committed,
      isDealer: this.game.dealerSeat === p.seat,
      isSB: this.game.sbSeat === p.seat,
      isBB: this.game.bbSeat === p.seat,
      isTurn: this.game.turnSeat === p.seat
    }));
    const revealed = {};
    if (this.game.lastShowdown?.revealed) Object.assign(revealed, this.game.lastShowdown.revealed);
    return {
      ok: true,
      room: {
        code: this.config.code,
        maxPlayers: this.config.maxPlayers,
        startingChips: this.config.startingChips,
        sb: this.config.sb,
        bb: this.config.bb
      },
      you: me ? {
        id: me.id,
        nick: me.nick,
        seat: me.seat,
        chips: me.chips,
        ready: me.ready,
        connected: me.connected,
        inHand: me.inHand,
        folded: me.folded,
        allIn: me.allIn,
        betThisRound: me.betThisRound,
        committed: me.committed,
        hole: me.hole
      } : null,
      isHost,
      players,
      game: {
        handNumber: this.game.handNumber,
        phase: this.game.phase,
        dealerSeat: this.game.dealerSeat,
        sbSeat: this.game.sbSeat,
        bbSeat: this.game.bbSeat,
        turnSeat: this.game.turnSeat,
        board: this.game.board,
        pot: this.game.pot,
        currentBet: this.game.currentBet,
        minRaiseTo: this.game.minRaiseTo,
        lastEvent: this.game.lastEvent ?? null,
        lastShowdown: this.game.lastShowdown ?? null,
        revealed
      }
    };
  }
  error(connId, message) {
    this.send(connId, { type: "error", message });
  }
  seatsTaken() {
    return new Set(this.players.map((p) => p.seat));
  }
  allocSeat() {
    if (!this.config) return null;
    const taken = this.seatsTaken();
    for (let s = 1; s <= this.config.maxPlayers; s++) if (!taken.has(s)) return s;
    return null;
  }
  activeInHandPlayers() {
    return this.players.filter((p) => p.inHand && !p.folded);
  }
  eligibleToActPlayers() {
    return this.players.filter((p) => p.inHand && !p.folded && !p.allIn);
  }
  seatsInHandSorted() {
    return this.players.filter((p) => p.inHand && !p.folded).map((p) => p.seat).sort((a, b) => a - b);
  }
  seatToPlayer(seat) {
    return this.players.find((p) => p.seat === seat) ?? null;
  }
  nextToActFrom(seat) {
    const seats = this.seatsInHandSorted();
    if (seats.length === 0) return null;
    let cur = seat;
    for (let i = 0; i < seats.length; i++) {
      cur = nextSeatAfter(cur, seats);
      const p = this.seatToPlayer(cur);
      if (!p) continue;
      if (p.inHand && !p.folded && !p.allIn) return cur;
    }
    return null;
  }
  firstToActPreflop() {
    if (!this.game || !this.game.bbSeat || !this.game.dealerSeat) return null;
    const activeSeats = this.seatsInHandSorted();
    if (activeSeats.length === 2) {
      return this.game.dealerSeat;
    }
    return this.nextToActFrom(this.game.bbSeat) ?? null;
  }
  firstToActPostflop() {
    if (!this.game || !this.game.dealerSeat || !this.game.bbSeat) return null;
    const activeSeats = this.seatsInHandSorted();
    if (activeSeats.length === 2) {
      return this.game.bbSeat;
    }
    return this.nextToActFrom(this.game.dealerSeat) ?? null;
  }
  startHand() {
    if (!this.config || !this.game) return;
    const eligible = this.players.filter((p) => p.chips > 0);
    if (eligible.length < 2) {
      this.game.lastEvent = "Need at least 2 players with chips.";
      return;
    }
    for (const p of this.players) {
      const inHand = p.chips > 0;
      p.inHand = inHand;
      p.folded = false;
      p.allIn = false;
      p.hole = [];
      p.betThisRound = 0;
      p.committed = 0;
    }
    const seats = this.players.filter((p) => p.inHand).map((p) => p.seat).sort((a, b) => a - b);
    if (seats.length < 2) {
      this.game.lastEvent = "Need at least 2 players.";
      return;
    }
    if (this.game.dealerSeat == null) {
      this.game.dealerSeat = firstOccupiedSeat(this.players.filter((p) => p.inHand));
    } else {
      this.game.dealerSeat = nextSeatAfter(this.game.dealerSeat, seats);
    }
    const dealer = this.game.dealerSeat;
    const sbSeat = nextSeatAfter(dealer, seats);
    const bbSeat = nextSeatAfter(sbSeat, seats);
    this.game.sbSeat = sbSeat;
    this.game.bbSeat = bbSeat;
    const deck = makeDeck();
    shuffle(deck);
    this.game.deck = deck;
    this.game.board = [];
    this.game.pot = 0;
    this.game.currentBet = 0;
    this.game.minRaiseTo = this.config.bb;
    this.game.acted = {};
    this.game.lastShowdown = void 0;
    for (let i = 0; i < 2; i++) {
      for (const seat of seats) {
        const p = this.seatToPlayer(seat);
        p.hole.push(this.game.deck.pop());
      }
    }
    const sbP = this.seatToPlayer(sbSeat);
    const bbP = this.seatToPlayer(bbSeat);
    const sbAmt = Math.min(sbP.chips, this.config.sb);
    const bbAmt = Math.min(bbP.chips, this.config.bb);
    sbP.chips -= sbAmt;
    sbP.betThisRound += sbAmt;
    sbP.committed += sbAmt;
    if (sbP.chips === 0) sbP.allIn = true;
    bbP.chips -= bbAmt;
    bbP.betThisRound += bbAmt;
    bbP.committed += bbAmt;
    if (bbP.chips === 0) bbP.allIn = true;
    this.game.pot = sbAmt + bbAmt;
    this.game.currentBet = Math.max(sbP.betThisRound, bbP.betThisRound);
    this.game.minRaiseTo = this.game.currentBet + this.config.bb;
    this.game.phase = "preflop";
    this.game.handNumber += 1;
    this.game.lastEvent = `Hand #${this.game.handNumber} started. Blinds posted.`;
    this.game.turnSeat = this.firstToActPreflop();
    if (!this.game.turnSeat) this.fastForwardIfAllIn();
  }
  onlyOneLeft() {
    const alive = this.players.filter((p) => p.inHand && !p.folded);
    return alive.length === 1 ? alive[0] : null;
  }
  finishHandSingleWinner(winner, reason) {
    if (!this.game) return;
    const winAmt = this.game.pot;
    winner.chips += winAmt;
    this.game.lastEvent = `${winner.nick} wins ${winAmt} (${reason}).`;
    this.game.lastShowdown = {
      board: this.game.board,
      winners: [{ playerId: winner.id, nick: winner.nick, amount: winAmt }],
      revealed: {}
    };
    this.game.phase = "waiting";
    this.game.turnSeat = null;
  }
  resetStreetForNext(phase) {
    if (!this.game || !this.config) return;
    for (const p of this.players) if (p.inHand && !p.folded) p.betThisRound = 0;
    this.game.currentBet = 0;
    this.game.minRaiseTo = this.config.bb;
    this.game.acted = {};
    this.game.phase = phase;
    this.game.turnSeat = this.firstToActPostflop();
    if (!this.game.turnSeat) this.fastForwardIfAllIn();
  }
  maybeAdvanceRound() {
    if (!this.game) return;
    const sole = this.onlyOneLeft();
    if (sole) {
      this.finishHandSingleWinner(sole, "everyone else folded");
      return;
    }
    if (this.game.phase === "waiting" || this.game.phase === "showdown") return;
    const elig = this.eligibleToActPlayers();
    for (const p of elig) {
      if (!this.game.acted[p.id]) return;
      if (p.betThisRound !== this.game.currentBet) return;
    }
    if (this.game.phase === "preflop") {
      this.game.board.push(this.game.deck.pop(), this.game.deck.pop(), this.game.deck.pop());
      this.game.lastEvent = "Flop dealt.";
      this.resetStreetForNext("flop");
      return;
    }
    if (this.game.phase === "flop") {
      this.game.board.push(this.game.deck.pop());
      this.game.lastEvent = "Turn dealt.";
      this.resetStreetForNext("turn");
      return;
    }
    if (this.game.phase === "turn") {
      this.game.board.push(this.game.deck.pop());
      this.game.lastEvent = "River dealt.";
      this.resetStreetForNext("river");
      return;
    }
    if (this.game.phase === "river") {
      this.game.lastEvent = "Showdown.";
      this.doShowdown();
      return;
    }
  }
  doShowdown() {
    if (!this.game) return;
    const inShowdown = this.players.filter((p) => p.inHand && !p.folded);
    const revealed = {};
    for (const p of inShowdown) revealed[p.id] = p.hole.slice();
    const contributors = this.players.filter((p) => p.inHand && p.committed > 0);
    const tiers = Array.from(new Set(contributors.map((p) => p.committed))).sort((a, b) => a - b);
    const payouts = /* @__PURE__ */ new Map();
    let prev = 0;
    for (const tier of tiers) {
      const involved = contributors.filter((p) => p.committed >= tier);
      const potSize = (tier - prev) * involved.length;
      prev = tier;
      const eligible = involved.filter((p) => !p.folded);
      if (eligible.length === 0) continue;
      let best = null;
      let winners = [];
      for (const p of eligible) {
        const rank = best5of7([...p.hole, ...this.game.board]);
        if (!best) {
          best = rank;
          winners = [p];
          continue;
        }
        const cmp = rank.cat !== best.cat ? rank.cat > best.cat ? 1 : -1 : compareLex(rank.tiebreak, best.tiebreak);
        if (cmp > 0) {
          best = rank;
          winners = [p];
        } else if (cmp === 0) {
          winners.push(p);
        }
      }
      const share = Math.floor(potSize / winners.length);
      let remainder = potSize - share * winners.length;
      const bySeat = winners.slice().sort((a, b) => a.seat - b.seat);
      for (const w of bySeat) {
        let amt = share;
        if (remainder > 0) {
          amt += 1;
          remainder -= 1;
        }
        payouts.set(w.id, (payouts.get(w.id) ?? 0) + amt);
      }
    }
    const winnersOut = [];
    for (const [pid, amt] of payouts) {
      const p = this.players.find((x) => x.id === pid);
      if (!p) continue;
      p.chips += amt;
      winnersOut.push({ playerId: pid, nick: p.nick, amount: amt });
    }
    this.game.lastShowdown = { board: this.game.board.slice(), winners: winnersOut, revealed };
    this.game.phase = "waiting";
    this.game.turnSeat = null;
  }
  currentPlayer() {
    if (!this.game?.turnSeat) return null;
    return this.seatToPlayer(this.game.turnSeat);
  }
  applyAction(playerId, msg) {
    if (!this.config || !this.game) return "Room not initialized";
    if (this.game.phase === "waiting" || this.game.phase === "showdown") return "No active hand";
    const actor = this.players.find((p) => p.id === playerId);
    if (!actor) return "Unknown player";
    if (!actor.inHand || actor.folded) return "Not in hand";
    if (actor.allIn) return "You are all-in";
    if (this.game.turnSeat !== actor.seat) return "Not your turn";
    const toCall = Math.max(0, this.game.currentBet - actor.betThisRound);
    const act = msg.action;
    if (act === "fold") {
      actor.folded = true;
      this.game.acted[actor.id] = true;
      this.game.lastEvent = `${actor.nick} folds.`;
    } else if (act === "check") {
      if (toCall !== 0) return "Cannot check (need to call)";
      this.game.acted[actor.id] = true;
      this.game.lastEvent = `${actor.nick} checks.`;
    } else if (act === "call") {
      const pay = Math.min(actor.chips, toCall);
      actor.chips -= pay;
      actor.betThisRound += pay;
      actor.committed += pay;
      this.game.pot += pay;
      if (actor.chips === 0) actor.allIn = true;
      this.game.acted[actor.id] = true;
      this.game.lastEvent = `${actor.nick} calls ${pay}.`;
    } else if (act === "allin") {
      const pay = actor.chips;
      if (pay <= 0) return "No chips";
      actor.chips = 0;
      actor.betThisRound += pay;
      actor.committed += pay;
      this.game.pot += pay;
      actor.allIn = true;
      if (actor.betThisRound > this.game.currentBet) {
        this.game.currentBet = actor.betThisRound;
        this.game.minRaiseTo = this.game.currentBet + this.config.bb;
        this.game.acted = {};
      }
      this.game.acted[actor.id] = true;
      this.game.lastEvent = `${actor.nick} goes all-in (${pay}).`;
    } else if (act === "raise") {
      const raiseTo = Math.trunc(msg.raiseTo ?? 0);
      if (!(raiseTo > this.game.currentBet)) return "raiseTo must be > currentBet";
      if (raiseTo < this.game.minRaiseTo) return `Min raiseTo is ${this.game.minRaiseTo}`;
      const needed = raiseTo - actor.betThisRound;
      if (needed <= 0) return "Invalid raise";
      if (needed > actor.chips) return "Not enough chips (use all-in)";
      actor.chips -= needed;
      actor.betThisRound += needed;
      actor.committed += needed;
      this.game.pot += needed;
      this.game.currentBet = raiseTo;
      this.game.minRaiseTo = raiseTo + this.config.bb;
      this.game.acted = {};
      this.game.acted[actor.id] = true;
      this.game.lastEvent = `${actor.nick} raises to ${raiseTo}.`;
    } else {
      return "Unknown action";
    }
    const sole = this.onlyOneLeft();
    if (sole) {
      this.finishHandSingleWinner(sole, "everyone else folded");
      return null;
    }
    const next = this.nextToActFrom(actor.seat);
    this.game.turnSeat = next;
    if (!this.game.turnSeat) {
      this.fastForwardIfAllIn();
      return null;
    }
    this.maybeAdvanceRound();
    return null;
  }
  fastForwardIfAllIn() {
    if (!this.game) return;
    if (this.eligibleToActPlayers().length !== 0) return;
    if (this.onlyOneLeft()) return;
    while (this.game.board.length < 5) this.game.board.push(this.game.deck.pop());
    this.game.lastEvent = "All-in. Dealing out the board.";
    this.doShowdown();
  }
  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    if (url.pathname.endsWith("/init") && request.method === "POST") {
      if (this.config) return jsonResponse({ ok: false, error: "Already initialized" }, 409);
      const body = await request.json();
      if (!body.code || !body.hostKey) return jsonResponse({ ok: false, error: "Missing fields" }, 400);
      this.config = {
        code: String(body.code).toUpperCase(),
        maxPlayers: Number(body.maxPlayers ?? 8),
        startingChips: Number(body.startingChips ?? 1e4),
        sb: Number(body.sb ?? 50),
        bb: Number(body.bb ?? 100),
        hostKey: String(body.hostKey)
      };
      await this.persist();
      return jsonResponse({ ok: true });
    }
    if (url.pathname.endsWith("/ws")) {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
      if (!this.config) return new Response("Room not initialized", { status: 404 });
      const nickRaw = url.searchParams.get("nick") ?? "";
      const nick = normalizeNick(nickRaw);
      if (!nick) return new Response("Missing nick", { status: 400 });
      const providedKey = url.searchParams.get("playerKey") ?? "";
      const providedHostKey = url.searchParams.get("hostKey") ?? "";
      const isHost = providedHostKey && providedHostKey === this.config.hostKey;
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      const connId = crypto.randomUUID();
      this.sockets.set(connId, server);
      this.connIsHost.set(connId, isHost);
      let player = null;
      if (providedKey) {
        player = this.players.find((p) => p.key === providedKey) ?? null;
      }
      if (!player) {
        if (this.players.some((p) => p.nick.toLowerCase() === nick.toLowerCase())) {
          server.send(JSON.stringify({ type: "error", message: "Nick already taken in this room." }));
          server.close(1008, "Nick taken");
          return new Response(null, { status: 101, webSocket: client });
        }
        const seat = this.allocSeat();
        if (!seat) {
          server.send(JSON.stringify({ type: "error", message: "Room is full." }));
          server.close(1008, "Room full");
          return new Response(null, { status: 101, webSocket: client });
        }
        player = {
          id: crypto.randomUUID(),
          key: crypto.randomUUID(),
          nick,
          seat,
          chips: this.config.startingChips,
          ready: true,
          connected: true,
          inHand: false,
          folded: false,
          allIn: false,
          hole: [],
          betThisRound: 0,
          committed: 0
        };
        this.players.push(player);
      } else {
        player.connected = true;
      }
      this.connPlayer.set(connId, player.id);
      await this.persist();
      server.send(
        JSON.stringify({
          type: "welcome",
          roomCode: this.config.code,
          playerId: player.id,
          playerKey: player.key,
          isHost,
          startingChips: this.config.startingChips
        })
      );
      this.broadcastState();
      server.addEventListener("message", async (ev) => {
        const pid = this.connPlayer.get(connId);
        if (!pid) return;
        let data;
        try {
          data = JSON.parse(String(ev.data));
        } catch {
          this.error(connId, "Bad JSON");
          return;
        }
        await this.load();
        if (data.type === "start_hand") {
          const host = this.connIsHost.get(connId) ?? false;
          if (!host) {
            this.error(connId, "Host only");
            return;
          }
          if (this.game.phase !== "waiting") {
            this.error(connId, "Hand already running");
            return;
          }
          this.startHand();
          await this.persist();
          this.broadcastState();
          return;
        }
        if (data.type === "action") {
          const err = this.applyAction(pid, data);
          if (err) this.error(connId, err);
          await this.persist();
          this.broadcastState();
          return;
        }
      });
      server.addEventListener("close", async () => {
        this.sockets.delete(connId);
        this.connIsHost.delete(connId);
        const pid = this.connPlayer.get(connId);
        this.connPlayer.delete(connId);
        if (pid) {
          const p = this.players.find((x) => x.id === pid);
          if (p) p.connected = false;
          await this.persist();
          this.broadcastState();
        }
      });
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname.endsWith("/debug") && request.method === "GET") {
      return jsonResponse({ ok: true, config: this.config, players: this.players, game: this.game });
    }
    return new Response("Not found", { status: 404 });
  }
};

// src/worker.ts
function json(data, init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}
__name(json, "json");
function badRequest(message, extra) {
  return json({ ok: false, error: message, ...extra ?? {} }, { status: 400 });
}
__name(badRequest, "badRequest");
function generateCode(len = 5) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
__name(generateCode, "generateCode");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({ ok: true });
    }
    if (url.pathname === "/api/create" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest("Invalid JSON");
      }
      const maxPlayers = Math.trunc(body.maxPlayers ?? 8);
      const sb = Math.trunc(body.sb ?? 50);
      const bb = Math.trunc(body.bb ?? 100);
      const startingChips = 1e4;
      if (!(maxPlayers >= 2 && maxPlayers <= 8)) return badRequest("maxPlayers must be 2..8");
      if (!(sb >= 1 && bb >= 2 && bb > sb)) return badRequest("blinds must satisfy 1 <= sb < bb");
      if (startingChips < bb * 10) return badRequest("startingChips too low for blinds");
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateCode(5);
        const hostKey = crypto.randomUUID();
        const id = env.ROOMS.idFromName(code);
        const stub = env.ROOMS.get(id);
        const initResp = await stub.fetch("https://room/init", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, maxPlayers, startingChips, sb, bb, hostKey })
        });
        if (initResp.status === 409) continue;
        if (!initResp.ok) {
          const text = await initResp.text();
          return json({ ok: false, error: "Room init failed", details: text }, { status: 500 });
        }
        return json({ ok: true, code, hostKey, maxPlayers, startingChips, sb, bb });
      }
      return json({ ok: false, error: "Failed to allocate room code. Retry." }, { status: 500 });
    }
    if (url.pathname.startsWith("/api/room/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const code = (parts[2] ?? "").toUpperCase();
      if (!code) return badRequest("Missing room code");
      const id = env.ROOMS.idFromName(code);
      const stub = env.ROOMS.get(id);
      return stub.fetch(request);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-iGVw6g/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-iGVw6g/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  RoomDO,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
