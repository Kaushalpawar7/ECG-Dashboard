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
import { inferenceService } from '../services/InferenceService';

// We define our local types for the batch evaluation results
interface SessionResult {
  diagnosis: string;
  confidence: number;
  distribution: Record<string, number>;
}

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

export function LiveECGPage() {
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [leadsConnected, setLeadsConnected] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ecgData, setEcgData] = useState<number[]>([]);
  const [timestamps, setTimestamps] = useState<string[]>([]);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<number>(0);
  const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [dataMode, setDataMode] = useState<'simulation' | 'hardware'>('simulation');

  // Refs for timers and connections
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const firebaseListenerRef = useRef<any>(null);
  const lastUpdateRef = useRef<number>(0);
  
  // Store the entire session data for post-session analysis
  const sessionDataRef = useRef<number[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const selectedPatientRef = useRef<Patient | null>(null);
  const slotValuesRef = useRef<Record<string, number>>({});
  const initialDataCapturedRef = useRef<boolean>(false);
  const hardwareBufferRef = useRef<number[]>([]);
  const lastFilteredValRef = useRef<number>(1900);

  // Keep IDs in Refs to avoid stale closures in Web Worker listener
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    selectedPatientRef.current = selectedPatient;
  }, [selectedPatient]);
  

  /**
   * New 100Hz Realistic ECG Generator
   */
  const generateRealisticECG = (time: number, seed: number, isHardwareValid: boolean) => {
    const baseline = 1900; // Centered to match user hardware (1800-2000)
    const amplitude = 150; 

    if (!isHardwareValid) {
      return baseline + (Math.random() - 0.5) * 5;
    }

    // 1. Pathological Variability (Seed based Heart Rate)
    const hrScale = 0.95 + (seed % 10) / 100; 
    // Add subtle Heart Rate Variability (HRV)
    const hrv = 0.02 * Math.sin(time * 0.1);
    const period = 0.85 * hrScale + hrv; 
    const t = (time % period) / period; 

    // 2. Biological Components (Smoothed for 50Hz)
    // P-wave (Atrial depolarization)
    const p = 0.1 * Math.exp(-Math.pow(t - 0.15, 2) / 0.003);
    
    // QRS Complex (Ventricular depolarization)
    const qrs = 1.0 * Math.exp(-Math.pow(t - 0.35, 2) / 0.00015) - 
                0.12 * Math.exp(-Math.pow(t - 0.33, 2) / 0.0003) - 
                0.22 * Math.exp(-Math.pow(t - 0.37, 2) / 0.0003);
                
    // T-wave (Ventricular repolarization)
    const t_wave = 0.2 * Math.exp(-Math.pow(t - 0.65, 2) / 0.006);

    // 3. Multi-Layer Noise & Artifacts
    // Respiration Drift (Patient breathing causes baseline to move up/down slowly)
    const respiration = 0.12 * Math.sin(time * 0.5); 
    
    // Muscle Tremor (High frequency micro-jitter)
    const tremor = (Math.random() - 0.5) * 0.02;
    
    // Brownian Noise (Simulates realistic line interference)
    const brownian = 0.05 * Math.sin(time * 0.2 + seed);

    return baseline + (p + qrs + t_wave + respiration + tremor + brownian) * amplitude;
  };

  useEffect(() => {
    loadPatients();

    // Check if model is already cached to avoid UI flicker
    const checkCache = async () => {
      const cached = await inferenceService.isModelCached();
      if (cached) setModelDownloadProgress(100);
    };
    checkCache();
    
    // Initialize Web Worker
    workerRef.current = new Worker(new URL('../workers/inferenceWorker.ts', import.meta.url), { type: 'module' });
    
    workerRef.current.onmessage = (e) => {
      const { type, progress, result, error } = e.data;
      if (type === 'PROGRESS') {
        setModelDownloadProgress(progress);
      } else if (type === 'ANALYSIS_PROGRESS') {
        setAnalysisProgress(progress);
      } else if (type === 'ANALYSIS_COMPLETE') {
        setIsAnalyzing(false);
        setSessionResult(result);
        savePredictionToDatabase(result);
      } else if (type === 'ERROR') {
        console.error('Worker Error:', error);
        setIsAnalyzing(false);
      }
    };

    // Ask worker to init the TFJS model in background
    workerRef.current.postMessage({ type: 'INIT' });

    // Handle Hardware Data (Slots)
    const slotDataRefs = [
      ref(database, '/live/ecg/slot1/data'),
      ref(database, '/live/ecg/slot2/data'),
      ref(database, '/live/ecg/slot3/data'),
    ];

    const slotDataUnsubscribes = slotDataRefs.map((dataRef, _index) => 
      onValue(dataRef, (snapshot) => {
        if (dataMode === 'hardware' && isRecording && snapshot.exists()) {
           const newData = snapshot.val();
           // Convert Firebase data (likely a comma-separated string or array) to numbers
           let points: number[] = [];
           if (typeof newData === 'string') {
              points = newData.split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v));
           } else if (Array.isArray(newData)) {
              points = newData.map(v => Number(v));
           } else if (typeof newData === 'object') {
              // Handle object-indexed data {0: val, 1: val}
              points = Object.values(newData).map(v => Number(v));
           }

           if (points.length > 0) {
              // Add new points to the "Holding Tank" (Buffer)
              hardwareBufferRef.current = [...hardwareBufferRef.current, ...points];
              // We don't plot them here anymore; the processing clock handles it
           }
        }
      })
    );

    // High-Stability Filter State
    const movingAvgBuffer: number[] = [];
    const WINDOW_SIZE = 5;
    
    const processingInterval = setInterval(() => {
      if (!isRecording) return;

      let nextVal = 0;
      if (dataMode === 'hardware') {
         if (hardwareBufferRef.current.length === 0) return; 
         const rawVal = hardwareBufferRef.current.shift()!;
         
         // Ignore obvious junk data (Leads off or zero)
         if (rawVal < 10) return;

         // Store RAW data for AI accuracy
         sessionDataRef.current.push(rawVal);

         // --- High-Stability Moving Average Filter ---
         movingAvgBuffer.push(rawVal);
         if (movingAvgBuffer.length > WINDOW_SIZE) movingAvgBuffer.shift();
         
         const sum = movingAvgBuffer.reduce((a, b) => a + b, 0);
         const averaged = sum / movingAvgBuffer.length;

         // Safety Clamp to prevent scale explosion
         nextVal = Math.min(2200, Math.max(1700, averaged));
      } else {
         return;
      }

      // Update UI with CLEAN STABLE value
      setEcgData(prev => [...prev, nextVal].slice(-400));
      
      if (sessionDataRef.current.length % 5 === 0) {
        setTimestamps(prev => [...prev, new Date().toLocaleTimeString()].slice(-400));
      }
    }, 20);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
      if (firebaseListenerRef.current) firebaseListenerRef.current();
      if (workerRef.current) workerRef.current.terminate();
      slotDataUnsubscribes.forEach(unsub => unsub());
      clearInterval(processingInterval);
    };
  }, [dataMode, isRecording]); // Re-attach when mode or recording status changes

  const savePredictionToDatabase = async (result: SessionResult) => {
    const sId = sessionIdRef.current;
    const pId = selectedPatientRef.current?.id;

    if (!sId || !pId) {
      console.warn('Cannot save prediction: missing sessionId or patientId in Ref context');
      return;
    }

    try {
      const { error } = await supabase.from('predictions').insert([{
        session_id: sId,
        patient_id: pId,
        predicted_class: result.diagnosis,
        confidence: result.confidence / 100 // Normalize to 0-1 for DB constraints
      }]);

      if (error) throw error;
      console.log('AI Prediction successfully persisted to Supabase:', {
        diagnosis: result.diagnosis,
        confidence: result.confidence
      });
    } catch (err) {
      console.error('Error saving prediction to DB:', err);
    }
  };

  // 1. ESP32 Connection Sentinel (Multi-Slot Support)
  useEffect(() => {
    if (!database) return;

    // Listen to Leads Status node
    const statusRef = ref(database, '/live/status');
    const unsubscribeStatus = onValue(statusRef, (snapshot) => {
      if (snapshot.exists()) {
        const status = snapshot.val();
        setLeadsConnected(status === "ON");
      }
    });

    // Listen to all 3 slots for heartbeats
    const slotRefs = [
      ref(database, '/live/ecg/slot1/t'),
      ref(database, '/live/ecg/slot2/t'),
      ref(database, '/live/ecg/slot3/t'),
    ];

    const unsubscribes = slotRefs.map((slotRef, index) =>
      onValue(slotRef, (snapshot) => {
        if (snapshot.exists()) {
          const slotId = `slot${index + 1}`;
          const currentT = snapshot.val();
          
          // Debug logs for heartbeat
          // console.log(`[Firebase] ${slotId} pulse: ${currentT}`);

          if (!initialDataCapturedRef.current) {
             slotValuesRef.current[slotId] = currentT;
             // Check if all slots have initial values
             if (Object.keys(slotValuesRef.current).length === 3) {
                initialDataCapturedRef.current = true;
             }
          } else {
             // If any slot's counter has increased, the device is definitely online
             if (currentT > (slotValuesRef.current[slotId] || 0)) {
                setIsConnected(true);
                lastUpdateRef.current = Date.now();
                slotValuesRef.current[slotId] = currentT;
             }
          }
        }
      })
    );

    // Watchdog: 10 seconds timeout (increased from 8s) to handle slower hardware burst cycles
    const watchdog = setInterval(() => {
      if (Date.now() - lastUpdateRef.current > 10000) {
        setIsConnected(false);
      }
    }, 2000);

    return () => {
      unsubscribeStatus();
      unsubscribes.forEach(unsub => unsub());
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

  const startRealRecording = async () => {
    if (!selectedPatient || !user) {
      alert('Please select a patient first');
      return;
    }
    
    // Requirement check: Device must be online and leads must be connected to START
    if (!isConnected || !leadsConnected) {
      alert('Cannot start recording: Device is Offline or Leads are Disconnected.');
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
      setSessionResult(null);
      sessionDataRef.current = [];

      // Only start the simulator if we are in Simulation Mode
      if (dataMode === 'simulation') {
        let simTime = Math.random() * 10; 
        const sessionSeed = Math.floor(Math.random() * 1000);
        
        intervalRef.current = setInterval(async () => {
          const isHardwareValid = (isConnected && leadsConnected);
          const simVal = generateRealisticECG(simTime, sessionSeed, isHardwareValid);
          
          sessionDataRef.current.push(simVal);

          setEcgData((prev) => {
            return [...prev, simVal].slice(-400); 
          });
          
          if (Math.floor(simTime * 50) % 5 === 0) {
            setTimestamps((prev) => [...prev, new Date().toLocaleTimeString()].slice(-400));
          }
          
          simTime += 0.02; 
        }, 20);
      }

      // Duration Timer
      durationIntervalRef.current = setInterval(() => {
        setSessionDuration((d) => d + 1);
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

      setIsRecording(false);
      // We explicitly DON'T reset sessionDuration here so it stays on screen during finalize
      setIsFinalizing(true);
      setIsAnalyzing(true);
      setAnalysisProgress(0);

      // Stage 1: Send COMPLETELY RAW data to AI for analysis (No loss)
      if (workerRef.current && sessionDataRef.current.length > 0) {
        workerRef.current.postMessage({ type: 'PREDICT', payload: sessionDataRef.current });
      }

      // Stage 2: Instant Persistence (One row, one array)
      // This is much faster and more efficient than mapping thousands of rows
      await supabase
        .from('ecg_sessions')
        .update({
          status: 'completed',
          end_time: new Date().toISOString(),
          duration: sessionDuration,
          raw_data: sessionDataRef.current // Store the entire array in one column
        })
        .eq('id', sessionId);

      if (!workerRef.current || sessionDataRef.current.length === 0) {
        setIsAnalyzing(false);
      }
      setIsFinalizing(false);

    } catch (error) {
      console.error('Error stopping recording:', error);
      setIsFinalizing(false);
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
        borderColor: '#06b6d4',
        backgroundColor: (context: any) => {
          const ctx = context.chart.ctx;
          const gradient = ctx.createLinearGradient(0, 0, 0, 400);
          gradient.addColorStop(0, 'rgba(6, 182, 212, 0.4)');
          gradient.addColorStop(1, 'rgba(6, 182, 212, 0)');
          return gradient;
        },
        fill: true,
        borderWidth: 2,
        tension: 0.1,
        pointRadius: (context: any) => {
          if (dataMode === 'hardware') return 0; // Hide peaks for noisy hardware
          const val = context.dataset.data[context.dataIndex];
          return val > 2000 ? 4 : 0;
        },
        pointBackgroundColor: (context: any) => {
          const val = context.dataset.data[context.dataIndex];
          return val > 2000 ? '#ef4444' : 'transparent';
        },
        pointBorderColor: 'transparent',
        spanGaps: true,
      },
    ],
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            {modelDownloadProgress < 100 && (
              <div className="mb-4 bg-blue-50 border border-blue-100 rounded-lg p-4 animate-in fade-in duration-500">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-semibold text-blue-800">Loading AI Model Data (25MB)</span>
                  <span className="text-sm font-bold text-blue-600">{modelDownloadProgress}%</span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-2.5">
                  <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${modelDownloadProgress}%` }}></div>
                </div>
                <p className="text-xs text-blue-600 mt-2">Loading binary model into browser memory for instant execution...</p>
              </div>
            )}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Live ECG Monitoring</h3>
                <div className="flex items-center space-x-4 mt-1">
                   <p className="text-sm text-gray-500">Source:</p>
                   <div className="flex bg-gray-100 p-1 rounded-lg">
                      <button 
                        onClick={() => !isRecording && setDataMode('simulation')}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${dataMode === 'simulation' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        disabled={isRecording}
                      >
                        Simulation
                      </button>
                      <button 
                        onClick={() => !isRecording && setDataMode('hardware')}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${dataMode === 'hardware' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        disabled={isRecording}
                      >
                        Live Hardware
                      </button>
                   </div>
                </div>
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
                  <div className={`flex items-center px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${leadsConnected
                    ? 'text-blue-600 bg-blue-50 border-blue-100'
                    : 'text-orange-600 bg-orange-50 border-orange-100 animate-pulse'
                    }`}>
                    Leads Status: {leadsConnected ? 'ACTIVE' : 'OFF'}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-black rounded-lg p-4 relative" style={{ height: '400px' }}>
              {(isAnalyzing || isFinalizing) && (
                 <div className="absolute inset-0 z-20 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-lg">
                    <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <p className="text-white font-bold text-lg mb-2">
                      {isFinalizing ? 'Finalizing Session & Saving Data...' : 'AI Analysis in Progress...'}
                    </p>
                    {isAnalyzing && !isFinalizing && (
                      <div className="w-64 bg-gray-800 rounded-full h-2">
                         <div className="bg-blue-500 h-2 rounded-full transition-all duration-300" style={{ width: `${analysisProgress}%` }}></div>
                      </div>
                    )}
                 </div>
              )}

              {sessionResult && !isRecording && !isAnalyzing && (
                <div className="absolute top-6 left-6 z-10 bg-white/10 backdrop-blur-md border border-white/20 p-6 rounded-lg shadow-xl animate-in fade-in slide-in-from-top-4 duration-500">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Session Diagnosis Report</p>
                  <div className="flex items-baseline space-x-3 mb-2">
                    <p className={`text-4xl font-black ${sessionResult.diagnosis === 'NORMAL' ? 'text-green-400' : 'text-red-400'}`}>
                      {sessionResult.diagnosis}
                    </p>
                    <p className="text-lg text-gray-300">{sessionResult.confidence}% match</p>
                  </div>
                  <p className="text-sm text-gray-400">Analysis completed across 100% of recorded data.</p>
                </div>
              )}

              {isRecording ? (
                <Line
                  className="drop-shadow-[0_0_6px_rgba(6,182,212,0.6)]"
                  data={chartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    scales: {
                      x: { display: false },
                      y: {
                        min: 1750,
                        max: 2100,
                        beginAtZero: false,
                        border: { dash: [4, 4] },
                        grid: { color: 'rgba(255, 255, 255, 0.08)' },
                        ticks: { color: '#6b7280' }
                      }
                    },
                    plugins: { legend: { display: false } }
                  }}
                />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <div className="relative inline-flex mb-4">
                      <span className="absolute inset-0 rounded-full bg-cyan-500 opacity-20 animate-ping"></span>
                      <AlertCircle className="relative w-12 h-12 text-gray-500 mx-auto" />
                    </div>
                    <p className="text-gray-400">Press Start Recording to begin monitoring</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between mt-6">
              <div className="flex items-center space-x-8">
                <div>
                  <p className="text-sm text-gray-500 flex items-center">
                    {isRecording && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse mr-2 shadow-[0_0_4px_rgba(239,68,68,0.8)]"></span>}
                    Session Duration
                  </p>
                  <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatDuration(sessionDuration)}</p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                {!isRecording ? (
                  <button
                    onClick={startRealRecording}
                    disabled={!selectedPatient}
                    className="flex items-center space-x-2 bg-green-600 text-white px-8 py-3 rounded-lg hover:bg-green-700 hover:scale-[1.02] hover:shadow-[0_4px_14px_rgba(22,163,74,0.4)] transition-all"
                  >
                    <Play className="w-5 h-5" />
                    <span className="font-bold">Start Recording</span>
                  </button>
                ) : (
                  <button
                    onClick={stopRecording}
                    disabled={isFinalizing}
                    className={`flex items-center space-x-2 bg-red-600 text-white px-8 py-3 rounded-lg transition-all ${
                      isFinalizing ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-700 hover:scale-[1.02] hover:shadow-[0_4px_14px_rgba(220,38,38,0.4)]'
                    }`}
                  >
                    <Square className="w-5 h-5" />
                    <span className="font-bold">{isFinalizing ? 'Saving...' : 'Stop Recording'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Select Patient</h3>
            <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar pr-2">
              {patients.map((patient) => (
                <button
                  key={patient.id}
                  onClick={() => !isRecording && setSelectedPatient(patient)}
                  disabled={isRecording}
                  className={`relative w-full flex items-center space-x-3 p-3 rounded-xl transition-all duration-300 ${selectedPatient?.id === patient.id
                    ? 'bg-blue-50 border-l-4 border-l-blue-600 shadow-sm'
                    : 'bg-transparent hover:bg-gray-50 hover:translate-x-1 border-l-4 border-l-transparent'
                    } ${isRecording ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {selectedPatient?.id === patient.id && (
                    <span className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_4px_rgba(34,197,94,0.8)]"></span>
                  )}
                  <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-white" />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-gray-900">{patient.name}</p>
                    <p className="text-xs font-semibold text-gray-500 mt-0.5">{patient.age}y, {patient.gender}</p>
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