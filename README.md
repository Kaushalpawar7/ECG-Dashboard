# ECG Dashboard - Real-Time Cardiac Monitoring System

A professional, production-ready ECG monitoring dashboard with real-time data visualization, patient management, and session recording capabilities.

## Features

### Core Functionality
- **Authentication System** - Secure email/password authentication with Supabase
- **Patient Management** - Add, edit, delete, and search patient records
- **Live ECG Monitoring** - Real-time ECG waveform visualization with simulated data
- **Session Recording** - Record and save ECG sessions to database
- **Session History** - View, download, and manage recorded sessions
- **Analytics Dashboard** - Placeholder for future AI/ML integration
- **Settings Panel** - Configure system preferences

### Technical Features
- Fully responsive design
- Real-time data streaming with Supabase
- Row Level Security (RLS) for data protection
- Beautiful, medical-grade UI design
- Chart.js for smooth ECG visualization
- TypeScript for type safety
- Tailwind CSS for styling

## Project Structure

```
src/
├── components/
│   ├── Auth/
│   │   └── LoginForm.tsx         # Authentication UI
│   ├── Dashboard/
│   │   └── StatCard.tsx          # Statistics cards
│   └── Layout/
│       ├── DashboardLayout.tsx   # Main layout wrapper
│       ├── Header.tsx            # Top navigation bar
│       └── Sidebar.tsx           # Side navigation menu
├── contexts/
│   └── AuthContext.tsx           # Authentication state management
├── lib/
│   └── supabase.ts              # Supabase client configuration
├── pages/
│   ├── HomePage.tsx             # Dashboard overview
│   ├── PatientsPage.tsx         # Patient management
│   ├── LiveECGPage.tsx          # Real-time ECG monitoring
│   ├── SessionsPage.tsx         # Session history
│   ├── AnalyticsPage.tsx        # AI analytics (placeholder)
│   └── SettingsPage.tsx         # System settings
├── types/
│   └── database.ts              # TypeScript types
└── App.tsx                      # Main application component
```

## Database Schema

### Tables
- **patients** - Patient demographic information
- **ecg_sessions** - Recording session metadata
- **ecg_data** - Raw ECG readings
- **predictions** - AI model predictions (future use)

All tables have Row Level Security enabled, ensuring users can only access their own data.

## Getting Started

### 1. Prerequisites
- Node.js 18+ installed
- A Supabase account

### 2. Setup Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. The database schema has been automatically created
3. Get your project URL and anon key from Project Settings > API

### 3. Configure Environment Variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 4. Install Dependencies

```bash
npm install
```

### 5. Run Development Server

The development server starts automatically. Your app will be available at the local URL shown in your terminal.

### 6. Build for Production

```bash
npm run build
```

## Usage Guide

### First Time Setup

1. **Create an Account**
   - Click "Sign Up" on the login page
   - Enter your email and password
   - Sign in with your new credentials

2. **Add Patients**
   - Navigate to "Patients" page
   - Click "Add Patient"
   - Fill in patient information
   - Save the patient record

3. **Start Monitoring**
   - Go to "Live ECG" page
   - Select a patient from the list
   - Click "Start Recording"
   - Watch real-time ECG data stream
   - Click "Stop Recording" when done

4. **View History**
   - Navigate to "Sessions" page
   - View all recorded sessions
   - Download sessions as CSV
   - View detailed session data

## Features Breakdown

### Home Dashboard
- System status overview
- Total patients and sessions count
- Active sessions monitoring
- Recent activity feed
- Quick action buttons

### Patient Management
- Add/edit/delete patients
- Search functionality
- Patient cards with key information
- Demographic data storage

### Live ECG Monitoring
- Real-time ECG waveform visualization
- Patient selection interface
- Recording controls (start/stop)
- Session duration tracking
- Connection status indicator
- Simulated ECG data generation

### Session History
- Tabular view of all sessions
- Session metadata (date, duration, status)
- Download sessions as CSV
- View detailed session data
- Delete unwanted sessions

### Analytics (Phase 2)
- Placeholder for CNN model integration
- AI classification roadmap
- Future prediction display

### Settings
- Database configuration display
- Performance settings
- Notification preferences
- Security information

## Data Flow

1. **Authentication**: User logs in via Supabase Auth
2. **Patient Creation**: Patient data stored in `patients` table
3. **Session Start**: Creates record in `ecg_sessions` table
4. **Data Streaming**: ECG values inserted into `ecg_data` table every 100ms
5. **Session Stop**: Updates session with end time and duration
6. **Data Retrieval**: All queries filtered by user ID via RLS

## Security Features

- Email/password authentication
- Row Level Security on all tables
- User can only access their own data
- TLS encryption for all connections
- No sensitive data in client-side code

## Future Enhancements (Phase 2)

### Backend Development
- Flask API server
- CNN model integration
- Real-time prediction endpoints
- Data preprocessing pipeline

### Frontend Enhancement
- Real-time AI predictions display
- Confidence score visualization
- Historical analytics charts
- Anomaly detection alerts

### Hardware Integration
- ESP32 ECG sensor connection
- Real device data streaming
- Lead-off detection
- Calibration controls

## Technology Stack

- **Frontend**: React 18 + TypeScript
- **Styling**: Tailwind CSS
- **Charts**: Chart.js + react-chartjs-2
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Build Tool**: Vite
- **Icons**: Lucide React

## Development Notes

### Simulated ECG Data
Currently, the system generates simulated ECG waveforms for demonstration purposes. The signal includes:
- P-wave component
- QRS complex
- T-wave component
- Random noise for realism

To integrate real ECG hardware, modify the `LiveECGPage.tsx` component to subscribe to actual device data instead of using the simulation.

### Database Queries
All database operations use Supabase client with automatic RLS filtering. Users can only:
- View their own patients
- Access their own sessions
- See their own ECG data

### Performance
- ECG data updates every 100ms
- Chart displays last 100 data points
- Smooth animations disabled for performance
- Efficient database queries with indexes

## Support

For issues or questions:
1. Check the code comments for implementation details
2. Review the Supabase documentation
3. Inspect browser console for errors
4. Verify environment variables are set correctly

## License

This project is a demonstration application for ECG monitoring systems.
