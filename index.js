// index.js
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de conexión a Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Railway te da esta URL
  ssl: { rejectUnauthorized: false }
});

// Endpoint de prueba
app.get('/', (req, res) => {
  res.send('API CRUD funcionando 🚀');
});


// =======================
// CRUD para PATIENTS
// =======================

// Listar todos los pacientes
app.get('/patients', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM patients ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al listar pacientes');
  }
});


// Listar pacientes filtrando por nombre
app.get('/patients/search', async (req, res) => {
  const { name } = req.query;

  if (!name) {
    return res.status(400).send('Debe enviar el parámetro name');
  }

  try {
    const result = await pool.query(
      'SELECT * FROM patients WHERE LOWER(name) LIKE LOWER($1) ORDER BY id',
      [`%${name}%`]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al buscar pacientes por nombre');
  }
});


// Crear un nuevo paciente (CREATE)
app.post('/patients', async (req, res) => {
  const { name, phone } = req.body;

  try {
    // Validar campos obligatorios
    if (!name || !phone) {
      return res.status(400).send('Los campos name y phone son obligatorios');
    }

    // Buscar el último sender
    const lastSender = await pool.query(
      "SELECT sender FROM patients WHERE sender LIKE 'px%' ORDER BY id DESC LIMIT 1"
    );

    let newSender = 'px1'; // valor inicial
    if (lastSender.rows.length > 0) {
      const lastValue = parseInt(lastSender.rows[0].sender.replace('px', ''), 10);
      newSender = `px${lastValue + 1}`;
    }

    // Insertar paciente con valores automáticos
    const result = await pool.query(
      'INSERT INTO patients (name, phone, sender) VALUES ($1, $2, $3) RETURNING *',
      [name, phone, newSender]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al crear paciente');
  }
});


// Actualizar un paciente (UPDATE)
// Solo permite modificar name y phone
app.put('/patients/:id', async (req, res) => {
  const { id } = req.params;
  const { name, phone } = req.body;

  try {
    const result = await pool.query(
      'UPDATE patients SET name=$1, phone=$2 WHERE id=$3 RETURNING *',
      [name, phone, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(`Paciente con id ${id} no encontrado`);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar paciente');
  }
});


// Eliminar un paciente (DELETE)
app.delete('/patients/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM patients WHERE id=$1', [id]);
    res.send(`Paciente con id ${id} eliminado`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al eliminar paciente');
  }
});


// =======================
// CRUD para APPOINTMENTS
// =======================

// Listar citas de la semana actual
app.get('/appointments/week', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, p.name AS patient_name
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      WHERE date >= date_trunc('week', CURRENT_DATE)
        AND date < date_trunc('week', CURRENT_DATE) + interval '7 days'
      ORDER BY a.date, a.time
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al listar citas de la semana');
  }
});


// Listar citas entre fecha inicial y final
app.get('/appointments/range', async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).send('Debe enviar startDate y endDate');
  }

  try {
    const result = await pool.query(`
      SELECT a.*, p.name AS patient_name
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      WHERE date BETWEEN $1 AND $2
      ORDER BY a.date, a.time
    `, [startDate, endDate]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al listar citas en rango');
  }
});


// Listar citas del día actual
app.get('/appointments/today', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, p.name AS patient_name
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      WHERE date = CURRENT_DATE
      ORDER BY a.time
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al listar citas del día');
  }
});


// Crear una nueva cita (CREATE)
app.post('/appointments', async (req, res) => {
  const { patient_id, date, time, reason, notes, duration } = req.body;

  try {
    // Validar que el paciente exista
    const patientCheck = await pool.query('SELECT id FROM patients WHERE id=$1', [patient_id]);
    if (patientCheck.rows.length === 0) {
      return res.status(400).send('El paciente no existe');
    }

    // Validar campos obligatorios
    if (!date || !time || !reason) {
      return res.status(400).send('Campos obligatorios: date, time, reason');
    }

    // Validar duración
    let finalDuration = duration || 30; // por defecto 30
    if (finalDuration < 30 || finalDuration % 30 !== 0) {
      return res.status(400).send('La duración debe ser múltiplo de 30 y mínimo 30');
    }

    // Insertar cita (id y created_at se llenan automáticamente)
    const result = await pool.query(
      `INSERT INTO appointments (patient_id, date, time, reason, notes, duration)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [patient_id, date, time, reason, notes || null, finalDuration]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al crear cita');
  }
});


// Actualizar cita (UPDATE)
// Solo permite modificar patient_id, date, time, reason y notes
app.put('/appointments/:id', async (req, res) => {
  const { id } = req.params;
  const { patient_id, date, time, reason, notes } = req.body;

  try {
    // Validar que la cita exista
    const appointmentCheck = await pool.query('SELECT * FROM appointments WHERE id=$1', [id]);
    if (appointmentCheck.rows.length === 0) {
      return res.status(404).send(`Cita con id ${id} no encontrada`);
    }

    // Si se envía patient_id, validar que el paciente exista
    if (patient_id) {
      const patientCheck = await pool.query('SELECT id FROM patients WHERE id=$1', [patient_id]);
      if (patientCheck.rows.length === 0) {
        return res.status(400).send('El paciente seleccionado no existe');
      }
    }

    // Actualizar solo los campos permitidos
    const result = await pool.query(
      `UPDATE appointments
       SET patient_id = COALESCE($1, patient_id),
           date = COALESCE($2, date),
           time = COALESCE($3, time),
           reason = COALESCE($4, reason),
           notes = COALESCE($5, notes)
       WHERE id=$6
       RETURNING *`,
      [patient_id || null, date || null, time || null, reason || null, notes || null, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar cita');
  }
});

// Marcar cita como completada
app.put('/appointments/:id/complete', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'UPDATE appointments SET status=$1 WHERE id=$2 AND status=$3 RETURNING *',
      ['completada', id, 'pendiente']
    );

    if (result.rows.length === 0) {
      return res.status(404).send(`Cita con id ${id} no encontrada o no está pendiente`);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al marcar cita como completada');
  }
});

// Marcar cita como rechazada
app.put('/appointments/:id/reject', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'UPDATE appointments SET status=$1 WHERE id=$2 AND status=$3 RETURNING *',
      ['rechazada', id, 'pendiente']
    );

    if (result.rows.length === 0) {
      return res.status(404).send(`Cita con id ${id} no encontrada o no está pendiente`);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al marcar cita como rechazada');
  }
});

// =======================
// Usuarios
// =======================

// Creación de usuarios
const bcrypt = require('bcrypt');
const saltRounds = 10;

app.post('/users', async (req, res) => {
  const { username, rol } = req.body;

  try {
    if (!username || !rol) {
      return res.status(400).send('Campos obligatorios: username y rol');
    }

    const validRoles = ['admin', 'agenda', 'consulta'];
    if (!validRoles.includes(rol)) {
      return res.status(400).send('Rol inválido');
    }

    // Encriptar password por defecto
    const defaultPassword = await bcrypt.hash('password123', saltRounds);

    const result = await pool.query(
      `INSERT INTO users (username, password, rol, usr_status, must_change_password, failed_attempts)
       VALUES ($1, $2, $3, 'activo', TRUE, 0)
       RETURNING id, username, rol, usr_status, must_change_password`,
      [username, defaultPassword, rol]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al crear usuario');
  }
});


// Cambio de contraseña
app.put('/users/:id/password', async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;

  // Validar complejidad
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{10,}$/;
  if (!regex.test(newPassword)) {
    return res.status(400).send('La contraseña debe tener mínimo 10 caracteres, incluir mayúsculas, minúsculas, números y caracteres especiales');
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    const result = await pool.query(
      `UPDATE users SET password=$1, must_change_password=FALSE WHERE id=$2
       RETURNING id, username, rol, usr_status, must_change_password`,
      [hashedPassword, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(`Usuario con id ${id} no encontrado`);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cambiar contraseña');
  }
});



// Login
const jwt = require('jsonwebtoken');

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE username=$1', [username]);

    if (result.rows.length === 0) {
      return res.status(400).send('Usuario no encontrado');
    }

    const user = result.rows[0];

    // Verificar estado
    if (user.usr_status !== 'activo') {
      return res.status(403).send(`Usuario ${user.usr_status}, no puede iniciar sesión`);
    }

    // Comparar contraseña con bcrypt
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      const attempts = user.failed_attempts + 1;

      if (attempts >= 3) {
        await pool.query(
          'UPDATE users SET usr_status=$1, failed_attempts=$2 WHERE id=$3',
          ['bloqueado', attempts, user.id]
        );
        return res.status(403).send('Usuario bloqueado por múltiples intentos fallidos');
      } else {
        await pool.query(
          'UPDATE users SET failed_attempts=$1 WHERE id=$2',
          [attempts, user.id]
        );
        return res.status(400).send(`Contraseña incorrecta. Intentos fallidos: ${attempts}`);
      }
    }

    // Resetear intentos fallidos
    await pool.query('UPDATE users SET failed_attempts=0 WHERE id=$1', [user.id]);

    // Generar token JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, rol: user.rol },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({
      token,
      must_change_password: user.must_change_password
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error en login');
  }
});


// Cambiar estado de un usuario (solo admin)
app.put('/users/:id/status', async (req, res) => {
  const { id } = req.params;
  const { newStatus, adminId } = req.body;

  try {
    // Validar que el admin exista y tenga rol admin
    const adminCheck = await pool.query('SELECT rol FROM users WHERE id=$1', [adminId]);
    if (adminCheck.rows.length === 0) {
      return res.status(403).send('Admin no encontrado');
    }
    if (adminCheck.rows[0].rol !== 'admin') {
      return res.status(403).send('Solo un usuario con rol admin puede cambiar estados');
    }

    // Validar nuevo estado
    const validStatuses = ['activo', 'bloqueado', 'deshabilitado'];
    if (!validStatuses.includes(newStatus)) {
      return res.status(400).send('Estado inválido');
    }

    // Actualizar estado del usuario
    const result = await pool.query(
      'UPDATE users SET usr_status=$1 WHERE id=$2 RETURNING id, username, rol, usr_status',
      [newStatus, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(`Usuario con id ${id} no encontrado`);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cambiar estado del usuario');
  }
});


// Listar todos los usuarios con sus roles y estados
app.get('/users', async (req, res) => {
  const { adminId } = req.query;

  try {
    // Validar que el solicitante sea admin
    const adminCheck = await pool.query('SELECT rol FROM users WHERE id=$1', [adminId]);
    if (adminCheck.rows.length === 0) {
      return res.status(403).send('Admin no encontrado');
    }
    if (adminCheck.rows[0].rol !== 'admin') {
      return res.status(403).send('Solo un usuario con rol admin puede listar usuarios');
    }

    // Listar todos los usuarios
    const result = await pool.query(
      'SELECT id, username, rol, usr_status, must_change_password, created_at FROM users ORDER BY id'
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al listar usuarios');
  }
});


// =======================
// Funcionalidades
// =======================

// Contador de citas del día
app.get('/appointments/count/:date', async (req, res) => {
  const { date } = req.params;

  try {
    const result = await pool.query(
      'SELECT COUNT(*) AS total FROM appointments WHERE date = $1',
      [date]
    );

    res.json({
      date,
      total: parseInt(result.rows[0].total, 10)
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al contar citas del día');
  }
});


// Listar citas de un día específico
app.get('/appointments/bydate/:date', async (req, res) => {
  const { date } = req.params;

  try {
    const result = await pool.query(`
      SELECT a.*, p.name AS patient_name
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      WHERE date = $1
      ORDER BY a.time
    `, [date]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al listar citas por fecha');
  }
});



