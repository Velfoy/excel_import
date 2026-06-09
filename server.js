import express from "express";
import pg from "pg";
import { initDB } from "./db/init.js";

const app = express();
app.use(express.json());

// -------------------- DB --------------------

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// -------------------- START --------------------

async function start() {
  await initDB(pool);
  app.listen(process.env.PORT || 3000, () => console.log("Server running"));
}

start();

// -------------------- HELPERS --------------------

function toBool(v) {
  if (v === true || v === false) return v;
  if (!v) return false;

  const s = v.toString().toLowerCase();
  return s === "yes" || s === "true" || s === "sí" || s === "si";
}

async function getCourse(name) {
  if (!name) return null;

  let r = await pool.query("SELECT id FROM clu_courses WHERE name=$1", [name]);

  if (r.rows.length) return r.rows[0].id;

  let ins = await pool.query(
    "INSERT INTO clu_courses(name) VALUES($1) RETURNING id",
    [name],
  );

  return ins.rows[0].id;
}

async function getSlot(time) {
  if (!time) return null;

  let r = await pool.query("SELECT id FROM clu_slots WHERE time_range=$1", [
    time,
  ]);

  if (r.rows.length) return r.rows[0].id;

  let ins = await pool.query(
    "INSERT INTO clu_slots(time_range) VALUES($1) RETURNING id",
    [time],
  );

  return ins.rows[0].id;
}

async function getSession(courseId, slotId, day) {
  let r = await pool.query(
    `SELECT id FROM clu_sessions 
     WHERE course_id=$1 AND slot_id=$2 AND day=$3`,
    [courseId, slotId, day],
  );

  if (r.rows.length) return r.rows[0].id;

  let ins = await pool.query(
    `INSERT INTO clu_sessions(course_id,slot_id,day,capacity)
     VALUES($1,$2,$3,$4)
     RETURNING id`,
    [courseId, slotId, day, 20],
  );

  return ins.rows[0].id;
}

async function getStudent(row) {
  const email = row["MAIL"];
  if (!email) throw new Error("Missing MAIL");

  let r = await pool.query("SELECT id FROM clu_students WHERE email=$1", [
    email,
  ]);

  if (r.rows.length) return r.rows[0].id;

  let ins = await pool.query(
    `INSERT INTO clu_students(
      full_name,email,phone,mobile,birth_date,
      emergency_contact,emergency_phone,
      pickup_authorized,go_home_alone,
      video_authorized,insurance,siblings,ampa,
      allergies,diet
    )
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING id`,
    [
      row["APELLIDOS Y NOMBRE"] || null,
      email,
      row["TEL CONTACTO"] || null,
      row["MOVIL"] || null,
      row["FECHA NACIMIENTO"] || null,
      row["CONTACTOS EMERGENCIAS"] || null,
      row["TEL CONTACTOS EMERGENCIAS"] || null,
      row["AUTORIZADOS RECOGIDA"] || null,
      toBool(row["¿AUTORIZADO IRSE A CASA SOLO?"]),
      toBool(row["¿AUTORIZA VIDEO?"]),
      toBool(row["¿CONTRATA SEGURO ESCOLAR?"]),
      toBool(row["¿TIENE HERMANOS?"]),
      toBool(row["¿PERTENECE AL AMPA?"]),
      row["¿ALERGICO A ALGO?/¿PADECE ALGUNA ENFERMEDAD IMPORTANTE?"] || null,
      row["¿SIGUE ALGUN REGIMEN DE COMIDAS?"] || null,
    ],
  );

  return ins.rows[0].id;
}

// -------------------- IMPORT --------------------

app.post("/import", async (req, res) => {
  try {
    const row = req.body;

    const course = row["ACTIVIDAD"];
    const time = row["HORARIO"];
    const day = row.day || "unknown";

    const courseId = await getCourse(course);
    const slotId = await getSlot(time);

    const sessionId = await getSession(courseId, slotId, day);

    const studentId = await getStudent(row);

    await pool.query(
      `INSERT INTO clu_enrollments(
        student_id,
        session_id,
        professor,
        registration_date,
        observations,
        payment_notes,
        raw_data
      )
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        studentId,
        sessionId,
        row["PROFESOR"] || null,
        row["FECHA INSCRIPCIÓN"] || null,
        row["OBSERVACIONES COBRO"] || null,
        null,
        row,
      ],
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("IMPORT ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});
app.post("/import-batch", async (req, res) => {
  try {
    const rows = req.body.rows;

    for (const row of rows) {
      await pool.query(
        `INSERT INTO clu_raw_imports(data)
         VALUES($1)`,
        [row],
      );
    }

    res.json({ ok: true, count: rows.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});
