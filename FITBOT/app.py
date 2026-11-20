import asyncio
import base64
import re
from flask import Flask, jsonify, render_template, request
import requests
import edge_tts

app = Flask(__name__)

OLLAMA_URL = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "qwen3.5:4b"

PERSONAS = {
    "jonesy": {
        "name": "Jonesy",
        "voice": "pt-BR-AntonioNeural",
        "rate": "+6%",
        "pitch": "-2Hz",
        "system": (
            "Você é Jonesy, personal trainer masculino do FITBOT. "
            "Personalidade: energético, direto, motivador, parceiro de treino. "
            "Responda sempre em português do Brasil, de forma falada e natural, "
            "em no máximo 3 a 4 frases curtas. Evite listas longas e símbolos."
        ),
    },
    "ramirez": {
        "name": "Ramirez",
        "voice": "pt-BR-FranciscaNeural",
        "rate": "+4%",
        "pitch": "+2Hz",
        "system": (
            "Você é Ramirez, personal trainer feminina do FITBOT. "
            "Personalidade: técnica, acolhedora, confiante e focada em execução segura. "
            "Responda sempre em português do Brasil, de forma falada e natural, "
            "em no máximo 3 a 4 frases curtas. Evite listas longas e símbolos."
        ),
    },
}


def clean_for_tts(text: str) -> str:
    text = re.sub(r"[*_`#>~\[\]()]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


async def synthesize_edge_tts(text: str, voice: str, rate: str, pitch: str) -> bytes:
    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate, pitch=pitch)
    audio_bytes = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_bytes.extend(chunk["data"])
    return bytes(audio_bytes)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.get_json(force=True)
    persona_key = data.get("persona", "ramirez")
    user_message = (data.get("message") or "").strip()
    history = data.get("history", [])[-8:]

    if not user_message:
        return jsonify({"error": "Mensagem vazia."}), 400

    persona = PERSONAS.get(persona_key, PERSONAS["ramirez"])
    messages = [{"role": "system", "content": persona["system"]}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    try:
        resp = requests.post(
            OLLAMA_URL,
            json={
                "model": OLLAMA_MODEL,
                "messages": messages,
                "stream": False,
                "think": False,
                "options": {"temperature": 0.7, "num_predict": 220},
            },
            timeout=60,
        )
        resp.raise_for_status()
        raw_reply = resp.json()["message"]["content"]
        reply = re.sub(r"<think>.*?</think>", "", raw_reply, flags=re.S).strip()
    except Exception as exc:
        return jsonify({"error": f"Falha ao conectar no Ollama: {exc}"}), 502

    audio_b64 = None
    try:
        mp3 = asyncio.run(
            synthesize_edge_tts(
                clean_for_tts(reply),
                persona["voice"],
                persona["rate"],
                persona["pitch"],
            )
        )
        audio_b64 = base64.b64encode(mp3).decode("ascii")
    except Exception:
        # Frontend ativa fallback Web Speech API se Edge TTS estiver indisponível
        audio_b64 = None

    return jsonify(
        {
            "reply": reply,
            "audio_b64": audio_b64,
            "mime": "audio/mpeg",
            "persona": persona_key,
        }
    )


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)