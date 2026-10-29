<?php
// Configuración del sistema de reservas — CIFP Tony Gallardo
declare(strict_types=1);

date_default_timezone_set('Atlantic/Canary');

const DB_PATH = __DIR__ . '/../data/reservas.sqlite';

// Contraseña de la zona de administración (se compara con password_verify)
// ADMIN_PASSWORD_HASH está en secreto.php (no se sube a git). Ver secreto.ejemplo.php.
require __DIR__ . '/secreto.php';

const CONTACTO_EMAIL = 'fvazyan@canariaseducacion.es';
const CONTACTO_NOMBRE = 'Coordinación TIC';

const MAX_DIAS = 5;              // días distintos por reserva
const MAX_HORAS_POR_RECURSO = 3; // horas por aula y día, por persona

// Ordenadores de los que dispone el carro (ajustar al número real)
const CARRO_ID = 'CARRO';
const CARRO_ORDENADORES = 30;

const RECURSOS = [
    ['id' => 'INF1',  'nombre' => 'Informática 1', 'corto' => 'Inf. 1'],
    ['id' => 'INF2',  'nombre' => 'Informática 2', 'corto' => 'Inf. 2'],
    ['id' => 'INF3',  'nombre' => 'Informática 3', 'corto' => 'Inf. 3'],
    ['id' => 'CARRO', 'nombre' => 'Ordenadores de Carros', 'corto' => 'Carro'],
    // 'aprobacion' => true: las reservas quedan "pendiente" hasta que jefatura de estudios las apruebe
    ['id' => 'EMPR', 'nombre' => 'Emprendimiento', 'corto' => 'Empr.', 'aprobacion' => true],
];

// 'recreo' => true: se muestra pero no se puede reservar
const FRANJAS = [
    ['id' => 'M1', 'turno' => 'Mañana', 'inicio' => '08:00', 'fin' => '08:55'],
    ['id' => 'M2', 'turno' => 'Mañana', 'inicio' => '08:55', 'fin' => '09:50'],
    ['id' => 'M3', 'turno' => 'Mañana', 'inicio' => '09:50', 'fin' => '10:45'],
    ['id' => 'RM', 'turno' => 'Mañana', 'inicio' => '10:45', 'fin' => '11:15', 'recreo' => true],
    ['id' => 'M4', 'turno' => 'Mañana', 'inicio' => '11:15', 'fin' => '12:10'],
    ['id' => 'M5', 'turno' => 'Mañana', 'inicio' => '12:10', 'fin' => '13:05'],
    ['id' => 'M6', 'turno' => 'Mañana', 'inicio' => '13:05', 'fin' => '14:00'],
    ['id' => 'T1', 'turno' => 'Tarde',  'inicio' => '15:00', 'fin' => '15:55'],
    ['id' => 'T2', 'turno' => 'Tarde',  'inicio' => '15:55', 'fin' => '16:50'],
    ['id' => 'T3', 'turno' => 'Tarde',  'inicio' => '16:50', 'fin' => '17:45'],
    ['id' => 'RT', 'turno' => 'Tarde',  'inicio' => '17:45', 'fin' => '18:15', 'recreo' => true],
    ['id' => 'T4', 'turno' => 'Tarde',  'inicio' => '18:15', 'fin' => '19:10'],
    ['id' => 'T5', 'turno' => 'Tarde',  'inicio' => '19:10', 'fin' => '20:05'],
    ['id' => 'T6', 'turno' => 'Tarde',  'inicio' => '20:05', 'fin' => '21:00'],
];
