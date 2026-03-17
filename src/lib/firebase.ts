import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// --- PASTE YOUR FIREBASE WEB CONFIG HERE ---
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    databaseURL: "YOUR_DATABASE_URL",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const isConfigured = firebaseConfig.apiKey !== "YOUR_API_KEY" && firebaseConfig.databaseURL !== "YOUR_DATABASE_URL";

let app;
let database: any = null;

if (isConfigured) {
    try {
        app = initializeApp(firebaseConfig);
        database = getDatabase(app);
    } catch (error) {
        console.error("Firebase initialization error:", error);
    }
} else {
    console.warn("Firebase is not configured. Live ECG visualization will be disabled until src/lib/firebase.ts is updated.");
}

export { database };
