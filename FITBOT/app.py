from flask import Flask, render_template, request, jsonify, session, url_for
import requests
import asyncio
import edge_tts
import uuid
import glob
import os

app = Flask(__name__)

app.secret_key = os.environ.get(
    "FLASK_SECRET_KEY",
    "fitbot-chave-local"
)

MODELO = "qwen3.5:4b"

# Pasta onde os áudios .mp3 serão salvos
PASTA_AUDIOS = os.path.join(app.root_path, "static", "audios")
os.makedirs(PASTA_AUDIOS, exist_ok=True)


def limpar_audios_antigos(limite=15):
    """Mantém apenas os últimos arquivos .mp3 para não encher o disco."""
    arquivos = sorted(
        glob.glob(os.path.join(PASTA_AUDIOS, "*.mp3")),
        key=os.path.getmtime
    )
    for antigo in arquivos[:-limite]:
        try:
            os.remove(antigo)
        except OSError:
            pass


async def _salvar_mp3(texto, voz, caminho_arquivo):
    comunicador = edge_tts.Communicate(texto, voz, rate="+5%")
    await comunicador.save(caminho_arquivo)


def gerar_audio_persona(texto, avatar):
    """Gera o arquivo .mp3 com a voz da persona escolhida e retorna a URL."""
    voz = "pt-BR-ThalitaNeural" if avatar == "feminino" else "pt-BR-AntonioNeural"
    nome_arquivo = f"{avatar}_{uuid.uuid4().hex[:10]}.mp3"
    caminho_completo = os.path.join(PASTA_AUDIOS, nome_arquivo)

    asyncio.run(_salvar_mp3(texto, voz, caminho_completo))
    limpar_audios_antigos()

    return url_for("static", filename=f"audios/{nome_arquivo}")


@app.route("/", methods=["GET", "POST"])
def inicio():
    resposta = ""
    mensagem = ""

    if request.method == "POST":
        mensagem = request.form["mensagem"]

        try:
            resultado = requests.post(
                "http://localhost:11434/api/chat",
                json={
                    "model": MODELO,
                    "messages": [
                        {
                            "role": "system",
                            "content": "Você é a FitBot, uma personal trainer virtual simpática. Responda sempre em português brasileiro e não use emojis."
                        },
                        {
                            "role": "user",
                            "content": mensagem
                        }
                    ],
                    "stream": False
                },
                timeout=120
            )
            resultado.raise_for_status()
            resposta = resultado.json()["message"]["content"]

        except requests.RequestException:
            resposta = "Não consegui conectar ao Ollama. Verifique se ele está funcionando."

    return render_template(
        "index.html",
        resposta=resposta,
        mensagem=mensagem
    )


@app.route("/saudacao", methods=["POST"])
def saudacao_persona():
    """Gera o áudio da saudação inicial quando troca de persona."""
    dados = request.get_json(silent=True) or {}
    avatar = dados.get("avatar", "masculino")
    nome = "Ramirez" if avatar == "feminino" else "Jonesy"
    texto = f"Oi! Eu sou {nome}, sua personal trainer virtual. Como posso ajudar no seu treino hoje?"

    try:
        audio_url = gerar_audio_persona(texto, avatar)
        return jsonify({"texto": texto, "audio_url": audio_url})
    except Exception as e:
        return jsonify({"texto": texto, "audio_url": None, "erro": str(e)})


@app.route("/chat", methods=["POST"])
def conversar():
    dados = request.get_json(silent=True) or {}

    mensagem = dados.get("mensagem", "").strip()
    avatar = dados.get("avatar", "masculino")

    if not mensagem:
        return jsonify({"erro": "Digite uma mensagem."}), 400

    nome = "Ramirez" if avatar == "feminino" else "Jonesy"

    # Reinicia o histórico quando troca de personagem
    if session.get("avatar_atual") != avatar:
        session["historico"] = []
        session["avatar_atual"] = avatar

    historico = session.get("historico", [])

    personalidade = f"""
    Você é {nome}, uma personal trainer virtual do FitBot.

    Sua personalidade é simpática, natural, energética, divertida e acolhedora.
    Converse como uma pessoa de verdade de academia, motivando o aluno.
    Responda sempre em português brasileiro.
    Ajude com exercícios, treinos, alimentação e motivação.
    Não invente informações médicas ou sobre saúde.
    Responda de forma clara e direta em 2 a 4 frases curtas, sem listas longas, sem asteriscos de markdown e sem emojis, pois sua resposta será falada em voz alta.
    """

    mensagens = [{"role": "system", "content": personalidade}]
    mensagens.extend(historico)
    mensagens.append({"role": "user", "content": mensagem})

    try:
        resultado = requests.post(
            "http://127.0.0.1:11434/api/chat",
            json={
                "model": MODELO,
                "messages": mensagens,
                "stream": False
            },
            timeout=120
        )

        resultado.raise_for_status()
        resposta = resultado.json()["message"]["content"].strip()

        # Remove asteriscos comuns de markdown para a voz não ler estranho
        resposta_limpa = resposta.replace("**", "").replace("*", "")

        # Gera o arquivo .mp3 com a voz da persona
        audio_url = None
        try:
            audio_url = gerar_audio_persona(resposta_limpa, avatar)
        except Exception as erro_audio:
            print("Aviso ao gerar MP3:", erro_audio)

        historico.append({"role": "user", "content": mensagem})
        historico.append({"role": "assistant", "content": resposta_limpa})
        session["historico"] = historico[-12:]

        return jsonify({
            "resposta": resposta_limpa,
            "personagem": nome,
            "audio_url": audio_url
        })

    except requests.RequestException:
        return jsonify({
            "erro": "Não consegui conectar ao Ollama. Verifique se ele está funcionando."
        }), 500


if __name__ == "__main__":
    app.run(debug=True)