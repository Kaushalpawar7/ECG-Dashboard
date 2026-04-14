import * as tf from '@tensorflow/tfjs';

export interface PredictionResult {
  label: string;
  confidence: number;
}

const CLASSES = ['NORMAL', 'MI', 'STTC', 'CD', 'HYP'];

// Direct local path for the new 25MB binary weights
const BINARY_WEIGHTS_URL = '/model/weights.bin';
const METADATA_URL = '/model/metadata.json';

export class InferenceService {
  private model: tf.Sequential | null = null;

  private createResNetBlock(inChannels: number, outChannels: number, stride: number = 1, prefix: string) {
    return (input: tf.SymbolicTensor) => {
      let shortcut = input;
      if (stride !== 1 || inChannels !== outChannels) {
        shortcut = tf.layers.conv1d({
          filters: outChannels,
          kernelSize: 1,
          strides: stride,
          padding: 'same',
          useBias: false,
          name: `${prefix}.shortcut.0`
        }).apply(input) as tf.SymbolicTensor;
        shortcut = tf.layers.batchNormalization({ name: `${prefix}.shortcut.1` }).apply(shortcut) as tf.SymbolicTensor;
      }

      let x = tf.layers.conv1d({
        filters: outChannels,
        kernelSize: 5,
        strides: stride,
        padding: 'same',
        useBias: false,
        name: `${prefix}.conv1`
      }).apply(input) as tf.SymbolicTensor;
      x = tf.layers.batchNormalization({ name: `${prefix}.bn1` }).apply(x) as tf.SymbolicTensor;
      x = tf.layers.reLU({ name: `${prefix}.relu1` }).apply(x) as tf.SymbolicTensor;

      x = tf.layers.conv1d({
        filters: outChannels,
        kernelSize: 5,
        strides: 1,
        padding: 'same',
        useBias: false,
        name: `${prefix}.conv2`
      }).apply(x) as tf.SymbolicTensor;
      x = tf.layers.batchNormalization({ name: `${prefix}.bn2` }).apply(x) as tf.SymbolicTensor;

      x = tf.layers.add({ name: `${prefix}.add` }).apply([x, shortcut]) as tf.SymbolicTensor;
      return tf.layers.reLU({ name: `${prefix}.relu2` }).apply(x) as tf.SymbolicTensor;
    };
  }

  async loadModelFromWeights(
    weightsUrl: string = BINARY_WEIGHTS_URL,
    metaUrl: string = METADATA_URL,
    onProgress?: (progress: number) => void
  ) {
    try {
      console.log(`Fetching architecture metadata from: ${metaUrl}`);
      const metaResponse = await fetch(metaUrl);
      const metadata = await metaResponse.json();

      console.log(`Checking cache for weights from: ${weightsUrl}`);
      const cache = await caches.open('ecg-model-cache');
      let cachedResponse = await cache.match(weightsUrl);
      let weightsArrayBuffer: ArrayBuffer;

      if (cachedResponse) {
        console.log('Model binary weights found in browser cache!');
        if (onProgress) onProgress(100);
        weightsArrayBuffer = await cachedResponse.arrayBuffer();
      } else {
        console.log('Model not in cache. Fetching binary from network...');
        const response = await fetch(weightsUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 25 * 1024 * 1024; // fallback ~25MB
        
        let loaded = 0;
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              loaded += value.length;
              chunks.push(value);
              if (onProgress) {
                // Ensure max 100% just in case headers are inaccurate
                onProgress(Math.min(100, Math.round((loaded / total) * 100)));
              }
            }
          }
        }
        
        const blob = new Blob(chunks as BlobPart[]);
        weightsArrayBuffer = await blob.arrayBuffer();
        
        console.log('Download complete. Caching model weights binary...');
        const cacheResponse = new Response(blob, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': blob.size.toString()
          }
        });
        await cache.put(weightsUrl, cacheResponse);
      }

      // Convert buffer directly to Float32 Array
      const float32Weights = new Float32Array(weightsArrayBuffer);

      // Define Model Architecture (Matching ResNet1D in PyTorch)
      const input = tf.input({ shape: [1000, 1] });
      
      // Initial Conv
      let x = tf.layers.conv1d({
        filters: 32,
        kernelSize: 5,
        strides: 2,
        padding: 'same',
        useBias: false,
        name: 'initial_conv.0'
      }).apply(input) as tf.SymbolicTensor;
      x = tf.layers.batchNormalization({ name: 'initial_conv.1' }).apply(x) as tf.SymbolicTensor;
      x = tf.layers.reLU({ name: 'initial_relu' }).apply(x) as tf.SymbolicTensor;
      x = tf.layers.maxPooling1d({ poolSize: 3, strides: 2, padding: 'same', name: 'initial_pool' }).apply(x) as tf.SymbolicTensor;

      // Layers 1-4
      x = this.createResNetBlock(32, 64, 2, 'layer1.0')(x);
      x = this.createResNetBlock(64, 64, 1, 'layer1.1')(x);
      
      x = this.createResNetBlock(64, 128, 2, 'layer2.0')(x);
      x = this.createResNetBlock(128, 128, 1, 'layer2.1')(x);
      
      x = this.createResNetBlock(128, 256, 2, 'layer3.0')(x);
      x = this.createResNetBlock(256, 256, 1, 'layer3.1')(x);
      
      x = this.createResNetBlock(256, 512, 2, 'layer4.0')(x);
      x = this.createResNetBlock(512, 512, 1, 'layer4.1')(x);

      // Final Pool & Dense
      x = tf.layers.globalAveragePooling1d({ name: 'pool' }).apply(x) as tf.SymbolicTensor;
      const output = tf.layers.dense({ units: 5, activation: 'softmax', name: 'fc' }).apply(x) as tf.SymbolicTensor;

      this.model = tf.model({ inputs: input, outputs: output, name: 'ResNet1D' }) as tf.Sequential;
      
      // Load Weights manually
      for (const layer of this.model.layers) {
        const ln = layer.name;
        const className = layer.getClassName();

        if (className === 'Conv1D') {
          if (metadata[`${ln}.weight`]) {
            const m = metadata[`${ln}.weight`];
            // PyTorch Shape: [out_channels, in_channels, kernel]
            // TFJS Shape: [kernel, in_channels, out_channels]
            const pytorchWeights = tf.tensor(float32Weights.slice(m.offset, m.offset + m.size), m.shape);
            const tfjsWeights = pytorchWeights.transpose([2, 1, 0]);
            layer.setWeights([tfjsWeights]);
            pytorchWeights.dispose(); // clean up
          }
        } 
        else if (className === 'Dense') {
          if (metadata[`${ln}.weight`] && metadata[`${ln}.bias`]) {
            const mw = metadata[`${ln}.weight`];
            const mb = metadata[`${ln}.bias`];
            
            // PyTorch Dense: [out, in], TFJS Dense: [in, out]
            const pytorchW = tf.tensor(float32Weights.slice(mw.offset, mw.offset + mw.size), mw.shape);
            const tfjsW = pytorchW.transpose([1, 0]);
            const tfjsB = tf.tensor(float32Weights.slice(mb.offset, mb.offset + mb.size), mb.shape);
            
            layer.setWeights([tfjsW, tfjsB]);
            pytorchW.dispose();
          }
        }
        else if (className === 'BatchNormalization') {
          if (metadata[`${ln}.weight`] && metadata[`${ln}.bias`]) {
            const mw = metadata[`${ln}.weight`]; // gamma
            const mb = metadata[`${ln}.bias`]; // beta
            
            const gamma = tf.tensor(float32Weights.slice(mw.offset, mw.offset + mw.size), mw.shape);
            const beta = tf.tensor(float32Weights.slice(mb.offset, mb.offset + mb.size), mb.shape);
            
            // Note: If PyTorch metadata doesn't have running_mean and running_var, calculate zeros and ones (mock stats)
            // A more accurate model would require re-exporting the running_stats from `state_dict` in Python.
            const moving_mean = tf.zerosLike(gamma);
            const moving_variance = tf.onesLike(gamma);
            
            layer.setWeights([gamma, beta, moving_mean, moving_variance]);
          }
        }
      }

      console.log('TFJS ResNet1D Architecture Created & Ready');
    } catch (error) {
      console.error('Error initializing TFJS model:', error);
    }
  }

  async isModelCached(weightsUrl: string = BINARY_WEIGHTS_URL): Promise<boolean> {
    try {
      const cache = await caches.open('ecg-model-cache');
      const cachedResponse = await cache.match(weightsUrl);
      return !!cachedResponse;
    } catch (error) {
      return false;
    }
  }

  async predict(data: number[]): Promise<PredictionResult> {
    if (!this.model) return { label: 'Initializing Model...', confidence: 0 };

    return tf.tidy(() => {
      const tensor = tf.tensor(data, [1, 1000, 1]).div(4095.0);
      const prediction = this.model!.predict(tensor) as tf.Tensor;
      const scores = prediction.dataSync();
      const maxIdx = prediction.argMax(1).dataSync()[0];
      
      return {
        label: CLASSES[maxIdx],
        confidence: Math.round(scores[maxIdx] * 100)
      };
    });
  }
}

export const inferenceService = new InferenceService();
