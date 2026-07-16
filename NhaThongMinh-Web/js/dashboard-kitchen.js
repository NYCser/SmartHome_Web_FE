// js/dashboard-kitchen.js

import {
    auth, db, onAuthStateChanged, collection, doc, setDoc, getDoc,
    updateDoc, deleteDoc, query, where, getDocs, serverTimestamp,
    orderBy, limit, onSnapshot,
    rtdb, rtdbRef, onValue, off, rtdbGet
} from "./firebase-config.js";
import roomService from './roomService.js'; // FIX: đảm bảo import trước khi dùng

// ===== 1. BIẾN TOÀN CỤC =====
let currentRoomId = null;
let currentUserId = null;
let automationData = null;
let scheduleData = null;

let dynamicDeviceMap = {};
let deviceStatus = {};

// Biến biểu đồ Dashboard
let tempHumChart = null; // Biểu đồ Kép (Nhiệt + Ẩm)
let gasChart = null;     // Biểu đồ Gas (ppm)

// Biến biểu đồ Modal
let modalChartInstance = null;

let chartUpdateInterval = null;
let dayCheckInterval = null;
let currentChartDate = null;

// ===== CẤU HÌNH MÀU SẮC BIỂU ĐỒ (THỐNG NHẤT) =====
const CHART_COLORS = {
    temp: { border: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)' }, // Đỏ
    hum: { border: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' }, // Xanh dương
    gas: { border: '#f97316', bg: 'rgba(249, 115, 22, 0.1)' }  // Cam
};

// ===== 2. CÁC PHẦN TỬ DOM =====
const automationForm = document.getElementById('automationForm');
const scheduleForm = document.getElementById('scheduleForm');
const deviceListContainer = document.getElementById('device-list-container');
const scheduleSelect1 = document.getElementById('scheduleDevice1');
const scheduleTimeInput = document.getElementById('scheduleTime1'); // Tham chiếu ô nhập giờ

// ===== 3. CẤU HÌNH UI (NHÀ BẾP) =====
const deviceIcons = {
    'light': 'fa-lightbulb',     // Đèn
    'fan': 'fa-fan',             // Quạt hút mùi
    'valve': 'fa-ban',           // Van Gas (Khóa)
    'alarm': 'fa-bell',          // Còi báo
    'default': 'fa-power-off'
};

const deviceTypeNames = {
    'light': 'Đèn bếp',
    'fan': 'Quạt hút',
    'valve': 'Van Gas',
    'alarm': 'Còi báo'
};

// ===== 4. KHỞI TẠO =====
document.addEventListener('DOMContentLoaded', function () {
    const urlParams = new URLSearchParams(window.location.search);
    currentRoomId = urlParams.get('room');
    if (!currentRoomId) { window.location.href = 'admin.html'; return; }
    initializeApp();
});

onAuthStateChanged(auth, (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentUserId = user.uid;
    // FIX: guard currentRoomId trước khi load data
    if (currentRoomId) {
        runSystemDebugCheck();
        loadAllData();
    }
});

function initializeApp() {
    setupEventListeners();
    setupRealTimeListeners();
}

function setupEventListeners() {
    if (automationForm) automationForm.addEventListener('submit', saveAutomationSettings);
    if (scheduleForm) scheduleForm.addEventListener('submit', saveScheduleSettings);

    // Sự kiện khi thay đổi thiết bị trong dropdown hẹn giờ
    if (scheduleSelect1) {
        scheduleSelect1.addEventListener('change', (e) => {
            loadScheduleSettings(e.target.value);
        });
    }

    if (deviceListContainer) {
        deviceListContainer.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox' && e.target.dataset.deviceId) {
                handleDeviceToggle(e);
            }
        });
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            cleanup();
            auth.signOut().then(() => window.location.href = 'index.html');
        });
    }
}

// ===== 5. TẢI DỮ LIỆU =====
async function loadAllData() {
    try {
        await loadAndRenderDevices();
        renderAutomationUI();
        await Promise.all([
            loadAutomationSettings(),
            loadScheduleSettings(), // Tải lịch cho thiết bị đang chọn
            loadSensorData()
        ]);
        initializeChartsWithRealData();
    } catch (error) { console.error('Lỗi tải dữ liệu:', error); }
}

async function loadAndRenderDevices() {
    try {
        const devices = await roomService.getDevices(currentRoomId);
        dynamicDeviceMap = {}; deviceStatus = {};

        const items = deviceListContainer.querySelectorAll('.device-control');
        items.forEach(i => i.remove());

        if (scheduleSelect1) {
            while (scheduleSelect1.options.length > 1) scheduleSelect1.remove(1);
        }

        devices.forEach(device => {
            deviceStatus[device.id] = device.isOn;
            if (device.type) dynamicDeviceMap[device.type] = device.id;

            const displayName = generateDeviceName(device);
            const iconClass = deviceIcons[device.type] || deviceIcons['default'];

            const li = document.createElement('li');
            li.className = 'device-control';
            li.innerHTML = `
                <i class="fas ${iconClass}"></i> <span>${displayName}</span>
                <label class="switch">
                    <input type="checkbox" 
                        data-device-id="${device.id}" 
                        data-device-type="${device.type}"
                        ${device.isOn ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            `;
            deviceListContainer.appendChild(li);

            if (scheduleSelect1) {
                const option = new Option(displayName, device.id);
                scheduleSelect1.add(option);
            }
        });
    } catch (error) { console.error('Lỗi render thiết bị:', error); }
}

function generateDeviceName(device) {
    if (device.name) return device.name;
    const typeName = deviceTypeNames[device.type] || 'Thiết bị';
    const parts = device.id.split('_');
    return !isNaN(parts[parts.length - 1]) ? `${typeName} ${parts[parts.length - 1]}` : typeName;
}

// ===== 6. ĐIỀU KHIỂN THIẾT BỊ =====
async function handleDeviceToggle(e) {
    const deviceId = e.target.dataset.deviceId;
    const deviceType = e.target.dataset.deviceType;
    const isOn = e.target.checked;

    // Optimistic UI update
    deviceStatus[deviceId] = isOn;

    try {
        // Gửi lệnh tới Pi qua /commands — KHÔNG ghi trực tiếp vào devices
        await roomService.sendDeviceCommand(currentRoomId, deviceId, isOn, deviceType);
        const name = generateDeviceName({ id: deviceId, type: deviceType });
        showNotification(`Lệnh đã gửi: ${name} ${isOn ? 'bật' : 'tắt'}`, 'success');
        // Trạng thái thật sẽ cập nhật khi Pi phản hồi (monitorDeviceStateForSchedules)
    } catch (error) {
        console.error('Lỗi gửi lệnh:', error);
        e.target.checked = !isOn;
        deviceStatus[deviceId] = !isOn;
        showNotification('Không thể gửi lệnh!', 'error');
    }
}

// ===== 7. HẸN GIỜ (SCHEDULE) - CẬP NHẬT ĐA LỊCH HẸN =====
async function loadScheduleSettings(selectedDeviceId = null) {
    const deviceId = selectedDeviceId || (scheduleSelect1 ? scheduleSelect1.value : 'none');

    if (deviceId === 'none') {
        if (scheduleTimeInput) scheduleTimeInput.value = '';
        return;
    }

    try {
        // [FIX-SCHEDULE] Query theo roomId+deviceId thay vì dùng 1 doc ID cố định
        // Vì giờ có thể có nhiều schedule (turn_on + turn_off) cho cùng 1 device
        const q = query(
            collection(db, 'schedules'),
            where('roomId', '==', currentRoomId),
            where('deviceId', '==', deviceId)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
            // Lấy schedule đầu tiên (ưu tiên turn_off)
            const docs = snap.docs.map(d => d.data()).sort(a => a.action === 'turn_off' ? -1 : 1);
            const data = docs[0];
            if (scheduleTimeInput) scheduleTimeInput.value = data.time || '';
            // Nếu có select action, set giá trị
            const actionSel = document.getElementById('scheduleAction1');
            if (actionSel) actionSel.value = data.action || 'turn_off';
        } else {
            if (scheduleTimeInput) scheduleTimeInput.value = '';
        }
    } catch (error) { console.error('Lỗi tải lịch hẹn:', error); }
}

async function saveScheduleSettings(e) {
    e.preventDefault();
    const deviceId = scheduleSelect1.value;
    const time = scheduleTimeInput.value;
    // [FIX-SCHEDULE] Đọc action từ select (turn_on / turn_off) nếu có, mặc định turn_off
    const actionSelect = document.getElementById('scheduleAction1');
    const scheduleAction = actionSelect ? actionSelect.value : 'turn_off';

    if (deviceId === 'none' || !time) {
        showNotification('Vui lòng chọn thiết bị và giờ!', 'warning');
        return;
    }

    try {
        // [FIX-SCHEDULE] Dùng time trong schedule ID để cho phép nhiều lịch/device
        const scheduleId = `${currentUserId}_${currentRoomId}_${deviceId}_${scheduleAction}`;
        const scheduleRef = doc(db, 'schedules', scheduleId);

        const newSchedule = {
            userId: currentUserId,
            roomId: currentRoomId,
            deviceId: deviceId,
            // [FIX] snake_case aliases để firebase_sync.py → SQLite đọc đúng
            room_id: currentRoomId,
            device_id: deviceId,
            time: time,
            action: scheduleAction,   // [FIX] Dùng action từ UI thay vì hardcode 'turn_on'
            enabled: true,
            createdAt: serverTimestamp()
        };

        await setDoc(scheduleRef, newSchedule);
        const actionLabel = scheduleAction === 'turn_on' ? 'BẬT' : 'TẮT';
        showNotification(`Đã lưu lịch ${actionLabel} lúc ${time}!`, 'success');
    } catch (error) { console.error(error); showNotification('Lỗi lưu lịch!', 'error'); }
}

// ===== 8. CẢM BIẾN =====
function updateSensorDisplay(sensorType, value, lastUpdateTimestamp) {
    let id = '';
    if (sensorType === 'temperature') id = 'temp';
    else if (sensorType === 'humidity') id = 'humidity';
    else if (sensorType === 'gas') id = 'gas';
    else return;

    const valueElement = document.getElementById(`current-${id}-value`);
    if (!valueElement) return;

    let displayValue = '--';
    let isFresh = false;

    if (value !== undefined && value !== null && lastUpdateTimestamp) {
        try {
            const lastUpdate = lastUpdateTimestamp.toDate();
            const now = new Date();
            const isToday = lastUpdate.getDate() === now.getDate() &&
                lastUpdate.getMonth() === now.getMonth() &&
                lastUpdate.getFullYear() === now.getFullYear();

            if (isToday) {
                displayValue = (sensorType === 'gas') ? Math.round(value) : parseFloat(value).toFixed(1);
                isFresh = true;
            }
        } catch (e) { console.error("Lỗi xử lý ngày tháng:", e); }
    }

    valueElement.textContent = displayValue;
    const card = valueElement.closest('.current-sensor-card');
    if (card) { card.style.opacity = isFresh ? '1' : '0.6'; }
}

// ── Sensor data helpers ──────────────────────────────────
// RTDB trả về {value, ts (ms epoch), iso} per sensor type.
// FIX: Chuẩn hoá timestamp về seconds (10 chữ số), xử lý cả ms (13 chữ số)
function _rtdbTsToTimestamp(ts) {
    if (!ts || ts === 0) return null;
    const tsSeconds = ts > 1e11 ? Math.floor(ts / 1000) : ts;
    return { toDate: () => new Date(tsSeconds * 1000) };
}

// FIX: Kiểm tra dữ liệu cảm biến hợp lệ — lọc dirty data từ RTDB
function _isSensorDataValid(data) {
    if (!data || data.value === null || data.value === undefined) return false;
    if (data.value === 0 && (!data.ts || data.ts === 0)) return false;
    if (data.ts && data.ts < 1577836800 && data.ts > 1e6) return false;
    return true;
}

async function loadSensorData() {
    // Lần đầu: lấy snapshot từ RTDB (1 lần, không realtime)
    try {
        const roomRef = rtdbRef(rtdb, `live/${currentRoomId}/sensors`);
        const snapshot = await rtdbGet(roomRef);
        if (snapshot.exists()) {
            const sensors = snapshot.val();
            Object.entries(sensors).forEach(([type, data]) => {
                // FIX: validate trước khi update UI
                if (_isSensorDataValid(data)) {
                    updateSensorDisplay(type, data.value, _rtdbTsToTimestamp(data.ts));
                }
            });
        } else {
            ['temperature', 'humidity', 'gas'].forEach(t => updateSensorDisplay(t, null, null));
        }
    } catch (error) {
        console.error('Lỗi tải cảm biến ban đầu:', error);
        ['temperature', 'humidity', 'gas'].forEach(t => updateSensorDisplay(t, null, null));
    }
}

// Giữ reference listener để cleanup
let _sensorRtdbRef = null;
let _sensorRtdbUnsubscribe = null;

// ===== 9. LISTENERS =====
function setupRealTimeListeners() {
    monitorDeviceStateForSchedules();
    setupSensorListener();

    dayCheckInterval = setInterval(() => { if (shouldResetChartsForNewDay()) resetChartsForNewDay(); }, 60000);
    chartUpdateInterval = setInterval(() => updateChartsWithLatestData().catch(() => { }), 30000);

    setupChartDataListener();
}

function setupSensorListener() {
    // Hủy listener cũ nếu có (tránh leak khi re-init)
    if (_sensorRtdbRef && _sensorRtdbUnsubscribe) {
        off(_sensorRtdbRef, 'value', _sensorRtdbUnsubscribe);
    }

    // Lắng nghe RTDB live/{room_id}/sensors — sub-second latency
    _sensorRtdbRef = rtdbRef(rtdb, `live/${currentRoomId}/sensors`);
    _sensorRtdbUnsubscribe = onValue(_sensorRtdbRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const sensors = snapshot.val();
        // FIX: validate từng sensor — bỏ qua dirty data (value=0, ts=0)
        Object.entries(sensors).forEach(([type, data]) => {
            if (_isSensorDataValid(data)) {
                updateSensorDisplay(type, data.value, _rtdbTsToTimestamp(data.ts));
            }
        });
    }, (error) => {
        console.error('RTDB sensor listener error:', error);
        // Fallback về Firestore nếu RTDB fail
        _fallbackToFirestoreSensor();
    });
}

function _fallbackToFirestoreSensor() {
    console.warn('Fallback: đọc sensor từ Firestore thay RTDB');
    const q = query(collection(db, 'rooms', currentRoomId, 'sensors'));
    onSnapshot(q, (snap) => {
        snap.docChanges().forEach(c => {
            const s = c.doc.data();
            if (c.type !== 'removed') updateSensorDisplay(s.type, s.value, s.lastUpdate);
        });
    });
}

function monitorDeviceStateForSchedules() {
    const q = query(collection(db, 'rooms', currentRoomId, 'devices'));
    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            const device = change.doc.data();
            const deviceId = change.doc.id;

            const toggle = document.querySelector(`input[data-device-id="${deviceId}"]`);
            if (toggle) toggle.checked = device.isOn;
            deviceStatus[deviceId] = device.isOn;

            /*if (change.type === 'modified' && device.isOn === false) {
                await checkAndDeleteScheduleForDevice(deviceId);
            }*/
        });
    });
}

async function checkAndDeleteScheduleForDevice(deviceId) {
    try {
        const scheduleId = `${currentUserId}_${currentRoomId}_${deviceId}`;
        const scheduleRef = doc(db, 'schedules', scheduleId);
        const snap = await getDoc(scheduleRef);

        if (snap.exists()) {
            await deleteDoc(scheduleRef);
            if (scheduleSelect1 && scheduleSelect1.value === deviceId) {
                if (scheduleTimeInput) scheduleTimeInput.value = '';
            }
            showNotification('Lịch hẹn đã hoàn tất', 'info');
        }
    } catch (error) { console.error('Lỗi xóa lịch:', error); }
}

// ===== 10. BIỂU ĐỒ (DASHBOARD + MODAL) =====
function shouldResetChartsForNewDay() { const t = new Date().toDateString(); if (currentChartDate !== t) return true; return false; }

function resetChartsForNewDay() {
    if (tempHumChart) tempHumChart.destroy();
    if (gasChart) gasChart.destroy();
    hideNoDataMessage(); hideChartLoadingState();
    currentChartDate = new Date().toDateString();
    showChartLoadingState();
}

function getStartOfDay() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }

async function initializeChartsWithRealData() {
    try {
        currentChartDate = new Date().toDateString();
        showChartLoadingState();
        await updateChartsWithLatestData();
        hideChartLoadingState();
    } catch (e) { hideChartLoadingState(); showNoDataMessage(); }
}

// Hàm vẽ biểu đồ Dashboard chính - Chỉ lấy 15 phút gần nhất
async function updateChartsWithLatestData() {
    if (shouldResetChartsForNewDay()) resetChartsForNewDay();

    // FIX: Lấy từ đầu ngày, không chỉ 15 phút
    // FIX SCHEMA v2.4: backend gộp reading theo phút, field mốc thời gian ở
    // cấp document là "updatedAt" (ArrayUnion readings[]), không còn "timestamp" phẳng.
    const startOfDay = getStartOfDay();
    const q = query(
        collection(db, 'sensor_readings'),
        where('roomId', '==', currentRoomId),
        where('updatedAt', '>=', startOfDay),
        orderBy('updatedAt', 'desc'),
        limit(500)
    );
    const snap = await getDocs(q);
    if (snap.empty) {
        // FIX: Fallback RTDB nếu Firestore chưa có data
        try {
            const rtdbSnap = await rtdbGet(rtdbRef(rtdb, `live/${currentRoomId}/sensors`));
            if (rtdbSnap.exists()) {
                const sensors = rtdbSnap.val();
                const timeLabel = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                const temp = sensors.temperature?.value != null ? [parseFloat(sensors.temperature.value.toFixed(1))] : [];
                const hum = sensors.humidity?.value != null ? [parseFloat(sensors.humidity.value.toFixed(1))] : [];
                const gas = sensors.gas?.value != null ? [Math.round(sensors.gas.value)] : [];
                if (temp.length || hum.length || gas.length) { hideNoDataMessage(); updateCharts([timeLabel], temp, hum, gas); }
            }
        } catch (e) { console.warn('RTDB fallback:', e); }
        return;
    }
    const { temp, hum, gas, labels } = processDailyData(snap);
    updateCharts(labels, temp, hum, gas);
}

// Hàm mở Modal và vẽ biểu đồ 24H
window.openDetailedModal = async function (type) {
    const modal = document.getElementById('chartModal');
    const title = document.getElementById('modalTitle');
    modal.style.display = 'block';

    // Tiêu đề
    if (type === 'temp_hum') title.innerText = 'Lịch sử Nhiệt độ & Độ ẩm 24h';
    else if (type === 'gas') title.innerText = 'Lịch sử Nồng độ Khí Gas 24h';

    const ctx = document.getElementById('modalChart').getContext('2d');
    if (modalChartInstance) modalChartInstance.destroy();

    try {
        const start = getStartOfDay(); // Lấy từ 00:00 sáng nay

        // FIX SCHEMA v2.4: "type" không còn là field cấp document (nó nằm lồng
        // trong từng phần tử của mảng readings[]), nên không thể where('type','==',...)
        // ở cấp Firestore nữa. Lấy toàn bộ bucket trong ngày rồi lọc/tách ở client
        // (processDailyData đã tự "bung" mảng readings[] và gộp theo timestamp_iso).
        const q = query(collection(db, 'sensor_readings'),
            where('roomId', '==', currentRoomId),
            where('updatedAt', '>=', start),
            orderBy('updatedAt', 'asc'));

        const snap = await getDocs(q);

        // Không cần "đảo ngược" nữa: processDailyData giờ tự sort theo
        // timestamp_iso bên trong readings[], không phụ thuộc thứ tự doc đầu vào.
        const processed = processDailyData(snap); // Trả về {temp, hum, gas, labels}

        let datasets = [];
        if (type === 'temp_hum') {
            datasets = [
                {
                    label: 'Nhiệt độ (°C)', data: processed.temp,
                    borderColor: CHART_COLORS.temp.border, backgroundColor: CHART_COLORS.temp.bg,
                    fill: true, yAxisID: 'y', tension: 0.3
                },
                {
                    label: 'Độ ẩm (%)', data: processed.hum,
                    borderColor: CHART_COLORS.hum.border, backgroundColor: CHART_COLORS.hum.bg,
                    fill: true, yAxisID: 'y1', tension: 0.3
                }
            ];
        } else if (type === 'gas') {
            datasets = [{
                label: 'Gas (ppm)', data: processed.gas,
                borderColor: CHART_COLORS.gas.border, backgroundColor: CHART_COLORS.gas.bg,
                fill: true, tension: 0.3
            }];
        }

        modalChartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels: processed.labels, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { maxTicksLimit: 12 } },
                    y: {
                        beginAtZero: false, display: true,
                        title: { display: true, text: type === 'gas' ? 'ppm' : '°C' }
                    },
                    y1: {
                        display: type === 'temp_hum', position: 'right',
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: '%' }
                    }
                }
            }
        });

    } catch (e) {
        console.error("Lỗi tải chi tiết Modal:", e);
    }
}

window.closeModal = function () {
    document.getElementById('chartModal').style.display = 'none';
}
window.onclick = function (event) {
    const modal = document.getElementById('chartModal');
    if (event.target == modal) closeModal();
}

// FIX SCHEMA v2.4: mỗi doc giờ là 1 "bucket" theo room + phút, chứa
// readings: [{type, value, timestamp_iso}, ...] thay vì 1 reading/doc.
// "Bung" toàn bộ readings[] của mọi bucket doc ra thành 1 mảng phẳng.
function flattenBucketDocs(snap) {
    const flat = [];
    snap.forEach(doc => {
        const data = doc.data();
        (data.readings || []).forEach(r => flat.push(r));
    });
    return flat;
}

function processDailyData(snap) {
    const flat = flattenBucketDocs(snap);

    // Gộp theo timestamp_iso để đảm bảo temp/hum/gas/labels luôn khớp index
    // (ESP32 gửi cả 3 giá trị cùng lúc trong 1 message MQTT nên cùng timestamp_iso).
    const byTime = new Map();
    flat.forEach(r => {
        if (!r || !r.timestamp_iso) return;
        if (!byTime.has(r.timestamp_iso)) byTime.set(r.timestamp_iso, {});
        byTime.get(r.timestamp_iso)[r.type] = r.value;
    });

    const temp = [], hum = [], gas = [], labels = [];
    [...byTime.entries()]
        .sort((a, b) => new Date(a[0]) - new Date(b[0]))
        .forEach(([iso, vals]) => {
            const ts = new Date(iso);
            if (isNaN(ts)) return;
            labels.push(ts.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
            temp.push(vals.temperature != null ? parseFloat(Number(vals.temperature).toFixed(1)) : null);
            hum.push(vals.humidity != null ? parseFloat(Number(vals.humidity).toFixed(1)) : null);
            gas.push(vals.gas != null ? Math.round(vals.gas) : null);
        });

    return { temp, hum, gas, labels };
}

function updateCharts(labels, temp, hum, gas) {
    if (tempHumChart) tempHumChart.destroy(); if (gasChart) gasChart.destroy();
    const isMobile = window.innerWidth < 768;
    const commonOpts = {
        responsive: true, maintainAspectRatio: true,
        aspectRatio: isMobile ? 2.5 : 2,
        interaction: { mode: 'index', intersect: false, axis: 'x' },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } } },
        elements: { point: { radius: 0, hitRadius: 20 }, line: { tension: 0.4 } }
    };

    // Chart 1: Temp & Hum (Dashboard)
    const ctx1 = document.getElementById('tempHumChart');
    if (ctx1) {
        tempHumChart = new Chart(ctx1, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Nhiệt độ (°C)', data: temp,
                        borderColor: CHART_COLORS.temp.border, backgroundColor: CHART_COLORS.temp.bg,
                        fill: true, yAxisID: 'y'
                    },
                    {
                        label: 'Độ ẩm (%)', data: hum,
                        borderColor: CHART_COLORS.hum.border, backgroundColor: CHART_COLORS.hum.bg,
                        fill: true, yAxisID: 'y1'
                    }
                ]
            },
            options: {
                ...commonOpts,
                scales: {
                    ...commonOpts.scales,
                    y: { type: 'linear', display: true, position: 'left', title: { display: true, text: '°C' } },
                    y1: { type: 'linear', display: true, position: 'right', title: { display: true, text: '%' }, grid: { drawOnChartArea: false } }
                }
            }
        });
    }

    // Chart 2: Gas (Dashboard)
    const ctx2 = document.getElementById('gasChart');
    if (ctx2) {
        gasChart = new Chart(ctx2, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Gas (ppm)', data: gas,
                    borderColor: CHART_COLORS.gas.border, backgroundColor: CHART_COLORS.gas.bg,
                    fill: true
                }]
            },
            options: {
                ...commonOpts,
                scales: { y: { title: { display: true, text: 'ppm' } } },
                plugins: { legend: { display: false } }
            }
        });
    }
}

function setupChartDataListener() {
    const start = getStartOfDay();
    // FIX SCHEMA v2.4: bucket doc của phút hiện tại được ghi bằng merge:true,
    // nên các lần ghi sau lần đầu trong cùng phút sẽ là "modified", không phải "added".
    // Phải lắng cả 2 loại thay đổi thì mới bắt được data mới trong cùng 1 phút.
    const q = query(collection(db, 'sensor_readings'), where('roomId', '==', currentRoomId), where('updatedAt', '>=', start), orderBy('updatedAt', 'desc'), limit(1));
    onSnapshot(q, (snap) => { snap.docChanges().forEach(c => { if (c.type === 'added' || c.type === 'modified') { hideNoDataMessage(); updateChartsWithLatestData().catch(() => { }); } }); });
}

// ===== 11. AUTOMATION =====
function renderAutomationUI() {
    const container = document.getElementById('automation-inputs-container');
    if (!container) return;
    container.innerHTML = '';
    const config = [
        { type: 'light', icon: 'fa-lightbulb', label: 'Đèn', id: 'lightThreshold', unit: '°C' },
        { type: 'fan', icon: 'fa-fan', label: 'Quạt', id: 'fanThreshold', unit: '°C' },
        { type: 'valve', icon: 'fa-fire', label: 'Gas Alert', id: 'gasThreshold', unit: 'ppm' },
        { type: 'alarm', icon: 'fa-bell', label: 'Báo động', id: 'gasThreshold', unit: 'ppm' }
    ];
    let hasDevice = false;
    const renderedInputs = new Set();
    config.forEach(item => {
        if (dynamicDeviceMap[item.type] && !renderedInputs.has(item.id)) {
            hasDevice = true;
            renderedInputs.add(item.id);
            const div = document.createElement('div');
            div.className = 'automation-rule';
            div.innerHTML = `<i class="fas ${item.icon}"></i> ${item.label} > <input type="number" step="${item.unit === 'ppm' ? 10 : 0.5}" id="${item.id}" class="threshold-input" placeholder="--"><span class="unit">${item.unit}</span>`;
            container.appendChild(div);
        }
    });
    if (!hasDevice) container.innerHTML = '<p style="color:#999; font-style:italic;">Chưa có thiết bị hỗ trợ tự động.</p>';
}

async function loadAutomationSettings() {
    try {
        const ref = doc(db, 'automations', `${currentUserId}_${currentRoomId}`);
        const snap = await getDoc(ref);
        if (snap.exists()) {
            automationData = snap.data();
            ['lightThreshold', 'fanThreshold', 'gasThreshold'].forEach(f => {
                const el = document.getElementById(f);
                if (el && automationData[f] !== undefined) el.value = automationData[f];
            });
        }
    } catch (e) { console.error(e); }
}

async function saveAutomationSettings(e) {
    e.preventDefault();
    const configMap = {
        'lightThreshold': { type: 'light', field: 'lightThreshold' },
        'fanThreshold': { type: 'fan', field: 'fanThreshold' },
        'gasThreshold': { type: 'valve', field: 'gasThreshold' }
    };
    const settings = { enabled: true, userId: currentUserId, roomId: currentRoomId, lastUpdated: serverTimestamp() };
    let hasAnySetting = false;
    const gasInput = document.getElementById('gasThreshold');
    const hasGasDevice = dynamicDeviceMap['valve'] || dynamicDeviceMap['alarm'];
    if (gasInput && gasInput.value && hasGasDevice) { settings['gasThreshold'] = parseFloat(gasInput.value); hasAnySetting = true; }
    for (const [inputId, config] of Object.entries(configMap)) {
        if (inputId === 'gasThreshold') continue;
        const inputEl = document.getElementById(inputId);
        if (inputEl && inputEl.value && dynamicDeviceMap[config.type]) { settings[config.field] = parseFloat(inputEl.value); hasAnySetting = true; }
    }
    // [FIX] Thêm snake_case aliases để firebase_sync.py đọc đúng khi sync về SQLite
    if (settings.fanThreshold !== undefined) settings.fan_threshold = settings.fanThreshold;
    if (settings.lightThreshold !== undefined) settings.light_threshold = settings.lightThreshold;
    if (settings.gasThreshold !== undefined) settings.gas_threshold = settings.gasThreshold;
    try {
        const docId = `${currentUserId}_${currentRoomId}`;
        const automationRef = doc(db, 'automations', docId);
        if (!hasAnySetting) { await deleteDoc(automationRef); automationData = null; showNotification('Đã xóa Automation (trống)', 'info'); }
        else { await setDoc(automationRef, settings); automationData = settings; showNotification(' Đã lưu thiết lập!', 'success'); }
    } catch (error) { console.error("Lỗi lưu:", error); showNotification('Lỗi khi lưu!', 'error'); }
}

// ===== 12. UTILS =====
function showChartLoadingState() { document.querySelectorAll('.chart-card').forEach(c => { if (!c.querySelector('.chart-loading')) c.insertAdjacentHTML('beforeend', '<div class=\"chart-loading\" style=\"position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(255,255,255,0.9);padding:10px;\">Loading...</div>'); }); }
function hideChartLoadingState() { document.querySelectorAll('.chart-loading').forEach(e => e.remove()); }
function showNoDataMessage() { hideChartLoadingState(); document.querySelectorAll('.chart-card').forEach(c => { if (!c.querySelector('.no-data-message')) c.insertAdjacentHTML('beforeend', '<div class=\"no-data-message\" style=\"position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#999;\">Chưa có dữ liệu</div>'); }); }
function hideNoDataMessage() { document.querySelectorAll('.no-data-message').forEach(e => e.remove()); }
function showNotification(msg, type = 'info') {
    const n = document.createElement('div');
    n.style.cssText = `position: fixed; top: 20px; right: 20px; padding: 12px 20px; border-radius: 8px; color: white; font-weight: bold; z-index: 1000; background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'}; box-shadow: 0 4px 12px rgba(0,0,0,0.1);`;
    n.textContent = msg; document.body.appendChild(n); setTimeout(() => n.remove(), 3000);
}
function cleanup() { if (chartUpdateInterval) clearInterval(chartUpdateInterval); if (dayCheckInterval) clearInterval(dayCheckInterval); if (tempHumChart) tempHumChart.destroy(); if (gasChart) gasChart.destroy(); roomService.unsubscribeAll(); }

async function runSystemDebugCheck() {
    try {
        const roomSnap = await getDoc(doc(db, 'rooms', currentRoomId));
        if (roomSnap.exists()) console.log("Phòng OK:", roomSnap.data().name);
    } catch (e) { console.error("Lỗi DB:", e); }
}