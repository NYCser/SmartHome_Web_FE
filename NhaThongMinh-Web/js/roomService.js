// js/roomService.js  — FIXED
// ════════════════════════════════════════════════════════════════
// FIXES:
//   BUG-H-02: sendDeviceCommand() gửi cả "room" và "roomId" để Pi
//             không bỏ qua lệnh do sai tên trường.
//   BUG-H-03: getRoomsFresh() — nếu query userId không trả về rooms
//             (Pi chưa sync userId), fallback lấy tất cả rooms để
//             dashboard không bị trắng. Hiển thị warning nếu cần.
// ════════════════════════════════════════════════════════════════

import { auth, db } from './firebase-config.js';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  getDoc,
  setDoc
} from "./firebase-config.js";

class RoomService {
  constructor() {
    this.auth = auth;
    this.db = db;
    this.activeListeners = new Map();
  }

  getCurrentUserId() {
    const user = this.auth.currentUser;
    if (!user) return null;
    return user.uid;
  }

  // ===== REFERENCE GETTERS =====
  getRoomsRef() { return collection(this.db, 'rooms'); }
  getRoomRef(roomId) { return doc(this.db, 'rooms', roomId); }
  getRoomDevicesRef(roomId) { return collection(this.db, 'rooms', roomId, 'devices'); }
  getRoomSensorsRef(roomId) { return collection(this.db, 'rooms', roomId, 'sensors'); }
  getCommandsRef() { return collection(this.db, 'commands'); }

  // ===== ROOM OPERATIONS =====
  async getRoomDetails(roomId) {
    try {
      const roomDoc = await getDoc(this.getRoomRef(roomId));
      return roomDoc.exists() ? { id: roomDoc.id, ...roomDoc.data() } : null;
    } catch (error) {
      console.error("Error getting room details:", error);
      throw error;
    }
  }

  /**
   * FIX BUG-H-03: Nếu query theo userId không có kết quả
   * (Pi chưa sync userId vào Firestore rooms), fallback lấy tất cả rooms.
   * Giúp dashboard không bị trắng trong lần đầu setup.
   */
  async getRoomsFresh() {
    try {
      const userId = this.getCurrentUserId();
      if (!userId) return [];

      // Thử query theo userId trước (đúng cách)
      const q = query(
        this.getRoomsRef(),
        where("userId", "==", userId),
        orderBy("createdAt", "asc")
      );
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const rooms = [];
        querySnapshot.forEach((doc) => rooms.push({ id: doc.id, ...doc.data() }));
        console.log('Rooms loaded (by userId):', rooms.length);
        return rooms;
      }

      // FIX BUG-H-03: Fallback — Pi chưa set userId → lấy tất cả rooms
      console.warn('Không tìm thấy rooms với userId. Fallback: lấy tất cả rooms.');
      console.warn('   → Hãy cấu hình PI_OWNER_UID trong .env của Raspberry Pi.');
      const allSnap = await getDocs(this.getRoomsRef());
      const allRooms = [];
      allSnap.forEach((doc) => allRooms.push({ id: doc.id, ...doc.data() }));
      console.log('Rooms loaded (fallback, all):', allRooms.length);
      return allRooms;

    } catch (error) {
      console.error('Error getting fresh rooms:', error);
      // Nếu lỗi query (thiếu index), thử lấy tất cả không orderBy
      try {
        const allSnap = await getDocs(this.getRoomsRef());
        const rooms = [];
        allSnap.forEach((doc) => rooms.push({ id: doc.id, ...doc.data() }));
        return rooms;
      } catch (e2) {
        throw error;
      }
    }
  }

  async updateRoom(roomId, roomData) {
    try {
      await updateDoc(this.getRoomRef(roomId), { ...roomData, updatedAt: serverTimestamp() });
    } catch (error) { console.error('Error updating room:', error); throw error; }
  }

  /**
   * [NEW] Tạo phòng mới.
   * LƯU Ý QUAN TRỌNG: roomId (doc ID) PHẢI khớp chính xác với room_id
   * đã cấu hình trong firmware ESP32 (vd: "bedroom_02"), vì Pi/ESP32 dùng
   * giá trị này làm topic MQTT: home/<roomId>/... . Nếu không khớp,
   * thiết bị vật lý sẽ không gửi/nhận được dữ liệu cho phòng này.
   */
  async createRoom(roomId, roomData) {
    try {
      const cleanId = (roomId || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (!cleanId) throw new Error('Mã phòng không hợp lệ. Chỉ dùng chữ thường, số và dấu gạch dưới.');

      const roomRef = this.getRoomRef(cleanId);
      const existing = await getDoc(roomRef);
      if (existing.exists()) {
        throw new Error(`Mã phòng "${cleanId}" đã tồn tại. Vui lòng chọn mã khác.`);
      }

      const userId = this.getCurrentUserId();
      await setDoc(roomRef, {
        name: roomData.name || cleanId,
        roomType: roomData.roomType || 'BEDROOM',
        userId: userId || null,
        deviceCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      console.log(`Room created: ${cleanId}`);
      return cleanId;
    } catch (error) {
      console.error('Error creating room:', error);
      throw error;
    }
  }

  /**
   * [NEW] Xóa phòng cùng toàn bộ dữ liệu con (devices, sensors).
   * Firestore không tự cascade-delete subcollection ở client SDK nên
   * phải xóa thủ công từng doc con trước khi xóa doc phòng chính.
   * LƯU Ý: thao tác này chỉ gỡ phòng khỏi giao diện quản lý/Firestore,
   * KHÔNG xóa cấu hình vật lý trên ESP32 — nếu node vẫn publish MQTT,
   * Pi có thể tự tạo lại room này khi nhận dữ liệu mới.
   */
  async deleteRoom(roomId) {
    try {
      const devicesSnap = await getDocs(this.getRoomDevicesRef(roomId));
      await Promise.all(devicesSnap.docs.map(d => deleteDoc(d.ref)));

      const sensorsSnap = await getDocs(this.getRoomSensorsRef(roomId));
      await Promise.all(sensorsSnap.docs.map(d => deleteDoc(d.ref)));

      await deleteDoc(this.getRoomRef(roomId));
      console.log(`Room ${roomId} và toàn bộ dữ liệu con đã được xóa.`);
    } catch (error) {
      console.error('Error deleting room:', error);
      throw error;
    }
  }

  // ===== DEVICE READ =====
  async getDevices(roomId) {
    try {
      const querySnapshot = await getDocs(this.getRoomDevicesRef(roomId));
      const devices = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        devices.push({
          id: doc.id,
          name: data.name || 'Thiết bị',
          type: data.type || 'unknown',
          status: data.status || 'offline',
          isOn: data.isOn || false,
          details: data.details || '',
          icon: data.icon || ''
        });
      });
      return devices;
    } catch (error) {
      console.error('Error getting devices:', error);
      throw error;
    }
  }

  // ===== DEVICE CONTROL =====
  /**
   * FIX BUG-H-02: Gửi cả "room" VÀ "roomId" trong command document.
   * Pi (automation_engine) đọc "room", Web và Firebase đọc "roomId".
   * Gửi cả hai đảm bảo tương thích với mọi version.
   */
  async sendDeviceCommand(roomId, deviceId, isOn, deviceType = '') {
    try {
      const userId = this.getCurrentUserId();
      const cmdRef = await addDoc(this.getCommandsRef(), {
        action: isOn ? 'turn_on' : 'turn_off',
        room: roomId,       // FIX BUG-H-02: Pi đọc "room"
        roomId: roomId,       // FIX BUG-H-02: backward compat
        room_id: roomId,
        device: deviceId,
        deviceId: deviceId,
        device_id: deviceId,     // Pi đọc "device_id"
        deviceType: deviceType,
        isOn: isOn,
        requestedBy: userId || 'web',
        status: 'pending',
        timestamp: serverTimestamp()
      });
      console.log(`Command sent: ${isOn ? 'ON' : 'OFF'} → ${roomId}/${deviceId} [${cmdRef.id}]`);
      return cmdRef.id;
    } catch (error) {
      console.error('Error sending device command:', error);
      throw error;
    }
  }

  /**
   * [FIX] Gửi lệnh set_auto_mode để giải phóng manual override trên Pi.
   * Gọi hàm này khi user muốn cho phép automation điều khiển lại thiết bị.
   */
  async setAutoMode(roomId, deviceId) {
    try {
      const userId = this.getCurrentUserId();
      const cmdRef = await addDoc(this.getCommandsRef(), {
        action: 'set_auto_mode',
        room: roomId,
        roomId: roomId,
        room_id: roomId,
        device: deviceId,
        deviceId: deviceId,
        device_id: deviceId,
        requestedBy: userId || 'web',
        status: 'pending',
        timestamp: serverTimestamp()
      });
      console.log(`Auto mode restored: ${roomId}/${deviceId} [${cmdRef.id}]`);
      return cmdRef.id;
    } catch (error) {
      console.error('Error setting auto mode:', error);
      throw error;
    }
  }

  /** @deprecated Dùng sendDeviceCommand() */
  async updateDevice(roomId, deviceId, deviceData) {
    const isOn = deviceData.isOn !== undefined ? deviceData.isOn : false;
    return this.sendDeviceCommand(roomId, deviceId, isOn, deviceData.type || '');
  }

  /**
   * [FIX] Tách roomId (vd: "bedroom_02") thành phần tên (base) và số thứ tự.
   * bedroom_02 → { base: "bedroom", number: 2 }
   */
  _extractRoomParts(roomId) {
    const match = (roomId || '').match(/^(.+?)_?(\d+)$/);
    if (match) return { base: match[1], number: parseInt(match[2], 10) };
    return { base: roomId, number: 1 };
  }

  /**
   * [FIX] Viết tắt chuẩn cho từng loại phòng, dùng để đặt tên device ID.
   * Đúng chuẩn hệ thống hiện có: bedroom → "bd" (vd: fan_bd_1, light_bd_1).
   * Thêm phòng mới thì bổ sung mapping tương ứng ở đây.
   */
  _getRoomAbbrev(base) {
    const map = {
      bedroom: 'bd',
      kitchen: 'kt',
      living_room: 'lr',
      bathroom: 'bt',
      entrance: 'et',
      garage: 'gr'
    };
    if (map[base]) return map[base];
    // Fallback: ghép chữ cái đầu mỗi từ (vd: "guest_room" -> "gr")
    const fallback = base.split('_').map(w => w[0]).join('').toLowerCase();
    return fallback || base.slice(0, 2).toLowerCase();
  }

  /**
   * [FIX] Sinh device ID đúng chuẩn hệ thống: <type>_<viết tắt phòng>_<số phòng>
   * Dùng setDoc() với ID xác định thay vì addDoc() (tránh sinh ID ngẫu nhiên
   * như "Jwl0e6qAMnazi3PLVEvM" không đúng quy ước).
   * Nếu ID đã tồn tại (vd: 2 quạt cùng phòng), tự thêm hậu tố _2, _3...
   */
  async addDevice(roomId, deviceData) {
    try {
      const type = (deviceData.type || 'device').toLowerCase();
      const { base, number } = this._extractRoomParts(roomId);
      const abbrev = this._getRoomAbbrev(base);
      const baseDeviceId = `${type}_${abbrev}_${number}`;

      const devicesRef = this.getRoomDevicesRef(roomId);
      let finalId = baseDeviceId;
      let suffix = 2;
      while ((await getDoc(doc(devicesRef, finalId))).exists()) {
        finalId = `${baseDeviceId}_${suffix}`;
        suffix++;
      }

      const data = { ...deviceData, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      await setDoc(doc(devicesRef, finalId), data);
      await this.updateRoomDeviceCount(roomId);

      console.log(`Device created: ${roomId}/${finalId}`);
      return finalId;
    } catch (error) { console.error('Error adding device:', error); throw error; }
  }

  // ===== SENSOR READ =====
  async getSensorsSnapshot(roomId) {
    try {
      const snapshot = await getDocs(this.getRoomSensorsRef(roomId));
      const sensors = {};
      snapshot.forEach(doc => { sensors[doc.id] = doc.data().value; });
      return sensors;
    } catch (error) { console.error('Error getting sensors:', error); return {}; }
  }

  /**
   * Realtime listener cho sensors của 1 phòng.
   * Tự động cleanup khi gọi unsubscribeAll().
   */
  subscribeSensors(roomId, callback) {
    const key = `sensors_${roomId}`;
    if (this.activeListeners.has(key)) return;
    const unsub = onSnapshot(this.getRoomSensorsRef(roomId), (snap) => {
      const sensors = {};
      snap.forEach(doc => { sensors[doc.id] = doc.data(); });
      callback(sensors);
    });
    this.activeListeners.set(key, unsub);
  }

  /**
   * Realtime listener cho devices của 1 phòng.
   */
  subscribeDevices(roomId, callback) {
    const key = `devices_${roomId}`;
    if (this.activeListeners.has(key)) return;
    const unsub = onSnapshot(this.getRoomDevicesRef(roomId), (snap) => {
      const devices = [];
      snap.forEach(doc => {
        const data = doc.data();
        devices.push({
          id: doc.id,
          name: data.name || 'Thiết bị',
          type: data.type || 'unknown',
          status: data.status || 'offline',
          isOn: data.isOn || false,
          details: data.details || '',
        });
      });
      callback(devices);
    });
    this.activeListeners.set(key, unsub);
  }

  // ===== UTILITIES =====
  async updateRoomDeviceCount(roomId) {
    try {
      const devices = await this.getDevices(roomId);
      await updateDoc(this.getRoomRef(roomId), {
        deviceCount: devices.length,
        updatedAt: serverTimestamp()
      });
    } catch (error) { console.error('Update count error:', error); }
  }

  unsubscribeAll() {
    this.activeListeners.forEach(unsub => unsub());
    this.activeListeners.clear();
  }

  // ===== AUTOMATION & SCHEDULE =====
  async saveAutomation(userId, roomId, settings) {
    try {
      const docId = `${userId}_${roomId}`;
      const automationRef = doc(this.db, 'automations', docId);
      await setDoc(automationRef, {
        ...settings,
        userId,
        roomId,
        updatedAt: serverTimestamp()
      }, { merge: true });
      console.log("Automation saved:", docId);
    } catch (error) { console.error("Error saving automation:", error); throw error; }
  }

  async saveSchedule(userId, roomId, deviceId, scheduleData) {
    try {
      const docId = `${userId}_${roomId}_${deviceId}_${Date.now()}`;
      const schedRef = doc(this.db, 'schedules', docId);
      await setDoc(schedRef, {
        ...scheduleData,
        userId,
        roomId,
        deviceId,
        updatedAt: serverTimestamp()
      });
      console.log("Schedule saved:", docId);
      return docId;
    } catch (error) { console.error("Error saving schedule:", error); throw error; }
  }
}

const roomServiceInstance = new RoomService();
export default roomServiceInstance;