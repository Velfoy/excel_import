import pg from "pg";

export async function initDB(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clu_courses (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clu_slots (
      id SERIAL PRIMARY KEY,
      time_range TEXT UNIQUE
    );
  `);

  // ✅ FIXED: added day
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clu_sessions (
      id SERIAL PRIMARY KEY,
      course_id INT REFERENCES clu_courses(id),
      slot_id INT REFERENCES clu_slots(id),
      day TEXT,
      capacity INT DEFAULT 20,
      UNIQUE(course_id, slot_id, day)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clu_students (
      id SERIAL PRIMARY KEY,
      full_name TEXT,
      email TEXT UNIQUE,
      phone TEXT,
      mobile TEXT,
      birth_date TEXT,
      emergency_contact TEXT,
      emergency_phone TEXT,
      pickup_authorized TEXT,
      go_home_alone BOOLEAN,
      video_authorized BOOLEAN,
      insurance BOOLEAN,
      siblings BOOLEAN,
      ampa BOOLEAN,
      allergies TEXT,
      diet TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
  CREATE TABLE IF NOT EXISTS clu_raw_imports (
    id SERIAL PRIMARY KEY,
    data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
  );
`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clu_enrollments (
      id SERIAL PRIMARY KEY,
      student_id INT REFERENCES clu_students(id),
      session_id INT REFERENCES clu_sessions(id),
      professor TEXT,
      registration_date TEXT,
      observations TEXT,
      payment_notes TEXT,
      raw_data JSONB,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log("DB initialized");
}
