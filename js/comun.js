// Utilidades compartidas entre la reserva y la administración
'use strict';

const API = 'api/api.php';

async function api(accion, { params = {}, body = null } = {}) {
  const qs = new URLSearchParams({ accion, ...params });
  const opciones = { credentials: 'same-origin', headers: {} };
  if (body !== null) {
    opciones.method = 'POST';
    opciones.headers['Content-Type'] = 'application/json';
    opciones.headers['X-Requested-With'] = 'reservas';
    opciones.body = JSON.stringify(body);
  }
  let resp, datos;
  try {
    resp = await fetch(`${API}?${qs}`, opciones);
    datos = await resp.json();
  } catch (e) {
    throw Object.assign(new Error('No se ha podido conectar con el servidor. Revisa tu conexión.'), { codigo: 0 });
  }
  if (!resp.ok || !datos.ok) {
    throw Object.assign(new Error(datos.error || 'Error inesperado.'), { codigo: resp.status, datos });
  }
  return datos;
}

// ---------- fechas (siempre 'AAAA-MM-DD') ----------
function aFecha(iso) { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); }
function aIso(fecha) {
  const p = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`;
}
const mayus = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtLargo = (iso) => mayus(aFecha(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
const fmtCorto = (iso) => aFecha(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtNum = (iso) => aFecha(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Igual que claveNombre() en PHP: sin mayúsculas ni tildes en las vocales
function claveNombre(n) {
  const mapa = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', à: 'a', è: 'e', ì: 'i', ò: 'o', ù: 'u' };
  return n.trim().replace(/\s+/g, ' ').toLowerCase().replace(/[áéíóúüàèìòù]/g, (c) => mapa[c]);
}

// ---------- DOM ----------
const $ = (sel, raiz = document) => raiz.querySelector(sel);

function el(etiqueta, attrs = {}, ...hijos) {
  const n = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const h of hijos.flat()) if (h !== null && h !== undefined && h !== false) n.append(h instanceof Node ? h : document.createTextNode(String(h)));
  return n;
}

let temporizadorToast;
function toast(texto, error = false) {
  let t = $('#toast');
  if (!t) { t = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = texto;
  t.classList.toggle('error', error);
  t.classList.add('visible');
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => t.classList.remove('visible'), error ? 4500 : 2500);
}

const nombreRecurso = (cfg, id) => (cfg.recursos.find((r) => r.id === id) || { nombre: id }).nombre;
const franjaPorId = (cfg, id) => cfg.franjas.find((f) => f.id === id) || { inicio: '?', fin: '?' };
