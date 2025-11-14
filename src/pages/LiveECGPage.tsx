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
import { RealtimeChannel } from '@supabase/supabase-js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

// --- Backend API Configuration ---
const BACKEND_API_URL = 'http://127.0.0.1:5000'; 

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

  // Refs for timers and the new Supabase Realtime Channel
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    loadPatients();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  const loadPatients = async () => {
    try {
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPatients(data || []);
      
      // OPTIONAL: If no patient is selected, try to select the first one to avoid null issues on load
      if (!selectedPatient && data && data.length > 0) {
          setSelectedPatient(data[0]);
      }
    } catch (error) {
      console.error('Error loading patients:', error);
    }
  };

  // Removed generateSimulatedECG as it's handled by Python

  const startRecording = async () => {
    // CRITICAL: Check that selectedPatient exists before proceeding
    if (!selectedPatient || !user) {
      alert('Please select a patient first');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('ecg_sessions')
        .insert([
          {
            patient_id: selectedPatient.id,
            status: 'active',
          },
        ])
        .select()
        .single();

      if (error) throw error;

      const newSessionId = data.id;
      const patientId = selectedPatient.id; 

      // 2. Start Supabase Realtime Subscription (Loosening the filter)
      const channel = supabase
        .channel(`ecg_stream_${newSessionId}`)
        .on(
          'postgres_changes',
          // Loosened filter to patient ID
          { event: 'INSERT', schema: 'public', table: 'ecg_data', filter: `patient_id=eq.${patientId}` },
          (payload: any) => {
            // Client-side filtering: Ensure data belongs to the active session
            if (payload.new.session_id !== newSessionId) {
                return; 
            }
            
            const rawValue = payload.new.ecg_value;
            const newEcgValue = (typeof rawValue === 'number') ? rawValue : parseInt(rawValue);

            if (isNaN(newEcgValue)) {
              console.warn('Realtime Data Error: Received non-numeric value from Supabase:', rawValue);
              return;
            }

            console.log(`[REALTIME SUCCESS] Data received. Value: ${newEcgValue}`); 
            
            setEcgData((prev) => [...prev, newEcgValue].slice(-100));
            setTimestamps((prev) => [...prev, new Date(payload.new.timestamp).toLocaleTimeString()].slice(-100));
          }
        )
        .subscribe((status, err) => {
            if (status === 'SUBSCRIBED') {
                console.log('[CHANNEL STATUS] Successfully subscribed to channel!');
            }
            if (status === 'CHANNEL_ERROR') {
                console.error('[CHANNEL ERROR] Subscription failed! Check RLS policies or filters.', err);
            }
            if (status === 'TIMED_OUT') {
                console.warn('[CHANNEL TIMEOUT] Subscription timed out.');
            }
        });

      channelRef.current = channel;

      const streamResponse = await fetch(`${BACKEND_API_URL}/start-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: selectedPatient.id, session_id: newSessionId }),
      });

      if (!streamResponse.ok) {
        throw new Error('Failed to start Python backend stream. Check the Python console.');
      }

      setSessionId(newSessionId);
      setIsRecording(true);
      setIsConnected(true); 
      setEcgData([]);
      setTimestamps([]);
      setSessionDuration(0);

      intervalRef.current = setInterval(() => {
        setSessionDuration((prev) => prev + 1);
      }, 1000);

    } catch (error) {
      console.error('Error starting recording or connecting to backend:', error);
      alert('Error starting recording. Please ensure RLS is disabled or fixed, and Python is running.');
      setIsRecording(false);
      setIsConnected(false);
      setSessionId(null);
    }
  };

  const stopRecording = async () => {
    if (!sessionId) return;

    try {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (channelRef.current) {
        await supabase.removeChannel(channelRef.current);
        channelRef.current = null;
        console.log('[CHANNEL STATUS] Unsubscribed from channel.');
      }

      await fetch(`${BACKEND_API_URL}/stop-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      
      await supabase
        .from('ecg_sessions')
        .update({
          status: 'completed',
          end_time: new Date().toISOString(),
          duration: sessionDuration,
        })
        .eq('id', sessionId);

      setIsRecording(false);
      setIsConnected(false);
      setSessionId(null);
      setSessionDuration(0);

    } catch (error) {
      console.error('Error stopping recording:', error);
      alert('Error stopping recording. Please try again.');
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
        borderColor: 'rgb(34, 197, 94)',
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0,
        spanGaps: true,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    scales: {
      x: {
        display: false,
      },
      y: {
        min: 1300, 
        max: 2200, 
        ticks: {
          color: '#6b7280',
        },
        grid: {
          color: '#e5e7eb',
        },
      },
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: false,
      },
    },
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Real-Time ECG Monitor</h3>
              <div className="flex items-center space-x-2">
                {isConnected ? (
                  <>
                    <Wifi className="w-5 h-5 text-green-500" />
                    <span className="text-sm font-medium text-green-600">Connected</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-5 h-5 text-gray-400" />
                    <span className="text-sm font-medium text-gray-500">Disconnected</span>
                  </>
                )}
              </div>
            </div>

            <div className="bg-black rounded-lg p-4" style={{ height: '400px' }}>
              {isRecording ? ( 
                // Using key={ecgData.length} to force re-render
                <Line key={ecgData.length} data={chartData} options={chartOptions} />
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
                  className={`w-full flex items-center space-x-3 p-3 rounded-lg transition ${
                    selectedPatient?.id === patient.id
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

              {patients.length === 0 && (
                <p className="text-center text-gray-500 text-sm py-8">
                  No patients available. Add a patient first.
                </p>
              )}
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
                {selectedPatient.weight && (
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Weight:</span>
                    <span className="text-sm font-medium text-gray-900">
                      {selectedPatient.weight} kg
                    </span>
                  </div>
                )}
                {selectedPatient.height && (
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Height:</span>
                    <span className="text-sm font-medium text-gray-900">
                      {selectedPatient.height} cm
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {isRecording && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                <p className="text-sm font-medium text-green-700">Recording in progress</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}