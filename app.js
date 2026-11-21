"use strict";
// Finanzas: la app del Proyecto 05. Descarga datos.enc y lo descifra en el propio iPhone
// con la contraseña (mismo formato que cifrado.py). Nada sale del móvil.

const ARCHIVO = "datos.enc";
const CLAVE_GUARDADA = "finanzas-clave";
// Ni gasto ni ingreso: el dinero sigue siendo tuyo. Las apuestas sí cuentan (elección del usuario,
// 15/11/2026): lo metido es gasto y lo que vuelve, ingreso, como una devolución.
// No computables: ni gasto ni ingreso, el dinero sigue siendo tuyo (pasos entre tus cuentas e inversión)
const NO_GASTO = new Set(["Entre tus cuentas", "Inversión"]);
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
// Tipos de gasto por grupos, para elegirlos en listas ordenadas. Los nombres son los de las reglas
// del Proyecto 04 (revisar.py): si se añade un tipo allí, se añade aquí con su emoji.
const GRUPOS = [
  ["Vehículo", { "Gasolina": "⛽", "Diésel": "🛢️", "Mantenimiento del vehículo": "🔧", "Limpieza del coche": "🧽",
    "Parking y peajes": "🅿️" }],
  ["Comida", { "Supermercado y tiendas": "🛒", "Comer fuera, cenas y copas": "🍔", "Comida a domicilio": "🛵",
    "Máquinas de vending": "🥤" }],
  ["Casa y tecnología", { "Productos para el hogar": "🛋️", "Electrónica": "💻", "Videojuegos": "🎮",
    "Suscripciones": "📺", "Teléfono e internet": "📱" }],
  ["Compras", { "Ropa y calzado": "👕", "Compras online": "📦", "Grandes almacenes": "🏬", "Regalos": "🎁" }],
  ["Salud y cuidado personal", { "Salud": "💊", "Perfumes y cosmética": "🧴", "Peluquería y cuidado personal": "💈",
    "Deporte y suplementos": "🏋️" }],
  ["Ocio y viajes", { "Ocio, cine y eventos": "🎟️", "Viajes": "✈️", "Transporte público y taxi": "🚕",
    "Apuestas": "🎲" }],
  ["Otros gastos", { "Libros y formación": "📚", "Mascotas": "🐾", "Estanco": "🚬", "Donativos": "🤝",
    "Seguros": "🛡️", "Comisiones del banco": "🏦", "Impuestos y multas": "🏛️",
    "Bizum y transferencias a personas": "💸" }],
  ["Dinero que sigue siendo tuyo", { "Efectivo (cajero)": "🏧", "Entre tus cuentas": "🔁", "Inversión": "📈" }],
];
const EMOJI = Object.assign({}, ...GRUPOS.map(([, tipos]) => tipos), { "Otros": "🔹" });
const COLOR_CUENTA = { unicaja: "#5DCAA5", revolut: "#8F87E8", efectivo: "#F2B544", pendiente: "#6B6A64" };
const COLORES = ["#C6F432", "#8F87E8", "#5DCAA5", "#F2B544", "#F07A6A", "#6FB7F2"];
// Fase 4: lo apuntado a mano. "pendiente": pagado con tarjeta o Bizum, aún sin su movimiento del banco.
const CUENTAS_APUNTE = { efectivo: "Efectivo", pendiente: "Pendiente del banco" };
const FUERA_APUNTE = new Set(["Entre tus cuentas", "Inversión", "Efectivo (cajero)"]);
// Lo apuntado se guarda en el iPhone hasta verlo en los datos, por si un envío se pierde.
const COLA = "finanzas-cola";
const LIMITE_ENVIO = 63000;   // GitHub admite 65.535 caracteres por envío
const FOTO_MAX = 45000;       // bytes de la foto reducida (unos 60.000 caracteres al enviarla)
const REENVIO_MIN = 4;        // minutos sin verlo guardado antes de reenviar

const $ = (s) => document.querySelector(s);
let crudo = null;   // lo descifrado, tal cual
let datos = null;   // lo que se ve: lo descifrado más lo apuntado que aún se está guardando
let contrasena = null;
let cargadoEn = 0;
let cola = leerCola();
const envio = { activo: false, error: "", temporizador: null, sondeo: null, hasta: 0 };
// Filtros de Movimientos. Las fechas son siempre un intervalo (desde/hasta, incluidos):
// un día, un mes o un año son intervalos con nombre propio.
const filtroVacio = (texto = "") => ({ texto, cuenta: "", categoria: "", tipo: "", desde: "", hasta: "", min: "", max: "", orden: "" });
const estado = { pestana: "inicio", filtro: filtroVacio(), limite: 80,
  borrador: null, pestanaFecha: "rapido", anioMeses: "", rangos: {}, tipos: { vista: "gastos", orden: "gasto", q: "", escala: "meses" },
  ahorro: { modo: "mes", mes: null, anio: null, desde: "", hasta: "", comparar: "anterior" }, reparto: "tipo", ordenProd: "valor", temaNoticias: "" };
const TOTAL = "Total del mes";   // presupuesto de todo el mes: se guarda con los de cada tipo
// Modo discreto: oculta los importes en este iPhone (para enseñar la app sin que se vean)
const DISCRETO = "finanzas-discreto";
let discreto = (() => { try { return localStorage.getItem(DISCRETO) === "1"; } catch { return false; } })();
const OCULTO = "•••";

// ---------- Descifrar (igual que cifrado.py) ----------
function deBase64(t) {
  const b = atob(t);
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

async function descifrar(texto, clave) {
  const caja = JSON.parse(texto);
  if (caja.formato !== "finanzas-1") throw new Error("formato");
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), "PBKDF2", false, ["deriveKey"]);
  const llave = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: deBase64(caja.sal), iterations: caja.iteraciones, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  let plano;
  try {
    plano = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deBase64(caja.iv) }, llave, deBase64(caja.datos));
  } catch {
    throw new Error("contrasena");
  }
  const flujo = new Blob([plano]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(flujo).text());
}

// Cifrar lo que se envía, en el mismo formato: solo quien tiene la contraseña puede apuntar.
function aBase64(u) {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
// La llave se saca de la contraseña una sola vez por sesión (600.000 vueltas: lo más lento en el iPhone).
// Cada envío lleva su propio iv al azar, así que reutilizar la sal de la sesión es seguro.
const llaveEnvio = { clave: null, sal: null, llave: null };
async function cifrar(objeto, clave) {
  if (llaveEnvio.clave !== clave) {
    const sal = crypto.getRandomValues(new Uint8Array(16));
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), "PBKDF2", false, ["deriveKey"]);
    llaveEnvio.llave = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: sal, iterations: 600000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    llaveEnvio.sal = sal;
    llaveEnvio.clave = clave;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const flujo = new Blob([JSON.stringify(objeto)]).stream().pipeThrough(new CompressionStream("gzip"));
  const plano = new Uint8Array(await new Response(flujo).arrayBuffer());
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, llaveEnvio.llave, plano));
  return JSON.stringify({ formato: "finanzas-1", kdf: "PBKDF2-SHA256", iteraciones: 600000,
    sal: aBase64(llaveEnvio.sal), iv: aBase64(iv), datos: aBase64(cifrado) });
}

async function descargar() {
  let r;
  try {
    r = await fetch(`${ARCHIVO}?t=${Date.now()}`, { cache: "no-store" });
  } catch {
    throw new Error("red");
  }
  if (!r.ok) throw new Error("red");
  return r.text();
}

// ---------- Contraseña en el móvil ----------
function claveGuardada() {
  try { return localStorage.getItem(CLAVE_GUARDADA) || sessionStorage.getItem(CLAVE_GUARDADA); } catch { return null; }
}
function guardarClave(clave, recordar) {
  try { (recordar ? localStorage : sessionStorage).setItem(CLAVE_GUARDADA, clave); } catch { /* sin almacenamiento */ }
}
function olvidarClave() {
  try { localStorage.removeItem(CLAVE_GUARDADA); sessionStorage.removeItem(CLAVE_GUARDADA); } catch { /* nada */ }
}

// ---------- Formatos ----------
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function partes(n) {
  const [ent, dec] = Math.abs(n).toFixed(2).split(".");
  return [ent.replace(/\B(?=(\d{3})+(?!\d))/g, "."), dec];
}
function euros(n, signo = false) {
  if (discreto) return `${OCULTO} €`;
  const [ent, dec] = partes(n);
  const s = n < -0.004 ? "−" : (signo && n > 0.004 ? "+" : "");
  return `${s}${ent},${dec} €`;
}
function eurosRedondo(n) {
  if (discreto) return `${OCULTO} €`;
  return `${n < -0.5 ? "−" : ""}${partes(Math.round(Math.abs(n)))[0]} €`;
}
// La cifra grande de arriba (saldo, valor de la cartera)
function cifraGrande(n) {
  if (discreto) return `${OCULTO}<small> €</small>`;
  const [ent, dec] = partes(n);
  return `${n < 0 ? "−" : ""}${ent}<small>,${dec} €</small>`;
}
const importeTexto = (n) => Math.abs(n).toFixed(2).replace(".", ",");   // "1234,56": para buscar por importe
const mayuscula = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
function porcentaje(actual, antes) {
  if (!antes) return null;
  return Math.round(((actual - antes) / antes) * 100);
}

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const hoy = () => iso(new Date());
const mesActual = () => hoy().slice(0, 7);
function mesMas(mes, n) {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const nombreMes = (mes) => `${MESES[+mes.slice(5, 7) - 1]} ${mes.slice(0, 4)}`;
const mesCorto = (mes) => MESES_CORTOS[+mes.slice(5, 7) - 1];
function fechaDia(f) {
  if (f === hoy()) return "Hoy";
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
  if (f === iso(ayer)) return "Ayer";
  const d = new Date(f + "T12:00:00");
  const anio = f.slice(0, 4) === hoy().slice(0, 4) ? "" : ` ${f.slice(0, 4)}`;
  return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES_CORTOS[d.getMonth()]}${anio}`;
}
function fechaCorta(f, conAnio = true) {
  const d = new Date(f + "T12:00:00");
  return `${d.getDate()} ${MESES_CORTOS[d.getMonth()]}${conAnio ? ` ${d.getFullYear()}` : ""}`;
}
function ultimoDia(mes) {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
}
function diasAtras(n) { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); }
function mesesAtras(n) {
  // El día siguiente al de hace n meses: "últimos 3 meses" del 15/11 = del 16/08 al 15/11.
  const d = new Date();
  const dia = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() - n);
  d.setDate(Math.min(dia, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()) + 1);
  return iso(d);
}
const rangoMes = (mes) => [`${mes}-01`, ultimoDia(mes)];
const rangoAnio = (a) => [`${a}-01-01`, `${a}-12-31`];
const esMes = (d, h) => !!d && d.slice(8) === "01" && h === ultimoDia(d.slice(0, 7));
const esAnio = (d, h) => !!d && d.slice(5) === "01-01" && h === `${d.slice(0, 4)}-12-31`;
function nombreRango(desde, hasta) {
  if (!desde && !hasta) return "";
  if (desde && hasta) {
    if (desde > hasta) [desde, hasta] = [hasta, desde];
    if (desde === hasta) return fechaCorta(desde);
    if (esAnio(desde, hasta)) return desde.slice(0, 4);
    if (esMes(desde, hasta)) { const t = nombreMes(desde.slice(0, 7)); return t[0].toUpperCase() + t.slice(1); }
    return `${fechaCorta(desde, desde.slice(0, 4) !== hasta.slice(0, 4))} – ${fechaCorta(hasta)}`;
  }
  return desde ? `Desde el ${fechaCorta(desde)}` : `Hasta el ${fechaCorta(hasta)}`;
}
function rapidos() {
  const mes = mesActual();
  const anio = +hoy().slice(0, 4);
  return [
    ["Hoy", hoy(), hoy()],
    ["Ayer", diasAtras(1), diasAtras(1)],
    ["Últimos 7 días", diasAtras(6), hoy()],
    ["Últimos 30 días", diasAtras(29), hoy()],
    ["Este mes", ...rangoMes(mes)],
    ["Mes pasado", ...rangoMes(mesMas(mes, -1))],
    ["Últimos 3 meses", mesesAtras(3), hoy()],
    ["Últimos 12 meses", mesesAtras(12), hoy()],
    ["Este año", ...rangoAnio(anio)],
    ["Año pasado", ...rangoAnio(anio - 1)],
  ];
}

function haceCuanto(texto) {
  if (!texto) return "nunca";
  const min = Math.round((Date.now() - new Date(texto).getTime()) / 60000);
  if (min < 2) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}
function diasHasta(texto) {
  return Math.ceil((new Date(texto).getTime() - Date.now()) / 86400000);
}

function titulo(m) {
  const t = (m.concepto || "").replace(/\s+/g, " ").trim()
    .replace(/^BIZUM:\s*/i, "Bizum · ").replace(/^CAJ\.\s*/i, "Cajero · ").replace(/^TO\s+/i, "A ");
  return t || "(sin concepto)";
}
function nombreCategoria(m) {
  if (m.importe > 0 && m.categoria === "Otros") return /NOMIN/.test(m.tipo || "") ? "Nómina" : "Ingreso";
  return m.categoria;
}
function emoji(m) {
  if (m.importe > 0 && m.categoria === "Otros") return /NOMIN/.test(m.tipo || "") ? "💼" : "💶";
  return emojiCategoria(m.categoria);
}
const nombreCuenta = (c) => CUENTAS_APUNTE[c] || (datos.cuentas[c] && datos.cuentas[c].banco) || c;
const suma = (lista, f) => lista.reduce((t, x) => t + f(x), 0);

// ---------- Datos ----------
function rehacer() {
  datos = structuredClone(crudo);
  datos.apuntes = datos.apuntes || [];
  datos.cambios = datos.cambios || {};
  datos.presupuestos = datos.presupuestos || {};
  // Lo que ya está guardado sale de la cola; lo demás se ve ya, aunque aún se esté guardando
  const hechos = new Set(datos.hechos || []);
  const antes = cola.length;
  cola = cola.filter((op) => !hechos.has(op.id));
  if (cola.length !== antes) guardarCola();
  for (const op of cola) aplicarOp(op);
  tiposDelBanco();
  for (const a of datos.apuntes) if (!a.enlace) datos.movimientos.push(movDeApunte(a));
  for (const m of datos.movimientos) {
    m._mes = m.fecha.slice(0, 7);
    m._gasto = m.importe < 0 && !NO_GASTO.has(m.categoria);
    m._ingreso = m.importe > 0 && !NO_GASTO.has(m.categoria);
  }
  compensarEfectivo();
  datos.movimientos.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  indexar();
}

// Índices hechos una vez por carga: así cada pantalla no repasa todos los movimientos.
function indexar() {
  const porMes = new Map();
  const usos = new Map();
  const usosGasto = new Map();
  const usosIngreso = new Map();
  const sumar = (mapa, c) => mapa.set(c, (mapa.get(c) || 0) + 1);
  for (const m of datos.movimientos) {
    if (!porMes.has(m._mes)) porMes.set(m._mes, []);
    porMes.get(m._mes).push(m);
    if (m._ajuste) continue;
    const c = nombreCategoria(m);
    sumar(usos, c);
    if (m._gasto) sumar(usosGasto, c);
    if (m._ingreso) sumar(usosIngreso, c);
  }
  datos._porMes = porMes;
  datos._usos = usos;
  datos._usosGasto = usosGasto;
  datos._usosIngreso = usosIngreso;
  datos._cache = new Map();
}
// Lo que cuesta calcular (cargos fijos, saldo de cada día…) se calcula una vez por carga de datos
function calculado(clave, f) {
  if (!datos._cache.has(clave)) datos._cache.set(clave, f());
  return datos._cache.get(clave);
}

// Lo mismo que hace apuntes.py en GitHub, para verlo al momento.
function aplicarOp(op) {
  const lista = datos.apuntes;
  const pos = (id) => lista.findIndex((a) => a.id === id);
  if (op.tipo === "apunte") {
    const i = pos(op.apunte.id);
    const nuevo = { ...op.apunte, enlace: i >= 0 ? lista[i].enlace : undefined };
    if (i >= 0) lista[i] = nuevo; else lista.push(nuevo);
  } else if (op.tipo === "borrar") {
    const i = pos(op.apunte);
    if (i >= 0) lista.splice(i, 1);
  } else if (op.tipo === "cambio") {
    if (op.categoria || op.nota) datos.cambios[op.mov] = { categoria: op.categoria || undefined, nota: op.nota || undefined };
    else delete datos.cambios[op.mov];
  } else if (op.tipo === "presupuesto") {
    if (op.importe) datos.presupuestos[op.categoria] = +op.importe; else delete datos.presupuestos[op.categoria];
  } else if (op.tipo === "avisos") {
    const av = datos.avisos = datos.avisos || {};
    const subs = av.suscripciones = av.suscripciones || [];
    const endpoint = (op.suscripcion || {}).endpoint || op.endpoint;
    let i = subs.findIndex((x) => x.endpoint === endpoint);
    if (op.quitar) { if (i >= 0) subs.splice(i, 1); return; }
    if (i < 0 && op.suscripcion) { subs.push({ endpoint, prefs: Object.fromEntries(TIPOS_AVISO.map(([k]) => [k, true])) }); i = subs.length - 1; }
    if (i >= 0 && op.prefs) subs[i].prefs = { ...subs[i].prefs, ...op.prefs };
  } else if (op.tipo === "ticket" && pos(op.apunte) < 0) {
    lista.push({ id: op.apunte, fecha: op.fecha, importe: 0, concepto: "Leyendo el ticket…", categoria: "Otros",
      pago: op.pago, origen: "ticket", revisar: true, _leyendo: true });
  }
}

// Tipo de cada movimiento del banco: tu cambio; si no, el del apunte enlazado; si no, el automático.
function tiposDelBanco() {
  const enlazados = new Map(datos.apuntes.filter((a) => a.enlace).map((a) => [a.enlace, a]));
  for (const m of datos.movimientos) {
    const auto = m.auto !== undefined ? m.auto : m.categoria;
    const a = enlazados.get(m.id);
    const c = datos.cambios[m.id] || {};
    m.auto = auto;
    m.categoria = c.categoria || (a && a.categoria) || auto;
    m.nota = c.nota || (a && a.nota) || "";
    m.apunte = a ? a.id : undefined;
  }
}

function movDeApunte(a) {
  return { id: a.id, cuenta: a.pago === "efectivo" ? "efectivo" : "pendiente", fecha: a.fecha, importe: a.importe,
    concepto: a.concepto, categoria: a.categoria, nota: a.nota || "", estado: "APUNTE", tipo: "", _apunte: a };
}

// Lo apuntado en efectivo sale de lo que sacaste del cajero: ese mes, el cajero cuenta menos para no
// contarlo dos veces. Si apuntas más de lo que sacaste, lo de más cuenta entero.
function compensarEfectivo() {
  const cajero = new Map();
  for (const m of datos.movimientos) {
    if (!m._apunte && m.categoria === "Efectivo (cajero)" && m.importe < 0) cajero.set(m._mes, (cajero.get(m._mes) || 0) - m.importe);
  }
  const efectivo = datos.movimientos.filter((m) => m._apunte && m.cuenta === "efectivo" && m._gasto)
    .sort((x, y) => (x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : 0));
  for (const m of efectivo) {
    const queda = cajero.get(m._mes) || 0;
    const k = Math.min(queda, -m.importe);
    if (k < 0.005) continue;
    cajero.set(m._mes, queda - k);
    datos.movimientos.push({ id: `ajuste-${m.id}`, cuenta: "efectivo", fecha: m.fecha, _mes: m._mes, importe: k,
      concepto: "Ya contado al sacarlo del cajero", categoria: "Efectivo (cajero)", _ajuste: true, _gasto: true, _ingreso: false });
  }
}

const delMes = (mes) => datos._porMes.get(mes) || [];
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
const primerMes = () => (datos.movimientos.length ? datos.movimientos[datos.movimientos.length - 1]._mes : mesActual());
const delBanco = () => datos.movimientos.filter((m) => !m._apunte && !m._ajuste);

function gastoPorCategoria(movs) {
  const t = new Map();
  for (const m of movs) if (m._gasto) t.set(m.categoria, (t.get(m.categoria) || 0) - m.importe);
  return [...t.entries()].filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
}

// Tipos que se pueden elegir. Al apuntar no salen los que no son gasto (pasos entre cuentas, inversión, cajero).
function categoriasGasto(todas = false) {
  const set = new Set(Object.keys(EMOJI));
  for (const m of datos.movimientos) if (m.categoria && !m._ajuste) set.add(m.categoria);
  if (!todas) for (const c of FUERA_APUNTE) set.delete(c);
  for (const c of ["Otros", "Nómina", "Ingreso"]) set.delete(c);
  return [...set].sort((a, b) => a.localeCompare(b, "es")).concat("Otros");
}
const TIPOS_INGRESO = ["Nómina", "Ingreso", "Bizum y transferencias a personas", "Apuestas"];
function categoriasIngreso() {
  const resto = categoriasGasto(true).filter((c) => !TIPOS_INGRESO.includes(c) && c !== "Otros" && c !== "Efectivo (cajero)");
  return [...TIPOS_INGRESO, ...resto];
}
// ---------- Buscador de tipos (la lupa) ----------
// Sirve en los filtros, al apuntar y al cambiar el tipo de un movimiento. Busca por el nombre del tipo, su grupo,
// palabras parecidas ("gasolinera" → Gasolina y Diésel) y los comercios de tus movimientos ("mercadona" → el tipo
// en el que están sus compras). Sin distinguir mayúsculas ni tildes.
const PALABRAS_TIPO = {
  "Gasolina": "gasolinera combustible carburante repostar", "Diésel": "diesel gasoil gasolinera combustible carburante repostar",
  "Mantenimiento del vehículo": "taller itv neumaticos ruedas aceite revision mecanico recambios coche moto",
  "Limpieza del coche": "lavado lavadero aspirado coche", "Parking y peajes": "aparcamiento parking peaje autopista zona azul ora",
  "Supermercado y tiendas": "super mercado compra comida fruteria panaderia carniceria alimentacion",
  "Comer fuera, cenas y copas": "restaurante bar cafe cafeteria copas cena comida menu tapas pub discoteca desayuno",
  "Comida a domicilio": "domicilio delivery pedido comida reparto", "Máquinas de vending": "vending maquina expendedora snack",
  "Productos para el hogar": "casa hogar muebles bricolaje decoracion menaje limpieza",
  "Electrónica": "ordenador portatil movil tablet auriculares tecnologia informatica",
  "Videojuegos": "juegos consola playstation xbox nintendo steam", "Suscripciones": "streaming cuota mensual plataforma musica series",
  "Teléfono e internet": "movil telefono fibra internet tarifa linea", "Ropa y calzado": "ropa zapatos zapatillas moda",
  "Compras online": "online internet pedido paqueteria envio", "Grandes almacenes": "almacenes centro comercial",
  "Regalos": "regalo cumpleanos navidad", "Salud": "farmacia medico dentista hospital optica clinica medicinas",
  "Perfumes y cosmética": "perfume perfumeria cosmetica crema maquillaje",
  "Peluquería y cuidado personal": "peluqueria barberia barbero corte pelo estetica uñas",
  "Deporte y suplementos": "gimnasio gym deporte proteina suplementos", "Ocio, cine y eventos": "cine concierto entradas teatro museo fiesta eventos ocio",
  "Viajes": "hotel vuelo avion viaje vacaciones alojamiento", "Transporte público y taxi": "taxi vtc bus autobus metro tren cercanias transporte",
  "Apuestas": "apuesta casino loteria juego", "Libros y formación": "libro libreria curso formacion academia universidad",
  "Mascotas": "perro gato veterinario mascota pienso", "Estanco": "tabaco estanco", "Donativos": "donacion ong donativo",
  "Seguros": "seguro poliza", "Comisiones del banco": "comision banco cuenta", "Impuestos y multas": "impuesto multa hacienda tasa ayuntamiento trafico",
  "Bizum y transferencias a personas": "bizum transferencia amigo persona", "Efectivo (cajero)": "cajero efectivo retirada dinero",
  "Entre tus cuentas": "traspaso transferencia propia cuentas", "Inversión": "inversion acciones fondos",
  "Nómina": "nomina sueldo salario ingreso", "Ingreso": "ingreso cobro", "Otros": "otros varios ingreso",
};
const normal = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const GRUPO_DE = Object.fromEntries(GRUPOS.flatMap(([g, tipos]) => Object.keys(tipos).map((c) => [c, g])));
const pajares = new Map();   // tipo → su texto de búsqueda (nombre, grupo y palabras), hecho una vez
const PALABRAS_GRUPO = { "Vehículo": "coche moto vehiculo", "Comida": "comer comida alimentacion",
  "Casa y tecnología": "casa hogar tecnologia", "Compras": "comprar tienda", "Salud y cuidado personal": "salud belleza cuidado",
  "Ocio y viajes": "ocio viaje", "Dinero que sigue siendo tuyo": "ahorro tuyo" };
const pajar = (c) => pajares.get(c) || pajares.set(c, normal(`${c} ${GRUPO_DE[c] || ""} ${PALABRAS_GRUPO[GRUPO_DE[c]] || ""} ${PALABRAS_TIPO[c] || ""}`)).get(c);
const textos = new WeakMap(); // movimiento → su concepto y su nota en minúsculas y sin tildes, hecho una vez
const textoMov = (m) => textos.get(m) ?? textos.set(m, normal(`${titulo(m)} ${m.concepto || ""} ${m.nota || ""}`)).get(m);
const nombresNormales = new Map();
const categoriaNormal = (m) => { const c = nombreCategoria(m); return nombresNormales.get(c) ?? nombresNormales.set(c, normal(c)).get(c); };
const selectores = {};

function selectorTipos(id, { actual = "", lista, vacio = "", etiquetas = {}, alElegir = null, conservar = false, usos = datos._usos,
  ingresos = ["Nómina", "Ingreso"], fijos = [] }) {
  const antes = conservar ? selectores[id] : null;
  if (actual && !lista.includes(actual)) lista = [...lista, actual];
  selectores[id] = { lista, actual, vacio, etiquetas, alElegir, usos, ingresos, fijos, q: antes ? antes.q : "", abierto: antes ? antes.abierto : false };
  return `<div class="selector-tipos">
    <input type="hidden" id="${id}" value="${esc(actual)}">
    <div class="lupa"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.5-4.5"/></svg>
      <input type="search" class="buscar buscar-tipo" data-buscar-tipo="${id}" value="${esc(selectores[id].q)}"
        placeholder="Busca un tipo o un comercio" autocomplete="off" enterkeyhint="search" aria-label="Buscar tipo"></div>
    <div class="tipos-lista" id="${id}-lista">${listaTipos(id)}</div></div>`;
}

function listaTipos(id) {
  const s = selectores[id];
  const porUso = (a, b) => (s.usos.get(b) || 0) - (s.usos.get(a) || 0) || a.localeCompare(b, "es");
  const chip = (c, n) => `<button class="filtro${c === s.actual ? " activo" : ""}" data-tipo-elegir="${esc(c)}" data-selector-id="${id}">${c
    ? `${emojiCategoria(c)} ${esc(s.etiquetas[c] || c)}` : esc(s.vacio)}${n ? `<span class="cuantos">${n}</span>` : ""}</button>`;
  const fila = (tipos, cuantos = (c) => s.usos.get(c)) => `<div class="opciones">${tipos.map((c) => chip(c, cuantos(c))).join("")}</div>`;
  const q = normal(s.q).trim();
  if (!q && s.abierto) {   // todos, por grupos
    const ingresos = s.ingresos.filter((c) => s.lista.includes(c));
    const grupos = [["Ingresos", ingresos], ...GRUPOS.map(([g, tipos]) => [g, Object.keys(tipos).filter((c) => s.lista.includes(c) && !ingresos.includes(c))])];
    const resto = s.lista.filter((c) => !GRUPO_DE[c] && c !== "Otros" && !ingresos.includes(c));
    grupos.push(["Más tipos", resto.sort(porUso)], ["", s.lista.includes("Otros") ? ["Otros"] : []]);
    return `${s.vacio ? fila([""]) : ""}${grupos.filter(([, t]) => t.length).map(([g, t]) =>
      `${g ? `<div class="tipos-grupo">${esc(g)}</div>` : ""}${fila(t)}`).join("")}
      <button class="enlace ver-tipos" data-tipos-abrir="${id}">Ver menos</button>`;
  }
  if (!q) {   // los 8 más usados (y el elegido)
    // Los fijos (en un ingreso: Nómina, Ingreso, Bizum recibidos y apuestas) siempre delante
    const fijos = s.fijos.filter((c) => s.lista.includes(c));
    let vistos = [...fijos, ...s.lista.filter((c) => !fijos.includes(c)).sort(porUso)].slice(0, 8);
    if (s.actual && !vistos.includes(s.actual)) vistos = [s.actual, ...vistos.slice(0, 7)];
    return `${fila([...(s.vacio ? [""] : []), ...vistos])}${s.lista.length > vistos.length
      ? `<button class="enlace ver-tipos" data-tipos-abrir="${id}">Ver los ${s.lista.length} tipos</button>` : ""}`;
  }
  const palabras = q.split(/\s+/);
  const porNombre = s.lista.filter((c) => palabras.every((p) => pajar(c).includes(p) || normal(s.etiquetas[c]).includes(p))).sort(porUso);
  const porComercio = new Map();
  if (q.length >= 2) {
    for (const m of datos.movimientos) {
      if (m._ajuste || !textoMov(m).includes(q)) continue;
      const c = nombreCategoria(m);
      if (s.lista.includes(c) && !porNombre.includes(c)) porComercio.set(c, (porComercio.get(c) || 0) + 1);
    }
  }
  const comercio = [...porComercio.keys()].sort((a, b) => porComercio.get(b) - porComercio.get(a));
  if (!porNombre.length && !comercio.length) return `<p class="nota tipos-nada">Ningún tipo ni comercio coincide con «${esc(s.q.trim())}».</p>`;
  return `${porNombre.length ? fila(porNombre) : ""}${comercio.length ? `<div class="tipos-grupo">Donde están tus movimientos de «${esc(s.q.trim())}»</div>
    ${fila(comercio, (c) => porComercio.get(c))}` : ""}`;
}

function elegirTipo(id, c) {
  const s = selectores[id];
  if (!s) return;
  s.actual = c;
  $(`#${id}`).value = c;
  $(`#${id}-lista`).innerHTML = listaTipos(id);
  if (s.alElegir) s.alElegir(c);
}

// ---------- Pantallas ----------
function filaMov(m, conFecha = false) {
  const mas = m.importe > 0;
  const nc = NO_GASTO.has(m.categoria);
  const cuenta = `<span class="punto-mini" style="color:${COLOR_CUENTA[m.cuenta] || "#9A988F"}">●</span>`;
  const a = m._apunte;
  const extra = m.estado === "PDNG" ? ' · <span class="pendiente">pendiente</span>'
    : a && a._leyendo ? ' · <span class="pendiente">Claude lo está leyendo</span>'
    : a && a.revisar ? ' · <span class="pendiente">por revisar</span>'
    : m.cuenta === "pendiente" ? " · sin llegar del banco"
    : m.nota || m.apunte ? " · ✎" : "";
  const noComputa = nc ? " · no computable" : "";
  return `<button class="mov" data-accion="mov" data-id="${esc(m.id)}">
    <span class="emoji">${a && a._leyendo ? "📷" : emoji(m)}</span>
    <span class="mov-texto"><b>${esc(titulo(m))}</b>
      <span>${cuenta} ${conFecha ? `${esc(fechaCorta(m.fecha))} · ` : ""}${a && a._leyendo ? "Ticket" : esc(nombreCategoria(m))}${noComputa}${extra}</span></span>
    <span class="importe${nc ? " nc" : mas ? " mas" : ""}">${a && a._leyendo ? "…" : euros(m.importe, true)}</span></button>`;
}

// Estado de lo apuntado que aún se está guardando
function bandaEnvio() {
  if (!cola.length) return "";
  const n = cola.length;
  const que = `${n} ${n === 1 ? "cambio" : "cambios"}`;
  if (envio.error) {
    const motivo = { "falta-permiso": "Falta dar a la app el permiso para guardar (en el portátil)",
      permiso: "GitHub no acepta el permiso de la app: puede haber caducado", red: "Sin conexión",
      github: "GitHub no responde", fallos: "No se ha podido guardar tras varios intentos",
      grande: "La foto ocupa demasiado" }[envio.error] || "No se ha podido enviar";
    return `<div class="alerta roja fila"><span>${motivo}. ${que} sin guardar.</span>
      ${envio.error === "falta-permiso" ? "" : '<button class="enlace" data-accion="reenviar">Reintentar</button>'}</div>`;
  }
  return `<div class="alerta violeta">Guardando ${que}… Tarda alrededor de un minuto${cola.some((op) => op.tipo === "ticket") ? " y Claude está leyendo el ticket" : ""}.</div>`;
}

function tarjetaRevisar() {
  const revisar = datos.apuntes.filter((a) => a.revisar);
  if (!revisar.length) return "";
  return `<div class="seccion"><h3>Tickets por revisar</h3></div>
    <div class="lista" style="margin-bottom:14px">${revisar.map((a) => filaMov(movDeApunte(a))).join("")}</div>`;
}

function barraPresupuesto(cat, v, tope, mes = null) {
  const r = v / tope;
  const p = mes && mes === mesActual() ? prevision(cat === TOTAL ? null : cat) : null;
  const ritmo = p && p.total > v + 0.5 ? `<div class="comparado ${p.total > tope ? "ambar" : "suave"}">A este ritmo, unos ${eurosRedondo(p.total)} a fin de mes${
    p.total > tope && v <= tope ? `: te pasarías en ${eurosRedondo(p.total - tope)}` : ""}</div>` : "";
  const clase = r > 1 ? "rojo" : r >= 0.8 ? "ambar" : "suave";
  const color = r > 1 ? "var(--rojo)" : r >= 0.8 ? "var(--ambar)" : "var(--lima)";
  return `<div class="barra-cat"><div class="fila"><span>${emojiCategoria(cat)} ${esc(cat)}</span>
      <span>${eurosRedondo(v)} <span class="tenue">de ${eurosRedondo(tope)}</span></span></div>
    <div class="pista"><i style="width:${Math.min(100, Math.max(2, r * 100))}%;background:${color}"></i></div>
    <div class="comparado ${clase}">${v <= tope ? `Quedan ${eurosRedondo(tope - v)}` : `Te has pasado ${eurosRedondo(v - tope)}`}</div>${ritmo}</div>`;
}

function tarjetaPresupuestos(mes) {
  const lista = Object.entries(datos.presupuestos).filter(([c]) => c !== TOTAL).sort((x, y) => x[0].localeCompare(y[0], "es"));
  if (!lista.length) return "";
  const gastado = new Map(gastoPorCategoria(delMes(mes)));
  return `<div class="tarjeta"><div class="fila"><h3>Presupuestos de ${MESES[+mes.slice(5, 7) - 1]}</h3>
      <button class="enlace" data-accion="presupuestos">Editar</button></div>
    ${lista.map(([cat, tope]) => barraPresupuesto(cat, gastado.get(cat) || 0, tope, mes)).join("")}</div>`;
}

function avisos() {
  const lista = [];
  for (const [, c] of Object.entries(datos.cuentas)) {
    if (c.error) lista.push(`<div class="alerta roja">${esc(c.banco)} no se ha podido actualizar: ${esc(c.error)}</div>`);
    if (c.permiso_hasta) {
      const d = diasHasta(c.permiso_hasta);
      if (d <= 15) lista.push(`<div class="alerta">El permiso de ${esc(c.banco)} ${d > 0 ? `caduca en ${d} días` : "ha caducado"}: hay que renovarlo.</div>`);
    }
  }
  if (datos.actualizado && Date.now() - new Date(datos.actualizado).getTime() > 14 * 3600000) {
    lista.push(`<div class="alerta">Los datos son de ${haceCuanto(datos.actualizado)}.</div>`);
  }
  lista.push(alertaAvisos());
  return lista.join("");
}

function saludo() {
  const h = new Date().getHours();
  return h < 6 ? "Buenas noches" : h < 14 ? "Buenos días" : h < 21 ? "Buenas tardes" : "Buenas noches";
}

const OJO = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const OJO_NO = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const botonDiscreto = () => `<button class="icono-boton" data-accion="discreto" aria-label="${discreto ? "Enseñar los importes" : "Ocultar los importes"}">${discreto ? OJO_NO : OJO}</button>`;

// ---------- Cargos fijos: recibos y suscripciones de cada mes ----------
// Se buscan en los últimos 6 meses: el mismo comercio, con un importe parecido (±20 %), en al menos 3 de los
// 4 últimos meses cerrados y como mucho una vez al mes. Un mismo comercio puede tener dos (dos suscripciones).
function claveComercio(m) {
  return normal(titulo(m)).replace(/[^a-z]+/g, " ").trim().split(" ").slice(0, 5).join(" ");
}

function cargosFijos() {
  return calculado("cargos", () => {
    const actual = mesActual();
    const desde = mesMas(actual, -6);
    const cerrados = [1, 2, 3, 4].map((n) => mesMas(actual, -n));
    const grupos = new Map();
    for (const m of datos.movimientos) {
      if (m._mes < desde) break;   // van del más nuevo al más antiguo
      if (m._apunte || m._ajuste || !m._gasto || m.estado === "PDNG" || m.categoria === "Efectivo (cajero)") continue;
      const k = claveComercio(m);
      if (!k) continue;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(m);
    }
    const lista = [];
    for (const [clave, movs] of grupos) {
      if (movs.length / new Set(movs.map((m) => m._mes)).size > 2.5) continue;   // un comercio de todos los días, no un recibo
      const series = [];
      for (const m of movs.slice().reverse()) {   // del más antiguo al más nuevo; cada cobro, a la serie de importe más parecido
        const v = -m.importe;
        let mejor = null;
        for (const s of series) {
          const r = Math.abs(v / s.ultimo - 1);
          if (r <= 0.2 && (!mejor || r < mejor.r)) mejor = { s, r };
        }
        if (mejor) { mejor.s.movs.push(m); mejor.s.ultimo = v; } else series.push({ movs: [m], ultimo: v });
      }
      for (const { movs: cobros } of series) {
        const meses = new Set(cobros.map((m) => m._mes));
        if (cerrados.filter((x) => meses.has(x)).length < 3 || cobros.length > meses.size * 1.25) continue;
        const ultimo = cobros[cobros.length - 1];
        if (diasEntre(ultimo.fecha, hoy()) > 45) continue;   // ya no se cobra
        // Un recibo llega hacia el mismo día cada mes (±5 días; el 30 y el 1 están a 1 día) y con un importe parecido
        const dias = cobros.map((m) => +m.fecha.slice(8, 10)).sort((a, b) => a - b);
        const dia = dias[Math.floor(dias.length / 2)];
        const lejos = dias.filter((d) => Math.min(Math.abs(d - dia), 31 - Math.abs(d - dia)) > 5).length;
        const importes = cobros.map((m) => -m.importe);
        if (lejos > Math.floor(cobros.length / 4) || Math.max(...importes) > Math.min(...importes) * 1.25) continue;
        const cobrado = ultimo._mes === actual;
        const mesProx = cobrado ? mesMas(actual, 1) : actual;
        const proxima = `${mesProx}-${String(Math.min(dia, +ultimoDia(mesProx).slice(8))).padStart(2, "0")}`;
        // ¿Ha subido de precio en los últimos 2 meses?
        let i = cobros.length - 2;
        while (i >= 0 && Math.abs(cobros[i].importe - ultimo.importe) < 0.05) i--;
        const subida = i >= 0 && cobros[i].importe - ultimo.importe >= 0.05 && diasEntre(cobros[i + 1].fecha, hoy()) <= 62
          ? { antes: -cobros[i].importe, pct: (ultimo.importe / cobros[i].importe - 1) * 100, desde: cobros[i + 1].fecha } : null;
        lista.push({ clave, nombre: titulo(ultimo), categoria: ultimo.categoria, cuenta: ultimo.cuenta, importe: -ultimo.importe,
          dia, proxima, cobrado, subida, esteMes: cobros.filter((m) => m._mes === actual).map((m) => m.id) });
      }
    }
    return lista.sort((a, b) => (a.proxima < b.proxima ? -1 : a.proxima > b.proxima ? 1 : b.importe - a.importe));
  });
}
const cuandoCargo = (c) => (c.cobrado ? `Cobrado · el próximo, el ${fechaCorta(c.proxima, false)}`
  : c.proxima < hoy() ? `Aún no ha llegado (suele ser el día ${c.dia})` : c.proxima === hoy() ? "Hoy" : `El ${fechaCorta(c.proxima, false)}`);

function tarjetaCargos() {
  const lista = cargosFijos();
  if (!lista.length) return "";
  const faltan = lista.filter((c) => !c.cobrado);
  const subidas = lista.filter((c) => c.subida).length;
  return `<div class="tarjeta tarjeta-boton" data-accion="cargos" role="button" tabindex="0">
    <div class="fila"><h3>Cargos fijos</h3><span class="nota">Ver</span></div>
    <div class="fila"><div class="medio">${euros(suma(lista, (c) => c.importe))}<small> al mes</small></div>
      ${subidas ? `<span class="chip atencion">${subidas} ${subidas === 1 ? "ha subido" : "han subido"}</span>` : ""}</div>
    <div class="nota">${lista.length} recibos y suscripciones · ${faltan.length
      ? `faltan ${faltan.length} este mes (${eurosRedondo(suma(faltan, (c) => c.importe))})` : "ya han llegado todos los de este mes"}</div>
    ${faltan.slice(0, 3).map((c) => `<div class="dato"><span>${emojiCategoria(c.categoria)} ${esc(c.nombre)}</span>
      <span>${euros(c.importe)} · ${esc(cuandoCargo(c).toLowerCase())}</span></div>`).join("")}</div>`;
}

function hojaCargos() {
  const lista = cargosFijos();
  const alMes = suma(lista, (c) => c.importe);
  abrirHoja(`<h3 class="hoja-titulo">Cargos fijos</h3>
    <p class="nota" style="margin:2px 0 10px">Recibos y suscripciones que se repiten cada mes, encontrados en tus movimientos de los últimos 6 meses.</p>
    <div class="dato total"><span>Al mes</span><span>${euros(alMes)}</span></div>
    <div class="dato"><span>Al año</span><span>${euros(alMes * 12)}</span></div>
    <div class="lista lista-hoja" style="margin-top:12px">${lista.map((c) => `<button class="mov" data-h="comercio" data-q="${esc(c.clave)}">
      <span class="emoji">${emojiCategoria(c.categoria)}</span>
      <span class="mov-texto"><b>${esc(c.nombre)}</b><span class="linea">${esc(cuandoCargo(c))} · ${esc(nombreCuenta(c.cuenta))}</span>
        ${c.subida ? `<span class="linea ambar">Ha subido de ${euros(c.subida.antes)} a ${euros(c.importe)} (${fmtPct(c.subida.pct)}) el ${fechaCorta(c.subida.desde, false)}</span>` : ""}</span>
      <span class="importe">${euros(c.importe)}</span></button>`).join("")}</div>
    <p class="nota" style="margin-top:10px">Solo los de cada mes, no los anuales. Si falta o sobra alguno, puede que el comercio haya cambiado de nombre o de importe. Al tocar uno ves todos sus movimientos.</p>
    <button class="boton-sec" data-cerrar>Cerrar</button>`);
}

// Previsión del mes en curso: lo gastado, más lo que falta al ritmo de este mes (sin los cargos fijos) y los cargos
// fijos que aún no han llegado. Desde el día 5: antes, el ritmo de unos pocos días engaña.
function prevision(cat = null) {
  const mes = mesActual();
  const dia = +hoy().slice(8, 10);
  if (dia < 5) return null;
  const quedan = +ultimoDia(mes).slice(8) - dia;
  const cargos = cargosFijos().filter((c) => !cat || c.categoria === cat);
  const fijos = new Set(cargos.flatMap((c) => c.esteMes));
  const movs = delMes(mes).filter((m) => m._gasto && (!cat || m.categoria === cat));
  const gastado = suma(movs, (m) => -m.importe);
  const variable = suma(movs.filter((m) => !fijos.has(m.id)), (m) => -m.importe);
  const faltan = cargos.filter((c) => !c.cobrado);
  const fijoFalta = suma(faltan, (c) => c.importe);
  return { gastado, total: gastado + (Math.max(0, variable) / dia) * quedan + fijoFalta, faltan, fijoFalta };
}

// El valor de todo lo invertido (con el efectivo de los brókeres), calculado una vez por carga
function totalCartera() {
  return calculado("cartera", () => {
    const lista = brokers();
    const prods = productos();
    const efectivo = suma(lista, ([, b]) => b.efectivo || 0);
    const invertido = suma(prods, (p) => p.valor);
    return { lista, prods, efectivo, invertido, total: invertido + efectivo, coste: suma(prods, (p) => p.coste),
      hoyEur: suma(prods, (p) => p.hoy) };
  });
}

function vistaInicio() {
  const mes = mesActual();
  const dia = +hoy().slice(8, 10);
  const cuentas = Object.entries(datos.cuentas);
  const total = suma(cuentas, ([, c]) => (c.saldo ? c.saldo.importe : 0));
  const movsMes = delMes(mes);
  const gasto = suma(movsMes.filter((m) => m._gasto), (m) => -m.importe);
  const antes = suma(delMes(mesMas(mes, -1)).filter((m) => m._gasto && +m.fecha.slice(8, 10) <= dia), (m) => -m.importe);
  const pct = porcentaje(gasto, antes);
  const ingresos = suma(movsMes.filter((m) => m._ingreso), (m) => m.importe);
  const cats = gastoPorCategoria(movsMes).slice(0, 4);
  const maximo = cats.length ? cats[0][1] : 1;
  const cartera = brokers().length ? totalCartera() : null;
  const prev = prevision();
  const mesPasado = suma(delMes(mesMas(mes, -1)).filter((m) => m._gasto), (m) => -m.importe);
  const topeTotal = datos.presupuestos[TOTAL];

  return `
  <div class="cabecera">
    <div><div class="saludo">${saludo()}</div>${lineaActualizado()}</div>
    <div class="botones">${botonDiscreto()}<button class="icono-boton" data-accion="ajustes" aria-label="Ajustes">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
    </button></div>
  </div>
  ${avisos()}
  ${bandaBancos()}
  ${bandaEnvio()}
  ${tarjetaRevisar()}
  <div class="etiqueta">Saldo total</div>
  <div class="saldo">${cifraGrande(total)}</div>
  <div class="cuentas">
    ${cuentas.map(([k, c]) => `<button class="cuenta" data-accion="cuenta" data-cuenta="${esc(k)}"><span class="etiqueta"><span class="punto" style="background:${COLOR_CUENTA[k] || "#9A988F"}"></span>${esc(c.banco)}</span>
      <b>${c.saldo ? euros(c.saldo.importe) : "—"}</b></button>`).join("")}
  </div>
  ${cartera ? `<button class="tarjeta patrimonio" data-accion="ir" data-pestana="inversiones"><span>
      <span class="etiqueta">Patrimonio total</span><span class="nota">Cuentas ${eurosRedondo(total)} + inversiones ${eurosRedondo(cartera.total)}</span></span>
    <b>${euros(total + cartera.total)}</b></button>` : ""}
  <div class="tarjeta">
    <div class="fila"><h3>Gastado en ${MESES[+mes.slice(5, 7) - 1]}</h3>
      ${pct === null ? "" : `<span class="chip ${pct <= 0 ? "bueno" : "malo"}">${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)} %</span>`}</div>
    <div class="grande">${euros(gasto)}</div>
    <div class="nota">${pct === null ? "Sin datos del mes pasado para comparar" : `Comparado con ${MESES[+mesMas(mes, -1).slice(5, 7) - 1]} hasta el día ${dia}`} · Ingresos: ${euros(ingresos)}</div>
    ${prev ? `<div class="dato prevision"><span>Previsión a fin de mes</span><b>unos ${eurosRedondo(prev.total)}</b></div>
      <div class="nota">Si sigues al ritmo de este mes${prev.faltan.length ? `, con ${prev.faltan.length} ${prev.faltan.length === 1 ? "cargo fijo que falta" : "cargos fijos que faltan"} (${eurosRedondo(prev.fijoFalta)})` : ""}. ${MESES[+mesMas(mes, -1).slice(5, 7) - 1][0].toUpperCase() + MESES[+mesMas(mes, -1).slice(5, 7) - 1].slice(1)} entero: ${eurosRedondo(mesPasado)}.</div>` : ""}
    ${topeTotal ? barraPresupuesto(TOTAL, gasto, topeTotal, mes) : ""}
    ${cats.map(([cat, v], i) => `<div class="barra-cat" data-accion="cat" data-cat="${esc(cat)}" data-mes="${mes}">
      <div class="fila"><span>${EMOJI[cat] || "🔹"} ${esc(cat)}</span><span>${eurosRedondo(v)}</span></div>
      <div class="pista"><i style="width:${Math.max(3, (v / maximo) * 100)}%;background:${COLORES[i % COLORES.length]}"></i></div></div>`).join("")}
    <button class="enlace calculo" data-accion="calculo" data-mes="${mes}">¿Cómo se calcula esta cifra?</button>
  </div>
  ${tarjetaCargos()}
  ${tarjetaPresupuestos(mes)}
  <div class="seccion"><h3>Últimos movimientos</h3><button class="enlace" data-accion="ver-movs">Ver todos</button></div>
  <div class="lista">${datos.movimientos.filter((m) => !m._ajuste).slice(0, 6).map(filaMov).join("") || '<div class="vacio">Sin movimientos</div>'}</div>
  <p class="nota" style="text-align:center;margin-top:16px">${lineaActualizado(true)}</p>`;
}

// ---------- Filtros de Movimientos ----------
const numero = (t) => { const n = parseFloat(String(t).replace(",", ".")); return Number.isFinite(n) && n >= 0 ? n : null; };
const hayImporte = (f) => numero(f.min) !== null || numero(f.max) !== null;
const cuantosFiltros = (f) => [f.desde || f.hasta, f.categoria, f.tipo, f.cuenta, hayImporte(f)].filter(Boolean).length;
const nombreTipo = (t) => (t === "gastos" ? "Gastos" : "Ingresos");
function emojiCategoria(c) {
  return c === "Nómina" ? "💼" : c === "Ingreso" ? "💶" : c === TOTAL ? "🧮" : EMOJI[c] || "🔹";
}
function nombreImporte(f) {
  const cifra = (n) => (Number.isInteger(n) ? eurosRedondo(n) : euros(n));
  const min = numero(f.min);
  const max = numero(f.max);
  if (min !== null && max !== null) return `De ${cifra(min)} a ${cifra(max)}`;
  return min !== null ? `Desde ${cifra(min)}` : `Hasta ${cifra(max)}`;
}

function filtrar(f) {
  // Sin tildes ni mayúsculas y por palabras: "bizum ana" encuentra los Bizum con Ana. Busca también en tus notas.
  const palabras = normal(f.texto).trim().split(/\s+/).filter(Boolean);
  const texto = palabras.join(" ");
  // Si buscas un número ("21" o "21,13"), también se buscan los importes que empiezan así.
  const cifra = /^\d+([.,]\d{0,2})?$/.test(texto) ? texto.replace(".", ",") : null;
  let [desde, hasta] = [f.desde, f.hasta];
  if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
  let [min, max] = [numero(f.min), numero(f.max)];
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  return datos.movimientos.filter((m) => {
    if (m._ajuste) return false;
    if (f.cuenta && m.cuenta !== f.cuenta) return false;
    if (f.categoria && nombreCategoria(m) !== f.categoria) return false;
    // Gastos e ingresos como en el resto de la app (sin pasos entre tus cuentas ni inversión)
    if (f.tipo === "gastos" && !m._gasto) return false;
    if (f.tipo === "ingresos" && !m._ingreso) return false;
    if (desde && m.fecha < desde) return false;
    if (hasta && m.fecha > hasta) return false;
    const valor = Math.abs(m.importe);
    if (min !== null && valor < min - 0.004) return false;
    if (max !== null && valor > max + 0.004) return false;
    if (palabras.length && !(cifra && importeTexto(valor).startsWith(cifra))) {
      const t = textoMov(m);
      const c = categoriaNormal(m);
      if (!palabras.every((p) => t.includes(p) || c.includes(p))) return false;
    }
    return true;
  });
}

function chipQuitar(que, texto) {
  return `<button class="filtro activo" data-accion="quitar" data-que="${que}">${esc(texto)}<span class="x">✕</span></button>`;
}

function vistaMovimientos() {
  const f = estado.filtro;
  const n = cuantosFiltros(f);
  const chips = [`<button class="filtro boton-filtros${n ? " con-filtros" : ""}" data-accion="filtros">
    <svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>Filtros${n ? ` · ${n}` : ""}</button>`];
  const fechas = nombreRango(f.desde, f.hasta);
  if (fechas) chips.push(chipQuitar("fechas", fechas));
  if (f.categoria) chips.push(chipQuitar("categoria", `${emojiCategoria(f.categoria)} ${etiquetaTipo(f)}`));
  if (f.tipo) chips.push(chipQuitar("tipo", nombreTipo(f.tipo)));
  if (f.cuenta) chips.push(chipQuitar("cuenta", nombreCuenta(f.cuenta)));
  if (hayImporte(f)) chips.push(chipQuitar("importe", nombreImporte(f)));
  if (f.orden) chips.push(chipQuitar("orden", ORDENES.find(([v]) => v === f.orden)[1]));
  // Atajos para lo que todavía no está filtrado
  if (!fechas) {
    for (const [txt, d, h] of rapidos().filter(([t]) => ["Este mes", "Mes pasado", "Este año"].includes(t))) {
      chips.push(`<button class="filtro" data-accion="atajo" data-desde="${d}" data-hasta="${h}">${txt}</button>`);
    }
  }
  if (!f.tipo) chips.push('<button class="filtro" data-accion="atajo" data-tipo="gastos">Gastos</button>',
    '<button class="filtro" data-accion="atajo" data-tipo="ingresos">Ingresos</button>');
  if (!f.cuenta) {
    for (const c of Object.keys(datos.cuentas)) {
      chips.push(`<button class="filtro" data-accion="atajo" data-cuenta="${esc(c)}">${esc(nombreCuenta(c))}</button>`);
    }
  }
  return `
  <div class="cabecera"><h2>Movimientos</h2></div>
  <input id="buscar" class="buscar" type="search" placeholder="Buscar: Mercadona, Bizum, 21,13…" value="${esc(f.texto)}" autocomplete="off">
  <div class="filtros">${chips.join("")}</div>
  <div id="lista-movs"></div>`;
}

function resumenFiltrado(movs) {
  const f = estado.filtro;
  // Los no computables (pasos entre tus cuentas e inversión) no son gasto ni ingreso,
  // salvo que filtres justo por ellos o que solo salgan de esos (por ejemplo, al buscar un bróker).
  const computables = movs.filter((m) => !NO_GASTO.has(m.categoria) || m.categoria === f.categoria);
  const cuentan = computables.length ? computables : movs;
  const salen = suma(cuentan.filter((m) => m.importe < 0), (m) => m.importe);
  const entran = suma(cuentan.filter((m) => m.importe > 0), (m) => m.importe);
  const neto = salen + entran;
  const porCat = new Map();
  for (const m of cuentan) if (m.importe < 0) porCat.set(nombreCategoria(m), (porCat.get(nombreCategoria(m)) || 0) - m.importe);
  // Todos los tipos de gasto, de más a menos (antes solo los 5 primeros)
  const top = [...porCat.entries()].sort((a, b) => b[1] - a[1]);
  const tope = top.length ? top[0][1] : 1;
  const porIng = new Map();
  for (const m of cuentan) if (m.importe > 0) porIng.set(nombreCategoria(m), (porIng.get(nombreCategoria(m)) || 0) + m.importe);
  const ingresos = [...porIng.entries()].sort((a, b) => b[1] - a[1]);
  const topeIng = ingresos.length ? ingresos[0][1] : 1;
  const aparte = cuentan.length < movs.length ? " Sin contar los no computables: pasos entre tus cuentas e inversión."
    : !computables.length && movs.length ? " Son no computables: no cuentan como gasto ni como ingreso." : "";
  return `<div class="tarjeta resumen">
    <div class="fila"><h3>${movs.length} ${movs.length === 1 ? "movimiento" : "movimientos"}</h3>
      ${cuantosFiltros(f) || f.texto ? '<button class="enlace" data-accion="borrar-filtros">Borrar filtros</button>' : ""}</div>
    <div class="resumen-cifras">
      <div><span class="etiqueta">Salen</span><b>${euros(salen)}</b></div>
      <div><span class="etiqueta">Entran</span><b class="lima">${euros(entran, true)}</b></div>
      <div><span class="etiqueta">Diferencia</span><b class="${neto >= 0 ? "lima" : "rojo"}">${euros(neto, true)}</b></div>
    </div>
    ${aparte ? `<div class="nota">${aparte.trim()}</div>` : ""}
    ${!f.categoria && top.length > 1 ? `<div class="etiqueta" style="margin-top:14px">En qué se fue</div>
      ${top.map(([cat, v], i) => `<button class="barra-cat" data-accion="filtrar-cat" data-cat="${esc(cat)}">
        <div class="fila"><span>${emojiCategoria(cat)} ${esc(cat)}</span><span>${eurosRedondo(v)}</span></div>
        <div class="pista"><i style="width:${Math.max(3, (v / tope) * 100)}%;background:${COLORES[i % COLORES.length]}"></i></div></button>`).join("")}` : ""}
    ${!f.categoria && ingresos.length > 1 ? `<div class="etiqueta" style="margin-top:14px">De dónde vino</div>
      ${ingresos.map(([cat, v]) => `<button class="barra-cat" data-accion="filtrar-cat" data-cat="${esc(cat)}" data-tipo="ingresos">
        <div class="fila"><span>${emojiCategoria(cat)} ${esc(nombreIngreso(cat))}</span><span>${eurosRedondo(v)}</span></div>
        <div class="pista"><i style="width:${Math.max(3, (v / topeIng) * 100)}%;background:var(--lima)"></i></div></button>`).join("")}` : ""}
  </div>`;
}

const ORDENES = [["", "Más recientes"], ["antiguos", "Más antiguos"], ["importe", "Mayor importe"]];

function pintarLista() {
  const f = estado.filtro;
  let movs = filtrar(f);
  let html = cuantosFiltros(f) || f.texto.trim() ? resumenFiltrado(movs) : "";
  if (f.orden === "importe") {
    // Sin días: cada movimiento lleva su fecha
    movs = movs.slice().sort((a, b) => Math.abs(b.importe) - Math.abs(a.importe));
    const vistos = movs.slice(0, estado.limite);
    if (vistos.length) html += `<div class="lista" style="margin-top:14px">${vistos.map((m) => filaMov(m, true)).join("")}</div>`;
  } else {
    if (f.orden === "antiguos") movs = movs.slice().reverse();
    // El total de cada día (lo que entra menos lo que sale), sin los no computables, como el resumen
    const totales = new Map();
    for (const m of movs) {
      if (!NO_GASTO.has(m.categoria) || m.categoria === f.categoria) totales.set(m.fecha, (totales.get(m.fecha) || 0) + m.importe);
    }
    let dia = "";
    let grupo = [];
    const cerrar = () => {
      if (grupo.length) {
        html += `<div class="dia"><span>${mayuscula(fechaDia(dia))}</span><span class="${(totales.get(dia) || 0) > 0.004 ? "lima" : ""}">${totales.has(dia) ? euros(totales.get(dia), true) : ""}</span></div>
          <div class="lista">${grupo.join("")}</div>`;
      }
      grupo = [];
    };
    for (const m of movs.slice(0, estado.limite)) {
      if (m.fecha !== dia) { cerrar(); dia = m.fecha; }
      grupo.push(filaMov(m));
    }
    cerrar();
  }
  if (!movs.length) html += '<div class="vacio">No hay movimientos con ese filtro.</div>';
  if (movs.length > estado.limite) html += `<button class="mas-boton" id="mas-movs" data-accion="mas-movs">Ver más (${movs.length - estado.limite})</button>`;
  $("#lista-movs").innerHTML = html;
  observarFinal();
}

// La lista carga sola al acercarte al final (el botón "Ver más" queda por si acaso)
let observador = null;
function observarFinal() {
  if (!("IntersectionObserver" in window)) return;
  if (!observador) {
    observador = new IntersectionObserver((entradas) => {
      if (estado.pestana === "movimientos" && entradas.some((e) => e.isIntersecting)) { estado.limite += 120; pintarLista(); }
    }, { rootMargin: "800px 0px" });
  }
  observador.disconnect();
  const boton = $("#mas-movs");
  if (boton) observador.observe(boton);
}

// ---------- Tipos (rehecho el 17/11) ----------
// Usa el mismo periodo y la misma comparación que Ahorro (estado.ahorro) y el mismo resumen(desde, hasta),
// que se calcula una vez por carga: cambiar de periodo, de orden o de comparación es instantáneo.
const COLORES_REPARTO = ["var(--lima)", "var(--violeta)", "var(--turquesa)", "var(--ambar)"];
const DIAS_PLURAL = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];

// De dónde viene lo que entra: nómina, Bizum recibidos, devoluciones de cada tipo…
function nombreIngreso(c) {
  if (c === "Nómina" || c === "Ingreso" || NO_GASTO.has(c)) return c;
  if (c === "Bizum y transferencias a personas") return "Bizum y transferencias recibidas";
  if (c === "Apuestas") return "Lo que vuelve de las apuestas";
  return `Devoluciones · ${c}`;
}
const esDeTipo = (m, cat, ingreso) => (ingreso ? m._ingreso && nombreCategoria(m) === cat : m._gasto && m.categoria === cat);
const valorMov = (m, ingreso) => (ingreso ? m.importe : -m.importe);
// "Frente a octubre 2026 hasta el día 17" → "Octubre 2026 hasta el día 17"
const etiquetaAntes = (c) => mayuscula(c.frente.replace(/^Frente (a |al )?/, ""));
// Cambio de un tipo: "nuevo" si antes no había
function cambioTipo(a, b, ingreso) {
  if (b < 0.5 && a >= 0.5) return '<span class="suave">nuevo</span>';
  return textoCambio(a, b, ingreso);
}
// Meses que dura un periodo (para "al mes, de media"); si hay datos desde más tarde, desde ahí
const mesesDe = (p) => Math.max(1, (diasEntre(p.desde < primeraFecha() ? primeraFecha() : p.desde, p.hasta) + 1) / 30.44);

// Todo lo que necesita la pantalla: el periodo, su resumen, la comparación y los tipos de más a menos
function contextoTipos() {
  const t = estado.tipos;
  const p = periodoAhorro();
  const r = resumen(p.desde, p.hasta);
  const ingreso = t.vista === "ingresos";
  const opciones = opcionesComparar(p);
  if (!opciones.some(([v]) => v === estado.ahorro.comparar)) estado.ahorro.comparar = opciones[0][0];
  const c = comparacion(p, estado.ahorro.comparar);
  const mapa = ingreso ? r.ingresoTipo : r.gastoTipo;
  const antes = c ? (ingreso ? c.r.ingresoTipo : c.r.gastoTipo) : new Map();
  const veces = ingreso ? r.nIngreso : r.nGasto;
  const tipos = [...mapa.entries()].filter(([, v]) => v > 0.005)
    .map(([cat, v]) => ({ cat, v, b: antes.get(cat) || 0, n: veces.get(cat) || 0 })).sort((x, y) => y.v - x.v);
  const ordenes = [["gasto", ingreso ? "Más ingreso" : "Más gasto"], ...(c ? [["cambio", "Más cambio"]] : []), ...(ingreso ? [] : [["grupos", "Por grupos"]])];
  const orden = ordenes.some(([v]) => v === t.orden) ? t.orden : "gasto";
  return { t, p, r, c, ingreso, opciones, ordenes, orden, mapa, antes, tipos, total: ingreso ? r.ingresos : r.gastos,
    colores: new Map(tipos.slice(0, 4).map((x, i) => [x.cat, COLORES_REPARTO[i]])) };
}

function vistaTipos() {
  const x = contextoTipos();
  const a = estado.ahorro;
  return `<div class="cabecera"><h2>Tipos</h2><button class="enlace" data-accion="presupuestos">Presupuestos</button></div>
  <div class="segmento" style="margin-bottom:10px">${[["gastos", "Gastos"], ["ingresos", "Ingresos"]].map(([v, txt]) =>
    `<button class="${x.t.vista === v ? "activo" : ""}" data-accion="tipos-vista" data-v="${v}">${txt}</button>`).join("")}</div>
  <div class="segmento" style="margin-bottom:14px">${[["mes", "Mes"], ["anio", "Año"], ["fechas", "Elegir fechas"]].map(([v, txt]) =>
    `<button class="${a.modo === v ? "activo" : ""}" data-accion="ahorro-modo" data-v="${v}">${txt}</button>`).join("")}</div>
  ${navPeriodo(x.p)}
  ${tarjetaTotalTipos(x)}
  ${controlesTipos(x)}
  <div class="lista" id="lista-tipos" style="margin-top:10px">${filasTipos(x)}</div>
  ${aparteTipos(x)}
  <p class="nota" style="margin:12px 4px">${x.ingreso ? "Lo que entra, sin contar los pasos entre tus cuentas ni lo que vuelve de la inversión."
    : "Sin contar los pasos entre tus cuentas ni la inversión (no computables)."} El periodo y la comparación son los mismos que en Ahorro. Toca un tipo para ver su ficha.</p>`;
}

// Lo gastado (o lo que ha entrado), su cambio, el reparto entre los 4 tipos principales y el resto, y el presupuesto
function tarjetaTotalTipos(x) {
  const { p, c, ingreso, tipos, colores, total } = x;
  if (!tipos.length) return `<div class="tarjeta"><div class="vacio">${ingreso ? "No ha entrado nada" : "No hay gastos"} en este periodo.</div></div>`;
  const antes = c ? (ingreso ? c.r.ingresos : c.r.gastos) : 0;
  const top = tipos.slice(0, 4);
  const resto = total - suma(top, (y) => y.v);
  const trozos = top.map((y) => [y.v, colores.get(y.cat), ingreso ? nombreIngreso(y.cat) : y.cat]);
  if (resto > 0.005) trozos.push([resto, "var(--tenue)", `${tipos.length - 4} ${tipos.length - 4 === 1 ? "tipo más" : "tipos más"}`]);
  const pct = (v) => (total > 0 ? Math.round((v / total) * 100) : 0);
  let pie = "";
  if (!ingreso && p.tipo === "mes") {
    const tope = datos.presupuestos[TOTAL];
    const prev = p.enCurso ? prevision(null) : null;
    pie = tope ? barraPresupuesto(TOTAL, total, tope, p.mes)
      : `${prev && prev.total > total + 0.5 ? `<div class="dato prevision"><span>A este ritmo, a fin de mes</span><b>unos ${eurosRedondo(prev.total)}</b></div>` : ""}
        <button class="enlace" data-accion="presupuestos" style="margin-top:10px">Ponerle un presupuesto al mes</button>`;
  } else if (p.tipo !== "mes") {
    pie = `<div class="dato prevision"><span>Al mes, de media</span><b>${eurosRedondo(total / mesesDe(p))}</b></div>`;
    if (p.tipo === "anio" && p.enCurso) {
      const pasados = diasEntre(p.desde, p.hasta) + 1;
      const diasAnio = diasEntre(p.desde, `${p.anio}-12-31`) + 1;
      pie += `<div class="dato"><span>A este ritmo, a fin de año</span><span>unos ${eurosRedondo((total / pasados) * diasAnio)}</span></div>`;
    }
  }
  return `<div class="tarjeta">
    <h3>${ingreso ? "Ha entrado" : "Gastado"}${p.enCurso ? " (hasta hoy)" : ""}</h3>
    <div class="grande${ingreso ? " lima" : ""}">${euros(total)}</div>
    ${c ? `<div class="comparado">${textoCambio(total, antes, ingreso)} <span class="suave">· ${esc(etiquetaAntes(c))}: ${eurosRedondo(antes)}</span></div>` : ""}
    <div class="reparto-barra" role="img" aria-label="Reparto por tipos">${trozos.map(([v, color]) => `<i style="flex:${v.toFixed(2)};background:${color}"></i>`).join("")}</div>
    <div class="leyenda-tipos">${trozos.map(([v, color, nombre]) => `<span><i style="background:${color}"></i>${esc(nombre)} <b>${pct(v)} %</b></span>`).join("")}</div>
    ${pie}
  </div>`;
}

function controlesTipos(x) {
  return `<div class="tarjeta">
    <h3>Comparar con</h3>
    <div class="opciones" style="margin-top:8px">${x.opciones.map(([v, t]) => `<button class="filtro${v === estado.ahorro.comparar ? " activo" : ""}" data-accion="ahorro-comparar" data-v="${v}">${esc(t)}</button>`).join("")}</div>
    <div class="nota" style="margin-top:8px">${x.c ? `${esc(x.c.frente)}.${x.c.nota ? ` ${esc(x.c.nota)}` : ""}` : "No hay datos de antes para comparar."}</div>
    <h3 style="margin-top:14px">Ordenar</h3>
    <div class="opciones" style="margin-top:8px">${x.ordenes.map(([v, t]) => `<button class="filtro${v === x.orden ? " activo" : ""}" data-accion="tipos-orden" data-v="${v}">${t}</button>`).join("")}</div>
  </div>
  <input class="buscar" id="buscar-tipo" type="search" placeholder="Buscar un tipo o un comercio" value="${esc(x.t.q)}" autocomplete="off" enterkeyhint="search">`;
}

// Movimientos del periodo cuyo comercio, concepto o nota tienen todas las palabras, sumados por tipo
function comerciosQueCoinciden(p, ingreso, palabras) {
  const res = new Map();
  for (const m of movsEntre(p.desde, p.hasta)) {
    if (m._ajuste || !(ingreso ? m._ingreso : m._gasto)) continue;
    const texto = textoMov(m);
    if (!palabras.every((w) => texto.includes(w))) continue;
    const cat = ingreso ? nombreCategoria(m) : m.categoria;
    const e = res.get(cat) || { v: 0, n: 0 };
    e.v += valorMov(m, ingreso);
    e.n += 1;
    res.set(cat, e);
  }
  return res;
}

// La lista de tipos (se vuelve a pintar sola al escribir en el buscador, sin perder el teclado)
function filasTipos(x) {
  const { t, p, c, ingreso, colores, total, orden } = x;
  let lista = x.tipos.slice();
  if (orden === "cambio") {
    for (const [cat, b] of x.antes) if (b >= 1 && !(x.mapa.get(cat) > 0.005)) lista.push({ cat, v: 0, b, n: 0 });
    lista.sort((a, b) => Math.abs(b.v - b.b) - Math.abs(a.v - a.b));
  }
  const palabras = normal(t.q).trim().split(/\s+/).filter(Boolean);
  const fechas = `data-desde="${p.desde}" data-hasta="${p.hasta}"`;
  let enComercios = null;
  if (palabras.length) {
    enComercios = comerciosQueCoinciden(p, ingreso, palabras);
    lista = lista.filter((y) => enComercios.has(y.cat)
      || palabras.every((w) => pajar(y.cat).includes(w) || normal(ingreso ? nombreIngreso(y.cat) : y.cat).includes(w)));
  }
  const maximo = Math.max(1, ...x.tipos.map((y) => y.v));
  const fila = (y) => {
    const tope = !ingreso && p.tipo === "mes" ? datos.presupuestos[y.cat] : 0;
    const cm = enComercios && enComercios.get(y.cat);
    return `<button class="cat" data-accion="cat" data-cat="${esc(y.cat)}"${ingreso ? ' data-ingreso="1"' : ""}${p.tipo === "mes" ? ` data-mes="${p.mes}"` : ""}>
      <div class="fila"><span class="cat-nombre">${emojiCategoria(y.cat)} <span>${esc(ingreso ? nombreIngreso(y.cat) : y.cat)}</span></span><b${ingreso ? ' class="lima"' : ""}>${euros(y.v)}</b></div>
      <div class="pista"><i style="width:${y.v > 0.005 ? Math.max(2, (y.v / maximo) * 100) : 0}%;background:${colores.get(y.cat) || "var(--tenue)"}"></i></div>
      <div class="fila comparado"><span class="suave">${y.n ? `${total > 0 ? Math.round((y.v / total) * 100) : 0} % · ${y.n} ${y.n === 1 ? "vez" : "veces"} · ${eurosRedondo(y.v / y.n)} de media`
        : y.v > 0.005 ? `${total > 0 ? Math.round((y.v / total) * 100) : 0} %` : `Nada en este periodo · antes ${eurosRedondo(y.b)}`}</span>${c ? `<span>${cambioTipo(y.v, y.b, ingreso)}</span>` : ""}</div>
      ${tope ? `<div class="comparado ${y.v > tope ? "rojo" : y.v >= tope * 0.8 ? "ambar" : "suave"}">Presupuesto ${eurosRedondo(tope)} · ${y.v <= tope ? `quedan ${eurosRedondo(tope - y.v)}` : `te has pasado ${eurosRedondo(y.v - tope)}`}</div>` : ""}
      ${cm ? `<div class="comparado lima">«${esc(t.q.trim())}»: ${cm.n} ${cm.n === 1 ? "vez" : "veces"} · ${euros(cm.v)}</div>` : ""}
    </button>`;
  };
  const buscarEnMovs = palabras.length ? `<button class="mas-boton" data-accion="movs" data-q="${esc(t.q.trim())}" ${fechas}>Buscar «${esc(t.q.trim())}» en Movimientos</button>` : "";
  if (!lista.length) {
    return palabras.length ? `<div class="vacio">Ningún tipo ni comercio con «${esc(t.q.trim())}» en este periodo.</div>${buscarEnMovs}`
      : `<div class="vacio">${ingreso ? "No ha entrado nada" : "Sin gastos"} en este periodo.</div>`;
  }
  if (orden === "grupos") {
    const grupos = new Map();
    for (const y of lista) {
      const g = y.cat === "Efectivo (cajero)" ? "Efectivo" : GRUPO_DE[y.cat] || "Otros gastos";
      if (!grupos.has(g)) grupos.set(g, []);
      grupos.get(g).push(y);
    }
    return [...grupos.entries()].map(([g, ys]) => ({ g, ys, v: suma(ys, (y) => y.v) })).sort((a, b) => b.v - a.v)
      .map(({ g, ys, v }) => `<div class="grupo-tipos"><span>${esc(g)}</span><span>${eurosRedondo(v)}${total > 0 ? ` · ${Math.round((v / total) * 100)} %` : ""}</span></div>
        ${ys.map(fila).join("")}`).join("") + buscarEnMovs;
  }
  return lista.map(fila).join("") + buscarEnMovs;
}

// Aparte: la inversión (no computable) y el resultado de las apuestas
function aparteTipos({ p, r }) {
  const fechas = `data-desde="${p.desde}" data-hasta="${p.hasta}"`;
  const filas = [];
  if (r.metido > 0.5 || r.vuelto > 0.5) {
    filas.push(`<button class="cat" data-accion="movs" data-cat="Inversión" ${fechas}>
      <div class="fila"><span class="cat-nombre">📈 <span>Inversión · no computable</span></span><b class="suave">${euros(r.inversion)}</b></div>
      <div class="comparado suave">Metido ${eurosRedondo(r.metido)}${r.vuelto > 0.5 ? ` · vuelto ${eurosRedondo(r.vuelto)}` : ""}. No cuenta como gasto: el dinero sigue siendo tuyo</div></button>`);
  }
  const metido = r.gastoTipo.get("Apuestas") || 0;
  const vuelto = r.ingresoTipo.get("Apuestas") || 0;
  if (metido > 0.5 || vuelto > 0.5) {
    filas.push(`<button class="cat" data-accion="movs" data-cat="Apuestas" ${fechas}>
      <div class="fila"><span class="cat-nombre">🎲 <span>Apuestas: resultado</span></span><b class="${vuelto - metido >= 0 ? "lima" : "rojo"}">${euros(vuelto - metido, true)}</b></div>
      <div class="comparado suave">Metido ${eurosRedondo(metido)} (cuenta como gasto) · vuelto ${eurosRedondo(vuelto)} (cuenta como ingreso)</div></button>`);
  }
  return filas.length ? `<div class="seccion"><h3>Inversión y apuestas</h3></div><div class="lista">${filas.join("")}</div>` : "";
}

// ---------- Ficha de un tipo ----------
// Gasto (o ingreso) de un tipo en cada mes de todo el historial, calculado una vez por carga
function serieTipo(cat, ingreso) {
  return calculado(`serie-${ingreso ? "i" : "g"}-${cat}`, () => {
    const meses = new Map();
    for (let mes = primerMes(); mes <= mesActual(); mes = mesMas(mes, 1)) {
      let v = 0;
      let n = 0;
      for (const m of delMes(mes)) if (esDeTipo(m, cat, ingreso)) { v += valorMov(m, ingreso); if (!m._ajuste) n++; }
      meses.set(mes, { v, n });
    }
    return meses;
  });
}
let fichaTipo = null;   // la última ficha abierta, para cambiar entre meses y años sin perderla
// La ficha es de un mes, de un año o (sin ninguno) del periodo de Tipos y Ahorro
function periodoFicha(o) {
  if (o.mes) return periodoMes(o.mes);
  if (o.anio) return periodoAnio(+o.anio);
  return periodoAhorro();
}

function hojaTipo(cat, d = {}) {
  const ingreso = d.ingreso === "1" || d.ingreso === true;
  const o = { mes: d.mes || "", anio: d.anio || "", ingreso };
  fichaTipo = { cat, o };
  const p = periodoFicha(o);
  const nombre = ingreso ? nombreIngreso(cat) : cat;
  const movs = movsEntre(p.desde, p.hasta).filter((m) => esDeTipo(m, cat, ingreso));
  const reales = movs.filter((m) => !m._ajuste);
  const v = suma(movs, (m) => valorMov(m, ingreso));
  const serie = serieTipo(cat, ingreso);
  const delMapa = (r) => (ingreso ? r.ingresoTipo : r.gastoTipo).get(cat) || 0;
  const atIngreso = ingreso ? ' data-ingreso="1"' : "";
  const tipoMovs = `data-tipo="${ingreso ? "ingresos" : "gastos"}"`;
  // Comparación: la misma que en Tipos y Ahorro
  const opciones = opcionesComparar(p);
  const c = comparacion(p, opciones.some(([x]) => x === estado.ahorro.comparar) ? estado.ahorro.comparar : opciones[0][0]);
  const b = c ? delMapa(c.r) : 0;
  // Media al mes: los últimos 12 meses cerrados
  const cerrados = [];
  for (let i = 1; i <= 12; i++) { const mes = mesMas(mesActual(), -i); if (mes < primerMes()) break; cerrados.push(serie.get(mes).v); }
  const media = cerrados.length ? suma(cerrados, (x) => x) / cerrados.length : 0;

  // Gráfico: 12 meses (el elegido, con hasta 6 después) o cada año
  const escala = estado.tipos.escala;
  let cols = [];
  if (escala === "anios") {
    for (let a = +primerMes().slice(0, 4); a <= +hoy().slice(0, 4); a++) {
      let total = 0;
      for (const [mes, s] of serie) if (+mes.slice(0, 4) === a) total += s.v;
      cols.push({ at: `data-anio="${a}"`, etiqueta: String(a), nombre: String(a), v: total, elegida: p.tipo === "anio" ? a === p.anio : a === +p.hasta.slice(0, 4) });
    }
  } else {
    const ultimo = p.tipo === "mes" ? p.mes : p.hasta.slice(0, 7);
    const fin = p.tipo === "mes" && mesMas(ultimo, 6) < mesActual() ? mesMas(ultimo, 6) : p.tipo === "mes" ? mesActual() : ultimo;
    for (let i = 11; i >= 0; i--) {
      const mes = mesMas(fin, -i);
      if (mes < primerMes()) continue;
      cols.push({ at: `data-mes="${mes}"`, etiqueta: mesCorto(mes), nombre: nombreMes(mes), v: serie.get(mes).v,
        elegida: mes >= p.desde.slice(0, 7) && mes <= p.hasta.slice(0, 7) });
    }
  }
  const tope = Math.max(1, ...cols.map((x) => x.v));
  const grafico = `<div class="segmento" style="margin-top:4px">${[["meses", "Meses"], ["anios", "Años"]].map(([x, txt]) =>
      `<button class="${escala === x ? "activo" : ""}" data-h="tipo-escala" data-v="${x}">${txt}</button>`).join("")}</div>
    <div class="grafico barras-tipo">${cols.map((x) => `<button class="columna${x.elegida ? " elegida" : ""}" data-h="tipo" data-cat="${esc(cat)}"${atIngreso} ${x.at} aria-label="${esc(x.nombre)}: ${esc(eurosRedondo(x.v))}">
      <span class="par"><i style="height:${Math.max(0, (x.v / tope) * 100).toFixed(1)}%"></i></span><span>${x.etiqueta}</span></button>`).join("")}</div>
    <div class="nota">Toca ${escala === "anios" ? "un año" : "un mes"} para verlo.${escala === "meses" && cerrados.length ? ` Media: ${eurosRedondo(media)} al mes.` : ""}</div>`;

  // Datos: este año, frente al anterior, media, veces, cada cuántos días, mes más alto y el último
  const anio = +p.hasta.slice(0, 4);
  const anioEnCurso = anio === +hoy().slice(0, 4);
  const esteAnio = delMapa(resumen(`${anio}-01-01`, hastaHoy(`${anio}-12-31`)));
  const anioAntes = primerMes() <= `${anio - 1}-01` ? delMapa(resumen(`${anio - 1}-01-01`, anioEnCurso ? moverMeses(hoy(), -12) : `${anio - 1}-12-31`)) : null;
  const desde12 = sumarDias(moverMeses(p.hasta, -12), 1);
  const ultimos12 = movsEntre(desde12, p.hasta).filter((m) => esDeTipo(m, cat, ingreso) && !m._ajuste);
  const dias12 = diasEntre(desde12 < primeraFecha() ? primeraFecha() : desde12, p.hasta) + 1;
  const frecuencia = ultimos12.length < 2 ? "—" : dias12 / ultimos12.length < 1
    ? `${(ultimos12.length / dias12).toFixed(1).replace(".", ",")} veces al día` : dias12 / ultimos12.length < 1.5 ? "Casi cada día" : `Cada ${Math.round(dias12 / ultimos12.length)} días`;
  let alto = null;
  for (const [mes, s] of serie) if (s.v > 0.5 && (!alto || s.v > alto.v)) alto = { mes, v: s.v };
  const ultimo = datos.movimientos.find((m) => !m._ajuste && esDeTipo(m, cat, ingreso));
  const celda = (etiqueta, valor, extra = "") => `<div><span>${etiqueta}</span><b>${valor}</b>${extra ? `<small>${extra}</small>` : ""}</div>`;
  const datosTipo = `<div class="datos-tipo">
    ${celda(`En ${anio}${anioEnCurso ? " (hasta hoy)" : ""}`, eurosRedondo(esteAnio),
      anioAntes === null ? "" : `${cambioTipo(esteAnio, anioAntes, ingreso)} frente a ${anio - 1}${anioEnCurso ? " a estas alturas" : ""}`)}
    ${celda("Media al mes", cerrados.length ? eurosRedondo(media) : "—", cerrados.length ? `últimos ${cerrados.length} ${cerrados.length === 1 ? "mes" : "meses"} cerrados` : "")}
    ${celda("Veces en el periodo", String(reales.length), reales.length ? `${euros(v / reales.length)} de media` : "")}
    ${celda("Frecuencia", frecuencia, `${ultimos12.length} ${ultimos12.length === 1 ? "vez" : "veces"} en 12 meses`)}
    ${celda("Mes más alto", alto ? mayuscula(nombreMes(alto.mes)) : "—", alto ? eurosRedondo(alto.v) : "")}
    ${celda("El último", ultimo ? fechaCorta(ultimo.fecha) : "—", ultimo ? `${esc(titulo(ultimo))} · ${euros(Math.abs(ultimo.importe))}` : "")}
  </div>`;

  // Presupuesto (solo gastos): se cambia aquí mismo
  const presu = datos.presupuestos[cat];
  const mediaRedonda = Math.ceil(media);
  const presupuesto = ingreso ? "" : `${p.tipo === "mes" && presu ? barraPresupuesto(cat, v, presu, p.mes) : ""}
    <div class="hoja-seccion"><span>Presupuesto al mes</span>${mediaRedonda >= 1 ? `<button class="enlace" data-h="presu-media" data-v="${mediaRedonda}">Usar mi media (${eurosRedondo(mediaRedonda)})</button>` : ""}</div>
    <div class="presu-ficha">
      <input type="text" inputmode="decimal" data-presu="${esc(cat)}" value="${presu ? String(presu).replace(".", ",") : ""}" placeholder="Sin límite" autocomplete="off" aria-label="Presupuesto al mes">
      <button class="boton-mini" data-ap="guardar-presu">Guardar</button>
    </div>
    <div class="nota">Vacío, sin límite. Al llegar al 80 % se pone en ámbar y, si te pasas, en rojo.</div>`;

  // Dónde (o de quién): cada comercio del periodo, con su %
  const porComercio = new Map();
  for (const m of reales) {
    const k = claveComercio(m) || normal(titulo(m));
    const e = porComercio.get(k) || { nombre: titulo(m), v: 0, n: 0 };
    e.v += valorMov(m, ingreso);
    e.n += 1;
    porComercio.set(k, e);
  }
  const comercios = [...porComercio.entries()].sort((x, y) => y[1].v - x[1].v);
  const fechas = `data-desde="${p.desde}" data-hasta="${p.hasta}"`;
  const donde = comercios.length ? `<div class="hoja-seccion"><span>${ingreso ? "De quién" : "Dónde"}</span><span>${comercios.length} ${ingreso ? (comercios.length === 1 ? "origen" : "orígenes") : comercios.length === 1 ? "sitio" : "sitios"}</span></div>
    <div class="lista lista-hoja">${comercios.slice(0, 8).map(([k, e]) => `<button class="mov" data-h="movs" data-cat="${esc(cat)}" ${tipoMovs} data-q="${esc(k)}" ${fechas}>
      <span class="mov-texto"><b>${esc(e.nombre)}</b><span>${v > 0.005 ? `${Math.round((e.v / v) * 100)} % · ` : ""}${e.n} ${e.n === 1 ? "vez" : "veces"}</span></span><span class="importe">${euros(e.v)}</span></button>`).join("")}</div>
    ${comercios.length > 8 ? `<div class="nota">Y ${comercios.length - 8} más: los ves en sus movimientos.</div>` : ""}` : "";

  // Qué día de la semana se gasta más (los últimos 12 meses)
  let semana = "";
  if (!ingreso && ultimos12.length >= 3) {
    const dias = [0, 0, 0, 0, 0, 0, 0];
    for (const m of ultimos12) dias[new Date(`${m.fecha}T12:00:00`).getDay()] += -m.importe;
    const orden = [1, 2, 3, 4, 5, 6, 0];
    const totalSemana = suma(dias, (x) => x);
    const mayor = orden.reduce((a, i) => (dias[i] > dias[a] ? i : a), 1);
    const topeSemana = Math.max(1, ...dias);
    semana = `<div class="hoja-seccion"><span>Qué día gastas más</span><span>últimos 12 meses</span></div>
      <div class="grafico barras-tipo semana">${orden.map((i) => `<div class="columna${i === mayor ? " elegida" : ""}" aria-label="${DIAS_PLURAL[i]}: ${esc(eurosRedondo(dias[i]))}">
        <span class="par"><i style="height:${((dias[i] / topeSemana) * 100).toFixed(1)}%"></i></span><span>${DIAS[i]}</span></div>`).join("")}</div>
      <div class="nota">Los ${DIAS_PLURAL[mayor]}: ${totalSemana > 0 ? Math.round((dias[mayor] / totalSemana) * 100) : 0} % de lo gastado en ${esc(nombre.toLowerCase())}.</div>`;
  }

  const cuando = p.tipo === "mes" ? MESES[+p.mes.slice(5, 7) - 1] : p.tipo === "anio" ? String(p.anio) : "este periodo";
  abrirHoja(`<div class="fila" style="justify-content:flex-start"><span class="emoji">${emojiCategoria(cat)}</span><h3 class="hoja-titulo">${esc(nombre)}</h3></div>
    <div class="nota" style="margin-top:8px">${esc(p.nombre)}${p.enCurso ? ", hasta hoy" : ""}</div>
    <div class="grande${ingreso ? " lima" : ""}" style="margin-bottom:2px">${euros(v)}</div>
    ${c ? `<div class="comparado">${cambioTipo(v, b, ingreso)} <span class="suave">· ${esc(etiquetaAntes(c))}: ${eurosRedondo(b)}</span></div>
      ${c.nota ? `<div class="nota">${esc(c.nota)}</div>` : ""}` : ""}
    ${grafico}
    ${datosTipo}
    ${presupuesto}
    ${donde}
    ${semana}
    ${reales.length ? `<div class="hoja-seccion"><span>Sus movimientos de ${esc(cuando)}</span><span>${reales.length}</span></div>
      <div class="lista lista-hoja">${reales.slice(0, 8).map((m) => filaMov(m, true)).join("")}</div>` : ""}
    ${reales.length ? `<button class="boton ancho" data-h="movs" data-cat="${esc(cat)}" ${tipoMovs} ${fechas}>Ver ${reales.length === 1 ? "su movimiento" : `sus ${reales.length} movimientos`} de ${esc(cuando)}</button>` : ""}
    <button class="boton-sec" data-h="movs" data-cat="${esc(cat)}" ${tipoMovs}>Ver todos sus movimientos</button>
    <button class="boton-sec" data-cerrar>Cerrar</button>`);
}

// ---------- Ahorro (rehecho el 16/11) ----------
// Un periodo es un intervalo de fechas con nombre: un mes, un año o unas fechas elegidas. Todo sale de
// resumen(desde, hasta), que se calcula una vez y se guarda hasta que llegan datos nuevos.
const hastaHoy = (f) => (f > hoy() ? hoy() : f);
const primeraFecha = () => (datos.movimientos.length ? datos.movimientos[datos.movimientos.length - 1].fecha : hoy());
function sumarDias(f, n) { const d = new Date(`${f}T12:00:00`); d.setDate(d.getDate() + n); return iso(d); }
// La misma fecha n meses antes o después (el 31 pasa a ser el último día si ese mes no lo tiene)
function moverMeses(f, n) {
  const mes = mesMas(f.slice(0, 7), n);
  return `${mes}-${String(Math.min(+f.slice(8), +ultimoDia(mes).slice(8))).padStart(2, "0")}`;
}
function movsEntre(desde, hasta) {
  const lista = [];
  for (let mes = desde.slice(0, 7) < primerMes() ? primerMes() : desde.slice(0, 7); mes <= hasta.slice(0, 7); mes = mesMas(mes, 1)) {
    for (const m of delMes(mes)) if (m.fecha >= desde && m.fecha <= hasta) lista.push(m);
  }
  return lista;
}
// Ingresos, gastos e inversión de un periodo, con cada tipo y cada bróker
function resumen(desde, hasta) {
  return calculado(`res-${desde}-${hasta}`, () => {
    const r = { ingresos: 0, gastos: 0, metido: 0, vuelto: 0, gastoTipo: new Map(), ingresoTipo: new Map(), brokers: new Map(),
      nGasto: new Map(), nIngreso: new Map() };
    const sumar = (mapa, c, v) => mapa.set(c, (mapa.get(c) || 0) + v);
    for (const m of movsEntre(desde, hasta)) {
      if (m._gasto) { r.gastos -= m.importe; sumar(r.gastoTipo, m.categoria, -m.importe); if (!m._ajuste) sumar(r.nGasto, m.categoria, 1); }
      else if (m._ingreso) { r.ingresos += m.importe; sumar(r.ingresoTipo, nombreCategoria(m), m.importe); sumar(r.nIngreso, nombreCategoria(m), 1); }
      else if (m.categoria === "Inversión") {
        const b = r.brokers.get(titulo(m)) || { metido: 0, vuelto: 0 };
        if (m.importe < 0) { r.metido -= m.importe; b.metido -= m.importe; } else { r.vuelto += m.importe; b.vuelto += m.importe; }
        r.brokers.set(titulo(m), b);
      }
    }
    return conTotales(r);
  });
}
function conTotales(r) {
  r.inversion = r.metido - r.vuelto;   // lo metido menos lo que ha vuelto
  r.ahorro = r.ingresos - r.gastos;    // la inversión también es ahorro: el dinero sigue siendo tuyo
  r.queda = r.ahorro - r.inversion;    // lo que se queda en tus cuentas
  r.pct = r.ingresos > 0 ? Math.round((r.ahorro / r.ingresos) * 100) : null;
  return r;
}
// La media de varios periodos (para "Tu media")
function mediaDe(lista) {
  const n = lista.length;
  const r = { ingresos: 0, gastos: 0, metido: 0, vuelto: 0, gastoTipo: new Map(), ingresoTipo: new Map(), brokers: new Map(),
      nGasto: new Map(), nIngreso: new Map() };
  for (const x of lista) {
    for (const k of ["ingresos", "gastos", "metido", "vuelto"]) r[k] += x[k] / n;
    for (const k of ["gastoTipo", "ingresoTipo", "nGasto", "nIngreso"]) for (const [c, v] of x[k]) r[k].set(c, (r[k].get(c) || 0) + v / n);
  }
  return conTotales(r);
}

function periodoMes(mes) {
  const [d, h] = rangoMes(mes);
  return { tipo: "mes", mes, desde: d, hasta: hastaHoy(h), nombre: mayuscula(nombreMes(mes)), corto: `${mesCorto(mes)} ${mes.slice(2, 4)}`, enCurso: mes === mesActual() };
}
function periodoAnio(anio) {
  const [d, h] = rangoAnio(anio);
  return { tipo: "anio", anio, desde: d, hasta: hastaHoy(h), nombre: String(anio), corto: String(anio), enCurso: anio === +hoy().slice(0, 4) };
}
function periodoAhorro() {
  const a = estado.ahorro;
  const anioActual = +hoy().slice(0, 4);
  if (a.modo === "anio") {
    a.anio = Math.min(anioActual, Math.max(+primerMes().slice(0, 4), a.anio || anioActual));
    return periodoAnio(a.anio);
  }
  if (a.modo === "fechas") {
    let [d, h] = [a.desde || mesesAtras(3), hastaHoy(a.hasta || hoy())];
    if (d > h) [d, h] = [h, d];
    return { tipo: "fechas", desde: d, hasta: h, nombre: nombreRango(d, h), corto: "Ahora", enCurso: h === hoy() };
  }
  const mes = a.mes && a.mes >= primerMes() && a.mes <= mesActual() ? a.mes : mesActual();
  a.mes = mes;
  return periodoMes(mes);
}

function opcionesComparar(p) {
  if (p.tipo === "mes") return [["anterior", "Mes anterior"], ["anio", `${mayuscula(MESES[+p.mes.slice(5, 7) - 1])} de ${+p.mes.slice(0, 4) - 1}`], ["media", "Tu media"]];
  if (p.tipo === "anio") return [["anterior", `${p.anio - 1}`]];
  return [["anterior", "Periodo anterior"], ["anio", "Un año antes"]];
}

// El periodo con el que se compara. En uno en curso, hasta el mismo día, para que sea justo.
function comparacion(p, como) {
  if (como === "media" && p.tipo === "mes") {
    const dia = +p.hasta.slice(8);
    const lista = [];
    for (let i = 1; i <= 12; i++) {
      const mes = mesMas(p.mes, -i);
      if (mes < primerMes()) break;
      lista.push(resumen(`${mes}-01`, p.enCurso ? `${mes}-${String(Math.min(dia, +ultimoDia(mes).slice(8))).padStart(2, "0")}` : ultimoDia(mes)));
    }
    if (!lista.length) return null;
    return { r: mediaDe(lista), corto: "Media", frente: `Frente a tu media de ${lista.length} ${lista.length === 1 ? "mes" : "meses"}`,
      nota: p.enCurso ? `Cada mes hasta el día ${dia}, como este.` : "" };
  }
  let desde, hasta;
  if (como === "anio" || p.tipo === "anio") { desde = moverMeses(p.desde, -12); hasta = moverMeses(p.hasta, -12); }
  else if (p.tipo === "mes") { desde = moverMeses(p.desde, -1); hasta = p.enCurso ? moverMeses(p.hasta, -1) : ultimoDia(desde.slice(0, 7)); }
  else { hasta = sumarDias(p.desde, -1); desde = sumarDias(hasta, -diasEntre(p.desde, p.hasta)); }
  if (hasta < primeraFecha()) return null;
  let nombre, corto;
  if (p.tipo === "mes") {
    const mes = desde.slice(0, 7);
    nombre = nombreMes(mes) + (hasta < ultimoDia(mes) ? ` hasta el día ${+hasta.slice(8)}` : "");
    corto = `${mesCorto(mes)} ${mes.slice(2, 4)}`;
  } else if (p.tipo === "anio") {
    nombre = desde.slice(0, 4) + (hasta.slice(5) !== "12-31" ? ` hasta el ${fechaCorta(hasta, false)}` : "");
    corto = desde.slice(0, 4);
  } else {
    nombre = `al periodo del ${fechaCorta(desde, desde.slice(0, 4) !== hasta.slice(0, 4))} al ${fechaCorta(hasta)}`;
    corto = "Antes";
  }
  return { r: resumen(desde, hasta), desde, hasta, corto, frente: p.tipo === "fechas" ? `Frente ${nombre}` : `Frente a ${nombre}`,
    nota: desde < primeraFecha() ? `Hay datos desde el ${fechaCorta(primeraFecha())}: ese periodo está incompleto.` : "" };
}

function vistaAhorro() {
  const a = estado.ahorro;
  const p = periodoAhorro();
  const r = resumen(p.desde, p.hasta);
  const opciones = opcionesComparar(p);
  if (!opciones.some(([v]) => v === a.comparar)) a.comparar = opciones[0][0];
  const c = comparacion(p, a.comparar);
  return `
  <div class="cabecera"><h2>Ahorro</h2>${botonDiscreto()}</div>
  <div class="segmento" style="margin-bottom:14px">${[["mes", "Mes"], ["anio", "Año"], ["fechas", "Elegir fechas"]].map(([v, t]) =>
    `<button class="${a.modo === v ? "activo" : ""}" data-accion="ahorro-modo" data-v="${v}">${t}</button>`).join("")}</div>
  ${navPeriodo(p)}
  ${tarjetaReparto(p, r)}
  ${tarjetaComparar(p, r, c, opciones)}
  ${graficoAhorro(p)}
  ${p.tipo === "fechas" ? "" : tarjetaAnio(p)}
  ${tarjetaSaldo()}
  ${tablaAhorro(p)}
  <p class="nota" style="margin:10px 4px">Ahorro es lo que entra menos los gastos. Lo que va a inversión también es ahorro (lo metido menos lo que vuelve): no es gasto, porque el dinero sigue siendo tuyo. No se cuentan los pasos entre tus cuentas. Las apuestas sí cuentan: lo metido como gasto y lo que vuelve como ingreso.</p>`;
}

function navPeriodo(p) {
  if (p.tipo === "mes") return `<div class="mes-nav">
    <button data-accion="ahorro-nav" data-dir="-1" ${p.mes <= primerMes() ? "disabled" : ""} aria-label="Mes anterior">‹</button>
    <b>${nombreMes(p.mes)}${p.enCurso ? '<small class="en-curso"> · hasta hoy</small>' : ""}</b>
    <button data-accion="ahorro-nav" data-dir="1" ${p.enCurso ? "disabled" : ""} aria-label="Mes siguiente">›</button></div>`;
  if (p.tipo === "anio") return `<div class="mes-nav">
    <button data-accion="ahorro-nav" data-dir="-1" ${p.anio <= +primerMes().slice(0, 4) ? "disabled" : ""} aria-label="Año anterior">‹</button>
    <b>${p.anio}${p.enCurso ? '<small class="en-curso"> · hasta hoy</small>' : ""}</b>
    <button data-accion="ahorro-nav" data-dir="1" ${p.enCurso ? "disabled" : ""} aria-label="Año siguiente">›</button></div>`;
  const limites = `min="${primeraFecha()}" max="${hoy()}"`;
  const atajos = rapidos().filter(([t]) => ["Últimos 30 días", "Últimos 3 meses", "Últimos 12 meses", "Mes pasado", "Año pasado"].includes(t));
  return `<div class="tarjeta">
    <div class="dos">
      <label class="campo"><span>Desde</span><input type="date" data-ahorro-fecha="desde" ${limites} value="${p.desde}"></label>
      <label class="campo"><span>Hasta</span><input type="date" data-ahorro-fecha="hasta" ${limites} value="${p.hasta}"></label></div>
    <div class="opciones" style="margin-top:10px">${atajos.map(([t, d, h]) => `<button class="filtro${p.desde === d && p.hasta === hastaHoy(h) ? " activo" : ""}"
      data-accion="ahorro-rango" data-desde="${d}" data-hasta="${h}">${t}</button>`).join("")}</div></div>`;
}

// Lo que entra, repartido: gastos, inversión y lo que se queda en tus cuentas
function tarjetaReparto(p, r) {
  if (!r.ingresos && !r.gastos && !r.metido && !r.vuelto) return `<div class="tarjeta"><div class="vacio">No hay movimientos en este periodo.</div></div>`;
  const inv = Math.max(0, r.inversion);
  const trozos = [[r.gastos, "var(--violeta)"], [inv, "var(--turquesa)"], [Math.max(0, r.queda), "var(--lima)"]].filter(([v]) => v > 0.005);
  const pct = (v) => (r.ingresos > 0 ? `<small class="pct-fila">${Math.round((v / r.ingresos) * 100)} %</small>` : "");
  const fila = (color, texto, v) => `<div class="reparto-fila"><span><i style="background:${color}"></i>${texto}</span><span>${euros(v)}${pct(v)}</span></div>`;
  return `<div class="tarjeta">
    <h3>Entra${p.enCurso ? " (hasta hoy)" : ""}</h3>
    <div class="grande lima">${euros(r.ingresos)}</div>
    <div class="reparto-barra" role="img" aria-label="Reparto de lo que entra">${trozos.map(([v, color]) => `<i style="flex:${v.toFixed(2)};background:${color}"></i>`).join("")}</div>
    ${fila("var(--violeta)", "Gastos", r.gastos)}
    ${r.inversion > 0.005 ? fila("var(--turquesa)", "A inversión", r.inversion) : ""}
    ${r.queda >= -0.005 ? fila("var(--lima)", "Se queda en tus cuentas", r.queda)
      : `<div class="reparto-fila rojo"><span>Sale de tus ahorros</span><span>${euros(-r.queda)}</span></div>`}
    ${r.inversion < -0.005 ? `<div class="nota">Han vuelto ${euros(-r.inversion)} de tus inversiones (más de lo que has metido).</div>` : ""}
    <div class="reparto-total"><span>Ahorras</span><b class="${r.ahorro >= 0 ? "lima" : "rojo"}">${euros(r.ahorro, true)}${r.pct !== null ? ` · ${textoPct(r.pct)}` : ""}</b></div>
  </div>`;
}

// Cambio entre dos cifras: "+120 € (+8 %)". bueno: true si subir es bueno, false si es malo, null si da igual
function textoCambio(a, b, bueno, conPct = true) {
  const d = a - b;
  if (Math.abs(d) < 0.5) return '<span class="suave">=</span>';
  const clase = bueno === null ? "" : (d > 0) === bueno ? "lima" : "rojo";
  const pct = conPct && Math.abs(b) >= 1 ? Math.round((d / Math.abs(b)) * 100) : null;
  return `<span class="${clase}">${d > 0 ? "+" : "−"}${eurosRedondo(Math.abs(d))}${pct !== null && Math.abs(pct) >= 1 && Math.abs(pct) < 1000 ? `<small> ${d > 0 ? "+" : "−"}${Math.abs(pct)} %</small>` : ""}</span>`;
}
function tablaCambios(r, c, p) {
  const fila = (nombre, a, b, bueno, fuerte = false, conPct = true) => `<div class="${fuerte ? "fuerte" : ""}">${nombre}</div>
    <div>${eurosRedondo(a)}</div><div class="suave">${eurosRedondo(b)}</div><div>${textoCambio(a, b, bueno, conPct)}</div>`;
  return `<div class="cambios">
    <div class="cab"></div><div class="cab">${esc(p.corto)}</div><div class="cab">${esc(c.corto)}</div><div class="cab">Cambio</div>
    ${fila("Ingresos", r.ingresos, c.r.ingresos, true)}
    ${fila("Gastos", r.gastos, c.r.gastos, false)}
    ${fila("Inversión", r.inversion, c.r.inversion, null, false, false)}
    ${fila("Ahorro", r.ahorro, c.r.ahorro, true, true, false)}
  </div>`;
}

function tarjetaComparar(p, r, c, opciones) {
  const a = estado.ahorro;
  return `<div class="tarjeta">
    <h3>Comparar con</h3>
    <div class="opciones">${opciones.map(([v, t]) => `<button class="filtro${v === a.comparar ? " activo" : ""}" data-accion="ahorro-comparar" data-v="${v}">${esc(t)}</button>`).join("")}</div>
    ${c ? `${tablaCambios(r, c, p)}
      <div class="nota" style="margin-top:8px">${esc(c.frente)}.${c.nota ? ` ${esc(c.nota)}` : ""}</div>`
      : '<div class="nota" style="margin-top:10px">No hay datos de antes para comparar.</div>'}
    <button class="boton-sec" data-accion="ahorro-detalle" style="margin-top:12px">Ver el detalle y la comparación</button>
  </div>`;
}

// Columnas de ingresos, gastos e inversión. Al tocar una, todo lo de arriba pasa a ese mes o año.
function graficoAhorro(p) {
  let cols = [];
  let titulo = "";
  const deMes = (mes) => ({ at: `data-mes="${mes}"`, etiqueta: mesCorto(mes), nombre: nombreMes(mes), r: resumen(`${mes}-01`, hastaHoy(ultimoDia(mes))), elegida: p.tipo === "mes" && mes === p.mes });
  const deAnio = (a) => ({ at: `data-anio="${a}"`, etiqueta: String(a), nombre: String(a), r: resumen(`${a}-01-01`, hastaHoy(`${a}-12-31`)), elegida: p.tipo === "anio" && a === p.anio });
  if (p.tipo === "mes") {
    const fin = mesMas(p.mes, 6) < mesActual() ? mesMas(p.mes, 6) : mesActual();
    for (let i = 11; i >= 0; i--) { const mes = mesMas(fin, -i); if (mes >= primerMes()) cols.push(deMes(mes)); }
    titulo = fin === mesActual() ? `Últimos ${cols.length} meses` : `De ${nombreMes(mesMas(fin, -cols.length + 1))} a ${nombreMes(fin)}`;
  } else if (p.tipo === "anio") {
    for (let a = +primerMes().slice(0, 4); a <= +hoy().slice(0, 4); a++) cols.push(deAnio(a));
    titulo = "Cada año";
  } else {
    const meses = [];
    for (let mes = p.desde.slice(0, 7); mes <= p.hasta.slice(0, 7); mes = mesMas(mes, 1)) if (mes >= primerMes()) meses.push(mes);
    if (meses.length > 24) {
      for (let a = +p.desde.slice(0, 4); a <= +p.hasta.slice(0, 4); a++) cols.push(deAnio(a));
      titulo = "Cada año";
    } else {
      cols = meses.map(deMes);
      titulo = "Mes a mes (meses enteros)";
    }
  }
  if (!cols.length) return "";
  const tope = Math.max(1, ...cols.map((x) => Math.max(x.r.ingresos, x.r.gastos, x.r.inversion)));
  const alto = (v) => `${Math.max(0, (v / tope) * 100).toFixed(1)}%`;
  return `<div class="tarjeta">
    <div class="fila"><h3>${esc(titulo)}</h3><span class="nota">Toca uno para verlo</span></div>
    <div class="grafico tres">${cols.map((x) => `<button class="columna${x.elegida ? " elegida" : ""}" data-accion="ahorro-ir" ${x.at}
      aria-label="${esc(x.nombre)}: entra ${esc(eurosRedondo(x.r.ingresos))}, gastos ${esc(eurosRedondo(x.r.gastos))}, inversión ${esc(eurosRedondo(x.r.inversion))}">
      <span class="par"><i style="height:${alto(x.r.ingresos)};background:var(--lima)"></i><i style="height:${alto(x.r.gastos)};background:var(--violeta)"></i><i style="height:${alto(x.r.inversion)};background:var(--turquesa)"></i></span>
      <span>${esc(x.etiqueta)}</span><small class="${x.r.pct === null ? "" : x.r.pct >= 0 ? "lima" : "rojo"}">${x.r.pct === null ? "" : textoPct(x.r.pct).replace(" ", "")}</small></button>`).join("")}</div>
    <div class="leyenda"><span><i style="background:var(--lima)"></i>Ingresos</span><span><i style="background:var(--violeta)"></i>Gastos</span><span><i style="background:var(--turquesa)"></i>Inversión</span></div>
    <div class="nota" style="margin-top:6px">Debajo de cada uno, el % que ahorras de lo que entra.</div>
  </div>`;
}

// El año del periodo: lo ahorrado, frente al año anterior, a este ritmo, y el mejor y el peor mes
function tarjetaAnio(p) {
  const anio = p.tipo === "anio" ? p.anio : +p.mes.slice(0, 4);
  const anioActual = +hoy().slice(0, 4);
  const enCurso = anio === anioActual;
  const r = resumen(`${anio}-01-01`, hastaHoy(`${anio}-12-31`));
  const fin = enCurso ? hoy().slice(5) : "12-31";
  const antes = `${anio - 1}-12-31` >= primeraFecha() ? resumen(`${anio - 1}-01-01`, `${anio - 1}-${fin}`) : null;
  const meses = [];
  for (let i = 1; i <= 12; i++) {
    const mes = `${anio}-${String(i).padStart(2, "0")}`;
    if (mes >= primerMes() && mes < mesActual()) meses.push([mes, resumen(`${mes}-01`, ultimoDia(mes)).ahorro]);
  }
  meses.sort((x, y) => y[1] - x[1]);
  const dias = diasEntre(`${anio}-01-01`, hoy()) + 1;
  const total = diasEntre(`${anio}-01-01`, `${anio}-12-31`) + 1;
  const ritmo = enCurso && dias >= 30 && `${anio}-01-01` >= primeraFecha() ? (r.ahorro / dias) * total : null;
  const mesTxt = ([mes, v]) => `${MESES[+mes.slice(5, 7) - 1]} (${v > 0.5 ? "+" : ""}${eurosRedondo(v)})`;
  const lineas = [];
  if (p.tipo === "mes") {
    lineas.push(`<div class="medio ${r.ahorro >= 0 ? "lima" : "rojo"}">${euros(r.ahorro, true)}<small> ahorrados${r.pct !== null ? ` · ${textoPct(r.pct)}` : ""}</small></div>`);
    if (antes) lineas.push(`<div class="dato"><span>${anio - 1}${enCurso ? " a estas alturas" : ""}</span><span>${euros(antes.ahorro, true)}${antes.pct !== null ? ` · ${textoPct(antes.pct)}` : ""}</span></div>`);
  }
  if (ritmo !== null) lineas.push(`<div class="dato"><span>A este ritmo, acabarás ${anio} con</span><span class="${ritmo >= 0 ? "lima" : "rojo"}">${eurosRedondo(ritmo)}</span></div>`);
  if (meses.length >= 2) {
    lineas.push(`<div class="dato"><span>Mejor mes</span><span>${esc(mesTxt(meses[0]))}</span></div>`);
    lineas.push(`<div class="dato"><span>Peor mes</span><span>${esc(mesTxt(meses[meses.length - 1]))}</span></div>`);
    lineas.push(`<div class="dato"><span>Ahorro medio al mes</span><span>${eurosRedondo(suma(meses, ([, v]) => v) / meses.length)}</span></div>`);
  }
  if (!lineas.length) return "";
  return `<div class="tarjeta${p.tipo === "mes" ? " tarjeta-boton" : ""}" ${p.tipo === "mes" ? `data-accion="ahorro-ir" data-anio="${anio}" role="button" tabindex="0"` : ""}>
    <div class="fila"><h3>${enCurso ? `En lo que va de ${anio}` : `En ${anio}`}</h3>${p.tipo === "mes" ? '<span class="nota">Ver el año</span>' : ""}</div>
    ${lineas.join("")}
    ${meses.length >= 2 ? `<div class="nota" style="margin-top:8px">Mejor, peor y media: meses ya cerrados.</div>` : ""}</div>`;
}

// Todos los meses (o años) en una tabla. Al tocar uno, se ve arriba.
function tablaAhorro(p) {
  let filas = [];
  if (p.tipo === "anio") {
    for (let a = +hoy().slice(0, 4); a >= +primerMes().slice(0, 4); a--) filas.push({ at: `data-anio="${a}"`, nombre: `${a}${a === +hoy().slice(0, 4) ? "*" : ""}`, r: resumen(`${a}-01-01`, hastaHoy(`${a}-12-31`)), elegida: a === p.anio });
  } else {
    const [ini, fin] = p.tipo === "fechas" ? [p.desde.slice(0, 7), p.hasta.slice(0, 7)] : [primerMes(), mesActual()];
    for (let mes = fin; mes >= ini && mes >= primerMes(); mes = mesMas(mes, -1)) {
      filas.push({ at: `data-mes="${mes}"`, nombre: `${mesCorto(mes)} ${mes.slice(2, 4)}${mes === mesActual() ? "*" : ""}`, r: resumen(`${mes}-01`, hastaHoy(ultimoDia(mes))), elegida: p.tipo === "mes" && mes === p.mes });
    }
  }
  if (!filas.length) return "";
  const celda = (f, html, clase = "") => `<div class="sep${f.elegida ? " elegida" : ""}${clase ? ` ${clase}` : ""}" data-accion="ahorro-ir" ${f.at}>${html}</div>`;
  return `<div class="seccion"><h3>${p.tipo === "anio" ? "Todos los años" : p.tipo === "fechas" ? "Cada mes del periodo" : "Todos los meses"}</h3></div>
  <div class="lista"><div class="tabla-ahorro">
    <div class="cab">${p.tipo === "anio" ? "Año" : "Mes"}</div><div class="cab">Ingresos</div><div class="cab">Gastos</div><div class="cab">Inversión</div><div class="cab">Ahorro</div>
    ${filas.map((f) => `${celda(f, esc(f.nombre))}${celda(f, eurosRedondo(f.r.ingresos))}${celda(f, eurosRedondo(f.r.gastos))}${celda(f, eurosRedondo(f.r.inversion), "turquesa")}${celda(f,
      `${discreto ? OCULTO : `${f.r.ahorro < -0.5 ? "−" : "+"}${eurosRedondo(Math.abs(f.r.ahorro))}`}<small class="pct">${textoPct(f.r.pct)}</small>`, f.r.ahorro >= 0 ? "lima" : "rojo")}`).join("")}
  </div></div>
  <p class="nota" style="margin:8px 4px 0">* En curso, hasta hoy.</p>`;
}
const textoPct = (pct) => (pct === null ? "" : `${pct < 0 ? "−" : ""}${Math.abs(pct)} %`);

// Dinero en tus cuentas al final de cada día: hacia atrás desde el saldo de hoy, restando los movimientos.
// Empieza cuando todas las cuentas tienen movimientos (antes faltaría alguna).
function serieSaldo() {
  return calculado("saldo", () => {
    const cuentas = Object.entries(datos.cuentas).filter(([, c]) => c.saldo);
    const ids = new Set(cuentas.map(([k]) => k));
    const lista = datos.movimientos.filter((m) => !m._apunte && !m._ajuste && ids.has(m.cuenta));
    if (!lista.length) return [];
    const primeros = new Map();
    for (const m of lista) primeros.set(m.cuenta, m.fecha);   // van del más nuevo al más antiguo: queda el primero
    const inicio = [...primeros.values()].sort().pop();
    let total = suma(cuentas, ([, c]) => c.saldo.importe);
    let i = 0;
    while (i < lista.length && lista[i].fecha > hoy()) total -= lista[i++].importe;
    const pts = [];
    const d = new Date(`${hoy()}T12:00:00`);
    for (let f = hoy(); f >= inicio; d.setDate(d.getDate() - 1), f = iso(d)) {
      pts.push([new Date(`${f}T12:00:00Z`), Math.round(total * 100) / 100]);
      while (i < lista.length && lista[i].fecha === f) total -= lista[i++].importe;
    }
    return pts.reverse();
  });
}

// Línea pequeña para las tarjetas (sin ejes: la tarjeta se toca para ver el gráfico de verdad)
function miniLinea(vals, color = "var(--lima)") {
  if (vals.length < 2) return "";
  const paso = Math.max(1, Math.floor(vals.length / 120));
  const v = vals.filter((_, i) => i % paso === 0 || i === vals.length - 1);
  const min = Math.min(...v), alto = Math.max(...v) - min || 1;
  const d = v.map((x, i) => `${i ? "L" : "M"}${((i / (v.length - 1)) * 320).toFixed(1)},${(4 + (1 - (x - min) / alto) * 40).toFixed(1)}`).join("");
  return `<svg class="mini" viewBox="0 0 320 48" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

function tarjetaSaldo() {
  const pts = serieSaldo();
  if (pts.length < 2) return "";
  const ano = recortar(pts, 366);
  return `<div class="tarjeta tarjeta-boton" data-accion="saldo" role="button" tabindex="0">
    <div class="fila"><h3>Dinero en tus cuentas</h3><span class="nota">Ver</span></div>
    ${miniLinea(ano.map((x) => x[1]))}
    <div class="dato"><span>${fechaCorta(iso(ano[0][0]))} → hoy</span><span>${euros(ano[0][1])} → ${euros(ano[ano.length - 1][1])}</span></div></div>`;
}

const RANGOS_SALDO = [["1M", 31], ["6M", 183], ["1A", 366], ["Todo", Infinity]];
function hojaSaldo() {
  const pts = serieSaldo();
  grafico = { id: "saldo", rangos: RANGOS_SALDO, rango: estado.rangos.saldo || "1A", fmt: (v) => euros(v),
    puntos: (dias) => recortar(serieSaldo(), dias), vacio: "Aún no hay movimientos suficientes." };
  abrirHoja(`<h3 style="font-size:20px;margin-bottom:2px">Dinero en tus cuentas</h3>
    <div class="nota">Saldo de todas tus cuentas al final de cada día</div>
    <div id="graf-zona">${zonaGrafico()}</div>
    <p class="nota" style="margin-top:8px">Calculado hacia atrás desde el saldo de hoy, con tus movimientos${pts.length ? `, desde el ${fechaCorta(iso(pts[0][0]))} (cuando ya están todas las cuentas)` : ""}. Sin las inversiones.</p>
    <button class="boton-sec" data-cerrar>Cerrar</button>`);
}

// El detalle del periodo y su comparación: cifras, dónde has gastado más y menos, de dónde vino y la inversión
function hojaComparar() {
  const p = periodoAhorro();
  const r = resumen(p.desde, p.hasta);
  const c = comparacion(p, estado.ahorro.comparar);
  const fechas = `data-desde="${p.desde}" data-hasta="${p.hasta}"`;
  // Un tipo lleva a su ficha, con este mismo periodo
  const irTipo = (cat) => `data-h="tipo" data-cat="${esc(cat)}"`;
  const tipos = [...new Set([...r.gastoTipo.keys(), ...(c ? c.r.gastoTipo.keys() : [])])]
    .map((cat) => ({ cat, a: r.gastoTipo.get(cat) || 0, b: c ? c.r.gastoTipo.get(cat) || 0 : 0 }))
    .filter((t) => Math.abs(t.a) > 0.5 || Math.abs(t.b) > 0.5);
  const filaTipo = (t) => `<button class="mov" ${irTipo(t.cat)}><span class="emoji">${emojiCategoria(t.cat)}</span>
    <span class="mov-texto"><b>${esc(t.cat)}</b><span>${eurosRedondo(t.a)}${c ? ` · antes ${eurosRedondo(t.b)}` : ""}</span></span>
    <span class="importe">${c ? textoCambio(t.a, t.b, false) : eurosRedondo(t.a)}</span></button>`;
  let gastos = "";
  if (c) {
    const mas = tipos.filter((t) => t.a - t.b >= 0.5).sort((x, y) => (y.a - y.b) - (x.a - x.b));
    const menos = tipos.filter((t) => t.a - t.b <= -0.5).sort((x, y) => (x.a - x.b) - (y.a - y.b));
    gastos = `${mas.length ? `<div class="hoja-seccion"><span>Has gastado más en</span><span>${mas.length} ${mas.length === 1 ? "tipo" : "tipos"}</span></div>
      <div class="lista lista-hoja">${mas.map(filaTipo).join("")}</div>` : ""}
      ${menos.length ? `<div class="hoja-seccion"><span>Has gastado menos en</span><span>${menos.length} ${menos.length === 1 ? "tipo" : "tipos"}</span></div>
      <div class="lista lista-hoja">${menos.map(filaTipo).join("")}</div>` : ""}`;
  } else if (tipos.length) {
    const tope = Math.max(...tipos.map((t) => t.a));
    gastos = `<div class="hoja-seccion"><span>En qué se fue</span><span>${euros(r.gastos)}</span></div>
      ${tipos.sort((x, y) => y.a - x.a).map((t, i) => `<button class="barra-cat bloque" ${irTipo(t.cat)}>
        <div class="fila"><span>${emojiCategoria(t.cat)} ${esc(t.cat)}</span><span>${eurosRedondo(t.a)}</span></div>
        <div class="pista"><i style="width:${Math.max(3, (t.a / (tope || 1)) * 100)}%;background:${COLORES[i % COLORES.length]}"></i></div></button>`).join("")}`;
  }
  const ingresos = [...new Set([...r.ingresoTipo.keys(), ...(c ? c.r.ingresoTipo.keys() : [])])]
    .map((cat) => ({ cat, a: r.ingresoTipo.get(cat) || 0, b: c ? c.r.ingresoTipo.get(cat) || 0 : 0 }))
    .filter((t) => Math.abs(t.a) > 0.5 || Math.abs(t.b) > 0.5).sort((x, y) => y.a - x.a);
  const brokers = [...r.brokers.entries()].sort((x, y) => (y[1].metido - y[1].vuelto) - (x[1].metido - x[1].vuelto));
  abrirHoja(`<h3 class="hoja-titulo">${esc(p.nombre)}${p.enCurso ? '<small class="en-curso"> · hasta hoy</small>' : ""}</h3>
    ${c ? `<div class="nota">${esc(c.frente)}</div>
      ${tablaCambios(r, c, p)}
      <div class="cambios cambios-pct"><div>% que ahorras</div><div>${textoPct(r.pct) || "—"}</div><div class="suave">${textoPct(c.r.pct) || "—"}</div>
        <div>${r.pct !== null && c.r.pct !== null && r.pct !== c.r.pct ? `<span class="${r.pct > c.r.pct ? "lima" : "rojo"}">${r.pct > c.r.pct ? "+" : "−"}${Math.abs(r.pct - c.r.pct)} pts</span>` : '<span class="suave">=</span>'}</div></div>
      ${c.nota ? `<div class="nota" style="margin-top:6px">${esc(c.nota)}</div>` : ""}`
      : `<div class="resumen-cifras" style="margin-top:12px">
      <div><span class="etiqueta">Ingresos</span><b class="lima">${euros(r.ingresos)}</b></div>
      <div><span class="etiqueta">Gastos</span><b>${euros(r.gastos)}</b></div>
      <div><span class="etiqueta">Ahorro</span><b class="${r.ahorro >= 0 ? "lima" : "rojo"}">${euros(r.ahorro, true)}</b></div></div>`}
    ${gastos}
    ${ingresos.length ? `<div class="hoja-seccion"><span>De dónde vino</span><span>${euros(r.ingresos)}</span></div>
      <div class="lista lista-hoja">${ingresos.map((t) => `<button class="mov" data-h="tipo" data-cat="${esc(t.cat)}" data-ingreso="1">
        <span class="emoji">${emojiCategoria(t.cat)}</span><span class="mov-texto"><b>${esc(nombreIngreso(t.cat))}</b><span>${eurosRedondo(t.a)}${c ? ` · antes ${eurosRedondo(t.b)}` : ""}</span></span>
        <span class="importe">${c ? textoCambio(t.a, t.b, true) : `<span class="lima">${eurosRedondo(t.a)}</span>`}</span></button>`).join("")}</div>` : ""}
    ${brokers.length || (c && Math.abs(c.r.inversion) > 0.5) ? `<div class="hoja-seccion"><span>Inversión</span><span>${euros(r.inversion)}${c ? ` · antes ${eurosRedondo(c.r.inversion)}` : ""}</span></div>
      <div class="lista lista-hoja">${brokers.map(([nombre, b]) => `<button class="mov" data-h="movs" data-cat="Inversión" data-q="${esc(nombre)}" ${fechas}>
        <span class="emoji">📈</span><span class="mov-texto"><b>${esc(nombre)}</b><span>Metido ${eurosRedondo(b.metido)}${b.vuelto > 0.5 ? ` · vuelto ${eurosRedondo(b.vuelto)}` : ""}</span></span>
        <span class="importe turquesa">${eurosRedondo(b.metido - b.vuelto)}</span></button>`).join("") || '<div class="vacio">Nada a inversión en este periodo.</div>'}</div>` : ""}
    ${p.tipo !== "fechas" ? `<button class="boton ancho" data-h="ver-tipos" ${p.tipo === "mes" ? `data-mes="${p.mes}"` : `data-anio="${p.anio}"`}>Ver en Tipos</button>` : ""}
    <button class="boton-sec" data-h="movs" ${fechas}>Ver sus movimientos</button>
    <button class="boton-sec" data-cerrar>Cerrar</button>`);
}

// ---------- Inversiones (fase 5) ----------
// Los datos traen cada bróker con su nombre y el valor que hay que mandar a GitHub para actualizarlo:
// así el código de la app (público) no dice qué brókeres son.
const TIPOS_INV = { stock: "Acciones", fund: "Fondos y ETF", etf: "Fondos y ETF", crypto: "Cripto", bond: "Bonos" };
const COLOR_TIPO = { "Acciones": "#8F87E8", "Fondos y ETF": "#5DCAA5", "Cripto": "#F2B544", "Bonos": "#6FB7F2",
  "Otros": "#9A988F", "Efectivo": "#6B6A64" };
const MOVS_INV = { TRADING_TRADE_EXECUTED: "Compra o venta", TRADING_SAVINGSPLAN_EXECUTED: "Plan de ahorro",
  BANK_TRANSACTION_INCOMING: "Ingreso", BANK_TRANSACTION_OUTGOING: "Retirada", INTEREST_PAYOUT: "Intereses",
  SSP_CORPORATE_ACTION_CASH: "Dividendo", CREDIT: "Dividendo", PAYMENT_INBOUND: "Ingreso", PAYMENT_OUTBOUND: "Retirada" };
const actualizando = { boton: "", antes: null, hasta: 0, error: "", sondeo: null };

function brokers() {
  const inv = datos.inversiones || {};
  return Object.entries(inv).filter(([, b]) => b && Array.isArray(b.posiciones));
}

// Cada producto con su valor de hoy. Sin precio de Yahoo, se valora a lo que costó (y se avisa).
function productos() {
  const precios = (datos.inversiones && datos.inversiones.precios) || {};
  const lista = [];
  for (const [clave, b] of brokers()) {
    for (const p of b.posiciones) {
      const pr = precios[p.isin];
      const precio = pr ? pr.precio : p.precio_medio;
      const valor = p.cantidad * precio;
      const coste = p.cantidad * p.precio_medio;
      const dia = pr && pr.dia !== null && pr.dia !== undefined ? pr.dia : null;
      lista.push({ ...p, broker: clave, nombreBroker: b.nombre || clave, precio, valor, coste, ganancia: valor - coste,
        dia, hoy: dia === null ? 0 : valor - valor / (1 + dia / 100), pr, tipoNombre: TIPOS_INV[p.tipo] || "Otros" });
    }
  }
  return lista.sort((a, b) => b.valor - a.valor);
}

// Planes de ahorro: cada cuánto y cuánto suponen al mes
const INTERVALOS = { monthly: ["cada mes", 1], weekly: ["cada semana", 52 / 12], biweekly: ["cada dos semanas", 26 / 12],
  twoPerMonth: ["dos veces al mes", 2], quarterly: ["cada trimestre", 1 / 3] };
const COLOR_BROKER = ["#8F87E8", "#5DCAA5", "#F2B544", "#6FB7F2"];
const ORDEN_PROD = [["valor", "Valor"], ["ganancia", "Ganancia"], ["hoy", "Hoy"]];
const COBROS = { INTEREST_PAYOUT: "Intereses", CREDIT: "Dividendo", SSP_CORPORATE_ACTION_CASH: "Dividendo" };
const COMPRAS = new Set(["TRADING_TRADE_EXECUTED", "TRADING_SAVINGSPLAN_EXECUTED"]);
const pctGanancia = (p) => (p.coste ? (p.ganancia / p.coste) * 100 : null);
const nombreSimple = (t) => normal(t).replace(/[^a-z0-9]+/g, " ").trim();
const fechaMov = (m) => String(m.fecha || "").slice(0, 10);

function planesCartera() {
  return brokers().flatMap(([clave, b]) => (b.planes || []).map((pl) => {
    const [texto, factor] = INTERVALOS[pl.intervalo] || [pl.intervalo || "", null];
    return { ...pl, broker: clave, nombreBroker: b.nombre || clave, texto,
      alMes: pl.pausado || factor === null ? 0 : (pl.importe || 0) * factor };
  }));
}

// Dividendos e intereses: los cobros que traen los movimientos de los brókeres (solo los que dan movimientos)
function cobrosCartera() {
  return calculado("cobros", () => brokers().flatMap(([clave, b]) => (b.movimientos || [])
    .filter((m) => COBROS[m.tipo] && (m.importe || 0) > 0 && m.fecha)
    .map((m) => ({ ...m, clase: COBROS[m.tipo], nombreBroker: b.nombre || clave })))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1)));
}
// Desde cuándo hay movimientos de los brókeres guardados (cada actualización añade los nuevos)
function primerMovInv() {
  const f = brokers().flatMap(([, b]) => (b.movimientos || []).map(fechaMov)).filter(Boolean).sort();
  return f[0] || null;
}

const fmtPct = (n, dec = 1) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(dec).replace(".", ",")} %`);
const chipPct = (n) => (n === null || n === undefined ? "" : `<span class="chip ${n >= 0 ? "bueno" : "malo"}">${fmtPct(n, 2)}</span>`);
function cantidad(n) {
  if (discreto) return OCULTO;
  return n.toLocaleString("es-ES", { maximumFractionDigits: n < 1 ? 6 : n < 100 ? 4 : 2 });
}
function precioUnidad(n) {
  return `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 })} €`;
}

function bandaActualizar() {
  if (actualizando.error) {
    const motivo = { permiso: "GitHub no acepta el permiso de la app: puede haber caducado", red: "Sin conexión",
      github: "GitHub no responde", tiempo: "No ha llegado la cartera. ¿Confirmaste en el móvil? Vuelve a intentarlo",
      "falta-permiso": "Falta dar a la app el permiso de GitHub (en el portátil)" }[actualizando.error] || "No se ha podido actualizar";
    return `<div class="alerta roja">${motivo}.</div>`;
  }
  if (!actualizando.boton) return "";
  const b = (datos.inversiones || {})[actualizando.boton] || {};
  return `<div class="alerta violeta"><b>Confirma en la app de ${esc(b.nombre || "tu bróker")} en el móvil.</b>
    El aviso llega en menos de un minuto y tienes 2 minutos para confirmarlo. Después, la cartera tarda unos segundos en aparecer.</div>`;
}

function vistaInversiones() {
  const lista = brokers();
  if (!lista.length) {
    return `<div class="cabecera"><h2>Inversiones</h2></div>
      <div class="vacio">Todavía no hay ninguna cartera conectada.</div>`;
  }
  const { prods, efectivo, invertido, total, coste, hoyEur } = totalCartera();
  const ganancia = invertido - coste;
  const ayer = invertido - hoyEur;
  const porBroker = estado.reparto === "broker";
  const valorBroker = (clave, b) => suma(prods.filter((p) => p.broker === clave), (p) => p.valor) + (b.efectivo || 0);
  const reparto = {};
  const color = {};
  if (porBroker) {
    lista.forEach(([clave, b], i) => {
      const nombre = b.nombre || clave;
      reparto[nombre] = valorBroker(clave, b);
      color[nombre] = COLOR_BROKER[i] || "#9A988F";
    });
  } else {
    for (const p of prods) reparto[p.tipoNombre] = (reparto[p.tipoNombre] || 0) + p.valor;
    if (efectivo) reparto["Efectivo"] = efectivo;
  }
  const repartoOrden = Object.entries(reparto).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  const orden = {
    valor: (a, b) => b.valor - a.valor,
    ganancia: (a, b) => (pctGanancia(b) ?? -1e9) - (pctGanancia(a) ?? -1e9),
    hoy: (a, b) => (b.dia ?? -1e9) - (a.dia ?? -1e9),
  }[estado.ordenProd] || ((a, b) => b.valor - a.valor);
  const prodsOrden = prods.slice().sort(orden);
  const lineaProd = (p) => {
    if (!p.pr) return "sin precio de hoy";
    if (estado.ordenProd === "ganancia") return `${euros(p.ganancia, true)} (${fmtPct(pctGanancia(p))}) desde que compraste`;
    if (estado.ordenProd === "hoy") return `Hoy ${euros(p.hoy, true)}`;
    return `${fmtPct(pctGanancia(p))} desde que compraste`;
  };
  const sinPrecio = prods.filter((p) => !p.pr).length;
  const nombres = Object.fromEntries(prods.map((p) => [p.isin, p.nombre]));
  const planes = planesCartera();
  const planesMes = suma(planes, (pl) => pl.alMes);
  const movs = lista.flatMap(([, b]) => (b.movimientos || []).map((m) => ({ ...m, nombreBroker: b.nombre })))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).slice(0, 8);
  const precios = (datos.inversiones || {}).precios_actualizados;
  const fuentes = [...new Set(prods.filter((p) => p.pr).map((p) => p.pr.fuente || "Yahoo Finance"))].join(" y ") || "Yahoo Finance";

  return `
  <div class="cabecera"><h2>Inversiones</h2>${botonDiscreto()}</div>
  ${bandaActualizar()}
  <div class="etiqueta">Valor de la cartera</div>
  <div class="saldo">${cifraGrande(total)}</div>
  <div class="cuentas">
    <div class="cuenta"><span class="etiqueta">Ganancia</span><b class="${ganancia >= 0 ? "lima" : "rojo"}">${euros(ganancia, true)}</b>
      <span class="nota">${fmtPct(coste ? (ganancia / coste) * 100 : null)}</span></div>
    <div class="cuenta"><span class="etiqueta">Hoy</span><b class="${hoyEur >= 0 ? "lima" : "rojo"}">${euros(hoyEur, true)}</b>
      <span class="nota">${fmtPct(ayer ? (hoyEur / ayer) * 100 : null, 2)}</span></div>
  </div>
  ${tarjetaResumen()}
  ${tarjetaMercados()}
  ${lista.map(([clave, b]) => `<div class="tarjeta fila">
    <div><h3>${esc(b.nombre || clave)}</h3><div class="nota">${b.actualizado ? `${eurosRedondo(valorBroker(clave, b))} · cartera de ${haceCuanto(b.actualizado)}` : "Sin cartera todavía"}${b.boton === "" ? " · se pone al día sola" : ""}</div>
      ${b.aviso ? `<div class="nota rojo">${esc(b.aviso)}</div>` : ""}</div>
    ${b.boton !== "" ? `<button class="boton-mini" data-accion="actualizar-inv" data-clave="${esc(clave)}" ${actualizando.boton ? "disabled" : ""}>
      ${actualizando.boton === clave ? "Esperando…" : "Actualizar"}</button>` : ""}</div>`).join("")}
  <div class="tarjeta"><h3>Reparto</h3>
    <div class="segmento" style="margin:10px 0 4px">${[["tipo", "Por tipo"], ["broker", "Por bróker"]].map(([v, txt]) =>
      `<button class="${(porBroker ? "broker" : "tipo") === v ? "activo" : ""}" data-accion="reparto" data-v="${v}">${txt}</button>`).join("")}</div>
    ${repartoOrden.map(([tipo, v]) => `<div class="barra-cat"><div class="fila"><span>${esc(tipo)}</span>
      <span>${eurosRedondo(v)} · ${total ? Math.round((v / total) * 100) : 0} %</span></div>
      <div class="pista"><i style="width:${total ? Math.max(2, (v / total) * 100) : 0}%;background:${(porBroker ? color[tipo] : COLOR_TIPO[tipo]) || "#9A988F"}"></i></div></div>`).join("")}
    ${porBroker ? '<p class="nota" style="margin-top:8px">Con el efectivo de cada bróker.</p>' : ""}
  </div>
  ${tarjetaEvolucion()}
  ${tarjetaCobros()}
  <div class="seccion"><h3>Productos</h3><span class="nota">${prods.length}</span></div>
  <div class="segmento" style="margin-bottom:10px">${ORDEN_PROD.map(([v, txt]) =>
    `<button class="${estado.ordenProd === v ? "activo" : ""}" data-accion="orden-prod" data-v="${v}">${txt}</button>`).join("")}</div>
  <div class="lista">${prodsOrden.map((p) => `<button class="mov" data-accion="producto" data-isin="${esc(p.isin)}" data-broker="${esc(p.broker)}">
    <span class="mov-texto"><b>${esc(p.nombre || p.isin)}</b>
      <span>${esc(p.tipoNombre)} · ${lineaProd(p)}</span></span>
    <span class="der"><span class="importe">${euros(p.valor)}</span>${chipPct(p.dia)}</span></button>`).join("")}
    ${efectivo ? `<div class="mov"><span class="mov-texto"><b>Efectivo</b><span>Sin invertir</span></span><span class="importe">${euros(efectivo)}</span></div>` : ""}
  </div>
  ${seccionNoticias()}
  ${planes.length ? `<div class="seccion"><h3>Planes de ahorro</h3><span class="nota">${euros(planesMes)} al mes</span></div>
  <div class="lista">${planes.map((pl) => `<div class="mov"><span class="mov-texto"><b>${esc(nombres[pl.isin] || pl.isin)}</b>
    <span>${pl.pausado ? "En pausa" : `Próxima compra: ${pl.proxima ? fechaCorta(pl.proxima, false) : "—"}`} · ${esc(pl.texto)} · ${esc(pl.nombreBroker)}</span></span>
    <span class="importe">${euros(pl.importe || 0)}</span></div>`).join("")}</div>` : ""}
  ${movs.length ? `<div class="seccion"><h3>Últimos movimientos</h3></div>
  <div class="lista">${movs.map((m) => `<div class="mov"><span class="mov-texto"><b>${esc(m.titulo || "")}</b>
    <span>${esc(MOVS_INV[m.tipo] || m.detalle || "")} · ${m.fecha ? fechaCorta(m.fecha.slice(0, 10)) : ""}</span></span>
    <span class="importe${(m.importe || 0) > 0 ? " mas" : ""}">${m.importe === null || m.importe === undefined ? "" : euros(m.importe, true)}</span></div>`).join("")}</div>` : ""}
  <p class="nota" style="text-align:center;margin-top:16px">${sinPrecio ? `${sinPrecio} sin precio de hoy (se valoran a lo que costaron) · ` : ""}Precios de ${precios ? haceCuanto(precios) : "—"} (${esc(fuentes)}) ·
    <button class="enlace" data-accion="recargar">recargar</button></p>
  <p class="nota" style="text-align:center">Solo datos, sin consejos de inversión.</p>`;
}

// ---------- Gráficos: precio de cada producto y evolución de la cartera (fase 5) ----------
const RANGOS = [["1S", 7], ["1M", 31], ["6M", 183], ["1A", 366], ["5A", 1830]];
let grafico = null;   // el gráfico abierto en la hoja: de dónde salen los puntos y cómo se escriben

// Los gráficos de los productos llegan comprimidos: fecha de inicio, días desde ella y precios
function descomprimir(s) {
  const base = new Date(`${s.desde}T12:00:00Z`).getTime();
  return s.f.map((f, i) => [new Date(base + f * 86400000), s.p[i]]);
}
function puntosProducto(isin, dias) {
  const g = ((datos.inversiones || {}).graficos || {})[isin];
  if (!g) return [];
  return recortar(descomprimir(dias > 366 && g.semanas ? g.semanas : g.dias), dias);
}
function puntosEvolucion(dias) {
  const h = (datos.inversiones || {}).historial || [];
  return recortar(h.map((x) => [new Date(`${x.fecha}T12:00:00Z`), x.valor + (x.efectivo || 0)]), dias);
}
// Lo que has metido: lo que costó lo que tienes, más el efectivo de los brókeres
function puntosMetido(dias) {
  const h = ((datos.inversiones || {}).historial || []).filter((x) => x.coste !== undefined && x.coste !== null);
  return recortar(h.map((x) => [new Date(`${x.fecha}T12:00:00Z`), x.coste + (x.efectivo || 0)]), dias);
}
function recortar(pts, dias) {
  if (!pts.length) return pts;
  const limite = pts[pts.length - 1][0].getTime() - dias * 86400000;
  return pts.filter(([d]) => d.getTime() >= limite);
}

// grafico = { id, rangos, rango, puntos(dias), extra(dias)?, nombre?, nombreExtra?, fmt, vacio }
// "extra" es una segunda línea en la misma escala y las mismas unidades (lo que has metido, junto a lo que vale).
function zonaGrafico() {
  const rangos = grafico.rangos || RANGOS;
  const elegido = rangos.find(([r]) => r === grafico.rango) || rangos[Math.min(3, rangos.length - 1)];
  grafico.rango = elegido[0];
  const pts = grafico.puntos(elegido[1]);
  const extra = grafico.extra ? new Map(grafico.extra(elegido[1]).map(([d, v]) => [d.getTime(), v])) : null;
  grafico.pts = pts;
  grafico.extraDe = (i) => (extra ? extra.get(pts[i][0].getTime()) : undefined);
  const botones = `<div class="rangos">${rangos.map(([r]) => `<button data-rango="${r}" class="${r === grafico.rango ? "activo" : ""}">${r}</button>`).join("")}</div>`;
  if (pts.length < 2) return `${botones}<div class="nota graf-vacio">${grafico.vacio}</div>`;
  const W = 320, H = 150, M = 8;
  const vals = pts.map((p) => p[1]);
  const todos = extra ? vals.concat(pts.map((_, i) => grafico.extraDe(i)).filter((v) => v !== undefined)) : vals;
  const min = Math.min(...todos), max = Math.max(...todos), alto = max - min || 1;
  const t0 = pts[0][0].getTime(), t1 = pts[pts.length - 1][0].getTime();
  grafico.x = (tt) => ((tt - t0) / (t1 - t0 || 1)) * W;
  const y = (v) => M + (1 - (v - min) / alto) * (H - 2 * M);
  const camino = (lista) => lista.map((p, i) => `${i ? "L" : "M"}${grafico.x(p[0].getTime()).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const linea = camino(pts);
  const lineaExtra = extra ? camino(pts.map((p, i) => [p[0], grafico.extraDe(i)]).filter((p) => p[1] !== undefined)) : "";
  const cambio = vals[0] ? (vals[vals.length - 1] / vals[0] - 1) * 100 : null;
  const color = cambio === null || cambio >= 0 ? "var(--lima)" : "var(--rojo)";
  return `${botones}
    <div class="fila graf-cab"><span id="graf-dato">${datoGrafico(pts.length - 1)}</span>${chipPct(cambio)}</div>
    <div class="graf-linea" data-grafico>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Gráfico de ${esc(grafico.rango)}">
        <path d="${linea}L${W},${H}L0,${H}Z" fill="${color}" opacity=".1"/>
        ${lineaExtra ? `<path d="${lineaExtra}" fill="none" stroke="var(--suave)" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>` : ""}
        <path d="${linea}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
        <line id="graf-cursor" x1="0" x2="0" y1="0" y2="${H}" stroke="var(--suave)" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/>
      </svg>
    </div>
    <div class="fila graf-eje"><span>${fechaCorta(iso(pts[0][0]))}</span><span>Mín ${grafico.fmt(min)} · Máx ${grafico.fmt(max)}</span><span>${fechaCorta(iso(pts[pts.length - 1][0]))}</span></div>
    ${extra ? `<div class="leyenda" style="margin-top:6px"><span><i style="background:${color}"></i>${esc(grafico.nombre)}</span><span><i class="discontinua"></i>${esc(grafico.nombreExtra)}</span></div>` : ""}`;
}
function datoGrafico(i) {
  const [d, v] = grafico.pts[i];
  const e = grafico.extraDe(i);
  return `<b>${grafico.fmt(v)}</b> <span class="nota">${fechaCorta(iso(d))}${e !== undefined ? ` · ${esc(grafico.nombreExtra.toLowerCase())}: ${grafico.fmt(e)}` : ""}</span>`;
}

// Con el dedo (o el ratón) sobre el gráfico se ve el valor de cada día
function moverCursor(ev) {
  const caja = ev.target.closest("[data-grafico]");
  if (!caja || !grafico || !grafico.pts || grafico.pts.length < 2) return;
  const r = caja.getBoundingClientRect();
  const x = Math.min(Math.max((ev.clientX - r.left) / r.width, 0), 1) * 320;
  let mejor = 0;
  grafico.pts.forEach((p, i) => { if (Math.abs(grafico.x(p[0].getTime()) - x) < Math.abs(grafico.x(grafico.pts[mejor][0].getTime()) - x)) mejor = i; });
  const cursor = $("#graf-cursor");
  const px = grafico.x(grafico.pts[mejor][0].getTime());
  cursor.setAttribute("x1", px); cursor.setAttribute("x2", px); cursor.setAttribute("visibility", "visible");
  $("#graf-dato").innerHTML = datoGrafico(mejor);
}
function soltarCursor() {
  if (!grafico || !grafico.pts || grafico.pts.length < 2 || !$("#graf-cursor")) return;
  $("#graf-cursor").setAttribute("visibility", "hidden");
  $("#graf-dato").innerHTML = datoGrafico(grafico.pts.length - 1);
}

// Lo aportado cada mes: lo que ha ido de tus bancos a los brókeres, menos lo que ha vuelto
function aportadoPorMes(n = 12) {
  const actual = mesActual();
  const meses = [];
  for (let i = n - 1; i >= 0; i--) { const m = mesMas(actual, -i); if (m >= primerMes()) meses.push(m); }
  return meses.map((mes) => ({ mes, neto: -suma(delMes(mes).filter((m) => m.categoria === "Inversión"), (m) => m.importe) }));
}

function tarjetaCobros() {
  const lista = cobrosCartera();
  if (!lista.length) return "";
  const anio = hoy().slice(0, 4);
  const deAnio = lista.filter((m) => m.fecha.slice(0, 4) === anio);
  const desde = primerMovInv();
  return `<div class="tarjeta tarjeta-boton" data-accion="cobros" role="button" tabindex="0"><div class="fila"><h3>Dividendos e intereses</h3><span class="nota">Ver</span></div>
    <div class="dato"><span>Dividendos en ${anio}</span><span>${euros(suma(deAnio.filter((m) => m.clase === "Dividendo"), (m) => m.importe))}</span></div>
    <div class="dato"><span>Intereses en ${anio}</span><span>${euros(suma(deAnio.filter((m) => m.clase === "Intereses"), (m) => m.importe))}</span></div>
    ${desde && desde.slice(0, 4) === anio ? `<p class="nota" style="margin-top:6px">Desde el ${fechaCorta(desde, false)}, el primer movimiento guardado de los brókeres.</p>` : ""}</div>`;
}

function hojaCobros() {
  const lista = cobrosCartera();
  const desde = primerMovInv();
  const meses = new Map();
  for (const m of lista) meses.set(m.fecha.slice(0, 7), (meses.get(m.fecha.slice(0, 7)) || 0) + m.importe);
  abrirHoja(`<h3 style="font-size:20px;margin-bottom:2px">Dividendos e intereses</h3>
    <div class="nota">Lo que han pagado tus inversiones, de los movimientos de los brókeres${desde ? ` (desde el ${fechaCorta(desde)})` : ""}</div>
    <div class="grande">${euros(suma(lista, (m) => m.importe))}</div>
    <div class="dato"><span>Dividendos</span><span>${euros(suma(lista.filter((m) => m.clase === "Dividendo"), (m) => m.importe))}</span></div>
    <div class="dato"><span>Intereses</span><span>${euros(suma(lista.filter((m) => m.clase === "Intereses"), (m) => m.importe))}</span></div>
    <h4 class="subtema">Por mes</h4>
    ${[...meses].map(([mes, v]) => `<div class="dato"><span>${mayuscula(MESES[+mes.slice(5, 7) - 1])} ${mes.slice(0, 4)}</span><span>${euros(v)}</span></div>`).join("")}
    <h4 class="subtema">Cada cobro</h4>
    <div class="lista lista-hoja">${lista.map((m) => `<div class="mov"><span class="mov-texto"><b>${esc(m.titulo || m.clase)}</b>
      <span>${m.clase} · ${esc(m.nombreBroker)} · ${fechaCorta(fechaMov(m))}</span></span>
      <span class="importe mas">${euros(m.importe, true)}</span></div>`).join("")}</div>
    <p class="nota" style="margin-top:10px">Los brókeres que no dan sus movimientos no salen aquí.</p>
    <button class="boton-sec" data-cerrar>Cerrar</button>`);
}

function tarjetaEvolucion() {
  const h = (datos.inversiones || {}).historial || [];
  const meses = aportadoPorMes();
  const total = suma(meses, (m) => m.neto);
  const mini = miniLinea(h.slice(-90).map((x) => x.valor + (x.efectivo || 0)));
  return `<div class="tarjeta tarjeta-boton" data-accion="evolucion" role="button" tabindex="0"><div class="fila"><h3>Evolución</h3><span class="nota">Ver</span></div>
    ${mini || `<p class="nota">El valor de la cartera se apunta cada día desde el 15/11/2026.</p>`}
    <div class="dato"><span>Aportado en ${meses.length} meses</span><span>${euros(total)}</span></div></div>`;
}

function hojaEvolucion() {
  grafico = { id: "evolucion", rango: estado.rangos.evolucion || "1A", fmt: (v) => euros(v), puntos: puntosEvolucion,
    extra: puntosMetido, nombre: "Valor", nombreExtra: "Lo que has metido",
    vacio: "La evolución empezó a apuntarse el 15/11/2026: cada día se añade un punto con el valor de la cartera." };
  const meses = aportadoPorMes();
  const tope = Math.max(1, ...meses.map((m) => Math.abs(m.neto)));
  abrirHoja(`<h3 style="font-size:20px;margin-bottom:2px">Evolución de la cartera</h3>
    <div class="nota">Valor de la cartera (con el efectivo) al final de cada día</div>
    <div id="graf-zona">${zonaGrafico()}</div>
    <p class="nota" style="margin-top:6px">«Lo que has metido» es lo que costó lo que tienes ahora, más el efectivo: la distancia entre las dos líneas es lo que ganas o pierdes.</p>
    <h4 class="subtema">Aportado cada mes</h4>
    <div class="nota">Lo que ha ido de tus bancos a los brókeres, menos lo que ha vuelto</div>
    <div class="grafico" style="height:110px">${meses.map((m) => `<div class="columna"><div class="par">
      <i style="width:60%;height:${(Math.abs(m.neto) / tope) * 100}%;background:${m.neto >= 0 ? "var(--violeta)" : "var(--rojo)"}"></i></div><span>${mesCorto(m.mes)}</span></div>`).join("")}</div>
    ${meses.slice().reverse().filter((m) => Math.round(m.neto)).map((m) => `<div class="dato"><span style="text-transform:capitalize">${MESES[+m.mes.slice(5, 7) - 1]} ${m.mes.slice(0, 4)}</span><span>${euros(m.neto, true)}</span></div>`).join("")
      || '<p class="nota">Sin aportaciones en estos meses.</p>'}
    <button class="boton-sec" data-cerrar>Cerrar</button>`);
}

// ---------- Resumen de la mañana, mercados y noticias (fase 5) ----------
const enlaceSeguro = (u) => (/^https:\/\//.test(u || "") ? u : "#");
const horaCorta = (t) => new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

function cuandoResumen(r) {
  if (r.fecha === hoy()) return "Hoy";
  return r.fecha ? fechaCorta(r.fecha, false) : haceCuanto(r.hora);
}

function tarjetaResumen() {
  const r = (datos.inversiones || {}).resumen;
  if (!r || !r.texto) return "";
  const puntos = r.texto.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("•")).slice(0, 2);
  return `<div class="tarjeta"><div class="fila"><h3>☀️ Resumen de la mañana</h3><span class="nota">${esc(cuandoResumen(r))}</span></div>
    ${puntos.map((l) => `<p class="avance">${esc(l.replace(/^•\s*/, ""))}</p>`).join("")}
    <button class="boton-sec" data-accion="resumen">Leer el resumen</button></div>`;
}

// El texto llega plano: bloques que empiezan por un emoji, temas que acaban en ":" y viñetas con "•".
function hojaResumen() {
  const r = (datos.inversiones || {}).resumen;
  if (!r || !r.texto) return;
  const cuerpo = r.texto.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    if (l.startsWith("•")) return `<p class="punto">${esc(l.replace(/^•\s*/, ""))}</p>`;
    if (l.endsWith(":")) return `<h4 class="subtema">${esc(l.slice(0, -1))}</h4>`;
    if (!/^[\p{L}\p{N}"«(¿¡]/u.test(l)) return `<h4 class="bloque">${esc(l)}</h4>`;
    return `<p class="parrafo">${esc(l)}</p>`;
  }).join("");
  abrirHoja(`<h3 style="font-size:20px;margin-bottom:2px">☀️ Resumen de la mañana</h3>
    <div class="nota">${esc(cuandoResumen(r))}${r.hora ? ` · ${horaCorta(r.hora)}` : ""}</div>
    <div class="resumen-texto">${cuerpo}</div>
    <p class="nota" style="margin-top:14px">Lo escribe Claude con titulares de prensa y los grupos de Telegram. Sin opiniones ni consejos.</p>
    <button class="boton-sec" data-cerrar>Cerrar</button>`);
}

const valorMercado = (x) => `${Number(x.valor).toLocaleString("es-ES", { minimumFractionDigits: x.decimales || 0,
  maximumFractionDigits: x.decimales || 0 })}${x.unidad ? ` ${x.unidad}` : ""}`;

function tarjetaMercados() {
  const m = (datos.inversiones || {}).mercados;
  if (!m || !(m.lista || []).length) return "";
  return `<div class="tarjeta"><div class="fila"><h3>Mercados</h3><span class="nota">${esc(haceCuanto(m.actualizado))}</span></div>
    <div class="mercados">${m.lista.map((x, i) => `<button class="mercado" data-accion="mercado" data-i="${i}">
      <span>${esc(x.nombre)}</span><b>${valorMercado(x)}</b>${chipPct(x.dia)}</button>`).join("")}</div></div>`;
}

function hojaMercado(i) {
  const x = (((datos.inversiones || {}).mercados || {}).lista || [])[+i];
  if (!x) return;
  abrirHoja(`<h3 style="font-size:20px;margin-bottom:2px">${esc(x.nombre)}</h3>
    <div class="nota">${esc(x.simbolo)} · Yahoo Finance</div>
    <div class="grande">${valorMercado(x)}</div>
    <div class="dato"><span>Hoy</span><span>${fmtPct(x.dia, 2)}</span></div>
    <div class="dato"><span>Semana</span><span>${fmtPct(x.semana)}</span></div>
    <div class="dato"><span>Mes</span><span>${fmtPct(x.mes)}</span></div>
    <div class="dato"><span>Año</span><span>${fmtPct(x.ano)}</span></div>
    <p class="nota" style="margin-top:8px">Último cierre: ${fechaCorta(x.fecha)}. «Hoy» es lo que cambió frente al cierre anterior.</p>
    <button class="boton-sec" data-cerrar>Cerrar</button>`);
}

const temasNoticias = () => (((datos.inversiones || {}).noticias || {}).temas) || {};

function filaNoticia(x, tema) {
  return `<a class="noticia" href="${esc(enlaceSeguro(x.enlace))}" target="_blank" rel="noopener noreferrer">
    <b>${esc(x.titulo)}</b><span class="nota">${tema ? `${esc(tema)} · ` : ""}${esc(x.medio || "")} · ${esc(haceCuanto(x.fecha))}</span></a>`;
}

// Primero el titular más nuevo de cada tema, para que un solo tema no lo llene todo
function ultimasNoticias(cuantas) {
  const todas = Object.entries(temasNoticias()).flatMap(([tema, lista]) => (lista || []).map((x, i) => ({ ...x, tema, puesto: i })));
  return todas.sort((a, b) => a.puesto - b.puesto || (a.fecha < b.fecha ? 1 : -1)).slice(0, cuantas)
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

function seccionNoticias() {
  const lista = ultimasNoticias(6);
  if (!lista.length) return "";
  return `<div class="seccion"><h3>Noticias de tu cartera</h3><button class="enlace" data-accion="noticias">Ver todas</button></div>
    <div class="lista">${lista.map((x) => filaNoticia(x, x.tema)).join("")}</div>`;
}

function hojaNoticias() {
  const n = (datos.inversiones || {}).noticias || {};
  const temas = Object.entries(temasNoticias()).filter(([, l]) => (l || []).length);
  const elegido = temas.some(([t]) => t === estado.temaNoticias) ? estado.temaNoticias : "";
  const ver = elegido ? temas.filter(([t]) => t === elegido) : temas;
  abrirHoja(`<h3 style="font-size:20px;margin-bottom:2px">Noticias de tu cartera</h3>
    <div class="nota">Titulares en español de los últimos días (Google Noticias) · ${esc(haceCuanto(n.actualizado))}</div>
    ${temas.length > 1 ? `<div class="segmento" style="margin:12px 0 4px">${[["", "Todas"], ...temas.map(([t]) => [t, t])].map(([v, t]) =>
      `<button class="${v === elegido ? "activo" : ""}" data-h="tema-noticias" data-tema="${esc(v)}">${esc(t)}</button>`).join("")}</div>` : ""}
    ${ver.map(([tema, l]) => `<h4 class="subtema">${esc(tema)}</h4><div class="noticias-hoja">${l.map((x) => filaNoticia(x)).join("")}</div>`).join("")}
    <button class="boton-sec" data-cerrar>Cerrar</button>`);
  const activo = $("#hoja [data-h=tema-noticias].activo");
  if (activo) activo.parentElement.scrollLeft = activo.offsetLeft - activo.parentElement.offsetLeft - 40;
}

function noticiasProducto(p) {
  const n = (datos.inversiones || {}).noticias || {};
  const tema = (n.productos || {})[p.isin];
  const lista = tema ? (n.temas || {})[tema] || [] : [];
  if (!lista.length) return "";
  const otro = tema.toLowerCase() !== String(p.nombre || "").toLowerCase();
  return `<h4 class="subtema">Noticias${otro ? ` · ${esc(tema)}` : ""}</h4>
    <div class="noticias-hoja">${lista.map((x) => filaNoticia(x)).join("")}</div>`;
}

function hojaProducto(isin, broker) {
  const { prods, total } = totalCartera();
  const p = prods.find((x) => x.isin === isin && x.broker === broker);
  if (!p) return;
  const planes = planesCartera().filter((pl) => pl.isin === p.isin && pl.broker === p.broker);
  const nombre = nombreSimple(p.nombre);
  const movs = nombre ? (((datos.inversiones || {})[p.broker] || {}).movimientos || [])
    .filter((m) => (COMPRAS.has(m.tipo) || COBROS[m.tipo]) && nombreSimple(m.titulo) === nombre)
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1)) : [];
  const pr = p.pr || {};
  grafico = { id: "producto", rango: estado.rangos.producto || "1A", fmt: (v) => precioUnidad(v),
    puntos: (dias) => puntosProducto(p.isin, dias), vacio: "No hay precios suficientes para este periodo." };
  const conGrafico = ((datos.inversiones || {}).graficos || {})[p.isin];
  abrirHoja(`<h3 style="font-size:20px;margin-bottom:2px">${esc(p.nombre || p.isin)}</h3>
    <div class="nota">${esc(p.tipoNombre)} · ${esc(p.nombreBroker)} · ${esc(p.ticker || p.isin)}</div>
    <div class="grande">${euros(p.valor)}</div>
    ${conGrafico ? `<div class="nota">Precio de cada día, en euros al cambio de hoy</div><div id="graf-zona">${zonaGrafico()}</div>` : ""}
    <div class="dato"><span>Ganancia</span><span class="${p.ganancia >= 0 ? "lima" : "rojo"}">${euros(p.ganancia, true)} (${fmtPct(p.coste ? (p.ganancia / p.coste) * 100 : null)})</span></div>
    <div class="dato"><span>Cantidad</span><span>${cantidad(p.cantidad)}</span></div>
    <div class="dato"><span>Precio de hoy</span><span>${p.pr ? precioUnidad(p.precio) : "sin precio"}</span></div>
    <div class="dato"><span>Precio medio de compra</span><span>${precioUnidad(p.precio_medio)}</span></div>
    <div class="dato"><span>Peso en la cartera</span><span>${(total ? Math.round((p.valor / total) * 1000) / 10 : 0).toLocaleString("es-ES")} %</span></div>
    <div class="dato"><span>Hoy · semana · mes · año</span><span>${fmtPct(pr.dia, 2)} · ${fmtPct(pr.semana)} · ${fmtPct(pr.mes)} · ${fmtPct(pr.ano)}</span></div>
    ${planes.map((pl) => `<div class="dato"><span>Plan de ahorro</span><span>${pl.pausado ? "en pausa" : `${euros(pl.importe || 0)} ${esc(pl.texto)}`}</span></div>
      ${!pl.pausado && pl.proxima ? `<div class="dato"><span>Próxima compra del plan</span><span>${fechaCorta(pl.proxima)}</span></div>` : ""}`).join("")}
    ${p.pr ? `<p class="nota" style="margin-top:8px">Precio de ${esc(pr.simbolo)} en ${esc(pr.fuente || "Yahoo Finance")} del ${fechaCorta(pr.fecha)}${pr.moneda && pr.moneda !== "EUR" ? `, pasado de ${esc(pr.moneda)} a euros. Los % van en ${esc(pr.moneda)}` : ""}.</p>` : ""}
    ${movs.length ? `<h4 class="subtema">Compras, ventas y cobros</h4>
    <div class="lista lista-hoja">${movs.slice(0, 10).map((m) => `<div class="mov"><span class="mov-texto"><b>${esc(MOVS_INV[m.tipo] || m.detalle || "")}</b>
      <span>${esc(m.detalle || "")}${m.detalle ? " · " : ""}${fechaCorta(fechaMov(m))}</span></span>
      <span class="importe${(m.importe || 0) > 0 ? " mas" : ""}">${m.importe === null || m.importe === undefined ? "" : euros(m.importe, true)}</span></div>`).join("")}</div>
    ${movs.length > 10 ? `<p class="nota">Y ${movs.length - 10} más.</p>` : ""}` : ""}
    ${noticiasProducto(p)}
    <button class="boton-sec" data-cerrar>Cerrar</button>`);
}

// El botón Actualizar lanza la tarea de GitHub; el usuario confirma en la app del bróker y aquí se espera
// a ver la cartera nueva (se miran los datos cada 15 segundos, 5 minutos como mucho).
async function actualizarInversiones(clave) {
  const b = (datos.inversiones || {})[clave];
  if (!b || b.boton === "" || actualizando.boton) return;
  actualizando.error = "";
  if (!datos.envio) { actualizando.error = "falta-permiso"; pintar(); return; }
  actualizando.boton = clave;
  actualizando.antes = b.actualizado;
  actualizando.hasta = Date.now() + 5 * 60000;
  pintar();
  try {
    const r = await fetch(datos.envio.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${datos.envio.token}`, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: datos.envio.ref || "main", inputs: { actualizar: b.boton || clave } }),
    }).catch(() => { throw new Error("red"); });
    if ([401, 403, 404].includes(r.status)) throw new Error("permiso");
    if (!r.ok) throw new Error("github");
  } catch (e) {
    actualizando.boton = "";
    actualizando.error = ["permiso", "red", "github"].includes(e.message) ? e.message : "github";
    pintar();
    return;
  }
  const paso = async () => {
    actualizando.sondeo = null;
    if (document.visibilityState === "visible") {
      await recargar(true);
      const ahora = ((datos.inversiones || {})[clave] || {}).actualizado;
      if (ahora && ahora !== actualizando.antes) {
        actualizando.boton = "";
        pintarSiInversiones();
        aviso("Cartera al día");
        return;
      }
    }
    if (Date.now() > actualizando.hasta) {
      actualizando.boton = "";
      actualizando.error = "tiempo";
      pintarSiInversiones();
      return;
    }
    actualizando.sondeo = setTimeout(paso, 15000);
  };
  actualizando.sondeo = setTimeout(paso, 30000);
}

function pintarSiInversiones() { if (estado.pestana === "inversiones" && datos) pintar(); }

// ---------- Hojas y avisos ----------
function abrirHoja(html) {
  const caja = $("#hoja-contenido");
  caja.style.transition = "";
  caja.style.transform = "";
  caja.innerHTML = `<div class="asa"></div>${html}`;
  $("#hoja").hidden = false;
}
function cerrarHoja() { $("#hoja").hidden = true; }

let temporizador = null;
function aviso(texto) {
  const el = $("#aviso");
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => { el.hidden = true; }, 2800);
}

function hojaMovimiento(id) {
  if (id.startsWith("a-")) { hojaApunte(id); return; }
  const m = datos.movimientos.find((x) => x.id === id);
  if (!m || m._ajuste) return;
  const apunte = m.apunte && datos.apuntes.find((a) => a.id === m.apunte);
  const cambio = datos.cambios[m.id] || {};
  const filas = [
    ["Fecha", fechaDia(m.fecha)],
    m.fecha_valor && m.fecha_valor !== m.fecha ? ["Fecha valor", fechaDia(m.fecha_valor)] : null,
    ["Cuenta", nombreCuenta(m.cuenta)],
    m.estado === "PDNG" ? ["Estado", "Pendiente: el banco aún no lo ha cobrado del todo"] : null,
    m.saldo !== undefined ? ["Saldo después", euros(m.saldo)] : null,
    ["Concepto del banco", m.concepto || "—"],
  ].filter(Boolean);
  // Lo que llevas en este comercio (los movimientos que salen al buscarlo)
  const q = claveComercio(m);
  const delComercio = q ? filtrar(filtroVacio(q)) : [];
  const esteAnio = delComercio.filter((x) => x.fecha.startsWith(hoy().slice(0, 4)));
  const veces = (n) => `${n} ${n === 1 ? "vez" : "veces"}`;
  const comercio = delComercio.length > 1 ? `<div class="hoja-seccion"><span>En este comercio</span></div>
    <div class="dato"><span>Este año</span><span>${veces(esteAnio.length)} · ${euros(suma(esteAnio, (x) => x.importe), true)}</span></div>
    <div class="dato"><span>Desde el ${fechaCorta(delComercio[delComercio.length - 1].fecha)}</span><span>${veces(delComercio.length)} · ${euros(suma(delComercio, (x) => x.importe), true)}</span></div>
    <button class="boton-sec" data-h="comercio" data-q="${esc(q)}">Ver sus ${delComercio.length} movimientos</button>` : "";
  abrirHoja(`<div class="fila" style="justify-content:flex-start"><span class="emoji">${emoji(m)}</span><b>${esc(titulo(m))}</b></div>
    <div class="grande ${NO_GASTO.has(m.categoria) ? "nc" : m.importe > 0 ? "lima" : ""}">${euros(m.importe, true)}</div>
    ${NO_GASTO.has(m.categoria) ? '<p class="nota" style="margin:-4px 0 10px">No computable: no cuenta como gasto ni como ingreso, porque el dinero sigue siendo tuyo.</p>' : ""}
    ${filas.map(([k, v]) => `<div class="dato"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}
    ${comercio}
    ${apunte ? `<div class="alerta violeta" style="margin-top:12px">Lo apuntaste tú${apunte.origen === "ticket" ? " con la foto del ticket" : ""} y se ha juntado con este movimiento del banco.
      <button class="enlace" data-ap="editar" data-id="${esc(apunte.id)}">Ver lo apuntado</button></div>` : ""}
    <div class="hoja-seccion"><span>${m.importe > 0 ? "Tipo de ingreso" : "Tipo"}</span>${cambio.categoria ? `<button class="enlace" data-ap="auto" data-id="${esc(m.id)}">Volver a ${esc(m.importe > 0 ? nombreIngreso(nombreCategoria({ ...m, categoria: m.auto })) : m.auto)}</button>` : ""}</div>
    ${selectorTipos("mov-tipo", m.importe > 0 ? tiposDeIngreso(m) : { actual: m.categoria, lista: categoriasGasto(true) })}
    <label class="campo"><span>Nota</span><input id="mov-nota" type="text" maxlength="200" value="${esc(m.nota)}" placeholder="Opcional"></label>
    <button class="boton ancho" data-ap="guardar-mov" data-id="${esc(m.id)}">Guardar</button>
    <button class="boton-sec" data-cerrar>Cerrar</button>`);
}

// El selector de tipo de un ingreso: Nómina, Ingreso, Bizum recibidos, apuestas, no computables y devoluciones
function tiposDeIngreso(m) {
  const lista = categoriasIngreso();
  return { actual: nombreCategoria(m), lista, usos: datos._usosIngreso, ingresos: TIPOS_INGRESO, fijos: TIPOS_INGRESO,
    etiquetas: Object.fromEntries(lista.map((c) => [c, nombreIngreso(c)])) };
}

// De dónde sale "Gastado": lo que ha salido, menos lo que sigue siendo tuyo, más lo apuntado.
function hojaCalculo(mes) {
  const movs = delMes(mes);
  const salidas = movs.filter((m) => m.importe < 0 && !m._apunte);
  const de = (cat) => -suma(salidas.filter((m) => m.categoria === cat), (m) => m.importe);
  const total = -suma(salidas, (m) => m.importe);
  const gasto = suma(movs.filter((m) => m._gasto), (m) => -m.importe);
  const apuntado = (c) => suma(movs.filter((m) => m._apunte && m.cuenta === c && m._gasto), (m) => -m.importe);
  const enEfectivo = apuntado("efectivo");
  const sinLlegar = apuntado("pendiente");
  const yaContado = suma(movs.filter((m) => m._ajuste), (m) => m.importe);
  const apuestas = de("Apuestas");
  const fila = (k, v) => `<div class="dato"><span>${esc(k)}</span><span>${v}</span></div>`;
  const nombre = nombreMes(mes);
  const cuentas = [...Object.keys(datos.cuentas), "efectivo", "pendiente"]
    .map((c) => [c, suma(movs.filter((m) => m._gasto && m.cuenta === c), (m) => -m.importe)])
    .filter(([c, v]) => datos.cuentas[c] || Math.abs(v) > 0.005);
  abrirHoja(`<h3 class="hoja-titulo">Cómo se calcula</h3>
    <p class="nota" style="margin:2px 0 12px">${nombre[0].toUpperCase() + nombre.slice(1)}${mes === mesActual() ? ", hasta hoy" : ""}</p>
    ${fila("Ha salido de tus cuentas", euros(total))}
    ${fila("Pasos entre tus cuentas (no computable)", euros(-de("Entre tus cuentas")))}
    ${fila("Inversión (no computable)", euros(-de("Inversión")))}
    ${enEfectivo ? fila("Apuntado en efectivo", euros(enEfectivo, true)) : ""}
    ${yaContado ? fila("Ya contado al sacarlo del cajero", euros(-yaContado)) : ""}
    ${sinLlegar ? fila("Apuntado, aún sin llegar del banco", euros(sinLlegar, true)) : ""}
    <div class="dato total"><span>Gastado</span><span>${euros(gasto)}</span></div>
    ${apuestas ? `<p class="nota">Incluye ${euros(apuestas)} metidos en apuestas.</p>` : ""}
    <div class="hoja-seccion"><span>Gastado por cuenta</span></div>
    ${cuentas.map(([c, v]) => fila(nombreCuenta(c), euros(v))).join("")}
    <div class="hoja-seccion"><span>Para tenerlo en cuenta</span></div>
    <ul class="explica">
      <li>Los pasos entre tus cuentas y la inversión son no computables: no cuentan como gasto ni como ingreso, porque el dinero sigue siendo tuyo.</li>
      <li>Las devoluciones y lo que vuelve de las apuestas no se restan del gasto: cuentan como ingresos.</li>
      ${enEfectivo ? "<li>Lo que apuntas en efectivo se descuenta de lo sacado del cajero ese mes, para no contarlo dos veces.</li>" : ""}
      ${sinLlegar ? "<li>Lo apuntado con tarjeta o Bizum se junta con su movimiento cuando llega del banco: entonces cuenta una sola vez.</li>" : ""}
      <li>Unicaja apunta los pagos con tarjeta de 1 a 3 días después, así que pueden faltar los de los últimos días.</li>
      <li>Otras apps, como Fintonic, pueden dar otra cifra si cuentan los pasos entre tus cuentas o la inversión, o si tienen conectadas otras cuentas o tarjetas.</li>
    </ul>
    <button class="boton-sec" data-cerrar>Cerrar</button>`);
}

// ---------- Apuntar (fase 4) ----------
const importeDe = (t) => {
  let s = String(t).trim().replace(/\s|€/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 100) / 100 : null;
};
const textoPago = (p) => (p === "efectivo" ? "Cuenta como un gasto más (sale de lo que sacaste del cajero)."
  : "Cuando llegue del banco, se junta con su movimiento: contará una sola vez, con tu tipo y tu nota.");
const segmento = (grupo, opciones, actual) => `<div class="segmento" data-grupo="${grupo}">${opciones.map(([v, t]) =>
  `<button class="${v === actual ? "activo" : ""}" data-v="${v}">${t}</button>`).join("")}</div>`;
const PAGOS = [["tarjeta", "Tarjeta"], ["bizum", "Bizum"], ["efectivo", "Efectivo"]];

// Los conceptos de antes (del banco y de lo apuntado), con su tipo más habitual: se sugieren al escribir
const nombreBonito = (t) => (t === t.toUpperCase() && /\p{Lu}{2}/u.test(t)
  ? t.toLowerCase().replace(/(^|[\s·.\-/(])(\p{L})/gu, (x, a, b) => a + b.toUpperCase())
    .replace(/\b(Sl|Sa|Slu|Sau|Cb)\b\.?$/u, (x) => x.toUpperCase()) : t);
function conceptosUsados() {
  return calculado("conceptos", () => {
    const grupos = new Map();
    for (const m of datos.movimientos) {
      if (m._ajuste || FUERA_APUNTE.has(m.categoria) || !m.concepto || !m.importe) continue;
      const nombre = nombreBonito(titulo(m));
      const clave = `${m.importe < 0 ? "g" : "i"}${normal(nombre)}`;
      let g = grupos.get(clave);
      if (!g) grupos.set(clave, (g = { nombre, buscar: normal(nombre), gasto: m.importe < 0, n: 0, tipos: new Map() }));
      g.n++;
      g.tipos.set(m.categoria, (g.tipos.get(m.categoria) || 0) + 1);
    }
    return [...grupos.values()].map((g) => ({ ...g, tipo: [...g.tipos].sort((a, b) => b[1] - a[1])[0][0] }))
      .sort((a, b) => b.n - a.n);
  });
}
const tipoValido = (c) => ((selectores["ap-tipo"] || {}).lista || []).includes(c);

function sugerenciasConcepto() {
  const caja = $("#ap-sugerencias");
  if (!caja) return;
  const q = normal($("#ap-concepto").value).trim();
  const gasto = !!(estado.apunte && estado.apunte.gasto);
  const palabras = q.split(/\s+/);
  const lista = q.length < 2 ? [] : conceptosUsados()
    .filter((c) => c.gasto === gasto && palabras.every((p) => c.buscar.includes(p))).slice(0, 5);
  caja.innerHTML = lista.map((c) => {
    const tipo = gasto && tipoValido(c.tipo) ? c.tipo : "";
    return `<button type="button" class="filtro" data-sugerencia="${esc(c.nombre)}" data-cat="${esc(tipo)}">${esc(c.nombre)}${tipo
      ? `<span class="cuantos">${emojiCategoria(tipo)} ${esc(tipo)}</span>` : ""}</button>`;
  }).join("");
  caja.hidden = !lista.length;
}

// Un concepto escrito igual que uno de antes: si aún no tiene tipo, se pone el de siempre
function tipoDeConcepto() {
  if (!estado.apunte || !estado.apunte.gasto || !$("#ap-tipo") || $("#ap-tipo").value) return;
  const q = normal($("#ap-concepto").value).trim();
  const c = q && conceptosUsados().find((x) => x.gasto && x.buscar === q);
  if (c && tipoValido(c.tipo)) elegirTipo("ap-tipo", c.tipo);
}

function hojaApuntar() {
  const revisar = datos.apuntes.filter((a) => a.revisar);
  abrirHoja(`<h3 class="hoja-titulo">Apuntar</h3>
    ${datos.envio ? "" : '<div class="alerta" style="margin-top:12px">Para guardar lo que apuntes falta un paso en el portátil: dar a la app el permiso de GitHub. Hasta entonces, se queda en este iPhone.</div>'}
    <div class="opciones-grandes">
      <label class="opcion-grande"><input type="file" accept="image/*" id="foto-ticket" class="oculto">
        <span class="emoji">📷</span><b>Foto del ticket</b><span>Claude la lee y lo rellena</span></label>
      <button class="opcion-grande" data-ap="nuevo"><span class="emoji">✍️</span><b>A mano</b><span>Un gasto o un ingreso</span></button>
    </div>
    ${revisar.length ? `<div class="hoja-seccion"><span>Por revisar</span></div><div class="lista lista-hoja">${revisar.map((a) => filaMov(movDeApunte(a))).join("")}</div>` : ""}
    <button class="boton-sec" data-cerrar>Cerrar</button>`);
}

function hojaApunte(id) {
  const a = id ? datos.apuntes.find((x) => x.id === id) : null;
  if (id && !a) return;
  if (a && a._leyendo) { aviso("Claude está leyendo este ticket: en un momento podrás revisarlo"); return; }
  const v = a || { fecha: hoy(), importe: 0, pago: "tarjeta", categoria: "", concepto: "", nota: "", origen: "mano" };
  const gasto = !a || a.importe <= 0;
  estado.apunte = { id: a ? a.id : null, gasto, pago: v.pago, origen: v.origen || "mano" };
  const titulo = a ? (a.revisar ? "Revisar el ticket" : "Lo apuntado") : "Apuntar";
  abrirHoja(`<div class="fila"><h3 class="hoja-titulo">${titulo}</h3>
      ${a ? `<button class="enlace rojo" data-ap="borrar" data-id="${esc(a.id)}">Borrar</button>` : ""}</div>
    ${a && a.revisar ? `<p class="nota" style="margin-top:6px">${a.importe ? "Claude ha leído el ticket. Comprueba que está bien y pulsa Confirmar." : "Claude no ha podido leer el ticket: rellénalo tú."}</p>` : ""}
    ${a && a.enlace ? '<p class="nota" style="margin-top:6px">Ya se ha juntado con su movimiento del banco.</p>' : ""}
    <div style="margin-top:14px">${segmento("signo", [["gasto", "Gasto"], ["ingreso", "Ingreso"]], gasto ? "gasto" : "ingreso")}</div>
    <label class="campo"><span>Importe (€)</span><input id="ap-importe" class="campo-importe" type="text" inputmode="decimal"
      value="${v.importe ? String(Math.abs(v.importe)).replace(".", ",") : ""}" placeholder="0,00" autocomplete="off"></label>
    <label class="campo"><span>Concepto</span><input id="ap-concepto" type="text" maxlength="80" value="${esc(a ? a.concepto : "")}"
      placeholder="Mercadona, cena con amigos…" autocomplete="off"></label>
    <div class="opciones sugerencias" id="ap-sugerencias" hidden></div>
    <div class="campo" id="ap-tipo-campo"${gasto ? "" : " hidden"}><span>Tipo</span>
      ${selectorTipos("ap-tipo", { actual: gasto ? v.categoria || "" : "", lista: categoriasGasto(false) })}</div>
    <label class="campo"><span>Fecha</span><input id="ap-fecha" type="date" max="${hoy()}" value="${esc(v.fecha)}"></label>
    <div class="hoja-seccion"><span>Cómo pagaste</span></div>
    ${segmento("pago", PAGOS, v.pago)}
    <p class="nota" id="ap-pago-nota" style="margin-top:6px">${textoPago(v.pago)}</p>
    <label class="campo"><span>Nota (opcional)</span><input id="ap-nota" type="text" maxlength="200"
      value="${esc(a && !(a.revisar && !a.importe) ? a.nota : "")}" autocomplete="off"></label>
    <button class="boton ancho" data-ap="guardar">${a && a.revisar ? "Confirmar" : "Guardar"}</button>
    <button class="boton-sec" data-cerrar>Cancelar</button>`);
  if (!a) setTimeout(() => { const c = $("#ap-importe"); if (c) c.focus(); }, 250);
}

function guardarApunte() {
  const e = estado.apunte;
  const importe = importeDe($("#ap-importe").value);
  if (!importe) { aviso("Escribe el importe"); return; }
  const categoria = e.gasto ? $("#ap-tipo").value : "Otros";
  if (!categoria) { aviso("Elige un tipo"); return; }
  const fecha = $("#ap-fecha").value || hoy();
  if (fecha > hoy()) { aviso("La fecha no puede ser futura"); return; }
  const concepto = $("#ap-concepto").value.trim() || (e.gasto ? categoria : "Ingreso");
  encolar({ tipo: "apunte", apunte: { id: e.id || nuevoId("a"), fecha, importe: e.gasto ? -importe : importe, concepto,
    categoria, pago: e.pago, nota: $("#ap-nota").value.trim(), origen: e.origen, revisar: false } });
  cerrarHoja();
  aviso(e.id ? "Cambiado" : "Apuntado");
}

function guardarMov(id) {
  const m = datos.movimientos.find((x) => x.id === id);
  if (!m) return;
  let categoria = $("#mov-tipo").value;
  if (m.importe > 0) {
    if (categoria === nombreCategoria(m)) categoria = m.categoria;
    else if (m.auto && categoria === nombreCategoria({ ...m, categoria: m.auto })) categoria = m.auto;
  }
  const nota = $("#mov-nota").value.trim();
  cerrarHoja();
  if (categoria === m.categoria && nota === (m.nota || "")) return;
  encolar({ tipo: "cambio", mov: id, categoria: categoria === m.auto && !m.apunte ? "" : categoria, nota });
  aviso("Cambiado");
}

// La foto: se reduce en el iPhone (en gris y con más contraste: el papel queda blanco, se lee mejor
// y pesa menos) hasta que cabe en un envío. Claude la lee igual.
function cargarImagen(archivo) {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error("foto")); };
    img.src = url;
  });
}
async function reducirFoto(archivo) {
  const img = await cargarImagen(archivo);
  const lienzo = document.createElement("canvas");
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  let lado = 1600;
  let calidad = 0.72;
  let blob = null;
  for (let intento = 0; intento < 14; intento++) {
    const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
    lienzo.width = Math.max(1, Math.round(img.naturalWidth * escala));
    lienzo.height = Math.max(1, Math.round(img.naturalHeight * escala));
    ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
    const px = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
    const d = px.data;
    for (let j = 0; j < d.length; j += 4) {
      const gris = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
      d[j] = d[j + 1] = d[j + 2] = Math.max(0, Math.min(255, (gris - 50) * 1.35));
    }
    ctx.putImageData(px, 0, 0);
    blob = await new Promise((ok) => lienzo.toBlob(ok, "image/jpeg", calidad));
    if (blob && blob.size <= FOTO_MAX) return blob;
    if (calidad > 0.5) calidad -= 0.1; else lado = Math.round(lado * 0.85);
  }
  return blob;
}

async function prepararFoto(archivo) {
  abrirHoja('<div class="cargando">Preparando la foto…</div>');
  try {
    const blob = await reducirFoto(archivo);
    soltarFoto();
    estado.foto = { blob, url: URL.createObjectURL(blob), pago: "tarjeta" };
    abrirHoja(`<h3 class="hoja-titulo">Foto del ticket</h3>
      <img class="foto-previa" src="${estado.foto.url}" alt="Ticket">
      <div class="hoja-seccion"><span>Cómo pagaste</span></div>
      ${segmento("pago-foto", PAGOS, "tarjeta")}
      <p class="nota" style="margin-top:8px">Claude la lee en alrededor de un minuto. No hace falta que esperes con la app abierta: lo verás en "Tickets por revisar".</p>
      <button class="boton ancho" data-ap="enviar-foto">Enviar a Claude</button>
      <button class="boton-sec" data-ap="cancelar-foto">Cancelar</button>`);
  } catch {
    cerrarHoja();
    aviso("No se ha podido abrir la foto");
  }
}
function soltarFoto() {
  if (estado.foto) URL.revokeObjectURL(estado.foto.url);
  estado.foto = null;
}
async function enviarFoto() {
  const f = estado.foto;
  if (!f) return;
  const foto = aBase64(new Uint8Array(await f.blob.arrayBuffer()));
  encolar({ tipo: "ticket", apunte: nuevoId("a"), foto, pago: f.pago, fecha: hoy() });
  soltarFoto();
  cerrarHoja();
  aviso("Enviado: Claude lo está leyendo");
}

function hojaPresupuestos() {
  const meses = [1, 2, 3].map((n) => mesMas(mesActual(), -n)).filter((p) => p >= primerMes());
  const media = new Map();
  for (const p of meses) for (const [c, v] of gastoPorCategoria(delMes(p))) media.set(c, (media.get(c) || 0) + v / meses.length);
  const cats = categoriasGasto(false).filter((c) => media.get(c) > 0.5 || datos.presupuestos[c])
    .sort((x, y) => (media.get(y) || 0) - (media.get(x) || 0));
  media.set(TOTAL, suma([...media.values()], (v) => v));
  if (cats.length) cats.unshift(TOTAL);
  abrirHoja(`<h3 class="hoja-titulo">Presupuestos</h3>
    <p class="nota" style="margin:4px 0 12px">Lo que quieres gastar como mucho al mes en cada tipo. Déjalo vacío si no quieres ponerle límite.
      Al llegar al 80 % se pone en ámbar y, si te pasas, en rojo.</p>
    ${cats.map((c) => `<label class="presu-fila"><span>${emojiCategoria(c)} ${esc(c)}
        <small>${c === TOTAL ? `Todos los tipos juntos · tu media: ${eurosRedondo(media.get(c))}`
          : media.get(c) ? `Tu media: ${eurosRedondo(media.get(c))} al mes` : "Sin gastos los últimos meses"}</small></span>
      <input type="text" inputmode="decimal" data-presu="${esc(c)}" value="${datos.presupuestos[c] ? String(datos.presupuestos[c]).replace(".", ",") : ""}" placeholder="—" autocomplete="off"></label>`).join("")
      || '<div class="vacio">Aún no hay gastos con los que calcular.</div>'}
    <button class="boton ancho" data-ap="guardar-presu">Guardar</button>
    <button class="boton-sec" data-cerrar>Cancelar</button>`);
}
function guardarPresupuestos() {
  const ops = [];
  for (const campo of document.querySelectorAll("[data-presu]")) {
    const cat = campo.dataset.presu;
    const nuevo = importeDe(campo.value);
    if ((nuevo || null) !== (datos.presupuestos[cat] || null)) ops.push({ tipo: "presupuesto", categoria: cat, importe: nuevo });
  }
  cerrarHoja();
  if (!ops.length) return;
  encolar(...ops);
  aviso(ops.length === 1 ? "Presupuesto guardado" : "Presupuestos guardados");
}

// ---------- Enviar lo apuntado a GitHub ----------
function leerCola() {
  try { return JSON.parse(localStorage.getItem(COLA) || "[]"); } catch { return []; }
}
function guardarCola() {
  try { localStorage.setItem(COLA, JSON.stringify(cola)); } catch { /* sin sitio: sigue en memoria */ }
}
function nuevoId(p) {
  return `${p}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;
}

function encolar(...ops) {
  for (const op of ops) { op.id = nuevoId("op"); cola.push(op); }
  guardarCola();
  rehacer();
  pintar();
  envio.error = "";
  clearTimeout(envio.temporizador);
  envio.temporizador = setTimeout(() => enviar(), 900);
}

function pintarSiInicio() { if (estado.pestana === "inicio" && datos) pintar(); }

// Todo lo pendiente va junto (si GitHub descarta una tarea en espera, la siguiente lo lleva igual),
// salvo las fotos: una por envío. Lo que lleva un rato sin verse guardado se reenvía.
async function enviar(forzar = false) {
  if (envio.activo || !cola.length || !contrasena) return;
  if (!datos.envio) { envio.error = "falta-permiso"; pintarSiInicio(); return; }
  const ahora = Date.now();
  const viejo = (op) => op.enviado && ahora - op.enviado > REENVIO_MIN * 60000;
  if (!forzar && !cola.some((op) => !op.enviado || viejo(op))) { vigilar(); return; }
  if (!forzar && cola.some((op) => viejo(op) && (op.intentos || 0) >= 3)) { envio.error = "fallos"; pintarSiInicio(); return; }
  envio.activo = true;
  try {
    const foto = cola.find((op) => op.tipo === "ticket");
    let ops = cola.filter((op) => op.tipo !== "ticket" || op === foto);
    const sobre = async () => cifrar({ v: 1, ops: ops.map(({ enviado, intentos, ...op }) => op) }, contrasena);
    let texto = await sobre();
    if (texto.length > LIMITE_ENVIO && foto) { ops = ops.filter((op) => op !== foto); texto = await sobre(); }
    if (!ops.length) throw new Error("grande");
    const r = await fetch(datos.envio.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${datos.envio.token}`, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: datos.envio.ref || "main", inputs: { apunte: texto } }),
    }).catch(() => { throw new Error("red"); });
    if ([401, 403, 404].includes(r.status)) throw new Error("permiso");
    if (!r.ok) throw new Error("github");
    for (const op of ops) {
      if (viejo(op)) op.intentos = (op.intentos || 0) + 1;
      op.enviado = Date.now();
    }
    guardarCola();
    envio.error = "";
    vigilar();
  } catch (e) {
    envio.error = ["permiso", "github", "grande", "red"].includes(e.message) ? e.message : "github";
  } finally {
    envio.activo = false;
    pintarSiInicio();
  }
}

// Mientras haya algo guardándose, se miran los datos cada 20 segundos (unos minutos como mucho).
function vigilar() {
  envio.hasta = Date.now() + 6 * 60000;
  if (envio.sondeo) return;
  const paso = async () => {
    envio.sondeo = null;
    if (!cola.length) return;
    if (document.visibilityState === "visible") {
      const tickets = cola.filter((op) => op.tipo === "ticket").length;
      await recargar(true);
      const quedan = cola.filter((op) => op.tipo === "ticket").length;
      if (!cola.length) aviso(tickets ? "Ticket leído: revísalo en Inicio" : "Guardado");
      else if (quedan < tickets) aviso("Ticket leído: revísalo en Inicio");
      if (!cola.length) return;
      enviar();
    }
    if (Date.now() < envio.hasta) envio.sondeo = setTimeout(paso, 20000);
  };
  envio.sondeo = setTimeout(paso, 25000);
}

// Hoja de filtros: se trabaja sobre un borrador y se aplica con "Ver N movimientos".
function pestanaDe(f) {
  if (!f.desde && !f.hasta) return "rapido";
  if (rapidos().some(([, d, h]) => d === f.desde && h === f.hasta)) return "rapido";
  if (f.desde === f.hasta) return "dia";
  if (esAnio(f.desde, f.hasta)) return "anio";
  if (esMes(f.desde, f.hasta)) return "mes";
  return "entre";
}

// Usos de cada tipo según el filtro de gastos o ingresos, y el nombre de un tipo en ese filtro
const usosDe = (tipo) => (tipo === "gastos" ? datos._usosGasto : tipo === "ingresos" ? datos._usosIngreso : datos._usos);
const etiquetaTipo = (f) => (f.tipo === "ingresos" ? nombreIngreso(f.categoria) : f.categoria);

function hojaFiltros() {
  delete selectores["filtro-tipo"];   // la búsqueda de tipos empieza vacía cada vez
  estado.borrador = { ...estado.filtro };
  estado.pestanaFecha = pestanaDe(estado.borrador);
  estado.anioMeses = (estado.borrador.desde || hoy()).slice(0, 4);
  pintarHojaFiltros();
}

function textoVer(b) {
  const n = filtrar(b).length;
  return n ? `Ver ${n} ${n === 1 ? "movimiento" : "movimientos"}` : "No hay movimientos";
}

function pintarHojaFiltros() {
  const b = estado.borrador;
  const pf = estado.pestanaFecha;
  const primero = datos.movimientos.length ? datos.movimientos[datos.movimientos.length - 1].fecha : hoy();
  const limites = `min="${primero}" max="${hoy()}"`;
  const seg = (lista, actual, accion) => `<div class="segmento">${lista.map(([v, t]) =>
    `<button class="${actual === v ? "activo" : ""}" data-hf="${accion}" data-valor="${esc(v)}">${esc(t)}</button>`).join("")}</div>`;

  let fechas = "";
  if (pf === "rapido") {
    fechas = `<div class="opciones">${rapidos().map(([t, d, h]) =>
      `<button class="filtro${b.desde === d && b.hasta === h ? " activo" : ""}" data-hf="rango" data-desde="${d}" data-hasta="${h}">${t}</button>`).join("")}
      <button class="filtro${!b.desde && !b.hasta ? " activo" : ""}" data-hf="rango" data-desde="" data-hasta="">Todas las fechas</button></div>`;
  } else if (pf === "mes") {
    const a = estado.anioMeses;
    fechas = `<div class="anio-nav">
      <button data-hf="anio-nav" data-valor="-1" ${a <= primero.slice(0, 4) ? "disabled" : ""} aria-label="Año anterior">‹</button>
      <b>${a}</b>
      <button data-hf="anio-nav" data-valor="1" ${a >= hoy().slice(0, 4) ? "disabled" : ""} aria-label="Año siguiente">›</button></div>
      <div class="rejilla-meses">${MESES_CORTOS.map((nombre, i) => {
        const mes = `${a}-${String(i + 1).padStart(2, "0")}`;
        const [d, h] = rangoMes(mes);
        const fuera = mes < primero.slice(0, 7) || mes > mesActual();
        return `<button class="${b.desde === d && b.hasta === h ? "activo" : ""}" data-hf="rango" data-desde="${d}" data-hasta="${h}" ${fuera ? "disabled" : ""}>${nombre}</button>`;
      }).join("")}</div>`;
  } else if (pf === "anio") {
    const anios = [];
    for (let a = +hoy().slice(0, 4); a >= +primero.slice(0, 4); a--) anios.push(a);
    fechas = `<div class="opciones">${anios.map((a) => {
      const [d, h] = rangoAnio(a);
      return `<button class="filtro${b.desde === d && b.hasta === h ? " activo" : ""}" data-hf="rango" data-desde="${d}" data-hasta="${h}">${a}</button>`;
    }).join("")}</div>`;
  } else if (pf === "dia") {
    fechas = `<label class="campo"><span>Día</span>
      <input type="date" data-hf-campo="dia" ${limites} value="${b.desde && b.desde === b.hasta ? b.desde : ""}"></label>`;
  } else {
    fechas = `<div class="dos" style="margin-top:12px">
      <label class="campo"><span>Desde</span><input type="date" data-hf-campo="desde" ${limites} value="${b.desde}"></label>
      <label class="campo"><span>Hasta</span><input type="date" data-hf-campo="hasta" ${limites} value="${b.hasta}"></label></div>
      <div class="nota" style="margin-top:6px">Puedes dejar una de las dos vacía.</div>`;
  }

  const cuentas = [...Object.keys(datos.cuentas), ...Object.keys(CUENTAS_APUNTE).filter((c) => datos.movimientos.some((m) => m.cuenta === c && !m._ajuste))];
  // Los tipos según lo elegido arriba: con "Ingresos", solo los que tienen ingresos y con su nombre
  // ("Bizum y transferencias recibidas", "Devoluciones · Compras online"…)
  const usosModo = usosDe(b.tipo);
  const cats = [...usosModo.keys()].sort((x, y) => x.localeCompare(y, "es"));
  const etiquetas = b.tipo === "ingresos" ? Object.fromEntries(cats.map((c) => [c, nombreIngreso(c)])) : {};

  const caja = $("#hoja-contenido");
  const scroll = caja.scrollTop;
  abrirHoja(`<div class="fila"><h3 class="hoja-titulo">Filtros</h3>
      <button class="enlace" data-hf="borrar">Borrar todo</button></div>
    <div class="hoja-seccion"><span>Fechas</span><span id="rango-actual">${esc(nombreRango(b.desde, b.hasta) || "Todas")}</span></div>
    ${seg([["rapido", "Rápido"], ["mes", "Mes"], ["anio", "Año"], ["dia", "Día"], ["entre", "Entre fechas"]], pf, "pestana")}
    ${fechas}
    <div class="hoja-seccion"><span>Movimientos</span></div>
    ${seg([["", "Todos"], ["gastos", "Gastos"], ["ingresos", "Ingresos"]], b.tipo, "tipo")}
    <div class="hoja-seccion"><span>${b.tipo === "ingresos" ? "Tipo de ingreso" : b.tipo === "gastos" ? "Tipo de gasto" : "Tipo"}</span><span id="filtro-tipo-elegido">${esc(b.categoria ? etiquetaTipo(b) : "Todos")}</span></div>
    ${selectorTipos("filtro-tipo", { actual: b.categoria, lista: cats, vacio: "Todos los tipos", conservar: true, usos: usosModo, etiquetas, alElegir: (c) => {
      estado.borrador.categoria = c;
      $("#filtro-tipo-elegido").textContent = c ? etiquetaTipo(estado.borrador) : "Todos";
      $("#ver-filtrados").textContent = textoVer(estado.borrador);
    } })}
    <div class="hoja-seccion"><span>Cuenta</span></div>
    ${seg([["", "Todas"], ...cuentas.map((c) => [c, nombreCuenta(c)])], b.cuenta, "cuenta")}
    <div class="hoja-seccion"><span>Importe</span></div>
    <div class="dos">
      <label class="campo"><span>Desde (€)</span><input type="text" inputmode="decimal" data-hf-campo="min" placeholder="0" value="${esc(b.min)}"></label>
      <label class="campo"><span>Hasta (€)</span><input type="text" inputmode="decimal" data-hf-campo="max" placeholder="Sin límite" value="${esc(b.max)}"></label>
    </div>
    <div class="hoja-seccion"><span>Ordenar</span></div>
    ${seg(ORDENES, b.orden || "", "orden")}
    <button class="boton ancho" id="ver-filtrados" data-hf="aplicar">${textoVer(b)}</button>`);
  caja.scrollTop = scroll;
}

function hojaAjustes() {
  const movs = delBanco();
  const desde = movs.length ? fechaDia(movs[movs.length - 1].fecha) : "—";
  const cuentas = Object.values(datos.cuentas).map((c) =>
    `<div class="dato"><span>${esc(c.banco)}</span><span>${c.error ? "con error" : "al día"} · permiso hasta el ${c.permiso_hasta ? new Date(c.permiso_hasta).toLocaleDateString("es-ES") : "—"}</span></div>`).join("");
  abrirHoja(`<h3 style="font-size:20px;margin-bottom:10px">Ajustes</h3>
    <div class="dato"><span>Movimientos del banco</span><span>${movs.length} desde ${desde}</span></div>
    <div class="dato"><span>Apuntados por ti</span><span>${datos.apuntes.filter((a) => !a._leyendo).length}</span></div>
    <div class="dato"><span>Actualizado</span><span>${haceCuanto(datos.actualizado)}</span></div>
    ${cuentas}
    <div class="dato"><span>Apuntar</span><span>${datos.envio ? "listo" : "falta el permiso de GitHub"}${cola.length ? ` · ${cola.length} sin guardar` : ""}</span></div>
    ${cola.length && datos.envio ? '<button class="boton-sec" data-accion-hoja="reenviar">Enviar ahora lo que falta por guardar</button>' : ""}
    <button class="boton-sec" data-ap="avisos">Avisos en este iPhone</button>
    <button class="boton-sec peligro" data-accion-hoja="bloquear">Bloquear y olvidar la contraseña en este iPhone</button>
    <button class="boton-sec" data-cerrar>Cerrar</button>`);
}

// ---------- Pintar y navegar ----------
function pintar() {
  const main = $("#contenido");
  const vistas = { inicio: vistaInicio, movimientos: vistaMovimientos, tipos: vistaTipos, ahorro: vistaAhorro,
    inversiones: vistaInversiones };
  main.innerHTML = vistas[estado.pestana]();
  if (estado.pestana === "movimientos") pintarLista();
  document.querySelectorAll(".barra [data-pestana]").forEach((b) => b.classList.toggle("activo", b.dataset.pestana === estado.pestana));
}

function ir(pestana) {
  estado.pestana = pestana;
  estado.limite = 80;
  window.scrollTo(0, 0);
  pintar();
}

function mostrarApp() {
  $("#bloqueo").hidden = true;
  $("#contenido").hidden = false;
  $("#barra").hidden = false;
  pintar();
  revisarAvisos();   // ¿llegan los avisos a este iPhone? (si no, Inicio propone renovarlos)
}

function mostrarBloqueo(mensaje) {
  $("#contenido").hidden = true;
  $("#barra").hidden = true;
  $("#bloqueo").hidden = false;
  const error = $("#error-clave");
  error.hidden = !mensaje;
  error.textContent = mensaje || "";
}

// Devuelve si hay datos nuevos. Si el archivo no ha cambiado, no se vuelve a descifrar (es lo más lento).
let ultimoTexto = "";
async function abrir(clave) {
  const texto = await descargar();
  if (crudo && texto === ultimoTexto && clave === contrasena) { cargadoEn = Date.now(); return false; }
  crudo = await descifrar(texto, clave);
  ultimoTexto = texto;
  contrasena = clave;
  cargadoEn = Date.now();
  rehacer();
  return true;
}

async function recargar(silencioso) {
  try {
    const nuevos = await abrir(contrasena);
    // Sin perder lo que estés escribiendo (el buscador, por ejemplo)
    const activo = document.activeElement;
    if (nuevos && (!silencioso || !activo || !activo.matches("#contenido input, #contenido select"))) pintar();
    if (nuevos) revisarAvisos();
    if (!silencioso) aviso(`Datos al día (${haceCuanto(datos.actualizado)})`);
  } catch (e) {
    if (!silencioso) aviso(e.message === "red" ? "Sin conexión: se ven los últimos datos" : "No se han podido cargar los datos");
  }
}

// ---------- Avisos en el iPhone (fase 6) ----------
// Los manda GitHub (avisos.py), cifrados de punta a punta. Aquí se activan (el iPhone pide permiso), se
// elige cuáles y se prueban. La suscripción viaja con lo apuntado (operación "avisos").
const TIPOS_AVISO = [
  ["movimientos", "Movimientos nuevos", "Cada cargo o ingreso, al consultar los bancos (4 veces al día). Algún banco los apunta días después"],
  ["presupuestos", "Presupuestos", "Al llegar al 80 % y al pasarte, una vez al mes por tipo"],
  ["subidas", "Subidas de precio", "Un recibo o una suscripción que llega más cara"],
  ["resumen", "Resumen de la mañana", "Cuando está listo, hacia las 6:30"],
  ["tickets", "Tickets leídos", "Cuando Claude termina de leer una foto"],
  ["mes", "Resumen del mes", "El día 1: lo gastado y lo ahorrado el mes anterior"],
  ["mantenimiento", "Mantenimiento", "Un banco que no se actualiza o un permiso que caduca"],
];
let avisosSub = "";   // la dirección de la suscripción de este iPhone, mientras la hoja está abierta
const avisosPosibles = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const enPantallaInicio = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
function deBase64Url(t) {
  const b = t.replace(/-/g, "+").replace(/_/g, "/");
  return deBase64(b + "=".repeat((4 - (b.length % 4)) % 4));
}
async function registroSW() {
  return Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error("sw")), 4000))]);
}
async function suscripcionActual() {
  try { return await (await registroSW()).pushManager.getSubscription(); } catch { return null; }
}
// Lo apunta sw.js al llegar cada aviso: tipo (k), cuándo salió de GitHub (e) y cuándo llegó (r), en segundos,
// y desde cuándo apunta ("desde"; 0 si no se sabe, con la lista de la versión 21).
async function avisosRecibidos() {
  try {
    const r = await (await caches.open("finanzas-avisos")).match("recibidos");
    const j = r ? await r.json() : null;
    if (Array.isArray(j)) return { desde: 0, lista: j };
    return j && Array.isArray(j.lista) ? { desde: Number(j.desde) || 0, lista: j.lista } : { desde: 0, lista: [] };
  } catch { return { desde: 0, lista: [] }; }
}
// Qué versión del service worker está funcionando (si responde)
async function versionSW() {
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!sw) return "";
  return new Promise((ok) => {
    const canal = new MessageChannel();
    canal.port1.onmessage = (ev) => ok(String(ev.data || ""));
    setTimeout(() => ok(""), 1500);
    sw.postMessage("version", [canal.port2]);
  });
}

// ¿Sigue suscrito este iPhone? Si ha perdido la suscripción y GitHub tiene una, Inicio propone activarlos
// otra vez (un toque: el iPhone solo deja suscribirse al tocar un botón).
let avisosRotos = null;   // null o { sinSuscripcion: true }
async function revisarAvisos() {
  try {
    if (!datos || !avisosPosibles() || !enPantallaInicio() || Notification.permission !== "granted") { avisosRotos = null; return; }
    const lista = (datos.avisos || {}).suscripciones || [];
    const sub = await suscripcionActual();
    const nuevo = !sub && lista.length ? { sinSuscripcion: true } : null;
    const cambia = JSON.stringify(nuevo) !== JSON.stringify(avisosRotos);
    avisosRotos = nuevo;
    if (cambia && estado.pestana === "inicio" && !document.querySelector("#contenido input:focus")) pintar();
  } catch { /* sin comprobarlo, la app sigue igual */ }
}
function alertaAvisos() {
  if (!avisosRotos) return "";
  return `<div class="alerta roja fila"><span>Los avisos se han desactivado en este iPhone.</span>
    <button class="enlace" data-accion="avisos-renovar">Activar</button></div>`;
}
// Una suscripción nueva en lugar de la de antes (que GitHub quita, con sus preferencias). Al tocar un botón.
async function renovarAvisos() {
  let permiso = Notification.permission;
  if (permiso !== "granted") {
    try { permiso = await Notification.requestPermission(); } catch { permiso = Notification.permission; }
  }
  if (permiso !== "granted") { hojaAvisos(); return; }
  try {
    const reg = await registroSW();
    const vieja = await reg.pushManager.getSubscription();
    const misSubs = (datos.avisos || {}).suscripciones || [];
    const antes = vieja ? vieja.endpoint : (misSubs.length === 1 ? misSubs[0].endpoint : "");
    if (vieja) await vieja.unsubscribe();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: deBase64Url(datos.avisos.publica) });
    const j = sub.toJSON();
    encolar({ tipo: "avisos", suscripcion: { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, antes });
    avisosRotos = null;
    cerrarHoja();
    pintar();
    aviso("Avisos renovados: en un minuto te llega uno de prueba");
  } catch {
    aviso("No se han podido renovar los avisos");
    hojaAvisos();
  }
}
function horaAviso(seg) {
  const f = new Date(seg * 1000);
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
  const dia = f.toDateString() === new Date().toDateString() ? "hoy"
    : f.toDateString() === ayer.toDateString() ? "ayer" : `el ${f.getDate()}/${f.getMonth() + 1}`;
  return `${dia} a las ${horaCorta(f)}`;
}
function listaRecibidos({ lista: recibidos }) {
  const nombres = Object.fromEntries(TIPOS_AVISO.map(([k, nombre]) => [k, nombre]));
  nombres.prueba = "Aviso de prueba";
  const filas = recibidos.slice(0, 8).map((x) => {
    // Si tardó más de 5 minutos, también cuándo salió de GitHub
    const mismoDia = new Date(x.e * 1000).toDateString() === new Date(x.r * 1000).toDateString();
    const tarde = x.e && x.r - x.e > 300
      ? ` (salió ${mismoDia ? `a las ${horaCorta(new Date(x.e * 1000))}` : horaAviso(x.e)})` : "";
    return `<div class="aviso-tipo"><span><b>${esc(nombres[x.k] || "Aviso")}</b><small>Llegó ${horaAviso(x.r)}${tarde}</small></span></div>`;
  }).join("");
  return `<p class="suave" style="margin-top:16px"><b>Los últimos que ha recibido la app</b></p>
    ${filas ? `<div class="avisos-lista solo-texto">${filas}</div>` : '<p class="nota">Aquí verás a qué hora llega cada aviso.</p>'}
    <p class="nota">Si la app lleva un rato sin usarse, el iPhone enseña el aviso él solo y no sale aquí.</p>`;
}

async function hojaAvisos() {
  const cerrar = '<button class="boton-sec" data-cerrar>Cerrar</button>';
  const cabecera = '<h3 style="font-size:20px;margin-bottom:6px">Avisos</h3>';
  if (!avisosPosibles()) {
    abrirHoja(`${cabecera}<p class="suave">${enPantallaInicio() ? "Este navegador no admite avisos."
      : "Para activar los avisos, abre la app desde su icono de la pantalla de inicio."}</p>${cerrar}`);
    return;
  }
  const sub = await suscripcionActual();
  avisosSub = sub ? sub.endpoint : "";
  const guardada = sub && ((datos.avisos || {}).suscripciones || []).find((x) => x.endpoint === sub.endpoint);
  const lista = (prefs) => TIPOS_AVISO.map(([k, nombre, detalle]) => `<label class="aviso-tipo"><span><b>${nombre}</b><small>${detalle}</small></span>
    <input type="checkbox" data-aviso="${k}" ${!prefs || prefs[k] !== false ? "checked" : ""}></label>`).join("");
  if (Notification.permission === "denied") {
    abrirHoja(`${cabecera}<p class="suave">Los avisos están bloqueados para Finanzas. Para permitirlos: Ajustes del iPhone → Notificaciones → Finanzas.</p>${cerrar}`);
  } else if (guardada && Notification.permission === "granted") {
    const [recibidos, version] = await Promise.all([avisosRecibidos(), versionSW()]);
    abrirHoja(`${cabecera}<p class="suave">Activados en este iPhone. Elige cuáles quieres:</p>
      <div class="avisos-lista">${lista(guardada.prefs)}</div>
      <button class="boton ancho" data-ap="avisos-guardar">Guardar</button>
      <button class="boton-sec" data-ap="avisos-prueba">Enviar un aviso de prueba</button>
      <button class="boton-sec" data-ap="avisos-renovar">Renovar los avisos (si no llegan)</button>
      ${listaRecibidos(recibidos)}
      ${version ? `<p class="nota">Versión de la app: ${esc(version.replace(/\D+/g, ""))}</p>` : ""}
      <button class="boton-sec peligro" data-ap="avisos-quitar">Desactivar los avisos en este iPhone</button>${cerrar}`);
  } else {
    const listo = !!(datos.avisos && datos.avisos.publica);
    abrirHoja(`${cabecera}<p class="suave">Te llegan al iPhone, con los importes exactos. Van cifrados: Apple los transporta sin poder leerlos.
      En la pantalla de bloqueo se ven, salvo que en Ajustes del iPhone → Notificaciones → Finanzas pongas la vista previa en «Nunca».</p>
      <div class="avisos-lista solo-texto">${TIPOS_AVISO.map(([, nombre, detalle]) => `<div class="aviso-tipo"><span><b>${nombre}</b><small>${detalle}</small></span></div>`).join("")}</div>
      <p class="nota">Después podrás elegir cuáles quieres.</p>
      ${listo ? '<button class="boton ancho" data-ap="avisos-activar">Activar avisos</button>'
        : '<p class="nota">Estarán listos en cuanto se actualicen los datos (en alrededor de un minuto).</p>'}${cerrar}`);
  }
}

async function activarAvisos() {
  let permiso;
  try { permiso = await Notification.requestPermission(); } catch { permiso = Notification.permission; }
  if (permiso !== "granted") { hojaAvisos(); return; }
  try {
    const reg = await registroSW();
    const clave = deBase64Url(datos.avisos.publica);
    let sub = await reg.pushManager.getSubscription();
    const actual = sub && sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
    if (sub && actual && actual.join() !== clave.join()) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave });
    const j = sub.toJSON();
    // Si GitHub tiene una sola suscripción y no es esta, es la de antes de este iPhone: se sustituye
    const misSubs = (datos.avisos || {}).suscripciones || [];
    const antes = misSubs.length === 1 && misSubs[0].endpoint !== j.endpoint ? misSubs[0].endpoint : "";
    encolar({ tipo: "avisos", suscripcion: { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, antes });
    avisosRotos = null;
    aviso("Avisos activados: en un minuto te llega uno de prueba");
    hojaAvisos();
  } catch {
    aviso("No se han podido activar los avisos");
  }
}

function guardarAvisos() {
  const prefs = {};
  document.querySelectorAll("#hoja [data-aviso]").forEach((c) => { prefs[c.dataset.aviso] = c.checked; });
  encolar({ tipo: "avisos", endpoint: avisosSub, prefs });
  cerrarHoja();
  aviso("Avisos guardados");
}

async function quitarAvisos() {
  const sub = await suscripcionActual();
  if (sub) await sub.unsubscribe().catch(() => {});
  if (avisosSub) encolar({ tipo: "avisos", endpoint: avisosSub, quitar: true });
  cerrarHoja();
  aviso("Avisos desactivados en este iPhone");
}

// Al tocar un aviso se abre lo que toca: el movimiento, el resumen, el mes, el tipo… Llega detrás de "#"
// (ir=…, con el tipo y la hora del aviso, que aquí no se usan). Si la app ya estaba abierta y el aviso lo
// enseñó el iPhone solo, solo cambia lo de detrás de "#" (hashchange).
function destinoDeLaDireccion() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.has("ir") || p.has("k")) history.replaceState(null, "", location.pathname + location.search);
  return p.get("ir") || "";
}
let destinoAviso = destinoDeLaDireccion();
addEventListener("hashchange", () => {
  const d = destinoDeLaDireccion();
  if (d) { destinoAviso = d; if (datos) irAlAviso(); }
});
function irA(destino) {
  if (!datos || !destino) return;
  const [que, ...resto] = destino.split(":");
  const valor = resto.join(":");
  cerrarHoja();
  if (que === "mov") {
    estado.filtro = filtroVacio();
    ir("movimientos");
    if (datos.movimientos.some((m) => m.id === valor)) hojaMovimiento(valor);
  } else if (que === "resumen") {
    ir("inversiones");
    if ((datos.inversiones || {}).resumen) hojaResumen();
  } else if (que === "ahorro") {
    if (/^\d{4}-\d{2}$/.test(valor)) { estado.ahorro.modo = "mes"; estado.ahorro.mes = valor; }
    ir("ahorro");
  } else if (que === "tipo") {
    estado.ahorro.modo = "mes";
    estado.ahorro.mes = mesActual();
    estado.tipos.vista = "gastos";
    ir("tipos");
    hojaTipo(valor, { mes: mesActual() });
  } else if (que === "cargos") {
    ir("inicio");
    hojaCargos();
  } else if (["inicio", "movimientos", "tipos", "ahorro", "inversiones"].includes(que)) ir(que);
}
function irAlAviso() {
  const d = destinoAviso;
  destinoAviso = "";
  if (d) irA(d);
}

// ---------- Pedir lo nuevo a los bancos (fase 6) ----------
// Al abrir la app (o volver a ella), si lo último de los bancos tiene más de 15 minutos, se lanza la
// sincronización de GitHub. Va con la dirección de internet del iPhone y su navegador, cifrados: así el
// banco sabe que estás delante y no cuenta en las 4 consultas del día. Mientras, se ven los datos de antes
// y se miran cada 15 segundos (5 minutos como mucho).
const PEDIDO = "finanzas-pedido";   // cuándo se pidió la última vez (para no repetir antes de 15 minutos)
const ESPERA_BANCOS = 15;
const bancos = { activo: false, sondeo: null, hasta: 0, antes: null, ids: null };
const minutosDesde = (t) => (t ? (Date.now() - new Date(t).getTime()) / 60000 : Infinity);
function ultimoPedido() { try { return +localStorage.getItem(PEDIDO) || 0; } catch { return 0; } }

function lineaActualizado(centro = false) {
  const boton = bancos.activo ? '<span class="tenue">actualizando…</span>'
    : '<button class="enlace" data-accion="actualizar-bancos">Actualizar</button>';
  const texto = `Actualizado ${haceCuanto(datos.actualizado)} · ${boton}`;
  return centro ? texto : `<div class="nota actualizado">${texto}</div>`;
}
function bandaBancos() {
  return bancos.activo ? '<div class="alerta violeta">Pidiendo lo nuevo a los bancos… Tarda alrededor de un minuto.</div>' : "";
}

async function pedirBancos(manual = false) {
  if (bancos.activo || !datos || !contrasena) return;
  if (!datos.envio) { if (manual) aviso("Falta dar a la app el permiso de GitHub (en el portátil)"); return; }
  if (!manual && (minutosDesde(datos.actualizado) < ESPERA_BANCOS || Date.now() - ultimoPedido() < ESPERA_BANCOS * 60000)) return;
  if (manual && minutosDesde(datos.actualizado) < 2) { aviso("Los bancos se acaban de consultar"); return; }
  bancos.activo = true;
  bancos.antes = datos.actualizado;
  bancos.ids = new Set(datos.movimientos.map((m) => m.id));
  pintarSiInicio();
  try {
    const ip = await fetch("https://api.ipify.org?format=json", { cache: "no-store" })
      .then((r) => r.json()).then((j) => String(j.ip || "")).catch(() => "");
    if (!ip) throw new Error("red");
    const psu = await cifrar({ ip, ua: navigator.userAgent, t: new Date().toISOString() }, contrasena);
    const r = await fetch(datos.envio.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${datos.envio.token}`, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: datos.envio.ref || "main", inputs: { actualizar: "bancos", cartera: psu } }),
    }).catch(() => { throw new Error("red"); });
    if ([401, 403, 404].includes(r.status)) throw new Error("permiso");
    if (!r.ok) throw new Error("github");
  } catch (e) {
    bancos.activo = false;
    pintarSiInicio();
    if (manual || e.message === "permiso") {
      aviso(e.message === "red" ? "Sin conexión: no se ha podido actualizar"
        : e.message === "permiso" ? "GitHub no acepta el permiso de la app: puede haber caducado" : "GitHub no responde: prueba en un rato");
    }
    return;
  }
  try { localStorage.setItem(PEDIDO, String(Date.now())); } catch { /* sin almacenamiento */ }
  bancos.hasta = Date.now() + 5 * 60000;
  clearTimeout(bancos.sondeo);
  bancos.sondeo = setTimeout(sondearBancos, 30000);
}

async function sondearBancos() {
  bancos.sondeo = null;
  if (!bancos.activo) return;
  if (document.visibilityState === "visible") {
    await recargar(true);
    if (datos.actualizado !== bancos.antes) {
      const n = datos.movimientos.filter((m) => !m._ajuste && !m._apunte && !bancos.ids.has(m.id)).length;
      const fallo = Object.values(datos.cuentas).some((c) => c.error);
      bancos.activo = false;
      pintarSiInicio();
      aviso(fallo ? "Algún banco no se ha podido actualizar: mira el aviso en Inicio"
        : n ? `${n} ${n === 1 ? "movimiento nuevo" : "movimientos nuevos"}` : "Al día: no hay movimientos nuevos");
      return;
    }
  }
  if (Date.now() > bancos.hasta) {
    bancos.activo = false;
    pintarSiInicio();
    aviso("Los bancos tardan en responder: lo nuevo saldrá en un rato");
    return;
  }
  bancos.sondeo = setTimeout(sondearBancos, 15000);
}

function mensajeError(e) {
  if (e.message === "contrasena") return "Contraseña incorrecta.";
  if (e.message === "red") return "No hay conexión y aún no hay datos guardados en este iPhone.";
  return "No se han podido abrir los datos.";
}

// ---------- Eventos ----------
$("#form-clave").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const clave = $("#clave").value.trim();
  if (!clave) return;
  const boton = $("#entrar");
  boton.disabled = true;
  boton.textContent = "Abriendo…";
  try {
    await abrir(clave);
    guardarClave(clave, $("#recordar").checked);
    $("#clave").value = "";
    mostrarApp();
    irAlAviso();
    if (cola.length) enviar();
    pedirBancos();
  } catch (e) {
    mostrarBloqueo(mensajeError(e));
  } finally {
    boton.disabled = false;
    boton.textContent = "Entrar";
  }
});

$("#contenido").addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-accion]");
  if (!el) return;
  const a = el.dataset.accion;
  if (a === "avisos-renovar") renovarAvisos();
  else if (a === "mov") hojaMovimiento(el.dataset.id);
  else if (a === "ver-movs") { estado.filtro = filtroVacio(); ir("movimientos"); }
  else if (a === "cat") hojaTipo(el.dataset.cat, el.dataset);
  else if (a === "movs") irAMovimientos(el.dataset);
  else if (a === "tipos-vista") { estado.tipos.vista = el.dataset.v; pintar(); }
  else if (a === "tipos-orden") { estado.tipos.orden = el.dataset.v; pintar(); }
  else if (a === "filtros") hojaFiltros();
  else if (a === "calculo") hojaCalculo(el.dataset.mes);
  else if (a === "quitar" || a === "atajo" || a === "filtrar-cat" || a === "borrar-filtros") {
    const f = estado.filtro;
    const q = el.dataset.que;
    if (a === "quitar") {
      if (q === "fechas") { f.desde = ""; f.hasta = ""; }
      else if (q === "importe") { f.min = ""; f.max = ""; }
      else f[q] = "";
    } else if (a === "atajo") {
      if (el.dataset.desde) { f.desde = el.dataset.desde; f.hasta = el.dataset.hasta; }
      if (el.dataset.tipo) f.tipo = el.dataset.tipo;
      if (el.dataset.cuenta) f.cuenta = el.dataset.cuenta;
    } else if (a === "filtrar-cat") {
      f.categoria = el.dataset.cat;
      if (el.dataset.tipo) f.tipo = el.dataset.tipo;
    }
    else estado.filtro = filtroVacio();
    estado.limite = 80;
    pintar();
  }
  else if (a === "mas-movs") { estado.limite += 120; pintarLista(); }
  else if (a === "ajustes") hojaAjustes();
  else if (a === "recargar") recargar(false);
  else if (a === "actualizar-bancos") pedirBancos(true);
  else if (a === "presupuestos") hojaPresupuestos();
  else if (a === "reenviar") { envio.error = ""; enviar(true); }
  else if (a === "producto") hojaProducto(el.dataset.isin, el.dataset.broker);
  else if (a === "actualizar-inv") actualizarInversiones(el.dataset.clave);
  else if (a === "resumen") hojaResumen();
  else if (a === "mercado") hojaMercado(el.dataset.i);
  else if (a === "noticias") hojaNoticias();
  else if (a === "evolucion") hojaEvolucion();
  else if (a === "cobros") hojaCobros();
  else if (a === "reparto") { estado.reparto = el.dataset.v; pintar(); }
  else if (a === "orden-prod") { estado.ordenProd = el.dataset.v; pintar(); }
  else if (a === "discreto") {
    discreto = !discreto;
    try { localStorage.setItem(DISCRETO, discreto ? "1" : "0"); } catch { /* sin almacenamiento */ }
    pintar();
    aviso(discreto ? "Importes ocultos" : "Importes visibles");
  }
  else if (a === "cuenta") { estado.filtro = { ...filtroVacio(), cuenta: el.dataset.cuenta }; ir("movimientos"); }
  else if (a === "ir") ir(el.dataset.pestana);
  else if (a === "cargos") hojaCargos();
  else if (a.startsWith("ahorro-")) accionAhorro(a, el.dataset);
  else if (a === "saldo") hojaSaldo();
});

$("#contenido").addEventListener("change", (ev) => {
  const k = ev.target.dataset && ev.target.dataset.ahorroFecha;
  if (!k || !ev.target.value) return;
  estado.ahorro[k] = ev.target.value;
  pintar();
});
$("#contenido").addEventListener("input", (ev) => {
  if (ev.target.id === "buscar") { estado.filtro.texto = ev.target.value; estado.limite = 80; pintarLista(); }
  if (ev.target.id === "buscar-tipo") { estado.tipos.q = ev.target.value; $("#lista-tipos").innerHTML = filasTipos(contextoTipos()); }
});

document.querySelectorAll(".barra [data-pestana]").forEach((b) => b.addEventListener("click", () => ir(b.dataset.pestana)));
$("#mas").addEventListener("click", () => { if (datos) hojaApuntar(); });

// Acciones de las hojas de apuntar, movimiento y presupuestos
async function accionHoja(el) {
  const id = el.dataset.id;
  switch (el.dataset.ap) {
    case "nuevo": hojaApunte(null); break;
    case "editar": hojaApunte(id); break;
    case "guardar": guardarApunte(); break;
    case "guardar-mov": guardarMov(id); break;
    case "guardar-presu": guardarPresupuestos(); break;
    case "enviar-foto": el.disabled = true; await enviarFoto(); break;
    case "cancelar-foto": soltarFoto(); cerrarHoja(); break;
    case "borrar":
      if (!el.dataset.seguro) { el.dataset.seguro = "1"; el.textContent = "¿Seguro? Toca otra vez"; return; }
      encolar({ tipo: "borrar", apunte: id });
      cerrarHoja();
      aviso("Borrado");
      break;
    case "auto": {
      const c = datos.cambios[id] || {};
      encolar({ tipo: "cambio", mov: id, categoria: "", nota: c.nota || "" });
      cerrarHoja();
      break;
    }
    case "avisos": hojaAvisos(); break;
    case "avisos-activar": activarAvisos(); break;   // sin esperar antes: el iPhone solo pide permiso al tocar
    case "avisos-guardar": guardarAvisos(); break;
    case "avisos-prueba": encolar({ tipo: "avisos", endpoint: avisosSub, prueba: true }); cerrarHoja(); aviso("En un minuto te llega un aviso de prueba"); break;
    case "avisos-quitar": quitarAvisos(); break;
    case "avisos-renovar": renovarAvisos(); break;   // sin esperar antes: el iPhone solo deja suscribirse al tocar
    default: break;
  }
}

// Ahorro: cambiar de modo, de mes o año, de fechas o de comparación
function accionAhorro(a, d) {
  const e = estado.ahorro;
  const p = periodoAhorro();
  if (a === "ahorro-modo") {
    if (d.v === "anio") e.anio = +p.desde.slice(0, 4);
    if (d.v === "mes" && p.tipo === "anio") e.mes = p.enCurso ? mesActual() : `${p.anio}-12`;
    if (d.v === "fechas" && !e.desde) { e.desde = mesesAtras(3); e.hasta = hoy(); }
    e.modo = d.v;
  } else if (a === "ahorro-nav") {
    if (p.tipo === "mes") e.mes = mesMas(p.mes, +d.dir);
    else e.anio = p.anio + +d.dir;
  } else if (a === "ahorro-ir") {
    if (d.mes) { e.modo = "mes"; e.mes = d.mes; } else { e.modo = "anio"; e.anio = +d.anio; }
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else if (a === "ahorro-rango") { e.desde = d.desde; e.hasta = d.hasta; }
  else if (a === "ahorro-comparar") e.comparar = d.v;
  else if (a === "ahorro-detalle") { hojaComparar(); return; }
  pintar();
}

// Movimientos filtrados por lo que lleve el botón: tipo, gastos o ingresos, mes o año, y texto
function irAMovimientos(d) {
  estado.filtro = { ...filtroVacio(d.q || ""), categoria: d.cat || "", tipo: d.tipo || "" };
  if (d.mes) [estado.filtro.desde, estado.filtro.hasta] = rangoMes(d.mes);
  if (d.anio) [estado.filtro.desde, estado.filtro.hasta] = rangoAnio(d.anio);
  if (d.desde) [estado.filtro.desde, estado.filtro.hasta] = [d.desde, d.hasta];
  ir("movimientos");
}

// Acciones de las hojas nuevas (cargos fijos, ficha de un tipo, detalle de un mes, noticias…)
function accionH(el) {
  const d = el.dataset;
  switch (d.h) {
    case "comercio": estado.filtro = filtroVacio(d.q); cerrarHoja(); ir("movimientos"); break;
    case "movs": cerrarHoja(); irAMovimientos(d); break;
    case "tipo": hojaTipo(d.cat, d); break;
    case "tipo-escala": estado.tipos.escala = d.v; if (fichaTipo) hojaTipo(fichaTipo.cat, fichaTipo.o); break;
    case "presu-media": { const campo = $("#hoja [data-presu]"); if (campo) campo.value = d.v; break; }
    case "presupuestos": hojaPresupuestos(); break;
    case "tema-noticias": estado.temaNoticias = d.tema; hojaNoticias(); break;
    case "ver-tipos":
      if (d.mes) { estado.ahorro.modo = "mes"; estado.ahorro.mes = d.mes; }
      if (d.anio) { estado.ahorro.modo = "anio"; estado.ahorro.anio = +d.anio; }
      cerrarHoja();
      ir("tipos");
      break;
    default: break;
  }
}

function elegirSegmento(boton) {
  const grupo = boton.closest("[data-grupo]");
  grupo.querySelectorAll("button").forEach((b) => b.classList.toggle("activo", b === boton));
  const v = boton.dataset.v;
  if (grupo.dataset.grupo === "signo") {
    estado.apunte.gasto = v === "gasto";
    $("#ap-tipo-campo").hidden = !estado.apunte.gasto;
    sugerenciasConcepto();
  } else if (grupo.dataset.grupo === "pago") {
    estado.apunte.pago = v;
    $("#ap-pago-nota").textContent = textoPago(v);
  } else if (grupo.dataset.grupo === "pago-foto" && estado.foto) {
    estado.foto.pago = v;
  }
}

$("#hoja").addEventListener("click", (ev) => {
  if (ev.target.id === "hoja" || ev.target.closest("[data-cerrar]")) { soltarFoto(); cerrarHoja(); }
  const elegido = ev.target.closest("[data-tipo-elegir]");
  if (elegido) { elegirTipo(elegido.dataset.selectorId, elegido.dataset.tipoElegir); return; }
  const sugerencia = ev.target.closest("[data-sugerencia]");
  if (sugerencia) {
    $("#ap-concepto").value = sugerencia.dataset.sugerencia;
    $("#ap-sugerencias").hidden = true;
    if (sugerencia.dataset.cat) elegirTipo("ap-tipo", sugerencia.dataset.cat);
    return;
  }
  const verTipos = ev.target.closest("[data-tipos-abrir]");
  if (verTipos) {
    const id = verTipos.dataset.tiposAbrir;
    selectores[id].abierto = !selectores[id].abierto;
    $(`#${id}-lista`).innerHTML = listaTipos(id);
    return;
  }
  const rango = ev.target.closest("[data-rango]");
  if (rango && grafico) {
    grafico.rango = estado.rangos[grafico.id] = rango.dataset.rango;
    $("#graf-zona").innerHTML = zonaGrafico();
    return;
  }
  if (ev.target.closest("[data-accion-hoja=bloquear]")) { olvidarClave(); location.reload(); }
  if (ev.target.closest("[data-accion-hoja=reenviar]")) { cerrarHoja(); envio.error = ""; enviar(true); return; }
  const h = ev.target.closest("[data-h]");
  if (h) { accionH(h); return; }
  const mov = ev.target.closest("[data-accion=mov]");
  if (mov) { hojaMovimiento(mov.dataset.id); return; }
  const ap = ev.target.closest("[data-ap]");
  if (ap) { accionHoja(ap); return; }
  const opcion = ev.target.closest("[data-grupo] button");
  if (opcion) { elegirSegmento(opcion); return; }
  const el = ev.target.closest("[data-hf]");
  if (!el || !estado.borrador) return;
  const b = estado.borrador;
  const v = el.dataset.valor;
  switch (el.dataset.hf) {
    case "pestana": estado.pestanaFecha = v; break;
    case "rango": b.desde = el.dataset.desde; b.hasta = el.dataset.hasta; break;
    case "anio-nav": estado.anioMeses = String(+estado.anioMeses + +v); break;
    case "tipo":
      b.tipo = v;
      if (b.categoria && !usosDe(v).has(b.categoria)) b.categoria = "";
      break;
    case "cuenta": b.cuenta = v; break;
    case "orden": b.orden = v; break;
    case "borrar": estado.borrador = filtroVacio(b.texto); estado.pestanaFecha = "rapido"; delete selectores["filtro-tipo"]; break;
    case "aplicar": {
      if (b.desde && b.hasta && b.desde > b.hasta) [b.desde, b.hasta] = [b.hasta, b.desde];
      const [min, max] = [numero(b.min), numero(b.max)];
      b.min = min === null ? "" : String(min).replace(".", ",");
      b.max = max === null ? "" : String(max).replace(".", ",");
      if (min !== null && max !== null && min > max) [b.min, b.max] = [b.max, b.min];
      estado.filtro = b;
      estado.borrador = null;
      estado.limite = 80;
      cerrarHoja();
      window.scrollTo(0, 0);
      pintar();
      return;
    }
    default: return;
  }
  pintarHojaFiltros();
});

// Campos de la hoja de filtros: se actualiza el recuento sin volver a pintar (para no perder el teclado).
function campoFiltro(ev) {
  const campo = ev.target.dataset && ev.target.dataset.hfCampo;
  if (!campo || !estado.borrador) return;
  const b = estado.borrador;
  const valor = ev.target.value;
  if (campo === "dia") { b.desde = valor; b.hasta = valor; }
  else b[campo] = valor;
  $("#ver-filtrados").textContent = textoVer(b);
  if (campo === "dia" || campo === "desde" || campo === "hasta") $("#rango-actual").textContent = nombreRango(b.desde, b.hasta) || "Todas";
}
$("#hoja").addEventListener("input", campoFiltro);
$("#hoja").addEventListener("input", (ev) => {
  if (ev.target.id === "ap-concepto") { sugerenciasConcepto(); return; }
  const id = ev.target.dataset && ev.target.dataset.buscarTipo;
  if (!id || !selectores[id]) return;
  selectores[id].q = ev.target.value;
  $(`#${id}-lista`).innerHTML = listaTipos(id);
});
// Intro en la lupa: elige el primer tipo que sale (y se cierra el teclado)
$("#hoja").addEventListener("keydown", (ev) => {
  const id = ev.target.dataset && ev.target.dataset.buscarTipo;
  if (!id || ev.key !== "Enter") return;
  ev.preventDefault();
  const primero = $(`#${id}-lista [data-tipo-elegir]:not([data-tipo-elegir=""])`);
  if (primero) elegirTipo(id, primero.dataset.tipoElegir);
  ev.target.blur();
});
$("#hoja").addEventListener("pointerdown", moverCursor);
$("#hoja").addEventListener("pointermove", moverCursor);
$("#hoja").addEventListener("pointerup", soltarCursor);
$("#hoja").addEventListener("pointerleave", soltarCursor);
$("#hoja").addEventListener("pointercancel", soltarCursor);
$("#hoja").addEventListener("change", (ev) => {
  if (ev.target.id === "foto-ticket") {
    if (ev.target.files && ev.target.files[0]) prepararFoto(ev.target.files[0]);
    return;
  }
  if (ev.target.id === "ap-concepto") { tipoDeConcepto(); return; }
  campoFiltro(ev);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (registro) registro.update().catch(() => {});   // ¿hay una versión nueva de la app?
  if (!datos) return;
  if (Date.now() - cargadoEn > 10 * 60000) recargar(true).then(() => pedirBancos());
  else pedirBancos();
  if (cola.length) enviar();
});

// Deslizar una hoja hacia abajo la cierra (si está arriba del todo y no se está tocando un gráfico)
const arrastre = { posible: false, activo: false, x0: 0, y0: 0, dy: 0 };
const cajaHoja = $("#hoja-contenido");
cajaHoja.addEventListener("touchstart", (ev) => {
  arrastre.posible = ev.touches.length === 1 && cajaHoja.scrollTop <= 0 && !ev.target.closest("[data-grafico], input, textarea");
  arrastre.activo = false;
  arrastre.dy = 0;
  if (arrastre.posible) { arrastre.x0 = ev.touches[0].clientX; arrastre.y0 = ev.touches[0].clientY; }
}, { passive: true });
cajaHoja.addEventListener("touchmove", (ev) => {
  if (!arrastre.posible) return;
  const dy = ev.touches[0].clientY - arrastre.y0;
  const dx = ev.touches[0].clientX - arrastre.x0;
  if (!arrastre.activo) {
    if (dy < -4 || Math.abs(dx) > 10) { arrastre.posible = false; return; }
    if (dy < 10 || Math.abs(dx) > dy) return;
    arrastre.activo = true;
  }
  ev.preventDefault();
  arrastre.dy = Math.max(0, dy - 10);
  cajaHoja.style.transition = "none";
  cajaHoja.style.transform = `translateY(${arrastre.dy}px)`;
}, { passive: false });
function soltarHoja() {
  if (!arrastre.activo) return;
  arrastre.activo = false;
  cajaHoja.style.transition = "transform .2s ease-out";
  if (arrastre.dy > Math.min(140, cajaHoja.offsetHeight * 0.25)) {
    cajaHoja.style.transform = "translateY(100%)";
    setTimeout(() => { soltarFoto(); cerrarHoja(); }, 190);
  } else cajaHoja.style.transform = "";
}
cajaHoja.addEventListener("touchend", soltarHoja);
cajaHoja.addEventListener("touchcancel", soltarHoja);

// ---------- Versión nueva de la app ----------
// El service worker baja la versión nueva por detrás. Cuando toma el control, se ofrece recargar
// (sin recargar solo, para no perder lo que estés escribiendo).
let registro = null;
if ("serviceWorker" in navigator) {
  let controlador = navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").then((r) => { registro = r; }).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (controlador) $("#version").hidden = false;   // la primera instalación no es una versión nueva
    controlador = navigator.serviceWorker.controller;
  });
}
$("#version-boton").addEventListener("click", () => location.reload());
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (ev) => {
    const d = ev.data || {};
    if (typeof d.ir !== "string") return;
    destinoAviso = d.ir;
    if (datos) recargar(true).then(irAlAviso);
  });
}

// ---------- Arranque ----------

(async () => {
  const guardada = claveGuardada();
  if (!guardada) { mostrarBloqueo(); return; }
  $("#bloqueo").hidden = true;
  $("#contenido").hidden = false;
  $("#contenido").innerHTML = '<div class="cargando">Abriendo tus datos…</div>';
  try {
    await abrir(guardada);
    mostrarApp();
    irAlAviso();
    if (cola.length) enviar();
    pedirBancos();
  } catch (e) {
    if (e.message === "contrasena") olvidarClave();
    mostrarBloqueo(mensajeError(e));
  }
})();
