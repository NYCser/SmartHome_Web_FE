// js/notifications.js — Trang thông báo tổng quan
import {
    auth, db,
    onAuthStateChanged,
    collection, query, orderBy, limit, onSnapshot,
    doc, updateDoc, serverTimestamp, where, getDocs
} from "./firebase-config.js";

// ===== STATE =====
let allNotifications = [];
let currentUserId = null;
const PAGE_SIZE = 20;
let lastVisible = null;
let isLoadingMore = false;

// ===== ICON & COLOR HELPERS =====

// Chuẩn hoá type về lowercase để so sánh nhất quán
// Firebase có thể lưu "OTA_UPDATE", "ota_update", "ota", "system", v.v.
function normalizeType(raw) {
    if (!raw) return 'system';
    const t = raw.toLowerCase().replace(/[^a-z]/g, '_');
    // Map các alias về key chuẩn
    if (t.startsWith('ota'))        return 'ota';
    if (t === 'fire')               return 'fire';
    if (t === 'gas')                return 'gas';
    if (t === 'intrusion')          return 'intrusion';
    if (t === 'access')             return 'access';
    if (t === 'login')              return 'login';
    if (t === 'automation')         return 'automation';
    if (t === 'system')             return 'system';
    return t; // giữ nguyên nếu không khớp để hiển thị đúng
}

const TYPE_CONFIG = {
    fire:      { icon: 'fa-fire',         bg: 'danger',  label: 'Cháy',       color: '#e74c3c' },
    gas:       { icon: 'fa-burn',         bg: 'danger',  label: 'Gas',        color: '#e74c3c' },
    intrusion: { icon: 'fa-user-secret',  bg: 'warning', label: 'Xâm nhập',   color: '#f39c12' },
    access:    { icon: 'fa-door-open',    bg: 'success', label: 'Ra/Vào cửa', color: '#27ae60' },
    system:    { icon: 'fa-server',       bg: 'info',    label: 'Hệ thống',   color: '#2980b9' },
    login:     { icon: 'fa-sign-in-alt',  bg: 'info',    label: 'Đăng nhập',  color: '#8e44ad' },
    automation:{ icon: 'fa-robot',        bg: 'info',    label: 'Tự động',    color: '#16a085' },
    ota:       { icon: 'fa-download',     bg: 'info',    label: 'OTA Update', color: '#2E75B6' },
};

function getTypeConfig(rawType) {
    const key = normalizeType(rawType);
    return TYPE_CONFIG[key] || {
        icon: 'fa-info-circle',
        bg: 'info',
        label: rawType || 'Thông báo',
        color: '#666'
    };
}

function getTimeAgo(timestamp) {
    if (!timestamp) return '---';
    const now = Date.now();
    const past = timestamp.toDate ? timestamp.toDate().getTime() : new Date(timestamp).getTime();
    const diff = Math.floor((now - past) / 1000);
    if (diff < 60) return `${diff} giây trước`;
    if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} ngày trước`;
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getFullTime(timestamp) {
    if (!timestamp) return '---';
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ===== AUTH GUARD =====
document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, (user) => {
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        currentUserId = user.uid;
        const userEmailEl = document.getElementById('user-email');
        if (userEmailEl) userEmailEl.textContent = user.email;
        
        setupFullNotificationSystem();
        setupEventListeners();
    });
});

// ===== MAIN SETUP =====
function setupFullNotificationSystem() {
    const q = query(
        collection(db, 'system_alerts'),
        orderBy('timestamp', 'desc'),
        limit(100)
    );

    onSnapshot(q, (snapshot) => {
        allNotifications = snapshot.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
        }));
        updateStats();
        applyFilters();
    }, (error) => {
        console.error('Lỗi lắng nghe thông báo:', error);
        showErrorState('Không thể tải thông báo. Kiểm tra kết nối Firebase.');
    });
}

function setupEventListeners() {
    // Bộ lọc
    const filterType   = document.getElementById('filterType');
    const filterStatus = document.getElementById('filterStatus');
    const searchInput  = document.getElementById('searchInput');
    const clearFilter  = document.getElementById('clearFilter');
    const markAllBtn   = document.getElementById('markAllReadBtn');
    const logoutBtn    = document.getElementById('logout-btn');

    if (filterType)   filterType.addEventListener('change', applyFilters);
    if (filterStatus) filterStatus.addEventListener('change', applyFilters);
    if (searchInput)  searchInput.addEventListener('input', debounce(applyFilters, 300));

    if (clearFilter) {
        clearFilter.addEventListener('click', () => {
            if (filterType)   filterType.value = 'all';
            if (filterStatus) filterStatus.value = 'all';
            if (searchInput)  searchInput.value = '';
            applyFilters();
        });
    }

    if (markAllBtn) {
        markAllBtn.addEventListener('click', markAllAsRead);
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            auth.signOut().then(() => window.location.href = 'index.html');
        });
    }
}

// ===== FILTER & RENDER =====
function applyFilters() {
    const type   = document.getElementById('filterType')?.value   || 'all';
    const status = document.getElementById('filterStatus')?.value || 'all';
    const search = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();

    const filtered = allNotifications.filter(n => {
        // So sánh qua normalizeType để tránh lỗi do Firebase lưu "OTA_UPDATE" khác "ota"
        const matchType   = type === 'all' || normalizeType(n.type) === type;
        const matchStatus = status === 'all'
            || (status === 'unread' ? !n.isResolved : n.isResolved);
        const msgText  = (n.message  || '').toLowerCase();
        const typeText = (n.type     || '').toLowerCase();
        const locText  = (n.location || '').toLowerCase();
        const matchSearch = !search
            || msgText.includes(search)
            || typeText.includes(search)
            || locText.includes(search);
        return matchType && matchStatus && matchSearch;
    });

    renderFullList(filtered);
    updateFilterCount(filtered.length);
}

function renderFullList(data) {
    const container = document.getElementById('fullNotifyList');
    if (!container) return;

    if (data.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-bell-slash"></i>
                <h3>Không có thông báo</h3>
                <p>Không tìm thấy thông báo phù hợp với bộ lọc hiện tại.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = data.map(n => {
        const cfg      = getTypeConfig(n.type);
        const timeAgo  = getTimeAgo(n.timestamp);
        const fullTime = getFullTime(n.timestamp);
        const msgTitle = n.message ? n.message.split('|')[0].trim() : 'Thông báo hệ thống';
        const msgDetail = n.message || '';

        return `
        <div class="full-notify-item ${!n.isResolved ? 'unread' : ''}"
             data-id="${n.id}"
             onclick="handleNotifyClick('${n.id}', ${n.isResolved})">
            
            <div class="notify-icon-wrap ${cfg.bg}">
                <i class="fas ${cfg.icon}"></i>
            </div>
            
            <div class="notify-body">
                <div class="notify-row-top">
                    <span class="notify-type-badge ${cfg.bg}">${cfg.label}</span>
                    <span class="notify-time" title="${fullTime}">
                        <i class="fas fa-clock"></i> ${timeAgo}
                    </span>
                </div>

                <p class="notify-title">${msgTitle}</p>
                ${msgDetail !== msgTitle ? `<p class="notify-detail">${msgDetail}</p>` : ''}

                <div class="notify-meta">
                    ${n.location ? `<span><i class="fas fa-map-marker-alt"></i> ${n.location}</span>` : ''}
                    ${n.ip ? `<span><i class="fas fa-network-wired"></i> ${n.ip}</span>` : ''}
                    ${n.level ? `<span><i class="fas fa-exclamation-triangle"></i> ${n.level}</span>` : ''}
                    <span><i class="fas fa-calendar-alt"></i> ${fullTime}</span>
                </div>
            </div>

            <div class="notify-actions">
                ${!n.isResolved
                    ? `<button class="btn-mark-read" title="Đánh dấu đã đọc"
                         onclick="event.stopPropagation(); markSingleRead('${n.id}')">
                           <i class="fas fa-check"></i>
                       </button>`
                    : `<span class="resolved-badge"><i class="fas fa-check-double"></i> Đã đọc</span>`
                }
            </div>
        </div>
        `;
    }).join('');
}

// ===== STATS =====
function updateStats() {
    const total  = allNotifications.length;
    const unread = allNotifications.filter(n => !n.isResolved).length;
    // Dùng normalizeType để đếm đúng dù Firebase lưu "fire"/"FIRE"/v.v.
    const danger = allNotifications.filter(n => {
        const t = normalizeType(n.type);
        return t === 'fire' || t === 'gas' || t === 'intrusion';
    }).length;

    const elTotal  = document.getElementById('stat-total');
    const elUnread = document.getElementById('stat-unread');
    const elDanger = document.getElementById('stat-danger');

    if (elTotal)  elTotal.textContent  = total;
    if (elUnread) elUnread.textContent = unread;
    if (elDanger) elDanger.textContent = danger;
}

function updateFilterCount(count) {
    const el = document.getElementById('result-count');
    if (el) el.textContent = `${count} thông báo`;
}

// ===== MARK READ =====
window.handleNotifyClick = async function(id, isResolved) {
    if (!isResolved) {
        await markSingleRead(id);
    }
};

window.markSingleRead = async function(id) {
    try {
        await updateDoc(doc(db, 'system_alerts', id), {
            isResolved: true,
            resolvedAt: serverTimestamp(),
            resolvedBy: currentUserId || 'web'
        });
        // UI update ngay lập tức mà không cần đợi snapshot
        const item = document.querySelector(`.full-notify-item[data-id="${id}"]`);
        if (item) {
            item.classList.remove('unread');
            const btn = item.querySelector('.btn-mark-read');
            if (btn) btn.outerHTML = `<span class="resolved-badge"><i class="fas fa-check-double"></i> Đã đọc</span>`;
        }
    } catch (e) {
        console.error('Lỗi đánh dấu đã đọc:', e);
    }
};

async function markAllAsRead() {
    const unread = allNotifications.filter(n => !n.isResolved);
    if (unread.length === 0) {
        showToast('Không có thông báo nào chưa đọc.', 'info');
        return;
    }

    const btn = document.getElementById('markAllReadBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang xử lý...'; }

    try {
        // Batch update (Firestore không có writeBatch trong module ES, dùng Promise.all)
        await Promise.all(unread.map(n =>
            updateDoc(doc(db, 'system_alerts', n.id), {
                isResolved: true,
                resolvedAt: serverTimestamp(),
                resolvedBy: currentUserId || 'web'
            })
        ));
        showToast(`Đã đánh dấu ${unread.length} thông báo là đã đọc.`, 'success');
    } catch (e) {
        console.error('Lỗi đánh dấu tất cả:', e);
        showToast('Lỗi: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = 'Đánh dấu tất cả đã đọc'; }
    }
}

// ===== HELPERS =====
function showErrorState(msg) {
    const container = document.getElementById('fullNotifyList');
    if (container) {
        container.innerHTML = `
            <div class="empty-state error">
                <i class="fas fa-exclamation-circle"></i>
                <h3>Lỗi kết nối</h3>
                <p>${msg}</p>
            </div>
        `;
    }
}

function showToast(message, type = 'info') {
    const colors = { success: '#27ae60', error: '#e74c3c', info: '#2980b9' };
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 24px; right: 24px;
        background: ${colors[type] || colors.info}; color: #fff;
        padding: 12px 20px; border-radius: 10px; z-index: 9999;
        box-shadow: 0 4px 20px rgba(0,0,0,0.25); font-size: 0.9rem;
        display: flex; align-items: center; gap: 8px;
        animation: slideInToast 0.3s ease;
    `;
    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle' };
    toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3500);
}

function debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}