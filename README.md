# 🏠 SmartHome Web Dashboard

Giao diện web quản trị & giám sát cho hệ thống **Nhà Thông Minh (SmartHome)** — một phần của đồ án tích hợp IoT gồm firmware ESP32, gateway Raspberry Pi và backend Firebase. Repo này chứa **frontend** (vanilla JavaScript, không dùng framework, không cần build) chạy tĩnh trên Netlify.

> Đồ án 1 — Khoa Đào tạo Chất lượng cao, HCMUTE

---

## 📌 Tổng quan hệ thống

```
┌─────────────┐      MQTT       ┌──────────────────┐     Firestore/RTDB     ┌──────────────────┐
│  ESP32 Node │ ───────────────▶│  Raspberry Pi     │ ──────────────────────▶│  Firebase Cloud   │
│ (Bedroom /  │◀─────────────── │  Gateway (Python) │◀────────────────────── │ (Auth/Firestore/  │
│  Kitchen /  │                 │  Redis Message Bus │                        │  Realtime DB)     │
│  Living Room)│                └──────────────────┘                        └────────┬─────────┘
└─────────────┘                                                                       │
                                                                            Realtime listeners
                                                                                       │
                                                                              ┌────────▼─────────┐
                                                                              │  Web Dashboard    │
                                                                              │  (repo này)       │
                                                                              └───────────────────┘
```

Web dashboard **không** giao tiếp trực tiếp với ESP32/Raspberry Pi — mọi tương tác đều đi qua **Firebase** (Authentication, Cloud Firestore, Realtime Database):

- Đọc dữ liệu cảm biến (realtime) và lịch sử biểu đồ theo phút.
- Gửi **lệnh điều khiển thiết bị** bằng cách ghi document vào collection `commands` — Raspberry Pi gateway sẽ lắng nghe và thực thi.
- Quản lý phòng, thiết bị, tự động hóa (automation), hẹn giờ (schedule), RFID, cấu hình Wi-Fi và email cảnh báo.

---

## ✨ Tính năng chính

### 🔐 Xác thực
- Đăng nhập / đăng ký bằng Firebase Authentication (email & mật khẩu).
- Bảo vệ route: các trang quản trị tự động chuyển hướng về `index.html`/`login.html` nếu chưa đăng nhập.

### 🧭 Trang Quản trị (`admin.html`)
- Thống kê tổng số phòng, tổng thiết bị, thiết bị đang hoạt động.
- Điều khiển khóa cửa chính (remote door lock) qua relay tại node `entrance_01`.
- Thêm / sửa / xóa phòng động, cấu hình loại phòng (quyết định giao diện dashboard tương ứng).
- Tạo thiết bị ngay khi tạo phòng (đặt tên thiết bị theo chuẩn `<loại>_<viết tắt phòng>_<số phòng>`).
- Trung tâm thông báo dạng dropdown (chuông thông báo) + popup xác nhận cập nhật **OTA firmware**.

### 📊 Dashboard theo phòng (`dashboard-bedroom.html`, `dashboard-kitchen.html`, `dashboard-livingroom.html`)
- Biểu đồ realtime (Chart.js) cho nhiệt độ, độ ẩm, CO2 (phòng ngủ) hoặc khí Gas (nhà bếp).
- Xem chi tiết dữ liệu 24h qua modal khi click vào biểu đồ.
- Bật/tắt thiết bị (đèn, quạt, điều hòa, ổ cắm...) theo thời gian thực.
- Cấu hình **tự động hóa** theo ngưỡng cảm biến (vd: bật quạt khi nhiệt độ > X°C).
- **Hẹn giờ tắt thiết bị**, tự xóa lịch khi thiết bị đã tắt.

### 🔔 Trang Thông báo (`notifications.html`)
- Danh sách đầy đủ cảnh báo hệ thống (cháy, gas, xâm nhập, ra/vào cửa, đăng nhập, tự động hóa, OTA...).
- Bộ lọc theo loại, trạng thái (đã đọc/chưa đọc), tìm kiếm full-text.
- Đánh dấu đã đọc từng thông báo hoặc tất cả cùng lúc.

### ⚙️ Trang Cài đặt (`settings.html`)
- Quản lý kết nối Wi-Fi của Raspberry Pi: quét mạng xung quanh, kết nối mạng mới.
- Quản lý thẻ RFID (nạp thẻ mới, đặt tên chủ thẻ, xóa thẻ).
- Cấu hình email cảnh báo (Gmail App Password) được đồng bộ với gateway qua Firestore — không cần khởi động lại Raspberry Pi.

---

## 🗂️ Cấu trúc thư mục

```
.
├── index.html / index.js               # Trang chủ, landing page
├── login.html / login.js               # Đăng nhập / Đăng ký (Firebase Auth)
├── admin.html / admin.js               # Trang quản trị tổng, quản lý phòng, cửa, OTA
├── dashboard-bedroom.html/.js          # Dashboard Phòng ngủ
├── dashboard-kitchen.html/.js          # Dashboard Nhà bếp
├── dashboard-livingroom.html/.js       # Dashboard Phòng khách
├── notifications.html/.js              # Trang thông báo tổng quan
├── settings.html/.js                   # Cài đặt Wi-Fi / RFID / Email
├── firebase-config.js                  # Khởi tạo Firebase App, export Auth/Firestore/RTDB helpers
├── roomService.js                      # Service layer: CRUD phòng/thiết bị, gửi lệnh, automation, schedule
├── package.json
└── README.md
```

> Ghi chú: các thư mục `css/`, `images/`, `videos/` được tham chiếu trong HTML nhưng không nằm trong phần code JS chia sẻ ở đây — đảm bảo chúng tồn tại đúng đường dẫn khi deploy.

---

## 🧱 Công nghệ sử dụng

| Thành phần        | Công nghệ |
|---------------------|-----------|
| Frontend            | HTML5, CSS3, Vanilla JavaScript (ES Modules) |
| Biểu đồ              | [Chart.js](https://www.chartjs.org/) |
| Icon                | Font Awesome |
| Auth & Database     | Firebase Authentication, Cloud Firestore, Realtime Database |
| Hosting             | Netlify (static site, không cần build step) |
| Giao tiếp phần cứng | MQTT (ESP32 ↔ Raspberry Pi), Firestore/RTDB (Pi ↔ Web) |

Không có bước build — Firebase SDK được import trực tiếp từ CDN (`gstatic.com/firebasejs/12.12.1/...`), nên chỉ cần một static file server là chạy được.

---

## 🚀 Cài đặt & chạy local

### Yêu cầu
- Node.js >= 18 (chỉ để chạy static server, không dùng để build)
- Một project Firebase đã bật **Authentication (Email/Password)**, **Cloud Firestore** và **Realtime Database**

### Các bước

```bash
# 1. Clone repo
git clone https://github.com/<username>/<repo>.git
cd <repo>

# 2. (Tuỳ chọn) cài serve nếu chưa có
npm install

# 3. Chạy server tĩnh
npm run dev       # http://localhost:3000
# hoặc
npm start         # cổng mặc định của `serve`
```

### Cấu hình Firebase

Mở `js/firebase-config.js` (hoặc `firebase-config.js`) và thay bằng thông tin project Firebase của bạn:

```js
const firebaseConfig = {
    apiKey:            "YOUR_API_KEY",
    authDomain:        "YOUR_PROJECT.firebaseapp.com",
    projectId:         "YOUR_PROJECT",
    storageBucket:      "YOUR_PROJECT.firebasestorage.app",
    messagingSenderId: "YOUR_SENDER_ID",
    appId:             "YOUR_APP_ID",
    databaseURL:       "https://YOUR_PROJECT-default-rtdb.<region>.firebasedatabase.app",
};
```

> ⚠️ **Lưu ý bảo mật**: đây là cấu hình client-side (bắt buộc phải public theo cách Firebase hoạt động). Bảo mật thực sự đến từ **Firestore/RTDB Security Rules** — hãy chắc chắn rules đã được cấu hình chặt chẽ (chỉ user đã đăng nhập mới đọc/ghi được dữ liệu của mình) trước khi deploy production.

---

## ☁️ Deploy lên Netlify

1. Đẩy code lên GitHub.
2. Trên Netlify: **New site from Git** → chọn repo.
3. Build command: để trống (không cần build).
4. Publish directory: thư mục gốc chứa `index.html`.
5. Deploy — xong.

---

## 🔗 Schema dữ liệu Firestore (tóm tắt)

```
rooms/{roomId}
  ├─ name, roomType, userId, deviceCount, createdAt, updatedAt
  ├─ devices/{deviceId}       → name, type, status, isOn, details
  └─ sensors/{sensorId}       → value, ...

commands/{commandId}          → action, room, roomId, device, deviceId, isOn, status, timestamp
system_alerts/{alertId}       → type, message, isResolved, location, timestamp
automations/{userId_roomId}   → ngưỡng tự động hóa theo phòng
schedules/{...}               → lịch hẹn giờ tắt thiết bị
```

Quy ước quan trọng: **`roomId` (document ID)** phải khớp chính xác với `room_id` đã cấu hình trong firmware ESP32, vì Raspberry Pi/ESP32 dùng giá trị này làm MQTT topic (`home/<roomId>/...`).

---

## 👥 Nhóm thực hiện

| Họ tên | Email |
|---|---|
| Cao Như Ý | 23139052@student.hcmute.edu.vn |
---

## 📄 License

Dự án phục vụ mục đích học tập thực hành giao thức iot. Vui lòng liên hệ nhóm thực hiện nếu muốn sử dụng cho mục đích khác.
