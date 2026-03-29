import torch
import os
import sys

# Add src to path to import ResNet1D
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))
from model import ResNet1D

def convert():
    checkpoint_path = os.path.join('checkpoints', 'best_model.pth')
    if not os.path.exists(checkpoint_path):
        print(f"Error: {checkpoint_path} not found")
        return

    print("Loading model...")
    model = ResNet1D(num_classes=5)
    model.load_state_dict(torch.load(checkpoint_path, map_location=torch.device('cpu')))
    model.eval()

    print("Exporting to ONNX...")
    dummy_input = torch.randn(1, 1, 1000)
    torch.onnx.export(
        model, 
        dummy_input, 
        "model.onnx",
        export_params=True,
        opset_version=12,
        do_constant_folding=True,
        input_names=['input'],
        output_names=['output'],
        dynamic_axes={'input': {0: 'batch_size'}, 'output': {0: 'batch_size'}}
    )
    print("Export complete: model.onnx")

if __name__ == "__main__":
    convert()
