import { useEffect, useState, useRef } from 'react';
import { User, AlertCircle, Play, Square, Activity, Database, CheckCircle } from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { supabase } from '../lib/supabase';
import { Patient } from '../types/database';
import { database } from '../lib/firebase';
import { ref, onValue } from 'firebase/database';
import { inferenceService } from '../services/InferenceService';

interface SessionResult {
  diagnosis: string;
  confidence: number;
  distribution: Record<string, number>;
}

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

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

  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const sessionDataRef = useRef<number[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const selectedPatientRef = useRef<Patient | null>(null);
  const slotValuesRef = useRef<Record<string, number>>({});
  const initialDataCapturedRef = useRef<boolean>(false);
  const hardwareBufferRef = useRef<number[]>([]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    selectedPatientRef.current = selectedPatient;
  }, [selectedPatient]);
  
  const generateRealisticECG = (time: number, seed: number, isHardwareValid: boolean) => {
    const baseline = 1850; // Reference point
    const amplitude = 140; 

    if (!isHardwareValid) {
      return baseline + (Math.random() - 0.5) * 5;
    }

    const hrScale = 0.95 + (seed % 10) / 100; 
    const hrv = 0.02 * Math.sin(time * 0.1);
    const period = 0.85 * hrScale + hrv; 
    const t = (time % period) / period; 

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

  useEffect(() => {
    loadPatients();
    
    inferenceService.isModelCached().then(cached => {
      if (cached) setModelDownloadProgress(100);
    });

    const worker = new Worker(new URL('../workers/inferenceWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const { type, progress, result } = e.data;
      if (type === 'PROGRESS') setModelDownloadProgress(progress);
      else if (type === 'ANALYSIS_COMPLETE') {
        setIsAnalyzing(false);
        setSessionResult(result);
        savePredictionToDatabase(result);
      }
    };

    worker.postMessage({ type: 'INIT' });
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    if (dataMode !== 'hardware' || !isRecording) return;
    const slotDataRefs = [
      ref(database, '/live/ecg/slot1/data'),
      ref(database, '/live/ecg/slot2/data'),
      ref(database, '/live/ecg/slot3/data'),
    ];
    const unsubs = slotDataRefs.map((dataRef) => 
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
    return () => unsubs.forEach(unsub => unsub());
  }, [dataMode, isRecording]);

   useEffect(() => {
    if (!isRecording) return;
    const baselineWindow: number[] = [];
    const peakWindow: number[] = [];
    const WINDOW_SIZE = 250; 
    let lastRaw = 1850;
    let emaVal = 1850;

    const clock = setInterval(() => {
      let nextVal = generateRealisticECG(Date.now() / 1000, 0, isConnected || dataMode === 'simulation');

      if (dataMode === 'hardware') {
         if (hardwareBufferRef.current.length === 0) return; 
         const rawVal = hardwareBufferRef.current.shift()!;
         if (rawVal < 10) return;

         baselineWindow.push(rawVal);
         peakWindow.push(rawVal);
         if (baselineWindow.length > WINDOW_SIZE) baselineWindow.shift();
         if (peakWindow.length > 100) peakWindow.shift(); 
         
         const currentMean = baselineWindow.reduce((a, b) => a + b, 0) / baselineWindow.length;
         
         const pMin = Math.min(...peakWindow);
         const pMax = Math.max(...peakWindow);
         const currentRange = Math.max(10, pMax - pMin);
         const targetRange = 180; 
         const gain = targetRange / currentRange;

         const derivative = (rawVal - lastRaw) * 0.4; 
         lastRaw = rawVal;
         
         const amplified = ((rawVal - currentMean) * gain) + 1850 + derivative;
         emaVal = (amplified * 0.85) + (emaVal * 0.15);
         
         sessionDataRef.current.push(rawVal);
         nextVal = Math.min(2350, Math.max(1550, emaVal));
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
          if (Object.keys(slotValuesRef.current).length >= 2) initialDataCapturedRef.current = true;
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
    if (!selectedPatient || !isConnected || !leadsConnected) return;
    const { data } = await supabase.from('ecg_sessions').insert([{ patient_id: selectedPatient.id, status: 'active' }]).select().single();
    if (data) {
      setSessionId(data.id);
      setIsRecording(true);
      setEcgData([]);
      setTimestamps([]);
      setSessionDuration(0);
      setSessionResult(null);
      sessionDataRef.current = [];
      hardwareBufferRef.current = []; // Freshness Guard
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
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m.toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  };

  const chartData = {
    labels: timestamps.length > 0 ? timestamps : Array(400).fill(''),
    datasets: [
      {
        label: 'ECG Signal',
        data: ecgData.length > 0 ? ecgData : Array(400).fill(1850),
        borderColor: '#06b6d4',
        borderWidth: 2,
        tension: 0.05,
        pointRadius: 0,
        fill: true,
        backgroundColor: (context: any) => {
          const ctx = context.chart.ctx;
          const gradient = ctx.createLinearGradient(0, 0, 0, 400);
          gradient.addColorStop(0, 'rgba(6, 182, 212, 0.25)');
          gradient.addColorStop(1, 'rgba(6, 182, 212, 0)');
          return gradient;
        },
      },
    ],
  };

  return (
    <div className="max-w-7xl mx-auto p-4 lg:p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Live ECG Monitoring</h1>
          <p className="text-gray-500 text-sm">Real-time physiological data analysis</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-gray-50 p-1 rounded-xl border border-gray-100">
            <button onClick={() => !isRecording && setDataMode('simulation')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${dataMode === 'simulation' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Simulation</button>
            <button onClick={() => !isRecording && setDataMode('hardware')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${dataMode === 'hardware' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>Hardware</button>
          </div>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border ${isConnected ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
            <Activity className={`w-4 h-4 ${isConnected ? 'animate-pulse' : ''}`} />
            {isConnected ? 'DEVICE ONLINE' : 'DEVICE OFFLINE'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
            <div className="p-6 border-b border-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                  <Activity className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">Clinical Waveform Feed</h3>
                  <p className="text-xs text-gray-500">Center Reference: 1850mV</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Duration</p>
                  <p className="text-lg font-mono font-bold text-blue-600">{formatDuration(sessionDuration)}</p>
                </div>
                {modelDownloadProgress < 100 && (
                  <div className="flex items-center gap-3 bg-blue-50 px-4 py-2 rounded-xl border border-blue-100">
                    <Database className="w-4 h-4 text-blue-600 animate-bounce" />
                    <span className="text-xs font-bold text-blue-700">Syncing AI... {modelDownloadProgress}%</span>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-black p-6 relative aspect-[21/9] min-h-[400px]">
              {(isAnalyzing || isFinalizing) && (
                <div className="absolute inset-0 z-20 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center text-white">
                  <div className="relative mb-6">
                    <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <Activity className="w-6 h-6 text-blue-500 absolute inset-0 m-auto animate-pulse" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">{isFinalizing ? 'Finalizing Session...' : 'AI Diagnosing...'}</h3>
                  <p className="text-gray-400 text-sm">Processing clinical datasets</p>
                </div>
              )}

              {sessionResult && !isRecording && !isAnalyzing && (
                <div className="absolute top-8 left-8 z-10 bg-white/10 backdrop-blur-md border border-white/20 p-6 rounded-2xl animate-in fade-in zoom-in duration-500">
                  <div className="flex items-center gap-3 mb-4">
                    <CheckCircle className={`w-5 h-5 ${sessionResult.diagnosis === 'NORMAL' ? 'text-green-400' : 'text-red-400'}`} />
                    <span className="text-[10px] font-black text-white/60 uppercase tracking-[0.2em]">Clinical Report</span>
                  </div>
                  <p className={`text-4xl font-black mb-1 ${sessionResult.diagnosis === 'NORMAL' ? 'text-green-400' : 'text-red-400'}`}>{sessionResult.diagnosis}</p>
                  <p className="text-sm text-white/80 font-medium">AI Confidence: {sessionResult.confidence}%</p>
                </div>
              )}

              <Line
                data={chartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  animation: false,
                  interaction: { intersect: false },
                  scales: {
                    x: { display: false },
                    y: {
                      min: 1500,
                      max: 2250,
                      grid: { color: 'rgba(255,255,255,0.05)' },
                      ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 10 } }
                    }
                  },
                  plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                  }
                }}
              />
            </div>

            <div className="p-6 bg-gray-50 flex items-center justify-between border-t border-gray-100">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${leadsConnected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}></div>
                  <span className="text-sm font-medium text-gray-700">Leads: {leadsConnected ? 'Stable' : 'Check Sensor'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <span className="text-sm font-medium text-gray-700">Storage: Persistent</span>
                </div>
              </div>
              <button
                onClick={isRecording ? stopRecording : startRealRecording}
                disabled={!selectedPatient || (!isConnected && dataMode === 'hardware')}
                className={`flex items-center gap-3 px-8 py-3 rounded-2xl font-bold text-white shadow-lg transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 ${isRecording ? 'bg-red-600 shadow-red-200 hover:bg-red-700' : 'bg-blue-600 shadow-blue-200 hover:bg-blue-700'}`}
              >
                {isRecording ? <Square className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
                {isRecording ? 'Terminate Recording' : 'Initiate Session'}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <User className="w-4 h-4 text-blue-600" />
              Patient Registry
            </h3>
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
              {patients.map(p => (
                <button
                  key={p.id}
                  onClick={() => !isRecording && setSelectedPatient(p)}
                  className={`w-full text-left p-4 rounded-xl transition-all border ${selectedPatient?.id === p.id ? 'bg-blue-50 border-blue-200 shadow-sm' : 'bg-white border-gray-50 hover:border-blue-100 hover:bg-blue-50/30'}`}
                >
                  <p className={`font-bold ${selectedPatient?.id === p.id ? 'text-blue-700' : 'text-gray-900'}`}>{p.name}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-gray-500 font-medium px-2 py-0.5 bg-gray-100 rounded-md">{p.age} Years</span>
                    <span className="text-xs text-gray-500 font-medium px-2 py-0.5 bg-gray-100 rounded-md uppercase">{p.gender}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl p-6 text-white shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-white" />
              </div>
              <h4 className="font-bold">System Status</h4>
            </div>
            <p className="text-blue-100 text-xs leading-relaxed mb-6">
              AI Engine is currently optimized for batch evaluation of 1D ECG signals. Real-time classification latency is &lt;200ms.
            </p>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-blue-200">Processing Mode</span>
                <span className="font-bold">GPU ACCELERATED</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-blue-200">Sampling Rate</span>
                <span className="font-bold">50 Hz</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}