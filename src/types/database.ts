export interface Patient {
  id: string;
  user_id: string;
  name: string;
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  weight?: number;
  height?: number;
  created_at: string;
  updated_at: string;
}

export interface ECGSession {
  id: string;
  patient_id: string;
  start_time: string;
  end_time?: string;
  duration: number;
  status: 'active' | 'completed' | 'stopped';
  created_at: string;
}

export interface ECGData {
  id: string;
  patient_id: string;
  session_id: string;
  ecg_value: number;
  timestamp: string;
}

export interface Prediction {
  id: string;
  session_id: string;
  patient_id: string;
  predicted_class: string;
  confidence: number;
  created_at: string;
}
