# OpenProcess

Açık kaynak oto kuaför & detailing yönetim sistemi.  
Aylık abonelik yok — kurun, kullanın.

## Özellikler

- 🚗 Plaka ile araç kayıt & müşteri sorgulama
- 📱 SMS bildirimleri (araç teslim & hazır)
- 📋 İş emri yönetimi (kanban board)
- 📅 Randevu sistemi
- 💰 Kasa & ödeme takibi (nakit/kart/havale)
- 📊 Gelir raporları & popüler hizmet analizi
- 👥 Personel yönetimi (admin/staff rolleri)
- 🔧 Hizmet & fiyat yönetimi

## Kurulum

```bash
# 1. Veritabanı
sudo -u postgres psql
CREATE USER openprocess WITH PASSWORD 'sifre123';
CREATE DATABASE openprocess_db OWNER openprocess;
\q

# 2. Proje
git clone https://github.com/vniverse77/OpenProcess.git
cd OpenProcess
cp .env.example .env   # düzenle
npm install
node db-init.mjs
npm start
```

**Giriş:** http://localhost:3000 — admin / admin123

## Tech Stack

Node.js + Express.js + PostgreSQL + Vanilla JS

## Lisans

MIT
