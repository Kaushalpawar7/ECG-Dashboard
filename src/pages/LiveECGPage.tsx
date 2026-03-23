import { useEffect, useState, useRef } from 'react';
import { Play, Square, Wifi, WifiOff, User, AlertCircle } from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { supabase } from '../lib/supabase';
import { Patient } from '../types/database';
import { useAuth } from '../contexts/AuthContext';
import { database } from '../lib/firebase';
import { ref, onValue } from 'firebase/database';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

export function LiveECGPage() {
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ecgData, setEcgData] = useState<number[]>([]);
  const [timestamps, setTimestamps] = useState<string[]>([]);
  const [sessionDuration, setSessionDuration] = useState(0);

  // Refs for timers and connections
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const firebaseListenerRef = useRef<any>(null);
  const lastUpdateRef = useRef<number>(0);

  /**
   * Realistic ECG Generator (P-QRS-T Model)
   * Based on Gaussian synthesis for medical realism
   */
  const generateECGPoint = (time: number, age: number = 30) => {
    // 1. Calculate target BPM based on age
    const baseBPM = age < 15 ? 100 : age > 60 ? 70 : 75;
    const heartRateVariation = Math.sin(time * 0.5) * 2;
    const currentBPM = baseBPM + heartRateVariation;

    // 2. Frequency of heartbeat
    const freq = currentBPM / 60;
    const t = (time % (1 / freq)) * freq; // Phase [0, 1]

    // 3. Mathematical components of a single beat (P-QRS-T)
    const pWave = 0.1 * Math.exp(-Math.pow((t - 0.1), 2) / 0.001);
    const qrsComplex = 1.2 * Math.exp(-Math.pow((t - 0.15), 2) / 0.0001) -
      0.2 * Math.exp(-Math.pow((t - 0.14), 2) / 0.00005) -
      0.2 * Math.exp(-Math.pow((t - 0.16), 2) / 0.00005);
    const tWave = 0.25 * Math.exp(-Math.pow((t - 0.35), 2) / 0.005);

    // 4. Baseline noise and wander
    const wander = 0.05 * Math.sin(time * 2);
    const noise = (Math.random() - 0.5) * 0.02;

    const baseline = 2000;
    const amplitude = 1000;

    return baseline + (pWave + qrsComplex + tWave + wander + noise) * amplitude;
  };

  useEffect(() => {
    loadPatients();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
      if (firebaseListenerRef.current) firebaseListenerRef.current();
    };
  }, []);

  // 1. ESP32 Connection Sentinel
  useEffect(() => {
    if (!database) return;
    const sentinelRef = ref(database, '/live/ecg_value');
    const unsubscribe = onValue(sentinelRef, (snapshot) => {
      if (snapshot.exists()) {
        lastUpdateRef.current = Date.now();
        setIsConnected(true);
      }
    });

    const watchdog = setInterval(() => {
      if (Date.now() - lastUpdateRef.current > 5000) {
        setIsConnected(false);
      }
    }, 2000);

    return () => {
      unsubscribe();
      clearInterval(watchdog);
    };
  }, []);

  const loadPatients = async () => {
    try {
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      const validPatients = data || [];
      setPatients(validPatients);
      if (!selectedPatient && validPatients.length > 0) {
        setSelectedPatient(validPatients[0]);
      }
    } catch (error) {
      console.error('Error loading patients:', error);
    }
  };

  if (!isConnected) {
    alert('Error: Device Not Online. Please ensure the ESP32 is powered and connected to the network.');
    return;
  }

  try {
    const { data, error } = await supabase
      .from('ecg_sessions')
      .insert([{ patient_id: selectedPatient.id, status: 'active' }])
      .select().single();

    if (error) throw error;
    setSessionId(data.id);
    setIsRecording(true);
    setEcgData([]);
    setTimestamps([]);
    setSessionDuration(0);

    // Start Realistic Simulation
    let simTime = 0;
    intervalRef.current = setInterval(() => {
      const simVal = generateECGPoint(simTime, selectedPatient.age);
      setEcgData((prev) => [...prev, simVal].slice(-300));
      setTimestamps((prev) => [...prev, new Date().toLocaleTimeString()].slice(-300));
      simTime += 0.05;
    }, 50);

    // Duration Timer
    durationIntervalRef.current = setInterval(() => {
      setSessionDuration((prev) => prev + 1);
    }, 1000);

  } catch (error) {
    console.error('Error starting session:', error);
    setIsRecording(false);
  }
};

const stopRecording = async () => {
  if (!sessionId) return;
  try {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);

    await supabase
      .from('ecg_sessions')
      .update({
        status: 'completed',
        end_time: new Date().toISOString(),
        duration: sessionDuration,
      })
      .eq('id', sessionId);

    setIsRecording(false);
    setSessionId(null);
  } catch (error) {
    console.error('Error stopping recording:', error);
  }
};

const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const chartData = {
  labels: timestamps,
  datasets: [
    {
      label: 'ECG Signal',
      data: ecgData,
      borderColor: 'rgb(37, 99, 235)',
      backgroundColor: 'rgba(37, 99, 235, 0.1)',
      borderWidth: 2,
      tension: 0.1,
      pointRadius: (context: any) => {
        const val = context.dataset.data[context.dataIndex];
        return val > 2800 ? 5 : 0;
      },
      pointBackgroundColor: (context: any) => {
        const val = context.dataset.data[context.dataIndex];
        return val > 2800 ? 'rgb(239, 44, 44)' : 'transparent';
      },
      spanGaps: true,
    },
  ],
};

return (
  <div className="space-y-6">
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Live ECG Monitoring</h3>
              <p className="text-sm text-gray-500">Realistic Cardiac Signal Simulation</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center space-x-2">
                {isConnected ? (
                  <div className="flex items-center text-green-600 bg-green-50 px-3 py-1 rounded-full text-sm font-medium border border-green-100">
                    <Wifi className="w-4 h-4 mr-1.5" /> Hardware Online
                  </div>
                ) : (
                  <div className="flex items-center text-red-500 bg-red-50 px-3 py-1 rounded-full text-sm font-medium border border-red-100">
                    <WifiOff className="w-4 h-4 mr-1.5" /> Device Not Online
                  </div>
                )}
              </div>
              {isConnected && (
                <div className="flex items-center text-blue-600 bg-blue-50 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border border-blue-100">
                  Leads Status: ACTIVE
                </div>
              )}
            </div>
          </div>

          <div className="bg-black rounded-lg p-4" style={{ height: '400px' }}>
            {isRecording ? (
              <Line
                data={chartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  animation: false,
                  scales: {
                    x: { display: false },
                    y: {
                      beginAtZero: false,
                      grid: { color: '#1f2937' },
                      ticks: { color: '#9ca3af' }
                    }
                  },
                  plugins: { legend: { display: false } }
                }}
              />
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <AlertCircle className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400">Press Start Recording to begin monitoring</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between mt-6">
            <div className="flex items-center space-x-8">
              <div>
                <p className="text-sm text-gray-500">Target Heart Rate</p>
                <p className="text-2xl font-bold text-gray-900">
                  {isRecording ? (selectedPatient?.age && selectedPatient.age < 15 ? '100' : '75') : '--'}
                  <span className="text-sm ml-1 font-normal text-gray-500">bpm</span>
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Duration</p>
                <p className="text-2xl font-bold text-gray-900">{formatDuration(sessionDuration)}</p>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {!isRecording ? (
                <button
                  onClick={startRecording}
                  disabled={!selectedPatient}
                  className="flex items-center space-x-2 bg-green-600 text-white px-8 py-3 rounded-lg hover:bg-green-700 transition"
                >
                  <Play className="w-5 h-5" />
                  <span className="font-bold">Start Recording</span>
                </button>
              ) : (
                <button
                  onClick={stopRecording}
                  className="flex items-center space-x-2 bg-red-600 text-white px-8 py-3 rounded-lg hover:bg-red-700 transition"
                >
                  <Square className="w-5 h-5" />
                  <span className="font-bold">Stop Recording</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Select Patient</h3>
          <div className="space-y-2">
            {patients.map((patient) => (
              <button
                key={patient.id}
                onClick={() => !isRecording && setSelectedPatient(patient)}
                disabled={isRecording}
                className={`w-full flex items-center space-x-3 p-3 rounded-lg transition ${selectedPatient?.id === patient.id
                  ? 'bg-blue-50 border-2 border-blue-500'
                  : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                  } ${isRecording ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-white" />
                </div>
                <div className="text-left">
                  <p className="font-medium text-gray-900">{patient.name}</p>
                  <p className="text-xs text-gray-500">{patient.age}y, {patient.gender}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);
}