import torch
from src.dataset import load_ptbxl_metadata, PTBXLDataset
from src import config
import os

def verify_dataset():
    print(f"Checking data at: {config.PTBXL_PATH}")
    if not os.path.exists(os.path.join(config.PTBXL_PATH, 'ptbxl_database.csv')):
        print("ERROR: ptbxl_database.csv not found!")
        return

    print("Loading metadata...")
    df = load_ptbxl_metadata(config.PTBXL_PATH)
    print(f"Found {len(df)} records.")

    print("Initializing dataset...")
    # Use only first 10 for quick check
    dataset = PTBXLDataset(df.head(10), root_dir=config.PTBXL_PATH)
    
    print(f"Dataset length: {len(dataset)}")
    
    # Try loading the first record
    sig, label = dataset[0]
    
    print(f"Signal shape: {sig.shape}")
    print(f"Label shape: {label.shape}")
    print(f"Label values: {label}")
    
    assert sig.shape == (1, 1000), "Signal shape mismatch"
    assert label.shape == (config.NUM_CLASSES,), "Label shape mismatch"
    
    print("SUCCESS: Dataset loaded and correctly preprocessed!")

if __name__ == "__main__":
    try:
        verify_dataset()
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
