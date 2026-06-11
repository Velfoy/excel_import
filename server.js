import express from "express";
import pg from "pg";
import cors from "cors";
import { initDB } from "./db/init.js";

app.use(
  cors({
    origin: ["*"],
    credentials: true,
  }),
);
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
      return res.status(400).json({ error: "meta and rows required" });
    }

    await client.query("BEGIN");

    let students = 0;
    let enrollments = 0;

    // ================= COURSE =================
    const courseRes = await client.query(
      `INSERT INTO clu_courses(name)
       VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [meta.course_name],
    );
    const courseId = courseRes.rows[0].id;

    // ================= SLOT =================
    const slotRes = await client.query(
      `INSERT INTO clu_slots(time_range)
       VALUES ($1)
       ON CONFLICT (time_range) DO UPDATE SET time_range = EXCLUDED.time_range
       RETURNING id`,
      [meta.time_range],
    );
    const slotId = slotRes.rows[0].id;

    // ================= SESSION =================
    const sessionRes = await client.query(
      `INSERT INTO clu_sessions(course_id, slot_id, day)
       VALUES ($1,$2,$3)
       ON CONFLICT (course_id, slot_id, day)
       DO UPDATE SET course_id = EXCLUDED.course_id
       RETURNING id`,
      [courseId, slotId, meta.weekday],
    );
    const sessionId = sessionRes.rows[0].id;

    // ================= ROWS =================

    for (const r of rows) {
      if (!r.MAIL) continue;

      const email = r.MAIL.toLowerCase().trim();

      // STUDENT
      const s = await client.query(
        `INSERT INTO clu_students(full_name, email)
         VALUES ($1,$2)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id`,
        [r["APELLIDOS Y NOMBRE"], email],
      );

      const studentId = s.rows[0].id;
      students++;

      // ENROLLMENT (NO DUPLICATES)
      const exists = await client.query(
        `SELECT id FROM clu_enrollments
         WHERE student_id=$1 AND session_id=$2`,
        [studentId, sessionId],
      );

      if (exists.rowCount === 0) {
        await client.query(
          `INSERT INTO clu_enrollments(
            student_id, session_id, professor,
            registration_date, observations, payment_notes, raw_data
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            studentId,
            sessionId,
            r["PROFESOR"],
            r["FECHA INSCRIPCIÓN"],
            r["OBSERVACIONES COBRO"],
            r["REGIMEN_COMIDAS"],
            r,
          ],
        );

        enrollments++;
      }
    }

    await client.query("COMMIT");

    res.json({
      ok: true,
      course: meta.course_name,
      session: sessionId,
      students,
      enrollments,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);

    res.status(500).json({
      ok: false,
      error: e.message,
    });
  } finally {
    client.release();
  }
});

//--------------------Search--------------------
app.get("/students/by-email", async (req, res) => {
  const client = await pool.connect();

  try {
    const email = req.query.email?.trim();

    if (!email) {
      return res.status(400).json({ error: "email required" });
    }

    const result = await client.query(
      `
      SELECT
        s.id AS student_id,
        s.full_name,
        s.email,
        s.phone,
        s.birth_date,

        e.id AS enrollment_id,
        e.professor,
        e.registration_date,
        e.status,

        c.name AS course_name,
        sl.time_range,
        sess.day

      FROM clu_students s
      JOIN clu_enrollments e ON e.student_id = s.id
      JOIN clu_sessions sess ON sess.id = e.session_id
      JOIN clu_courses c ON c.id = sess.course_id
      JOIN clu_slots sl ON sl.id = sess.slot_id

      WHERE LOWER(s.email) = LOWER($1)
      ORDER BY sess.day, sl.time_range
      `,
      [email],
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
