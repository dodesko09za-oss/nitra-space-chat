import "./drops.css";
import { db, state, content, notice, onCleanup } from "./runtime.js";
import { html } from "./shared.js";
import { exportLayout, wrapText, renderDropFrame } from "./drop-renderer.js";
import { readVideoStream } from "./drop-video-client.js";
import './drop-font.css';

const styles = ["blink", "reveal", "depth", "slide", "spin", "auto"];
const labels = {
  received: "Prijaté",
  unread: "Nečítané",
  answered: "Zodpovedané",
  archived: "Archív",
};
const typeMessage = (element) => {
  if (!element) return;
  const chars = Array.from(element.textContent || ""),
    step = Math.min(24, 3000 / Math.max(chars.length, 1));
  element.textContent = "";
  element.classList.add("drop-message");
  chars.forEach((char, index) => {
    const span = document.createElement("span");
    span.textContent = char;
    span.style.setProperty("--char-delay", `${Math.round(index * step)}ms`);
    element.append(span);
  });
};
export async function renderDrops() {
  const requestedAdmin = location.pathname === "/admin/drops";
  if (requestedAdmin && !state.admin) {
    content(
      '<section class="drops"><div class="drop-compose"><h2>PRÍSTUP LEN PRE ADMINA.</h2><p>Prihlás sa cez svoj admin účet.</p><a class="drop-primary admin-panel-link" href="/account">PRIHLÁSIŤ SA</a></div></section>',
    );
    return;
  }
  const adminPanel = requestedAdmin && state.admin;
  let rows = [],
    selected = null,
    filter = "received",
    query = "",
    format = "story",
    busy = false,
    alive = true;
  onCleanup(() => {
    alive = false;
  });
  const checked = async (request) => {
    const r = await request;
    if (r.error) throw Error(r.error.message);
    return r.data;
  };
  const run = async (task) => {
    if (busy) return;
    busy = true;
    try {
      await task();
    } catch (e) {
      notice(e.message);
    } finally {
      busy = false;
    }
  };
  const visible = () =>
    rows.filter(
      (r) =>
        (filter === "received"
          ? r.status !== "archived"
          : r.status === filter) &&
        r.body.toLocaleLowerCase("sk").includes(query.toLocaleLowerCase("sk")),
    );
  const save = async (patch) => {
    const result = await checked(
      db
        .from("nitra_drops")
        .update(patch)
        .eq("id", selected.id)
        .select()
        .single(),
    );
    Object.assign(selected, result);
    paint();
  };
  function paint() {
    if (!alive) return;
    const list = visible();
    if (!list.some((r) => r.id === selected?.id)) selected = list[0] || null;
    content(
      `<section class="drops"><div class="drops-atmosphere" aria-hidden="true"><img src="/chrome-sculpture.png" alt=""><img src="/chrome-sculpture.png" alt=""></div><div class="drops-top"><span>/ O D K A Z Y</span>${adminPanel ? '<input data-drop-search aria-label="Hľadať odkazy" placeholder="Hľadať odkazy…" value="' + html(query) + '">' : ""}</div><div class="drops-heading"><div><h1>${adminPanel ? "TVOJE ODKAZY." : "KOHO HĽADÁŠ<br>V NITRE?"}</h1><p>ANONYMNE. SKUTOČNE. Z NITRY.</p></div><small>NITRA<br>ŽIJE<br>ONLINE.<i></i></small></div>${
        adminPanel
          ? `<div class="drops-tabs">${Object.entries(labels)
              .map(
                ([id, label]) =>
                  `<button data-drop-filter="${id}" aria-pressed="${id === filter}">${label} <b>${rows.filter((r) => (id === "received" ? r.status !== "archived" : r.status === id)).length}</b></button>`,
              )
              .join(
                "",
              )}<button data-new-drop>＋ Nový drop</button></div><div class="drops-layout"><div class="drops-list">${list.map((r) => `<button data-drop-id="${r.id}" class="${selected?.id === r.id ? "active" : ""}"><span>${html(r.body)}</span><small>${new Date(r.created_at).toLocaleString("sk-SK", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}</small><i class="${r.status === "unread" ? "unread" : ""}"></i></button>`).join("") || '<p class="drops-empty">Zatiaľ žiadne odkazy.</p>'}</div><div class="drops-detail">${selected ? `<div class="drop-stage style-${selected.style}"><span class="drop-position">${list.indexOf(selected) + 1} / ${list.length}</span><img class="drop-ornament top" src="/chrome-sculpture.png" alt=""><img class="drop-ornament bottom" src="/chrome-sculpture.png" alt=""><div class="drop-glass"><strong>NITRA<br>SPACE</strong><p>${html(selected.body)}</p>${selected.reply ? `<div class="drop-reply">${html(selected.reply)}</div>` : ""}<i></i></div><div class="drop-signature">ONE CITY.<br>ONE SPACE.<i></i></div></div><p class="drop-style-label">ŠTÝL DROPU</p><div class="drop-styles">${styles.map((s) => `<button data-drop-style="${s}" aria-pressed="${s === selected.style}"><img src="/chrome-sculpture.png" alt=""><span>${s[0].toUpperCase() + s.slice(1)}</span></button>`).join("")}</div><div class="drop-actions"><button class="drop-primary" data-drop-export>↓ Stiahnuť obrázok</button><button data-drop-share>Zdieľať</button><button data-drop-archive>${selected.status === "archived" ? "Obnoviť" : "Archivovať"}</button></div><form data-drop-reply><label>Odpoveď<textarea name="reply" maxlength="1200" placeholder="Napíš odpoveď…">${html(selected.reply)}</textarea></label><button type="submit">Uložiť odpoveď</button></form>` : '<div class="drop-stage empty-stage"><strong>NITRA<br>SPACE</strong><p>Prvý odkaz sa tu objaví po odoslaní.</p></div>'}</div></div>`
          : composer()
      }</section>`,
    );
    typeMessage(
      document.querySelector(".drop-stage:not(.empty-stage) .drop-glass>p"),
    );
    document.querySelector(".drop-stage:not(.empty-stage)")?.insertAdjacentHTML(
      "afterbegin",
      '<img class="drop-ornament accent" src="/chrome-sculpture.png" alt="">',
    );
    document
      .querySelector("[data-drop-search]")
      ?.addEventListener("input", (e) => {
        query = e.target.value;
        const pos = e.target.selectionStart;
        paint();
        const el = document.querySelector("[data-drop-search]");
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    document.querySelectorAll("[data-drop-filter]").forEach(
      (b) =>
        (b.onclick = () => {
          filter = b.dataset.dropFilter;
          paint();
        }),
    );
    document.querySelectorAll("[data-drop-id]").forEach(
      (b) =>
        (b.onclick = () =>
          run(async () => {
            selected = rows.find((r) => r.id === b.dataset.dropId);
            if (selected.status === "unread") await save({ status: "read" });
            else paint();
          })),
    );
    document
      .querySelectorAll("[data-drop-style]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            run(async () => {
              const previous = selected.style;
              selected.style = b.dataset.dropStyle;
              paint();
              try {
                await save({ style: selected.style });
              } catch (error) {
                selected.style = previous;
                paint();
                throw error;
              }
            })),
      );
    document
      .querySelector("[data-drop-archive]")
      ?.addEventListener("click", () =>
        run(() =>
          save({
            status: selected.status === "archived" ? "read" : "archived",
          }),
        ),
      );
    document
      .querySelector("[data-drop-reply]")
      ?.addEventListener("submit", (e) => {
        e.preventDefault();
        const reply = new FormData(e.target).get("reply").trim();
        run(async () => {
          await save({ reply, status: reply ? "answered" : "read" });
          notice("Odpoveď uložená.");
        });
      });
    document.querySelector("[data-new-drop]")?.addEventListener("click", () => {
      content(
        `<section class="drops"><h1>NOVÝ DROP.</h1>${composer()}</section>`,
      );
      bindComposer();
    });
    document
      .querySelector("[data-drop-export]")
      ?.addEventListener("click", () =>
        run(() => exportDrop(selected, false, format)),
      );
    const actions = document.querySelector(".drop-actions");
    if (actions) {
      const formats = document.createElement("div");
      formats.className = "drop-formats";
      formats.innerHTML =
        '<span>FORMÁT</span><button data-drop-format="story" aria-pressed="' +
        (format === "story") +
        '">9:16 Reel</button><button data-drop-format="feed" aria-pressed="' +
        (format === "feed") +
        '">4:5 Post</button><button data-drop-format="square" aria-pressed="' +
        (format === "square") +
        '">1:1 Square</button>';
      actions.before(formats);
      formats.querySelectorAll("[data-drop-format]").forEach(
        (button) =>
          (button.onclick = () => {
            format = button.dataset.dropFormat;
            formats
              .querySelectorAll("button")
              .forEach((item) =>
                item.setAttribute("aria-pressed", String(item === button)),
              );
            notice("Formát " + button.textContent + " je vybraný.");
          }),
      );
    }
    if (actions) {
      const video = document.createElement("button");
      video.textContent = "↓ Dropnúť 15 s video";
      video.className = "drop-primary";
      actions.prepend(video);
      video.onclick = () => {
        if (busy) return;
        return run(async () => {
          video.disabled = true;
          video.textContent = "Pripravujem 15 s video…";
          try {
            await exportDrop(selected, true, format, percent => {
              video.textContent = percent < 100 ? `Vytváram video… ${percent} %` : 'Dokončujem MP4…';
            });
          } finally {
            video.disabled = false;
            video.textContent = "↓ Dropnúť 15 s video";
          }
        });
      };
    }
    document.querySelector("[data-drop-share]")?.addEventListener("click", () =>
      run(async () => {
        if (navigator.share)
          await navigator.share({ title: "Nitra Space", text: selected.body });
        else {
          await navigator.clipboard.writeText(selected.body);
          notice("Text odkazu skopírovaný.");
        }
      }),
    );
    bindComposer();
  }
  function composer() {
    return `${state.admin ? '<a class="admin-panel-link" href="/admin/drops">ADMIN PANEL →</a>' : ""}<form class="drop-compose" data-drop-compose><div class="drop-mini-logo">NITRA<br>SPACE</div><span class="compose-kicker">NITRA / MISSED CONNECTIONS</span><h2>JEDNO MESTO.<br>TISÍCE STRETNUTÍ.</h2><p>Zaujal ťa niekto v meste? Napíš kde ste sa stretli a nechaj odkaz. Dostane ho admin; vybrané odkazy môže anonymne zdieľať.</p><label>Odkaz<textarea name="body" required minlength="3" maxlength="1200" placeholder="Hľadám chalana, ktorého som stretla v sobotu pri divadle…"></textarea></label><button class="drop-primary" type="submit">ODOSLAŤ ODKAZ ↗</button><p data-compose-status role="status"></p></form>`;
  }
  function bindComposer() {
    document
      .querySelector("[data-drop-compose]")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (busy) return;
        const form = e.target,
          button = form.querySelector("button"),
          message = form.querySelector("[data-compose-status]"),
          body = new FormData(form).get("body").trim();
        button.disabled = true;
        busy = true;
        message.textContent = "Odosielam…";
        try {
          await checked(db.from("nitra_drops").insert({ body }));
          form.reset();
          message.textContent = "Odkaz je odoslaný. Ďakujeme!";
          if (adminPanel) {
            await load();
            paint();
            notice("Nový drop uložený.");
          }
        } catch (err) {
          message.textContent = "Odoslanie zlyhalo: " + err.message;
        } finally {
          button.disabled = false;
          busy = false;
        }
      });
  }
  async function load() {
    rows = await checked(
      db
        .from("nitra_drops")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
    );
  }
  if (adminPanel) await load();
  paint();
}


async function exportDrop(drop, video = false, format = "story", onProgress = () => {}) {
  const layout = exportLayout(format);
  let blob;
  if (video) {
    const session = await db.auth.getSession(), token = session.data.session?.access_token;
    if (!token) throw Error("Pre export MP4 sa musíš prihlásiť ako admin.");
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 285_000);
    let wakeLock;
    try {
      wakeLock = await navigator.wakeLock?.request("screen").catch(() => null);
      const response = await fetch("/api/drop-mp4", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ format, drop: { body: drop.body, reply: drop.reply || "", style: drop.style } }),
        signal: controller.signal,
      });
      blob = await readVideoStream(response, onProgress);
    } catch (error) {
      if (error.name === "AbortError") throw Error("Export trval príliš dlho. Skús ho spustiť znova.");
      throw error;
    } finally {
      clearTimeout(deadline);
      await wakeLock?.release().catch(() => {});
    }
  } else {
    await document.fonts.ready;
    const canvas = document.createElement("canvas");
    canvas.width = layout.width; canvas.height = layout.height;
    const ctx = canvas.getContext("2d", { alpha: false }), image = new Image();
    image.src = "/chrome-sculpture.png"; await image.decode();
    const chrome = document.createElement("canvas");
    chrome.width = image.naturalWidth; chrome.height = image.naturalHeight;
    const chromeCtx = chrome.getContext("2d");
    chromeCtx.filter = "grayscale(1) brightness(1.85) contrast(1.25)";
    chromeCtx.drawImage(image, 0, 0);
    const pixels = chromeCtx.getImageData(0, 0, chrome.width, chrome.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const light = Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
      pixels.data[i + 3] = Math.round(pixels.data[i + 3] * Math.max(0, Math.min(1, (light - 18) / 46)));
    }
    chromeCtx.putImageData(pixels, 0, 0);
    const prepared = { ...drop, __wrapped: wrapText(ctx, drop.body + (drop.reply ? `\n\n${drop.reply}` : ""), layout.bodyWidth, layout.body, layout.maxBody) };
    renderDropFrame(ctx, chrome, prepared, layout, 7.5);
    blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  }
  if (!blob) throw Error("Súbor sa nepodarilo vytvoriť.");
  const names = { story: "nitra-space-drop-reel", feed: "nitra-space-drop-4x5", square: "nitra-space-drop-square" };
  const filename = `${names[format]}.${video ? "mp4" : "png"}`;
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; link.className = "drop-primary";
  if (video) {
    // iOS sharing/downloading must start from a fresh user gesture, not a
    // popup opened before a long render. Keep a real download available too.
    const previous = document.querySelector("[data-drop-ready]");
    previous?.remove();
    const ready = document.createElement("div");
    ready.dataset.dropReady = ""; ready.className = "drop-actions";
    link.textContent = "↓ Uložiť hotové MP4";
    ready.append(link);
    const file = new File([blob], filename, { type: "video/mp4" });
    if (navigator.canShare?.({ files: [file] })) {
      const share = document.createElement("button");
      share.textContent = "Uložiť / zdieľať video";
      share.onclick = async () => {
        try { await navigator.share({ files: [file], title: "Nitra Space drop" }); }
        catch (error) { if (error.name !== "AbortError") notice("Použi tlačidlo Uložiť hotové MP4."); }
      };
      ready.append(share);
    }
    const preview = document.createElement("video");
    preview.controls = true; preview.playsInline = true; preview.loop = true;
    preview.src = url; preview.style.cssText = "width:100%;max-height:520px;background:#020202;border-radius:16px";
    ready.prepend(preview);
    document.querySelector(".drop-actions")?.after(ready);
    onCleanup(() => URL.revokeObjectURL(url));
    notice("Hotovo — 15 sekúnd, 1080p, 60 fps. Video si môžeš prehrať, uložiť alebo zdieľať.");
  } else {
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    notice("Obrázok je pripravený na stiahnutie.");
  }
}
