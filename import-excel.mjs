// OpenProcess — Excel Import Tool
// Kullanım: node import-excel.mjs dosya.xlsx
//
// Müşterinin mevcut Excel kayıtlarını OpenProcess veritabanına aktarır.
// Beklenen Excel kolonları:
//   Tarih | Plaka | Müşteri Adı | Telefon | Araç Marka | Araç Model | Renk | Yapılan İşlem | Ücret | Ödeme Şekli | Notlar

import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({
    host: process.env.PG_HOST || "127.0.0.1",
    port: parseInt(process.env.PG_PORT || "5432"),
    database: process.env.PG_DATABASE || "openprocess_db",
    user: process.env.PG_USER || "openprocess",
    password: process.env.PG_PASSWORD || "",
});

// Simple XLSX parser (reads shared strings + sheet data)
// For production: npm install xlsx
async function parseXlsx(filePath) {
    try {
        // Try using xlsx package if available
        const XLSX = (await import("xlsx")).default || (await import("xlsx"));
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        return rows;
    } catch {
        console.error(
            "❌ 'xlsx' paketi gerekli. Kurmak için: npm install xlsx",
        );
        process.exit(1);
    }
}

// Normalize column names (handle variations)
function findColumn(row, ...possibleNames) {
    for (const name of possibleNames) {
        for (const key of Object.keys(row)) {
            if (key.toLowerCase().includes(name.toLowerCase())) {
                return row[key];
            }
        }
    }
    return null;
}

async function importExcel(filePath) {
    console.log(`\n📊 Excel dosyası okunuyor: ${filePath}\n`);

    const rows = await parseXlsx(filePath);
    console.log(`   ${rows.length} satır bulundu\n`);

    if (rows.length === 0) {
        console.log("❌ Excel dosyası boş veya okunamadı");
        return;
    }

    // Show detected columns
    console.log("📋 Algılanan kolonlar:", Object.keys(rows[0]).join(", "));
    console.log("");

    const client = await pool.connect();
    let imported = 0;
    let skipped = 0;
    const customerCache = new Map(); // phone -> customer_id
    const vehicleCache = new Map(); // plate -> vehicle_id

    try {
        await client.query("BEGIN");

        for (const row of rows) {
            const plate = findColumn(row, "plaka", "plate");
            const customerName = findColumn(
                row,
                "müşteri",
                "musteri",
                "ad",
                "isim",
                "customer",
            );
            const phone = findColumn(
                row,
                "telefon",
                "tel",
                "phone",
                "gsm",
                "cep",
            );
            const brand = findColumn(row, "marka", "brand");
            const model = findColumn(row, "model");
            const color = findColumn(row, "renk", "color");
            const service = findColumn(
                row,
                "işlem",
                "islem",
                "hizmet",
                "service",
                "yapılan",
            );
            const price = findColumn(
                row,
                "ücret",
                "ucret",
                "fiyat",
                "tutar",
                "price",
                "₺",
            );
            const payment = findColumn(row, "ödeme", "odeme", "payment");
            const notes = findColumn(row, "not", "notes", "açıklama");
            const dateVal = findColumn(row, "tarih", "date");

            // Skip rows without plate
            if (
                !plate ||
                String(plate).trim() === "" ||
                String(plate).includes("TOPLAM")
            ) {
                skipped++;
                continue;
            }

            const cleanPlate = String(plate).replace(/\s/g, "").toUpperCase();
            const cleanPhone = String(phone || "").replace(/\D/g, "");
            const cleanName = String(customerName || "Bilinmeyen").trim();
            const cleanPrice =
                parseFloat(
                    String(price || "0")
                        .replace(/[^\d.,]/g, "")
                        .replace(",", "."),
                ) || 0;

            // Payment method mapping
            let paymentMethod = "cash";
            const payStr = String(payment || "").toLowerCase();
            if (
                payStr.includes("kart") ||
                payStr.includes("kredi") ||
                payStr.includes("card")
            )
                paymentMethod = "card";
            else if (
                payStr.includes("havale") ||
                payStr.includes("eft") ||
                payStr.includes("transfer")
            )
                paymentMethod = "transfer";

            // Parse date
            let jobDate;
            if (dateVal instanceof Date) {
                jobDate = dateVal;
            } else if (typeof dateVal === "number") {
                // Excel serial date
                jobDate = new Date((dateVal - 25569) * 86400 * 1000);
            } else {
                const dStr = String(dateVal || "");
                // Try DD.MM.YYYY format
                const parts = dStr.split(/[.\/\-]/);
                if (parts.length === 3) {
                    const [d, m, y] = parts;
                    jobDate = new Date(
                        parseInt(y),
                        parseInt(m) - 1,
                        parseInt(d),
                    );
                } else {
                    jobDate = new Date(dStr);
                }
            }
            if (isNaN(jobDate?.getTime())) jobDate = new Date();

            // 1. Find or create customer
            let customerId = customerCache.get(cleanPhone || cleanName);
            if (!customerId) {
                const existingCust = cleanPhone
                    ? await client.query(
                          "SELECT id FROM customers WHERE phone = $1 LIMIT 1",
                          [cleanPhone],
                      )
                    : await client.query(
                          "SELECT id FROM customers WHERE name = $1 LIMIT 1",
                          [cleanName],
                      );

                if (existingCust.rows.length > 0) {
                    customerId = existingCust.rows[0].id;
                } else {
                    const newCust = await client.query(
                        "INSERT INTO customers (name, phone) VALUES ($1, $2) RETURNING id",
                        [cleanName, cleanPhone || "0000000000"],
                    );
                    customerId = newCust.rows[0].id;
                }
                customerCache.set(cleanPhone || cleanName, customerId);
            }

            // 2. Find or create vehicle
            let vehicleId = vehicleCache.get(cleanPlate);
            if (!vehicleId) {
                const existingVeh = await client.query(
                    "SELECT id FROM vehicles WHERE UPPER(REPLACE(plate, ' ', '')) = $1 LIMIT 1",
                    [cleanPlate],
                );

                if (existingVeh.rows.length > 0) {
                    vehicleId = existingVeh.rows[0].id;
                } else {
                    const newVeh = await client.query(
                        "INSERT INTO vehicles (customer_id, plate, brand, model, color) VALUES ($1, $2, $3, $4, $5) RETURNING id",
                        [
                            customerId,
                            cleanPlate,
                            brand || null,
                            model || null,
                            color || null,
                        ],
                    );
                    vehicleId = newVeh.rows[0].id;
                }
                vehicleCache.set(cleanPlate, vehicleId);
            }

            // 3. Create job (as delivered/completed)
            const jobResult = await client.query(
                `INSERT INTO jobs (vehicle_id, customer_id, status, total_amount, payment_method, paid, notes, created_at, delivered_at)
         VALUES ($1, $2, 'delivered', $3, $4, true, $5, $6, $6) RETURNING id`,
                [
                    vehicleId,
                    customerId,
                    cleanPrice,
                    paymentMethod,
                    notes || null,
                    jobDate.toISOString(),
                ],
            );

            // 4. Create job service entry
            const serviceName = String(service || "Genel Hizmet").trim();
            await client.query(
                "INSERT INTO job_services (job_id, service_name, price) VALUES ($1, $2, $3)",
                [jobResult.rows[0].id, serviceName, cleanPrice],
            );

            // 5. Update customer stats
            await client.query(
                "UPDATE customers SET total_visits = total_visits + 1, total_spent = total_spent + $1 WHERE id = $2",
                [cleanPrice, customerId],
            );

            imported++;
        }

        await client.query("COMMIT");

        console.log("═══════════════════════════════════════");
        console.log(`✅ Import tamamlandı!`);
        console.log(`   📥 Aktarılan: ${imported} kayıt`);
        console.log(`   ⏭️  Atlanan:   ${skipped} satır`);
        console.log(`   👥 Müşteri:   ${customerCache.size} benzersiz müşteri`);
        console.log(`   🚗 Araç:     ${vehicleCache.size} benzersiz araç`);
        console.log("═══════════════════════════════════════\n");
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Import hatası:", err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

// Run
const filePath = process.argv[2];
if (!filePath) {
    console.log("\n📖 Kullanım: node import-excel.mjs <excel_dosyasi.xlsx>\n");
    console.log("Örnek: node import-excel.mjs musteri_kayitlari.xlsx\n");
    process.exit(1);
}

importExcel(filePath);
