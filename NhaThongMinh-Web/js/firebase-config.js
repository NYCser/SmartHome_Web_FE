// // /web/js/firebase-config.js

// import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
// import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
// import { 
//     getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
//     getDocs, getDoc, query, where, orderBy, limit,
//     onSnapshot, serverTimestamp, setDoc
// } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// const firebaseConfig = {
//   apiKey: "AIzaSyD1yNlI-6NJW7rpH415m4d_El28lQjoiFc",
//   authDomain: "nhathongminh-myhome.firebaseapp.com",
//   projectId: "nhathongminh-myhome",
//   storageBucket: "nhathongminh-myhome.firebasestorage.app",
//   messagingSenderId: "970287587948",
//   appId: "1:970287587948:web:5a4c3b1824d8c4025fee49"
// };

// const app = initializeApp(firebaseConfig);

// const auth = getAuth(app);
// const db   = getFirestore(app);

// export {
//   auth, db,
//   onAuthStateChanged, signOut,
//   collection, doc, addDoc, updateDoc, deleteDoc,
//   getDocs, getDoc, query, where, orderBy, limit,
//   onSnapshot, serverTimestamp, setDoc
// };




// /web/js/firebase-config.js  — v2
// Thêm Realtime Database (RTDB) cho sensor realtime
// Firestore giữ nguyên cho dữ liệu cấu trúc

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
    getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import {
    getFirestore,
    collection, doc, addDoc, updateDoc, deleteDoc,
    getDocs, getDoc, query, where, orderBy, limit,
    onSnapshot, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import {
    getDatabase,
    ref as rtdbRef,
    onValue,
    off,
    set as rtdbSet,
    update as rtdbUpdate,
    get as rtdbGet,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js";

const firebaseConfig = {
    apiKey:            "AIzaSyD1yNlI-6NJW7rpH415m4d_El28lQjoiFc",
    authDomain:        "nhathongminh-myhome.firebaseapp.com",
    projectId:         "nhathongminh-myhome",
    storageBucket:     "nhathongminh-myhome.firebasestorage.app",
    messagingSenderId: "970287587948",
    appId:             "1:970287587948:web:5a4c3b1824d8c4025fee49",
    // QUAN TRỌNG: databaseURL trỏ đúng region asia-southeast1
    databaseURL:       "https://nhathongminh-myhome-default-rtdb.asia-southeast1.firebasedatabase.app",
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const rtdb = getDatabase(app);    // ← Realtime Database instance

export {
    // Auth
    auth, onAuthStateChanged, signOut,
    // Firestore
    db,
    collection, doc, addDoc, updateDoc, deleteDoc,
    getDocs, getDoc, query, where, orderBy, limit,
    onSnapshot, serverTimestamp, setDoc,
    // RTDB
    rtdb,
    rtdbRef, onValue, off, rtdbSet, rtdbUpdate, rtdbGet,
};
