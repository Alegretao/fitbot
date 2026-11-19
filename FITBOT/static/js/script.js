const formulario = document.querySelector(".message-form");
const campoMensagem = formulario.querySelector("input[name='mensagem']");
const botaoEnviar = formulario.querySelector("button[type='submit']");
const botaoMicrofone = document.getElementById("btn-microfone");
const statusAvatar = document.getElementById("status-avatar");
const areaMensagens = document.querySelector(".messages");
const caixaAvatar = document.getElementById("caixa-avatar");
const canvas = document.getElementById("avatar-canvas");
const ctx = canvas ? canvas.getContext("2d") : null;

// PERSONAGEM E ESTADO DA ANIMAÇÃO
let avatarAtual = "masculino";
let estadoPersona = "parado"; // "parado" | "ouvindo" | "pensando" | "falando"

// IMAGENS CARREGADAS PARA O CANVAS
const imagensAvatares = {
    masculino: new Image(),
    feminino: new Image()
};
imagensAvatares.masculino.src = "/static/avatars/masculino.png";
imagensAvatares.feminino.src = "/static/avatars/feminino.png";

// ÁUDIO + ANALISADOR DE VOLUME PARA ANIMAÇÃO EM TEMPO REAL
let playerAudio = new Audio();
let audioCtx = null;
let analyser = null;
let audioSourceNode = null;
let dadosFrequencia = null;
let energiaVozAtual = 0;

function prepararAnalisadorAudio(audioElement) {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;

        if (!audioCtx) {
            audioCtx = new AudioContextClass();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            dadosFrequencia = new Uint8Array(analyser.frequencyBinCount);
            analyser.connect(audioCtx.destination);
        }

        if (audioCtx.state === "suspended") {
            audioCtx.resume();
        }

        if (!audioSourceNode) {
            audioSourceNode = audioCtx.createMediaElementSource(audioElement);
            audioSourceNode.connect(analyser);
        }
    } catch (e) {
        // Caso o navegador bloqueie WebAudio em algum contexto, a animação continua via tempo
        analyser = null;
    }
}

function obterEnergiaVoz() {
    if (estadoPersona !== "falando") {
        energiaVozAtual *= 0.8;
        return energiaVozAtual;
    }

    if (analyser && dadosFrequencia && !playerAudio.paused) {
        analyser.getByteFrequencyData(dadosFrequencia);
        let soma = 0;
        const limite = Math.min(32, dadosFrequencia.length);
        for (let i = 0; i < limite; i++) {
            soma += dadosFrequencia[i];
        }
        const media = soma / (limite * 255);
        energiaVozAtual = energiaVozAtual * 0.65 + media * 0.35;
        return Math.min(1, Math.max(0.15, energiaVozAtual * 2.2));
    }

    // Ritmo de fala natural caso o analisador não esteja ativo
    const t = performance.now() * 0.009;
    const ritmo = 0.45 + 0.35 * Math.sin(t * 2.7) * Math.cos(t * 1.3);
    energiaVozAtual = energiaVozAtual * 0.7 + Math.max(0.1, ritmo) * 0.3;
    return energiaVozAtual;
}

// LOOP DE ANIMAÇÃO DA PERSONA (60 FPS)
function desenharAvatar(tempoMs) {
    if (!ctx || !canvas) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const img = imagensAvatares[avatarAtual];
    if (!img || !img.complete || img.naturalWidth === 0) {
        requestAnimationFrame(desenharAvatar);
        return;
    }

    const t = tempoMs * 0.001;
    const energia = obterEnergiaVoz();

    // Calcula dimensões base mantendo proporção da imagem de corpo inteiro
    const margemTopo = 18;
    const margemBase = 16;
    const alturaDisponivel = h - margemTopo - margemBase;
    const escalaBase = Math.min((w * 0.86) / img.naturalWidth, alturaDisponivel / img.naturalHeight);

    const imgW = img.naturalWidth * escalaBase;
    const imgH = img.naturalHeight * escalaBase;
    const baseX = (w - imgW) / 2;
    const baseY = h - margemBase - imgH;

    // Parâmetros de animação por estado
    let respiracao = Math.sin(t * 2.2) * 3.5;
    let inclinacaoCorpo = Math.sin(t * 1.4) * 0.008;
    let balancoCabecaX = Math.cos(t * 1.7) * 2;
    let inclinacaoCabeca = Math.sin(t * 1.9) * 0.015;
    let escalaPulso = 1 + Math.sin(t * 2.2) * 0.006;

    if (estadoPersona === "ouvindo") {
        respiracao = Math.sin(t * 3.2) * 3;
        inclinacaoCabeca = 0.03 + Math.sin(t * 4) * 0.015;
        balancoCabecaX = 4;
        escalaPulso = 1.012;
    } else if (estadoPersona === "pensando") {
        respiracao = Math.sin(t * 1.8) * 2.5;
        inclinacaoCabeca = -0.045 + Math.sin(t * 2.5) * 0.02;
        balancoCabecaX = -5;
        escalaPulso = 1.008;
    } else if (estadoPersona === "falando") {
        respiracao = Math.sin(t * 8.5) * (3 + energia * 5);
        inclinacaoCorpo = Math.sin(t * 5.2) * (0.012 + energia * 0.018);
        balancoCabecaX = Math.sin(t * 6.4) * (3 + energia * 6);
        inclinacaoCabeca = Math.cos(t * 7.1) * (0.02 + energia * 0.045);
        escalaPulso = 1 + energia * 0.022;
    }

    // Sombra suave no chão sob os pés
    ctx.save();
    const sombraRaioX = imgW * 0.24 * (1 - Math.max(0, respiracao) * 0.015);
    ctx.fillStyle = "rgba(10, 6, 20, 0.55)";
    ctx.beginPath();
    ctx.ellipse(w / 2, h - margemBase + 2, sombraRaioX, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 1. Parte inferior / pernas (ancorada nos pés)
    const alturaPernas = imgH * 0.52;
    const yDivisao = baseY + imgH - alturaPernas;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, yDivisao, w, h - yDivisao + 10);
    ctx.clip();
    ctx.drawImage(img, baseX, baseY, imgW, imgH);
    ctx.restore();

    // 2. Tronco e braços (animados com respiração e gesto de conversa)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, yDivisao + 2);
    ctx.clip();

    const pivoTroncoX = w / 2;
    const pivoTroncoY = yDivisao;
    ctx.translate(pivoTroncoX, pivoTroncoY + respiracao * 0.45);
    ctx.rotate(inclinacaoCorpo);
    ctx.scale(escalaPulso, escalaPulso);
    ctx.translate(-pivoTroncoX, -pivoTroncoY);
    ctx.drawImage(img, baseX, baseY, imgW, imgH);
    ctx.restore();

    // 3. Região superior / cabeça (microexpressão reativa à fala)
    const alturaCabeca = imgH * 0.24;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, baseY + alturaCabeca);
    ctx.clip();

    const pivoCabecaX = w / 2;
    const pivoCabecaY = baseY + alturaCabeca * 0.85;
    ctx.translate(pivoCabecaX + balancoCabecaX, pivoCabecaY + respiracao * 0.75);
    ctx.rotate(inclinacaoCabeca);
    ctx.translate(-pivoCabecaX, -pivoCabecaY);
    ctx.drawImage(img, baseX, baseY, imgW, imgH);
    ctx.restore();

    // Aura sutil enquanto fala para reforçar a presença da persona
    if (estadoPersona === "falando") {
        ctx.save();
        const grad = ctx.createRadialGradient(
            w / 2,
            baseY + imgH * 0.22,
            10,
            w / 2,
            baseY + imgH * 0.22,
            130 + energia * 45
        );
        grad.addColorStop(0, `rgba(165, 106, 255, ${0.14 * energia})`);
        grad.addColorStop(1, "rgba(165, 106, 255, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
    }

    requestAnimationFrame(desenharAvatar);
}

requestAnimationFrame(desenharAvatar);

function definirEstadoPersona(novoEstado, textoStatus) {
    estadoPersona = novoEstado;

    if (caixaAvatar) {
        caixaAvatar.classList.remove("estado-ouvindo", "estado-pensando", "estado-falando");
        if (novoEstado === "ouvindo") caixaAvatar.classList.add("estado-ouvindo");
        if (novoEstado === "pensando") caixaAvatar.classList.add("estado-pensando");
        if (novoEstado === "falando") caixaAvatar.classList.add("estado-falando");
    }

    if (statusAvatar && textoStatus) {
        statusAvatar.textContent = textoStatus;
    }
}

// RECONHECIMENTO DE VOZ (SPEECH-TO-TEXT - MICROFONE DO USUÁRIO)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let reconhecimento = null;
let ouvindo = false;

if (SpeechRecognition) {
    reconhecimento = new SpeechRecognition();
    reconhecimento.lang = "pt-BR";
    reconhecimento.interimResults = false;
    reconhecimento.maxAlternatives = 1;

    reconhecimento.onstart = () => {
        ouvindo = true;
        botaoMicrofone.classList.add("ouvindo");
        botaoMicrofone.textContent = "⏹️";
        definirEstadoPersona("ouvindo", "🎙️ Ouvindo você...");
    };

    reconhecimento.onresult = (event) => {
        const transcricao = event.results[0][0].transcript.trim();
        if (transcricao) {
            campoMensagem.value = transcricao;
            enviarMensagemParaBot(transcricao);
        }
    };

    reconhecimento.onerror = (event) => {
        console.error("Erro no reconhecimento de voz:", event.error);
        if (event.error === "not-allowed") {
            adicionarMensagem(
                "bot",
                "Permita o acesso ao microfone no navegador para falar por voz, ou continue digitando normalmente."
            );
        }
    };

    reconhecimento.onend = () => {
        ouvindo = false;
        botaoMicrofone.classList.remove("ouvindo");
        botaoMicrofone.textContent = "🎤";
        if (estadoPersona === "ouvindo") {
            definirEstadoPersona("parado", "● Online para conversar");
        }
    };
} else if (botaoMicrofone) {
    botaoMicrofone.disabled = true;
    botaoMicrofone.title = "Reconhecimento de voz não suportado neste navegador";
}

if (botaoMicrofone && reconhecimento) {
    botaoMicrofone.addEventListener("click", () => {
        if (ouvindo) {
            reconhecimento.stop();
        } else {
            pararFalaAtual();
            reconhecimento.start();
        }
    });
}

function pararFalaAtual() {
    playerAudio.pause();
    playerAudio.currentTime = 0;
    if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
    }
    definirEstadoPersona("parado", "● Online para conversar");
}

// TOCA O ARQUIVO MP3 GERADO PELO BACKEND E ANIMA A FALA
function reproduzirVozPersona(audioUrl, textoFallback) {
    pararFalaAtual();

    if (audioUrl) {
        playerAudio.src = audioUrl;
        prepararAnalisadorAudio(playerAudio);

        playerAudio.onplay = () => {
            definirEstadoPersona("falando", "🔊 Falando...");
        };

        playerAudio.onended = () => {
            definirEstadoPersona("parado", "● Online para conversar");
        };

        playerAudio.onerror = () => {
            definirEstadoPersona("parado", "● Online para conversar");
            falarFallbackNavegador(textoFallback);
        };

        playerAudio.play().catch((err) => {
            console.warn("Autoplay bloqueado ou erro ao tocar MP3:", err);
            definirEstadoPersona("parado", "● Online para conversar");
        });
        return;
    }

    falarFallbackNavegador(textoFallback);
}

function falarFallbackNavegador(texto) {
    if (!("speechSynthesis" in window) || !texto) return;

    const fala = new SpeechSynthesisUtterance(texto);
    fala.lang = "pt-BR";
    fala.onstart = () => definirEstadoPersona("falando", "🔊 Falando...");
    fala.onend = () => definirEstadoPersona("parado", "● Online para conversar");
    fala.onerror = () => definirEstadoPersona("parado", "● Online para conversar");
    window.speechSynthesis.speak(fala);
}

// SELEÇÃO DOS PERSONAGENS
async function selecionarAvatar(tipo) {
    const nome = document.getElementById("nome-personagem");
    const masculino = document.getElementById("btn-masculino");
    const feminino = document.getElementById("btn-feminino");

    pararFalaAtual();
    if (reconhecimento && ouvindo) {
        reconhecimento.stop();
    }

    avatarAtual = tipo;

    if (tipo === "masculino") {
        nome.textContent = "Jonesy";
        masculino.classList.add("ativo");
        feminino.classList.remove("ativo");
    } else {
        nome.textContent = "Ramirez";
        feminino.classList.add("ativo");
        masculino.classList.remove("ativo");
    }

    areaMensagens.innerHTML = "";
    const msgCarregando = adicionarMensagem("bot", "Preparando voz de " + nome.textContent + "...");

    try {
        const res = await fetch("/saudacao", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ avatar: tipo })
        });
        const dados = await res.json();
        msgCarregando.textContent = dados.texto;
        reproduzirVozPersona(dados.audio_url, dados.texto);
    } catch (e) {
        const saudacaoPadrao = "Oi! Sou " + nome.textContent + ". Como posso ajudar você hoje?";
        msgCarregando.textContent = saudacaoPadrao;
    }
}

// ADICIONAR MENSAGEM NA TELA
function adicionarMensagem(tipo, texto) {
    const mensagem = document.createElement("div");

    if (tipo === "usuario") {
        mensagem.className = "user-message";
    } else {
        mensagem.className = "bot-message";
    }

    mensagem.textContent = texto;
    areaMensagens.appendChild(mensagem);
    areaMensagens.scrollTop = areaMensagens.scrollHeight;

    return mensagem;
}

// ENVIO UNIFICADO (DIGITAÇÃO OU MICROFONE)
async function enviarMensagemParaBot(mensagem) {
    const textoLimpo = (mensagem || "").trim();
    if (!textoLimpo) {
        return;
    }

    pararFalaAtual();
    adicionarMensagem("usuario", textoLimpo);
    campoMensagem.value = "";

    botaoEnviar.disabled = true;
    botaoEnviar.textContent = "Pensando...";
    if (botaoMicrofone) botaoMicrofone.disabled = true;
    definirEstadoPersona("pensando", "💭 Pensando na resposta...");

    const carregando = adicionarMensagem("bot", "Estou pensando...");

    try {
        const respostaServidor = await fetch("/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                mensagem: textoLimpo,
                avatar: avatarAtual
            })
        });

        const dados = await respostaServidor.json();

        carregando.remove();

        if (!respostaServidor.ok) {
            adicionarMensagem(
                "bot",
                dados.erro || "Ocorreu um erro."
            );
            definirEstadoPersona("parado", "● Online para conversar");
            return;
        }

        adicionarMensagem("bot", dados.resposta);
        reproduzirVozPersona(dados.audio_url, dados.resposta);

    } catch (erro) {
        carregando.remove();

        adicionarMensagem(
            "bot",
            "Não consegui conversar com o servidor. Verifique se o FitBot está funcionando."
        );
        definirEstadoPersona("parado", "● Online para conversar");
        console.error(erro);

    } finally {
        botaoEnviar.disabled = false;
        botaoEnviar.textContent = "Enviar";
        if (botaoMicrofone && SpeechRecognition) botaoMicrofone.disabled = false;
        campoMensagem.focus();
    }
}

formulario.addEventListener("submit", function(event) {
    event.preventDefault();
    enviarMensagemParaBot(campoMensagem.value);
});

document.addEventListener("DOMContentLoaded", function() {
    areaMensagens.scrollTop = areaMensagens.scrollHeight;
});