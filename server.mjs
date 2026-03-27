import express from "express";
import pg from "pg";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

// ─── PostgreSQL ───
const pool = new pg.Pool({
  host: process.env.PG_HOST || "127.0.0.1",
  port: parseInt(process.env.PG_PORT || "5432"),
  database: process.env.PG_DATABASE || "openprocess_db",
  user: process.env.PG_USER || "openprocess",
  password: process.env.PG_PASSWORD || "",
});

// ─── Middleware ───
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

// ─── Session ───
const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({ pool, tableName: "session" }),
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  })
);

// ─── Auth Middleware ───
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Giriş yapmalısınız" });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin")
    return res.status(403).json({ error: "Yetkiniz yok" });
  next();
}

// ═══════════════════════════════
// AUTH
// ═══════════════════════════════

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Kullanıcı adı ve şifre gerekli" });
    const result = await pool.query("SELECT * FROM users WHERE username = $1 AND active = true", [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: "Geçersiz kullanıcı adı veya şifre" });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Geçersiz kullanıcı adı veya şifre" });
    req.session.user = { id: user.id, username: user.username, name: user.name, role: user.role };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Giriş yapılmamış" });
  res.json({ user: req.session.user });
});

// ═══════════════════════════════
// CUSTOMERS
// ═══════════════════════════════

app.get("/api/customers", requireAuth, async (req, res) => {
  try {
    const { search } = req.query;
    let query = "SELECT * FROM customers ORDER BY created_at DESC LIMIT 100";
    let params = [];
    if (search) {
      query = "SELECT * FROM customers WHERE name ILIKE $1 OR phone ILIKE $1 ORDER BY created_at DESC LIMIT 50";
      params = [`%${search}%`];
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/customers", requireAuth, async (req, res) => {
  try {
    const { name, phone, email, notes } = req.body;
    if (!name || !phone) return res.status(400).json({ error: "İsim ve telefon gerekli" });
    const result = await pool.query(
      "INSERT INTO customers (name, phone, email, notes) VALUES ($1,$2,$3,$4) RETURNING *",
      [name, phone, email || null, notes || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/customers/:id", requireAuth, async (req, res) => {
  try {
    const { name, phone, email, notes } = req.body;
    const result = await pool.query(
      "UPDATE customers SET name=$1, phone=$2, email=$3, notes=$4 WHERE id=$5 RETURNING *",
      [name, phone, email, notes, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════
// VEHICLES
// ═══════════════════════════════

app.get("/api/vehicles/search/:plate", requireAuth, async (req, res) => {
  try {
    const plate = req.params.plate.replace(/\s/g, "").toUpperCase();
    const result = await pool.query(
      `SELECT v.*, c.name as customer_name, c.phone as customer_phone, c.id as customer_id
       FROM vehicles v JOIN customers c ON v.customer_id = c.id
       WHERE UPPER(REPLACE(v.plate, ' ', '')) = $1`,
      [plate]
    );
    if (result.rows.length === 0) return res.json({ found: false });
    res.json({ found: true, vehicle: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/vehicles", requireAuth, async (req, res) => {
  try {
    const { customer_id } = req.query;
    let query = `SELECT v.*, c.name as customer_name, c.phone as customer_phone
                 FROM vehicles v JOIN customers c ON v.customer_id = c.id ORDER BY v.created_at DESC LIMIT 100`;
    let params = [];
    if (customer_id) {
      query = `SELECT v.*, c.name as customer_name, c.phone as customer_phone
               FROM vehicles v JOIN customers c ON v.customer_id = c.id WHERE v.customer_id = $1 ORDER BY v.created_at DESC`;
      params = [customer_id];
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/vehicles", requireAuth, async (req, res) => {
  try {
    const { customer_id, plate, brand, model, color, year, notes } = req.body;
    if (!customer_id || !plate) return res.status(400).json({ error: "Müşteri ve plaka gerekli" });
    const result = await pool.query(
      "INSERT INTO vehicles (customer_id, plate, brand, model, color, year, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [customer_id, plate.toUpperCase().replace(/\s/g, ""), brand, model, color, year || null, notes]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════
// SERVICES
// ═══════════════════════════════

app.get("/api/services", requireAuth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM services WHERE active = true ORDER BY sort_order, category, name");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/services", requireAdmin, async (req, res) => {
  try {
    const { name, category, price, duration_minutes, description } = req.body;
    const result = await pool.query(
      "INSERT INTO services (name, category, price, duration_minutes, description) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [name, category || "genel", price, duration_minutes || 30, description]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/services/:id", requireAdmin, async (req, res) => {
  try {
    const { name, category, price, duration_minutes, description, active } = req.body;
    const result = await pool.query(
      "UPDATE services SET name=$1, category=$2, price=$3, duration_minutes=$4, description=$5, active=$6 WHERE id=$7 RETURNING *",
      [name, category, price, duration_minutes, description, active, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════
// JOBS (İş Emirleri)
// ═══════════════════════════════

app.get("/api/jobs", requireAuth, async (req, res) => {
  try {
    const { status, date } = req.query;
    let query = `
      SELECT j.*, v.plate, v.brand, v.model, v.color,
             c.name as customer_name, c.phone as customer_phone,
             u.name as assigned_name
      FROM jobs j
      JOIN vehicles v ON j.vehicle_id = v.id
      JOIN customers c ON j.customer_id = c.id
      LEFT JOIN users u ON j.assigned_to = u.id`;
    const conditions = [];
    const params = [];
    if (status) { params.push(status); conditions.push(`j.status = $${params.length}`); }
    if (date) { params.push(date); conditions.push(`j.created_at::date = $${params.length}`); }
    if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY j.created_at DESC LIMIT 200";
    const result = await pool.query(query, params);
    for (const job of result.rows) {
      const svc = await pool.query("SELECT * FROM job_services WHERE job_id = $1", [job.id]);
      job.services = svc.rows;
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/jobs/active", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT j.*, v.plate, v.brand, v.model, v.color,
             c.name as customer_name, c.phone as customer_phone,
             u.name as assigned_name
      FROM jobs j
      JOIN vehicles v ON j.vehicle_id = v.id
      JOIN customers c ON j.customer_id = c.id
      LEFT JOIN users u ON j.assigned_to = u.id
      WHERE j.status IN ('waiting','in_progress','completed')
      ORDER BY CASE j.status WHEN 'waiting' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'completed' THEN 3 END, j.created_at ASC
    `);
    for (const job of result.rows) {
      const svc = await pool.query("SELECT * FROM job_services WHERE job_id = $1", [job.id]);
      job.services = svc.rows;
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/jobs", requireAuth, async (req, res) => {
  try {
    const { vehicle_id, customer_id, service_ids, notes, assigned_to } = req.body;
    if (!vehicle_id || !customer_id) return res.status(400).json({ error: "Araç ve müşteri gerekli" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const jobResult = await client.query(
        "INSERT INTO jobs (vehicle_id, customer_id, notes, assigned_to) VALUES ($1,$2,$3,$4) RETURNING *",
        [vehicle_id, customer_id, notes || null, assigned_to || null]
      );
      const job = jobResult.rows[0];
      let totalAmount = 0;
      if (service_ids && service_ids.length > 0) {
        for (const sid of service_ids) {
          const svc = await client.query("SELECT name, price FROM services WHERE id = $1", [sid]);
          if (svc.rows.length > 0) {
            await client.query(
              "INSERT INTO job_services (job_id, service_id, service_name, price) VALUES ($1,$2,$3,$4)",
              [job.id, sid, svc.rows[0].name, svc.rows[0].price]
            );
            totalAmount += parseFloat(svc.rows[0].price);
          }
        }
      }
      await client.query("UPDATE jobs SET total_amount = $1 WHERE id = $2", [totalAmount, job.id]);
      await client.query("UPDATE customers SET total_visits = total_visits + 1 WHERE id = $1", [customer_id]);
      await client.query("COMMIT");
      job.total_amount = totalAmount;
      res.json(job);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/jobs/:id/status", requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const jobId = req.params.id;
    const validTransitions = {
      waiting: ["in_progress", "cancelled"],
      in_progress: ["completed", "cancelled"],
      completed: ["delivered", "in_progress"],
      delivered: [],
      cancelled: ["waiting"],
    };
    const current = await pool.query("SELECT status FROM jobs WHERE id = $1", [jobId]);
    if (current.rows.length === 0) return res.status(404).json({ error: "İş emri bulunamadı" });
    if (!validTransitions[current.rows[0].status]?.includes(status))
      return res.status(400).json({ error: `${current.rows[0].status} → ${status} geçişi yapılamaz` });
    let extra = "";
    if (status === "in_progress") extra = ", started_at = NOW()";
    if (status === "completed") extra = ", completed_at = NOW()";
    if (status === "delivered") extra = ", delivered_at = NOW()";
    const result = await pool.query(`UPDATE jobs SET status = $1 ${extra} WHERE id = $2 RETURNING *`, [status, jobId]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/jobs/:id/pay", requireAuth, async (req, res) => {
  try {
    const { payment_method } = req.body;
    const result = await pool.query(
      "UPDATE jobs SET paid = true, payment_method = $1, status = 'delivered', delivered_at = NOW() WHERE id = $2 RETURNING *",
      [payment_method, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "İş emri bulunamadı" });
    const job = result.rows[0];
    await pool.query("UPDATE customers SET total_spent = total_spent + $1 WHERE id = $2", [job.total_amount, job.customer_id]);
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════
// APPOINTMENTS
// ═══════════════════════════════

app.get("/api/appointments", requireAuth, async (req, res) => {
  try {
    const { date, status } = req.query;
    let query = `SELECT a.*, c.name as customer_name, c.phone as customer_phone,
                 v.plate, v.brand, v.model FROM appointments a
                 LEFT JOIN customers c ON a.customer_id = c.id
                 LEFT JOIN vehicles v ON a.vehicle_id = v.id`;
    const conditions = [];
    const params = [];
    if (date) { params.push(date); conditions.push(`a.appointment_date = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`a.status = $${params.length}`); }
    if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY a.appointment_date, a.appointment_time";
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/appointments", requireAuth, async (req, res) => {
  try {
    const { customer_id, vehicle_id, appointment_date, appointment_time, service_notes } = req.body;
    if (!customer_id || !appointment_date || !appointment_time)
      return res.status(400).json({ error: "Müşteri, tarih ve saat gerekli" });
    const result = await pool.query(
      "INSERT INTO appointments (customer_id, vehicle_id, appointment_date, appointment_time, service_notes) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [customer_id, vehicle_id || null, appointment_date, appointment_time, service_notes]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/appointments/:id/status", requireAuth, async (req, res) => {
  try {
    const result = await pool.query("UPDATE appointments SET status = $1 WHERE id = $2 RETURNING *", [req.body.status, req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════
// DASHBOARD STATS
// ═══════════════════════════════

app.get("/api/stats/dashboard", requireAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const [activeJobs, todayJobs, todayRevenue, totalCustomers, weekRevenue] = await Promise.all([
      pool.query("SELECT status, COUNT(*) as count FROM jobs WHERE status IN ('waiting','in_progress','completed') GROUP BY status"),
      pool.query("SELECT COUNT(*) as count FROM jobs WHERE created_at::date = $1", [today]),
      pool.query("SELECT COALESCE(SUM(total_amount),0) as total FROM jobs WHERE delivered_at::date = $1 AND paid = true", [today]),
      pool.query("SELECT COUNT(*) as count FROM customers"),
      pool.query("SELECT COALESCE(SUM(total_amount),0) as total FROM jobs WHERE delivered_at >= NOW() - INTERVAL '7 days' AND paid = true"),
    ]);
    const statusCounts = { waiting: 0, in_progress: 0, completed: 0 };
    activeJobs.rows.forEach((r) => { statusCounts[r.status] = parseInt(r.count); });
    res.json({
      active_jobs: statusCounts,
      today_jobs: parseInt(todayJobs.rows[0].count),
      today_revenue: parseFloat(todayRevenue.rows[0].total),
      total_customers: parseInt(totalCustomers.rows[0].count),
      week_revenue: parseFloat(weekRevenue.rows[0].total),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stats/revenue", requireAuth, async (req, res) => {
  try {
    const { period } = req.query;
    let query;
    if (period === "monthly") {
      query = `SELECT DATE_TRUNC('month', delivered_at) as period, COUNT(*) as job_count, SUM(total_amount) as total,
               SUM(CASE WHEN payment_method='cash' THEN total_amount ELSE 0 END) as cash_total,
               SUM(CASE WHEN payment_method='card' THEN total_amount ELSE 0 END) as card_total
               FROM jobs WHERE paid = true AND delivered_at >= NOW() - INTERVAL '12 months'
               GROUP BY DATE_TRUNC('month', delivered_at) ORDER BY period DESC`;
    } else {
      query = `SELECT delivered_at::date as period, COUNT(*) as job_count, SUM(total_amount) as total,
               SUM(CASE WHEN payment_method='cash' THEN total_amount ELSE 0 END) as cash_total,
               SUM(CASE WHEN payment_method='card' THEN total_amount ELSE 0 END) as card_total
               FROM jobs WHERE paid = true AND delivered_at >= NOW() - INTERVAL '30 days'
               GROUP BY delivered_at::date ORDER BY period DESC`;
    }
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stats/popular-services", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT js.service_name, COUNT(*) as count, SUM(js.price) as total_revenue
      FROM job_services js JOIN jobs j ON js.job_id = j.id
      WHERE j.delivered_at >= NOW() - INTERVAL '30 days'
      GROUP BY js.service_name ORDER BY count DESC LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════
// USERS
// ═══════════════════════════════

app.get("/api/users", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, username, name, role, phone, active, created_at FROM users ORDER BY created_at");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/users", requireAdmin, async (req, res) => {
  try {
    const { username, password, name, role, phone } = req.body;
    if (!username || !password || !name) return res.status(400).json({ error: "Kullanıcı adı, şifre ve isim gerekli" });
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users (username, password_hash, name, role, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, name, role",
      [username, hash, name, role || "staff", phone]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Bu kullanıcı adı zaten mevcut" });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════
// SMS (placeholder)
// ═══════════════════════════════

app.post("/api/sms/send", requireAuth, async (req, res) => {
  try {
    const { job_id, phone, sms_type } = req.body;
    const templates = {
      welcome: "Merhaba! Aracınız teslim alınmıştır. İşlem tamamlandığında size bilgi vereceğiz.",
      ready: "Aracınızın işlemi tamamlanmıştır. Teslim almak için bekliyoruz.",
      appointment_reminder: "Hatırlatma: Yarın randevunuz bulunmaktadır.",
    };
    const message = templates[sms_type] || templates.welcome;
    await pool.query(
      "INSERT INTO sms_logs (job_id, phone, message, sms_type, status) VALUES ($1,$2,$3,$4,$5)",
      [job_id || null, phone, message, sms_type, "logged"]
    );
    if (job_id) {
      if (sms_type === "welcome") await pool.query("UPDATE jobs SET sms_welcome_sent = true WHERE id = $1", [job_id]);
      if (sms_type === "ready") await pool.query("UPDATE jobs SET sms_ready_sent = true WHERE id = $1", [job_id]);
    }
    // TODO: Gerçek SMS gönderimi (NetGSM/İletimerkezi API)
    res.json({ success: true, message: "SMS kaydedildi (test modu)" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════
// PAGES
// ═══════════════════════════════

app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.redirect("/dashboard");
});

const pages = ["login", "dashboard", "jobs", "appointments", "customers", "reports", "settings"];
pages.forEach((page) => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, "views", `${page}.html`));
  });
});

// ═══════════════════════════════
// START
// ═══════════════════════════════

app.listen(PORT, () => {
  console.log(`\n🚗 OpenProcess çalışıyor: http://localhost:${PORT}\n`);
});
