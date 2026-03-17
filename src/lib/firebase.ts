import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// --- PASTE YOUR FIREBASE WEB CONFIG HERE ---
// --- THE PROFESSIONAL WAY: Use Environment Variables ---
// Standard Vite React pattern (import.meta.env)
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const isConfigured = !!(firebaseConfig.apiKey && firebaseConfig.databaseURL);

let app;
let database: any = null;

if (isConfigured) {
    try {
        app = initializeApp(firebaseConfig);
        database = getDatabase(app);
        console.log("Firebase initialized successfully with:", firebaseConfig.databaseURL);
    } catch (error) {
        console.error("Firebase initialization error:", error);
    }
} else {
    console.warn("Firebase is not configured! Missing VITE_FIREBASE_API_KEY or VITE_FIREBASE_DATABASE_URL in .env");
    console.log("Current Config:", {
        hasApiKey: !!firebaseConfig.apiKey,
        hasDbUrl: !!firebaseConfig.databaseURL,
        projectId: firebaseConfig.projectId
    });
}

export { database };
