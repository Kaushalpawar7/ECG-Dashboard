import { useEffect, useState } from 'react';
import { Clock, Download, Eye, FileText, Trash2, User } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ECGSession, Patient, ECGData } from '../types/database';
import { jsPDF } from 'jspdf';

interface SessionWithPatient extends ECGSession {
  patients: Patient;
  predictions?: any[];
}

export function SessionsPage() {
  const [sessions, setSessions] = useState<SessionWithPatient[]>([]);
  const [sessionData, setSessionData] = useState<ECGData[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const { data, error } = await supabase
        .from('ecg_sessions')
        // Exclude raw_data from initial list to keep it fast
        .select('id, patient_id, created_at, start_time, end_time, status, duration, patients(*), predictions(*)')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSessions((data as any) || []);
    } catch (error) {
      console.error('Error loading sessions:', error);
    }
  };

  const generateReport = async (session: SessionWithPatient) => {
    try {
      setGeneratingId(session.id);
      
      // Fetch the raw data for this specific session only when needed
      const { data: sessionInfo, error } = await supabase
        .from('ecg_sessions')
        .select('raw_data')
        .eq('id', session.id)
        .single();

      if (error) throw error;
      
      const rawData = sessionInfo?.raw_data as number[] || [];
      // Grab a representative 6-second slice (approx 300-600 points)
      const ecgPointsRaw = rawData.slice(0, 600);
      
      // APPLY CLINICAL AMPLIFICATION (Same logic as Live Dashboard)
      const WINDOW_SIZE = 50; 
      let processedPoints: number[] = [];
      let baselineWindow: number[] = [];
      
      const pMin = Math.min(...ecgPointsRaw);
      const pMax = Math.max(...ecgPointsRaw);
      const currentRange = Math.max(10, pMax - pMin);
      const gain = 180 / currentRange; // Amplify to clinical target
      
      for (let i = 0; i < ecgPointsRaw.length; i++) {
        baselineWindow.push(ecgPointsRaw[i]);
        if (baselineWindow.length > WINDOW_SIZE) baselineWindow.shift();
        const currentMean = baselineWindow.reduce((a, b) => a + b, 0) / baselineWindow.length;
        processedPoints.push(((ecgPointsRaw[i] - currentMean) * gain) + 1850);
      }
      
      const ecgPoints = processedPoints;

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      
      // 1. Header
      doc.setFillColor(37, 99, 235);
      doc.rect(0, 0, pageWidth, 40, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(24);
      doc.setFont('helvetica', 'bold');
      doc.text('HealthUp Smart ECG Report', 20, 25);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Report Generated: ${new Date().toLocaleString()}`, pageWidth - 20, 25, { align: 'right' });

      // 2. Patient & Session Metadata
      doc.setTextColor(31, 41, 55);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('1. Patient Information', 20, 55);
      
      doc.setDrawColor(229, 231, 235);
      doc.line(20, 58, pageWidth - 20, 58);

      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text(`Name: ${session.patients?.name || 'N/A'}`, 25, 68);
      doc.text(`Age: ${session.patients?.age || 'N/A'} years`, 25, 75);
      doc.text(`Gender: ${session.patients?.gender || 'N/A'}`, 25, 82);
      doc.text(`Patient ID: ${session.patient_id}`, 25, 89);

      doc.text(`Session ID: ${session.id.slice(0, 8)}`, pageWidth - 25, 68, { align: 'right' });
      doc.text(`Date: ${new Date(session.start_time).toLocaleDateString()}`, pageWidth - 25, 75, { align: 'right' });
      doc.text(`Time: ${new Date(session.start_time).toLocaleTimeString()}`, pageWidth - 25, 82, { align: 'right' });
      doc.text(`Duration: ${formatDuration(session.duration)}`, pageWidth - 25, 89, { align: 'right' });

      // 3. AI Diagnosis Result (Detailed Clinical Breakdown)
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('2. AI Diagnostic Summary', 20, 105);
      doc.line(20, 108, pageWidth - 20, 108);

      // Re-fetch latest prediction
      const { data: freshPredictions } = await supabase
        .from('predictions')
        .select('*')
        .eq('session_id', session.id)
        .order('created_at', { ascending: false });

      const prediction = freshPredictions?.[0] || session.predictions?.[0];
      const categories = [
        { id: 'NORMAL', name: 'Normal Sinus Rhythm' },
        { id: 'MI', name: 'Myocardial Infarction' },
        { id: 'STTC', name: 'ST/T Wave Changes' },
        { id: 'CD', name: 'Conduction Disturbance' },
        { id: 'HYP', name: 'Left Ventricular Hypertrophy' }
      ];

      let currentY = 118;
      doc.setFontSize(10);
      
      categories.forEach((cat) => {
        const isMatched = prediction?.predicted_class === cat.id;
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(31, 41, 55);
        doc.text(cat.name, 25, currentY);
        
        doc.setFont('helvetica', 'bold');
        if (prediction) {
          if (isMatched) {
            if (cat.id === 'NORMAL') {
              doc.setTextColor(22, 101, 52);
              doc.text('NORMAL', pageWidth - 25, currentY, { align: 'right' });
            } else {
              doc.setTextColor(220, 38, 38);
              doc.text('POSITIVE / DETECTED', pageWidth - 25, currentY, { align: 'right' });
            }
          } else {
            doc.setTextColor(107, 114, 128);
            doc.text('NEGATIVE', pageWidth - 25, currentY, { align: 'right' });
          }
        } else {
          doc.setTextColor(156, 163, 175);
          doc.text('PENDING ANALYSIS', pageWidth - 25, currentY, { align: 'right' });
        }
        currentY += 7;
      });

      if (prediction) {
        doc.setTextColor(31, 41, 55);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(9);
        const displayConfidence = (prediction.confidence * 100).toFixed(1);
        doc.text(`* Final Interpretation based on ResNet-1D Classifier (${displayConfidence}% confidence)`, 25, currentY + 3);

        currentY += 12;
        doc.setFillColor(prediction.predicted_class === 'NORMAL' ? 240 : 254, prediction.predicted_class === 'NORMAL' ? 253 : 242, prediction.predicted_class === 'NORMAL' ? 244 : 242);
        doc.roundedRect(20, currentY, pageWidth - 40, 15, 2, 2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(prediction.predicted_class === 'NORMAL' ? 22 : 185, prediction.predicted_class === 'NORMAL' ? 101 : 28, prediction.predicted_class === 'NORMAL' ? 52 : 28);
        const catNames: Record<string, string> = {
          'NORMAL': 'NORMAL SINUS RHYTHM',
          'MI': 'MYOCARDIAL INFARCTION',
          'STTC': 'ST/T WAVE CHANGES',
          'CD': 'CONDUCTION DISTURBANCE',
          'HYP': 'LEFT VENTRICULAR HYPERTROPHY'
        };
        const verdictText = catNames[prediction.predicted_class] || prediction.predicted_class;
        doc.text(`OVERALL CLINICAL IMPRESSION: ${verdictText}`, pageWidth / 2, currentY + 10, { align: 'center' });
      }

      // 4. ECG Waveform Snapshot (6-Second Rhythm Strip)
      doc.setTextColor(31, 41, 55);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('3. Rhythm Strip (6-Second Sample)', 20, 160);
      doc.line(20, 163, pageWidth - 20, 163);

      if (ecgPoints && ecgPoints.length > 0) {
        const chartX = 20;
        const chartY = 175;
        const chartWidth = pageWidth - 40;
        const chartHeight = 60;

        doc.setDrawColor(255, 230, 230);
        for (let i = 0; i <= 20; i++) {
          const x = chartX + (i * chartWidth) / 20;
          doc.line(x, chartY, x, chartY + chartHeight);
        }
        for (let i = 0; i <= 6; i++) {
          const y = chartY + (i * chartHeight) / 6;
          doc.line(chartX, y, chartX + chartWidth, y);
        }

        doc.setDrawColor(37, 99, 235);
        doc.setLineWidth(0.5);
        
        // FOCUS SCALE: 1700 - 2000 (Centered at 1850)
        const minVal = 1700;
        const maxVal = 2000;
        const scaleY = chartHeight / (maxVal - minVal);
        const stepX = chartWidth / ecgPoints.length;

        for (let i = 0; i < ecgPoints.length - 1; i++) {
          const x1 = chartX + i * stepX;
          const y1 = chartY + chartHeight - (ecgPoints[i] - minVal) * scaleY;
          const x2 = chartX + (i + 1) * stepX;
          const y2 = chartY + chartHeight - (ecgPoints[i + 1] - minVal) * scaleY;
          doc.line(x1, y1, x2, y2);
        }
      }

      // 5. Footer
      doc.setFontSize(8);
      doc.setTextColor(156, 163, 175);
      doc.text('This report is generated by HealthUp AI and should be reviewed by a qualified healthcare professional.', pageWidth / 2, 280, { align: 'center' });
      doc.text('© 2026 ResNet-1D Cardiac Diagnostic Suite', pageWidth / 2, 285, { align: 'center' });

      doc.save(`ECG_Report_${session.patients?.name || 'Patient'}_${session.id.slice(0,8)}.pdf`);
    } catch (error) {
      console.error('Error generating report:', error);
      alert('Error generating PDF report. Please try again.');
    } finally {
      setGeneratingId(null);
    }
  };

  const downloadSession = async (sessionId: string, patientName: string) => {
    try {
      const { data, error } = await supabase
        .from('ecg_sessions')
        .select('raw_data, start_time')
        .eq('id', sessionId)
        .single();

      if (error) throw error;
      const rawData = data?.raw_data as number[] || [];
      const startTime = new Date(data?.start_time || Date.now());

      const csvContent = [
        ['Index', 'Relative Timestamp', 'ECG Value'].join(','),
        ...rawData.map((val, idx) => {
           const time = new Date(startTime.getTime() + idx * 20).toLocaleTimeString();
           return [idx, time, val].join(',');
        }),
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ecg-session-${patientName}-${sessionId.slice(0, 8)}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading session:', error);
      alert('Error downloading session. Please try again.');
    }
  };

  const viewSession = async (sessionId: string) => {
    try {
      const { data, error } = await supabase
        .from('ecg_data')
        .select('*')
        .eq('session_id', sessionId)
        .order('timestamp', { ascending: true });

      if (error) throw error;
      setSessionData(data || []);
      setShowModal(true);
    } catch (error) {
      console.error('Error loading session data:', error);
      alert('Error loading session data. Please try again.');
    }
  };

  const deleteSession = async (sessionId: string) => {
    if (!confirm('Are you sure you want to delete this session?')) return;

    try {
      const { error } = await supabase.from('ecg_sessions').delete().eq('id', sessionId);
      if (error) throw error;
      loadSessions();
    } catch (error) {
      console.error('Error deleting session:', error);
      alert('Error deleting session. Please try again.');
    }
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return 'N/A';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Session ID
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Patient
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date & Time
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Duration
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  AI Diagnosis
                </th>
                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sessions.map((session) => (
                <tr key={session.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="text-sm font-mono text-gray-900">{session.id.slice(0, 8)}</p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center">
                        <User className="w-4 h-4 text-white" />
                      </div>
                      <span className="text-sm font-medium text-gray-900">
                        {session.patients?.name || 'Unknown Patient'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="text-sm text-gray-900">{formatDate(session.start_time)}</p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="text-sm text-gray-900">{formatDuration(session.duration)}</p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        session.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : session.status === 'completed'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {session.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {session.predictions && session.predictions.length > 0 ? (
                      <div className="flex flex-col">
                        <span className={`text-sm font-bold ${session.predictions[0].predicted_class === 'NORMAL' ? 'text-green-600' : 'text-red-600'}`}>
                          {session.predictions[0].predicted_class}
                        </span>
                        <span className="text-xs text-gray-500">
                          {(session.predictions[0].confidence * 100).toFixed(1)}% Confidence
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400 italic">Pending</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => viewSession(session.id)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                        title="View Raw Data"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => generateReport(session)}
                        disabled={generatingId === session.id}
                        className={`p-2 rounded-lg transition ${
                          generatingId === session.id 
                          ? 'bg-indigo-50 text-indigo-400 cursor-wait' 
                          : 'text-indigo-600 hover:bg-indigo-50'
                        }`}
                        title={generatingId === session.id ? "Generating PDF..." : "Generate PDF Report"}
                      >
                        {generatingId === session.id ? (
                          <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <FileText className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => downloadSession(session.id, session.patients?.name || 'Unknown')}
                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition"
                        title="Download CSV"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteSession(session.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {sessions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <Clock className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">No sessions recorded yet</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900">Session Raw Data</h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600 mb-2">Total Data Points</p>
                  <p className="text-2xl font-bold text-gray-900">{sessionData.length}</p>
                </div>

                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Timestamp
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          ECG Value
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {sessionData.slice(0, 100).map((data) => (
                        <tr key={data.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm text-gray-900">
                            {new Date(data.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="px-4 py-2 text-sm font-mono text-gray-900">
                            {data.ecg_value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {sessionData.length > 100 && (
                  <p className="text-sm text-gray-500 text-center">
                    Showing first 100 of {sessionData.length} data points
                  </p>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-gray-200">
              <button
                onClick={() => setShowModal(false)}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
