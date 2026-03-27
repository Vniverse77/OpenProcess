import pg from "pg";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({
  host: process.env.PG_HOST || "127.0.0.1",
  port: parseInt(process.env.PG_PORT || "5432"),
  database: process.env.PG_DATABASE || "openprocess_db",
  user: process.env.PG_USER || "openprocess",
  password: process.env.PG_PASSWORD || "",
});

async function initDB() {
  const client = await pool.connect();
  try {
    console.log("🗄️  Tablolar oluşturuluyor...\n");

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(20) DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
        phone VARCHAR(20),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        email VARCHAR(100),
        notes TEXT,
        total_visits INTEGER DEFAULT 0,
        total_spent NUMERIC(12,2) DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS vehicles (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        plate VARCHAR(20) NOT NULL,
        brand VARCHAR(50),
        model VARCHAR(50),
        color VARCHAR(30),
        year INTEGER,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(UPPER(plate));

      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        category VARCHAR(50) DEFAULT 'genel',
        price NUMERIC(10,2) NOT NULL,
        duration_minutes INTEGER DEFAULT 30,
        description TEXT,
        active BOOLEAN DEFAULT true,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER REFERENCES vehicles(id),
        customer_id INTEGER REFERENCES customers(id),
        status VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting','in_progress','completed','delivered','cancelled')),
        assigned_to INTEGER REFERENCES users(id),
        notes TEXT,
        total_amount NUMERIC(10,2) DEFAULT 0,
        payment_method VARCHAR(20) CHECK (payment_method IN ('cash','card','transfer','mixed')),
        paid BOOLEAN DEFAULT false,
        sms_welcome_sent BOOLEAN DEFAULT false,
        sms_ready_sent BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS job_services (
        id SERIAL PRIMARY KEY,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        service_id INTEGER REFERENCES services(id),
        service_name VARCHAR(100) NOT NULL,
        price NUMERIC(10,2) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id),
        vehicle_id INTEGER REFERENCES vehicles(id),
        appointment_date DATE NOT NULL,
        appointment_time TIME NOT NULL,
        service_notes TEXT,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','confirmed','completed','cancelled')),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sms_logs (
        id SERIAL PRIMARY KEY,
        job_id INTEGER REFERENCES jobs(id),
        phone VARCHAR(20) NOT NULL,
        message TEXT NOT NULL,
        sms_type VARCHAR(30),
        status VARCHAR(20) DEFAULT 'pending',
        sent_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "session" (
        "sid" VARCHAR NOT NULL COLLATE "default",
        "sess" JSON NOT NULL,
        "expire" TIMESTAMP(6) NOT NULL,
        PRIMARY KEY ("sid")
      );
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);

    console.log("✅ Tablolar oluşturuldu\n");

    // Admin
    const adminUser = process.env.ADMIN_USERNAME || "admin";
    const adminPass = process.env.ADMIN_PASSWORD || "admin123";
    const existing = await client.query("SELECT id FROM users WHERE username = $1", [adminUser]);

    if (existing.rows.length === 0) {
      const hash = await bcrypt.hash(adminPass, 12);
      await client.query(
        "INSERT INTO users (username, password_hash, name, role) VALUES ($1, $2, $3, $4)",
        [adminUser, hash, "Yönetici", "admin"]
      );
      console.log(`✅ Admin oluşturuldu: ${adminUser}`);
    } else {
      console.log("ℹ️  Admin zaten mevcut");
    }

    // Örnek hizmetler
    const svcCount = await client.query("SELECT COUNT(*) FROM services");
    if (parseInt(svcCount.rows[0].count) === 0) {
      const svcs = [
        ["İç Dış Yıkama", "yikama", 700, 60],
        ["Dış Yıkama", "yikama", 400, 30],
        ["İç Temizlik", "yikama", 500, 45],
        ["Premium İç Dış Yıkama", "yikama", 1000, 90],
        ["Motor Yıkama", "yikama", 500, 30],
        ["Pasta Cila", "detailing", 3000, 240],
        ["Seramik Kaplama", "detailing", 8000, 480],
        ["Boya Koruma", "detailing", 5000, 180],
        ["Far Temizliği", "detailing", 1500, 60],
        ["Koltuk Yıkama", "ic_temizlik", 2000, 120],
        ["Tavan Döşeme Temizliği", "ic_temizlik", 1500, 90],
        ["Torpido Bakımı", "ic_temizlik", 800, 45],
        ["Cam Filmi", "aksesuar", 3000, 120],
        ["Jant Temizliği", "detailing", 500, 30],
      ];
      for (let i = 0; i < svcs.length; i++) {
        const [name, cat, price, dur] = svcs[i];
        await client.query(
          "INSERT INTO services (name, category, price, duration_minutes, sort_order) VALUES ($1,$2,$3,$4,$5)",
          [name, cat, price, dur, i]
        );
      }
      console.log("✅ 14 örnek hizmet eklendi");
    }

    console.log("\n🎉 Veritabanı hazır!");
  } catch (err) {
    console.error("❌ Hata:", err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

initDB();
