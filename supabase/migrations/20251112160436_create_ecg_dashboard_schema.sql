/*
  # ECG Dashboard Database Schema
  
  ## Overview
  Creates the complete database structure for an ECG monitoring system with patient management,
  real-time ECG data streaming, session recording, and AI predictions.
  
  ## Tables Created
  
  ### 1. patients
  Stores patient demographic and medical information
  - `id` (uuid, primary key) - Unique patient identifier
  - `user_id` (uuid, foreign key) - Links to authenticated user
  - `name` (text) - Patient full name
  - `age` (integer) - Patient age
  - `gender` (text) - Patient gender
  - `weight` (numeric) - Weight in kg
  - `height` (numeric) - Height in cm
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp
  
  ### 2. ecg_data
  Stores real-time ECG readings
  - `id` (uuid, primary key) - Unique reading identifier
  - `patient_id` (uuid, foreign key) - Links to patient
  - `session_id` (uuid, foreign key) - Links to recording session
  - `ecg_value` (integer) - Raw ECG sensor value
  - `timestamp` (timestamptz) - Reading timestamp
  
  ### 3. ecg_sessions
  Tracks ECG recording sessions
  - `id` (uuid, primary key) - Unique session identifier
  - `patient_id` (uuid, foreign key) - Links to patient
  - `start_time` (timestamptz) - Session start time
  - `end_time` (timestamptz) - Session end time
  - `duration` (integer) - Duration in seconds
  - `status` (text) - Session status (active/completed/stopped)
  - `created_at` (timestamptz) - Record creation timestamp
  
  ### 4. predictions
  Stores AI model predictions for ECG sessions
  - `id` (uuid, primary key) - Unique prediction identifier
  - `session_id` (uuid, foreign key) - Links to ECG session
  - `patient_id` (uuid, foreign key) - Links to patient
  - `predicted_class` (text) - Classification result
  - `confidence` (numeric) - Prediction confidence (0-1)
  - `created_at` (timestamptz) - Prediction timestamp
  
  ## Security
  
  - Row Level Security (RLS) enabled on all tables
  - Users can only access their own patient data
  - Authenticated users required for all operations
  
  ## Indexes
  
  - Patient lookup by user_id
  - ECG data lookup by patient_id and session_id
  - Session lookup by patient_id
  - Prediction lookup by session_id
*/

-- Create patients table
CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  age integer NOT NULL CHECK (age > 0 AND age < 150),
  gender text NOT NULL CHECK (gender IN ('Male', 'Female', 'Other')),
  weight numeric(5,2) CHECK (weight > 0),
  height numeric(5,2) CHECK (height > 0),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Create ecg_sessions table
CREATE TABLE IF NOT EXISTS ecg_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  start_time timestamptz DEFAULT now() NOT NULL,
  end_time timestamptz,
  duration integer DEFAULT 0,
  status text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'stopped')),
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create ecg_data table
CREATE TABLE IF NOT EXISTS ecg_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  session_id uuid REFERENCES ecg_sessions(id) ON DELETE CASCADE NOT NULL,
  ecg_value integer NOT NULL,
  timestamp timestamptz DEFAULT now() NOT NULL
);

-- Create predictions table
CREATE TABLE IF NOT EXISTS predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES ecg_sessions(id) ON DELETE CASCADE NOT NULL,
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  predicted_class text NOT NULL,
  confidence numeric(3,2) CHECK (confidence >= 0 AND confidence <= 1),
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_patients_user_id ON patients(user_id);
CREATE INDEX IF NOT EXISTS idx_ecg_data_patient_id ON ecg_data(patient_id);
CREATE INDEX IF NOT EXISTS idx_ecg_data_session_id ON ecg_data(session_id);
CREATE INDEX IF NOT EXISTS idx_ecg_sessions_patient_id ON ecg_sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_predictions_session_id ON predictions(session_id);
CREATE INDEX IF NOT EXISTS idx_predictions_patient_id ON predictions(patient_id);

-- Enable Row Level Security
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecg_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecg_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for patients table
CREATE POLICY "Users can view own patients"
  ON patients FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own patients"
  ON patients FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own patients"
  ON patients FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own patients"
  ON patients FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for ecg_sessions table
CREATE POLICY "Users can view own sessions"
  ON ecg_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM patients
      WHERE patients.id = ecg_sessions.patient_id
      AND patients.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own sessions"
  ON ecg_sessions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM patients
      WHERE patients.id = ecg_sessions.patient_id
      AND patients.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own sessions"
  ON ecg_sessions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM patients
      WHERE patients.id = ecg_sessions.patient_id
      AND patients.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM patients
      WHERE patients.id = ecg_sessions.patient_id
      AND patients.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own sessions"
  ON ecg_sessions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM patients
      WHERE patients.id = ecg_sessions.patient_id
      AND patients.user_id = auth.uid()
    )
  );

-- RLS Policies for ecg_data table
CREATE POLICY "Users can view own ecg data"
  ON ecg_data FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM patients
      WHERE patients.id = ecg_data.patient_id
      AND patients.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own ecg data"
  ON ecg_data FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM patients
      WHERE patients.id = ecg_data.patient_id
      AND patients.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own ecg data"
  ON ecg_data FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM patients
      WHERE patients.id = ecg_data.patient_id
      AND patients.user_id = auth.uid()
    )
  );

-- RLS Policies for predictions table
CREATE POLICY "Users can view own predictions"
  ON predictions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM patients
      WHERE patients.id = predictions.patient_id
      AND patients.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own predictions"
  ON predictions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM patients
      WHERE patients.id = predictions.patient_id
      AND patients.user_id = auth.uid()
    )
  );