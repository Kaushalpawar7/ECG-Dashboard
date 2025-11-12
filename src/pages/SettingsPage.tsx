import { useState } from 'react';
import { Database, Zap, Bell, Shield, Save } from 'lucide-react';

export function SettingsPage() {
  const [settings, setSettings] = useState({
    dataRefreshRate: '100',
    notificationsEnabled: true,
    autoSave: true,
    darkMode: false,
  });

  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem('ecg-settings', JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center space-x-3 mb-6">
          <Database className="w-6 h-6 text-blue-600" />
          <h3 className="text-xl font-bold text-gray-900">Database Configuration</h3>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Supabase URL
            </label>
            <input
              type="text"
              value={import.meta.env.VITE_SUPABASE_URL || 'Not configured'}
              disabled
              className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
            />
            <p className="text-xs text-gray-500 mt-1">
              Configured via environment variables
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              API Key Status
            </label>
            <div className="flex items-center space-x-2">
              <div className="flex-1 px-4 py-3 border border-gray-300 rounded-lg bg-gray-50">
                <span className="text-gray-600">
                  {import.meta.env.VITE_SUPABASE_ANON_KEY ? '••••••••••••••••' : 'Not configured'}
                </span>
              </div>
              <div
                className={`px-4 py-3 rounded-lg ${
                  import.meta.env.VITE_SUPABASE_ANON_KEY
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                }`}
              >
                {import.meta.env.VITE_SUPABASE_ANON_KEY ? 'Active' : 'Inactive'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center space-x-3 mb-6">
          <Zap className="w-6 h-6 text-blue-600" />
          <h3 className="text-xl font-bold text-gray-900">Performance Settings</h3>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Data Refresh Rate (ms)
            </label>
            <input
              type="number"
              value={settings.dataRefreshRate}
              onChange={(e) =>
                setSettings({ ...settings, dataRefreshRate: e.target.value })
              }
              min="50"
              max="1000"
              step="50"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              Controls how frequently ECG data is fetched (50-1000ms)
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center space-x-3 mb-6">
          <Bell className="w-6 h-6 text-blue-600" />
          <h3 className="text-xl font-bold text-gray-900">Notifications</h3>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900">Enable Notifications</p>
              <p className="text-sm text-gray-500">Receive alerts for important events</p>
            </div>
            <button
              onClick={() =>
                setSettings({
                  ...settings,
                  notificationsEnabled: !settings.notificationsEnabled,
                })
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.notificationsEnabled ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.notificationsEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900">Auto-Save Sessions</p>
              <p className="text-sm text-gray-500">Automatically save ECG recordings</p>
            </div>
            <button
              onClick={() => setSettings({ ...settings, autoSave: !settings.autoSave })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.autoSave ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.autoSave ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center space-x-3 mb-6">
          <Shield className="w-6 h-6 text-blue-600" />
          <h3 className="text-xl font-bold text-gray-900">Security</h3>
        </div>

        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              Your data is securely stored using Supabase with Row Level Security (RLS) enabled.
              Only you can access your patient data and ECG recordings.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">Authentication</p>
              <p className="text-sm font-medium text-gray-900">Email/Password</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">Encryption</p>
              <p className="text-sm font-medium text-gray-900">TLS 1.3</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end space-x-4">
        {saved && (
          <span className="text-sm text-green-600 font-medium">Settings saved successfully!</span>
        )}
        <button
          onClick={handleSave}
          className="flex items-center space-x-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition"
        >
          <Save className="w-5 h-5" />
          <span>Save Settings</span>
        </button>
      </div>
    </div>
  );
}
