import torch
import torch.nn as nn
import torch.optim as optim
from src.model import ResNet1D
from src import config

def verify_model_architecture():
    print("Verifying Model Architecture...")
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = ResNet1D(num_classes=config.NUM_CLASSES).to(device)
    
    # Mock Input: (Batch, 1, 1000)
    batch_size = 4
    x = torch.randn(batch_size, 1, config.NUM_SAMPLES).to(device)
    y = torch.randint(0, 2, (batch_size, config.NUM_CLASSES)).float().to(device) # Multilabel target
    
    print(f"Input Shape: {x.shape}")
    
    # Forward Pass
    output = model(x)
    print(f"Output Shape: {output.shape}")
    
    assert output.shape == (batch_size, config.NUM_CLASSES), "Output shape mismatch"
    
    # Backward Pass (Check gradients)
    criterion = nn.BCEWithLogitsLoss()
    optimizer = optim.Adam(model.parameters(), lr=1e-3)
    
    optimizer.zero_grad()
    loss = criterion(output, y)
    loss.backward()
    optimizer.step()
    
    print("Forward and Backward pass successful!")
    print(f"Initial Loss: {loss.item()}")
    return True

if __name__ == "__main__":
    try:
        if verify_model_architecture():
            print("\nVERIFICATION PASSED: Codebase is ready for real data.")
    except Exception as e:
        print(f"\nVERIFICATION FAILED: {e}")
        import traceback
        traceback.print_exc()
