import { 
    auth, db, onAuthStateChanged, collection, doc, setDoc, getDoc, 
    addDoc, deleteDoc, getDocs, updateDoc, onSnapshot, serverTimestamp, query, orderBy 
} from "./firebase-config.js";

let currentUserId = null;

// Khởi tạo Auth
onAuthStateChanged(auth, (user) => {
    if (!user) window.location.href = 'index.html';
    else {
        currentUserId = user.uid;
        setupWifiListeners();
        setupRfidListeners();
        setupEmailConfigListeners();
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    auth.signOut().then(() => window.location.href = 'index.html');
});

/* ================= 1. XỬ LÝ WIFI (LOGIC QUÉT & KẾT NỐI) ================= */

function setupWifiListeners() {
    // A. Nghe trạng thái kết nối hiện tại (Giữ nguyên để biết Rasp đang nối mạng nào)
    onSnapshot(doc(db, 'system_status', 'wifi'), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const statusEl = document.getElementById('wifi-current-status');
            const ssidEl = document.getElementById('wifi-current-ssid');

            ssidEl.textContent = data.current_ssid || 'Chưa kết nối';
            
            if(data.status === 'connected') {
                statusEl.className = 'status-badge success';
                statusEl.textContent = 'Đã kết nối Internet';
            } else if (data.status === 'connecting') {
                statusEl.className = 'status-badge warning';
                statusEl.textContent = 'Đang kết nối...';
            } else {
                statusEl.className = 'status-badge error';
                statusEl.textContent = 'Mất kết nối';
            }
        }
    });

    // B. Nghe danh sách Wifi quét được từ Raspberry Pi (available_wifi)
    onSnapshot(doc(db, 'system_status', 'available_wifi'), (docSnap) => {
        const tbody = document.getElementById('wifiListBody');
        tbody.innerHTML = '';
        
        if (!docSnap.exists()) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 20px;">
                Chưa có dữ liệu quét. <a href="#" onclick="triggerWifiScan();return false;">Quét ngay</a>
            </td></tr>`;
            return;
        }

        const data = docSnap.data();
        const networks = data.networks || []; 
        const lastScan = data.last_scan ? data.last_scan.toDate().toLocaleTimeString('vi-VN') : '--';

        // [FIX] Nếu scan cũ hơn 5 phút → tự động trigger scan lại khi load trang
        if (data.last_scan) {
            const ageMs = Date.now() - data.last_scan.toDate().getTime();
            if (ageMs > 5 * 60 * 1000 && !window._autoScanTriggered) {
                window._autoScanTriggered = true;
                triggerWifiScan();
            }
        }

        document.getElementById('lastScanTime').textContent = `Cập nhật lúc: ${lastScan}`;

        if (networks.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 20px;">Không tìm thấy mạng Wifi nào xung quanh.</td></tr>`;
            return;
        }

        // Render danh sách
        networks.forEach(net => {
            let signalIcon = '';
            let signalClass = '';
            if (net.signal > 80) { signalIcon = 'fa-signal'; signalClass = 'text-success'; }
            else if (net.signal > 50) { signalIcon = 'fa-wifi'; signalClass = 'text-warning'; }
            else { signalIcon = 'fa-rss'; signalClass = 'text-danger'; }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight:500;">${net.ssid}</td>
                <td><i class="fas ${signalIcon} ${signalClass}"></i> ${net.signal}%</td>
                <td style="text-align: right;">
                    <button class="btn btn-sm btn-primary" onclick="openWifiModal('${net.ssid}')">
                        <i class="fas fa-plug"></i> Chọn
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    });

    // [FIX] Auto-trigger scan khi load trang lần đầu (không có dữ liệu nào)
    // Dùng timeout nhỏ để đảm bảo onSnapshot kịp nhận data trước khi quyết định scan
    setTimeout(async () => {
        if (!window._autoScanTriggered) {
            window._autoScanTriggered = true;
            await triggerWifiScan();
        }
    }, 2000);
}

// [FIX] Hàm trigger scan WiFi qua Firestore → firebase_sync → Redis wifi_setup → network_watchdog
window.triggerWifiScan = async function() {
    const tbody = document.getElementById('wifiListBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 20px;">
            <i class="fas fa-spinner fa-spin"></i> Đang quét mạng Wifi (wlan1)...
        </td></tr>`;
    }
    const scanTimeEl = document.getElementById('lastScanTime');
    if (scanTimeEl) scanTimeEl.textContent = 'Đang quét...';
    try {
        await setDoc(doc(db, 'commands', 'wifi_scan'), {
            action:    'scan_wifi',
            timestamp: serverTimestamp(),
            status:    'pending'
        });
        console.log('[WiFi] Scan command sent to Firestore');
    } catch (err) {
        console.error('[WiFi] Scan trigger error:', err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:red; padding: 20px;">
                Lỗi gửi lệnh quét: ${err.message}
            </td></tr>`;
        }
    }
};

// C. Xử lý Modal & Gửi lệnh kết nối
window.openWifiModal = (ssid) => {
    document.getElementById('targetSsidHidden').value = ssid;
    document.getElementById('targetSsidDisplay').textContent = ssid;
    document.getElementById('wifiPasswordInput').value = ''; // Xóa pass cũ
    document.getElementById('wifiConnectModal').style.display = 'block';
    document.getElementById('wifiPasswordInput').focus();
};

window.closeWifiModal = () => {
    document.getElementById('wifiConnectModal').style.display = 'none';
};

// Hàm gửi lệnh xuống Firebase khi nhấn "Kết nối" trong Modal
window.confirmConnectWifi = async () => {
    const ssid = document.getElementById('targetSsidHidden').value;
    const password = document.getElementById('wifiPasswordInput').value;

    if (!ssid) return;

    if(!confirm(`Gửi lệnh yêu cầu Rasp kết nối vào "${ssid}"?`)) return;

    try {
        // Ghi lệnh vào collection commands để Python bắt được
        await setDoc(doc(db, 'commands', 'wifi_setup'), {
            action: 'add_and_connect', // Action này để log cho vui, Python chủ yếu lấy ssid/pass
            ssid: ssid,
            password: password,
            timestamp: serverTimestamp(),
            status: 'pending' // Python sẽ bắt trạng thái này để xử lý
        });

        alert(`Đã gửi lệnh! Raspberry Pi sẽ thử kết nối trong giây lát.`);
        closeWifiModal();

    } catch (error) {
        console.error(error);
        alert('Lỗi: ' + error.message);
    }
};

/* ================= 2. XỬ LÝ RFID (GIỮ NGUYÊN) ================= */

let registerTimeout = null; 

function updateRegisterUi(isScanning) {
    const btn = document.getElementById('startScanBtn');
    const statusDiv = document.getElementById('scan-status');

    if (isScanning) {
        btn.classList.add('scanning-active');
        btn.classList.remove('btn-success');
        btn.classList.add('btn-danger');
        btn.innerHTML = '<i class="fas fa-stop-circle"></i> Hủy Đăng ký';
        statusDiv.style.display = 'block';
        statusDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang đợi quét Vân tay hoặc RFID tại Cửa...';
    } else {
        btn.classList.remove('scanning-active');
        btn.classList.remove('btn-danger');
        btn.classList.add('btn-success');
        btn.innerHTML = '<i class="fas fa-fingerprint"></i> Kích hoạt Đăng ký (RFID/Vân tay)';
        statusDiv.style.display = 'none';
        if (registerTimeout) clearTimeout(registerTimeout);
    }
}


// [FIX-C] Tự động thêm nút "Xóa tất cả" vào DOM khi trang load
// (Đặt cạnh nút Kích hoạt Đăng ký trong settings.html)
function _injectClearAllBtn() {
    const scanBtn = document.getElementById('startScanBtn');
    if (scanBtn && !document.getElementById('clearAllUsersBtn')) {
        const clearBtn = document.createElement('button');
        clearBtn.id = 'clearAllUsersBtn';
        clearBtn.className = 'btn btn-danger btn-sm';
        clearBtn.style.cssText = 'margin-left: 10px;';
        clearBtn.innerHTML = '<i class="fas fa-trash-alt"></i> Xóa tất cả thẻ';
        clearBtn.onclick = window.clearAllUsers;
        scanBtn.parentElement.appendChild(clearBtn);
    }
}
setTimeout(_injectClearAllBtn, 500);

// [FIX-C] Xóa toàn bộ thẻ & vân tay — reset SPIFFS ESP32 + SQLite + Firestore
// [FIX-CLEAR-ALL-FINAL] Xóa tất cả thẻ — đồng bộ hoàn toàn 3 tầng:
// 1. Firestore rfid_cards → xóa từng doc
// 2. Pi SQLite rfid_cards → xóa qua lệnh clear_all_rfid
// 3. ESP32 SPIFFS users.json + fingerprint sensor → xóa qua MQTT
window.clearAllUsers = async function() {
    if (!confirm(` XÓA TẤT CẢ THẺ VÀ VÂN TAY?

Thao tác này sẽ xóa đồng bộ trên:
• Firestore rfid_cards (Web)
• SQLite rfid_cards (Raspberry Pi)
• SPIFFS users.json + vân tay (ESP32)

Không thể phục hồi! Bạn có chắc chắn?`)) return;

    // Hiển thị loading trong bảng
    const tbody = document.getElementById('rfidListBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:16px"><i class="fas fa-spinner fa-spin"></i> Đang xóa tất cả thẻ...</td></tr>';

    try {
        // ── Bước 1: Lấy tất cả docs trong Firestore rfid_cards ──────────
        const rfidSnap = await getDocs(collection(db, 'rfid_cards'));
        const count    = rfidSnap.size;

        // ── Bước 2: Xóa song song toàn bộ docs Firestore ────────────────
        if (count > 0) {
            const deleteJobs = [];
            rfidSnap.forEach(d => deleteJobs.push(deleteDoc(doc(db, 'rfid_cards', d.id))));
            await Promise.all(deleteJobs);
            console.log(`[RFID] Deleted ${count} docs from Firestore rfid_cards`);
        } else {
            console.log('[RFID] Firestore rfid_cards already empty');
        }

        // ── Bước 3: Gửi lệnh clear_all_rfid → Pi → MQTT → ESP32 SPIFFS ─
        await setDoc(doc(db, 'commands', 'clear_all_rfid'), {
            action:    'clear_all_rfid',
            timestamp: serverTimestamp(),
            status:    'pending',
        });
        console.log('[RFID] clear_all_rfid command sent → Pi SQLite + ESP32 SPIFFS');

        alert(` Đã xóa ${count} thẻ khỏi Firestore.
ESP32 đang xóa SPIFFS và cảm biến vân tay...`);

    } catch (err) {
        console.error('[RFID] clearAllUsers error:', err);
        alert(`Lỗi: ${err.message}`);
        // Reload để đồng bộ lại UI
        if (tbody) tbody.innerHTML = '';
    }
};

document.getElementById('startScanBtn').addEventListener('click', async () => {
    const btn = document.getElementById('startScanBtn');
    const isScanning = btn.classList.contains('scanning-active');
    const commandRef = doc(db, 'commands', 'entrance_register');

    try {
        if (!isScanning) {
            await setDoc(commandRef, {
                action:     'start_register',
                target:     'entrance_slave',
                owner_name: 'Thẻ mới',   // [FIX] Pi cần owner_name để lưu vào DB
                timestamp:  serverTimestamp(),
                status:     'pending'      // [FIX] CommandDispatcher chỉ dispatch khi status='pending'
            });
            updateRegisterUi(true);
            registerTimeout = setTimeout(async () => {
                alert("Hết thời gian đăng ký. Đã tự động tắt.");
                updateRegisterUi(false);
                await updateDoc(commandRef, { action: 'cancel_register', status: 'pending', timestamp: serverTimestamp() });
            }, 60000);
        } else {
            await updateDoc(commandRef, {
                action:    'cancel_register',
                timestamp: serverTimestamp(),
                status:    'pending'       // [FIX] Phải là 'pending' để CommandDispatcher xử lý
            });
            updateRegisterUi(false);
        }
    } catch (error) {
        console.error(error);
        alert('Lỗi thao tác: ' + error.message);
        updateRegisterUi(false); 
    }
});

function setupRfidListeners() {
    onSnapshot(doc(db, 'commands', 'entrance_register'), (docSnapshot) => {
        if(docSnapshot.exists()) {
            const data = docSnapshot.data();
            if (data.status === 'success') {
                updateRegisterUi(false); 
                if (data.result_type === 'combo') {
                    // [FIX-D] ESP32 đăng ký cặp thẻ + vân tay
                    alert(` Đăng ký thành công!\nThẻ RFID + Vân tay đã được lưu.\nUID: ${data.value}\nTên: ${data.owner_name || 'Chưa đặt tên'}\n\nBây giờ có thể mở cửa bằng thẻ HOẶC vân tay.`);
                } else if (data.result_type === 'rfid') {
                    alert(`Đã nhận thẻ RFID mới! UID: ${data.value}.`);
                } else if (data.result_type === 'fingerprint') {
                    alert(`Đã đăng ký Vân tay mới! ID: ${data.value}.`);
                } else {
                    alert(`Đăng ký thành công! Dữ liệu: ${data.value}`);
                }
                updateDoc(docSnapshot.ref, { status: 'idle' });
            }
            else if (data.status === 'error') {
                updateRegisterUi(false);
                alert(`Lỗi từ thiết bị: ${data.message || 'Không xác định'}`);
                updateDoc(docSnapshot.ref, { status: 'idle' });
            }
        }
    });

    const q = query(collection(db, 'rfid_cards'), orderBy('createdAt', 'desc'));
    onSnapshot(q, (snapshot) => {
        const tbody = document.getElementById('rfidListBody');
        tbody.innerHTML = '';
        snapshot.forEach(doc => {
            const card = doc.data();
            const date = card.createdAt ? card.createdAt.toDate().toLocaleDateString('vi-VN') : 'N/A';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><code style="background:#eee; padding:2px 5px; border-radius:4px;">${card.uid}</code></td>
                <td>${card.name || '<span style="color:#999; font-style:italic;">Chưa đặt tên</span>'}</td>
                <td>${date}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="openEditModal('${doc.id}', '${card.name || ''}')">
                        <i class="fas fa-edit"></i> Sửa tên
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteCard('${doc.id}', '${card.uid || doc.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    });
}

// Logic Modal chung (Xử lý đóng khi click ra ngoài)
window.onclick = function(event) {
    const editModal = document.getElementById('editCardModal');
    const wifiModal = document.getElementById('wifiConnectModal');
    if (event.target == editModal) closeEditModal();
    if (event.target == wifiModal) closeWifiModal();
}

// Logic Sửa tên thẻ RFID
window.openEditModal = (docId, currentName) => {
    document.getElementById('editingCardId').value = docId;
    document.getElementById('cardNameInput').value = currentName;
    document.getElementById('editCardModal').style.display = 'block';
};
window.closeEditModal = () => { document.getElementById('editCardModal').style.display = 'none'; };
window.saveCardName = async () => {
    const docId = document.getElementById('editingCardId').value;
    const newName = document.getElementById('cardNameInput').value;
    if(newName) {
        await updateDoc(doc(db, 'rfid_cards', docId), { name: newName });
        closeEditModal();
    }
};
// [FIX-DELETE-FINAL] Xóa từng thẻ: Firestore + Pi → MQTT → ESP32 xóa SPIFFS
// LƯU Ý: firebase_sync dùng document(uid) làm docId nên docId === uid
//         Điều kiện "uid !== docId" trước đây LUÔN FALSE → lệnh Pi không bao giờ gửi
//         Fix: chỉ check uid tồn tại
window.deleteCard = async (docId, uid) => {
    // docId chính là uid (firebase_sync dùng document(uid))
    // nhưng để an toàn, dùng uid nếu có, fallback về docId
    const cardUid = (uid && uid.trim() && uid !== 'undefined') ? uid : docId;
    const label   = `thẻ UID: ${cardUid}`;

    if (!confirm(`Xóa ${label}?

• Xóa khỏi Firestore rfid_cards
• Gửi lệnh ESP32 xóa khỏi SPIFFS và cảm biến vân tay

Thẻ sẽ không còn mở được cửa.`)) return;

    try {
        // Bước 1: Xóa doc khỏi Firestore rfid_cards
        await deleteDoc(doc(db, 'rfid_cards', docId));
        console.log(`[RFID] Deleted Firestore rfid_cards/${docId}`);

        // Bước 2: Gửi lệnh delete_rfid → firebase_sync → rfid_commands → automation_engine
        //         → MQTT home/entrance_01/command {action:"delete_user", uid}
        //         → ESP32 xóa uid khỏi SPIFFS users.json + finger.deleteModel(fp_id)
        // LUÔN gửi (bỏ điều kiện uid !== docId cũ vì docId === uid)
        const safeUid = cardUid.replace(/[^a-zA-Z0-9]/g, '_');
        await setDoc(doc(db, 'commands', `rfid_delete_${safeUid}`), {
            action:    'delete_rfid',
            uid:       cardUid,
            timestamp: serverTimestamp(),
            status:    'pending',
        });
        console.log(`[RFID] Delete command sent to Pi for uid=${cardUid}`);

        alert(`Đã xóa thẻ ${cardUid} thành công!
ESP32 đang xóa khỏi bộ nhớ...`);
    } catch (err) {
        console.error('[RFID] deleteCard error:', err);
        alert(`Lỗi xóa thẻ: ${err.message}`);
    }
};

/* ================= 3. CẤU HÌNH EMAIL CẢNH BÁO ================= */

function setupEmailConfigListeners() {
    const emailConfigRef = doc(db, 'system_config', 'email_alert');

    // [FIX] Chrome/Edge có thể tự động autofill mật khẩu ĐÃ LƯU TRƯỚC ĐÓ vào ô này
    // dù đã có autocomplete="new-password", vì trình duyệt nhận diện field theo pattern.
    // Ép xóa giá trị sau khi trang load xong để đảm bảo ô luôn trống — tránh vô tình
    // lưu đè App Password đúng bằng mật khẩu autofill sai khi bấm "Lưu cấu hình".
    setTimeout(() => {
        const pwInput = document.getElementById('emailAppPasswordInput');
        if (pwInput && document.activeElement !== pwInput) pwInput.value = '';
    }, 500);

    // Lắng nghe realtime để hiển thị giá trị hiện tại + trạng thái đồng bộ với Pi
    onSnapshot(emailConfigRef, (docSnap) => {
        const userInput     = document.getElementById('emailUserInput');
        const toInput       = document.getElementById('emailToInput');
        const cooldownInput = document.getElementById('emailCooldownInput');
        const syncStatus    = document.getElementById('emailSyncStatus');

        if (!docSnap.exists()) {
            if (syncStatus) syncStatus.innerHTML =
                '<i class="fas fa-info-circle"></i> Chưa có cấu hình nào — Gateway đang dùng giá trị mặc định trong .env.';
            return;
        }

        const data = docSnap.data();
        // Không đè giá trị đang gõ dở của người dùng
        if (userInput && document.activeElement !== userInput) userInput.value = data.emailUser || '';
        if (toInput && document.activeElement !== toInput) toInput.value = data.emailTo || '';
        if (cooldownInput && document.activeElement !== cooldownInput) cooldownInput.value = data.cooldownSeconds || 120;

        if (syncStatus) {
            const updatedAt   = data.updatedAt ? data.updatedAt.toDate().toLocaleString('vi-VN') : '--';
            const lastPolled  = data.lastPolledAt ? data.lastPolledAt.toDate().toLocaleString('vi-VN') : null;
            syncStatus.innerHTML = lastPolled
                ? `<i class="fas fa-check-circle" style="color:#10b981"></i> Gateway đã nhận cấu hình lúc ${lastPolled} (lưu lần cuối ${updatedAt})`
                : `<i class="fas fa-clock" style="color:#f59e0b"></i> Đã lưu lúc ${updatedAt} — đang chờ Gateway đồng bộ (tối đa 5 phút)...`;
        }
    });

    document.getElementById('emailConfigForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailUser        = document.getElementById('emailUserInput').value.trim();
        const emailAppPassword = document.getElementById('emailAppPasswordInput').value.trim();
        const emailTo          = document.getElementById('emailToInput').value.trim();
        const cooldownSeconds  = parseInt(document.getElementById('emailCooldownInput').value, 10) || 120;

        if (!emailUser || !emailTo) {
            alert('Vui lòng nhập đủ Email gửi và Email nhận.');
            return;
        }

        const payload = {
            emailUser,
            emailTo,
            cooldownSeconds,
            updatedAt: serverTimestamp(),
            updatedBy: currentUserId || 'web',
        };
        // Chỉ ghi App Password nếu người dùng nhập mới — để trống thì giữ nguyên password cũ trên Firestore
        if (emailAppPassword) payload.emailAppPassword = emailAppPassword;

        const saveBtn = document.getElementById('emailConfigSaveBtn');
        try {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang lưu...';
            await setDoc(doc(db, 'system_config', 'email_alert'), payload, { merge: true });
            document.getElementById('emailAppPasswordInput').value = '';
            document.getElementById('emailAppPasswordInput').placeholder = 'Đã lưu — để trống nếu không muốn đổi';
            alert('Đã lưu cấu hình email. Raspberry Pi sẽ tự cập nhật trong vài phút tới.');
        } catch (err) {
            console.error('[EmailConfig] save error:', err);
            alert('Lỗi lưu cấu hình: ' + err.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-save"></i> Lưu cấu hình';
        }
    });

    const toggleBtn = document.getElementById('toggleAppPasswordBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const input = document.getElementById('emailAppPasswordInput');
            input.type = input.type === 'password' ? 'text' : 'password';
            toggleBtn.querySelector('i').classList.toggle('fa-eye');
            toggleBtn.querySelector('i').classList.toggle('fa-eye-slash');
        });
    }
}