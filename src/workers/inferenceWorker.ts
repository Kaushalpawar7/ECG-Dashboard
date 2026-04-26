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

      const chunks: number[][] = [];
      const HW_WINDOW = 100; // 2 seconds at 50Hz
      
      const processingStep = data.length > 20000 
        ? HW_WINDOW 
        : Math.floor(HW_WINDOW / 2);

      for (let i = 0; i <= data.length - HW_WINDOW; i += processingStep) {
        const rawChunk = data.slice(i, i + HW_WINDOW);
        
        // 10x LINEAR INTERPOLATION (50Hz -> 500Hz)
        const upsampled = new Float32Array(CHUNK_SIZE);
        for (let j = 0; j < CHUNK_SIZE; j++) {
           const index = j / 10; 
           const low = Math.floor(index);
           const high = Math.ceil(index);
           const weight = index - low;
           
           if (high >= rawChunk.length) {
              upsampled[j] = rawChunk[rawChunk.length - 1];
           } else {
              upsampled[j] = rawChunk[low] * (1 - weight) + rawChunk[high] * weight;
           }
        }
        
        // Z-SCORE NORMALIZATION on upsampled data
        const mean = upsampled.reduce((a, b) => a + b, 0) / CHUNK_SIZE;
        const variance = upsampled.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / CHUNK_SIZE;
        const std = Math.sqrt(variance) || 1.0; 
        const normalized = Array.from(upsampled).map(v => (v - mean) / std);
        
        chunks.push(normalized);
      }

      if (chunks.length > 0) {
        const CHUNKS_PER_GPU_BATCH = 32;
        const labels = ['NORMAL', 'MI', 'STTC', 'CD', 'HYP'];

        for (let b = 0; b < chunks.length; b += CHUNKS_PER_GPU_BATCH) {
          const miniBatch = chunks.slice(b, b + CHUNKS_PER_GPU_BATCH);
          
          // Use high-performance float32 flattened array
          const flattened = new Float32Array(miniBatch.length * CHUNK_SIZE);
          for (let i = 0; i < miniBatch.length; i++) {
            flattened.set(miniBatch[i], i * CHUNK_SIZE);
          }

          const inputTensor = tf.tensor3d(flattened, [miniBatch.length, CHUNK_SIZE, 1]);
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
