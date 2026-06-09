import express from "express";
import pg from "pg";
import { initDB } from "./db/init.js";

const app = express();
app.use(express.json({ limit: "10mb" })); // IMPORTANT for big Excel payloads

// -------------------- HEALTH CHECK --------------------

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "excel-import-api" });
});

// -------------------- DB --------------------

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// -------------------- STARTUP --------------------

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

// -------------------- IMPORT (single row) --------------------

app.post("/import", async (req, res) => {
  try {
    const row = req.body;

    if (!row || typeof row !== "object") {
      return res.status(400).json({ error: "Invalid row payload" });
    }

    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO clu_raw_imports(data) VALUES($1::jsonb)`,
        [row],
      );
      res.json({ ok: true });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("IMPORT ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

// -------------------- IMPORT BATCH (SAFE VERSION) --------------------

app.post("/import-batch", async (req, res) => {
  try {
    const rows = req.body?.rows;

    if (!Array.isArray(rows)) {
      return res.status(400).json({
        error: "rows must be an array",
      });
    }

    console.log("Received batch:", rows.length);

    const client = await pool.connect();

    let inserted = 0;
    let failed = 0;

    try {
      await client.query("BEGIN");

      for (const r of rows) {
        try {
          if (!r || typeof r !== "object") continue;

          await client.query(`INSERT INTO clu_raw_imports(data) VALUES($1)`, [
            r,
          ]);

          inserted++;
        } catch (err) {
          failed++;
          console.error("ROW INSERT ERROR:", err.message);
        }
      }

      await client.query("COMMIT");

      res.json({
        ok: true,
        inserted,
        failed,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("BATCH ERROR:", e);
    res.status(500).json({
      error: e.message,
    });
  }
});
