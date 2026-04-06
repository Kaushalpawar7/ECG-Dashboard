import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Brain, TrendingUp, Shield, Activity, Clock, HeartPulse, Zap } from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface AnalyticsData {
  totalPredictions: number;
  avgConfidence: number;
  diseaseDistribution: Record<string, number>;
  trendLabels: string[];
  trendData: number[];
  totalMonitoringSeconds: number;
}

export function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnalyticsData>({
    totalPredictions: 0,
    avgConfidence: 0,
    diseaseDistribution: {},
    trendLabels: [],
    trendData: [],
    totalMonitoringSeconds: 0,
  });

  useEffect(() => {
    loadRealAnalytics();
  }, []);

  const loadRealAnalytics = async () => {
    try {
      // Fetch both sessions and predictions
      const [predResponse, sessionResponse] = await Promise.all([
        supabase.from('predictions').select('*').order('created_at', { ascending: true }),
        supabase.from('ecg_sessions').select('duration'),
      ]);

      const predictions = predResponse.data || [];
      const sessions = sessionResponse.data || [];

      // Calculate totals
      const totalPredictions = predictions.length;
      const totalMonitoringSeconds = sessions.reduce((acc, curr) => acc + (curr.duration || 0), 0);

      let sumConfidence = 0;
      const distribution: Record<string, number> = { NORMAL: 0, MI: 0, STTC: 0, CD: 0, HYP: 0 };
      
      // Trend processing (Group by Day)
      const trendMap: Record<string, number> = {};

      predictions.forEach((pred) => {
        sumConfidence += pred.confidence;
        if (distribution[pred.predicted_class] !== undefined) {
          distribution[pred.predicted_class] += 1;
        } else {
           distribution[pred.predicted_class] = 1;
        }

        // Parse date for trend
        const date = new Date(pred.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        trendMap[date] = (trendMap[date] || 0) + 1;
      });

      const avgConfidence = totalPredictions > 0 ? Math.round(sumConfidence / totalPredictions) : 0;

      // Extract trend arrays
      const trendLabels = Object.keys(trendMap);
      const trendData = Object.values(trendMap);

      // If no data, provide an empty state structure
      if (trendLabels.length === 0) {
        const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        trendLabels.push(today);
        trendData.push(0);
      }

      setData({
        totalPredictions,
        avgConfidence,
        diseaseDistribution: distribution,
        trendLabels,
        trendData,
        totalMonitoringSeconds,
      });

    } catch (err) {
      console.error('Error loading deep analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  // --- CHART CONFIGURATIONS ---

  const doughnutData = {
    labels: Object.keys(data.diseaseDistribution),
    datasets: [
      {
        data: Object.values(data.diseaseDistribution),
        backgroundColor: [
          'rgba(34, 197, 94, 0.8)', // NORMAL - Green
          'rgba(239, 68, 68, 0.8)', // MI - Red
          'rgba(245, 158, 11, 0.8)', // STTC - Orange
          'rgba(59, 130, 246, 0.8)', // CD - Blue
          'rgba(168, 85, 247, 0.8)', // HYP - Purple
        ],
        borderColor: [
          'rgb(34, 197, 94)',
          'rgb(239, 68, 68)',
          'rgb(245, 158, 11)',
          'rgb(59, 130, 246)',
          'rgb(168, 85, 247)',
        ],
        borderWidth: 1,
      },
    ],
  };

  const trendChartData = {
    labels: data.trendLabels,
    datasets: [
      {
        label: 'Clinical Diagnoses Logged',
        data: data.trendData,
        fill: true,
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderColor: 'rgb(59, 130, 246)',
        tension: 0.4,
        pointBackgroundColor: 'rgb(59, 130, 246)',
        borderWidth: 2,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: { padding: 20, font: { family: "'Inter', sans-serif" } },
      },
    },
  };

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // Calculate Data Points (Assuming 20 samples per second or 50ms interval)
  const totalDataPointsProcessed = data.totalMonitoringSeconds * 20;

  return (
    <div className="space-y-6 pb-12">
      {/* Dynamic Animated Header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-indigo-900 via-blue-900 to-cyan-800 rounded-2xl p-8 text-white shadow-xl isolate">
        {/* Abstract background shapes */}
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse"></div>
        <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-64 h-64 bg-cyan-400 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" style={{ animationDelay: '2s' }}></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between">
          <div className="flex items-center space-x-5 mb-4 md:mb-0">
            <div className="w-16 h-16 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20 shadow-lg">
              <Brain className="w-8 h-8 text-cyan-300" />
            </div>
            <div>
              <h2 className="text-3xl font-black tracking-tight mb-1">Deep Analytics Core</h2>
              <p className="text-blue-200 font-medium opacity-90">Real-time model insights & diagnostic intelligence</p>
            </div>
          </div>
          <div className="flex space-x-3">
             <div className="bg-white/10 backdrop-blur-md border border-white/20 px-4 py-2 rounded-lg flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-ping"></span>
                <span className="w-2 h-2 rounded-full bg-green-400 absolute"></span>
                <span className="text-sm font-bold tracking-wider uppercase text-blue-50">ResNet-1D Online</span>
             </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          {
            title: 'Diagnostic Sessions',
            value: data.totalPredictions,
            sub: 'Fully analyzed ECGs',
            icon: Activity,
            color: 'text-blue-600',
            bg: 'bg-blue-50',
            delay: '0'
          },
          {
            title: 'Inference Confidence',
            value: `${data.avgConfidence}%`,
            sub: 'Model Average',
            icon: Shield,
            color: 'text-emerald-600',
            bg: 'bg-emerald-50',
            delay: '100'
          },
          {
            title: 'Monitoring Engine',
            value: `${Math.floor(data.totalMonitoringSeconds / 60)}m ${data.totalMonitoringSeconds % 60}s`,
            sub: 'Total Recorded Time',
            icon: Clock,
            color: 'text-purple-600',
            bg: 'bg-purple-50',
            delay: '200'
          },
          {
            title: 'Data Points Processed',
            value: totalDataPointsProcessed.toLocaleString(),
            sub: 'Feature Vectors',
            icon: Zap,
            color: 'text-amber-600',
            bg: 'bg-amber-50',
            delay: '300'
          }
        ].map((kpi, idx) => (
          <div 
            key={idx} 
            className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow animate-in slide-in-from-bottom-4 fade-in duration-500 fill-mode-both"
            style={{ animationDelay: `${kpi.delay}ms` }}
          >
            <div className="flex justify-between items-start mb-4">
              <div className={`p-3 rounded-xl ${kpi.bg}`}>
                <kpi.icon className={`w-6 h-6 ${kpi.color}`} />
              </div>
            </div>
            <div>
              <h3 className="text-3xl font-black text-gray-900 mb-1">{kpi.value}</h3>
              <p className="font-bold text-gray-700">{kpi.title}</p>
              <p className="text-xs text-gray-500 mt-1">{kpi.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Interactive Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Diagnostic Distribution Doughnut */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 lg:col-span-1 animate-in fade-in zoom-in-95 duration-700 delay-300 fill-mode-both">
          <div className="mb-6 flex items-center space-x-2">
            <HeartPulse className="w-5 h-5 text-red-500" />
            <h3 className="text-lg font-bold text-gray-900">Diagnostic Distribution</h3>
          </div>
          {data.totalPredictions > 0 ? (
            <div className="relative h-[300px] w-full flex items-center justify-center">
              <Doughnut 
                data={doughnutData} 
                options={{
                  ...chartOptions,
                  cutout: '70%',
                  plugins: {
                    legend: { position: 'bottom', labels: { padding: 20, usePointStyle: true } }
                  }
                }} 
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-8">
                <span className="text-4xl font-black text-gray-800">{data.diseaseDistribution['NORMAL'] || 0}</span>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Normal</span>
              </div>
            </div>
          ) : (
             <div className="h-[300px] flex items-center justify-center border-2 border-dashed border-gray-200 rounded-xl">
               <p className="text-gray-400 font-medium">No diagnostic data yet</p>
             </div>
          )}
        </div>

        {/* Prediction volume area chart */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 lg:col-span-2 animate-in fade-in slide-in-from-right-8 duration-700 delay-300 fill-mode-both">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between">
            <div className="flex items-center space-x-2">
              <TrendingUp className="w-5 h-5 text-blue-500" />
              <h3 className="text-lg font-bold text-gray-900">Diagnosis Volume Trend</h3>
            </div>
            <div className="mt-2 sm:mt-0 px-3 py-1 bg-gray-100 rounded-md">
               <p className="text-xs font-semibold text-gray-600">Lifetime History</p>
            </div>
          </div>
          
          <div className="h-[300px] w-full">
             <Line 
               data={trendChartData} 
               options={{
                 ...chartOptions,
                 scales: {
                   y: { beginAtZero: true, grid: { color: '#f3f4f6' } },
                   x: { grid: { display: false } }
                 },
                 interaction: {
                   intersect: false,
                   mode: 'index',
                 },
               }} 
             />
          </div>
        </div>

      </div>
      
      {/* AI Automated Insight Banner */}
      {data.totalPredictions > 0 && (
         <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-100 flex items-start space-x-4 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-500 fill-mode-both">
            <div className="bg-blue-100 p-3 rounded-xl border border-blue-200 flex-shrink-0">
               <Brain className="w-6 h-6 text-blue-600" />
            </div>
            <div>
               <h4 className="text-lg font-bold text-gray-900 mb-1">AI Generated Insight</h4>
               <p className="text-gray-700 leading-relaxed">
                 Based on the lifetime processed data of <strong>{totalDataPointsProcessed.toLocaleString()} model vectors</strong>, 
                 the AI maintains a strong average confidence of <strong>{data.avgConfidence}%</strong>. 
                 The primary categorized physiological state is predominantly  
                 <span className="font-bold text-blue-800 ml-1">
                   {Object.entries(data.diseaseDistribution).sort((a,b) => b[1] - a[1])[0]?.[0] || 'Unknown'}
                 </span>.
               </p>
            </div>
         </div>
      )}

    </div>
  );
}
