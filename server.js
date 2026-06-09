import express from "express";
import pg from "pg";
import { initDB } from "./db/init.js";

const app = express();
app.use(express.json());

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// init DB on deploy
initDB(pool);

// -------------------- helpers --------------------

async function getCourse(name) {
  let r = await pool.query("SELECT id FROM clu_courses WHERE name=$1", [name]);
  if (r.rows.length) return r.rows[0].id;

  let ins = await pool.query(
    "INSERT INTO clu_courses(name) VALUES($1) RETURNING id",
    [name],
  );

  return ins.rows[0].id;
}

async function getSlot(time) {
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

async function getStudent(row) {
  let email = row["MAIL"];

  let r = await pool.query("SELECT id FROM clu_students WHERE email=$1", [
    email,
  ]);

  if (r.rows.length) return r.rows[0].id;

  let ins = await pool.query(
    `
    INSERT INTO clu_students(
      full_name,email,phone,mobile,birth_date,
      emergency_contact,emergency_phone,
      pickup_authorized,go_home_alone,
      video_authorized,insurance,siblings,ampa,
      allergies,diet
    )
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING id
    `,
    [
      row["APELLIDOS Y NOMBRE"],
      row["MAIL"],
      row["TEL CONTACTO"],
      row["MOVIL"],
      row["FECHA NACIMIENTO"],
      row["CONTACTOS EMERGENCIAS"],
      row["TEL CONTACTOS EMERGENCIAS"],
      row["AUTORIZADOS RECOGIDA"],
      row["¿AUTORIZADO IRSE A CASA SOLO?"],
      row["¿AUTORIZA VIDEO?"],
      row["¿CONTRATA SEGURO ESCOLAR?"],
      row["¿TIENE HERMANOS?"],
      row["¿PERTENECE AL AMPA?"],
      row["¿ALERGICO A ALGO?/¿PADECE ALGUNA ENFERMEDAD IMPORTANTE?"],
      row["¿SIGUE ALGUN REGIMEN DE COMIDAS?"],
    ],
  );

  return ins.rows[0].id;
}

// -------------------- import --------------------

app.post("/import", async (req, res) => {
  const row = req.body;

  try {
    const studentId = await getStudent(row);
    const courseId = await getCourse(row["ACTIVIDAD"]);
    const slotId = await getSlot(row["HORARIO"]);

    const session = await pool.query(
      `SELECT id FROM clu_sessions WHERE course_id=$1 AND slot_id=$2`,
      [courseId, slotId],
    );

    let sessionId;

    if (session.rows.length) {
      sessionId = session.rows[0].id;
    } else {
      let ins = await pool.query(
        `INSERT INTO clu_sessions(course_id,slot_id,capacity)
         VALUES($1,$2,$3) RETURNING id`,
        [courseId, slotId, 20],
      );
      sessionId = ins.rows[0].id;
    }

    await pool.query(
      `
      INSERT INTO clu_enrollments(
        student_id,
        session_id,
        professor,
        registration_date,
        observations,
        payment_notes,
        raw_data
      )
      VALUES($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        studentId,
        sessionId,
        row["PROFESOR"],
        row["FECHA INSCRIPCIÓN"],
        row["OBSERVACIONES COBRO"],
        null,
        row,
      ],
    );

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000);
