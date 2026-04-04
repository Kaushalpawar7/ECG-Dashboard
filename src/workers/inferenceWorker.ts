import { inferenceService } from '../services/InferenceService';

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'INIT') {
    try {
      await inferenceService.loadModelFromWeights(undefined, undefined, (progress) => {
        self.postMessage({ type: 'PROGRESS', progress });
      });
      self.postMessage({ type: 'INIT_DONE' });
    } catch (error) {
      console.error('Worker Init Error:', error);
      self.postMessage({ type: 'ERROR', error: String(error) });
    }
  }

  if (type === 'PREDICT') {
    try {
      const data = payload as number[];
      // We need chunks of 1000 samples.
      const CHUNK_SIZE = 1000;
      const predictions: Record<string, number> = {
        'NORMAL': 0,
        'MI': 0,
        'STTC': 0,
        'CD': 0,
        'HYP': 0
      };

      let chunkCount = 0;

      // Slice the data into overlapping or sequential 1000-sample chunks
      for (let i = 0; i <= data.length - CHUNK_SIZE; i += Math.floor(CHUNK_SIZE / 2)) {
        const chunk = data.slice(i, i + CHUNK_SIZE);
        const result = await inferenceService.predict(chunk);
        
        predictions[result.label] += 1;
        chunkCount++;
        
        // Dynamic progress update for the long prediction loop!
        const percent = Math.round((i / (data.length - CHUNK_SIZE)) * 100);
        self.postMessage({ type: 'ANALYSIS_PROGRESS', progress: percent });
      }

      // Calculate final distribution
      let finalDiagnosis = 'NORMAL';
      let highestCount = 0;
      
      let confidenceMap: Record<string, number> = {};

      for (const [label, count] of Object.entries(predictions)) {
        if (chunkCount > 0) {
           confidenceMap[label] = Math.round((count / chunkCount) * 100);
        } else {
           confidenceMap[label] = 0;
        }

        if (count > highestCount) {
          highestCount = count;
          finalDiagnosis = label;
        }
      }

      // Fallback if session was too short (less than 1000 points)
      if (chunkCount === 0) {
        if (data.length > 0) {
          // pad and run once
          const padded = [...data];
          while (padded.length < 1000) padded.unshift(2000);
          const result = await inferenceService.predict(padded);
          finalDiagnosis = result.label;
          confidenceMap[result.label] = 100;
        } else {
          finalDiagnosis = 'Unknown (No Data)';
        }
      }

      self.postMessage({ 
        type: 'ANALYSIS_COMPLETE', 
        result: {
           diagnosis: finalDiagnosis,
           confidence: confidenceMap[finalDiagnosis] || 0,
           distribution: confidenceMap
        } 
      });

    } catch (error) {
      console.error('Worker Predict Error:', error);
      self.postMessage({ type: 'ERROR', error: String(error) });
    }
  }
};
