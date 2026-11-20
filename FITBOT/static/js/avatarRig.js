const AVATAR_CONFIGS = {
  ramirez: {
    src: "/static/avatars/feminino.png",
    skin: "#d8a388",
    skinShadow: "#ad745c",
    lip: "#b86462",
    eyeRadius: 0.014,
    mouthWidth: 0.024,
    // Coordenadas normalizadas (0..1) calibradas para feminino.png
    rig: {
      pelvis:    [0.49, 0.45],
      neck:      [0.52, 0.20],
      headTop:   [0.50, 0.09],
      leftEye:   [0.468, 0.133],
      rightEye:  [0.517, 0.129],
      mouth:     [0.499, 0.166],
      rShoulder: [0.415, 0.240],
      rElbow:    [0.375, 0.350],
      rHand:     [0.270, 0.318],
      lShoulder: [0.635, 0.235],
      lElbow:    [0.715, 0.355],
      lHand:     [0.590, 0.430],
    },
  },
  jonesy: {
    src: "/static/avatars/masculino.png",
    skin: "#d49a78",
    skinShadow: "#a66c50",
    lip: "#b46c5e",
    eyeRadius: 0.013,
    mouthWidth: 0.025,
    // Coordenadas normalizadas (0..1) calibradas para masculino.png
    rig: {
      pelvis:    [0.51, 0.46],
      neck:      [0.52, 0.185],
      headTop:   [0.525, 0.075],
      leftEye:   [0.503, 0.111],
      rightEye:  [0.556, 0.114],
      mouth:     [0.531, 0.149],
      rShoulder: [0.385, 0.225],
      rElbow:    [0.340, 0.350],
      rHand:     [0.275, 0.385],
      lShoulder: [0.655, 0.225],
      lElbow:    [0.725, 0.340],
      lHand:     [0.660, 0.435],
    },
  },
};

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1e-6;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function rotPt(x, y, px, py, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const dx = x - px, dy = y - py;
  return [px + dx * c - dy * s, py + dx * s + dy * c];
}

class AvatarRig {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cols = 18;
    this.rows = 24;
    this.state = "idle"; // idle | listening | thinking | speaking
    this.config = null;
    this.img = null;
    this.weights = [];
    this.analyser = null;
    this.freqData = null;

    // Suavização de parâmetros
    this.speechOpen = 0;
    this.speechWide = 1;
    this.gestureEnergy = 0;
    this.blink = 0;
    this.nextBlinkAt = performance.now() + 2600;
    this.simSpeaking = false;

    this.resize();
    window.addEventListener("resize", () => this.resize());
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.vw = rect.width;
    this.vh = rect.height;
  }

  setAnalyser(analyser) {
    this.analyser = analyser;
    this.freqData = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
  }

  setState(newState) {
    this.state = newState;
  }

  setSimulatedSpeech(active) {
    this.simSpeaking = active;
  }

  async loadPersona(key) {
    const cfg = AVATAR_CONFIGS[key] || AVATAR_CONFIGS.ramirez;
    this.config = cfg;
    const img = new Image();
    img.src = cfg.src;
    await img.decode();
    this.img = img;
    this._buildMeshWeights(cfg.rig);
  }

  _buildMeshWeights(r) {
    // Ossos: 0=legs, 1=torso, 2=head, 3=rUpper, 4=rForearm, 5=lArm
    this.weights = [];
    for (let j = 0; j <= this.rows; j++) {
      const v = j / this.rows;
      for (let i = 0; i <= this.cols; i++) {
        const u = i / this.cols;
        const w = [0, 0, 0, 0, 0, 0];

        // Pernas ancoradas no chão
        w[0] = v > r.pelvis[1] - 0.02
          ? Math.min(1.5, Math.max(0.05, (v - (r.pelvis[1] - 0.04)) * 9))
          : 0.01;

        // Tronco
        const dTorso = distToSegment(u, v, r.pelvis[0], r.pelvis[1], r.neck[0], r.neck[1]);
        w[1] = v <= r.pelvis[1] + 0.06 ? Math.exp(-(dTorso * dTorso) / 0.018) : 0.02;

        // Cabeça
        if (v < r.neck[1] + 0.03) {
          const dHead = distToSegment(u, v, r.neck[0], r.neck[1], r.headTop[0], r.headTop[1]);
          w[2] = Math.exp(-(dHead * dHead) / 0.008) * 2.2;
        }

        // Braço direito (lado esquerdo da tela — braço que gesticula)
        if (u < r.rShoulder[0] + 0.045 && v < r.pelvis[1] + 0.04) {
          const dRU = distToSegment(u, v, r.rShoulder[0], r.rShoulder[1], r.rElbow[0], r.rElbow[1]);
          const dRF = distToSegment(u, v, r.rElbow[0], r.rElbow[1], r.rHand[0], r.rHand[1]);
          w[3] = Math.exp(-(dRU * dRU) / 0.0045) * 1.9;
          w[4] = Math.exp(-(dRF * dRF) / 0.0050) * 2.6;
        }

        // Braço esquerdo (mão na cintura)
        if (u > r.lShoulder[0] - 0.04 && v < r.pelvis[1] + 0.05) {
          const dLA = distToSegment(u, v, r.lShoulder[0], r.lShoulder[1], r.lElbow[0], r.lElbow[1]);
          const dLH = distToSegment(u, v, r.lElbow[0], r.lElbow[1], r.lHand[0], r.lHand[1]);
          w[5] = (Math.exp(-(dLA * dLA) / 0.0045) + Math.exp(-(dLH * dLH) / 0.0045)) * 1.5;
        }

        const sum = w.reduce((a, b) => a + b, 0) || 1;
        for (let k = 0; k < w.length; k++) w[k] /= sum;
        this.weights.push(w);
      }
    }
  }

  _sampleAudio(t) {
    let targetOpen = 0;
    let targetWide = 1;
    let targetEnergy = 0;

    if (this.state === "speaking" && this.analyser && this.freqData) {
      this.analyser.getByteFrequencyData(this.freqData);
      let low = 0, mid = 0, high = 0;
      for (let i = 2; i < 12; i++) low += this.freqData[i];
      for (let i = 12; i < 32; i++) mid += this.freqData[i];
      for (let i = 32; i < 72; i++) high += this.freqData[i];
      low /= 10 * 255;
      mid /= 20 * 255;
      high /= 40 * 255;

      const rms = low * 0.55 + mid * 0.35 + high * 0.1;
      targetOpen = Math.min(1, Math.max(0, (rms - 0.04) * 3.1));
      targetWide = 0.78 + Math.min(0.45, (high + mid) * 1.15);
      targetEnergy = Math.min(1, rms * 2.4);
    } else if (this.state === "speaking" && this.simSpeaking) {
      const env = Math.max(0, Math.sin(t * 14) * 0.5 + Math.sin(t * 23) * 0.35 + 0.3);
      targetOpen = Math.min(0.95, env);
      targetWide = 0.85 + Math.sin(t * 7) * 0.2;
      targetEnergy = 0.55;
    }

    this.speechOpen += (targetOpen - this.speechOpen) * 0.38;
    this.speechWide += (targetWide - this.speechWide) * 0.25;
    this.gestureEnergy += (targetEnergy - this.gestureEnergy) * 0.14;
  }

  _updateBlink(now) {
    if (now >= this.nextBlinkAt) {
      const elapsed = now - this.nextBlinkAt;
      const dur = 150;
      if (elapsed < dur) {
        this.blink = Math.sin((elapsed / dur) * Math.PI);
      } else {
        this.blink = 0;
        this.nextBlinkAt = now + 2400 + Math.random() * 3400;
      }
    }
  }

  _getPose(t) {
    const breath = 1 + Math.sin(t * 2.1) * 0.011;
    let torsoRot = Math.sin(t * 1.05) * 0.016;
    let headRot = Math.sin(t * 1.4) * 0.028;
    let headNodY = Math.sin(t * 2.1) * 1.6;
    let rShoulderRot = Math.sin(t * 1.7) * 0.045;
    let rElbowRot = Math.sin(t * 2.0 + 0.6) * 0.065;
    let lArmRot = -Math.sin(t * 1.7) * 0.025;

    if (this.state === "listening") {
      torsoRot += 0.025;
      headRot = -0.055 + Math.sin(t * 2.4) * 0.02;
      headNodY = Math.sin(t * 3.8) * 3.0;
      rShoulderRot = 0.07 + Math.sin(t * 2.2) * 0.03;
      rElbowRot = 0.10 + Math.sin(t * 2.6) * 0.04;
    } else if (this.state === "thinking") {
      torsoRot = -0.02 + Math.sin(t * 0.9) * 0.012;
      headRot = 0.075 + Math.sin(t * 1.3) * 0.02;
      headNodY = -2.0;
      rShoulderRot = -0.09 + Math.sin(t * 1.6) * 0.04;
      rElbowRot = 0.22 + Math.sin(t * 2.1) * 0.05;
    } else if (this.state === "speaking") {
      const e = this.gestureEnergy;
      torsoRot = Math.sin(t * 2.4) * (0.02 + e * 0.03);
      headRot = Math.sin(t * 3.1) * (0.03 + e * 0.055);
      headNodY = Math.sin(t * 6.5) * (1.5 + e * 4.5);
      // Gesto ativo do braço/mão direita sincronizado com a cadência da fala
      rShoulderRot = Math.sin(t * 3.2) * (0.08 + e * 0.16) - e * 0.06;
      rElbowRot = Math.sin(t * 4.4 + 0.5) * (0.12 + e * 0.26) + e * 0.08;
      lArmRot = Math.sin(t * 2.6) * (0.03 + e * 0.06);
    }

    return { breath, torsoRot, headRot, headNodY, rShoulderRot, rElbowRot, lArmRot };
  }

  _drawTexturedTri(sx0, sy0, sx1, sy1, sx2, sy2, dx0, dy0, dx1, dy1, dx2, dy2) {
    const ctx = this.ctx;
    const du1 = sx1 - sx0, dv1 = sy1 - sy0;
    const du2 = sx2 - sx0, dv2 = sy2 - sy0;
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-5) return;

    const ex1 = dx1 - dx0, ey1 = dy1 - dy0;
    const ex2 = dx2 - dx0, ey2 = dy2 - dy0;
    const a = (ex1 * dv2 - ex2 * dv1) / det;
    const c = (ex2 * du1 - ex1 * du2) / det;
    const b = (ey1 * dv2 - ey2 * dv1) / det;
    const d = (ey2 * du1 - ey1 * du2) / det;
    const e = dx0 - a * sx0 - c * sy0;
    const f = dy0 - b * sx0 - d * sy0;

    // Expande o clip em 0.7px para eliminar frestas subpixel entre triângulos
    const cx = (dx0 + dx1 + dx2) / 3;
    const cy = (dy0 + dy1 + dy2) / 3;
    const pad = (x, y) => {
      const vx = x - cx, vy = y - cy;
      const l = Math.hypot(vx, vy) || 1;
      return [x + (vx / l) * 0.7, y + (vy / l) * 0.7];
    };
    const [p0x, p0y] = pad(dx0, dy0);
    const [p1x, p1y] = pad(dx1, dy1);
    const [p2x, p2y] = pad(dx2, dy2);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p0x, p0y);
    ctx.lineTo(p1x, p1y);
    ctx.lineTo(p2x, p2y);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(this.img, 0, 0);
    ctx.restore();
  }

  _drawFaceOverlay(transformHead, drawW, drawH, pose) {
    const ctx = this.ctx;
    const cfg = this.config;
    const r = cfg.rig;
    const headAngle = pose.torsoRot + pose.headRot;

    // 1. PISCADA NATURAL NOS OLHOS
    if (this.blink > 0.05) {
      const eyeR = cfg.eyeRadius * drawW;
      for (const key of ["leftEye", "rightEye"]) {
        const [ex, ey] = transformHead(r[key][0], r[key][1]);
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(headAngle);
        ctx.fillStyle = cfg.skin;
        ctx.beginPath();
        ctx.ellipse(0, -eyeR * 0.15, eyeR * 1.25, eyeR * 0.95 * this.blink, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#2b1b18";
        ctx.lineWidth = Math.max(1.5, drawW * 0.004);
        ctx.beginPath();
        ctx.moveTo(-eyeR * 1.1, eyeR * 0.15 * this.blink);
        ctx.quadraticCurveTo(0, eyeR * 0.55 * this.blink, eyeR * 1.1, eyeR * 0.15 * this.blink);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 2. BOCA ANIMADA (VISEMAS SINCRONIZADOS AO ÁUDIO)
    if (this.speechOpen > 0.06) {
      const [mx, my] = transformHead(r.mouth[0], r.mouth[1]);
      const mw = cfg.mouthWidth * drawW * this.speechWide;
      const mh = Math.max(2, cfg.mouthWidth * drawW * 0.95 * this.speechOpen);
      const alpha = Math.min(1, (this.speechOpen - 0.05) * 4.5);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(mx, my + mh * 0.18);
      ctx.rotate(headAngle);

      // Máscara suave do tom de pele para cobrir o sorriso estático ao abrir a boca
      ctx.fillStyle = cfg.skin;
      ctx.beginPath();
      ctx.ellipse(0, 0, mw * 1.12, mh * 0.95 + 3, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cavidade bucal
      ctx.fillStyle = "#3a1319";
      ctx.beginPath();
      ctx.ellipse(0, 0, mw * 0.82, mh * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();

      // Dentes superiores
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, mw * 0.80, mh * 0.70, 0, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = "#f7f3f0";
      ctx.fillRect(-mw * 0.75, -mh * 0.72, mw * 1.5, Math.min(mh * 0.42, drawW * 0.011));

      // Língua
      ctx.fillStyle = "#c45b68";
      ctx.beginPath();
      ctx.ellipse(0, mh * 0.52, mw * 0.55, mh * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Contorno labial
      ctx.strokeStyle = cfg.lip;
      ctx.lineWidth = Math.max(1.5, drawW * 0.0045);
      ctx.beginPath();
      ctx.ellipse(0, 0, mw * 0.84, mh * 0.74, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }
  }

  _loop(now) {
    requestAnimationFrame(this._loop);
    if (!this.img || !this.config) return;

    const t = now * 0.001;
    this._sampleAudio(t);
    this._updateBlink(now);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.vw, this.vh);

    // Ajusta avatar inteiro no palco mantendo proporção
    const imgAspect = this.img.naturalWidth / this.img.naturalHeight;
    const padY = 16;
    let drawH = this.vh - padY * 2;
    let drawW = drawH * imgAspect;
    if (drawW > this.vw - 24) {
      drawW = this.vw - 24;
      drawH = drawW / imgAspect;
    }
    const drawX = (this.vw - drawW) / 2;
    const drawY = this.vh - drawH - padY;

    // Aura de estado atrás do personagem
    const glowColors = {
      idle: "rgba(139, 92, 246, 0.18)",
      listening: "rgba(34, 197, 94, 0.28)",
      thinking: "rgba(245, 158, 11, 0.25)",
      speaking: `rgba(168, 85, 247, ${0.22 + this.gestureEnergy * 0.28})`,
    };
    const grad = ctx.createRadialGradient(
      this.vw / 2, drawY + drawH * 0.38, drawW * 0.05,
      this.vw / 2, drawY + drawH * 0.42, drawW * 0.65
    );
    grad.addColorStop(0, glowColors[this.state] || glowColors.idle);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.vw, this.vh);

    const r = this.config.rig;
    const toPx = (u, v) => [drawX + u * drawW, drawY + v * drawH];
    const pose = this._getPose(t);

    const [pelX, pelY] = toPx(...r.pelvis);
    const [neckX, neckY] = toPx(...r.neck);
    const [rShX, rShY] = toPx(...r.rShoulder);
    const [rElX, rElY] = toPx(...r.rElbow);
    const [lShX, lShY] = toPx(...r.lShoulder);

    // Transformações hierárquicas em espaço de pixel
    const tTorso = (x, y) => {
      const sy = pelY + (y - pelY) * pose.breath;
      return rotPt(x, sy, pelX, pelY, pose.torsoRot);
    };
    const [tNeckX, tNeckY] = tTorso(neckX, neckY);
    const tHead = (x, y) => {
      const [tx, ty] = tTorso(x, y);
      const [rx, ry] = rotPt(tx, ty, tNeckX, tNeckY, pose.headRot);
      return [rx, ry + pose.headNodY];
    };
    const [tRShX, tRShY] = tTorso(rShX, rShY);
    const tRUpper = (x, y) => {
      const [tx, ty] = tTorso(x, y);
      return rotPt(tx, ty, tRShX, tRShY, pose.rShoulderRot);
    };
    const [tRElX, tRElY] = tRUpper(rElX, rElY);
    const tRFore = (x, y) => {
      const [tx, ty] = tRUpper(x, y);
      return rotPt(tx, ty, tRElX, tRElY, pose.rElbowRot);
    };
    const [tLShX, tLShY] = tTorso(lShX, lShY);
    const tLArm = (x, y) => {
      const [tx, ty] = tTorso(x, y);
      return rotPt(tx, ty, tLShX, tLShY, pose.lArmRot);
    };

    // Calcula vértices deformados da malha
    const cols = this.cols, rows = this.rows;
    const pts = new Array((cols + 1) * (rows + 1));
    const [mouthU, mouthV] = r.mouth;

    let idx = 0;
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      for (let i = 0; i <= cols; i++) {
        const u = i / cols;
        const [px, py] = toPx(u, v);
        const w = this.weights[idx];

        const p0 = [px, py];
        const p1 = tTorso(px, py);
        const p2 = tHead(px, py);
        const p3 = tRUpper(px, py);
        const p4 = tRFore(px, py);
        const p5 = tLArm(px, py);

        let dx = p0[0]*w[0] + p1[0]*w[1] + p2[0]*w[2] + p3[0]*w[3] + p4[0]*w[4] + p5[0]*w[5];
        let dy = p0[1]*w[0] + p1[1]*w[1] + p2[1]*w[2] + p3[1]*w[3] + p4[1]*w[4] + p5[1]*w[5];

        // Micro-deformação real da mandíbula/queixo acompanhando a abertura da boca
        if (this.speechOpen > 0.05 && v > mouthV - 0.005 && v < mouthV + 0.055) {
          const dJaw = Math.hypot(u - mouthU, (v - (mouthV + 0.02)) * 1.4);
          if (dJaw < 0.05) {
            dy += Math.exp(-(dJaw * dJaw) / 0.0007) * this.speechOpen * drawH * 0.009;
          }
        }

        pts[idx++] = [dx, dy, u * this.img.naturalWidth, v * this.img.naturalHeight];
      }
    }

    // Renderiza triângulos da malha
    const stride = cols + 1;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = pts[j * stride + i];
        const b = pts[j * stride + i + 1];
        const c = pts[(j + 1) * stride + i];
        const d = pts[(j + 1) * stride + i + 1];

        this._drawTexturedTri(a[2], a[3], b[2], b[3], c[2], c[3], a[0], a[1], b[0], b[1], c[0], c[1]);
        this._drawTexturedTri(b[2], b[3], d[2], d[3], c[2], c[3], b[0], b[1], d[0], d[1], c[0], c[1]);
      }
    }

    // Overlay facial (piscada + visemas sincronizados)
    this._drawFaceOverlay((u, v) => tHead(...toPx(u, v)), drawW, drawH, pose);
  }
}

window.AvatarRig = AvatarRig;