import {
    auth,
    db,
    onAuthStateChanged,
    collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc, serverTimestamp
} from "./firebase-config.js";
import roomService from "./roomService.js";

// ===== DOM ELEMENTS =====
const roomsGrid = document.getElementById('roomsGrid');

// Modal Elements
const editRoomModal = document.getElementById('editRoomModal');
const editRoomForm = document.getElementById('editRoomForm');
const editRoomName = document.getElementById('editRoomName');
const cancelEditRoom = document.getElementById('cancelEditRoom');

// [NEW] Add Room Modal Elements
const addRoomModal = document.getElementById('addRoomModal');
const addRoomForm = document.getElementById('addRoomForm');
const addRoomBtn = document.getElementById('addRoomBtn');
const cancelAddRoom = document.getElementById('cancelAddRoom');
const closeAddRoomModal = document.getElementById('closeAddRoomModal');
const newRoomIdInput = document.getElementById('newRoomId');
const newRoomMqttPreview = document.getElementById('newRoomMqtt');
const newRoomDevicesList = document.getElementById('newRoomDevicesList');
const addDeviceRowBtn = document.getElementById('addDeviceRowBtn');
const deviceRowTemplate = document.getElementById('deviceRowTemplate');

// [NEW] Door Control Elements
const unlockDoorBtn = document.getElementById('unlockDoorBtn');
const lockDoorBtn = document.getElementById('lockDoorBtn');
const doorStatusBadge = document.getElementById('doorStatusBadge');
const doorLastAction = document.getElementById('doorLastAction');
const doorStatusIcon = document.getElementById('doorStatusIcon');
const doorStatusDisplay = document.getElementById('doorStatusDisplay');
const ENTRANCE_ROOM_ID = 'entrance_01';
const DOOR_DEVICE_ID = 'door_lock';

// Menu Elements
const hamburgerMenu = document.querySelector('.hamburger-menu');
const navMenu = document.querySelector('.nav-menu');
const navOverlay = document.querySelector('.nav-overlay');

// Notification Elements
const notifyBtn = document.querySelector('.notification-btn');
const notifyDropdown = document.querySelector('.notification-dropdown');
const notifyList = document.getElementById('notifyList');
const notifyBadge = document.getElementById('notifyBadge');
const markReadBtn = document.querySelector('.mark-read-btn');

// ===== GLOBAL STATE =====
let rooms = [];
let isInitialized = false;
let currentEditingRoomId = null;
let notifications = [];

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, (user) => {
        if (!user) {
            window.location.href = 'index.html';
        } else {
            console.log(' User logged in:', user.email);
            if (!isInitialized) {
                initializeApp();
            }
        }
    });
});

function initializeApp() {
    if (isInitialized) return;
    isInitialized = true;

    setupEventListeners();
    setupNotificationSystem();
    setupOtaListener();
    setupAddRoomModal();
    setupDoorControl();
    loadRooms();
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    // 1. Mobile Menu
    if (hamburgerMenu) hamburgerMenu.addEventListener('click', toggleMobileMenu);
    if (navOverlay) navOverlay.addEventListener('click', closeMobileMenu);

    // 2. Modal Edit Room
    if (editRoomForm) {
        editRoomForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newName = editRoomName.value.trim();
            if (newName && currentEditingRoomId) {
                await updateRoomName(currentEditingRoomId, newName);
                closeEditModal();
            }
        });
    }
    if (cancelEditRoom) cancelEditRoom.addEventListener('click', closeEditModal);
    document.querySelectorAll('.close').forEach(btn => btn.addEventListener('click', closeEditModal));
    window.addEventListener('click', (e) => { if (e.target === editRoomModal) closeEditModal(); });

    // 3. User Menu
    const userMenuBtn = document.querySelector('.user-menu');
    const dropdownMenu = document.querySelector('.dropdown-menu');
    if (userMenuBtn && dropdownMenu) {
        userMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownMenu.classList.toggle('active');
            if (notifyDropdown) notifyDropdown.classList.remove('active');
        });
        window.addEventListener('click', () => {
            if (dropdownMenu.classList.contains('active')) dropdownMenu.classList.remove('active');
        });
        dropdownMenu.addEventListener('click', (e) => e.stopPropagation());

        const logoutBtn = dropdownMenu.querySelector('.logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                roomService.unsubscribeAll();
                auth.signOut().then(() => window.location.href = 'index.html');
            });
        }
    }
}

// ===== NOTIFICATION SYSTEM =====
function setupNotificationSystem() {
    console.log("Đang lắng nghe thông báo...");
    const q = query(collection(db, 'system_alerts'), orderBy('timestamp', 'desc'), limit(20));

    onSnapshot(q, (snapshot) => {
        notifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderNotifications();
    }, (error) => console.error("Lỗi thông báo:", error));

    if (notifyBtn && notifyDropdown) {
        notifyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            notifyDropdown.classList.toggle('active');
            const userMenu = document.querySelector('.dropdown-menu');
            if (userMenu) userMenu.classList.remove('active');
        });
        notifyDropdown.addEventListener('click', (e) => e.stopPropagation());
        window.addEventListener('click', () => notifyDropdown.classList.remove('active'));
    }

    if (markReadBtn) {
        markReadBtn.addEventListener('click', async () => {
            const unreadDocs = notifications.filter(n => !n.isResolved);
            unreadDocs.forEach(async (notify) => {
                try {
                    await updateDoc(doc(db, 'system_alerts', notify.id), { isResolved: true });
                    // [SMART-MUTE] Gọi Pi REST API để tắt buzzer 3 phút
                    // Chỉ gọi với alert loại gas/fire (nguy hiểm thực sự)
                    if (notify.type === 'gas' || notify.type === 'fire') {
                        await _callSmartMute(notify);
                    }
                } catch (e) { }
            });
        });
    }
}

function renderNotifications() {
    if (!notifyList) return;
    notifyList.innerHTML = '';

    const unreadItems = notifications.filter(n => !n.isResolved);
    const unreadCount = unreadItems.length;
    const hasDanger = unreadItems.some(n => n.level === 'critical' || n.type === 'intrusion' || n.type === 'fire' || n.type === 'gas');

    if (notifyBadge) {
        if (unreadCount > 0) {
            notifyBadge.style.display = 'flex';
            notifyBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
            notifyBadge.classList.remove('badge-danger', 'badge-success');
            if (hasDanger) notifyBadge.classList.add('badge-danger');
            else notifyBadge.classList.add('badge-success');
        } else {
            notifyBadge.style.display = 'none';
        }
    }

    if (notifications.length === 0) {
        notifyList.innerHTML = '<div style="padding:20px;text-align:center;color:#888;font-size:0.9rem;">Chưa có thông báo nào</div>';
        return;
    }

    notifications.forEach(notify => {
        let iconClass = 'fa-info-circle';
        let bgClass = 'info';
        if (notify.type === 'fire') { iconClass = 'fa-fire'; bgClass = 'danger'; }
        else if (notify.type === 'gas') { iconClass = 'fa-burn'; bgClass = 'danger'; }
        else if (notify.type === 'intrusion') {
            // [FIX-ACCESS-LOG] Thẻ/vân tay không hợp lệ → báo động đỏ
            iconClass = 'fa-user-secret'; bgClass = 'danger';
        }
        else if (notify.type === 'access') {
            // [FIX-ACCESS-LOG] Mở cửa thành công → thông báo xanh
            iconClass = 'fa-door-open'; bgClass = 'success';
        }
        else if (notify.type === 'system') { iconClass = 'fa-server'; bgClass = 'success'; }

        const timeAgo = getTimeAgo(notify.timestamp);
        const item = document.createElement('div');
        item.className = `notify-item ${!notify.isResolved ? 'unread' : ''}`;

        item.addEventListener('click', async () => {
            if (!notify.isResolved) {
                try {
                    await updateDoc(doc(db, 'system_alerts', notify.id), { isResolved: true });
                    // [SMART-MUTE] Tắt buzzer 3 phút khi user click đánh dấu đã đọc
                    if (notify.type === 'gas' || notify.type === 'fire') {
                        await _callSmartMute(notify);
                    }
                } catch (e) { }
            }
        });

        item.innerHTML = `
            <div class="notify-icon ${bgClass}"><i class="fas ${iconClass}"></i></div>
            <div class="notify-text">
                <span class="notify-title">${notify.type === 'access' ? '🔓 MỞ CỬA THÀNH CÔNG' :
                notify.type === 'intrusion' ? '🚨 CẢNH BÁO XÂM NHẬP' :
                    notify.type === 'fire' ? '🔥 CẢNH BÁO CHÁY' :
                        notify.type === 'gas' ? '💨 CẢNH BÁO KHÍ GAS' :
                            notify.type.toUpperCase() + ' ALERT'
            }</span>
                <span class="notify-desc">${notify.message}</span>
                <span class="notify-time">${timeAgo}</span>
            </div>
            ${!notify.isResolved ? '<span style="width:8px;height:8px;background:var(--primary-color);border-radius:50%;margin-top:5px;"></span>' : ''}
        `;
        notifyList.appendChild(item);
    });
}

function getTimeAgo(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate();
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return "Vừa xong";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} phút trước`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} giờ trước`;
    return `${Math.floor(hours / 24)} ngày trước`;
}

/**
 * [SMART-MUTE] Gọi Pi REST API /api/alerts/{id}/resolve
 * để safety_watchdog tắt buzzer 3 phút, sau đó tự kêu lại nếu còn nguy hiểm.
 *
 * Pi API tìm alert theo SQLite ID (integer), nhưng Firestore dùng string doc ID.
 * → Notify payload có thể có trường `sqlite_id` nếu Pi sync ngược lại,
 *   hoặc fallback gửi action qua Firebase commands collection.
 */
async function _callSmartMute(notify) {
    try {
        // Cách 1: Gọi trực tiếp Pi REST API nếu có sqlite_id
        if (notify.sqlite_id) {
            const piBase = window.PI_API_BASE || 'http://10.42.0.1:5000';
            const token = sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || '';
            await fetch(`${piBase}/api/alerts/${notify.sqlite_id}/resolve`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            console.log(`[SMART-MUTE] Pi notified: alert ${notify.sqlite_id} resolved → buzzer off 3 min`);
            return;
        }
        // Cách 2: Gửi smart_mute command qua Firestore commands
        // (Pi CommandDispatcher nhận và publish "alert_commands" Redis)
        const { addDoc, collection: col } = await import('./firebase-config.js').catch(() => ({}));
        if (addDoc) {
            const { db: firestoreDb, serverTimestamp: ts } = await import('./firebase-config.js');
            await addDoc(col(firestoreDb, 'commands'), {
                action: 'smart_mute_alert',
                room: notify.room || notify.location || '',
                alert_type: notify.type || 'gas',
                status: 'pending',
                timestamp: ts(),
            });
            console.log(`[SMART-MUTE] Firestore command sent for room: ${notify.room}`);
        }
    } catch (e) {
        console.warn('[SMART-MUTE] Could not notify Pi:', e.message);
        // Không throw — UI vẫn mark as read thành công
    }
}

// ===== UI HELPER FUNCTIONS =====
function toggleMobileMenu() { hamburgerMenu.classList.toggle('active'); navMenu.classList.toggle('active'); navOverlay.classList.toggle('active'); document.body.style.overflow = navMenu.classList.contains('active') ? 'hidden' : ''; }
function closeMobileMenu() { hamburgerMenu.classList.remove('active'); navMenu.classList.remove('active'); navOverlay.classList.remove('active'); document.body.style.overflow = ''; }
function closeEditModal() { if (editRoomModal) { editRoomModal.style.display = 'none'; editRoomForm.reset(); } }

function openEditRoomModal(roomId) {
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;
    currentEditingRoomId = roomId;
    if (editRoomName) editRoomName.value = room.name;
    if (editRoomModal) editRoomModal.style.display = 'block';
}

async function updateRoomName(roomId, newName) {
    try { await roomService.updateRoom(roomId, { name: newName }); await loadRooms(); }
    catch (e) { alert('Lỗi cập nhật: ' + e.message); }
}

async function viewRoomDetails(roomId) {
    try {
        const roomData = await roomService.getRoomDetails(roomId);
        if (!roomData || !roomData.roomType) { alert('Lỗi: Phòng thiếu roomType'); return; }
        let page = 'dashboard.html';
        const type = roomData.roomType.toUpperCase();
        if (type === 'LIVING_ROOM') page = 'dashboard-livingroom.html';
        else if (type === 'BEDROOM') page = 'dashboard-bedroom.html';
        else if (type === 'KITCHEN') page = 'dashboard-kitchen.html';
        window.location.href = `${page}?room=${roomId}`;
    } catch (e) { console.error(e); }
}

// ===== CORE LOGIC (LOAD ROOMS) =====
async function loadRooms() {
    try {
        const roomsData = await roomService.getRoomsFresh();
        rooms = roomsData;
        await renderRooms();
    } catch (error) {
        console.error('Lỗi tải phòng:', error);
        if (roomsGrid) roomsGrid.innerHTML = `<p class="error-text">Lỗi kết nối: ${error.message}</p>`;
    }
}

async function renderRooms() {
    if (!roomsGrid) return;
    roomsGrid.innerHTML = '';

    if (rooms.length === 0) {
        showEmptyState();
        updateStats(0, 0);
        return;
    }

    let totalDevicesCount = 0;
    let activeDevicesCount = 0;

    const renderPromises = rooms.map(async (room) => {
        try {
            const devices = await roomService.getDevices(room.id);
            totalDevicesCount += devices.length;
            activeDevicesCount += devices.filter(d => d.isOn).length;
            roomsGrid.appendChild(createRoomCardElement(room, devices));
        } catch (error) {
            roomsGrid.appendChild(createRoomCardElement(room, []));
        }
    });

    await Promise.all(renderPromises);
    updateStats(totalDevicesCount, activeDevicesCount);
}

function showEmptyState() { roomsGrid.innerHTML = `<div class="empty-state"><div class="empty-icon"></div><h3>Chưa có phòng</h3></div>`; }

function createRoomCardElement(room, devices) {
    const roomCard = document.createElement('div');
    roomCard.className = 'room-card';
    roomCard.setAttribute('data-room-id', room.id);

    let bgClass = 'bg-default';
    if (room.roomType) {
        const type = room.roomType.toUpperCase();
        if (type === 'LIVING_ROOM') bgClass = 'bg-living-room';
        else if (type === 'BEDROOM') bgClass = 'bg-bedroom';
        else if (type === 'KITCHEN') bgClass = 'bg-kitchen';
    }

    roomCard.innerHTML = `
        <div class="room-header-cover ${bgClass}">
            <div class="room-header-content">
                <div><h3>${room.name}</h3><span class="device-count">${devices.length} thiết bị</span></div>
                <div class="room-header-actions" style="display:flex; gap:6px;">
                    <button class="btn-icon edit-room" title="Đổi tên"><i class="fas fa-pen"></i></button>
                    <button class="btn-icon delete-room" title="Xóa phòng" style="color:#e74c3c;"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        </div>
        <div class="room-body">
            <div class="device-list">${renderDevicesList(devices)}</div>
            <div class="room-footer"><button class="btn btn-outline view-room" style="width:100%">Xem Chi Tiết</button></div>
        </div>
    `;

    roomCard.querySelector('.edit-room').addEventListener('click', (e) => { e.stopPropagation(); openEditRoomModal(room.id); });
    roomCard.querySelector('.delete-room').addEventListener('click', (e) => { e.stopPropagation(); confirmDeleteRoom(room.id, room.name); });
    roomCard.querySelector('.view-room').addEventListener('click', () => viewRoomDetails(room.id));
    return roomCard;
}

// ===== [NEW] XÓA PHÒNG =====
async function confirmDeleteRoom(roomId, roomName) {
    const ok = confirm(
        `⚠️ XÓA PHÒNG "${roomName}" (${roomId})?\n\n` +
        `Thao tác này sẽ xóa toàn bộ thiết bị/cảm biến của phòng khỏi hệ thống quản lý.\n` +
        `Phần cứng ESP32 KHÔNG bị ảnh hưởng — nếu node vẫn hoạt động, phòng có thể tự` +
        ` xuất hiện lại khi có dữ liệu mới gửi lên.\n\nBạn có chắc chắn?`
    );
    if (!ok) return;

    try {
        await roomService.deleteRoom(roomId);
        await loadRooms();
    } catch (e) {
        alert('Lỗi xóa phòng: ' + e.message);
    }
}

// ===== [NEW] THÊM PHÒNG MỚI =====
function setupAddRoomModal() {
    if (addRoomBtn) {
        addRoomBtn.addEventListener('click', () => {
            if (addRoomForm) addRoomForm.reset();
            if (newRoomMqttPreview) newRoomMqttPreview.value = '';
            if (newRoomDevicesList) newRoomDevicesList.innerHTML = '';
            addDeviceRow(); // Mở modal sẵn 1 dòng thiết bị trống cho tiện
            if (addRoomModal) addRoomModal.style.display = 'block';
        });
    }

    const closeAdd = () => {
        if (addRoomModal) { addRoomModal.style.display = 'none'; addRoomForm.reset(); }
        if (newRoomDevicesList) newRoomDevicesList.innerHTML = '';
    };
    if (cancelAddRoom) cancelAddRoom.addEventListener('click', closeAdd);
    if (closeAddRoomModal) closeAddRoomModal.addEventListener('click', closeAdd);
    window.addEventListener('click', (e) => { if (e.target === addRoomModal) closeAdd(); });

    // Xem trước MQTT topic khi gõ mã phòng
    if (newRoomIdInput && newRoomMqttPreview) {
        newRoomIdInput.addEventListener('input', () => {
            const clean = newRoomIdInput.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
            newRoomMqttPreview.value = clean ? `home/${clean}/...` : '';
        });
    }

    // Nút "+ Thêm thiết bị" — thêm 1 dòng nhập mới
    if (addDeviceRowBtn) {
        addDeviceRowBtn.addEventListener('click', () => addDeviceRow());
    }

    if (addRoomForm) {
        addRoomForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const roomId = document.getElementById('newRoomId').value;
            const name = document.getElementById('newRoomName').value.trim();
            const roomType = document.getElementById('newRoomType').value;
            const submitBtn = addRoomForm.querySelector('button[type="submit"]');

            if (!roomId.trim() || !name) {
                alert('Vui lòng nhập đầy đủ Mã phòng và Tên hiển thị.');
                return;
            }

            const deviceEntries = collectDeviceRows();

            try {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Đang tạo...';

                const createdRoomId = await roomService.createRoom(roomId, { name, roomType });

                // Tạo song song các thiết bị đã khai báo (nếu có)
                if (deviceEntries.length > 0) {
                    await Promise.all(deviceEntries.map(dev => roomService.addDevice(createdRoomId, {
                        name: dev.name,
                        type: dev.type,
                        isOn: false,
                        status: 'offline'
                    })));
                }

                closeAdd();
                await loadRooms();
                alert(
                    `Đã tạo phòng "${name}"${deviceEntries.length > 0 ? ` cùng ${deviceEntries.length} thiết bị` : ''} thành công!\n\n` +
                    `Lưu ý: hãy đảm bảo firmware ESP32 của phòng này được cấu hình` +
                    ` room_id = "${createdRoomId}" để dữ liệu MQTT được đồng bộ đúng.`
                );
            } catch (err) {
                alert('Lỗi tạo phòng: ' + err.message);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Tạo phòng';
            }
        });
    }
}

// Thêm 1 dòng nhập thiết bị vào modal (clone từ <template>)
function addDeviceRow() {
    if (!deviceRowTemplate || !newRoomDevicesList) return;
    const fragment = deviceRowTemplate.content.cloneNode(true);
    const row = fragment.querySelector('.device-row');
    row.querySelector('.remove-device-row').addEventListener('click', () => row.remove());
    newRoomDevicesList.appendChild(row);
}

// Đọc toàn bộ dòng thiết bị đã nhập (bỏ qua dòng trống tên)
function collectDeviceRows() {
    if (!newRoomDevicesList) return [];
    const rows = Array.from(newRoomDevicesList.querySelectorAll('.device-row'));
    return rows
        .map(row => ({
            name: row.querySelector('.device-name-input').value.trim(),
            type: row.querySelector('.device-type-input').value
        }))
        .filter(dev => dev.name.length > 0);
}

// ===== [NEW] ĐIỀU KHIỂN CỬA (ENTRANCE) =====
// Quy ước: turn_on = mở khóa (relay kích hoạt), turn_off = khóa lại (trạng thái an toàn mặc định).
// Kiểm tra đúng chiều relay (fail-secure/fail-safe) trên phần cứng trước khi dùng thực tế.
function setupDoorControl() {
    if (unlockDoorBtn) {
        unlockDoorBtn.addEventListener('click', () => sendDoorCommand(true));
    }
    if (lockDoorBtn) {
        lockDoorBtn.addEventListener('click', () => sendDoorCommand(false));
    }

    // Lắng nghe trạng thái thực tế của khóa cửa (do Pi/ESP32 báo cáo ngược lại Firestore)
    const doorDeviceRef = doc(db, 'rooms', ENTRANCE_ROOM_ID, 'devices', DOOR_DEVICE_ID);
    onSnapshot(doorDeviceRef, (snap) => {
        if (!doorStatusBadge) return;
        if (!snap.exists()) {
            doorStatusBadge.textContent = 'Chưa có dữ liệu';
            doorStatusBadge.style.color = '#334155';
            if (doorStatusIcon) { doorStatusIcon.style.background = '#94a3b8'; doorStatusIcon.classList.remove('unlocked'); doorStatusIcon.innerHTML = '<i class="fas fa-question"></i>'; }
            if (doorStatusDisplay) doorStatusDisplay.style.background = '#f1f5f9';
            return;
        }
        const data = snap.data();
        if (data.isOn) {
            // Đang mở khóa — trạng thái cần chú ý, dùng màu xanh + hiệu ứng nhấp nháy
            doorStatusBadge.textContent = 'Đang Mở Khóa';
            doorStatusBadge.style.color = '#16a34a';
            if (doorStatusIcon) {
                doorStatusIcon.style.background = '#22c55e';
                doorStatusIcon.classList.add('unlocked');
                doorStatusIcon.innerHTML = '<i class="fas fa-unlock"></i>';
            }
            if (doorStatusDisplay) doorStatusDisplay.style.background = '#f0fdf4';
            if (unlockDoorBtn) unlockDoorBtn.disabled = true;
            if (lockDoorBtn) lockDoorBtn.disabled = false;
        } else {
            // Đã khóa — trạng thái an toàn mặc định
            doorStatusBadge.textContent = 'Đã Khóa';
            doorStatusBadge.style.color = '#dc2626';
            if (doorStatusIcon) {
                doorStatusIcon.style.background = '#ef4444';
                doorStatusIcon.classList.remove('unlocked');
                doorStatusIcon.innerHTML = '<i class="fas fa-lock"></i>';
            }
            if (doorStatusDisplay) doorStatusDisplay.style.background = '#fef2f2';
            if (unlockDoorBtn) unlockDoorBtn.disabled = false;
            if (lockDoorBtn) lockDoorBtn.disabled = true;
        }
        if (doorLastAction && data.updatedAt) {
            const t = data.updatedAt.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt);
            doorLastAction.textContent = `Cập nhật lúc: ${t.toLocaleString('vi-VN')}`;
        }
    }, (error) => {
        console.error('Lỗi lắng nghe trạng thái cửa:', error);
        if (doorStatusBadge) { doorStatusBadge.textContent = 'Lỗi kết nối'; doorStatusBadge.style.color = '#dc2626'; }
        if (doorStatusIcon) { doorStatusIcon.style.background = '#94a3b8'; doorStatusIcon.classList.remove('unlocked'); doorStatusIcon.innerHTML = '<i class="fas fa-exclamation-triangle"></i>'; }
    });
}

async function sendDoorCommand(unlock) {
    if (unlockDoorBtn) unlockDoorBtn.disabled = true;
    if (lockDoorBtn) lockDoorBtn.disabled = true;
    try {
        await roomService.sendDeviceCommand(ENTRANCE_ROOM_ID, DOOR_DEVICE_ID, unlock, 'lock');
        console.log(`[Door] Command sent: ${unlock ? 'UNLOCK' : 'LOCK'}`);
    } catch (e) {
        alert('Lỗi gửi lệnh điều khiển cửa: ' + e.message);
    } finally {
        if (unlockDoorBtn) unlockDoorBtn.disabled = false;
        if (lockDoorBtn) lockDoorBtn.disabled = false;
    }
}

function renderDevicesList(devices) {
    if (!devices || devices.length === 0) return `<div class="empty-devices"><p>Chưa có thiết bị</p></div>`;
    const displayDevices = devices.slice(0, 3);
    const remaining = devices.length - 3;
    let html = displayDevices.map(d => `
        <div class="device-item" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px dashed #eee;">
            <div class="device-info"><span class="device-name" style="font-weight:500;color:#333;">${d.name}</span></div>
            <div class="device-status"><span style="font-size:0.85rem;color:#666;background:#f1f2f6;padding:2px 8px;border-radius:12px;">${d.details || (d.isOn ? 'Đang bật' : 'Đã tắt')}</span></div>
        </div>
    `).join('');
    if (remaining > 0) html += `<div style="text-align:center;font-size:0.8rem;color:#888;margin-top:5px;">...và ${remaining} thiết bị khác</div>`;
    return html;
}

function updateStats(totalDevices = 0, activeDevices = 0) {
    const roomCountEl = document.getElementById('roomCount');
    const deviceCountEl = document.getElementById('deviceCount');
    const activeDeviceCountEl = document.getElementById('activeDeviceCount');
    if (roomCountEl) roomCountEl.textContent = rooms.length;
    if (deviceCountEl) deviceCountEl.textContent = totalDevices;
    if (activeDeviceCountEl) {
        if (activeDevices > 0) { activeDeviceCountEl.textContent = `${activeDevices} đang bật`; activeDeviceCountEl.style.color = 'var(--success-color)'; }
        else { activeDeviceCountEl.textContent = 'Không có'; activeDeviceCountEl.style.color = '#666'; }
    }
}

// ===== OTA UPDATE SYSTEM =====
function setupOtaListener() {
    const q = query(
        collection(db, 'ota_notices'),
        where('status', '==', 'pending'),
        orderBy('createdAt', 'desc'),
        limit(5)
    );

    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                const data = { id: change.doc.id, ...change.doc.data() };
                showOtaPopup(data);
            }
        });
    });
}

function showOtaPopup(notice) {
    // Xóa popup cũ nếu có
    const old = document.getElementById('ota-popup-overlay');
    if (old) old.remove();

    const roomNames = {
        'bedroom_01': 'Phòng Ngủ',
        'kitchen_01': 'Phòng Bếp',
        'living_room_01': 'Phòng Khách',
        'all': 'Tất cả phòng'
    };

    const overlay = document.createElement('div');
    overlay.id = 'ota-popup-overlay';
    overlay.style.cssText = `
        position:fixed; top:0; left:0; width:100%; height:100%;
        background:rgba(0,0,0,0.6); z-index:3000;
        display:flex; justify-content:center; align-items:center;
    `;

    overlay.innerHTML = `
        <div style="background:#fff; border-radius:16px; padding:32px;
                    max-width:420px; width:90%; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <div style="text-align:center; margin-bottom:20px;">
                <i class="fas fa-download" style="font-size:3rem; color:#2E75B6;"></i>
                <h2 style="color:#1F4E79; margin:12px 0 4px;">Cập nhật Firmware</h2>
                <p style="color:#666; font-size:0.9rem;">
                    ${roomNames[notice.room] || notice.room}
                </p>
            </div>
            <table style="width:100%; border-collapse:collapse; margin-bottom:16px;">
                <tr><td style="padding:6px 0; color:#888; width:40%;">Phiên bản cũ</td>
                    <td style="font-weight:500;">${notice.currentVersion || 'N/A'}</td></tr>
                <tr><td style="padding:6px 0; color:#888;">Phiên bản mới</td>
                    <td style="font-weight:500; color:#2E75B6;">${notice.version}</td></tr>
                <tr><td style="padding:6px 0; color:#888;">File</td>
                    <td style="font-size:0.85rem;">${notice.filename}</td></tr>
            </table>
            <div style="background:#FFF2CC; border-radius:8px; padding:12px;
                        margin-bottom:20px; font-size:0.9rem; color:#7D6608;">
                <b>Nội dung cập nhật:</b><br>${notice.releaseNotes || 'Không có mô tả'}
            </div>
            <div style="background:#FFF3CD; border-radius:8px; padding:10px;
                        margin-bottom:20px; font-size:0.85rem; color:#856404;">
                ⚠️ ESP32 sẽ tự động khởi động lại sau khi cập nhật (~30 giây).
            </div>
            <div style="display:flex; gap:12px;">
                <button id="ota-skip" style="flex:1; padding:12px; border:1px solid #ddd;
                        background:#f8f9fa; border-radius:8px; cursor:pointer;">
                    Bỏ qua
                </button>
                <button id="ota-confirm" style="flex:2; padding:12px;
                        background:#2E75B6; color:#fff; border:none;
                        border-radius:8px; cursor:pointer; font-weight:600;">
                    <i class="fas fa-upload"></i> Cập nhật ngay
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('ota-skip').onclick = () => {
        overlay.remove();
        // Không cập nhật Firestore — notice vẫn pending cho user khác xem
    };

    document.getElementById('ota-confirm').onclick = async () => {
        await confirmOta(notice.id);
        overlay.remove();
    };
}

async function confirmOta(noticeId) {
    try {
        const user = auth.currentUser;
        await updateDoc(doc(db, 'ota_notices', noticeId), {
            status: 'confirmed',
            confirmedBy: user ? user.email : 'unknown',
            confirmedAt: serverTimestamp()
        });
        showOtaStatusToast('Đã gửi lệnh cập nhật! ESP32 đang tải firmware...');
        watchOtaProgress(noticeId);
    } catch (e) {
        alert('Lỗi xác nhận OTA: ' + e.message);
    }
}

// Theo dõi progress sau khi user confirm
function watchOtaProgress(noticeId) {
    const unsub = onSnapshot(doc(db, 'ota_notices', noticeId), (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        switch (data.status) {
            case 'flashing':
                showOtaStatusToast(' ESP32 đang flash firmware...');
                break;
            case 'done':
                showOtaStatusToast(' Cập nhật thành công! v' + data.version);
                unsub(); // Ngừng lắng nghe
                break;
            case 'failed':
                showOtaStatusToast('Cập nhật thất bại: ' + (data.error || ''));
                unsub();
                break;
        }
    });
}

function showOtaStatusToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position:fixed; bottom:24px; right:24px;
        background:#1F4E79; color:#fff; padding:14px 20px;
        border-radius:10px; z-index:4000;
        box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        font-size: 0.95rem;
    `;
    toast.innerHTML = `<i class='fas fa-check-circle'></i> ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}