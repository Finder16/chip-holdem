import { RoomDO } from "./room_do";

export { RoomDO };

type CreateRoomRequest = {
  maxPlayers?: number;
  sb?: number;
  bb?: number;
};

type Env = {
  ROOMS: DurableObjectNamespace<RoomDO>;
  ASSETS?: Fetcher;
};

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

function badRequest(message: string, extra?: Record<string, unknown>): Response {
  return json({ ok: false, error: message, ...(extra ?? {}) }, { status: 400 });
}

function generateCode(len = 5): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true });
    }

    if (url.pathname === "/api/create" && request.method === "POST") {
      let body: CreateRoomRequest;
      try {
        body = (await request.json()) as CreateRoomRequest;
      } catch {
        return badRequest("Invalid JSON");
      }

      const maxPlayers = Math.trunc(body.maxPlayers ?? 8);
      const sb = Math.trunc(body.sb ?? 50);
      const bb = Math.trunc(body.bb ?? 100);
      const startingChips = 10_000;

      if (!(maxPlayers >= 2 && maxPlayers <= 8)) return badRequest("maxPlayers must be 2..8");
      if (!(sb >= 1 && bb >= 2 && bb > sb)) return badRequest("blinds must satisfy 1 <= sb < bb");
      if (startingChips < bb * 10) return badRequest("startingChips too low for blinds");

      // Retry a couple times in case of collisions.
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateCode(5);
        const hostKey = crypto.randomUUID();
        const id = env.ROOMS.idFromName(code);
        const stub = env.ROOMS.get(id);

        const initResp = await stub.fetch("https://room/init", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, maxPlayers, startingChips, sb, bb, hostKey }),
        });

        if (initResp.status === 409) continue; // collision / already initialized
        if (!initResp.ok) {
          const text = await initResp.text();
          return json({ ok: false, error: "Room init failed", details: text }, { status: 500 });
        }

        return json({ ok: true, code, hostKey, maxPlayers, startingChips, sb, bb });
      }

      return json({ ok: false, error: "Failed to allocate room code. Retry." }, { status: 500 });
    }

    if (url.pathname.startsWith("/api/room/")) {
      const parts = url.pathname.split("/").filter(Boolean); // ["api","room",":code","..."]
      const code = (parts[2] ?? "").toUpperCase();
      if (!code) return badRequest("Missing room code");

      const id = env.ROOMS.idFromName(code);
      const stub = env.ROOMS.get(id);

      // Forward the request to the room durable object.
      return stub.fetch(request);
    }

    // Static assets (index.html, room.html, etc.)
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
