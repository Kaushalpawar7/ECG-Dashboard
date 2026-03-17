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
import { ref, onValue, limitToLast, query } from 'firebase/database';

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
  const [viewMode, setViewMode] = useState<'live' | 'reference'>('live');
  const [referenceType, setReferenceType] = useState('normal');

  // Refs for timers and connections
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const firebaseListenerRef = useRef<any>(null);
  const lastUpdateRef = useRef<number>(0);

  // Reference Pattern Mock Data
  const REFERENCE_PATTERNS = {
    normal: [2000, 2010, 2050, 2020, 1980, 2100, 4000, 1500, 2000, 2050, 2100, 2080],
    tachycardia: [2000, 2100, 4000, 1500, 2000, 2100, 4000, 1500],
    bradycardia: [2000, 2000, 2000, 2100, 4000, 1500, 2000, 2000],
  };

  useEffect(() => {
    loadPatients();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
      if (firebaseListenerRef.current) firebaseListenerRef.current();
    };
  }, []);

  // 1. ESP32 Connection Sentinel (Heartbeat Monitor)
  useEffect(() => {
    if (!database) return;

    // Listen to the data path where ESP32 pushes
    const statusQuery = query(ref(database, '/'), limitToLast(1));
    const unsubscribe = onValue(statusQuery, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        // snapshot.val() will be an object where keys are push IDs
        if (data && typeof data === 'object') {
          lastUpdateRef.current = Date.now();
          setIsConnected(true);
        }
      }
    });

    const watchdog = setInterval(() => {
      if (Date.now() - lastUpdateRef.current > 5000) { // 5s timeout
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

  const startRecording = async () => {
    if (!selectedPatient || !user) {
      alert('Please select a patient first');
      return;
    }

    if (!isConnected && viewMode === 'live') {
      alert('Cannot start recording: ESP32 is Disconnected. Please check hardware.');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('ecg_sessions')
        .insert([{ patient_id: selectedPatient.id, status: 'active' }])
        .select().single();

      if (error) throw error;
      const newSessionId = data.id;

      if (viewMode === 'live' && database) {
        const ecgQuery = query(ref(database, '/'), limitToLast(1));
        firebaseListenerRef.current = onValue(ecgQuery, (snapshot) => {
          const vals = snapshot.val();
          if (vals) {
            // Firebase push IDs generate an object { "-Nxyz...": value }
            const keys = Object.keys(vals);
            const latestKey = keys[keys.length - 1];
            const newValue = Number(vals[latestKey]);
            
            if (!isNaN(newValue)) {
              setEcgData((prev) => [...prev, newValue].slice(-300));
              setTimestamps((prev) => [...prev, new Date().toLocaleTimeString()].slice(-300));
            }
          }
        });
      } else if (viewMode === 'reference') {
        const pattern = REFERENCE_PATTERNS[referenceType as keyof typeof REFERENCE_PATTERNS] || REFERENCE_PATTERNS.normal;
        let idx = 0;
        intervalRef.current = setInterval(() => {
          const val = pattern[idx % pattern.length];
          setEcgData((prev) => [...prev, val].slice(-300));
          setTimestamps((prev) => [...prev, new Date().toLocaleTimeString()].slice(-300));
          idx++;
        }, 100);
      }

      setSessionId(newSessionId);
      setIsRecording(true);
      setEcgData([]);
      setTimestamps([]);
      setSessionDuration(0);

      durationIntervalRef.current = setInterval(() => {
        setSessionDuration((prev) => prev + 1);
      }, 1000);

    } catch (error) {
      console.error('Error starting session:', error);
      alert('Error starting session. Check Supabase connection.');
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    if (!sessionId) return;
    try {
      if (firebaseListenerRef.current) {
        firebaseListenerRef.current();
        firebaseListenerRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }

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
      setSessionDuration(0);
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
        borderWidth: 1.5,
        tension: 0,
        pointRadius: (context: any) => {
          const val = context.dataset.data[context.dataIndex];
          return val > 3500 ? 5 : 0;
        },
        pointBackgroundColor: (context: any) => {
          const val = context.dataset.data[context.dataIndex];
          return val > 3500 ? 'rgb(239, 44, 44)' : 'transparent';
        },
        spanGaps: true,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    scales: {
      x: { display: false },
      y: {
        beginAtZero: false,
        grace: '5%',
        ticks: {
          color: '#6b7280',
          font: { size: 10 },
        },
        grid: { color: '#f3f4f6' },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-gray-900">Real-Time ECG Monitor</h3>
                <div className="flex items-center space-x-4">
                  <div className="flex p-0.5 bg-gray-100 rounded-lg">
                    <button
                      onClick={() => !isRecording && setViewMode('live')}
                      disabled={isRecording}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition ${viewMode === 'live' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Live Stream
                    </button>
                    <button
                      onClick={() => !isRecording && setViewMode('reference')}
                      disabled={isRecording}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition ${viewMode === 'reference' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Patterns
                    </button>
                  </div>

                  {viewMode === 'reference' && (
                    <select
                      value={referenceType}
                      onChange={(e) => setReferenceType(e.target.value)}
                      disabled={isRecording}
                      className="text-xs border rounded-lg px-2 py-1 bg-white border-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="normal">Normal Sinus</option>
                      <option value="tachycardia">Tachycardia</option>
                      <option value="bradycardia">Bradycardia</option>
                    </select>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {isConnected ? (
                  <>
                    <Wifi className="w-5 h-5 text-green-500" />
                    <span className="text-sm font-medium text-green-600">Hardware Online</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-5 h-5 text-gray-400" />
                    <span className="text-sm font-medium text-gray-500">Hardware Offline</span>
                  </>
                )}
              </div>
            </div>

            <div className="bg-black rounded-lg p-4" style={{ height: '400px' }}>
              {isRecording ? (
                <Line key={`${ecgData.length}-${viewMode}`} data={chartData} options={chartOptions} />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <AlertCircle className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400">
                      {selectedPatient
                        ? 'Press Start Recording to begin monitoring'
                        : 'Select a patient to start monitoring'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center space-x-4">
                <div className="text-center">
                  <p className="text-xs text-gray-500">Heart Rate</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {isRecording ? '72' : '--'} <span className="text-sm">bpm</span>
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-500">Duration</p>
                  <p className="text-2xl font-bold text-gray-900">{formatDuration(sessionDuration)}</p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                {!isRecording ? (
                  <button
                    onClick={startRecording}
                    disabled={!selectedPatient}
                    className="flex items-center space-x-2 bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Play className="w-5 h-5" />
                    <span>Start Recording</span>
                  </button>
                ) : (
                  <button
                    onClick={stopRecording}
                    className="flex items-center space-x-2 bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition"
                  >
                    <Square className="w-5 h-5" />
                    <span>Stop Recording</span>
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
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-medium text-gray-900">{patient?.name}</p>
                    <p className="text-xs text-gray-500">
                      {patient?.age}y, {patient?.gender}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedPatient && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Patient Info</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Name:</span>
                  <span className="text-sm font-medium text-gray-900">{selectedPatient.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Age:</span>
                  <span className="text-sm font-medium text-gray-900">{selectedPatient.age} years</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Gender:</span>
                  <span className="text-sm font-medium text-gray-900">{selectedPatient.gender}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}