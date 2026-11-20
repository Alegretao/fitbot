# pip install rembg onnxruntime pillow
from pathlib import Path
from rembg import remove

for name in ("masculino.png", "feminino.png"):
    p = Path("static/avatars") / name
    if p.exists():
        p.write_bytes(remove(p.read_bytes()))
        print(f"Fundo removido: {p}")