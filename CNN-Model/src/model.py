import torch
import torch.nn as nn
import torch.nn.functional as F

class ResNetBlock(nn.Module):
    def __init__(self, in_channels, out_channels, stride=1):
        super(ResNetBlock, self).__init__()
        self.conv1 = nn.Conv1d(
            in_channels, out_channels, kernel_size=5, stride=stride, padding=2, bias=False
        )
        self.bn1 = nn.BatchNorm1d(out_channels)
        self.conv2 = nn.Conv1d(
            out_channels, out_channels, kernel_size=5, stride=1, padding=2, bias=False
        )
        self.bn2 = nn.BatchNorm1d(out_channels)

        self.shortcut = nn.Sequential()
        if stride != 1 or in_channels != out_channels:
            self.shortcut = nn.Sequential(
                nn.Conv1d(
                    in_channels, out_channels, kernel_size=1, stride=stride, bias=False
                ),
                nn.BatchNorm1d(out_channels),
            )

    def forward(self, x):
        out = F.relu(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        out += self.shortcut(x)
        out = F.relu(out)
        return out

class ResNet1D(nn.Module):
    def __init__(self, num_classes=5):
        super(ResNet1D, self).__init__()
        # Input: (Batch, 1, 1000)
        self.initial_conv = nn.Sequential(
            nn.Conv1d(1, 32, kernel_size=5, stride=2, padding=2, bias=False),  # 1000 -> 500
            nn.BatchNorm1d(32),
            nn.ReLU(),
            nn.MaxPool1d(kernel_size=3, stride=2, padding=1)  # 500 -> 250
        )

        self.layer1 = self._make_layer(32, 64, stride=2)   # 250 -> 125
        self.layer2 = self._make_layer(64, 128, stride=2)  # 125 -> 63
        self.layer3 = self._make_layer(128, 256, stride=2) # 63 -> 32
        self.layer4 = self._make_layer(256, 512, stride=2) # 32 -> 16

        self.global_avg_pool = nn.AdaptiveAvgPool1d(1)
        self.fc = nn.Linear(512, num_classes)

    def _make_layer(self, in_channels, out_channels, stride):
        layers = []
        layers.append(ResNetBlock(in_channels, out_channels, stride))
        layers.append(ResNetBlock(out_channels, out_channels, stride=1))
        return nn.Sequential(*layers)

    def forward(self, x):
        # x: (Batch, 1, Length)
        out = self.initial_conv(x)
        out = self.layer1(out)
        out = self.layer2(out)
        out = self.layer3(out)
        out = self.layer4(out)
        
        out = self.global_avg_pool(out)
        out = out.view(out.size(0), -1)  # Flatten
        out = self.fc(out)
        return out  # Logits (use BCEWithLogitsLoss externally)

if __name__ == "__main__":
    # Sanity check
    model = ResNet1D(num_classes=5)
    x = torch.randn(2, 1, 1000)
    y = model(x)
    print(f"Input shape: {x.shape}")
    print(f"Output shape: {y.shape}")
    assert y.shape == (2, 5)
