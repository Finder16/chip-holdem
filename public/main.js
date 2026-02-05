const createForm = document.getElementById("createForm");
const joinForm = document.getElementById("joinForm");

function toRoomUrl(code, nick, hostKey) {
  const u = new URL("/room.html", location.origin);
  u.searchParams.set("code", code);
  u.searchParams.set("nick", nick);
  if (hostKey) u.searchParams.set("hostKey", hostKey);
  return u.toString();
}

createForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const nick = document.getElementById("createNick").value.trim();
  const maxPlayers = Number(document.getElementById("maxPlayers").value);
  const sb = Number(document.getElementById("sb").value);
  const bb = Number(document.getElementById("bb").value);

  const resp = await fetch("/api/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maxPlayers, sb, bb }),
  });
  const data = await resp.json();
  if (!data.ok) {
    alert(data.error ?? "create failed");
    return;
  }
  location.href = toRoomUrl(data.code, nick, data.hostKey);
});

joinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = document.getElementById("joinCode").value.trim().toUpperCase();
  const nick = document.getElementById("joinNick").value.trim();
  if (!code || !nick) return;
  location.href = toRoomUrl(code, nick, null);
});
