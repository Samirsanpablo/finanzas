// Service worker de Finanzas: guarda la app para que abra al momento y sin conexión.
// datos.enc (cifrado) se pide siempre a la red; sin conexión, se usa la última copia.
const VERSION = "finanzas-app-23";
const DATOS = "finanzas-datos";
const RECIBIDOS = "finanzas-avisos";   // a qué hora recibe la app cada aviso (solo tipo y horas), para Ajustes → Avisos
const APP = ["./", "index.html", "estilo.css", "app.js", "manifest.webmanifest",
  "icono-180.png", "icono-192.png", "icono-512.png"];

self.addEventListener("install", (e) => {
  // "reload": la versión nueva se pide al servidor, no a la caché del navegador (que puede tener la de antes)
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((claves) => Promise.all(claves.filter((k) => k !== VERSION && k !== DATOS && k !== RECIBIDOS).map((k) => caches.delete(k))))
    .then(() => apuntarRecibido(null))   // empieza la lista (con su "desde") si aún no la hay
    .then(() => self.clients.claim()));
});

// La app pregunta qué versión del service worker está funcionando (Ajustes → Avisos)
self.addEventListener("message", (e) => {
  if (e.data === "version" && e.ports && e.ports[0]) e.ports[0].postMessage(VERSION);
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;

  if (url.pathname.endsWith("/datos.enc")) {
    e.respondWith(fetch(e.request)
      .then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(DATOS).then((c) => c.put("datos.enc", copia)); }
        return r;
      })
      .catch(() => caches.open(DATOS).then((c) => c.match("datos.enc")).then((r) => r || Response.error())));
    return;
  }

  // La app: la copia guardada al momento y, por detrás, la nueva para la próxima vez.
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const guardada = await c.match(e.request, { ignoreSearch: true });
    const nueva = fetch(e.request)
      .then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })
      .catch(() => guardada || Response.error());
    return guardada || nueva;
  }));
});

// Avisos (fase 6): llegan cifrados desde GitHub y el iPhone los descifra antes de dárselos a la app.
// Desde el 20/11 vienen en el formato "declarativo" de Apple: título y texto en `notification`, y en la
// dirección que se abre al tocarlo (`navigate`, detrás de "#") qué abrir (ir), su tipo (k) y cuándo salió (e).
// Si la app lleva un rato sin usarse, el iPhone no la despierta: enseña él el aviso, sin pasar por aquí.
// También entiende el formato de antes (t, b, ir, k, e sueltos).
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { b: e.data ? e.data.text() : "" }; }
  if (d.notification) {
    let p = new URLSearchParams();
    try { p = new URLSearchParams(new URL(d.notification.navigate || "", self.location.href).hash.slice(1)); } catch { /* sin destino */ }
    d = { t: d.notification.title, b: d.notification.body, ir: p.get("ir") || "", k: p.get("k") || "", e: Number(p.get("e")) || 0 };
  }
  const mostrar = self.registration.showNotification(d.t || "Finanzas", {
    body: d.b || "", icon: "icono-192.png", badge: "icono-192.png", data: { ir: d.ir || "" } });
  e.waitUntil(Promise.all([mostrar, apuntarRecibido(d)]));
});

// Apunta el tipo y las horas (sin importes) de los 20 últimos avisos que ha recibido la app (Ajustes →
// Avisos), y desde cuándo se apuntan ("desde", en segundos). Los que enseña el iPhone solo no salen.
// De uno en uno (cola): varios avisos seguidos se pisarían al leer y escribir la lista a la vez.
let colaRecibidos = Promise.resolve();
function apuntarRecibido(d) {
  colaRecibidos = colaRecibidos.then(() => apuntarUno(d));
  return colaRecibidos;
}
async function apuntarUno(d) {
  try {
    const ahora = Math.round(Date.now() / 1000);
    const c = await caches.open(RECIBIDOS);
    const r = await c.match("recibidos");
    const antes = r ? await r.json() : null;
    const empezada = !!antes && !Array.isArray(antes);   // la de la versión 21 era una lista sola, sin "desde"
    if (!d && empezada) return;                          // al activarse, si ya estaba empezada, nada
    const reg = empezada ? antes : { desde: ahora, lista: Array.isArray(antes) ? antes : [] };
    if (d) reg.lista.unshift({ k: String(d.k || ""), e: Number(d.e) || 0, r: ahora });
    reg.lista = reg.lista.slice(0, 20);
    await c.put("recibidos", new Response(JSON.stringify(reg), { headers: { "Content-Type": "application/json" } }));
  } catch { /* sin apuntarlo, el aviso sale igual */ }
}

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const ir = (e.notification.data || {}).ir || "";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
    const v = ventanas[0];
    if (v) { v.postMessage({ ir }); return v.focus(); }
    return self.clients.openWindow(ir ? `./#ir=${encodeURIComponent(ir)}` : "./");
  }));
});
