import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from src.dataset import load_ptbxl_metadata, PTBXLDataset
from src.model import ResNet1D
from src import config
from sklearn.metrics import classification_report, multilabel_confusion_matrix
import numpy as np

def evaluate():
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Evaluating on {device}")

    # 1. Load Data
    df = load_ptbxl_metadata()
    test_df = df[df.strat_fold == 10]
    test_dataset = PTBXLDataset(test_df, mode='test')
    test_loader = DataLoader(test_dataset, batch_size=config.BATCH_SIZE, shuffle=False)

    # 2. Load Model
    model = ResNet1D(num_classes=config.NUM_CLASSES).to(device)
    model_path = "checkpoints/best_model.pth"
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.eval()

    # 3. Predict
    all_labels = []
    all_preds = []

    print("Running predictions...")
    with torch.no_grad():
        for signals, labels in test_loader:
            signals = signals.to(device)
            outputs = model(signals)
            preds = torch.sigmoid(outputs) > 0.5
            
            all_labels.append(labels.cpu().numpy())
            all_preds.append(preds.cpu().numpy())

    all_labels = np.vstack(all_labels)
    all_preds = np.vstack(all_preds)

    # 4. Metrics
    print("\n--- Classification Report ---")
    print(classification_report(all_labels, all_preds, target_names=config.CLASSES))

if __name__ == "__main__":
    evaluate()
