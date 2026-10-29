// Reserva de aulas en una sola pantalla
'use strict';

const CARRO = 'CARRO';
const LS_NOMBRE = 'ra_nombre';
const LS_CICLO = 'ra_ciclo';

const estado = {
  cfg: null,
  nombre: '',
  ciclo: '',
  aula: 'INF1',
  ordenadores: 1,
  mes: null,            // Date (día 1) del mes del calendario
  dia: null,            // 'AAAA-MM-DD' del día que se muestra
  carrito: new Map(),   // clave → { fecha, franja, recurso, ordenadores }
  ocupacion: new Map(), // clave → [{ id, nombre, ciclo, ordenadores, propia }]
  ocupMes: new Map(),   // fecha → { horas, ordenadores } del aula elegida (colores del calendario)
  misReservas: [],      // reservas hechas desde este equipo
  editando: null,       // id de la reserva que se está editando
  enviando: false,
};

const clave = (fecha, franja, recurso) => `${fecha}|${franja}|${recurso}`;
const esCarro = (recurso) => recurso === CARRO;
const ordenadoresPara = (recurso) => (esCarro(recurso) ? estado.ordenadores : 1);
const capacidad = () => estado.cfg.carroOrdenadores;
const reservables = () => estado.cfg.franjas.filter((f) => !f.recreo);
const indiceFranja = (id) => estado.cfg.franjas.findIndex((f) => f.id === id);
const nombreAula = (id) => nombreRecurso(estado.cfg, id);
const horaDe = (id) => { const f = franjaPorId(estado.cfg, id); return `${f.inicio}–${f.fin}`; };
const esMio = (r) => r.propia === true;
const ocupantes = (fecha, franja, recurso) => estado.ocupacion.get(clave(fecha, franja, recurso)) || [];
const usados = (fecha, franja, recurso) => ocupantes(fecha, franja, recurso).reduce((s, o) => s + o.ordenadores, 0);
const libres = (fecha, franja, recurso) => capacidad() - usados(fecha, franja, recurso);
const diasCarrito = () => [...new Set([...estado.carrito.values()].map((x) => x.fecha))].sort();
// Días con reservas de hoy en adelante: las ya hechas desde este equipo y las que estás eligiendo
const diasUsados = () => [...new Set([
  ...diasCarrito(),
  ...estado.misReservas.filter((r) => r.fecha >= estado.cfg.hoy).map((r) => r.fecha),
])].sort();
const datosListos = () => estado.nombre.length >= 3 && estado.ciclo.length >= 2;

// El aula de Emprendimiento requiere aprobación de jefatura de estudios
const requiereAprobacion = (recurso) => !!(estado.cfg.recursos.find((r) => r.id === recurso) || {}).aprobacion;

function actualizarAviso() {
  $('#avisoAula').classList.toggle('oculto', !requiereAprobacion(estado.aula));
}

function leerLS(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
function guardarLS(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }

function franjaPasada(fecha, f) {
  const { hoy, hora } = estado.cfg;
  return fecha < hoy || (fecha === hoy && f.fin <= hora);
}

function diaReservable(iso) {
  const { hoy, hora } = estado.cfg;
  const d = aFecha(iso).getDay();
  if (d === 0 || d === 6 || iso < hoy) return false;
  if (iso === hoy) return hora < reservables().at(-1).fin;
  return true;
}

function primerDiaReservable(desde) {
  const d = aFecha(desde);
  for (let i = 0; i < 31; i++) {
    const iso = aIso(d);
    if (diaReservable(iso)) return iso;
    d.setDate(d.getDate() + 1);
  }
  return desde;
}

// Motivo por el que no se puede elegir esta hora, o null si se puede
function motivoBloqueo(fecha, f, recurso, ord) {
  const ocup = ocupantes(fecha, f.id, recurso);
  if (ocup.some(esMio)) return 'Ya tienes esta hora reservada.';
  for (const r of estado.cfg.recursos) {
    if (r.id === recurso) continue;
    if (estado.carrito.has(clave(fecha, f.id, r.id))) return `A esa hora ya tienes ${r.nombre} elegida.`;
    if (ocupantes(fecha, f.id, r.id).some(esMio)) return `A esa hora ya tienes una reserva en ${r.nombre}.`;
  }
  if (!esCarro(recurso)) return ocup.length ? `Ocupada por ${ocup[0].nombre}.` : null;
  const q = libres(fecha, f.id, recurso);
  return ord > q ? `Solo quedan ${q} ordenadores libres a esa hora.` : null;
}

// Horas que tengo en esa aula y día (elegidas + ya reservadas desde este equipo)
function horasEnAulaDia(fecha, recurso) {
  return reservables().filter((f) => estado.carrito.has(clave(fecha, f.id, recurso)) || ocupantes(fecha, f.id, recurso).some(esMio)).length;
}

function alternarHora(fecha, f, recurso) {
  const k = clave(fecha, f.id, recurso);
  if (estado.carrito.has(k)) {
    estado.carrito.delete(k);
  } else {
    const ord = ordenadoresPara(recurso);
    const motivo = motivoBloqueo(fecha, f, recurso, ord);
    if (motivo) return toast(motivo, true);
    if (horasEnAulaDia(fecha, recurso) >= estado.cfg.maxHoras) {
      return toast(`Máximo ${estado.cfg.maxHoras} horas por aula y día en ${nombreAula(recurso)}.`, true);
    }
    const dias = diasUsados();
    if (!dias.includes(fecha) && dias.length >= estado.cfg.maxDias) {
      return toast(`Máximo ${estado.cfg.maxDias} días con reservas. Las reservas pasadas no cuentan.`, true);
    }
    estado.carrito.set(k, { fecha, franja: f.id, recurso, ordenadores: ord });
  }
  pintarTodo();
}

// Quita de la selección las horas que ya no estén libres
function sincronizarCarrito() {
  const quitadas = [];
  for (const [k, it] of [...estado.carrito]) {
    const ocup = ocupantes(it.fecha, it.franja, it.recurso);
    const bloqueada = franjaPasada(it.fecha, franjaPorId(estado.cfg, it.franja))
      || ocup.some(esMio)
      || (!esCarro(it.recurso) ? ocup.length > 0 : libres(it.fecha, it.franja, it.recurso) < it.ordenadores);
    if (bloqueada) { estado.carrito.delete(k); quitadas.push(it); }
  }
  if (quitadas.length) toast(`${quitadas.length} hora(s) ya no están disponibles y se han quitado de tu selección.`, true);
}

// ---------- datos ----------
async function cargarDatos() {
  const fechas = [...new Set([estado.dia, ...diasCarrito()])];
  try {
    const { reservas, hoy, hora } = await api('ocupacion', { params: { fechas: fechas.join(',') } });
    // Hora del servidor: así no se ofrecen horas que han pasado con la página abierta
    if (hoy && hora) { estado.cfg.hoy = hoy; estado.cfg.hora = hora; }
    estado.ocupacion = new Map();
    for (const r of reservas) {
      const k = clave(r.fecha, r.franja, r.recurso);
      if (!estado.ocupacion.has(k)) estado.ocupacion.set(k, []);
      estado.ocupacion.get(k).push(r);
    }
    sincronizarCarrito();
  } catch (e) {
    toast(e.message, true);
  }
  pintarTodo();
}

async function cargarMis() {
  try {
    ({ reservas: estado.misReservas } = await api('mis'));
  } catch (e) {
    estado.misReservas = [];
  }
  pintarMis();
  pintarCarrito(); // el contador de días depende de estas reservas
}

async function refrescarTodo() {
  await Promise.all([cargarDatos(), cargarMis(), cargarMes()]);
}

async function irADia(iso) {
  estado.dia = iso;
  $('#tituloDia').textContent = `${fmtLargo(iso)} · ${nombreAula(estado.aula)}`;
  $('#listaDia').replaceChildren(el('div', { class: 'cargando' }, 'Consultando…'));
  await cargarDatos();
}

// ---------- ocupación del mes (colores del calendario) ----------
const TEXTO_NIVEL = ['libre', 'poca ocupación', 'bastante ocupada', 'completa'];

// 0 libre · 1 poca (menos del 50 %) · 2 bastante (50 % o más) · 3 completa
function nivelDia(iso) {
  const d = estado.ocupMes.get(iso);
  if (!d) return 0;
  const horas = reservables().length;
  const ratio = esCarro(estado.aula) ? d.ordenadores / (horas * capacidad()) : d.horas / horas;
  if (ratio >= 1) return 3;
  if (ratio >= 0.5) return 2;
  return ratio > 0 ? 1 : 0;
}

let peticionMes = 0;
async function cargarMes() {
  const mes = estado.mes;
  const desde = aIso(mes);
  const hasta = aIso(new Date(mes.getFullYear(), mes.getMonth() + 1, 0));
  const n = ++peticionMes;
  try {
    const { dias } = await api('ocupacion_mes', { params: { recurso: estado.aula, desde, hasta } });
    if (n !== peticionMes) return; // respuesta antigua: ya se cambió de mes o de aula
    estado.ocupMes = new Map(dias.map((d) => [d.fecha, d]));
  } catch (e) {
    if (n !== peticionMes) return;
    estado.ocupMes = new Map();
  }
  pintarCalendario();
}

function cambiarMes(delta) {
  estado.mes.setMonth(estado.mes.getMonth() + delta);
  estado.ocupMes = new Map();
  pintarCalendario();
  cargarMes();
}

// ---------- elección de aula (botones) ----------
function pintarAulas() {
  $('#aulas').replaceChildren(...estado.cfg.recursos.map((r) => el('button', {
    type: 'button',
    role: 'radio',
    class: 'aula-btn',
    'aria-checked': r.id === estado.aula ? 'true' : 'false',
    onclick: () => elegirAula(r.id),
  }, el('span', {}, r.nombre), r.aprobacion ? el('small', {}, 'Requiere aprobación') : null)));
}

function elegirAula(id) {
  if (id === estado.aula) return;
  estado.aula = id;
  estado.ocupMes = new Map();
  pintarAulas();
  $('#campoOrd').classList.toggle('oculto', !esCarro(estado.aula));
  actualizarAviso();
  cargarMes();
  irADia(estado.dia);
}

// ---------- pintar ----------
function pintarTodo() {
  pintarCalendario();
  pintarDia();
  pintarCarrito();
}

function pintarCalendario() {
  const mes = estado.mes;
  const hoyMes = aFecha(estado.cfg.hoy); hoyMes.setDate(1);
  $('#tituloMes').textContent = mayus(mes.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }));
  $('#mesAnterior').disabled = mes <= hoyMes;

  const enCarrito = new Set(diasCarrito());
  const nodos = ['L', 'M', 'X', 'J', 'V'].map((d) => el('div', { class: 'cal-dsem' }, d));
  const huecos = (mes.getDay() + 6) % 7; // lunes = 0
  if (huecos < 5) for (let i = 0; i < huecos; i++) nodos.push(el('div', { class: 'cal-dia vacio' }));

  const d = new Date(mes);
  while (d.getMonth() === mes.getMonth()) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      const iso = aIso(d);
      const cls = ['cal-dia'];
      if (iso === estado.dia) cls.push('activo');
      if (enCarrito.has(iso)) cls.push('marcado');
      if (iso === estado.cfg.hoy) cls.push('hoy');
      const reservable = diaReservable(iso);
      const nivel = reservable ? nivelDia(iso) : 0;
      if (nivel) cls.push(`ocup-${nivel}`);
      const texto = `${fmtLargo(iso)}${reservable ? `, ${TEXTO_NIVEL[nivel]}` : ''}${enCarrito.has(iso) ? ', con horas elegidas' : ''}`;
      nodos.push(el('button', {
        type: 'button',
        class: cls.join(' '),
        disabled: !reservable,
        'aria-label': texto,
        title: texto,
        onclick: () => irADia(iso),
      }, d.getDate()));
    }
    d.setDate(d.getDate() + 1);
  }
  $('#cal').replaceChildren(...nodos);
}

function fila(clase, horaEl, contenido, alPulsar) {
  const attrs = { class: `fila ${clase}` };
  if (alPulsar) { attrs.type = 'button'; attrs.onclick = alPulsar; }
  return el(alPulsar ? 'button' : 'div', attrs, horaEl, el('span', { class: 'estado' }, contenido));
}

function filaHora(fecha, f, recurso) {
  const hora = el('span', { class: 'hora' }, `${f.inicio}–${f.fin}`);
  const ocup = ocupantes(fecha, f.id, recurso);
  const mia = ocup.find(esMio);
  const otros = ocup.filter((o) => o !== mia).map((o) => el('span', { class: 'linea' },
    `${o.nombre} · ${o.ciclo}${esCarro(recurso) ? ` · ${o.ordenadores} ord.` : ''}`));
  const alPulsar = () => alternarHora(fecha, f, recurso);
  const elegida = estado.carrito.get(clave(fecha, f.id, recurso));

  if (franjaPasada(fecha, f)) return fila('pasada', hora, 'Hora ya pasada');

  if (!esCarro(recurso)) {
    if (mia) return mia.estado === 'pendiente'
      ? fila('pendiente', hora, 'Tu reserva · pendiente de aprobación')
      : fila('mia', hora, 'Tu reserva · pulsa “Editar” en tus reservas para cambiarla');
    if (ocup.length) return ocup[0].estado === 'pendiente'
      ? fila('pendiente', hora, [el('b', {}, ocup[0].nombre), ` · ${ocup[0].ciclo} · pendiente de aprobación`])
      : fila('ocupada', hora, [el('b', {}, ocup[0].nombre), ` · ${ocup[0].ciclo}`]);
    if (elegida) return fila('sel', hora, '✓ Elegida · pulsa para quitar', alPulsar);
    const aviso = requiereAprobacion(recurso) ? ' · requiere aprobación' : '';
    return fila('libre', hora, `Libre · pulsa para elegir${aviso}`, alPulsar);
  }

  if (mia) return fila('mia', hora, [`Tu reserva · ${mia.ordenadores} ord.`, ...otros]);
  const q = libres(fecha, f.id, recurso);
  if (elegida) return fila('sel', hora, [`✓ ${elegida.ordenadores} ord. elegidos · pulsa para quitar`, ...otros], alPulsar);
  if (q < estado.ordenadores) return fila('llena', hora, [`Sin ordenadores suficientes (quedan ${q})`, ...otros]);
  return fila('libre', hora, [`Libres ${q} de ${capacidad()} · pulsa para elegir ${estado.ordenadores}`, ...otros], alPulsar);
}

function pintarDia() {
  const fecha = estado.dia;
  $('#tituloDia').textContent = `${fmtLargo(fecha)} · ${nombreAula(estado.aula)}`;
  if (!diaReservable(fecha)) {
    $('#listaDia').replaceChildren(el('p', { class: 'ayuda' }, 'Este día no admite reservas.'));
    return;
  }
  const nodos = [];
  let turno = null;
  for (const f of estado.cfg.franjas) {
    if (f.turno !== turno) { turno = f.turno; nodos.push(el('div', { class: 'turno' }, turno)); }
    if (f.recreo) {
      nodos.push(el('div', { class: 'fila recreo' }, el('span', { class: 'hora' }, `${f.inicio}–${f.fin}`), el('span', { class: 'estado' }, 'Recreo')));
    } else {
      nodos.push(filaHora(fecha, f, estado.aula));
    }
  }
  $('#listaDia').replaceChildren(...nodos);
}

function pintarCarrito() {
  const items = [...estado.carrito.values()].sort((a, b) =>
    a.fecha.localeCompare(b.fecha) || indiceFranja(a.franja) - indiceFranja(b.franja) || a.recurso.localeCompare(b.recurso));
  const cont = $('#carrito');
  if (!items.length) {
    cont.replaceChildren(el('p', { class: 'ayuda' }, 'Aún no has elegido horas. Pulsa un día del calendario y, después, una hora libre.'));
  } else {
    cont.replaceChildren(el('ul', { class: 'lista-carrito' }, items.map((it) => {
      const k = clave(it.fecha, it.franja, it.recurso);
      return el('li', {},
        el('div', { class: 'info' },
          el('b', {}, `${fmtCorto(it.fecha)} · ${horaDe(it.franja)}`),
          el('span', { class: 'ayuda' }, `${nombreAula(it.recurso)}${esCarro(it.recurso) ? ` · ${it.ordenadores} ord.` : ''}${requiereAprobacion(it.recurso) ? ' · pendiente de aprobación' : ''}`)),
        el('button', { type: 'button', class: 'quitar', 'aria-label': 'Quitar', title: 'Quitar', onclick: () => { estado.carrito.delete(k); pintarTodo(); } }, '×'));
    })));
  }
  const n = items.length;
  const dias = diasCarrito().length;
  const total = diasUsados().length;
  $('#resumenCarrito').textContent = n
    ? `${n} ${n === 1 ? 'hora elegida' : 'horas elegidas'} en ${dias} ${dias === 1 ? 'día' : 'días'} · ${total}/${estado.cfg.maxDias} días con reservas`
    : `${total}/${estado.cfg.maxDias} días con reservas`;
  $('#reservar').disabled = n === 0 || estado.enviando;
}

// ---------- mis reservas (este equipo) ----------
function pintarMis() {
  const lista = estado.misReservas;
  $('#numMis').textContent = lista.length;
  $('#misVacio').classList.toggle('oculto', lista.length > 0);
  $('#listaMis').replaceChildren(...lista.map(itemMis));
}

function itemMis(r) {
  if (estado.editando === r.id) return el('li', { class: 'item-mis editando' }, formularioEdicion(r));
  const info = el('div', { class: 'info' },
    el('b', {}, `${fmtCorto(r.fecha)} · ${horaDe(r.franja)}`),
    el('span', { class: 'ayuda' }, `${nombreAula(r.recurso)}${esCarro(r.recurso) ? ` · ${r.ordenadores} ord.` : ''} · ${r.nombre} (${r.ciclo})${r.estado === 'pendiente' ? ' · PENDIENTE de aprobación' : ''}`));
  // Una reserva cuya hora ya ha pasado no se puede cambiar ni quitar
  if (franjaPasada(r.fecha, franjaPorId(estado.cfg, r.franja))) {
    return el('li', { class: 'item-mis' }, info, el('span', { class: 'ayuda' }, 'Ya pasada'));
  }
  return el('li', { class: 'item-mis' }, info, el('div', { class: 'acciones-mis' },
    el('button', { type: 'button', class: 'btn btn-secundario btn-peq', onclick: () => { estado.editando = r.id; pintarMis(); } }, 'Editar'),
    el('button', { type: 'button', class: 'btn btn-peligro btn-peq', onclick: () => quitarReserva(r) }, 'Quitar')));
}

function formularioEdicion(r) {
  const cfg = estado.cfg;
  const fecha = el('input', { type: 'date', min: cfg.hoy, value: r.fecha });
  const franja = el('select', {}, reservables().map((f) => el('option', { value: f.id }, `${f.inicio}–${f.fin}`)));
  const aula = el('select', {}, cfg.recursos.map((x) => el('option', { value: x.id }, x.nombre)));
  const ord = el('input', { type: 'number', min: 1, max: cfg.carroOrdenadores, value: r.ordenadores });
  const ciclo = el('input', { type: 'text', maxlength: 40, value: r.ciclo });
  franja.value = r.franja;
  aula.value = r.recurso;
  const aviso = el('div', { class: 'aviso aviso-error oculto' });

  const guardar = async () => {
    aviso.classList.add('oculto');
    try {
      await api('editar_propia', { body: {
        id: r.id, fecha: fecha.value, franja: franja.value, recurso: aula.value,
        ordenadores: Number(ord.value) || 1, ciclo: ciclo.value.trim(),
      } });
      estado.editando = null;
      toast('Reserva actualizada.');
      await refrescarTodo();
    } catch (e) {
      aviso.textContent = e.message;
      aviso.classList.remove('oculto');
    }
  };
  const cancelar = () => { estado.editando = null; pintarMis(); };
  const campo = (etiqueta, control) => el('label', { class: 'campo-mini' }, el('span', {}, etiqueta), control);

  return el('div', { class: 'editor' },
    campo('Día', fecha), campo('Hora', franja), campo('Aula', aula),
    campo('Ordenadores (solo carro)', ord), campo('Ciclo', ciclo), aviso,
    el('div', { class: 'acciones-mis' },
      el('button', { type: 'button', class: 'btn btn-primario btn-peq', onclick: guardar }, 'Guardar'),
      el('button', { type: 'button', class: 'btn btn-secundario btn-peq', onclick: cancelar }, 'Cancelar')));
}

async function quitarReserva(r) {
  if (!confirm('¿Quitar esta reserva? No se puede deshacer.')) return;
  try {
    await api('borrar_propia', { body: { id: r.id } });
    toast('Reserva quitada.');
    await refrescarTodo();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- avisos ----------
function avisar(tipo, cabecera, lineas = []) {
  const caja = $('#aviso');
  caja.className = `aviso aviso-${tipo}`;
  caja.replaceChildren(el('div', {}, cabecera),
    ...(lineas.length ? [el('ul', { class: 'lista-aviso' }, lineas.map((l) => el('li', {}, l)))] : []));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- reservar ----------
async function reservar() {
  if (estado.enviando || !estado.carrito.size) return;
  if (!datosListos()) {
    toast('Escribe tu nombre y apellidos y tu ciclo.', true);
    (estado.nombre.length < 3 ? $('#nombre') : $('#ciclo')).focus();
    return;
  }
  estado.enviando = true;
  $('#reservar').disabled = true;
  $('#reservar').textContent = 'Guardando…';
  $('#aviso').className = 'aviso oculto';
  const items = [...estado.carrito.values()].map(({ fecha, franja, recurso, ordenadores }) => ({ fecha, franja, recurso, ordenadores }));
  try {
    const r = await api('reservar', { body: { nombre: estado.nombre, ciclo: estado.ciclo, items } });
    estado.carrito.clear();
    const mail = `mailto:${estado.cfg.contacto.email}`;
    const hayPendientes = r.reservas.some((x) => x.estado === 'pendiente');
    avisar('ok', [
      el('b', {}, `Reserva guardada a nombre de ${r.nombre}.`),
      ' Si tienes algún problema, contacta con el correo: ',
      el('a', { href: mail }, estado.cfg.contacto.email),
      ...(hayPendientes ? [el('br'), 'Las reservas de Emprendimiento quedan “Pendiente de aprobación” hasta que jefatura de estudios las apruebe.'] : []),
    ], r.reservas.map((x) => `${fmtCorto(x.fecha)} · ${nombreAula(x.recurso)} · ${horaDe(x.franja)}${esCarro(x.recurso) ? ` · ${x.ordenadores} ord.` : ''}${x.estado === 'pendiente' ? ' · pendiente de aprobación' : ''}`));
  } catch (e) {
    avisar('error', [e.message], (e.datos && e.datos.conflictos ? e.datos.conflictos : []).map((c) => c.motivo));
  } finally {
    estado.enviando = false;
    $('#reservar').textContent = 'Confirmar reserva';
    await refrescarTodo();
  }
}

// ---------- arranque ----------
function iniciarEventos() {
  $('#nombre').addEventListener('input', (e) => { estado.nombre = e.target.value.trim().replace(/\s+/g, ' '); });
  $('#nombre').addEventListener('change', () => { guardarLS(LS_NOMBRE, estado.nombre); pintarTodo(); });
  $('#ciclo').addEventListener('input', (e) => { estado.ciclo = e.target.value.trim().replace(/\s+/g, ' '); });
  $('#ciclo').addEventListener('change', () => { guardarLS(LS_CICLO, estado.ciclo); pintarTodo(); });

  $('#ordenadores').addEventListener('change', (e) => {
    let n = parseInt(e.target.value, 10);
    if (!(n >= 1)) n = 1;
    if (n > capacidad()) n = capacidad();
    e.target.value = n;
    estado.ordenadores = n;
    for (const it of estado.carrito.values()) if (esCarro(it.recurso)) it.ordenadores = n;
    sincronizarCarrito();
    pintarTodo();
  });

  $('#mesAnterior').addEventListener('click', () => cambiarMes(-1));
  $('#mesSiguiente').addEventListener('click', () => cambiarMes(1));
  $('#reservar').addEventListener('click', reservar);
}

(async function iniciar() {
  try {
    estado.cfg = await api('config');
  } catch (e) {
    $('#cargando').textContent = e.message;
    return;
  }
  const cfg = estado.cfg;
  document.querySelectorAll('.maxDias').forEach((n) => { n.textContent = cfg.maxDias; });
  document.querySelectorAll('.maxHoras').forEach((n) => { n.textContent = cfg.maxHoras; });
  document.querySelectorAll('.contactoNombre').forEach((n) => { n.textContent = cfg.contacto.nombre; });
  document.querySelectorAll('.contactoEmail').forEach((a) => {
    a.textContent = cfg.contacto.email;
    a.href = `mailto:${cfg.contacto.email}?subject=${encodeURIComponent('Reserva de salas y ordenadores')}`;
  });

  estado.nombre = leerLS(LS_NOMBRE);
  estado.ciclo = leerLS(LS_CICLO);
  $('#nombre').value = estado.nombre;
  $('#ciclo').value = estado.ciclo;

  pintarAulas();
  $('#campoOrd').classList.toggle('oculto', !esCarro(estado.aula));
  $('#ordenadores').max = cfg.carroOrdenadores;
  actualizarAviso();

  estado.dia = primerDiaReservable(cfg.hoy);
  // El calendario abre en el mes del primer día disponible (puede ser el mes siguiente)
  estado.mes = aFecha(estado.dia);
  estado.mes.setDate(1);

  iniciarEventos();
  $('#cargando').remove();
  $('#pantalla').classList.remove('oculto');
  await Promise.all([irADia(estado.dia), cargarMis(), cargarMes()]);
})();
