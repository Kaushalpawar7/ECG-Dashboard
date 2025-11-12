import { Brain, TrendingUp, Shield, AlertTriangle } from 'lucide-react';

export function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl p-8 text-white">
        <div className="flex items-center space-x-4 mb-4">
          <div className="w-16 h-16 bg-white bg-opacity-20 rounded-xl flex items-center justify-center">
            <Brain className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-3xl font-bold mb-2">AI Analytics</h2>
            <p className="text-blue-100">Deep learning powered ECG analysis</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-start space-x-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <Brain className="w-6 h-6 text-blue-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-gray-900 mb-2">CNN Model</h3>
              <p className="text-sm text-gray-600 mb-3">
                Convolutional Neural Network for ECG pattern recognition
              </p>
              <div className="bg-gray-100 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Status</p>
                <p className="text-sm font-medium text-gray-900">Coming Soon</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-start space-x-4">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-green-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-gray-900 mb-2">Classification</h3>
              <p className="text-sm text-gray-600 mb-3">
                Automatic arrhythmia detection and classification
              </p>
              <div className="bg-gray-100 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Accuracy</p>
                <p className="text-sm font-medium text-gray-900">Phase 2</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-start space-x-4">
            <div className="w-12 h-12 bg-cyan-100 rounded-lg flex items-center justify-center">
              <Shield className="w-6 h-6 text-cyan-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-gray-900 mb-2">Confidence Score</h3>
              <p className="text-sm text-gray-600 mb-3">
                Prediction reliability measurement
              </p>
              <div className="bg-gray-100 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Range</p>
                <p className="text-sm font-medium text-gray-900">0-100%</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-8 shadow-sm border border-gray-100">
        <h3 className="text-xl font-bold text-gray-900 mb-6">AI Integration Roadmap</h3>

        <div className="space-y-6">
          <div className="flex items-start space-x-4">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold text-sm">
              1
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-gray-900 mb-2">Data Collection & Preprocessing</h4>
              <p className="text-gray-600 mb-2">
                Collect and prepare ECG data for model training. Implement filtering, normalization, and segmentation.
              </p>
              <span className="inline-block px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                In Progress
              </span>
            </div>
          </div>

          <div className="flex items-start space-x-4">
            <div className="flex-shrink-0 w-8 h-8 bg-gray-300 text-white rounded-full flex items-center justify-center font-bold text-sm">
              2
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-gray-900 mb-2">CNN Model Development</h4>
              <p className="text-gray-600 mb-2">
                Build and train a deep learning model for ECG classification using TensorFlow/Keras.
              </p>
              <span className="inline-block px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">
                Planned
              </span>
            </div>
          </div>

          <div className="flex items-start space-x-4">
            <div className="flex-shrink-0 w-8 h-8 bg-gray-300 text-white rounded-full flex items-center justify-center font-bold text-sm">
              3
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-gray-900 mb-2">Backend Integration</h4>
              <p className="text-gray-600 mb-2">
                Integrate trained model with Flask backend for real-time predictions.
              </p>
              <span className="inline-block px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">
                Planned
              </span>
            </div>
          </div>

          <div className="flex items-start space-x-4">
            <div className="flex-shrink-0 w-8 h-8 bg-gray-300 text-white rounded-full flex items-center justify-center font-bold text-sm">
              4
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-gray-900 mb-2">Dashboard Visualization</h4>
              <p className="text-gray-600 mb-2">
                Display predictions, confidence scores, and historical analytics in the dashboard.
              </p>
              <span className="inline-block px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">
                Planned
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
        <div className="flex items-start space-x-3">
          <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-1" />
          <div>
            <h4 className="font-bold text-amber-900 mb-2">Phase 2 Feature</h4>
            <p className="text-amber-800">
              The AI analytics module is currently under development. Once integrated, it will provide:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-amber-800">
              <li>Automatic arrhythmia detection</li>
              <li>Multi-class ECG classification</li>
              <li>Real-time prediction confidence scores</li>
              <li>Historical trend analysis</li>
              <li>Anomaly detection alerts</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
