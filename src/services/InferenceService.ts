import * as tf from '@tensorflow/tfjs';

export interface PredictionResult {
  label: string;
  confidence: number;
}

const CLASSES = ['NORMAL', 'MI', 'STTC', 'CD', 'HYP'];

// Set your Supabase Public URL here once uploaded!
const REMOTE_WEIGHTS_URL = '/model/weights.json'; 

export class InferenceService {
  private model: tf.Sequential | null = null;

  private createResNetBlock(inChannels: number, outChannels: number, stride: number = 1) {
    return (input: tf.SymbolicTensor) => {
      let shortcut = input;
      if (stride !== 1 || inChannels !== outChannels) {
        shortcut = tf.layers.conv1d({
          filters: outChannels,
          kernelSize: 1,
          strides: stride,
          padding: 'same',
          useBias: false
        }).apply(input) as tf.SymbolicTensor;
        shortcut = tf.layers.batchNormalization().apply(shortcut) as tf.SymbolicTensor;
      }

      let x = tf.layers.conv1d({
        filters: outChannels,
        kernelSize: 5,
        strides: stride,
        padding: 'same',
        useBias: false
      }).apply(input) as tf.SymbolicTensor;
      x = tf.layers.batchNormalization().apply(x) as tf.SymbolicTensor;
      x = tf.layers.reLU().apply(x) as tf.SymbolicTensor;

      x = tf.layers.conv1d({
        filters: outChannels,
        kernelSize: 5,
        strides: 1,
        padding: 'same',
        useBias: false
      }).apply(x) as tf.SymbolicTensor;
      x = tf.layers.batchNormalization().apply(x) as tf.SymbolicTensor;

      x = tf.layers.add().apply([x, shortcut]) as tf.SymbolicTensor;
      return tf.layers.reLU().apply(x) as tf.SymbolicTensor;
    };
  }

  async loadModelFromWeights(weightsUrl: string = REMOTE_WEIGHTS_URL) {
    try {
      console.log(`Fetching weights from: ${weightsUrl}`);
      const response = await fetch(weightsUrl);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const weights = await response.json();

      // Define Model Architecture (Matching ResNet1D in PyTorch)
      const input = tf.input({ shape: [1000, 1] });
      
      // Initial Conv
      let x = tf.layers.conv1d({
        filters: 32,
        kernelSize: 5,
        strides: 2,
        padding: 'same',
        useBias: false
      }).apply(input) as tf.SymbolicTensor;
      x = tf.layers.batchNormalization().apply(x) as tf.SymbolicTensor;
      x = tf.layers.reLU().apply(x) as tf.SymbolicTensor;
      x = tf.layers.maxPooling1d({ poolSize: 3, strides: 2, padding: 'same' }).apply(x) as tf.SymbolicTensor;

      // Layers 1-4
      x = this.createResNetBlock(32, 64, 2)(x);
      x = this.createResNetBlock(64, 64, 1)(x);
      
      x = this.createResNetBlock(64, 128, 2)(x);
      x = this.createResNetBlock(128, 128, 1)(x);
      
      x = this.createResNetBlock(128, 256, 2)(x);
      x = this.createResNetBlock(256, 256, 1)(x);
      
      x = this.createResNetBlock(256, 512, 2)(x);
      x = this.createResNetBlock(512, 512, 1)(x);

      // Final Pool & Dense
      x = tf.layers.globalAveragePooling1d().apply(x) as tf.SymbolicTensor;
      const output = tf.layers.dense({ units: 5, activation: 'softmax' }).apply(x) as tf.SymbolicTensor;

      this.model = tf.model({ inputs: input, outputs: output }) as tf.Sequential;
      
      // Load Weights manually
      for (const layer of this.model.layers) {
          const layerName = layer.name;
          // Matching logic for weights based on JSON structure would go here
          // For now, the architecture is initialized.
      }

      console.log('TFJS ResNet1D Architecture Created & Ready');
    } catch (error) {
      console.error('Error initializing TFJS model:', error);
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
