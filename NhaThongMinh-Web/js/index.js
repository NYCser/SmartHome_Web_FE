// js/index.js
import { auth, onAuthStateChanged, signOut } from './firebase-config.js';

// ===== KHAI BÁO CÁC PHẦN TỬ DOM (DOM ELEMENTS) =====
// Lấy tất cả các link trỏ đến trang Admin (cả trên Menu và dưới Footer)
const adminLinks = document.querySelectorAll('a[href="admin.html"]');

const navLoginBtn = document.getElementById('nav-login-btn');
const footerLoginLinks = document.querySelectorAll('.footer-login-link');
const hamburgerMenu = document.querySelector('.hamburger-menu');
const navMenu = document.querySelector('.nav-menu');
const navOverlay = document.querySelector('.nav-overlay');
const actionButtons = document.querySelectorAll('.action-btn'); // Các nút "Bắt đầu ngay"
const contactLink = document.getElementById('footer-contact-link');

// ===== KHỞI TẠO (INITIALIZATION) =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('Trang chủ đã tải xong.');
    
    // Lắng nghe trạng thái đăng nhập từ Firebase
    // Hàm này chạy tự động mỗi khi người dùng vào trang hoặc reload
    onAuthStateChanged(auth, (user) => {
        if (user) {
            console.log(' Người dùng đã đăng nhập:', user.email);
            updateUIForLoggedInUser(user);
        } else {
            console.log('Người dùng chưa đăng nhập (Khách)');
            updateUIForGuest();
        }
    });

    // Cài đặt các sự kiện click
    setupEventListeners();
});

// ===== HÀM XỬ LÝ CHẶN CLICK ADMIN =====
// Hàm này dùng để hiện popup yêu cầu đăng nhập khi khách bấm vào link Admin
const handleAdminClick = (e) => {
    e.preventDefault(); // Ngăn không cho chuyển trang
    showLoginRequiredPopup(); // Hiện popup
};

// ===== CẬP NHẬT GIAO DIỆN (UI UPDATES) =====

// Trường hợp 1: Khi ĐÃ đăng nhập
function updateUIForLoggedInUser(user) {
    // 1. Đổi nút "Đăng nhập" thành "Đăng xuất"
    navLoginBtn.textContent = 'Đăng Xuất';
    navLoginBtn.href = '#';
    navLoginBtn.classList.add('is-logged-in'); // Thêm class đánh dấu để xử lý click đăng xuất

    // 2. Mở khóa TẤT CẢ link Admin (Menu + Footer)
    adminLinks.forEach(link => {
        link.href = 'admin.html';
        link.style.opacity = '1';
        link.style.cursor = 'pointer';
        // Quan trọng: Gỡ bỏ sự kiện chặn click nếu có
        link.removeEventListener('click', handleAdminClick);
    });

    // 3. Ẩn link đăng nhập thừa ở footer
    footerLoginLinks.forEach(link => link.style.display = 'none');
}

// Trường hợp 2: Khi CHƯA đăng nhập (Khách)
function updateUIForGuest() {
    // 1. Đổi nút thành "Đăng nhập"
    navLoginBtn.textContent = 'Đăng Nhập';
    navLoginBtn.href = 'login.html';
    navLoginBtn.classList.remove('is-logged-in');

    // 2. Khóa TẤT CẢ link Admin -> Hiện Popup khi click
    adminLinks.forEach(link => {
        link.href = '#';
        // Thêm sự kiện click để hiện popup chặn
        link.addEventListener('click', handleAdminClick);
    });

    // 3. Hiện link đăng nhập ở footer
    footerLoginLinks.forEach(link => link.style.display = 'block');
}

// ===== CÀI ĐẶT SỰ KIỆN (EVENT HANDLERS) =====

function setupEventListeners() {
    // 1. Xử lý nút Đăng nhập/Đăng xuất trên menu
    navLoginBtn.addEventListener('click', (e) => {
        // Nếu đang có class 'is-logged-in' nghĩa là nút đang đóng vai trò Đăng xuất
        if (navLoginBtn.classList.contains('is-logged-in')) {
            e.preventDefault();
            showLogoutConfirmation(); // Hiện popup xác nhận đăng xuất
        }
        // Ngược lại thì để mặc định thẻ <a> chuyển sang trang login.html
    });

    // 2. Xử lý Mobile Menu (Nút Hamburger)
    if (hamburgerMenu) {
        hamburgerMenu.addEventListener('click', toggleMobileMenu);
    }
    if (navOverlay) {
        navOverlay.addEventListener('click', closeMobileMenu);
    }

    // 3. Xử lý các nút CTA "Bắt đầu ngay" ở giữa trang
    actionButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const user = auth.currentUser;
            if (user) {
                window.location.href = 'admin.html'; // Đã login -> vào Admin
            } else {
                window.location.href = 'login.html'; // Chưa login -> vào Login
            }
        });
    });

    // Xử lý nút Liên Hệ
    if (contactLink) {
        contactLink.addEventListener('click', (e) => {
            e.preventDefault();
            showContactPopup();
        });
    }
}

// ===== LOGIC POPUP (MODALS) =====

// --- A. Popup Đăng xuất ---
function showLogoutConfirmation() {
    const overlay = document.getElementById('logout-popup-overlay');
    const popup = document.getElementById('logout-popup');
    
    overlay.classList.add('active');
    popup.classList.add('active');

    // Gán sự kiện cho nút "Hủy"
    document.getElementById('cancel-logout').onclick = closeLogoutPopup;
    
    // Gán sự kiện cho nút "Đồng ý Đăng xuất"
    document.getElementById('confirm-logout').onclick = async () => {
        try {
            await signOut(auth);
            console.log(' Đăng xuất thành công');
            closeLogoutPopup();
            // Không cần reload trang, onAuthStateChanged sẽ tự chạy lại và cập nhật UI về dạng Khách
        } catch (error) {
            alert('Lỗi đăng xuất: ' + error.message);
        }
    };
}

function closeLogoutPopup() {
    const overlay = document.getElementById('logout-popup-overlay');
    const popup = document.getElementById('logout-popup');
    if(overlay) overlay.classList.remove('active');
    if(popup) popup.classList.remove('active');
}

// --- B. Popup Yêu cầu Đăng nhập (Tạo bằng JS) ---
function showLoginRequiredPopup() {
    // Kiểm tra nếu popup đã tồn tại thì không tạo thêm
    if (document.getElementById('login-req-overlay')) return;

    // Tạo lớp phủ mờ (Overlay)
    const overlay = document.createElement('div');
    overlay.id = 'login-req-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 2000; display: flex;
        justify-content: center; align-items: center;
    `;

    // Tạo hộp thoại Popup
    const popup = document.createElement('div');
    popup.style.cssText = `
        background: white; padding: 30px; border-radius: 12px;
        text-align: center; max-width: 350px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    `;
    popup.innerHTML = `
        <h3 style="margin-bottom:15px; color:#333; font-family:inherit;"> Yêu Cầu Đăng Nhập</h3>
        <p style="margin-bottom:20px; color:#666; font-family:inherit;">Bạn cần đăng nhập để truy cập trang Quản Trị.</p>
        <div style="display:flex; gap:10px; justify-content:center;">
            <button id="btn-cancel-login" style="padding:8px 20px; border:1px solid #ddd; background:#f8f9fa; border-radius:6px; cursor:pointer; font-family:inherit;">Hủy</button>
            <button id="btn-go-login" style="padding:8px 20px; background:var(--primary-color, #007bff); color:white; border:none; border-radius:6px; cursor:pointer; font-family:inherit;">Đăng Nhập</button>
        </div>
    `;

    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    // Xử lý sự kiện nút trong Popup
    document.getElementById('btn-cancel-login').onclick = () => overlay.remove();
    document.getElementById('btn-go-login').onclick = () => window.location.href = 'login.html';
    
    // Bấm ra ngoài thì đóng popup
    overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
}

// ===== LOGIC MOBILE MENU =====
function toggleMobileMenu() {
    hamburgerMenu.classList.toggle('active');
    navMenu.classList.toggle('active');
    navOverlay.classList.toggle('active');
    // Khóa cuộn trang khi mở menu
    document.body.style.overflow = navMenu.classList.contains('active') ? 'hidden' : '';
}

function closeMobileMenu() {
    hamburgerMenu.classList.remove('active');
    navMenu.classList.remove('active');
    navOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

// ===== LOGIC POPUP LIÊN HỆ =====
function showContactPopup() {
    const overlay = document.getElementById('contact-popup-overlay');
    const popup = document.getElementById('contact-popup');
    
    if (overlay && popup) {
        overlay.classList.add('active');
        popup.classList.add('active');
        
        // Sự kiện đóng
        document.getElementById('close-contact-popup').onclick = closeContactPopup;
        overlay.onclick = closeContactPopup;
    }
}

function closeContactPopup() {
    const overlay = document.getElementById('contact-popup-overlay');
    const popup = document.getElementById('contact-popup');
    if (overlay) overlay.classList.remove('active');
    if (popup) popup.classList.remove('active');
}