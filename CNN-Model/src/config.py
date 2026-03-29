import os

# Paths
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
PTBXL_PATH = os.path.join(DATA_DIR, "ptbxl")
CHECKPOINT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "checkpoints")

# Audio/Hardware Simulation
SAMPLING_RATE = 100  # Hz
DURATION = 10  # Seconds
NUM_SAMPLES = SAMPLING_RATE * DURATION  # 1000

# Bandpass Filter for AD8232 Simulation
LOWCUT = 0.5
HIGHCUT = 40.0

# Training
BATCH_SIZE = 64
EPOCHS = 20
LEARNING_RATE = 1e-3

# Labels (PTB-XL Superclasses)
CLASSES = ['NORM', 'MI', 'STTC', 'CD', 'HYP']
NUM_CLASSES = len(CLASSES)
