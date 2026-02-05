type Suit = "S" | "H" | "D" | "C";
type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; // 11=J, 12=Q, 13=K, 14=A
type Card = `${string}${Suit}`; // e.g. "AS", "TD"

type RoomConfig = {
  code: string;
  maxPlayers: number;
  startingChips: number;
  sb: number;
  bb: number;
  hostKey: string;
};

type Player = {
  id: string;
  key: string; // reconnect token
  nick: string;
  seat: number;
  chips: number;
  // MVP: everyone is auto-ready on join (no sit-out toggle).
  ready: boolean;
  connected: boolean;

  // Per-hand state
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  hole: Card[]; // only sent to owner (or at showdown if revealed)
  betThisRound: number;
  committed: number; // total committed this hand
};

type Phase = "waiting" | "preflop" | "flop" | "turn" | "river" | "showdown";

type GameState = {
  handNumber: number;
  phase: Phase;
  dealerSeat: number | null;
  sbSeat: number | null;
  bbSeat: number | null;
  turnSeat: number | null;

  deck: Card[];
  board: Card[];

  pot: number;
  currentBet: number;
  minRaiseTo: number;
  acted: Record<string, boolean>; // playerId -> acted this round

  // For UI
  lastEvent?: string;
  lastShowdown?: {
    board: Card[];
    winners: Array<{ playerId: string; nick: string; amount: number }>;
    revealed: Record<string, Card[]>;
  };
};

type ClientToServer =
  | { type: "start_hand" }
  | { type: "action"; action: "fold" | "check" | "call" | "raise" | "allin"; raiseTo?: number };

type ServerToClient =
  | { type: "welcome"; roomCode: string; playerId: string; playerKey: string; isHost: boolean; startingChips: number }
  | { type: "error"; message: string }
  | { type: "state"; state: unknown };

function normalizeNick(nick: string): string {
  const trimmed = nick.trim();
  // Keep it permissive, but avoid weirdly long strings.
  return trimmed.slice(0, 20);
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function makeDeck(): Card[] {
  const suits: Suit[] = ["S", "H", "D", "C"];
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  const deck: Card[] = [];
  for (const r of ranks) for (const s of suits) deck.push(`${r}${s}` as Card);
  return deck;
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const b = new Uint32Array(1);
    crypto.getRandomValues(b);
    const j = b[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function rankValue(card: Card): Rank {
  const r = card[0];
  if (r === "A") return 14;
  if (r === "K") return 13;
  if (r === "Q") return 12;
  if (r === "J") return 11;
  if (r === "T") return 10;
  return Number(r) as Rank;
}

function suitValue(card: Card): Suit {
  return card[1] as Suit;
}

function compareLex(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

// Category: 8=straight flush, 7=quads, 6=full house, 5=flush, 4=straight, 3=trips, 2=two pair, 1=pair, 0=high card
type HandRank = { cat: number; tiebreak: number[] };

function best5of7(cards7: Card[]): HandRank {
  // brute force 21 combos
  let best: HandRank | null = null;
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

function rank5(cards5: Card[]): HandRank {
  const ranks = cards5.map(rankValue).sort((a, b) => b - a);
  const suits = cards5.map(suitValue);
  const isFlush = suits.every((s) => s === suits[0]);

  // straight detection (including wheel A-5)
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

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = Array.from(counts.entries()).sort((a, b) => (b[1] - a[1]) || (b[0] - a[0])); // by count then rank
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

function nextSeatAfter(seat: number, seats: number[]): number {
  const idx = seats.indexOf(seat);
  if (idx === -1) return seats[0];
  return seats[(idx + 1) % seats.length];
}

function firstOccupiedSeat(players: Player[]): number | null {
  if (players.length === 0) return null;
  return players.map((p) => p.seat).sort((a, b) => a - b)[0] ?? null;
}

export class RoomDO implements DurableObject {
  private state: DurableObjectState;
  private config: RoomConfig | null = null;
  private players: Player[] = [];
  private game: GameState | null = null;

  private sockets = new Map<string, WebSocket>(); // connId -> socket
  private connPlayer = new Map<string, string>(); // connId -> playerId
  private connIsHost = new Map<string, boolean>(); // connId -> isHost

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  private async load(): Promise<void> {
    if (this.config && this.game) return;
    const [cfg, pls, g] = await Promise.all([
      this.state.storage.get<RoomConfig>("config"),
      this.state.storage.get<Player[]>("players"),
      this.state.storage.get<GameState>("game"),
    ]);
    this.config = cfg ?? null;
    this.players = (pls ?? []).map((p) => ({ ...p, ready: true }));
    this.game =
      g ??
      ({
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
        acted: {},
      } satisfies GameState);
  }

  private async persist(): Promise<void> {
    await this.state.storage.put({
      config: this.config,
      players: this.players,
      game: this.game,
    });
  }

  private send(connId: string, msg: ServerToClient): void {
    const ws = this.sockets.get(connId);
    if (!ws) return;
    ws.send(JSON.stringify(msg));
  }

  private broadcastState(): void {
    if (!this.config || !this.game) return;
    for (const [connId] of this.sockets) {
      const playerId = this.connPlayer.get(connId) ?? null;
      const isHost = this.connIsHost.get(connId) ?? false;
      this.send(connId, { type: "state", state: this.viewFor(playerId, isHost) });
    }
  }

  private viewFor(playerId: string | null, isHost: boolean): unknown {
    if (!this.config || !this.game) return { ok: false };
    const me = playerId ? this.players.find((p) => p.id === playerId) ?? null : null;

    const players = this.players
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
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
        isDealer: this.game!.dealerSeat === p.seat,
        isSB: this.game!.sbSeat === p.seat,
        isBB: this.game!.bbSeat === p.seat,
        isTurn: this.game!.turnSeat === p.seat,
      }));

    const revealed: Record<string, Card[]> = {};
    if (this.game.lastShowdown?.revealed) Object.assign(revealed, this.game.lastShowdown.revealed);

    return {
      ok: true,
      room: {
        code: this.config.code,
        maxPlayers: this.config.maxPlayers,
        startingChips: this.config.startingChips,
        sb: this.config.sb,
        bb: this.config.bb,
      },
      you: me
        ? {
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
            hole: me.hole,
          }
        : null,
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
        revealed,
      },
    };
  }

  private error(connId: string, message: string): void {
    this.send(connId, { type: "error", message });
  }

  private seatsTaken(): Set<number> {
    return new Set(this.players.map((p) => p.seat));
  }

  private allocSeat(): number | null {
    if (!this.config) return null;
    const taken = this.seatsTaken();
    for (let s = 1; s <= this.config.maxPlayers; s++) if (!taken.has(s)) return s;
    return null;
  }

  private activeInHandPlayers(): Player[] {
    return this.players.filter((p) => p.inHand && !p.folded);
  }

  private eligibleToActPlayers(): Player[] {
    return this.players.filter((p) => p.inHand && !p.folded && !p.allIn);
  }

  private seatsInHandSorted(): number[] {
    return this.players
      .filter((p) => p.inHand && !p.folded)
      .map((p) => p.seat)
      .sort((a, b) => a - b);
  }

  private seatToPlayer(seat: number): Player | null {
    return this.players.find((p) => p.seat === seat) ?? null;
  }

  private nextToActFrom(seat: number): number | null {
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

  private firstToActPreflop(): number | null {
    if (!this.game || !this.game.bbSeat || !this.game.dealerSeat) return null;
    const activeSeats = this.seatsInHandSorted();
    if (activeSeats.length === 2) {
      // Heads-up: dealer is SB and acts first preflop.
      return this.game.dealerSeat;
    }
    return this.nextToActFrom(this.game.bbSeat) ?? null;
  }

  private firstToActPostflop(): number | null {
    if (!this.game || !this.game.dealerSeat || !this.game.bbSeat) return null;
    const activeSeats = this.seatsInHandSorted();
    if (activeSeats.length === 2) {
      // Heads-up: BB acts first postflop.
      return this.game.bbSeat;
    }
    // First seat after dealer.
    return this.nextToActFrom(this.game.dealerSeat) ?? null;
  }

  private startHand(): void {
    if (!this.config || !this.game) return;
    const eligible = this.players.filter((p) => p.chips > 0);
    if (eligible.length < 2) {
      this.game.lastEvent = "Need at least 2 players with chips.";
      return;
    }

    // Mark per-hand state
    for (const p of this.players) {
      const inHand = p.chips > 0;
      p.inHand = inHand;
      p.folded = false;
      p.allIn = false;
      p.hole = [];
      p.betThisRound = 0;
      p.committed = 0;
    }

    const seats = this.players
      .filter((p) => p.inHand)
      .map((p) => p.seat)
      .sort((a, b) => a - b);

    if (seats.length < 2) {
      this.game.lastEvent = "Need at least 2 players.";
      return;
    }

    // Advance dealer
    if (this.game.dealerSeat == null) {
      this.game.dealerSeat = firstOccupiedSeat(this.players.filter((p) => p.inHand));
    } else {
      this.game.dealerSeat = nextSeatAfter(this.game.dealerSeat, seats);
    }

    // SB/BB
    const dealer = this.game.dealerSeat!;
    const sbSeat = nextSeatAfter(dealer, seats);
    const bbSeat = nextSeatAfter(sbSeat, seats);
    this.game.sbSeat = sbSeat;
    this.game.bbSeat = bbSeat;

    // Fresh deck
    const deck = makeDeck();
    shuffle(deck);
    this.game.deck = deck;
    this.game.board = [];
    this.game.pot = 0;
    this.game.currentBet = 0;
    this.game.minRaiseTo = this.config.bb;
    this.game.acted = {};
    this.game.lastShowdown = undefined;

    // Deal hole cards (2 each)
    for (let i = 0; i < 2; i++) {
      for (const seat of seats) {
        const p = this.seatToPlayer(seat)!;
        p.hole.push(this.game.deck.pop()!);
      }
    }

    // Post blinds
    const sbP = this.seatToPlayer(sbSeat)!;
    const bbP = this.seatToPlayer(bbSeat)!;
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

    // Who acts first
    this.game.turnSeat = this.firstToActPreflop();
    if (!this.game.turnSeat) this.fastForwardIfAllIn();
  }

  private onlyOneLeft(): Player | null {
    const alive = this.players.filter((p) => p.inHand && !p.folded);
    return alive.length === 1 ? alive[0] : null;
  }

  private finishHandSingleWinner(winner: Player, reason: string): void {
    if (!this.game) return;
    const winAmt = this.game.pot;
    winner.chips += winAmt;
    this.game.lastEvent = `${winner.nick} wins ${winAmt} (${reason}).`;
    this.game.lastShowdown = {
      board: this.game.board,
      winners: [{ playerId: winner.id, nick: winner.nick, amount: winAmt }],
      revealed: {},
    };
    this.game.phase = "waiting";
    this.game.turnSeat = null;
  }

  private resetStreetForNext(phase: Phase): void {
    if (!this.game || !this.config) return;
    for (const p of this.players) if (p.inHand && !p.folded) p.betThisRound = 0;
    this.game.currentBet = 0;
    this.game.minRaiseTo = this.config.bb;
    this.game.acted = {};
    this.game.phase = phase;
    this.game.turnSeat = this.firstToActPostflop();
    if (!this.game.turnSeat) this.fastForwardIfAllIn();
  }

  private maybeAdvanceRound(): void {
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

    // Betting round complete
    if (this.game.phase === "preflop") {
      this.game.board.push(this.game.deck.pop()!, this.game.deck.pop()!, this.game.deck.pop()!);
      this.game.lastEvent = "Flop dealt.";
      this.resetStreetForNext("flop");
      return;
    }
    if (this.game.phase === "flop") {
      this.game.board.push(this.game.deck.pop()!);
      this.game.lastEvent = "Turn dealt.";
      this.resetStreetForNext("turn");
      return;
    }
    if (this.game.phase === "turn") {
      this.game.board.push(this.game.deck.pop()!);
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

  private doShowdown(): void {
    if (!this.game) return;
    const inShowdown = this.players.filter((p) => p.inHand && !p.folded);
    const revealed: Record<string, Card[]> = {};
    for (const p of inShowdown) revealed[p.id] = p.hole.slice();

    // Side pots based on committed amounts for *all* players (including folded), but eligibility excludes folded.
    const contributors = this.players.filter((p) => p.inHand && p.committed > 0);
    const tiers = Array.from(new Set(contributors.map((p) => p.committed))).sort((a, b) => a - b);

    const payouts = new Map<string, number>();
    let prev = 0;

    for (const tier of tiers) {
      const involved = contributors.filter((p) => p.committed >= tier);
      const potSize = (tier - prev) * involved.length;
      prev = tier;

      const eligible = involved.filter((p) => !p.folded);
      if (eligible.length === 0) continue;

      // Determine winners for this pot.
      let best: HandRank | null = null;
      let winners: Player[] = [];
      for (const p of eligible) {
        const rank = best5of7([...p.hole, ...this.game.board]);
        if (!best) {
          best = rank;
          winners = [p];
          continue;
        }
        const cmp = rank.cat !== best.cat ? (rank.cat > best.cat ? 1 : -1) : compareLex(rank.tiebreak, best.tiebreak);
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

    const winnersOut: Array<{ playerId: string; nick: string; amount: number }> = [];
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

  private currentPlayer(): Player | null {
    if (!this.game?.turnSeat) return null;
    return this.seatToPlayer(this.game.turnSeat);
  }

  private applyAction(playerId: string, msg: Extract<ClientToServer, { type: "action" }>): string | null {
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
      this.game.acted = {}; // new betting "cycle"
      this.game.acted[actor.id] = true;
      this.game.lastEvent = `${actor.nick} raises to ${raiseTo}.`;
    } else {
      return "Unknown action";
    }

    // Next turn (or end)
    const sole = this.onlyOneLeft();
    if (sole) {
      this.finishHandSingleWinner(sole, "everyone else folded");
      return null;
    }

    const next = this.nextToActFrom(actor.seat);
    this.game.turnSeat = next;

    // If nobody can act (everyone all-in), fast-forward streets to showdown.
    if (!this.game.turnSeat) {
      this.fastForwardIfAllIn();
      return null;
    }

    this.maybeAdvanceRound();
    return null;
  }

  private fastForwardIfAllIn(): void {
    if (!this.game) return;
    if (this.eligibleToActPlayers().length !== 0) return;
    if (this.onlyOneLeft()) return;

    // Deal remaining streets to 5 board cards.
    while (this.game.board.length < 5) this.game.board.push(this.game.deck.pop()!);
    this.game.lastEvent = "All-in. Dealing out the board.";
    this.doShowdown();
  }

  async fetch(request: Request): Promise<Response> {
    await this.load();
    const url = new URL(request.url);

    if (url.pathname.endsWith("/init") && request.method === "POST") {
      if (this.config) return jsonResponse({ ok: false, error: "Already initialized" }, 409);
      const body = (await request.json()) as Partial<RoomConfig>;
      if (!body.code || !body.hostKey) return jsonResponse({ ok: false, error: "Missing fields" }, 400);
      this.config = {
        code: String(body.code).toUpperCase(),
        maxPlayers: Number(body.maxPlayers ?? 8),
        startingChips: Number(body.startingChips ?? 10_000),
        sb: Number(body.sb ?? 50),
        bb: Number(body.bb ?? 100),
        hostKey: String(body.hostKey),
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
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      server.accept();
      const connId = crypto.randomUUID();
      this.sockets.set(connId, server);
      this.connIsHost.set(connId, isHost);

      let player: Player | null = null;
      if (providedKey) {
        player = this.players.find((p) => p.key === providedKey) ?? null;
      }
      if (!player) {
        if (this.players.some((p) => p.nick.toLowerCase() === nick.toLowerCase())) {
          server.send(JSON.stringify({ type: "error", message: "Nick already taken in this room." } satisfies ServerToClient));
          server.close(1008, "Nick taken");
          return new Response(null, { status: 101, webSocket: client });
        }
        const seat = this.allocSeat();
        if (!seat) {
          server.send(JSON.stringify({ type: "error", message: "Room is full." } satisfies ServerToClient));
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
          committed: 0,
        };
        this.players.push(player);
      } else {
        player.connected = true;
        // If they rejoined with same key but a different nick input, keep stored nick.
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
          startingChips: this.config.startingChips,
        } satisfies ServerToClient),
      );

      this.broadcastState();

      server.addEventListener("message", async (ev) => {
        const pid = this.connPlayer.get(connId);
        if (!pid) return;
        let data: ClientToServer;
        try {
          data = JSON.parse(String(ev.data)) as ClientToServer;
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
          if (this.game!.phase !== "waiting") {
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
}
