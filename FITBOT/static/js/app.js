const PERSONA_META = {
  ramirez: {
    title: "Ramirez",
    subtitle: "Técnica, postura e evolução constante",
    greeting: "Oi! Sou a Ramirez, sua personal do FITBOT. Pode falar no microfone ou digitar seu objetivo de treino hoje!",
    idleLabel: "Pronta para treinar",
  },
  jonesy: {
    title: "Jonesy",
    subtitle: "Energia alta, força e foco total",
    greeting: "Fala! Aqui é o Jonesy, seu personal do FITBOT. Manda no áudio ou no chat o que vamos treinar hoje!",
    idleLabel: "Pronto para treinar",
  },
};

const state = {
  persona: "ramirez",
  history: [],
  isMuted: false,
  isBusy: false,
  isListening: false,
  audioCtx: null,
  analyser: null,
  gainNode: null,
  currentSource: null,
};

const els = {
  canvas: document.getElementById("avatarCanvas"),
  statePill: document.getElementById("statePill"),
  stateText: document.getElementById("stateText"),
  liveCaption: document.getElementById("liveCaption"),
  chatLog: document.getElementById("chatLog"),
  chatForm: document.getElementById("chatForm"),
  textInput: document.getElementById("textInput"),
  btnSend: document.getElementById("btnSend"),
  btnMic: document.getElementById("btnMic"),
  btnMute: document.getElementById("btnMute"),
  btnStopAudio: document.getElementById("btnStopAudio"),
  btnClear: document.getElementById("btnClear"),
  personaTitle: document.getElementById("personaTitle"),
  personaSubtitle: document.getElementById("personaSubtitle"),
  personaBtns: document.querySelectorAll(".persona-btn"),
};

const rig = new AvatarRig(els.canvas);

function ensureAudioPipeline() {
  if (!state.audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new AudioCtx();
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 512;
    state.analyser.smoothingTimeConstant = 0.65;
    state.gainNode = state.audioCtx.createGain();
    state.gainNode.gain.value = state.isMuted ? 0 : 1;

    // Analyser ANTES do GainNode: mesmo no mudo, o lip-sync continua exato
    state.analyser.connect(state.gainNode);
    state.gainNode.connect(state.audioCtx.destination);
    rig.setAnalyser(state.analyser);
  }
  if (state.audioCtx.state === "suspended") {
    state.audioCtx.resume();
  }
}

function setAvatarState(mode, customText = null) {
  rig.setState(mode);
  els.statePill.className = `state-pill ${mode}`;
  const labels = {
    idle: PERSONA_META[state.persona].idleLabel,
    listening: "Ouvindo você...",
    thinking: "Montando resposta...",
    speaking: "Falando...",
  };
  els.stateText.textContent = customText || labels[mode];
}

function stopCurrentSpeech() {
  if (state.currentSource) {
    try { state.currentSource.stop(); } catch (_) {}
    state.currentSource = null;
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  rig.setSimulatedSpeech(false);
  els.liveCaption.classList.remove("visible");
  if (!state.isListening && !state.isBusy) setAvatarState("idle");
}

async function playAudioBase64(b64, captionText) {
  stopCurrentSpeech();
  els.liveCaption.textContent = captionText;
  els.liveCaption.classList.add("visible");

  if (!b64) {
    // Fallback offline via Web Speech API
    speakBrowserFallback(captionText);
    return;
  }

  ensureAudioPipeline();
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const audioBuffer = await state.audioCtx.decodeAudioData(bytes.buffer.slice(0));
  const src = state.audioCtx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(state.analyser);

  state.currentSource = src;
  setAvatarState("speaking");

  src.onended = () => {
    if (state.currentSource === src) {
      state.currentSource = null;
      els.liveCaption.classList.remove("visible");
      if (!state.isListening) setAvatarState("idle");
    }
  };
  src.start(0);
}

function speakBrowserFallback(text) {
  if (!("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "pt-BR";
  utter.volume = state.isMuted ? 0 : 1;
  utter.pitch = state.persona === "jonesy" ? 0.85 : 1.15;
  utter.onstart = () => {
    rig.setSimulatedSpeech(true);
    setAvatarState("speaking");
  };
  utter.onend = () => {
    rig.setSimulatedSpeech(false);
    els.liveCaption.classList.remove("visible");
    setAvatarState("idle");
  };
  window.speechSynthesis.speak(utter);
}

function appendMessage(role, text, audioB64 = null) {
  const item = document.createElement("article");
  item.className = `msg ${role}`;

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const who = role === "user" ? "Você" : PERSONA_META[state.persona].title;
  const time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  meta.innerHTML = `<span>${who} • ${time}</span>`;

  if (role === "bot") {
    const replay = document.createElement("button");
    replay.type = "button";
    replay.className = "replay-btn";
    replay.textContent = "▶ Ouvir";
    replay.setAttribute("aria-label", "Reproduzir áudio desta resposta");
    replay.addEventListener("click", () => playAudioBase64(audioB64, text));
    meta.appendChild(replay);
  }

  const body = document.createElement("p");
  body.textContent = text;

  item.append(meta, body);
  els.chatLog.appendChild(item);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

async function sendMessage(rawText) {
  const text = rawText.trim();
  if (!text || state.isBusy) return;

  stopCurrentSpeech();
  state.isBusy = true;
  els.btnSend.disabled = true;
  els.textInput.value = "";

  appendMessage("user", text);
  setAvatarState("thinking");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        persona: state.persona,
        message: text,
        history: state.history,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro na API");

    state.history.push(
      { role: "user", content: text },
      { role: "assistant", content: data.reply }
    );

    appendMessage("bot", data.reply, data.audio_b64);
    await playAudioBase64(data.audio_b64, data.reply);
  } catch (err) {
    appendMessage("bot", `Não consegui responder agora: ${err.message}`);
    setAvatarState("idle");
  } finally {
    state.isBusy = false;
    els.btnSend.disabled = false;
    els.textInput.focus();
  }
}

// SPEECH-TO-TEXT (PT-BR)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "pt-BR";
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onstart = () => {
    stopCurrentSpeech();
    state.isListening = true;
    els.btnMic.classList.add("recording");
    els.btnMic.setAttribute("aria-pressed", "true");
    setAvatarState("listening");
  };

  recognition.onresult = (event) => {
    let transcript = "";
    let isFinal = false;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
      if (event.results[i].isFinal) isFinal = true;
    }
    els.textInput.value = transcript;
    if (isFinal && transcript.trim()) {
      sendMessage(transcript);
    }
  };

  recognition.onerror = (e) => {
    setAvatarState("idle", `Erro no microfone: ${e.error}`);
  };

  recognition.onend = () => {
    state.isListening = false;
    els.btnMic.classList.remove("recording");
    els.btnMic.setAttribute("aria-pressed", "false");
    if (!state.isBusy && !state.currentSource) setAvatarState("idle");
  };
} else {
  els.btnMic.disabled = true;
  els.btnMic.title = "Reconhecimento de voz não suportado neste navegador (use Chrome ou Edge)";
}

function toggleMic() {
  if (!recognition) return;
  if (state.isListening) recognition.stop();
  else recognition.start();
}

async function selectPersona(key) {
  stopCurrentSpeech();
  state.persona = key;
  state.history = [];

  els.personaBtns.forEach((btn) => {
    const active = btn.dataset.persona === key;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-checked", String(active));
  });

  const meta = PERSONA_META[key];
  els.personaTitle.textContent = meta.title;
  els.personaSubtitle.textContent = meta.subtitle;
  els.chatLog.innerHTML = "";

  await rig.loadPersona(key);
  setAvatarState("idle");
  appendMessage("bot", meta.greeting);
}

// EVENTOS
els.chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(els.textInput.value);
});

els.btnMic.addEventListener("click", toggleMic);
els.btnStopAudio.addEventListener("click", stopCurrentSpeech);

els.btnMute.addEventListener("click", () => {
  state.isMuted = !state.isMuted;
  els.btnMute.setAttribute("aria-pressed", String(state.isMuted));
  els.btnMute.textContent = state.isMuted ? "🔇 Mudo" : "🔊 Som";
  if (state.gainNode) state.gainNode.gain.value = state.isMuted ? 0 : 1;
});

els.btnClear.addEventListener("click", () => {
  stopCurrentSpeech();
  state.history = [];
  els.chatLog.innerHTML = "";
  appendMessage("bot", PERSONA_META[state.persona].greeting);
});

els.personaBtns.forEach((btn) => {
  btn.addEventListener("click", () => selectPersona(btn.dataset.persona));
});

// Atalho de teclado acessível: Alt + M ativa microfone
window.addEventListener("keydown", (e) => {
  if (e.altKey && e.key.toLowerCase() === "m") {
    e.preventDefault();
    toggleMic();
  }
});

// Inicialização
selectPersona("ramirez");