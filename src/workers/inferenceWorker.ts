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
      // CLINICAL RECALIBRATION: 
      // 10-second window (500 samples at 50Hz) upsampled 2x to 1000 points.
      // Standardizes the signal to a 100Hz clinical view.
      const HW_WINDOW = 500; 
      const processingStep = 100; // High resolution overlap

      for (let i = 0; i <= data.length - HW_WINDOW; i += processingStep) {
        const rawChunk = data.slice(i, i + HW_WINDOW);
        
        // 1. STAGE 1: 40Hz CLINICAL LOW-PASS
        const filteredChunk = new Float32Array(HW_WINDOW);
        let alpha = 0.5; 
        filteredChunk[0] = rawChunk[0];
        for (let j = 1; j < HW_WINDOW; j++) {
           filteredChunk[j] = alpha * rawChunk[j] + (1 - alpha) * filteredChunk[j-1];
        }

        // 2. STAGE 2: 2x UPSAMPLING (50Hz -> 100Hz clinical target)
        const upsampled = new Float32Array(CHUNK_SIZE);
        for (let j = 0; j < CHUNK_SIZE; j++) {
           const index = (j / CHUNK_SIZE) * (HW_WINDOW - 1);
           const low = Math.floor(index);
           const high = Math.min(HW_WINDOW - 1, Math.ceil(index));
           const weight = index - low;
           upsampled[j] = filteredChunk[low] * (1 - weight) + filteredChunk[high] * weight;
        }
        
        // 3. STAGE 3: MIN-MAX NORMALIZATION [0, 1]
        const minVal = Math.min(...Array.from(upsampled));
        const maxVal = Math.max(...Array.from(upsampled));
        const range = (maxVal - minVal) || 1.0;
        const normalized = Array.from(upsampled).map(v => (v - minVal) / range);
        
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
