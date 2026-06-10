import express from "express";
import pg from "pg";
import { initDB } from "./db/init.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

// -------------------- DB --------------------

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// -------------------- HEALTH --------------------

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "excel-import-api" });
});

// -------------------- START --------------------

async function start() {
  try {
    console.log("Starting server...");
    await initDB(pool);
    console.log("DB initialized");

    app.listen(process.env.PORT || 3000, () => {
      console.log("Server running");
    });
  } catch (e) {
    console.error("FATAL START ERROR:", e);
    process.exit(1);
  }
}

start();

// -------------------- IMPORT BATCH (NEW LOGIC) --------------------

app.post("/import-batch", async (req, res) => {
  const client = await pool.connect();

  try {
    const { meta, rows } = req.body;

    if (!meta || !Array.isArray(rows)) {
      return res.status(400).json({
        error: "meta and rows are required",
      });
    }

    console.log("META:", meta);
    console.log("ROWS:", rows.length);

    let insertedStudents = 0;
    let insertedEnrollments = 0;

    await client.query("BEGIN");

    // -------------------------
    // 1. COURSE
    // -------------------------
    const courseRes = await client.query(
      `
      INSERT INTO clu_courses(name)
      VALUES ($1)
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
      `,
      [meta.course_name],
    );

    const courseId = courseRes.rows[0].id;

    // -------------------------
    // 2. SLOT
    // -------------------------
    const slotRes = await client.query(
      `
      INSERT INTO clu_slots(time_range)
      VALUES ($1)
      ON CONFLICT (time_range) DO UPDATE SET time_range = EXCLUDED.time_range
      RETURNING id
      `,
      [meta.time_range],
    );

    const slotId = slotRes.rows[0].id;

    // -------------------------
    // 3. SESSION
    // -------------------------
    const sessionRes = await client.query(
      `
      INSERT INTO clu_sessions(course_id, slot_id, day)
      VALUES ($1, $2, $3)
      ON CONFLICT (course_id, slot_id, day)
      DO UPDATE SET course_id = EXCLUDED.course_id
      RETURNING id
      `,
      [courseId, slotId, meta.day],
    );

    const sessionId = sessionRes.rows[0].id;

    // -------------------------
    // 4. STUDENTS + ENROLLMENTS
    // -------------------------
    for (const r of rows) {
      try {
        if (!r.MAIL) continue;

        // -------------------------
        // STUDENT UPSERT
        // -------------------------
        const studentRes = await client.query(
          `
          INSERT INTO clu_students(
            full_name,
            email,
            phone,
            mobile,
            birth_date,
            emergency_contact,
            emergency_phone,
            pickup_authorized,
            go_home_alone,
            video_authorized,
            insurance,
            siblings,
            ampa,
            allergies,
            diet
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          ON CONFLICT (email)
          DO UPDATE SET email = EXCLUDED.email
          RETURNING id
          `,
          [
            r["APELLIDOS Y NOMBRE"],
            r.MAIL,
            r["TEL CONTACTO"],
            r.MOVIL,
            r["FECHA NACIMIENTO"],
            r["CONTACTOS EMERGENCIAS"],
            r["TEL CONTACTOS EMERGENCIAS"],
            r["AUTORIZADOS RECOGIDA"],
            r["AUTORIZADO IRSE A CASA SOLO"],
            r["AUTORIZA VIDEO"],
            r["CONTRATA SEGURO ESCOLAR"],
            r["TIENE HERMANOS"],
            r["PERTENECE AL AMPA"],
            r["ALERGIA_ENFERMEDAD"],
            r["REGIMEN_COMIDAS"],
          ],
        );

        const studentId = studentRes.rows[0].id;

        // -------------------------
        // ENROLLMENT
        // -------------------------
        await client.query(
          `
          INSERT INTO clu_enrollments(
            student_id,
            session_id,
            professor,
            registration_date,
            observations,
            raw_data
          )
          VALUES ($1,$2,$3,$4,$5,$6)
          `,
          [
            studentId,
            sessionId,
            r.PROFESOR,
            r["FECHA INSCRIPCIÓN"],
            r["OBSERVACIONES COBRO"],
            r,
          ],
        );

        insertedStudents++;
        insertedEnrollments++;
      } catch (rowErr) {
        console.error("ROW ERROR:", {
          message: rowErr.message,
          row: r,
        });
      }
    }

    await client.query("COMMIT");

    res.json({
      ok: true,
      course: meta.course_name,
      session: sessionId,
      students: insertedStudents,
      enrollments: insertedEnrollments,
    });
  } catch (e) {
    await client.query("ROLLBACK");

    console.error("BATCH ERROR FULL:", e);

    res.status(500).json({
      error: e.message,
      stack: e.stack,
    });
  } finally {
    client.release();
  }
});
