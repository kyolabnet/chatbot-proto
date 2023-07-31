import { initializeApp } from "firebase/app"
import { getFirestore, doc, getDoc, getDocs, setDoc, collection, addDoc, updateDoc, onSnapshot, serverTimestamp, query, orderBy, limit, Timestamp, startAt, endAt } from "firebase/firestore"

const firebaseConfig = {
  apiKey: "AIzaSyAxlz1wCXrBM0WhGk8FYptwEhhYvkokEwI",
  authDomain: "socrates-7ef66.firebaseapp.com",
  projectId: "socrates-7ef66",
  storageBucket: "socrates-7ef66.appspot.com",
  messagingSenderId: "235086398434",
  appId: "1:235086398434:web:3ba62a41db7adbca276fbb",
  measurementId: "G-87S40MCCRM"
}

const firebaseApp = initializeApp(firebaseConfig)
const db = getFirestore();

export const firestore = {
  db,
  doc,
  getDoc,
  getDocs,
  setDoc,
  collection,
  addDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  limit,
  Timestamp,
  startAt,
  endAt
}

