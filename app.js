// OpenProcess — Shared JS Utilities
async function api(url, options = {}) {
  const config = {
    headers: { "Content-Type": "application/json" },
    ...options,
  };
  if (config.body && typeof config.body === "object")
    config.body = JSON.stringify(config.body);
  const res = await fetch(url, config);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Bir hata oluştu");
  return data;
}

async function checkAuth() {
  try {
    const data = await api("/api/auth/me");
    return data.user;
  } catch {
    window.location.href = "/login";
    return null;
  }
}

function showToast(message, type = "info") {
  let c = document.querySelector(".toast-container");
  if (!c) {
    c = document.createElement("div");
    c.className = "toast-container";
    document.body.appendChild(c);
  }
  const icons = { success: "✓", error: "✕", info: "ℹ" };
  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span>${icons[type] || "ℹ"}</span> ${escapeHtml(message)}`;
  c.appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateX(100%)";
    t.style.transition = "all 300ms ease";
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

function openModal(id) {
  document.getElementById(id)?.classList.add("active");
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove("active");
}
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay"))
    e.target.classList.remove("active");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape")
    document
      .querySelectorAll(".modal-overlay.active")
      .forEach((m) => m.classList.remove("active"));
});

function initSidebar(activePage) {
  document.querySelectorAll(".nav-item").forEach((item) => {
    if (item.dataset.page === activePage) item.classList.add("active");
  });
  const menuBtn = document.querySelector(".mobile-menu-btn");
  const sidebar = document.querySelector(".sidebar");
  if (menuBtn && sidebar) {
    menuBtn.addEventListener("click", () => sidebar.classList.toggle("open"));
    document.addEventListener("click", (e) => {
      if (
        window.innerWidth <= 768 &&
        !sidebar.contains(e.target) &&
        !menuBtn.contains(e.target)
      )
        sidebar.classList.remove("open");
    });
  }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

function formatMoney(n) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n || 0);
}
function formatDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
function formatTime(d) {
  if (!d) return "-";
  return new Date(d).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function formatDateTime(d) {
  if (!d) return "-";
  return formatDate(d) + " " + formatTime(d);
}
function timeAgo(d) {
  if (!d) return "";
  const diff = Math.floor((new Date() - new Date(d)) / 60000);
  if (diff < 1) return "az önce";
  if (diff < 60) return `${diff} dk önce`;
  if (diff < 1440) return `${Math.floor(diff / 60)} saat önce`;
  return formatDate(d);
}
function escapeHtml(s) {
  if (!s) return "";
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
function statusText(s) {
  return (
    {
      waiting: "Bekliyor",
      in_progress: "İşlemde",
      completed: "Hazır",
      delivered: "Teslim Edildi",
      cancelled: "İptal",
    }[s] || s
  );
}
function statusBadge(s) {
  return `<span class="badge badge-${s.replace("_", "-")}"><span class="badge-dot"></span>${statusText(s)}</span>`;
}
function categoryLabel(c) {
  const n = {
    yikama: "Yıkama",
    detailing: "Detailing",
    ic_temizlik: "İç Temizlik",
    aksesuar: "Aksesuar",
    genel: "Genel",
  };
  return `<span class="category-label cat-${c}">${n[c] || c}</span>`;
}

function renderSidebar(user) {
  return `
    <div class="sidebar-header">
      <a href="/dashboard" class="sidebar-logo">
        <div class="logo-icon">🚗</div>
        <div><div class="logo-text">OpenProcess</div><div class="logo-sub">Oto Kuaför Sistemi</div></div>
      </a>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-section-label">Ana Menü</div>
      <a href="/dashboard" class="nav-item" data-page="dashboard"><span class="nav-icon">📊</span> Gösterge Paneli</a>
      <a href="/jobs" class="nav-item" data-page="jobs"><span class="nav-icon">🔧</span> İş Emirleri</a>
      <a href="/appointments" class="nav-item" data-page="appointments"><span class="nav-icon">📅</span> Randevular</a>
      <a href="/customers" class="nav-item" data-page="customers"><span class="nav-icon">👥</span> Müşteriler</a>
      <div class="nav-section-label">Yönetim</div>
      <a href="/reports" class="nav-item" data-page="reports"><span class="nav-icon">📈</span> Raporlar</a>
      <a href="/settings" class="nav-item" data-page="settings"><span class="nav-icon">⚙️</span> Ayarlar</a>
    </nav>
    <div class="sidebar-footer">
      <div class="user-info">
        <div class="user-avatar">${(user?.name || "?")[0].toUpperCase()}</div>
        <div><div class="user-name">${escapeHtml(user?.name)}</div><div class="user-role">${user?.role === "admin" ? "Yönetici" : "Personel"}</div></div>
      </div>
      <button class="btn btn-ghost btn-sm mt-8" style="width:100%" onclick="logout()">Çıkış Yap</button>
    </div>`;
}
