<?php
// API del sistema de reservas de aulas — CIFP Tony Gallardo
declare(strict_types=1);
require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// ---------- utilidades ----------

function responder(array $datos, int $codigo = 200): never
{
    http_response_code($codigo);
    echo json_encode($datos, JSON_UNESCAPED_UNICODE);
    exit;
}

function fallo(string $mensaje, int $codigo = 400, array $extra = []): never
{
    responder(['ok' => false, 'error' => $mensaje] + $extra, $codigo);
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $pdo = new PDO('sqlite:' . DB_PATH, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA busy_timeout = 5000');
    $pdo->exec('PRAGMA journal_mode = WAL');
    migrar($pdo);
    return $pdo;
}

// Esquema versión 2: nombre + ciclo + nº de ordenadores (el carro admite varias reservas a la vez)
function migrar(PDO $pdo): void
{
    $version = (int)$pdo->query('PRAGMA user_version')->fetchColumn();
    if ($version < 2) migrarV2($pdo);
    if ($version < 3) migrarV3($pdo);
}

// Versión 3: estado de la reserva ('aprobada' o 'pendiente')
function migrarV3(PDO $pdo): void
{
    $pdo->exec('BEGIN IMMEDIATE');
    try {
        // Otra petición puede haber migrado mientras esperábamos el bloqueo
        if ((int)$pdo->query('PRAGMA user_version')->fetchColumn() >= 3) { $pdo->exec('COMMIT'); return; }
        $pdo->exec("ALTER TABLE reservas ADD COLUMN estado TEXT NOT NULL DEFAULT 'aprobada'");
        $pdo->exec('PRAGMA user_version = 3');
        $pdo->exec('COMMIT');
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->exec('ROLLBACK');
        throw $e;
    }
}

function migrarV2(PDO $pdo): void
{
    $pdo->exec('BEGIN IMMEDIATE');
    try {
        if ((int)$pdo->query('PRAGMA user_version')->fetchColumn() >= 2) { $pdo->exec('COMMIT'); return; }
        $existia =$pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reservas'")->fetchColumn();
        if ($existia) $pdo->exec('ALTER TABLE reservas RENAME TO reservas_v1');

        $pdo->exec("CREATE TABLE reservas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT NOT NULL,
            franja TEXT NOT NULL,
            recurso TEXT NOT NULL,
            nombre TEXT NOT NULL,
            nombre_clave TEXT NOT NULL,
            ciclo TEXT NOT NULL DEFAULT '',
            ordenadores INTEGER NOT NULL DEFAULT 1,
            propietario TEXT,
            lote TEXT,
            creado TEXT NOT NULL,
            modificado TEXT
        )");

        if ($existia) {
            $pdo->exec("INSERT INTO reservas (id, fecha, franja, recurso, nombre, nombre_clave, ciclo, ordenadores, lote, creado, modificado)
                SELECT id, fecha, franja, recurso, profesor, profesor_clave, '', 1, lote, creado, modificado FROM reservas_v1");
            $pdo->exec('DROP TABLE reservas_v1');
        }

        // Un aula de informática solo admite una reserva por hora. El carro se controla por nº de ordenadores.
        $pdo->exec("CREATE UNIQUE INDEX ux_aula_hora ON reservas (fecha, franja, recurso) WHERE recurso <> 'CARRO'");
        $pdo->exec('CREATE INDEX idx_reservas_nombre ON reservas (nombre_clave, fecha)');
        $pdo->exec('CREATE INDEX idx_reservas_equipo ON reservas (propietario)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS intentos_login (ip TEXT NOT NULL, momento INTEGER NOT NULL)');
        $pdo->exec('PRAGMA user_version = 2');
        $pdo->exec('COMMIT');
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->exec('ROLLBACK');
        throw $e;
    }
}

function entrada(): array
{
    $datos = json_decode(file_get_contents('php://input') ?: '[]', true);
    return is_array($datos) ? $datos : [];
}

function ahora(): string
{
    return date('Y-m-d H:i:s');
}

// Equipo: cookie aleatoria del navegador. En la base de datos solo se guarda su hash.
const COOKIE_EQUIPO = 'ra_equipo';

function rutaApp(): string
{
    return rtrim(dirname($_SERVER['SCRIPT_NAME'], 2), '/') . '/';
}

// Hash del equipo actual. Si no tiene cookie y $crear es true, se la crea.
function hashEquipo(bool $crear = false): ?string
{
    $token = (string)($_COOKIE[COOKIE_EQUIPO] ?? '');
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
        if (!$crear) return null;
        $token = bin2hex(random_bytes(32));
        setcookie(COOKIE_EQUIPO, $token, [
            'expires' => time() + 60 * 60 * 24 * 365 * 3,
            'path' => rutaApp(),
            'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
    }
    return hash('sha256', $token);
}

// Días distintos con reservas de hoy en adelante de una persona (las pasadas no cuentan)
function diasFuturosPersona(PDO $pdo, string $clave, ?int $excluir = null): array
{
    $st = $pdo->prepare('SELECT DISTINCT fecha FROM reservas WHERE nombre_clave = ? AND fecha >= ? AND id IS NOT ?');
    $st->execute([$clave, date('Y-m-d'), $excluir]);
    return $st->fetchAll(PDO::FETCH_COLUMN);
}

// Las reservas de aulas con aprobación nacen 'pendiente'
function estadoPara(string $recurso): string
{
    foreach (RECURSOS as $r) if ($r['id'] === $recurso) return empty($r['aprobacion']) ? 'aprobada' : 'pendiente';
    return 'aprobada';
}

// Convierte el campo 'propia' de SQL (0/1) en booleano
function marcarPropias(array $filas): array
{
    foreach ($filas as &$f) $f['propia'] = (bool)$f['propia'];
    unset($f);
    return $filas;
}

// Evita que Excel interprete como fórmula un texto escrito por el usuario (=, +, -, @)
function celdaCsv(string $v): string
{
    return preg_match('/^[=+\-@\t\r]/', $v) ? "'" . $v : $v;
}

function fmtFecha(string $f): string
{
    return date('d/m/Y', strtotime($f));
}

function limpiarTexto($valor, int $min, int $max, string $etiqueta): string
{
    $t = preg_replace('/[\x00-\x1F\x7F]/u', '', (string)$valor) ?? '';
    $t = trim(preg_replace('/\s+/u', ' ', $t) ?? '');
    $largo = mb_strlen($t);
    if ($largo < $min) fallo("Escribe $etiqueta.");
    if ($largo > $max) fallo(ucfirst($etiqueta) . ": máximo $max caracteres.");
    return $t;
}

// Clave para reconocer a la misma persona aunque cambien mayúsculas, tildes o espacios
function claveNombre(string $nombre): string
{
    $n = trim(preg_replace('/\s+/u', ' ', $nombre) ?? '');
    $n = mb_strtolower($n, 'UTF-8');
    return strtr($n, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'à' => 'a', 'è' => 'e', 'ì' => 'i', 'ò' => 'o', 'ù' => 'u']);
}

function fechaValida($f): string
{
    $f = (string)$f;
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $f, $m) || !checkdate((int)$m[2], (int)$m[3], (int)$m[1])) {
        fallo('Fecha no válida.');
    }
    return $f;
}

function esLaborable(string $fecha): bool
{
    return (int)date('N', strtotime($fecha)) <= 5;
}

function franjaPorId(string $id): array
{
    foreach (FRANJAS as $f) if ($f['id'] === $id) return $f;
    return ['id' => $id, 'turno' => '', 'inicio' => '?', 'fin' => '?'];
}

function horaFranja(string $id): string
{
    $f = franjaPorId($id);
    return "{$f['inicio']}–{$f['fin']}";
}

function franjaValida($id): array
{
    foreach (FRANJAS as $f) {
        if ($f['id'] === $id) {
            if (!empty($f['recreo'])) fallo('El recreo no se puede reservar.');
            return $f;
        }
    }
    fallo('Franja horaria no válida.');
}

function recursoValido($id): array
{
    foreach (RECURSOS as $r) if ($r['id'] === $id) return $r;
    fallo('Aula no válida.');
}

function nombreRecurso(string $id): string
{
    foreach (RECURSOS as $r) if ($r['id'] === $id) return $r['nombre'];
    return $id;
}

function franjaPasada(string $fecha, array $franja): bool
{
    $hoy = date('Y-m-d');
    if ($fecha < $hoy) return true;
    return $fecha === $hoy && $franja['fin'] <= date('H:i');
}

function ordenFranja(string $id): int
{
    foreach (FRANJAS as $i => $f) if ($f['id'] === $id) return $i;
    return 99;
}

function ordenar(array $filas): array
{
    usort($filas, fn($a, $b) => [$a['fecha'], ordenFranja($a['franja']), $a['recurso']] <=> [$b['fecha'], ordenFranja($b['franja']), $b['recurso']]);
    return $filas;
}

// Nº de ordenadores de una reserva: 1 en las aulas, 1..CARRO_ORDENADORES en el carro
function ordenadoresValidos(string $recurso, $valor): int
{
    if ($recurso !== CARRO_ID) return 1;
    $n = filter_var($valor, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => CARRO_ORDENADORES]]);
    if ($n === false) fallo('Indica entre 1 y ' . CARRO_ORDENADORES . ' ordenadores.');
    return (int)$n;
}

// Motivo por el que no cabe la reserva en esa hora, o null si cabe
function hayHueco(PDO $pdo, string $fecha, string $franja, string $recurso, int $ord, ?int $excluir = null): ?string
{
    $st = $pdo->prepare('SELECT COUNT(*) AS n, COALESCE(SUM(ordenadores), 0) AS usados
        FROM reservas WHERE fecha = ? AND franja = ? AND recurso = ? AND id IS NOT ?');
    $st->execute([$fecha, $franja, $recurso, $excluir]);
    $fila = $st->fetch();
    if ($recurso === CARRO_ID) {
        $libres = CARRO_ORDENADORES - (int)$fila['usados'];
        return $ord <= $libres ? null : "solo quedan $libres ordenadores libres a esa hora.";
    }
    return (int)$fila['n'] > 0 ? 'esa aula ya está reservada a esa hora.' : null;
}

function iniciarSesion(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $ruta = rtrim(dirname($_SERVER['SCRIPT_NAME'], 2), '/') . '/';
    session_name('reservaulas');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => $ruta,
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
}

function esAdmin(): bool
{
    iniciarSesion();
    return !empty($_SESSION['admin']);
}

function exigirAdmin(): void
{
    if (!esAdmin()) fallo('Sesión de administración caducada. Vuelve a entrar.', 401);
}

function ipCliente(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? 'desconocida';
}

// ---------- enrutado ----------

$accion = $_GET['accion'] ?? '';
$metodo = $_SERVER['REQUEST_METHOD'];

// Las peticiones que modifican datos deben venir de la propia app
if ($metodo === 'POST' && ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'reservas') {
    fallo('Petición no permitida.', 403);
}

try {
    switch ("$metodo $accion") {

        case 'GET config':
            responder([
                'ok' => true,
                'recursos' => RECURSOS,
                'franjas' => FRANJAS,
                'maxDias' => MAX_DIAS,
                'maxHoras' => MAX_HORAS_POR_RECURSO,
                'carroOrdenadores' => CARRO_ORDENADORES,
                'contacto' => ['email' => CONTACTO_EMAIL, 'nombre' => CONTACTO_NOMBRE],
                'hoy' => date('Y-m-d'),
                'hora' => date('H:i'),
            ]);

        case 'GET ocupacion': {
            $fechas = array_values(array_unique(array_filter(explode(',', (string)($_GET['fechas'] ?? '')))));
            if (!$fechas || count($fechas) > 31) fallo('Indica entre 1 y 31 fechas.');
            $fechas = array_map('fechaValida', $fechas);
            $marcas = implode(',', array_fill(0, count($fechas), '?'));
            $st = db()->prepare("SELECT id, fecha, franja, recurso, nombre, ciclo, ordenadores, estado,
                COALESCE(propietario = ?, 0) AS propia FROM reservas WHERE fecha IN ($marcas)");
            $st->execute(array_merge([hashEquipo() ?? ''], $fechas));
            // Se devuelve la hora del servidor para que la pantalla no ofrezca horas que ya han pasado
            responder(['ok' => true, 'hoy' => date('Y-m-d'), 'hora' => date('H:i'), 'reservas' => marcarPropias(ordenar($st->fetchAll()))]);
        }

        // Ocupación por día de un aula en un rango (para colorear el calendario)
        case 'GET ocupacion_mes': {
            $recurso = recursoValido($_GET['recurso'] ?? '')['id'];
            $desde = fechaValida($_GET['desde'] ?? '');
            $hasta = fechaValida($_GET['hasta'] ?? '');
            if ($hasta < $desde || strtotime($hasta) - strtotime($desde) > 62 * 86400) fallo('Rango de fechas no válido.');
            $st = db()->prepare('SELECT fecha, COUNT(*) AS horas, COALESCE(SUM(ordenadores), 0) AS ordenadores
                FROM reservas WHERE recurso = ? AND fecha BETWEEN ? AND ? GROUP BY fecha');
            $st->execute([$recurso, $desde, $hasta]);
            $dias = array_map(fn($d) => [
                'fecha' => $d['fecha'],
                'horas' => (int)$d['horas'],             // aulas: horas ocupadas
                'ordenadores' => (int)$d['ordenadores'], // carro: ordenadores reservados en todo el día
            ], $st->fetchAll());
            responder(['ok' => true, 'dias' => $dias]);
        }

        case 'GET mis': {
            // Solo las reservas hechas desde este equipo
            $equipo = hashEquipo();
            if (!$equipo) responder(['ok' => true, 'reservas' => []]);
            $st = db()->prepare('SELECT id, fecha, franja, recurso, nombre, ciclo, ordenadores, estado FROM reservas WHERE propietario = ? AND fecha >= ?');
            $st->execute([$equipo, date('Y-m-d')]);
            responder(['ok' => true, 'reservas' => ordenar($st->fetchAll())]);
        }

        case 'POST reservar': {
            $in = entrada();
            $nombre = limpiarTexto($in['nombre'] ?? '', 3, 60, 'tu nombre y apellidos');
            $ciclo = limpiarTexto($in['ciclo'] ?? '', 2, 40, 'tu ciclo');
            $clave = claveNombre($nombre);
            $items = $in['items'] ?? null;
            if (!is_array($items) || !$items) fallo('No has elegido ninguna hora.');
            if (count($items) > 300) fallo('Demasiadas horas seleccionadas.');

            $limpios = [];
            foreach ($items as $it) {
                if (!is_array($it)) fallo('Datos no válidos.');
                $fecha = fechaValida($it['fecha'] ?? '');
                $franja = franjaValida($it['franja'] ?? '');
                $recurso = recursoValido($it['recurso'] ?? '')['id'];
                if (!esLaborable($fecha)) fallo('Solo se puede reservar de lunes a viernes.');
                if (franjaPasada($fecha, $franja)) {
                    fallo('La hora ' . horaFranja($franja['id']) . ' del ' . fmtFecha($fecha) . ' ya ha pasado.');
                }
                $ord = ordenadoresValidos($recurso, $it['ordenadores'] ?? 1);
                $limpios["$fecha|{$franja['id']}|$recurso"] = ['fecha' => $fecha, 'franja' => $franja['id'], 'recurso' => $recurso, 'ordenadores' => $ord];
            }
            $limpios = array_values($limpios);

            $dias = array_unique(array_column($limpios, 'fecha'));
            if (count($dias) > MAX_DIAS) fallo('Puedes reservar como máximo ' . MAX_DIAS . ' días.');

            $etiqueta = fn(array $it): string => fmtFecha($it['fecha']) . ' ' . horaFranja($it['franja']) . ' · ' . nombreRecurso($it['recurso']);

            $pdo = db();
            $pdo->exec('BEGIN IMMEDIATE');
            try {
                $propias = $pdo->prepare('SELECT recurso FROM reservas WHERE nombre_clave = ? AND fecha = ? AND franja = ?');
                $contarAula = $pdo->prepare('SELECT COUNT(*) FROM reservas WHERE nombre_clave = ? AND fecha = ? AND recurso = ?');
                $conflictos = [];
                $porAula = [];
                $vistas = [];

                foreach ($limpios as $it) {
                    // Una persona no puede estar en dos sitios a la misma hora
                    $hueco = "{$it['fecha']}|{$it['franja']}";
                    if (isset($vistas[$hueco])) {
                        $conflictos[] = ['motivo' => $etiqueta($it) . ': eliges dos aulas a la misma hora.'];
                        continue;
                    }
                    $vistas[$hueco] = true;

                    $propias->execute([$clave, $it['fecha'], $it['franja']]);
                    if ($otra = $propias->fetchColumn()) {
                        $conflictos[] = ['motivo' => $etiqueta($it) . ': ya tienes una reserva a esa hora en ' . nombreRecurso($otra) . '.'];
                        continue;
                    }

                    if ($m = hayHueco($pdo, $it['fecha'], $it['franja'], $it['recurso'], $it['ordenadores'])) {
                        $conflictos[] = ['motivo' => $etiqueta($it) . ': ' . $m];
                        continue;
                    }

                    $k = "{$it['fecha']}|{$it['recurso']}";
                    $porAula[$k] = ($porAula[$k] ?? 0) + 1;
                }

                // Máximo de días con reservas futuras (las pasadas no cuentan)
                $previos = diasFuturosPersona($pdo, $clave);
                $nuevos = array_diff(array_unique(array_column($limpios, 'fecha')), $previos);
                if (count($previos) + count($nuevos) > MAX_DIAS) {
                    $conflictos[] = ['motivo' => 'Máximo ' . MAX_DIAS . ' días con reservas. Ya tienes ' . count($previos) . ' y quieres añadir ' . count($nuevos) . '. Las reservas pasadas no cuentan.'];
                }

                // Límite de horas por aula y día (contando las que ya tenía)
                foreach ($porAula as $k => $n) {
                    [$fecha, $recurso] = explode('|', $k);
                    $contarAula->execute([$clave, $fecha, $recurso]);
                    $ya = (int)$contarAula->fetchColumn();
                    if ($ya + $n > MAX_HORAS_POR_RECURSO) {
                        $conflictos[] = ['motivo' => 'Máximo ' . MAX_HORAS_POR_RECURSO . ' horas por aula y día: en ' . nombreRecurso($recurso) . ' el ' . fmtFecha($fecha) . ' ya tienes ' . $ya . ' y quieres añadir ' . $n . '.'];
                    }
                }

                if ($conflictos) {
                    $pdo->exec('ROLLBACK');
                    fallo('No se ha guardado nada. Revisa estos puntos:', 409, ['conflictos' => $conflictos]);
                }

                $lote = bin2hex(random_bytes(6));
                $equipo = hashEquipo(true);
                $ins = $pdo->prepare('INSERT INTO reservas (fecha, franja, recurso, nombre, nombre_clave, ciclo, ordenadores, propietario, lote, creado, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                foreach ($limpios as $it) {
                    $ins->execute([$it['fecha'], $it['franja'], $it['recurso'], $nombre, $clave, $ciclo, $it['ordenadores'], $equipo, $lote, ahora(), estadoPara($it['recurso'])]);
                }
                $pdo->exec('COMMIT');
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->exec('ROLLBACK');
                throw $e;
            }
            $resumen = array_map(fn($it) => $it + ['estado' => estadoPara($it['recurso'])], ordenar($limpios));
            responder(['ok' => true, 'nombre' => $nombre, 'reservas' => $resumen]);
        }

        // ---------- reservas propias (solo desde el equipo que las hizo) ----------

        case 'POST editar_propia': {
            $equipo = hashEquipo() ?? '';
            $in = entrada();
            $id = (int)($in['id'] ?? 0);
            $pdo = db();
            $st = $pdo->prepare('SELECT * FROM reservas WHERE id = ? AND propietario = ?');
            $st->execute([$id, $equipo]);
            $actual = $st->fetch();
            if (!$actual) fallo('Esa reserva no existe o no es de este equipo.', 403);
            if (franjaPasada($actual['fecha'], franjaPorId($actual['franja']))) fallo('Esa reserva ya ha pasado y no se puede cambiar.', 409);

            $fecha = fechaValida($in['fecha'] ?? '');
            $franja = franjaValida($in['franja'] ?? '');
            $recurso = recursoValido($in['recurso'] ?? '')['id'];
            if (!esLaborable($fecha)) fallo('Solo se puede reservar de lunes a viernes.');
            if (franjaPasada($fecha, $franja)) fallo('Esa hora ya ha pasado.');
            $ord = ordenadoresValidos($recurso, $in['ordenadores'] ?? 1);
            $ciclo = limpiarTexto($in['ciclo'] ?? $actual['ciclo'], 2, 40, 'tu ciclo');
            $clave = $actual['nombre_clave'];

            $pdo->exec('BEGIN IMMEDIATE');
            try {
                $motivo = null;
                $propias = $pdo->prepare('SELECT recurso FROM reservas WHERE nombre_clave = ? AND fecha = ? AND franja = ? AND id IS NOT ?');
                $propias->execute([$clave, $fecha, $franja['id'], $id]);
                if ($otra = $propias->fetchColumn()) {
                    $motivo = 'ya tienes una reserva a esa hora en ' . nombreRecurso($otra) . '.';
                } elseif ($m = hayHueco($pdo, $fecha, $franja['id'], $recurso, $ord, $id)) {
                    $motivo = $m;
                } else {
                    $previos = diasFuturosPersona($pdo, $clave, $id);
                    if (!in_array($fecha, $previos, true) && count($previos) + 1 > MAX_DIAS) {
                        $motivo = 'máximo ' . MAX_DIAS . ' días con reservas (las pasadas no cuentan).';
                    }
                    $cuenta = $pdo->prepare('SELECT COUNT(*) FROM reservas WHERE nombre_clave = ? AND fecha = ? AND recurso = ? AND id IS NOT ?');
                    $cuenta->execute([$clave, $fecha, $recurso, $id]);
                    if (!$motivo && (int)$cuenta->fetchColumn() + 1 > MAX_HORAS_POR_RECURSO) {
                        $motivo = 'máximo ' . MAX_HORAS_POR_RECURSO . ' horas por aula y día.';
                    }
                }
                if ($motivo) {
                    $pdo->exec('ROLLBACK');
                    fallo('No se ha guardado: ' . $motivo, 409);
                }
                // Cualquier cambio de una reserva de aula con aprobación vuelve a pendiente
                $pdo->prepare('UPDATE reservas SET fecha = ?, franja = ?, recurso = ?, ciclo = ?, ordenadores = ?, modificado = ?, estado = ? WHERE id = ?')
                    ->execute([$fecha, $franja['id'], $recurso, $ciclo, $ord, ahora(), estadoPara($recurso), $id]);
                $pdo->exec('COMMIT');
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->exec('ROLLBACK');
                throw $e;
            }
            responder(['ok' => true]);
        }

        case 'POST borrar_propia': {
            $id = (int)(entrada()['id'] ?? 0);
            $equipo = hashEquipo() ?? '';
            $st = db()->prepare('SELECT fecha, franja FROM reservas WHERE id = ? AND propietario = ?');
            $st->execute([$id, $equipo]);
            $actual = $st->fetch();
            if (!$actual) fallo('Esa reserva no existe o no es de este equipo.', 403);
            // Una reserva ya pasada queda como registro de uso: no se puede quitar
            if (franjaPasada($actual['fecha'], franjaPorId($actual['franja']))) fallo('Esa reserva ya ha pasado y no se puede quitar.', 409);
            db()->prepare('DELETE FROM reservas WHERE id = ? AND propietario = ?')->execute([$id, $equipo]);
            responder(['ok' => true]);
        }

        // ---------- administración ----------

        case 'POST admin_aprobar': {
            exigirAdmin();
            $ids = entrada()['ids'] ?? [];
            if (!is_array($ids) || !$ids) fallo('No hay reservas seleccionadas.');
            $ids = array_map('intval', $ids);
            $marcas = implode(',', array_fill(0, count($ids), '?'));
            $st = db()->prepare("UPDATE reservas SET estado = 'aprobada', modificado = ? WHERE estado = 'pendiente' AND id IN ($marcas)");
            $st->execute(array_merge([ahora()], $ids));
            responder(['ok' => true, 'aprobadas' => $st->rowCount()]);
        }

        case 'GET sesion':
            responder(['ok' => true, 'admin' => esAdmin()]);

        case 'POST login': {
            $pdo = db();
            $ip = ipCliente();
            $pdo->prepare('DELETE FROM intentos_login WHERE momento < ?')->execute([time() - 900]);
            $st = $pdo->prepare('SELECT COUNT(*) FROM intentos_login WHERE ip = ?');
            $st->execute([$ip]);
            if ((int)$st->fetchColumn() >= 8) fallo('Demasiados intentos. Espera 15 minutos.', 429);

            $clave = (string)(entrada()['password'] ?? '');
            if (!password_verify($clave, ADMIN_PASSWORD_HASH)) {
                $pdo->prepare('INSERT INTO intentos_login (ip, momento) VALUES (?, ?)')->execute([$ip, time()]);
                sleep(1);
                fallo('Contraseña incorrecta.', 401);
            }
            $pdo->prepare('DELETE FROM intentos_login WHERE ip = ?')->execute([$ip]);
            iniciarSesion();
            session_regenerate_id(true);
            $_SESSION['admin'] = true;
            responder(['ok' => true]);
        }

        case 'POST logout':
            iniciarSesion();
            $_SESSION = [];
            session_destroy();
            responder(['ok' => true]);

        case 'GET admin_listar':
        case 'GET admin_csv': {
            exigirAdmin();
            $where = [];
            $args = [];
            if (!empty($_GET['desde'])) { $where[] = 'fecha >= ?'; $args[] = fechaValida($_GET['desde']); }
            if (!empty($_GET['hasta'])) { $where[] = 'fecha <= ?'; $args[] = fechaValida($_GET['hasta']); }
            if (!empty($_GET['recurso'])) { $where[] = 'recurso = ?'; $args[] = recursoValido($_GET['recurso'])['id']; }
            if (!empty($_GET['estado']) && in_array($_GET['estado'], ['aprobada', 'pendiente'], true)) { $where[] = 'estado = ?'; $args[] = $_GET['estado']; }
            if (trim((string)($_GET['nombre'] ?? '')) !== '') {
                $where[] = "nombre_clave LIKE ? ESCAPE '\\'";
                $args[] = '%' . addcslashes(claveNombre(trim((string)$_GET['nombre'])), '%_\\') . '%';
            }
            $sql = 'SELECT id, fecha, franja, recurso, nombre, ciclo, ordenadores, estado, creado, modificado FROM reservas'
                . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' LIMIT 5000';
            $st = db()->prepare($sql);
            $st->execute($args);
            $filas = ordenar($st->fetchAll());

            if ($accion === 'admin_csv') {
                header('Content-Type: text/csv; charset=utf-8');
                header('Content-Disposition: attachment; filename="reservas-salas-ordenadores-' . date('Ymd') . '.csv"');
                $out = fopen('php://output', 'w');
                fwrite($out, "\xEF\xBB\xBF");
                fputcsv($out, ['Fecha', 'Hora', 'Aula', 'Nombre', 'Ciclo', 'Ordenadores', 'Estado', 'Creada', 'Modificada'], ';');
                foreach ($filas as $f) {
                    fputcsv($out, [
                        fmtFecha($f['fecha']), horaFranja($f['franja']), nombreRecurso($f['recurso']),
                        celdaCsv($f['nombre']), celdaCsv($f['ciclo']), $f['recurso'] === CARRO_ID ? $f['ordenadores'] : '',
                        $f['estado'] === 'pendiente' ? 'Pendiente de aprobación' : 'Aprobada',
                        $f['creado'], $f['modificado'],
                    ], ';');
                }
                exit;
            }
            responder(['ok' => true, 'reservas' => $filas]);
        }

        case 'POST admin_guardar': {
            exigirAdmin();
            $in = entrada();
            $id = (isset($in['id']) && $in['id'] !== '' && $in['id'] !== null) ? (int)$in['id'] : null;
            $fecha = fechaValida($in['fecha'] ?? '');
            $franja = franjaValida($in['franja'] ?? '')['id'];
            $recurso = recursoValido($in['recurso'] ?? '')['id'];
            $nombre = limpiarTexto($in['nombre'] ?? '', 3, 60, 'el nombre');
            $ciclo = limpiarTexto($in['ciclo'] ?? '', 0, 40, 'el ciclo');
            $ord = ordenadoresValidos($recurso, $in['ordenadores'] ?? 1);

            // La administración puede dejar cualquier reserva aprobada o pendiente (por defecto, aprobada)
            $estado = in_array($in['estado'] ?? '', ['aprobada', 'pendiente'], true) ? $in['estado'] : 'aprobada';

            // Bloqueo para que dos guardados a la vez no se pasen del hueco (sobre todo en el carro)
            $pdo = db();
            $pdo->exec('BEGIN IMMEDIATE');
            try {
                if ($motivo = hayHueco($pdo, $fecha, $franja, $recurso, $ord, $id)) {
                    $pdo->exec('ROLLBACK');
                    fallo('No se puede guardar: ' . $motivo, 409);
                }
                if ($id) {
                    $st = $pdo->prepare('UPDATE reservas SET fecha = ?, franja = ?, recurso = ?, nombre = ?, nombre_clave = ?, ciclo = ?, ordenadores = ?, estado = ?, modificado = ? WHERE id = ?');
                    $st->execute([$fecha, $franja, $recurso, $nombre, claveNombre($nombre), $ciclo, $ord, $estado, ahora(), $id]);
                    if (!$st->rowCount()) {
                        $pdo->exec('ROLLBACK');
                        fallo('La reserva ya no existe.', 404);
                    }
                } else {
                    $st = $pdo->prepare('INSERT INTO reservas (fecha, franja, recurso, nombre, nombre_clave, ciclo, ordenadores, lote, creado, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                    $st->execute([$fecha, $franja, $recurso, $nombre, claveNombre($nombre), $ciclo, $ord, 'admin', ahora(), $estado]);
                    $id = (int)$pdo->lastInsertId();
                }
                $pdo->exec('COMMIT');
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->exec('ROLLBACK');
                throw $e;
            }
            responder(['ok' => true, 'id' => $id]);
        }

        case 'POST admin_borrar': {
            exigirAdmin();
            $ids = entrada()['ids'] ?? [];
            if (!is_array($ids) || !$ids) fallo('No hay reservas seleccionadas.');
            $ids = array_map('intval', $ids);
            $marcas = implode(',', array_fill(0, count($ids), '?'));
            $st = db()->prepare("DELETE FROM reservas WHERE id IN ($marcas)");
            $st->execute($ids);
            responder(['ok' => true, 'borradas' => $st->rowCount()]);
        }

        default:
            fallo('Acción desconocida.', 404);
    }
} catch (PDOException $e) {
    error_log('reservadeaulas: ' . $e->getMessage());
    if (str_contains($e->getMessage(), 'UNIQUE')) fallo('Esa hora ya está reservada.', 409);
    fallo('Error interno del servidor.', 500);
} catch (Throwable $e) {
    error_log('reservadeaulas: ' . $e->getMessage());
    fallo('Error interno del servidor.', 500);
}
