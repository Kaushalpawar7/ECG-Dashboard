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
            <h3 className="text-2xl font-bold mb-2">System Status</h3>
            <p className="text-blue-100">All systems operational</p>
          </div>
          <div className="flex items-center space-x-2">
            {isConnected ? (
              <>
                <Wifi className="w-6 h-6" />
                <span className="font-medium">Connected</span>
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
          color="bg-blue-500"
        />
        <StatCard
          title="Total Sessions"
          value={stats.totalSessions}
          icon={Clock}
          color="bg-cyan-500"
        />
        <StatCard
          title="Active Sessions"
          value={stats.activeSessions}
          icon={Activity}
          color="bg-green-500"
        />
        <StatCard
          title="Completed Today"
          value={stats.completedToday}
          icon={CheckCircle}
          color="bg-indigo-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Recent Activity</h3>
          <div className="space-y-3">
            {recentActivity.length > 0 ? (
              recentActivity.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg"
                >
                  <div
                    className={`w-2 h-2 rounded-full mt-2 ${
                      activity.type === 'active'
                        ? 'bg-green-500'
                        : activity.type === 'completed'
                        ? 'bg-blue-500'
                        : 'bg-gray-500'
                    }`}
                  ></div>
                  <div className="flex-1">
                    <p className="text-sm text-gray-900">{activity.message}</p>
                    <p className="text-xs text-gray-500 mt-1">{activity.time}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-sm text-center py-8">No recent activity</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Quick Actions</h3>
          <div className="space-y-3">
            <button className="w-full flex items-center space-x-3 p-4 bg-blue-50 hover:bg-blue-100 rounded-lg transition text-left">
              <Users className="w-5 h-5 text-blue-600" />
              <div>
                <p className="font-medium text-gray-900">Add New Patient</p>
                <p className="text-xs text-gray-500">Register a new patient</p>
              </div>
            </button>
            <button className="w-full flex items-center space-x-3 p-4 bg-green-50 hover:bg-green-100 rounded-lg transition text-left">
              <Activity className="w-5 h-5 text-green-600" />
              <div>
                <p className="font-medium text-gray-900">Start Monitoring</p>
                <p className="text-xs text-gray-500">Begin live ECG session</p>
              </div>
            </button>
            <button className="w-full flex items-center space-x-3 p-4 bg-cyan-50 hover:bg-cyan-100 rounded-lg transition text-left">
              <Clock className="w-5 h-5 text-cyan-600" />
              <div>
                <p className="font-medium text-gray-900">View Sessions</p>
                <p className="text-xs text-gray-500">Access session history</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
