import numpy as np
from scipy import signal
from . import config

def check_signal_quality(sig):
    """
    Checks if signal is valid for inference.
    Returns: (is_valid, message)
    """
    if len(sig) < config.NUM_SAMPLES:
        return False, "Signal too short"
    
    # Check for flatline
    if np.std(sig) < 0.01:
        return False, "Flatline detected (Leads off?)"
        
    # Check for extreme noise (simple variance check)
    # This threshold relies on calibrated inputs, might need tuning
    if np.max(np.abs(sig)) > 20.0: # arbitrary high sigma after Z-norm
        return False, "Signal saturated/noisy"
        
    return True, "OK"

def preprocess_single_lead(raw_data, fs_original):
    """
    Prepares a raw 1D array (from hardware) for the model.
    1. Resample to 100Hz
    2. Bandpass 0.5-40Hz
    3. Z-score
    """
    # Resample
    if fs_original != config.SAMPLING_RATE:
        num_samples = int(len(raw_data) * config.SAMPLING_RATE / fs_original)
        raw_data = signal.resample(raw_data, num_samples)
        
    # Crop/Pad to 1000
    if len(raw_data) > config.NUM_SAMPLES:
        raw_data = raw_data[:config.NUM_SAMPLES]
    elif len(raw_data) < config.NUM_SAMPLES:
        raw_data = np.pad(raw_data, (0, config.NUM_SAMPLES - len(raw_data)))
        
    # Filter
    nyquist = 0.5 * config.SAMPLING_RATE
    low = config.LOWCUT / nyquist
    high = config.HIGHCUT / nyquist
    b, a = signal.butter(1, [low, high], btype='band')
    filtered = signal.lfilter(b, a, raw_data)
    
    # Normalize
    if np.std(filtered) > 1e-6:
        normalized = (filtered - np.mean(filtered)) / np.std(filtered)
    else:
        normalized = np.zeros_like(filtered)
        
    return normalized
