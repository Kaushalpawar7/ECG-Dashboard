import { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginForm } from './components/Auth/LoginForm';
import { DashboardLayout } from './components/Layout/DashboardLayout';
import { HomePage } from './pages/HomePage';
import { PatientsPage } from './pages/PatientsPage';
import { LiveECGPage } from './pages/LiveECGPage';
import { SessionsPage } from './pages/SessionsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SettingsPage } from './pages/SettingsPage';

function AppContent() {
  const { user, loading, signOut } = useAuth();
  const [currentPage, setCurrentPage] = useState('home');

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginForm />;
  }

  const getPageTitle = () => {
    switch (currentPage) {
      case 'home':
        return 'Dashboard Overview';
      case 'patients':
        return 'Patient Management';
      case 'live':
        return 'Live ECG Monitoring';
      case 'sessions':
        return 'Session History';
      case 'analytics':
        return 'AI Analytics';
      case 'settings':
        return 'Settings';
      default:
        return 'Dashboard';
    }
  };

  const getPageSubtitle = () => {
    switch (currentPage) {
      case 'home':
        return 'Monitor system status and recent activity';
      case 'patients':
        return 'Manage patient records and information';
      case 'live':
        return 'Real-time cardiac signal monitoring';
      case 'sessions':
        return 'View and manage ECG recording sessions';
      case 'analytics':
        return 'AI-powered ECG analysis and predictions';
      case 'settings':
        return 'Configure system preferences';
      default:
        return '';
    }
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <HomePage />;
      case 'patients':
        return <PatientsPage />;
      case 'live':
        return <LiveECGPage />;
      case 'sessions':
        return <SessionsPage />;
      case 'analytics':
        return <AnalyticsPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <HomePage />;
    }
  };

  return (
    <DashboardLayout
      currentPage={currentPage}
      onNavigate={setCurrentPage}
      onSignOut={signOut}
      title={getPageTitle()}
      subtitle={getPageSubtitle()}
    >
      {renderPage()}
    </DashboardLayout>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
