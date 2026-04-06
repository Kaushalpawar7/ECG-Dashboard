import { useEffect, useState } from 'react';
import { Users, Activity, Clock, CheckCircle, Wifi, WifiOff } from 'lucide-react';
import { StatCard } from '../components/Dashboard/StatCard';
import { supabase } from '../lib/supabase';

export function HomePage() {
  const [stats, setStats] = useState({
    totalPatients: 0,
    totalSessions: 0,
    activeSessions: 0,
    completedToday: 0,
  });
  const [isConnected, setIsConnected] = useState(true);
  const [recentActivity, setRecentActivity] = useState<Array<{
    id: string;
    type: string;
    message: string;
    time: string;
  }>>([]);

  useEffect(() => {
    loadStats();
    loadRecentActivity();
  }, []);

  const loadStats = async () => {
    try {
      const [patientsRes, sessionsRes, activeRes] = await Promise.all([
        supabase.from('patients').select('id', { count: 'exact', head: true }),
        supabase.from('ecg_sessions').select('id', { count: 'exact', head: true }),
        supabase.from('ecg_sessions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      ]);

      const today = new Date().toISOString().split('T')[0];
      const completedRes = await supabase
        .from('ecg_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed')
        .gte('created_at', today);

      setStats({
        totalPatients: patientsRes.count || 0,
        totalSessions: sessionsRes.count || 0,
        activeSessions: activeRes.count || 0,
        completedToday: completedRes.count || 0,
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const loadRecentActivity = async () => {
    try {
      const { data: sessions } = await supabase
        .from('ecg_sessions')
        .select('id, created_at, status, patient_id, patients(name)')
        .order('created_at', { ascending: false })
        .limit(5);

      if (sessions) {
        const activity = sessions.map((session: any) => ({
          id: session.id,
          type: session.status,
          message: `Session ${session.status} for ${session.patients?.name || 'Unknown Patient'}`,
          time: new Date(session.created_at).toLocaleTimeString(),
        }));
        setRecentActivity(activity);
      }
    } catch (error) {
      console.error('Error loading recent activity:', error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold mb-2 text-white">System Status</h3>
            <p className="text-blue-100 font-medium tracking-wide">All systems operational</p>
          </div>
          <div className="flex items-center space-x-2 bg-white/20 px-4 py-2 rounded-full backdrop-blur-sm border border-white/30">
            {isConnected ? (
              <>
                <Wifi className="w-5 h-5 animate-pulse text-white" />
                <span className="font-bold text-white tracking-wider uppercase text-sm">Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="w-6 h-6" />
                <span className="font-medium">Disconnected</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Patients"
          value={stats.totalPatients}
          icon={Users}
          theme="blue"
        />
        <StatCard
          title="Total Sessions"
          value={stats.totalSessions}
          icon={Clock}
          theme="cyan"
        />
        <StatCard
          title="Active Sessions"
          value={stats.activeSessions}
          icon={Activity}
          theme="green"
        />
        <StatCard
          title="Completed Today"
          value={stats.completedToday}
          icon={CheckCircle}
          theme="indigo"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 overflow-hidden relative">
          <h3 className="text-lg font-bold text-gray-900 mb-6">Recent Activity</h3>
          <div className="space-y-6 relative ml-2">
            
            {/* Timeline Vertical Line Overlay */}
            {recentActivity.length > 0 && (
              <div className="absolute left-[7px] top-4 bottom-4 w-[2px] bg-gray-100 -z-0 rounded-full animate-in fade-in fill-mode-both duration-1000 delay-500"></div>
            )}

            {recentActivity.length > 0 ? (
              recentActivity.map((activity, index) => (
                <div
                  key={activity.id}
                  className="relative flex items-start space-x-4 animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both group"
                  style={{ animationDelay: `${index * 150}ms` }}
                >
                  <div
                    className={`relative z-10 w-4 h-4 rounded-full mt-1 border-4 border-white shadow-sm transition-transform duration-300 group-hover:scale-125 ${
                      activity.type === 'active'
                        ? 'bg-green-500 shadow-green-500/50 my-auto'
                        : activity.type === 'completed'
                        ? 'bg-blue-500 shadow-blue-500/50'
                        : 'bg-gray-400'
                    }`}
                  ></div>
                  <div className="flex-1 bg-gray-50/80 hover:bg-white p-3 -mt-2 rounded-xl border border-transparent hover:border-gray-200 transition-colors shadow-sm hover:shadow-md">
                    <p className="text-sm font-semibold text-gray-900">{activity.message}</p>
                    <p className="text-xs font-semibold tracking-wider text-gray-400 mt-0.5 uppercase">{activity.time}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-400 font-medium text-sm text-center py-8">No recent activity</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
          <h3 className="text-lg font-bold text-gray-900 mb-6">Quick Actions</h3>
          <div className="space-y-4">
            <button className="group w-full flex items-center justify-between p-5 bg-white border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 hover:border-blue-200 rounded-2xl transition-all duration-200 text-left">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-bold text-gray-900">Add New Patient</p>
                  <p className="text-xs font-medium text-gray-500 mt-0.5">Register a new patient</p>
                </div>
              </div>
              <div className="text-gray-300 group-hover:text-blue-600 group-hover:translate-x-1 transition-all mr-2">
                →
              </div>
            </button>
            
            <button className="group w-full flex items-center justify-between p-5 bg-white border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 hover:border-green-200 rounded-2xl transition-all duration-200 text-left">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 rounded-full bg-green-50 text-green-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Activity className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-bold text-gray-900">Start Monitoring</p>
                  <p className="text-xs font-medium text-gray-500 mt-0.5">Begin live ECG session</p>
                </div>
              </div>
              <div className="text-gray-300 group-hover:text-green-600 group-hover:translate-x-1 transition-all mr-2">
                →
              </div>
            </button>

            <button className="group w-full flex items-center justify-between p-5 bg-white border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 hover:border-cyan-200 rounded-2xl transition-all duration-200 text-left">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 rounded-full bg-cyan-50 text-cyan-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-bold text-gray-900">View Sessions</p>
                  <p className="text-xs font-medium text-gray-500 mt-0.5">Access session history</p>
                </div>
              </div>
              <div className="text-gray-300 group-hover:text-cyan-600 group-hover:translate-x-1 transition-all mr-2">
                →
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
