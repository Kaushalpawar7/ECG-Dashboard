import * as tf from '@tensorflow/tfjs';
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

      // Optimization: If the dataset is huge, increase the stride to avoid over-sampling
      const baseStride = Math.floor(CHUNK_SIZE / 2); // 500ms overlap
      const stride = data.length > 30000 ? CHUNK_SIZE : baseStride; // 0% overlap for sessions > 5 mins
      
      // Limit to max 200 checks for ultra-long sessions (sanity cap)
      const maxChecks = 200;
      const step = data.length > 200000 ? Math.floor(data.length / maxChecks) : stride;

      const chunks: number[][] = [];
      for (let i = 0; i <= data.length - CHUNK_SIZE; i += step) {
        chunks.push(data.slice(i, i + CHUNK_SIZE));
      }

      if (chunks.length > 0) {
        const CHUNKS_PER_GPU_BATCH = 32;
        const labels = ['NORMAL', 'MI', 'STTC', 'CD', 'HYP'];

        for (let b = 0; b < chunks.length; b += CHUNKS_PER_GPU_BATCH) {
          const miniBatch = chunks.slice(b, b + CHUNKS_PER_GPU_BATCH);
          
          // Manual memory management for async loop
          const inputTensor = tf.tensor3d(miniBatch.flat(), [miniBatch.length, CHUNK_SIZE, 1]);
          const outputTensor = inferenceService.modelInstance?.predict(inputTensor) as tf.Tensor;
          const results = await outputTensor.data();

          for (let j = 0; j < miniBatch.length; j++) {
            let maxVal = -1;
            let maxIdx = 0;
            for (let k = 0; k < 5; k++) {
              const val = results[j * 5 + k];
              if (val > maxVal) {
                maxVal = val;
                maxIdx = k;
              }
            }
            predictions[labels[maxIdx]] += 1;
            chunkCount++;
          }

          inputTensor.dispose();
          outputTensor.dispose();

          const percent = Math.round(((b + miniBatch.length) / chunks.length) * 100);
          self.postMessage({ type: 'ANALYSIS_PROGRESS', progress: percent });
        }
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
