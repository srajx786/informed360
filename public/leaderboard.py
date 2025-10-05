import matplotlib.pyplot as plt
import matplotlib.image as mpimg
import numpy as np
import os

# === Data (Replace with real-time API output later) ===
outlets = ["The Hindu","NDTV","India Today","News18","Mint","HT","TOI","IE"]
logos = [
    "logos/thehindu.png",
    "logos/ndtv.png",
    "logos/indiatoday.png",
    "logos/news18.png",
    "logos/mint.png",
    "logos/hindustantimes.png",
    "logos/toi.png",
    "logos/indianexpress.png",
]
pos = np.array([46,38,34,22,41,29,33,28])
neu = np.array([39,45,48,60,42,53,51,55])
neg = np.array([15,17,18,18,17,18,16,17])
counts = np.array([32,28,24,20,18,22,26,19])

# === Visualization ===
fig, ax = plt.subplots(figsize=(10,6))
x = np.arange(len(outlets))
bar_width = 0.7

# Sentiment colors (same as site)
color_pos = "#2ecc71"  # green
color_neu = "#bdc3c7"  # gray
color_neg = "#e74c3c"  # red

# Bars
ax.bar(x, pos, width=bar_width, color=color_pos, label="Positive")
ax.bar(x, neu, width=bar_width, bottom=pos, color=color_neu, label="Neutral")
ax.bar(x, neg, width=bar_width, bottom=pos+neu, color=color_neg, label="Negative")

# Labels (article counts)
for i, c in enumerate(counts):
    ax.text(i, 103, f"{c} articles", ha='center', va='bottom', fontsize=8)

# Axes
ax.set_ylim(0, 110)
ax.set_xlim(-0.5, len(outlets)-0.5)
ax.set_ylabel("Share of sentiment (%)", fontsize=11, weight='bold')
ax.set_title("Sentiment Leaderboard • Stacked Sentiment per Outlet (+ article count)", fontsize=13, pad=15)
ax.legend(loc="upper right", ncol=3, frameon=False)

# === Replace outlet names with logos ===
ax.set_xticks(x)
ax.set_xticklabels([""]*len(outlets))  # clear labels

# Add logos under each bar
y_offset = -12  # vertical shift for logos
for i, logo_path in enumerate(logos):
    if os.path.exists(logo_path):
        img = mpimg.imread(logo_path)
        # Add logo image in axes coordinates
        imagebox = ax.inset_axes([i - 0.35, -20, 0.7, 0.7], transform=ax.transData)
        imagebox.imshow(img)
        imagebox.axis("off")

# Remove borders
for spine in ax.spines.values():
    spine.set_visible(False)

plt.tight_layout()
plt.savefig("leaderboard_with_logos.png", dpi=200, bbox_inches="tight")
plt.show()
