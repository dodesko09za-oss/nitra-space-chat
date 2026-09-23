const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smooth = (a, b, value) => {
  const p = clamp((value - a) / (b - a));
  return p * p * (3 - 2 * p);
};

const templateNames = ["blink", "reveal", "depth", "slide", "spin"];
const legacyTemplates = {
  default: "reveal", chrome: "depth", blur: "blink", slide: "slide", zoom: "depth",
  fade: "reveal", orbit: "spin", liquid: "depth", shimmer: "blink", pulse: "blink",
};

const seedFor = (value = "") => Array.from(value).reduce((seed, char) => ((seed * 31) + char.charCodeAt(0)) >>> 0, 17);
export const templateForDrop = (drop = {}) => {
  const chosen = legacyTemplates[drop.style] || drop.style;
  return chosen === "auto" || !templateNames.includes(chosen)
    ? templateNames[seedFor(`${drop.id || ""}:${drop.body || ""}`) % templateNames.length]
    : chosen;
};

const beat = (seconds) => {
  const markers = [.1, .2, .5, .65, .82, 1, 3.2, 5.15, 7.1, 9.15, 11.75, 13.45];
  return markers.reduce((strength, marker) => Math.max(strength, clamp(1 - Math.abs(seconds - marker) / .1)), 0);
};

export const exportLayout = (format) => {
  const height = format === "story" ? 1920 : format === "feed" ? 1350 : 1080;
  if (format === "story") return { width: 1080, height, panel: { x: 110, y: 420, w: 860, h: 1035, r: 86 }, logo: 68, body: 48, bodyWidth: 700, bodyY: 755, maxBody: 620, domainY: 1422, signatureY: 1770, ornament: 945 };
  if (format === "feed") return { width: 1080, height, panel: { x: 165, y: 220, w: 750, h: 850, r: 68 }, logo: 57, body: 40, bodyWidth: 610, bodyY: 495, maxBody: 475, domainY: 1030, signatureY: 1260, ornament: 790 };
  return { width: 1080, height, panel: { x: 140, y: 145, w: 800, h: 770, r: 64 }, logo: 56, body: 39, bodyWidth: 640, bodyY: 405, maxBody: 390, domainY: 876, signatureY: 1014, ornament: 710 };
};

export const wrapText = (ctx, text, width, size, maxHeight) => {
  let current = size, lines = [];
  do {
    ctx.font = `${current}px Arimo`;
    lines = [""];
    for (const word of text.split(/\s+/)) {
      const index = lines.length - 1;
      if (ctx.measureText(`${lines[index]} ${word}`).width > width) lines.push(word);
      else lines[index] += `${lines[index] ? " " : ""}${word}`;
    }
    if (lines.length * current * 1.42 <= maxHeight) break;
    current -= 2;
  } while (current > 17);
  return { lines, size: current };
};

const roundedPanel = (ctx, panel) => {
  ctx.beginPath();
  ctx.roundRect(panel.x, panel.y, panel.w, panel.h, panel.r);
};

const panelTiming = { blink: .65, reveal: .85, depth: .72, slide: .72, spin: .92 };

export const renderDropFrame = (ctx, image, drop, layout, seconds) => {
  const { width, height, panel } = layout;
  const template = templateForDrop(drop), panelStart = panelTiming[template];
  const closing = smooth(13.55, 15, seconds), impact = beat(seconds), loop = Math.sin((seconds / 15) * Math.PI * 2);
  const panelReveal = smooth(panelStart, panelStart + .58, seconds) * (1 - closing);
  const reading = smooth(panelStart + .68, panelStart + 1.12, seconds) * (1 - closing);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#020202";
  ctx.fillRect(0, 0, width, height);
  const bgPulse = impact * (seconds < 1.2 ? .76 : .16);
  const bg = ctx.createRadialGradient(width * .52, height * .42, 0, width * .5, height * .5, Math.max(width, height));
  bg.addColorStop(0, `rgb(${18 + Math.round(bgPulse * 34)},${22 + Math.round(bgPulse * 38)},${26 + Math.round(bgPulse * 44)})`);
  bg.addColorStop(.48, "#060708"); bg.addColorStop(1, "#010101");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);

  const origin = [
    { x: width * .85, y: height * .14, size: layout.ornament, rotation: -.38, start: .1, layer: .42, fromX: width * .68, fromY: -height * .45 },
    { x: width * .06, y: height * .84, size: layout.ornament * .92, rotation: 2.7, start: .2, layer: .66, fromX: -width * .7, fromY: height * .36 },
    { x: width, y: height * .62, size: layout.ornament * .54, rotation: .45, start: .35, layer: 1, fromX: width * .45, fromY: height * .12 },
  ];
  origin.forEach((ornament, index) => {
    const start = template === "blink" ? ornament.start : ornament.start + .18;
    const reveal = smooth(start, start + (template === "blink" ? .18 : .5), seconds) * (1 - closing);
    const directional = template === "slide" || template === "reveal" ? 1 - reveal : (1 - reveal) * .45;
    const depth = template === "depth" ? ornament.layer : 1;
    const shake = impact * (template === "blink" ? 20 : 8) * (index % 2 ? -1 : 1);
    ctx.save();
    ctx.globalAlpha = reveal * (.62 + index * .1);
    ctx.translate(
      ornament.x + (ornament.fromX - ornament.x) * directional + Math.sin(seconds * (.55 + index * .14)) * 19 * depth + shake,
      ornament.y + (ornament.fromY - ornament.y) * directional + Math.cos(seconds * (.42 + index * .1)) * 16 * depth - shake * .3,
    );
    const spin = template === "spin" ? seconds * (.55 + index * .16) : loop * .12 * (index - 1);
    ctx.rotate(ornament.rotation + spin + impact * .11 * (index - 1));
    const scale = (.76 + .24 * reveal) * (1 + impact * (template === "depth" ? .085 : .045) + Math.sin(seconds * (.48 + index * .1)) * .025);
    ctx.scale(scale, scale);
    ctx.drawImage(image, -ornament.size / 2, -ornament.size / 2, ornament.size, ornament.size);
    ctx.restore();
  });

  ctx.save();
  const shake = impact * (template === "blink" ? 13 : 5) * Math.sin(seconds * 92);
  ctx.translate(panel.x + panel.w / 2 + shake, panel.y + panel.h / 2 + (1 - panelReveal) * 48);
  const punch = 1 + impact * .032 + Math.sin(seconds * .58) * .003;
  ctx.scale(punch * (1 - (1 - panelReveal) * .07), Math.max(.025, panelReveal) * punch);
  ctx.translate(-panel.w / 2, -panel.h / 2);
  ctx.globalAlpha = panelReveal;
  ctx.fillStyle = "#050505"; roundedPanel(ctx, { ...panel, x: 0, y: 0 }); ctx.fill();
  const shift = (Math.sin(seconds * .82) + 1) / 2;
  const border = ctx.createLinearGradient(-panel.w * .2 + shift * panel.w, 0, panel.w * (1.15 + shift), panel.h);
  border.addColorStop(0, "#34373a"); border.addColorStop(.2, "#f8fbff"); border.addColorStop(.38, "#70777d"); border.addColorStop(.58, "#fff"); border.addColorStop(.76, "#5b6065"); border.addColorStop(1, "#dce4ea");
  ctx.strokeStyle = border; ctx.lineWidth = 7; roundedPanel(ctx, { ...panel, x: 0, y: 0 }); ctx.stroke();
  ctx.strokeStyle = `rgba(255,255,255,${.1 + impact * .22})`; ctx.lineWidth = 15; roundedPanel(ctx, { ...panel, x: 0, y: 0 }); ctx.stroke();
  const shineX = ((seconds % 2.7) / 2.7) * panel.w * 2 - panel.w * .65;
  const shine = ctx.createLinearGradient(shineX - panel.w * .16, 0, shineX + panel.w * .16, 0);
  shine.addColorStop(0, "transparent"); shine.addColorStop(.5, `rgba(255,255,255,${.055 + impact * .13})`); shine.addColorStop(1, "transparent");
  ctx.fillStyle = shine; roundedPanel(ctx, { ...panel, x: 0, y: 0 }); ctx.fill();
  ctx.restore();

  ctx.save(); ctx.globalAlpha = reading; ctx.textAlign = "center"; ctx.fillStyle = "#fff";
  ctx.font = `900 ${layout.logo}px Arimo`;
  ctx.fillText("NITRA", width / 2, panel.y + layout.logo * 1.7); ctx.fillText("SPACE", width / 2, panel.y + layout.logo * 2.6);
  const text = drop.body + (drop.reply ? `\n\n${drop.reply}` : ""), wrapped = drop.__wrapped || wrapText(ctx, text, layout.bodyWidth, layout.body, layout.maxBody);
  const perLine = Math.max(.055, .72 / Math.max(wrapped.lines.length, 1));
  wrapped.lines.forEach((line, index) => {
    const lineReveal = smooth(panelStart + .65 + index * perLine, panelStart + .85 + index * perLine, seconds) * reading;
    ctx.save(); ctx.globalAlpha = lineReveal; ctx.font = `${wrapped.size}px Arimo`; ctx.fillText(line, width / 2, layout.bodyY + index * wrapped.size * 1.42); ctx.restore();
  });
  ctx.font = `700 ${height === 1920 ? 27 : 23}px Arimo`; ctx.fillText("NITRASPACE.SK", width / 2, layout.domainY);
  ctx.font = `${height === 1920 ? 23 : 19}px Arimo`; ctx.fillText("ONE CITY.  ONE SPACE.", width / 2, layout.signatureY); ctx.restore();

  if (impact > 0) { ctx.fillStyle = `rgba(235,247,255,${impact * (seconds < 1.25 ? .22 : .04)})`; ctx.fillRect(0, 0, width, height); }
};
