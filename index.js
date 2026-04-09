// index.js
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

///////////////////////////////////////////////////////////////////////////////


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
  res.json({ mensaje:"API CRUD funcionando 🚀"});
});

// Middleware para validar token JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // formato: "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: "Token requerido" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Token inválido" });
    }
    req.user = user; // aquí guardamos los datos del usuario (id, username, rol)
    next();
  });
}

// =================================================================================================
// CRUD para PATIENTS
// =================================================================================================

// Listar todos los pacientes con 4 columnas
app.get('/patients', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, phone, created_at FROM patients ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar pacientes" });
  }
});


// filtrando por nombre o celular con 4 columnas
app.get('/patients/search', async (req, res) => {
  const { name, phone } = req.query;

  if (!name && !phone) {
    return res.status(400).json({ error: "Debe seleccionar nombre o celular" });
  }

  try {
    let query = 'SELECT id, name, phone, created_at FROM patients WHERE 1=1';
    const values = [];
    let idx = 1;

    if (name) {
      query += ` AND LOWER(name) LIKE LOWER($${idx++})`;
      values.push(`%${name}%`);
    }

    if (phone) {
      query += ` AND phone LIKE $${idx++}`;
      values.push(`%${phone}%`);
    }

    query += ' ORDER BY id';

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al buscar pacientes" });
  }
});


// Crear un nuevo paciente (CREATE) solicita name y phone
app.post('/patients', authenticateToken, async (req, res) => {
  const { name, phone } = req.body;

  try {
    // Validar rol del usuario logueado
    const currentUser = await pool.query('SELECT rol FROM users WHERE id=$1', [req.user.id]);
    if (currentUser.rows.length === 0) {
      return res.status(401).json({ error: "Usuario logueado no encontrado" });
    }
    if (!["admin", "agenda"].includes(currentUser.rows[0].rol)) {
      return res.status(403).json({ error: "Solo usuarios con rol admin o agenda pueden crear pacientes" });
    }
    
    // Validar campos obligatorios
    if (!name || !phone) {
      return res.status(400).json({ error: "Los campos nombre y celular son obligatorios" });
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
    res.status(500).json({ error: "Error al crear paciente" });
  }
});


// Actualizar un paciente (UPDATE) Solo permite modificar name y phone
app.put('/patients/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, phone } = req.body;

  try {
    const currentUser = await pool.query('SELECT rol FROM users WHERE id=$1', [req.user.id]);
    if (currentUser.rows.length === 0) {
      return res.status(401).json({ error: "Usuario logueado no encontrado" });
    }
    if (!["admin", "agenda"].includes(currentUser.rows[0].rol)) {
      return res.status(403).json({ error: "Solo usuarios con rol admin o agenda pueden editar pacientes" });
    }

    // Construir dinámicamente los campos a actualizar
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      fields.push(`name=$${idx++}`);
      values.push(name);
    }
    if (phone !== undefined) {
      fields.push(`phone=$${idx++}`);
      values.push(phone);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "Nada para actualizar" });
    }

    values.push(id);

    const query = `UPDATE patients SET ${fields.join(", ")} WHERE id=$${idx} RETURNING *`;
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Paciente con id ${id} no encontrado` });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar paciente" });
  }
});



// Eliminar un paciente (DELETE)
app.delete('/patients/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const currentUser = await pool.query('SELECT rol FROM users WHERE id=$1', [req.user.id]);
    if (currentUser.rows.length === 0) {
      return res.status(401).json({ error: "Usuario logueado no encontrado" });
    }
    if (!["admin", "agenda"].includes(currentUser.rows[0].rol)) {
      return res.status(403).json({ error: "Solo usuarios con rol admin o agenda pueden eliminar pacientes" });
    }
    
    const result = await pool.query('DELETE FROM patients WHERE id=$1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Paciente con id ${id} no encontrado` });
    }
    
    res.json({ mensaje:`Paciente con id ${id} eliminado`});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar paciente" });
  }
});


// ========================================================================================
// CRUD para APPOINTMENTS
// ========================================================================================


// Filtro general de citas con campo notas
app.get('/appointments/filter', authenticateToken, async (req, res) => {
  const { start_date, end_date, time, patient_name, patient_phone, status } = req.query;

  try {
    // Base query
    let query = `
      SELECT 
        a.date, 
        a.time, 
        p.name AS patient_name, 
        p.phone AS patient_phone, 
        a.reason, 
        a.status,
        a.notes
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      WHERE 1=1
    `;
    const values = [];
    let idx = 1;

    // Rango de fechas
    if (start_date && end_date) {
      query += ` AND a.date BETWEEN $${idx++} AND $${idx++}`;
      values.push(start_date, end_date);
    } else if (start_date) {
      query += ` AND a.date >= $${idx++}`;
      values.push(start_date);
    } else if (end_date) {
      query += ` AND a.date <= $${idx++}`;
      values.push(end_date);
    }

    // Hora exacta
    if (time) {
      query += ` AND a.time = $${idx++}`;
      values.push(time);
    }

    // Nombre paciente
    if (patient_name) {
      query += ` AND p.name ILIKE $${idx++}`;
      values.push(`%${patient_name}%`);
    }

    // Celular paciente
    if (patient_phone) {
      query += ` AND p.phone ILIKE $${idx++}`;
      values.push(`%${patient_phone}%`);
    }

    // Estado cita
    if (status) {
      query += ` AND a.status ILIKE $${idx++}`;
      values.push(`%${status}%`);
    }

    query += ` ORDER BY a.date, a.time`;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.json({ mensaje: "No se encontraron citas con esos filtros" });
    }

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al filtrar citas" });
  }
});

// Listar citas de la semana, actual 5 columnas
app.get('/appointments/week', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.time, p.name AS patient_name, p.phone AS patient_phone, a.reason, a.status
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      WHERE date >= date_trunc('week', CURRENT_DATE)
        AND date < date_trunc('week', CURRENT_DATE) + interval '7 days'
      ORDER BY a.date, a.time
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar citas de la semana" });
  }
});


// Listar citas entre fecha inicial y final, 5 columnas
app.get('/appointments/range', async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: "Debe seleccionar una fecha de inicio y una fecha de fin" });
  }

  try {
    const result = await pool.query(`
      SELECT a.time, p.name AS patient_name, p.phone AS patient_phone, a.reason, a.status
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      WHERE date BETWEEN $1 AND $2
      ORDER BY a.date, a.time
    `, [startDate, endDate]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar citas en rango" });
  }
});


// Tabla de slots para la fecha actual ---------------------------------------------------------
app.get('/schedule/today', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const requestedDate = new Date(today);
    const dayOfWeek = requestedDate.getDay(); // 0=Domingo, 6=Sábado

    // Consultar citas de hoy (ahora incluye id)
    const result = await pool.query(
      `SELECT a.id, a.time, a.duration, p.name AS patient_name, p.phone AS patient_phone, a.reason, a.status
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       WHERE a.date=$1`,
      [today]
    );
    const appointments = result.rows;

    // Validar domingo
    if (dayOfWeek === 0) {
      if (appointments.length === 0) {
        return res.json({ mensaje: "Sin citas disponibles en domingo" });
      } else {
        return res.json(appointments.map(a => ({
          id: a.id,
          time: a.time,
          patient_name: a.patient_name,
          patient_phone: a.patient_phone,
          reason: a.reason,
          status: a.status,
          nota: "Domingo"
        })));
      }
    }

    // Validar feriado
    const feriadoCheck = await pool.query('SELECT 1 FROM feriados WHERE fecha=$1', [today]);
    if (feriadoCheck.rows.length > 0) {
      if (appointments.length === 0) {
        return res.json({ mensaje: "Sin citas disponibles en feriado" });
      } else {
        return res.json(appointments.map(a => ({
          id: a.id,
          time: a.time,
          patient_name: a.patient_name,
          patient_phone: a.patient_phone,
          reason: a.reason,
          status: a.status,
          nota: "Feriado"
        })));
      }
    }

    // Definir slots normales
    let slots = [];
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      slots = [
        "09:00","09:30","10:00","10:30","11:00","11:30",
        "14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00"
      ];
    } else if (dayOfWeek === 6) {
      slots = ["09:00","09:30","10:00","10:30","11:00","11:30"];
    }

    // Expandir citas según duración
    const occupiedSlots = [];
    appointments.forEach(a => {
      let [h, m] = a.time.split(':').map(Number);
      for (let i = 0; i < a.duration/30; i++) {
        occupiedSlots.push({
          id: a.id,
          slot: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,
          patient_name: a.patient_name,
          patient_phone: a.patient_phone,
          reason: a.reason,
          status: a.status
        });
        m += 30;
        if (m === 60) { h += 1; m = 0; }
      }
    });

    // Construir tabla de slots normales
    const schedule = slots.map(slot => {
      const appt = occupiedSlots.find(o => o.slot === slot);
      if (appt) {
        return {
          id: appt.id,
          time: slot,
          patient_name: appt.patient_name,
          patient_phone: appt.patient_phone,
          reason: appt.reason,
          status: appt.status
        };
      } else {
        return {
          id: null, // 👈 disponible no tiene id
          time: slot,
          patient_name: "Disponible",
          patient_phone: "",
          reason: "",
          status: "",
          accion: "registrar"
        };
      }
    });

    // Incluir citas fuera de horario
    const outOfRange = appointments.filter(a => {
      let [h, m] = a.time.split(':').map(Number);
      const slotStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      return !slots.includes(slotStr);
    }).map(a => ({
      id: a.id,
      time: a.time,
      patient_name: a.patient_name,
      patient_phone: a.patient_phone,
      reason: a.reason,
      status: a.status,
      nota: "Fuera de horario habitual"
    }));

    res.json([...schedule, ...outOfRange]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar tabla de horarios para hoy" });
  }
});


// Tabla de slots por horarios para cualquier fecha, con validación ±30 días
app.get('/schedule/:date', authenticateToken, async (req, res) => {
  const { date } = req.params;
  try {
    const requestedDate = new Date(date);
    const today = new Date();
    const diffDays = Math.floor((requestedDate - today) / (1000 * 60 * 60 * 24));

    if (diffDays < -30 || diffDays > 30) {
      return res.status(400).json({ error: "Solo se permite navegar hasta 30 días atrás o adelante" });
    }

    const dayOfWeek = requestedDate.getDay(); // 0=Domingo, 6=Sábado

    // Consultar citas de ese día (ahora incluye id)
    const result = await pool.query(
      `SELECT a.id, a.time, a.duration, p.name AS patient_name, p.phone AS patient_phone, a.reason, a.status
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       WHERE a.date=$1`,
      [date]
    );
    const appointments = result.rows;

    // Validar domingo
    if (dayOfWeek === 0) {
      if (appointments.length === 0) {
        return res.json({ mensaje: "Sin citas disponibles en domingo" });
      } else {
        return res.json(appointments.map(a => ({
          id: a.id,
          time: a.time,
          patient_name: a.patient_name,
          patient_phone: a.patient_phone,
          reason: a.reason,
          status: a.status,
          nota: "Domingo"
        })));
      }
    }

    // Validar feriado
    const feriadoCheck = await pool.query('SELECT 1 FROM feriados WHERE fecha=$1', [date]);
    if (feriadoCheck.rows.length > 0) {
      if (appointments.length === 0) {
        return res.json({ mensaje: "Sin citas disponibles en feriado" });
      } else {
        return res.json(appointments.map(a => ({
          id: a.id,
          time: a.time,
          patient_name: a.patient_name,
          patient_phone: a.patient_phone,
          reason: a.reason,
          status: a.status,
          nota: "Feriado"
        })));
      }
    }

    // Definir slots normales
    let slots = [];
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      slots = [
        "09:00","09:30","10:00","10:30","11:00","11:30",
        "14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00"
      ];
    } else if (dayOfWeek === 6) {
      slots = ["09:00","09:30","10:00","10:30","11:00","11:30"];
    }

    // Expandir citas según duración
    const occupiedSlots = [];
    appointments.forEach(a => {
      let [h, m] = a.time.split(':').map(Number);
      for (let i = 0; i < a.duration/30; i++) {
        occupiedSlots.push({
          id: a.id,
          slot: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,
          patient_name: a.patient_name,
          patient_phone: a.patient_phone,
          reason: a.reason,
          status: a.status
        });
        m += 30;
        if (m === 60) { h += 1; m = 0; }
      }
    });

    // Construir tabla de slots normales
    const schedule = slots.map(slot => {
      const appt = occupiedSlots.find(o => o.slot === slot);
      if (appt) {
        return {
          id: appt.id,
          time: slot,
          patient_name: appt.patient_name,
          patient_phone: appt.patient_phone,
          reason: appt.reason,
          status: appt.status
        };
      } else {
        return {
          id: null, // 👈 disponible no tiene id
          time: slot,
          patient_name: "Disponible",
          patient_phone: "",
          reason: "",
          status: "",
          accion: "registrar"
        };
      }
    });

    // Incluir citas fuera de horario
    const outOfRange = appointments.filter(a => {
      let [h, m] = a.time.split(':').map(Number);
      const slotStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      return !slots.includes(slotStr);
    }).map(a => ({
      id: a.id,
      time: a.time,
      patient_name: a.patient_name,
      patient_phone: a.patient_phone,
      reason: a.reason,
      status: a.status,
      nota: "Fuera de horario habitual"
    }));

    res.json([...schedule, ...outOfRange]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar tabla de horarios" });
  }
});


//Resgistro de feriados
app.post('/feriados', authenticateToken, async (req, res) => {
  const { fecha, descripcion } = req.body;
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ error: "Solo admin puede registrar feriados" });
  }
  try {
    const result = await pool.query(
      'INSERT INTO feriados (fecha, descripcion) VALUES ($1, $2) RETURNING *',
      [fecha, descripcion]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar feriado" });
  }
});


// Registra cita en slot disponible
app.post('/appointments/slot', authenticateToken, async (req, res) => {
  const { date, time, patient_id, reason } = req.body;

  try {
    // Validar rol del usuario logueado
    const currentUser = await pool.query('SELECT rol FROM users WHERE id=$1', [req.user.id]);
    if (currentUser.rows.length === 0) {
      return res.status(401).json({ error: "Usuario logueado no encontrado" });
    }
    if (!["admin", "agenda"].includes(currentUser.rows[0].rol)) {
      return res.status(403).json({ error: "Solo usuarios con rol admin o agenda pueden registrar citas" });
    }

    // Validar paciente
    const patientCheck = await pool.query('SELECT id, name, phone FROM patients WHERE id=$1', [patient_id]);
    if (patientCheck.rows.length === 0) {
      return res.status(400).json({ error: "Paciente no existe" });
    }

    // Validar que no exista cita en ese slot
    const apptCheck = await pool.query('SELECT id FROM appointments WHERE date=$1 AND time=$2', [date, time]);
    if (apptCheck.rows.length > 0) {
      return res.status(400).json({ error: "Ese horario ya está ocupado" });
    }

    // Insertar cita
    const result = await pool.query(
      `INSERT INTO appointments (patient_id, date, time, reason, status, duration, created_at)
       VALUES ($1, $2, $3, $4, 'pendiente', 30, NOW())
       RETURNING *`,
      [patient_id, date, time, reason]
    );

    const appointment = result.rows[0];

    // 👇 Adjuntar datos del paciente
    appointment.patient_name = patientCheck.rows[0].name;
    appointment.patient_phone = patientCheck.rows[0].phone;

    res.json(appointment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar cita" });
  }
});



//Edita citas canceladas o rechazadas
app.put('/appointments/:id/edit', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { patient_id, reason } = req.body;

  try {
    // Validar rol del usuario logueado
    const currentUser = await pool.query('SELECT rol FROM users WHERE id=$1', [req.user.id]);
    if (currentUser.rows.length === 0) {
      return res.status(401).json({ error: "Usuario logueado no encontrado" });
    }
    if (!["admin", "agenda"].includes(currentUser.rows[0].rol)) {
      return res.status(403).json({ error: "Solo usuarios con rol admin o agenda pueden editar citas" });
    }

    // Verificar estado de la cita
    const apptCheck = await pool.query('SELECT status FROM appointments WHERE id=$1', [id]);
    if (apptCheck.rows.length === 0) return res.status(404).json({ error: "Cita no encontrada" });

    const currentStatus = apptCheck.rows[0].status.toLowerCase();
    if (currentStatus !== 'rechazado' && currentStatus !== 'cancelado') {
      return res.status(400).json({ error: "Solo se pueden editar citas en estado rechazado o cancelado" });
    }

    // Construir campos dinámicos
    const fields = [];
    const values = [];
    let idx = 1;

    if (patient_id) {
      // Validar paciente y traer phone
      const patientCheck = await pool.query('SELECT id, name, phone FROM patients WHERE id=$1', [patient_id]);
      if (patientCheck.rows.length === 0) {
        return res.status(400).json({ error:"Paciente no existe"});
      }
      fields.push(`patient_id=$${idx++}`);
      values.push(patient_id);
    }

    if (reason) {
      fields.push(`reason=$${idx++}`);
      values.push(reason);
    }

    // Siempre actualizar estado a pendiente
    fields.push(`status=$${idx++}`);
    values.push('pendiente');

    if (fields.length === 0) {
      return res.status(400).json({ error: "Debe enviar al menos un campo para actualizar" });
    }

    values.push(id);

    const result = await pool.query(
      `UPDATE appointments SET ${fields.join(', ')} WHERE id=$${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Cita no encontrada"});

    // Traer datos del paciente para mostrar name y phone
    const patientData = await pool.query(
      'SELECT name, phone FROM patients WHERE id=$1',
      [result.rows[0].patient_id]
    );

    const response = {
      time: result.rows[0].time,
      patient_name: patientData.rows[0].name,
      patient_phone: patientData.rows[0].phone,
      reason: result.rows[0].reason,
      status: result.rows[0].status
    };

    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al editar cita" });
  }
});


// Muestra fecha actual y conteo de citas
app.get('/schedule/today/summary', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const result = await pool.query(
      'SELECT COUNT(*) AS total FROM appointments WHERE date=$1',
      [today]
    );

    res.json({
      date: today,
      total_citas: parseInt(result.rows[0].total, 10)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar resumen de citas para hoy" });
  }
});


// Muestra cualquier fecha y conteo de citas, con validación ±30 días
app.get('/schedule/:date/summary', authenticateToken, async (req, res) => {
  const { date } = req.params;
  try {
    const requestedDate = new Date(date);
    const today = new Date();
    const diffDays = Math.floor((requestedDate - today) / (1000 * 60 * 60 * 24));

    if (diffDays < -30 || diffDays > 30) {
      return res.status(400).json({ error: "Solo se permite navegar hasta 30 días atrás o adelante" });
    }

    const result = await pool.query(
      'SELECT COUNT(*) AS total FROM appointments WHERE date=$1',
      [date]
    );

    res.json({
      date: date,
      total_citas: parseInt(result.rows[0].total, 10)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar resumen de citas" });
  }
});

//Filtro de citas
app.get('/schedule/:date/filter', authenticateToken, async (req, res) => {
  const { date } = req.params;
  const { time, patient_name, patient_phone, status } = req.query;

  try {
    // Base query
    let query = `
      SELECT a.time, p.name AS patient_name, p.phone AS patient_phone, a.reason, a.status
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      WHERE a.date=$1
    `;
    const values = [date];
    let idx = 2;

    // Filtros dinámicos
    if (time) {
      query += ` AND a.time=$${idx++}`;
      values.push(time);
    }
    if (patient_name) {
      query += ` AND p.name ILIKE $${idx++}`;
      values.push(`%${patient_name}%`);
    }
    if (patient_phone) {
      query += ` AND p.phone ILIKE $${idx++}`;
      values.push(`%${patient_phone}%`);
    }
    if (status) {
      query += ` AND a.status ILIKE $${idx++}`;
      values.push(`%${status}%`);
    }

    query += ` ORDER BY a.time`;

    const result = await pool.query(query, values);

    // Si no hay resultados, devolver mensaje
    if (result.rows.length === 0) {
      return res.json({ mensaje: "No se encontraron citas con esos filtros" });
    }

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al filtrar citas" });
  }
});


//Registra citas, registro maestro
app.post('/appointments/master', authenticateToken, async (req, res) => {
  const { date, time, patient_id, reason, duration } = req.body;

  try {
    // Validar rol del usuario logueado
    const currentUser = await pool.query('SELECT rol FROM users WHERE id=$1', [req.user.id]);
    if (currentUser.rows.length === 0) {
      return res.status(401).json({ error: "Usuario logueado no encontrado" });
    }
    if (currentUser.rows[0].rol !== "admin") {
      return res.status(403).json({ error: "Solo usuarios con rol admin pueden usar el registro maestro" });
    }

    // Validar paciente
    const patientCheck = await pool.query('SELECT id, name, phone FROM patients WHERE id=$1', [patient_id]);
    if (patientCheck.rows.length === 0) {
      return res.status(400).json({ error: "Paciente no existe" });
    }

    // Duración en minutos (mínimo 30, múltiplos de 30)
    const dur = duration && duration >= 30 && duration % 30 === 0 ? duration : 30;
    const blocksNeeded = dur / 30;

    // Generar lista de bloques que ocupará la cita
    const startHour = time;
    const slots = [];
    let [h, m] = startHour.split(':').map(Number);
    for (let i = 0; i < blocksNeeded; i++) {
      slots.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
      m += 30;
      if (m === 60) { h += 1; m = 0; }
    }

    
    // Validar que ninguno de los bloques esté ocupado
    const apptCheck = await pool.query(
      'SELECT time FROM appointments WHERE date=$1 AND time = ANY($2::time[])',
      [date, slots]
    );
    if (apptCheck.rows.length > 0) {
      return res.status(400).json({ error: `Los siguientes horarios ya están ocupados: ${apptCheck.rows.map(a => a.time).join(', ')}`});
    }

    // Registrar cita (solo se guarda el bloque inicial, duración indica cuántos ocupa)
    const result = await pool.query(
      `INSERT INTO appointments (patient_id, date, time, reason, status, duration, created_at)
       VALUES ($1, $2, $3, $4, 'pendiente', $5, NOW())
       RETURNING *`,
      [patient_id, date, time, reason, dur]
    );

    res.json({
      id: result.rows[0].id,
      date: result.rows[0].date,
      time: result.rows[0].time,
      patient_name: patientCheck.rows[0].name,
      patient_phone: patientCheck.rows[0].phone,
      reason: result.rows[0].reason,
      status: result.rows[0].status,
      duration: result.rows[0].duration
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar cita maestra" });
  }
});

// Muestra nota de una cita
app.get('/appointments/:id/notes', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT notes FROM appointments WHERE id=$1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Cita no encontrada" });
    }
    res.json({ notes: result.rows[0].notes || "" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener notas" });
  }
});

// Editar nota de una cita
app.put('/appointments/:id/notes', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;

  try {
    const result = await pool.query(
      'UPDATE appointments SET notes=$1 WHERE id=$2 RETURNING id, notes',
      [notes, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Cita no encontrada" });
    }
    res.json({
      mensaje: "Notas actualizadas correctamente",
      id: result.rows[0].id,
      notes: result.rows[0].notes
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar notas" });
  }
});


// Editar estado de una cita
app.put('/appointments/:id/status', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  // Estados permitidos
  const allowedStatuses = ["pendiente", "cancelado", "rechazado", "completado"];

  try {
    // Verificar cita existente
    const result = await pool.query(
      'SELECT status FROM appointments WHERE id=$1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Cita no encontrada" });
    }

    const currentStatus = result.rows[0].status;

    // Validar que si ya está completado, no se pueda cambiar
    if (currentStatus === "completado" && status !== "completado") {
      return res.status(400).json({ error: "Las citas completadas no se pueden modificar" });
    }

    // Validar nuevo estado
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: "Estado inválido. Solo se permite: pendiente, cancelado, rechazado, completado" });
    }

    // Actualizar estado
    const update = await pool.query(
      'UPDATE appointments SET status=$1 WHERE id=$2 RETURNING id, status',
      [status, id]
    );

    res.json({
      mensaje: "Estado actualizado correctamente",
      id: update.rows[0].id,
      status: update.rows[0].status
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar estado de la cita" });
  }
});


// =====================================================================================================================
// Usuarios
// =====================================================================================================================

// Creación de usuarios
const bcrypt = require('bcrypt');
const saltRounds = 10;

app.post('/users', authenticateToken, async (req, res) => {
  const { username, rol } = req.body;

  try {
    // Validar que el usuario logueado sea admin
    const currentUser = await pool.query(
      'SELECT rol FROM users WHERE id=$1',
      [req.user.id] // req.user.id viene del token JWT
    );

    if (currentUser.rows.length === 0) {
      return res.status(401).json({ error: "Usuario logueado no encontrado" });
    }

    if (currentUser.rows[0].rol !== "admin") {
      return res.status(403).json({ error: "Solo un usuario con rol admin puede crear usuarios" });
    }
    
    if (!username || !rol) {
      return res.status(400).json({ error: "Campos obligatorios: nombre y rol" });
    }

    const validRoles = ['admin', 'agenda', 'consulta'];
    if (!validRoles.includes(rol)) {
      return res.status(400).json({ error: "Rol inválido" });
    }

    // Encriptar password por defecto
    const defaultPassword = await bcrypt.hash('password123', saltRounds);

    const result = await pool.query(
      `INSERT INTO users (username, password, rol, usr_status, must_change_password, failed_attempts)
       VALUES ($1, $2, $3, 'activo', TRUE, 0)
       RETURNING id, username, rol, usr_status, must_change_password, failed_attempts`,
      [username, defaultPassword, rol]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear usuario" });
  }
});


// Editar rol de un usuario (solo admin puede hacerlo)
app.put('/users/:id/rol', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { rol } = req.body;

  // Roles permitidos
  const allowedRoles = ["admin", "agenda", "consulta"];

  try {
    // Verificar que el usuario logueado sea admin
    const currentUser = await pool.query(
      'SELECT rol FROM users WHERE id=$1',
      [req.user.id] // req.user.id viene del token JWT
    );

    if (currentUser.rows.length === 0) {
      return res.status(401).json({ error: "Usuario logueado no encontrado"});
    }

    if (currentUser.rows[0].rol !== "admin") {
      return res.status(403).json({ error: "Solo un usuario con rol admin puede cambiar roles"});
    }

    // Validar nuevo rol
    if (!allowedRoles.includes(rol)) {
      return res.status(400).json({ error: "Rol inválido. Solo se permite: admin, agenda, consulta"});
    }

    // Verificar usuario a modificar
    const targetUser = await pool.query(
      'SELECT id, username, rol FROM users WHERE id=$1',
      [id]
    );
    if (targetUser.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado"});
    }

    // Actualizar rol
    const update = await pool.query(
      'UPDATE users SET rol=$1 WHERE id=$2 RETURNING id, username, rol',
      [rol, id]
    );

    res.json({
      mensaje: "Rol actualizado correctamente",
      id: update.rows[0].id,
      username: update.rows[0].username,
      rol: update.rows[0].rol
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar rol del usuario"});
  }
});


// Cambiar estado de un usuario (solo admin)
app.put('/users/:id/status', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { newStatus } = req.body;

  try {
    // Validar que el usuario logueado sea admin
    const currentUser = await pool.query('SELECT rol FROM users WHERE id=$1', [req.user.id]);
    if (currentUser.rows.length === 0) {
      return res.status(401).json({ error: "Usuario logueado no encontrado"});
    }
    if (currentUser.rows[0].rol !== 'admin') {
      return res.status(403).json({ error: "Solo un usuario con rol admin puede cambiar estados"});
    }

    // Validar nuevo estado
    const validStatuses = ['activo', 'bloqueado', 'deshabilitado'];
    if (!validStatuses.includes(newStatus)) {
      return res.status(400).json({ error: "Estado inválido"});
    }

    // Actualizar estado del usuario
    const result = await pool.query(
      'UPDATE users SET usr_status=$1 WHERE id=$2 RETURNING id, username, rol, usr_status',
      [newStatus, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Usuario con id ${id} no encontrado`});
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cambiar estado del usuario"});
  }
});


// Editar datos de un usuario (rol, estado, username) - solo admin
app.put('/users/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { rol, newStatus, username } = req.body;

  // Roles y estados permitidos
  const allowedRoles = ["admin", "agenda", "consulta"];
  const validStatuses = ["activo", "bloqueado", "deshabilitado"];

  try {
    // Verificar que el usuario logueado sea admin
    const currentUser = await pool.query(
      'SELECT rol FROM users WHERE id=$1',
      [req.user.id]
    );

    if (currentUser.rows.length === 0) {
      return res.status(401).json({ error: "Usuario logueado no encontrado"});
    }

    if (currentUser.rows[0].rol !== "admin") {
      return res.status(403).json({ error: "Solo un usuario con rol admin puede editar usuarios"});
    }

    // Verificar que el usuario a modificar exista
    const targetUser = await pool.query(
      'SELECT id, username, rol, usr_status FROM users WHERE id=$1',
      [id]
    );
    if (targetUser.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado"});
    }

    // Construir dinámicamente los campos a actualizar
    const fields = [];
    const values = [];
    let idx = 1;

    if (rol) {
      if (!allowedRoles.includes(rol)) {
        return res.status(400).json({ error: "Rol inválido. Solo se permite: admin, agenda, consulta"});
      }
      fields.push(`rol=$${idx++}`);
      values.push(rol);
    }

    if (newStatus) {
      if (!validStatuses.includes(newStatus)) {
        return res.status(400).json({ error: "Estado inválido"});
      }
      fields.push(`usr_status=$${idx++}`);
      values.push(newStatus);
    }

    if (username) {
      fields.push(`username=$${idx++}`);
      values.push(username);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "No se proporcionó ningún campo válido para actualizar"});
    }

    values.push(id); // último valor para el WHERE

    const query = `
      UPDATE users 
      SET ${fields.join(", ")} 
      WHERE id=$${idx} 
      RETURNING id, username, rol, usr_status
    `;

    const update = await pool.query(query, values);

    res.json({
      mensaje: "Usuario actualizado correctamente",
      ...update.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar usuario"});
  }
});

// Filtrar usuarios por username (solo admin)
app.get('/users', authenticateToken, async (req, res) => {
  const { username } = req.query; // se pasa como ?username=valor

  try {
    // Verificar que el usuario logueado sea admin
    const currentUser = await pool.query(
      'SELECT rol FROM users WHERE id=$1',
      [req.user.id]
    );

    if (currentUser.rows.length === 0) {
      return res.status(401).json({ error: "Usuario logueado no encontrado"});
    }

    if (currentUser.rows[0].rol !== "admin") {
      return res.status(403).json({ error: "Solo un usuario con rol admin puede listar usuarios"});
    }

    let result;
    if (username) {
      // Filtrar por username (case-insensitive con ILIKE)
      result = await pool.query(
        'SELECT id, username, rol, usr_status FROM users WHERE username ILIKE $1',
        [`%${username}%`]
      );
    } else {
      // Si no se pasa username, devolver todos
      result = await pool.query(
        'SELECT id, username, rol, usr_status FROM users'
      );
    }

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener usuarios"});
  }
});


// Listar todos los usuarios con sus roles y estados
app.get('/users', async (req, res) => {
  const { adminId } = req.query;

  try {
    // Validar que el solicitante sea admin
    const adminCheck = await pool.query('SELECT rol FROM users WHERE id=$1', [adminId]);
    if (adminCheck.rows.length === 0) {
      return res.status(403).json({ error: "Admin no encontrado"});
    }
    if (adminCheck.rows[0].rol !== 'admin') {
      return res.status(403).json({ error: "Solo un usuario con rol admin puede listar usuarios"});
    }

    // Listar todos los usuarios
    const result = await pool.query(
      'SELECT id, username, rol, usr_status, created_at FROM users ORDER BY id'
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar usuarios"});
  }
});


// =====================================================================================================================
// Mensajes
// =====================================================================================================================

// Listar todas las interacciones con datos del paciente
app.get('/interactions', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        i.patient_id AS id_patient,
        i.message_in AS mensaje,
        p.name AS patient_name,
        p.phone AS patient_phone,
        i.pushname AS nombre_whatsapp,
        i.created_at AS fecha_envio
      FROM interactions i
      LEFT JOIN patients p ON i.patient_id = p.id
      ORDER BY i.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar interacciones"});
  }
});


// Filtrar interacciones por nombre de paciente y/o teléfono
app.get('/interactions/search', authenticateToken, async (req, res) => {
  const { patient_name, patient_phone } = req.query;

  if (!patient_name && !patient_phone) {
    return res.status(400).json({ error: "Debe enviar al menos un parámetro: patient_name o patient_phone"});
  }

  try {
    let query = `
      SELECT 
        i.patient_id AS id_patient,
        i.message_in AS mensaje,
        p.name AS patient_name,
        p.phone AS patient_phone,
        i.pushname AS nombre_whatsapp,
        i.created_at AS fecha_envio
      FROM interactions i
      LEFT JOIN patients p ON i.patient_id = p.id
      WHERE 1=1
    `;
    const values = [];
    let idx = 1;

    if (patient_name) {
      query += ` AND LOWER(p.name) LIKE LOWER($${idx++})`;
      values.push(`%${patient_name}%`);
    }

    if (patient_phone) {
      query += ` AND p.phone LIKE $${idx++}`;
      values.push(`%${patient_phone}%`);
    }

    query += ' ORDER BY i.created_at DESC';

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al buscar interacciones"});
  }
});

// =====================================================================================================================
// Autenticacion
// =====================================================================================================================

// Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE username=$1', [username]);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Usuario no encontrado"});
    }

    const user = result.rows[0];

    // Verificar estado
    if (user.usr_status !== 'activo') {
      return res.status(403).json({ error: `Usuario ${user.usr_status}, no puede iniciar sesión`});
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
        return res.status(403).json({ error: "Usuario bloqueado por múltiples intentos fallidos"});
      } else {
        await pool.query(
          'UPDATE users SET failed_attempts=$1 WHERE id=$2',
          [attempts, user.id]
        );
        return res.status(400).json({ error: `Contraseña incorrecta. Intentos fallidos: ${attempts}`});
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
      user: {
        id: user.id,
        username: user.username,
        rol: user.rol,
        must_change_password: user.must_change_password
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en login"});
  }
});

// Cambio de contraseña primer inicio de sesion
app.put('/users/:id/password', async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;

  // Validar complejidad
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{10,}$/;
  if (!regex.test(newPassword)) {
    return res.status(400).json({ error: "La contraseña debe tener mínimo 10 caracteres, incluir mayúsculas, minúsculas, números y caracteres especiales"});
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    const result = await pool.query(
      `UPDATE users SET password=$1, must_change_password=FALSE WHERE id=$2
       RETURNING id, username, rol, usr_status, must_change_password`,
      [hashedPassword, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Usuario con id ${id} no encontrado`});
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cambiar contraseña"});
  }
});


// Cambio voluntario de contraseña (usuario autenticado)
app.put('/users/:id/change-password', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { currentPassword, newPassword } = req.body;


  // Validar que el usuario autenticado sea el mismo que quiere cambiar su contraseña
  if (parseInt(id) !== req.user.id) {
    return res.status(403).json({ error: "No puede cambiar la contraseña de otro usuario"});
  }

  // Validar complejidad de la nueva contraseña
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{10,}$/;
  if (!regex.test(newPassword)) {
    return res.status(400).json({ error: "La contraseña debe tener mínimo 10 caracteres, incluir mayúsculas, minúsculas, números y caracteres especiales"});
  }

  try {
    // Obtener usuario
    const result = await pool.query('SELECT password FROM users WHERE id=$1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado"});
    }

    const user = result.rows[0];

    // Validar contraseña actual
    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      return res.status(400).json({ error: "La contraseña actual es incorrecta"});
    }

    // Guardar nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    await pool.query(
      'UPDATE users SET password=$1, must_change_password=false WHERE id=$2',
      [hashedPassword, id]
    );

    res.json({ mensaje: "Contraseña cambiada correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al cambiar contraseña"});
  }
});


/////////////////////////////////////////////////////////////////////////////////////

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

////////////////////////////////////////////////////////////////////////////////////