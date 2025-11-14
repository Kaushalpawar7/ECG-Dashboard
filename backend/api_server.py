# ECG-Dashboard/backend/api_server.py (Final Fix: Reading Latest Dynamic Key)

import os
import time
import threading
from flask import Flask, request, jsonify
from flask_cors import CORS
from supabase import create_client, Client
from dotenv import load_dotenv
import firebase_admin 
from firebase_admin import credentials, db 

# --- 1. CONFIGURATION & INITIALIZATION ---
load_dotenv('.env')

# Supabase Config
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

# Firebase Config
FIREBASE_DB_URL = os.getenv("FIREBASE_DB_URL")
FIREBASE_CRED_PATH = os.getenv("FIREBASE_CRED_PATH")
# CRITICAL FIX: Set path to the root of the data list (no final 'current_value')
FIREBASE_ECG_ROOT_PATH = "" # Assuming the dynamic timestamp keys are at the database root.
# NOTE: If your data is nested (e.g., inside 'ecg_data'), set this to "ecg_data"
# Based on the screenshot, we assume the keys are at the root, so we use "" 

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise Exception("Missing Supabase credentials in .env")
if not FIREBASE_DB_URL or not FIREBASE_CRED_PATH:
    raise Exception("Missing Firebase credentials in .env")

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# Initialize Firebase Admin SDK
try:
    cred = credentials.Certificate(FIREBASE_CRED_PATH)
    firebase_admin.initialize_app(cred, {
        'databaseURL': FIREBASE_DB_URL
    })
    # Get a reference to the main node containing the dynamic data
    firebase_root_ref = db.reference(FIREBASE_ECG_ROOT_PATH)
except Exception as e:
    print(f"Error initializing Firebase. Check your FIREBASE_CRED_PATH and JSON file: {e}")
    firebase_root_ref = None

# Flask App setup
app = Flask(__name__)
CORS(app)

# Dictionary to hold active stream threads: {session_id: threading.Thread}
active_workers = {}
# Flag to signal a thread to stop: {session_id: bool}
stop_flags = {}

# --- 2. ECG DATA STREAMING LOGIC ---

def read_ecg_from_firebase():
    """Reads the single latest ECG value from the dynamic Firebase stream."""
    if firebase_root_ref is None:
        return None
        
    try:
        # CRITICAL FIX: Use orderBy/limit to grab ONLY the last (newest) item
        # Since the keys are timestamps, they are naturally ordered.
        snapshot = firebase_root_ref.order_by_key().limit_to_last(1).get()
        
        if not snapshot:
            return None
        
        # Snapshot returns an OrderedDict: {'dynamic_timestamp_key': value}
        # We need the value of the first (and only) item in that OrderedDict.
        latest_key = list(snapshot.keys())[0]
        snapshot_value = snapshot[latest_key]
        
        if snapshot_value is not None:
            # Explicitly convert to integer, handling potential float/string formats
            if isinstance(snapshot_value, (int, float)):
                return int(snapshot_value)
            if isinstance(snapshot_value, str):
                return int(float(snapshot_value))
            
            print(f"Firebase Read Warning: Data at key {latest_key} was invalid type: {type(snapshot_value).__name__} ({snapshot_value})")

        return None
    except Exception as e:
        print(f"Firebase Read Error during data retrieval/conversion: {e}")
        return None

def ecg_stream_worker(patient_id: str, session_id: str):
    """
    Background worker that continuously reads ECG data from Firebase and inserts it into Supabase.
    """
    print(f"Worker for Session {session_id} started. Reading latest data from Firebase root.")
    
    stop_flags[session_id] = False

    while not stop_flags.get(session_id):
        try:
            # 1. READ DATA from Firebase
            value = read_ecg_from_firebase()
            
            if value is not None:
                # Debug log to verify value before insertion
                print(f"DEBUG: Inserting value {value} (type: {type(value).__name__}) into Supabase.")
                
                # Use current UTC time for timestamp
                timestamp = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())

                data_to_insert = {
                    "patient_id": patient_id,
                    "session_id": session_id,
                    "ecg_value": value,
                    "timestamp": timestamp,
                }

                # 2. INSERT TO SUPABASE
                response = (
                    supabase.table("ecg_data")
                    .insert(data_to_insert)
                    .execute()
                )

                if response.error:
                    print(f"Supabase Error for {session_id}: {response.error}")

            # Wait for 100ms before the next reading/insert
            time.sleep(0.1)

        except Exception as e:
            print(f"Critical Error in stream worker for {session_id}: {e}")
            break
            
    # Cleanup after loop exits
    stop_flags[session_id] = True
    if session_id in active_workers:
        del active_workers[session_id]
        
    print(f"Worker for Session {session_id} stopped.")

# --- 3. API ENDPOINTS (Unchanged) ---

@app.route('/start-stream', methods=['POST'])
def start_stream():
    """Starts a new background thread to stream ECG data for a session."""
    data = request.json
    patient_id = data.get('patient_id')
    session_id = data.get('session_id')

    if not patient_id or not session_id:
        return jsonify({"error": "Missing patient_id or session_id"}), 400

    if session_id in active_workers:
        return jsonify({"error": "Stream already active for this session"}), 409
    
    worker = threading.Thread(target=ecg_stream_worker, args=(patient_id, session_id))
    active_workers[session_id] = worker
    stop_flags[session_id] = False
    worker.start()

    return jsonify({"message": f"ECG stream started for session {session_id}"}), 200

@app.route('/stop-stream', methods=['POST'])
def stop_stream():
    """Signals a background thread to stop streaming ECG data."""
    data = request.json
    session_id = data.get('session_id')

    if not session_id or session_id not in active_workers:
        return jsonify({"error": "No active stream found for this session"}), 404

    stop_flags[session_id] = True
    
    return jsonify({"message": f"ECG stream stop signal sent for session {session_id}"}), 200

# --- 4. RUN SERVER (Unchanged) ---

if __name__ == '__main__':
    PORT = int(os.getenv("PORT", 5000))
    print(f"Starting API server on http://127.0.0.1:{PORT}")
    # Run Flask in a secure way in production (e.g., using Gunicorn)
    app.run(port=PORT, debug=True)