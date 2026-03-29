import os
import torch
import numpy as np
import pandas as pd
import wfdb
import ast
from scipy import signal
from torch.utils.data import Dataset
from . import config

def load_ptbxl_metadata(path=config.PTBXL_PATH):
    """Loads PTB-XL database CSV and processes labels."""
    df = pd.read_csv(os.path.join(path, 'ptbxl_database.csv'), index_col='ecg_id')
    df.scp_codes = df.scp_codes.apply(lambda x: ast.literal_eval(x))
    
    # Load SCP statements for aggregation
    agg_df = pd.read_csv(os.path.join(path, 'scp_statements.csv'), index_col=0)
    agg_df = agg_df[agg_df.diagnostic == 1]
    
    def aggregate_diagnostic(y_dic):
        tmp = []
        for key in y_dic.keys():
            if key in agg_df.index:
                tmp.append(agg_df.loc[key].diagnostic_class)
        return list(set(tmp))

    df['diagnostic_superclass'] = df.scp_codes.apply(aggregate_diagnostic)
    return df

class PTBXLDataset(Dataset):
    def __init__(self, df, root_dir=config.PTBXL_PATH, mode='train'):
        """
        Args:
            df (pd.DataFrame): Metadata dataframe.
            root_dir (str): Path to PTB-XL data.
            mode (str): 'train' or 'test'.
        """
        self.df = df
        self.root_dir = root_dir
        self.mode = mode
        
        # Pre-compute One-Hot Encoding for labels
        self.labels = np.zeros((len(df), config.NUM_CLASSES), dtype=np.float32)
        for i, (index, row) in enumerate(df.iterrows()):
            for label in row.diagnostic_superclass:
                if label in config.CLASSES:
                    idx = config.CLASSES.index(label)
                    self.labels[i, idx] = 1.0

    def __len__(self):
        return len(self.df)

    def apply_filter(self, signal_data):
        """Applies 0.5-40Hz Bandpass Filter (Butterworth) to simulate AD8232."""
        nyquist = 0.5 * config.SAMPLING_RATE
        low = config.LOWCUT / nyquist
        high = config.HIGHCUT / nyquist
        b, a = signal.butter(1, [low, high], btype='band') # 1st order for hardware sim
        filtered_signal = signal.lfilter(b, a, signal_data)
        return filtered_signal

    def __getitem__(self, idx):
        row = self.df.iloc[idx]
        
        # Load Signal
        # PTB-XL files are in subfolders relative to root
        filename = row.filename_lr  # Use low-res (100Hz) if available, else filename_hr
        
        # Adjust path if needed (PTB-XL structure usually 'records100/...')
        file_path = os.path.join(self.root_dir, filename)
        
        try:
            # Read WFDB file
            # channels=[0] reads only Lead I (usually)
            # check stats showing Lead I is index 0
            data, meta = wfdb.rdsamp(file_path, channels=[0]) 
            
            # Data is (1000, 1)
            sig = data.flatten()
            
            # Handle NaNs
            if np.isnan(sig).any():
                sig = np.nan_to_num(sig)
                
            # 1. Bandpass Filter (0.5 - 40Hz)
            sig = self.apply_filter(sig)
            
            # 2. Z-Score Normalization
            # Important: Normalize AFTER filtering to handle baseline wander removal first
            if np.std(sig) > 1e-6:
                sig = (sig - np.mean(sig)) / np.std(sig)
            else:
                sig = np.zeros_like(sig)
                
            # Ensure length is 1000
            if len(sig) > config.NUM_SAMPLES:
                sig = sig[:config.NUM_SAMPLES]
            elif len(sig) < config.NUM_SAMPLES:
                sig = np.pad(sig, (0, config.NUM_SAMPLES - len(sig)))
                
            # Convert to Tensor (Channel, Length) -> (1, 1000)
            sig_tensor = torch.tensor(sig, dtype=torch.float32).unsqueeze(0)
            label_tensor = torch.tensor(self.labels[idx], dtype=torch.float32)
            
            return sig_tensor, label_tensor
            
        except Exception as e:
            # Return zeros on failure
            print(f"Error loading {file_path}: {e}")
            return torch.zeros((1, config.NUM_SAMPLES)), torch.zeros(config.NUM_CLASSES)

