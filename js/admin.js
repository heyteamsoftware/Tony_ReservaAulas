// Zona de administración
'use strict';

const adm = { cfg: null, dia: null };

function mostrarVista(logueado) {
  const cargando = $('#cargando');
  if (cargando) cargando.remove();
  $('#vistaLogin').classList.toggle('oculto', logueado);
  $('#vistaPanel').classList.toggle('oculto', !logueado);
  $('#salir').classList.toggle('oculto', !logueado);
  if (logueado) cargarActiva();
  else { $('#password').value = ''; $('#password').focus(); }
}

function gestionarError(e) {
  if (e.codigo === 401) { toast('La sesión ha caducado. Vuelve a entrar.', true); mostrarVista(false); return; }
  toast(e.message, true);
}

// ---------- acceso ----------
$('#formLogin').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const caja = $('#loginError');
  const boton = $('#formLogin button[type=submit]');
  caja.classList.add('oculto');
  boton.disabled = true;
  try {
    await api('login', { body: { password: $('#password').value } });
    mostrarVista(true);
  } catch (e) {
    caja.textContent = e.message;
    caja.classList.remove('oculto');
  } finally {
    boton.disabled = false;
  }
});

$('#salir').addEventListener('click', async () => {
  try { await api('logout', { body: {} }); } catch (e) { /* da igual */ }
  mostrarVista(false);
});

// ---------- pestañas ----------
function cargarActiva() {
  return $('#tabDia').classList.contains('oculto') ? cargarLista() : cargarDia();
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('activa', x === t));
  $('#tabDia').classList.toggle('oculto', t.dataset.tab !== 'dia');
  $('#tabLista').classList.toggle('oculto', t.dataset.tab !== 'lista');
  cargarActiva();
}));

// ---------- filas de reservas ----------
function celdaEstado(r) {
  if (r.estado !== 'pendiente') return el('td', {}, 'Aprobada');
  return el('td', {},
    el('span', { class: 'badge-pend' }, 'Pendiente'), ' ',
    el('button', { type: 'button', class: 'btn btn-primario btn-peq', onclick: () => aprobar([r.id]) }, 'Aprobar'));
}

function filaReserva(r, conCasilla) {
  const f = franjaPorId(adm.cfg, r.franja);
  return el('tr', {},
    conCasilla ? el('td', {}, el('input', { type: 'checkbox', class: 'selFila', value: r.id, 'aria-label': 'Seleccionar', onchange: actualizarBotones })) : null,
    el('td', { class: 'num' }, fmtNum(r.fecha)),
    el('td', { class: 'num' }, `${f.inicio}–${f.fin}`),
    el('td', {}, nombreRecurso(adm.cfg, r.recurso)),
    el('td', {}, r.nombre),
    el('td', {}, r.ciclo || '—'),
    el('td', { class: 'num' }, r.recurso === 'CARRO' ? String(r.ordenadores) : '1'),
    celdaEstado(r),
    el('td', {}, el('button', { type: 'button', class: 'btn btn-secundario btn-peq', onclick: () => abrirModal(r) }, 'Editar')));
}

function pintarFilas(cuerpo, reservas, conCasilla) {
  if (!reservas.length) {
    cuerpo.replaceChildren(el('tr', {}, el('td', { colspan: conCasilla ? 9 : 8, class: 'cargando' }, 'No hay reservas.')));
    return;
  }
  cuerpo.replaceChildren(...reservas.map((r) => filaReserva(r, conCasilla)));
}

async function aprobar(ids) {
  try {
    const r = await api('admin_aprobar', { body: { ids } });
    toast(`${r.aprobadas} ${r.aprobadas === 1 ? 'aprobada' : 'aprobadas'}.`);
    cargarActiva();
  } catch (e) { gestionarError(e); }
}

// ---------- día ----------
function moverDia(delta) {
  const d = aFecha(adm.dia);
  do { d.setDate(d.getDate() + delta); } while (d.getDay() === 0 || d.getDay() === 6);
  adm.dia = aIso(d);
  cargarDia();
}
$('#diaAnterior').addEventListener('click', () => moverDia(-1));
$('#diaSiguiente').addEventListener('click', () => moverDia(1));
$('#diaHoy').addEventListener('click', () => { adm.dia = adm.cfg.hoy; cargarDia(); });
$('#diaFecha').addEventListener('change', (e) => { if (e.target.value) { adm.dia = e.target.value; cargarDia(); } });
$('#nuevaDia').addEventListener('click', () => abrirModal({ fecha: adm.dia }));

async function cargarDia() {
  $('#diaFecha').value = adm.dia;
  $('#diaTitulo').textContent = fmtLargo(adm.dia);
  try {
    const { reservas } = await api('admin_listar', { params: { desde: adm.dia, hasta: adm.dia } });
    pintarFilas($('#filasDia'), reservas, false);
  } catch (e) { gestionarError(e); }
}

// ---------- listado ----------
function filtros() {
  const p = {};
  if ($('#fDesde').value) p.desde = $('#fDesde').value;
  if ($('#fHasta').value) p.hasta = $('#fHasta').value;
  if ($('#fNombre').value.trim()) p.nombre = $('#fNombre').value.trim();
  if ($('#fRecurso').value) p.recurso = $('#fRecurso').value;
  if ($('#fEstado').value) p.estado = $('#fEstado').value;
  return p;
}

async function cargarLista() {
  const p = filtros();
  $('#exportar').href = `${API}?${new URLSearchParams({ accion: 'admin_csv', ...p })}`;
  try {
    const { reservas } = await api('admin_listar', { params: p });
    pintarFilas($('#filas'), reservas, true);
    $('#selTodas').checked = false;
    $('#totalFilas').textContent = `${reservas.length} ${reservas.length === 1 ? 'reserva' : 'reservas'}`;
    actualizarBotones();
  } catch (e) { gestionarError(e); }
}

function idsMarcados() { return [...document.querySelectorAll('.selFila:checked')].map((c) => Number(c.value)); }
function actualizarBotones() {
  const n = idsMarcados().length;
  $('#borrarSel').disabled = n === 0;
  $('#aprobarSel').disabled = n === 0;
}

$('#selTodas').addEventListener('change', (e) => {
  document.querySelectorAll('.selFila').forEach((c) => { c.checked = e.target.checked; });
  actualizarBotones();
});
$('#buscar').addEventListener('click', cargarLista);
$('#formFiltros').addEventListener('submit', (e) => { e.preventDefault(); cargarLista(); });
$('#nueva').addEventListener('click', () => abrirModal({ fecha: adm.cfg.hoy }));
$('#aprobarSel').addEventListener('click', () => aprobar(idsMarcados()));

$('#borrarSel').addEventListener('click', async () => {
  const ids = idsMarcados();
  if (!ids.length || !confirm(`¿Borrar ${ids.length} ${ids.length === 1 ? 'reserva' : 'reservas'}? No se puede deshacer.`)) return;
  try {
    const r = await api('admin_borrar', { body: { ids } });
    toast(`${r.borradas} borrada(s).`);
    cargarActiva();
  } catch (e) { gestionarError(e); }
});

// ---------- modal ----------
function actualizarOrd() {
  $('#mOrdWrap').classList.toggle('oculto', $('#mAula').value !== 'CARRO');
}

function reservablesAdm() { return adm.cfg.franjas.filter((f) => !f.recreo); }

function abrirModal(r) {
  $('#modalTitulo').textContent = r.id ? 'Editar reserva' : 'Nueva reserva';
  $('#mId').value = r.id || '';
  $('#mNombre').value = r.nombre || '';
  $('#mCiclo').value = r.ciclo || '';
  $('#mFecha').value = r.fecha || adm.dia || adm.cfg.hoy;
  $('#mFranja').value = r.franja || reservablesAdm()[0].id;
  $('#mAula').value = r.recurso || 'INF1';
  $('#mOrd').value = r.ordenadores || 1;
  $('#mEstado').value = r.estado || 'aprobada';
  actualizarOrd();
  $('#mBorrar').classList.toggle('oculto', !r.id);
  $('#modalError').classList.add('oculto');
  $('#modal').classList.remove('oculto');
  $('#mNombre').focus();
}

function cerrarModal() { $('#modal').classList.add('oculto'); }

$('#mAula').addEventListener('change', actualizarOrd);
$('#mCancelar').addEventListener('click', cerrarModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') cerrarModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarModal(); });

$('#formModal').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = {
    id: $('#mId').value || null,
    nombre: $('#mNombre').value,
    ciclo: $('#mCiclo').value,
    fecha: $('#mFecha').value,
    franja: $('#mFranja').value,
    recurso: $('#mAula').value,
    ordenadores: Number($('#mOrd').value) || 1,
    estado: $('#mEstado').value,
  };
  try {
    await api('admin_guardar', { body: datos });
    cerrarModal();
    toast('Reserva guardada.');
    cargarActiva();
  } catch (err) {
    if (err.codigo === 401) { cerrarModal(); gestionarError(err); return; }
    $('#modalError').textContent = err.message;
    $('#modalError').classList.remove('oculto');
  }
});

$('#mBorrar').addEventListener('click', async () => {
  if (!confirm('¿Borrar esta reserva? No se puede deshacer.')) return;
  try {
    await api('admin_borrar', { body: { ids: [Number($('#mId').value)] } });
    cerrarModal();
    toast('Reserva borrada.');
    cargarActiva();
  } catch (err) { cerrarModal(); gestionarError(err); }
});

// ---------- arranque ----------
(async function iniciar() {
  try {
    adm.cfg = await api('config');
  } catch (e) { $('#cargando').textContent = e.message; return; }
  const cfg = adm.cfg;

  adm.dia = cfg.hoy;
  const d = aFecha(cfg.hoy);
  if (d.getDay() === 6) adm.dia = aIso(new Date(d.setDate(d.getDate() + 2)));
  else if (d.getDay() === 0) adm.dia = aIso(new Date(d.setDate(d.getDate() + 1)));
  $('#fDesde').value = cfg.hoy;

  $('#mFranja').replaceChildren(...reservablesAdm().map((f) => el('option', { value: f.id }, `${f.turno} · ${f.inicio}–${f.fin}`)));
  $('#mAula').replaceChildren(...cfg.recursos.map((r) => el('option', { value: r.id }, r.nombre)));
  $('#fRecurso').append(...cfg.recursos.map((r) => el('option', { value: r.id }, r.nombre)));
  $('#mOrd').max = cfg.carroOrdenadores;

  try {
    const { admin } = await api('sesion');
    mostrarVista(admin);
  } catch (e) { mostrarVista(false); }
})();
