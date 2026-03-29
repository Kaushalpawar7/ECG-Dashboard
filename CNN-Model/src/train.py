import os
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, random_split
from sklearn.model_selection import train_test_split
from tqdm import tqdm

from . import config
from .dataset import PTBXLDataset, load_ptbxl_metadata
from .model import ResNet1D

def train():
    # 1. Setup Device
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Using device: {device}")

    # 2. Prepare Data
    print("Loading Metadata...")
    if not os.path.exists(os.path.join(config.PTBXL_PATH, 'ptbxl_database.csv')):
        print(f"ERROR: PTB-XL data not found at {config.PTBXL_PATH}")
        return

    df = load_ptbxl_metadata()
    
    # Split by patient (stratified if possible, but simple random patient split is okay for MVP)
    # We use 'strat_fold' column if available in PTB-XL which maps to 10 folds
    # Fold 1-8: Train, 9: Val, 10: Test
    train_df = df[df.strat_fold <= 8]
    val_df = df[df.strat_fold == 9]
    test_df = df[df.strat_fold == 10]
    
    print(f"Train: {len(train_df)}, Val: {len(val_df)}, Test: {len(test_df)}")

    train_dataset = PTBXLDataset(train_df, mode='train')
    val_dataset = PTBXLDataset(val_df, mode='val')

    train_loader = DataLoader(train_dataset, batch_size=config.BATCH_SIZE, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_dataset, batch_size=config.BATCH_SIZE, shuffle=False, num_workers=0)

    # 3. Initialize Model
    model = ResNet1D(num_classes=config.NUM_CLASSES).to(device)
    criterion = nn.BCEWithLogitsLoss() # Multilabel loss
    optimizer = optim.AdamW(model.parameters(), lr=config.LEARNING_RATE)

    # 4. Training Loop
    best_val_loss = float('inf')
    
    if not os.path.exists(config.CHECKPOINT_DIR):
        os.makedirs(config.CHECKPOINT_DIR)

    print("Starting Training...")
    for epoch in range(config.EPOCHS):
        model.train()
        train_loss = 0.0
        
        loop = tqdm(train_loader, desc=f"Epoch {epoch+1}/{config.EPOCHS}")
        for signals, labels in loop:
            signals, labels = signals.to(device), labels.to(device)
            
            optimizer.zero_grad()
            outputs = model(signals)
            loss = criterion(outputs, labels)
            
            loss.backward()
            optimizer.step()
            
            train_loss += loss.item()
            loop.set_postfix(loss=loss.item())
            
        avg_train_loss = train_loss / len(train_loader)
        
        # Validation
        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for signals, labels in val_loader:
                signals, labels = signals.to(device), labels.to(device)
                outputs = model(signals)
                loss = criterion(outputs, labels)
                val_loss += loss.item()
        
        avg_val_loss = val_loss / len(val_loader)
        print(f"Epoch {epoch+1}: Train Loss: {avg_train_loss:.4f}, Val Loss: {avg_val_loss:.4f}")
        
        # Save Best
        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            torch.save(model.state_dict(), os.path.join(config.CHECKPOINT_DIR, "best_model.pth"))
            print("Saved Best Model")

    print("Training Complete.")

if __name__ == "__main__":
    train()
