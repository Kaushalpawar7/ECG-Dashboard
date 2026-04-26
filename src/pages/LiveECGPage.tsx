import { useEffect, useState, useRef } from 'react';
import { User, AlertCircle } from 'lucide-react';
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
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [dataMode, setDataMode] = useState<'simulation' | 'hardware'>('simulation');

  // Refs for timers and connections
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastUpdateRef = useRef<number>(0);
  
  // Store the entire session data for post-session analysis
  const sessionDataRef = useRef<number[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const selectedPatientRef = useRef<Patient | null>(null);
  const slotValuesRef = useRef<Record<string, number>>({});
  const initialDataCapturedRef = useRef<boolean>(false);
  const hardwareBufferRef = useRef<number[]>([]);

  // Sync state with Refs for the AI worker closure
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    selectedPatientRef.current = selectedPatient;
  }, [selectedPatient]);
  

  /**
   * Hospital-Grade ECG Generator
   */
  const generateRealisticECG = (time: number, seed: number, isHardwareValid: boolean) => {
    const baseline = 1850; // Calibrated for clinical hardware (1750-2050 display)
    const amplitude = 140; 

    if (!isHardwareValid) {
      return baseline + (Math.random() - 0.5) * 5;
    }

    const hrScale = 0.95 + (seed % 10) / 100; 
    const hrv = 0.02 * Math.sin(time * 0.1);
    const period = 0.85 * hrScale + hrv; 
    const t = (time % period) / period; 

    // Components
    const p = 0.1 * Math.exp(-Math.pow(t - 0.15, 2) / 0.003);
    const qrs = 1.0 * Math.exp(-Math.pow(t - 0.35, 2) / 0.00015) - 
                0.12 * Math.exp(-Math.pow(t - 0.33, 2) / 0.0003) - 
                0.22 * Math.exp(-Math.pow(t - 0.37, 2) / 0.0003);
    const t_wave = 0.2 * Math.exp(-Math.pow(t - 0.65, 2) / 0.006);
    const respiration = 0.12 * Math.sin(time * 0.5); 
    const tremor = (Math.random() - 0.5) * 0.02;
    const brownian = 0.05 * Math.sin(time * 0.2 + seed);

    return baseline + (p + qrs + t_wave + respiration + tremor + brownian) * amplitude;
  };

  const savePredictionToDatabase = async (result: SessionResult) => {
    const sId = sessionIdRef.current;
    const pId = selectedPatientRef.current?.id;
    if (!sId || !pId) return;

    try {
      await supabase.from('predictions').insert([{
        session_id: sId,
        patient_id: pId,
        predicted_class: result.diagnosis,
        confidence: result.confidence / 100 
      }]);
    } catch (err) {
      console.error('Persistence failed:', err);
    }
  };

  // 1. Initial Load: Persistent AI brain initialization
  useEffect(() => {
    loadPatients();
    
    const checkCache = async () => {
      const cached = await inferenceService.isModelCached();
      if (cached) setModelDownloadProgress(100);
    };
    checkCache();

    // Spawn AI module exactly ONCE
    const worker = new Worker(new URL('../workers/inferenceWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const { type, progress, result, error } = e.data;
      if (type === 'PROGRESS') setModelDownloadProgress(progress);
      else if (type === 'ANALYSIS_COMPLETE') {
        setIsAnalyzing(false);
        setSessionResult(result);
        savePredictionToDatabase(result);
      } else if (type === 'ERROR') {
        console.error('Worker Error:', error);
        setIsAnalyzing(false);
      }
    };

    worker.postMessage({ type: 'INIT' });

    return () => worker.terminate();
  }, []);

  // 2. Hardware Sync: Firebase data extraction
  useEffect(() => {
    if (dataMode !== 'hardware' || !isRecording) return;

    const slotDataRefs = [
      ref(database, '/live/ecg/slot1/data'),
      ref(database, '/live/ecg/slot2/data'),
      ref(database, '/live/ecg/slot3/data'),
    ];

    const unsubscribes = slotDataRefs.map((dataRef) => 
      onValue(dataRef, (snapshot) => {
        if (snapshot.exists()) {
           const newData = snapshot.val();
           let points: number[] = [];
           if (typeof newData === 'string') {
              points = newData.split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v));
           } else if (Array.isArray(newData)) {
              points = newData.map(v => Number(v));
           } else if (typeof newData === 'object') {
              points = Object.values(newData).map(v => Number(v));
           }

           if (points.length > 0) {
              hardwareBufferRef.current = [...hardwareBufferRef.current, ...points];
              lastUpdateRef.current = Date.now();
              setIsConnected(true);
           }
        }
      })
    );

    return () => unsubscribes.forEach(unsub => unsub());
  }, [dataMode, isRecording]);

  // 3. Clinical Visualization Clock (50Hz Filtering)
  useEffect(() => {
    if (!isRecording) return;

    const movingAvgBuffer: number[] = [];
    const WINDOW_SIZE = 5;

    const clock = setInterval(() => {
      let nextVal = generateRealisticECG(Date.now() / 1000, 0, isConnected || dataMode === 'simulation');

      if (dataMode === 'hardware') {
         if (hardwareBufferRef.current.length === 0) return; 
         const rawVal = hardwareBufferRef.current.shift()!;
         if (rawVal < 10) return;

         sessionDataRef.current.push(rawVal);
         movingAvgBuffer.push(rawVal);
         if (movingAvgBuffer.length > WINDOW_SIZE) movingAvgBuffer.shift();
         const sum = movingAvgBuffer.reduce((a, b) => a + b, 0);
         // Clinical axis lock
         nextVal = Math.min(2200, Math.max(1750, sum / movingAvgBuffer.length));
      } else {
         sessionDataRef.current.push(nextVal);
      }

      setEcgData(prev => [...prev, nextVal].slice(-400));
      if (sessionDataRef.current.length % 5 === 0) {
        setTimestamps(prev => [...prev, new Date().toLocaleTimeString()].slice(-400));
      }
    }, 20);

    return () => clearInterval(clock);
  }, [isRecording, dataMode, isConnected]);

  // 4. Connection Watchdog
  useEffect(() => {
    if (!database) return;
    const statusRef = ref(database, '/live/status');
    const unsubStatus = onValue(statusRef, (snap) => setLeadsConnected(snap.val() === "ON"));

    const slotRefs = [
      ref(database, '/live/ecg/slot1/t'),
      ref(database, '/live/ecg/slot2/t'),
      ref(database, '/live/ecg/slot3/t'),
    ];

    const unsubs = slotRefs.map((r, i) => onValue(r, (snap) => {
      if (snap.exists()) {
        const id = `slot${i+1}`;
        const t = snap.val();
        if (!initialDataCapturedRef.current) {
          slotValuesRef.current[id] = t;
          if (Object.keys(slotValuesRef.current).length === 3) initialDataCapturedRef.current = true;
        } else if (t > (slotValuesRef.current[id] || 0)) {
          setIsConnected(true);
          lastUpdateRef.current = Date.now();
          slotValuesRef.current[id] = t;
        }
      }
    }));

    const wd = setInterval(() => {
      if (Date.now() - lastUpdateRef.current > 10000) setIsConnected(false);
    }, 2000);

    return () => { unsubStatus(); unsubs.forEach(u => u()); clearInterval(wd); };
  }, []);

  const loadPatients = async () => {
    const { data } = await supabase.from('patients').select('*').order('created_at', { ascending: false });
    if (data) {
      setPatients(data);
      if (!selectedPatient && data.length > 0) setSelectedPatient(data[0]);
    }
  };

  const startRealRecording = async () => {
    if (!selectedPatient || !isConnected || !leadsConnected) {
      alert('Connectivity issue: Check hardware.');
      return;
    }
    const { data } = await supabase.from('ecg_sessions').insert([{ patient_id: selectedPatient.id, status: 'active' }]).select().single();
    if (data) {
      setSessionId(data.id);
      setIsRecording(true);
      setEcgData([]);
      setTimestamps([]);
      setSessionDuration(0);
      setSessionResult(null);
      sessionDataRef.current = [];
      durationIntervalRef.current = setInterval(() => setSessionDuration(d => d + 1), 1000);
    }
  };

  const stopRecording = async () => {
    if (!sessionId) return;
    if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);

    setIsRecording(false);
    setIsFinalizing(true);
    setIsAnalyzing(true);

    const finalPayload = [...sessionDataRef.current, ...hardwareBufferRef.current];
    if (workerRef.current && finalPayload.length > 0) {
      workerRef.current.postMessage({ type: 'PREDICT', payload: finalPayload });
    }

    await supabase.from('ecg_sessions').update({
      status: 'completed',
      duration: sessionDuration,
      raw_data: finalPayload
    }).eq('id', sessionId);

    setIsFinalizing(false);
    if (!workerRef.current || finalPayload.length === 0) setIsAnalyzing(false);
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m.toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            {modelDownloadProgress < 100 && (
              <div className="mb-4 bg-blue-50 border border-blue-100 rounded-lg p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-semibold text-blue-800">AI Module Sync ({modelDownloadProgress}%)</span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-2">
                  <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${modelDownloadProgress}%` }}></div>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold">Live Clinical Monitoring</h3>
                <div className="flex bg-gray-100 p-1 rounded-lg mt-2">
                  <button onClick={() => !isRecording && setDataMode('simulation')} className={`px-3 py-1 text-xs rounded-md ${dataMode === 'simulation' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>Simulation</button>
                  <button onClick={() => !isRecording && setDataMode('hardware')} className={`px-3 py-1 text-xs rounded-md ${dataMode === 'hardware' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>Hardware</button>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-xs font-bold uppercase ${isConnected ? 'text-green-600' : 'text-red-500'}`}>
                   {isConnected ? 'Device Online' : 'Device Offline'}
                </div>
              </div>
            </div>

            <div className="bg-black rounded-lg p-4 relative" style={{ height: '400px' }}>
              {(isAnalyzing || isFinalizing) && (
                <div className="absolute inset-0 z-20 bg-black/80 flex flex-col items-center justify-center rounded-lg text-white font-bold">
                  <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                  <p>{isFinalizing ? 'Saving Session...' : 'AI Analyzing...'}</p>
                </div>
              )}
              {sessionResult && !isRecording && !isAnalyzing && (
                <div className="absolute top-6 left-6 z-10 bg-white/10 backdrop-blur-md border border-white/20 p-4 rounded-lg">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">AI Diagnosis</p>
                  <p className={`text-3xl font-black ${sessionResult.diagnosis === 'NORMAL' ? 'text-green-400' : 'text-red-400'}`}>{sessionResult.diagnosis}</p>
                  <p className="text-sm text-white">{sessionResult.confidence}% confidence</p>
                </div>
              )}
              {isRecording ? (
                <Line
                  data={{ labels: timestamps, datasets: [{ data: ecgData, borderColor: '#06b6d4', borderWidth: 2, tension: 0.1, pointRadius: 0, fill: true, backgroundColor: 'rgba(6,182,212,0.1)' }] }}
                  options={{ responsive: true, maintainAspectRatio: false, animation: false, scales: { x: { display: false }, y: { min: 1750, max: 2100, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#666' } } }, plugins: { legend: { display: false } } }}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-500">
                  <AlertCircle className="w-12 h-12 mb-2" />
                  <p>Ready to monitor. Select patient and start.</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between mt-6">
              <div>
                <p className="text-xs text-gray-400">Duration</p>
                <p className="text-2xl font-bold">{formatDuration(sessionDuration)}</p>
              </div>
              <button onClick={isRecording ? stopRecording : startRealRecording} className={`px-8 py-3 rounded-lg font-bold text-white transition-all ${isRecording ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}>
                {isRecording ? 'Stop Recording' : 'Start Recording'}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="font-bold mb-4">Patients</h3>
          <div className="space-y-2">
            {patients.map(p => (
              <button key={p.id} onClick={() => !isRecording && setSelectedPatient(p)} className={`w-full text-left p-3 rounded-lg transition-all ${selectedPatient?.id === p.id ? 'bg-blue-50 border-l-4 border-blue-600' : 'hover:bg-gray-50'}`}>
                <p className="font-bold text-gray-900">{p.name}</p>
                <p className="text-xs text-gray-500">{p.age}y • {p.gender}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}