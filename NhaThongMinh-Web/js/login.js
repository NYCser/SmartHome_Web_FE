// js/login.js
import { auth, db } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { 
    doc, 
    setDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// ===== BIẾN TRẠNG THÁI =====
let isLoading = false; // Để chặn click nhiều lần

// ===== KHỞI TẠO (INITIALIZATION) =====
document.addEventListener('DOMContentLoaded', () => {
    // 1. Tự động kiểm tra đăng nhập
    onAuthStateChanged(auth, (user) => {
        if (user) {
            console.log(' Đã đăng nhập:', user.email);
            // Nếu đã đăng nhập, chuyển thẳng vào trang Admin
            window.location.href = 'admin.html';
        }
    });

    // 2. Cài đặt sự kiện (Click, Submit)
    setupEventListeners();
});

function setupEventListeners() {
    // Nút chuyển đổi qua lại giữa Login và Register
    document.getElementById('showRegister').addEventListener('click', toggleAuthMode);
    document.getElementById('showLogin').addEventListener('click', toggleAuthMode);

    // Xử lý khi bấm nút "Đăng nhập" / "Đăng ký"
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);

    // Xử lý Real-time: Xóa thông báo lỗi ngay khi người dùng nhập lại
    ['loginForm', 'registerForm'].forEach(formId => {
        document.getElementById(formId).addEventListener('input', (e) => {
            const formGroup = e.target.closest('.form-group');
            // Nếu ô này đang đỏ (lỗi), nhập vào thì bỏ đỏ đi
            if (formGroup && formGroup.classList.contains('error')) {
                formGroup.classList.remove('error');
                const errorSpan = formGroup.querySelector('.field-error');
                if (errorSpan) errorSpan.remove();
            }
        });
    });

    // Nút Google (Chưa code logic thật, chỉ hiện thông báo)
    document.querySelector('.btn-google').addEventListener('click', () => {
        showError('Tính năng đăng nhập Google đang được bảo trì.');
    });
}

// ===== LOGIC UI: CHUYỂN ĐỔI MÀN HÌNH =====
function toggleAuthMode(e) {
    e.preventDefault(); // Chặn load lại trang
    const loginCard = document.querySelector('.auth-card:first-child');
    const registerCard = document.getElementById('registerCard');

    if (registerCard.classList.contains('hidden')) {
        // -> Chuyển sang Đăng Ký
        loginCard.classList.add('hidden');
        registerCard.classList.remove('hidden');
        clearFieldErrors('registerForm'); // Xóa lỗi cũ
    } else {
        // -> Chuyển về Đăng Nhập
        registerCard.classList.add('hidden');
        loginCard.classList.remove('hidden');
        clearFieldErrors('loginForm');
    }
}

// ===== LOGIC XỬ LÝ ĐĂNG NHẬP (FIREBASE) =====
async function handleLogin(e) {
    e.preventDefault();
    if (isLoading) return; // Nếu đang xử lý thì không làm gì
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    
    // Reset giao diện
    clearMessages();
    clearFieldErrors('loginForm');
    
    // Kiểm tra dữ liệu đầu vào (Validation)
    let hasError = false;
    if (!email.trim()) { showFieldError('email', 'Vui lòng nhập email'); hasError = true; }
    if (!password) { showFieldError('password', 'Vui lòng nhập mật khẩu'); hasError = true; }
    if (hasError) return;
    
    try {
        // Bật trạng thái Loading
        setLoading(true, submitBtn, 'Đang đăng nhập...');
        
        // Gọi Firebase Auth
        await signInWithEmailAndPassword(auth, email, password);
        // Thành công -> onAuthStateChanged sẽ tự bắt sự kiện và chuyển trang
        
    } catch (error) {
        console.error('Login Error:', error.code);
        
        // Xử lý các mã lỗi phổ biến của Firebase
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
            showFieldError('password', 'Thông tin đăng nhập không chính xác');
        } else if (error.code === 'auth/user-not-found') {
            showFieldError('email', 'Email chưa được đăng ký');
        } else if (error.code === 'auth/too-many-requests') {
            showError('Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.');
        } else {
            showError('Lỗi: ' + translateError(error.code));
        }
        // Tắt Loading
        setLoading(false, submitBtn, 'Đăng Nhập');
    }
}

// ===== LOGIC XỬ LÝ ĐĂNG KÝ (FIREBASE) =====
async function handleRegister(e) {
    e.preventDefault();
    if (isLoading) return;
    
    const fullName = document.getElementById('fullName').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const termsChecked = document.querySelector('input[name="terms"]').checked;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    
    clearMessages();
    clearFieldErrors('registerForm');
    
    // --- VALIDATION ---
    let hasError = false;
    if (!fullName.trim()) { showFieldError('fullName', 'Vui lòng nhập họ tên'); hasError = true; }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim()) { showFieldError('regEmail', 'Vui lòng nhập email'); hasError = true; }
    else if (!emailRegex.test(email)) { showFieldError('regEmail', 'Email không hợp lệ'); hasError = true; }
    
    if (!password) { showFieldError('regPassword', 'Vui lòng nhập mật khẩu'); hasError = true; }
    else if (password.length < 6) { showFieldError('regPassword', 'Mật khẩu tối thiểu 6 ký tự'); hasError = true; }
    
    if (password !== confirmPassword) { showFieldError('confirmPassword', 'Mật khẩu xác nhận không khớp'); hasError = true; }
    
    if (!termsChecked) { showError('Bạn cần đồng ý với điều khoản sử dụng'); hasError = true; }
    
    if (hasError) return;
    
    // --- CALL FIREBASE ---
    try {
        setLoading(true, submitBtn, 'Đang đăng ký...');
        
        // 1. Tạo User trên Firebase Auth
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        // 2. Lưu thêm thông tin phụ vào Firestore (Collection 'users')
        await setDoc(doc(db, "users", user.uid), {
            fullName: fullName.trim(),
            email: email,
            createdAt: serverTimestamp(),
            role: "user" // Mặc định là user thường
        });
        
        showSuccess('Đăng ký thành công! Đang chuyển hướng...');
        
    } catch (error) {
        console.error('Register Error:', error.code);
        if (error.code === 'auth/email-already-in-use') {
            showFieldError('regEmail', 'Email này đã được sử dụng');
        } else {
            showError(translateError(error.code));
        }
        setLoading(false, submitBtn, 'Đăng Ký');
    }
}

// ===== CÁC HÀM TIỆN ÍCH (UTILS) =====

// Bật/Tắt trạng thái Loading của nút bấm
function setLoading(state, btn, text) {
    isLoading = state;
    btn.disabled = state;
    btn.textContent = text;
}

// Hiển thị lỗi đỏ dưới ô input
function showFieldError(fieldId, message) {
    const field = document.getElementById(fieldId);
    const formGroup = field.closest('.form-group');
    formGroup.classList.add('error');
    
    let errorSpan = formGroup.querySelector('.field-error');
    if (!errorSpan) {
        errorSpan = document.createElement('span');
        errorSpan.className = 'field-error';
        formGroup.appendChild(errorSpan);
    }
    errorSpan.textContent = message;
}

// Xóa hết lỗi đỏ trong form
function clearFieldErrors(formId) {
    const form = document.getElementById(formId);
    form.querySelectorAll('.form-group.error').forEach(group => {
        group.classList.remove('error');
        const span = group.querySelector('.field-error');
        if(span) span.remove();
    });
}

// Hiện thông báo lỗi chung (trên đầu form)
function showError(message) { showMessage(message, 'error-message'); }

// Hiện thông báo thành công
function showSuccess(message) { showMessage(message, 'success-message'); }

function showMessage(message, className) {
    const div = document.createElement('div');
    div.className = className;
    div.textContent = message;
    
    const activeCard = document.querySelector('.auth-card:not(.hidden)');
    const form = activeCard.querySelector('.auth-form');
    activeCard.insertBefore(div, form); // Chèn thông báo trước form
    
    setTimeout(() => div.remove(), 5000); // Tự xóa sau 5s
}

function clearMessages() {
    document.querySelectorAll('.error-message, .success-message').forEach(el => el.remove());
}

// Dịch mã lỗi Firebase sang tiếng Việt
function translateError(code) {
    const map = {
        'auth/network-request-failed': 'Lỗi kết nối mạng',
        'auth/internal-error': 'Lỗi hệ thống',
    };
    return map[code] || 'Đã có lỗi xảy ra (' + code + ')';
}