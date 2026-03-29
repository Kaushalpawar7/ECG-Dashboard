import torch
import os
import sys
import numpy as np

# Add src to path to import ResNet1D
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))
from model import ResNet1D

def export_weights_json():
    checkpoint_path = os.path.join('checkpoints', 'best_model.pth')
    if not os.path.exists(checkpoint_path):
        print(f"Error: {checkpoint_path} not found")
        return

    print("Loading model...")
    model = ResNet1D(num_classes=5)
    model.load_state_dict(torch.load(checkpoint_path, map_location=torch.device('cpu')))
    model.eval()

    weights = {}
    for name, param in model.named_parameters():
        weights[name] = param.detach().cpu().numpy().tolist()

    import json
    with open('model_weights.json', 'w') as f:
        json.dump(weights, f)
    
    print("Exported weights to model_weights.json")

if __name__ == "__main__":
    export_weights_json()
