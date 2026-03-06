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



