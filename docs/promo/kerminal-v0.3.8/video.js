// @author kongweiguang
(() => {
  "use strict";

  const DURATION = 30;
  const isPortrait = document.body.classList.contains("portrait");
  const previewTime = new URLSearchParams(window.location.search).get("t");
  if (previewTime !== null) window.__seekRender = true;
  const $ = (selector) => document.querySelector(selector);
  const shots = [...document.querySelectorAll(".shot")];
  const railItems = [...document.querySelectorAll(".feature-rail span")];

  const scenes = [
    { key: "hero", start: 2.55, end: 8.05, eyebrow: "ONE DESKTOP WORKSPACE", headline: "一座工作台\n管理每一个目标", detail: "本机、远程服务器与容器，共享清晰的操作上下文。", rail: 0 },
    { key: "agent", start: 7.45, end: 13.55, eyebrow: "AGENT · TARGET BOUND", headline: "Agent 直接绑定\n当前目标", detail: "Codex、Claude 与自定义 Agent，不再悬浮在终端之外。", rail: 1 },
    { key: "sftp", start: 12.95, end: 18.35, eyebrow: "SFTP · EDIT · TRANSFER", headline: "远程文件\n就在工作台里", detail: "浏览、传输与编辑连续完成，任务不必离开当前连接。", rail: 2 },
    { key: "docker", start: 17.75, end: 22.85, eyebrow: "DOCKER · PODMAN · COMPOSE", headline: "容器与 Compose\n一处管理", detail: "状态、日志、终端和容器文件，跟随同一个服务器目标。", rail: 3 },
    { key: "system", start: 22.25, end: 26.65, eyebrow: "SYSTEM · PORTS · TMUX", headline: "系统状态\n随时可见", detail: "资源监控、端口转发和 tmux，始终围绕当前机器展开。", rail: 4 },
  ];

  const subtitleCues = [
    [0.35, 3.05, "终端，不该只是一块黑色窗口"],
    [3.05, 7.8, "本机、远程服务器和容器，都在一个工作台"],
    [7.8, 13.45, "Codex 和 Claude，直接绑定当前目标"],
    [13.45, 18.25, "传文件，编辑远程内容"],
    [18.25, 22.75, "管理容器与 Compose"],
    [22.75, 26.5, "资源状态与端口转发，随时可见"],
    [26.5, 30, "终端、服务器与 Agent，在同一个上下文里协作"],
  ];

  const focusLandscape = {
    hero: [38, 87, 250, 610],
    agent: [1115, 104, 270, 650],
    sftp: [310, 125, 1040, 650],
    docker: [20, 126, 265, 500],
    system: [1108, 100, 282, 610],
  };
  const focusPortrait = {
    hero: [120, 160, 720, 570],
    agent: [590, 145, 340, 650],
    sftp: [60, 160, 850, 640],
    docker: [32, 145, 285, 555],
    system: [590, 140, 350, 620],
  };
  const portraitShift = { hero: -350, agent: -610, sftp: -300, docker: 0, system: -610 };

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const smooth = (value) => {
    const x = clamp(value);
    return x * x * (3 - 2 * x);
  };
  const mix = (a, b, p) => a + (b - a) * p;
  const sceneOpacity = (scene, time) => {
    const fadeIn = smooth((time - scene.start) / 0.55);
    const fadeOut = 1 - smooth((time - (scene.end - 0.55)) / 0.55);
    return clamp(Math.min(fadeIn, fadeOut));
  };

  function activeScene(time) {
    return scenes.reduce((best, scene) => sceneOpacity(scene, time) > sceneOpacity(best, time) ? scene : best, scenes[0]);
  }

  function render(time) {
    const t = clamp(Number(time) || 0, 0, DURATION - 0.001);
    const openingOpacity = t < 2.75 ? 1 - smooth((t - 2.15) / 0.6) : 0;
    const openingScale = mix(0.94, 1, smooth(t / 1.2));
    $("#opening").style.opacity = openingOpacity.toFixed(3);
    $("#opening").style.transform = `translateY(${mix(18, 0, smooth(t / 1.1))}px) scale(${openingScale})`;
    $(".cursor").style.opacity = Math.floor(t * 3) % 2 ? "0.25" : "1";
    $(".brand-mark").style.opacity = String(smooth((t - 2.5) / 0.7) * (1 - smooth((t - 26.0) / 0.6)));

    const current = activeScene(t);
    const workbenchOpacity = smooth((t - 2.35) / 0.65) * (1 - smooth((t - 26.15) / 0.55));
    $("#workbench").style.opacity = workbenchOpacity.toFixed(3);
    $("#workbench").style.transform = isPortrait
      ? `translateY(${mix(34, 0, smooth((t - 2.3) / 1.0))}px)`
      : `translateX(${mix(70, 0, smooth((t - 2.3) / 1.0))}px)`;

    for (const shot of shots) {
      const scene = scenes.find((item) => item.key === shot.dataset.key);
      const opacity = sceneOpacity(scene, t);
      shot.style.opacity = opacity.toFixed(3);
      const progress = clamp((t - scene.start) / (scene.end - scene.start));
      if (isPortrait) {
        shot.style.transform = `translateX(${portraitShift[scene.key]}px) scale(${mix(1.015, 1.045, progress)})`;
      } else {
        shot.style.transform = `scale(${mix(1.012, 1.04, progress)}) translate3d(${mix(0, -8, progress)}px, ${mix(0, -5, progress)}px, 0)`;
      }
    }

    const copyOpacity = workbenchOpacity * sceneOpacity(current, t);
    $("#featureCopy").style.opacity = copyOpacity.toFixed(3);
    $("#featureCopy").style.transform = `translateY(${mix(18, 0, smooth((t - current.start) / 0.7))}px)`;
    $("#eyebrow").textContent = current.eyebrow;
    $("#headline").innerHTML = current.headline.replace("\n", "<br>");
    $("#detail").textContent = current.detail;
    $("#windowLabel").textContent = `CURRENT TARGET · ${current.key === "hero" ? "PROD-API" : current.key.toUpperCase()}`;

    const focus = (isPortrait ? focusPortrait : focusLandscape)[current.key];
    const ring = $("#focusRing");
    ring.style.left = `${focus[0]}px`;
    ring.style.top = `${focus[1]}px`;
    ring.style.width = `${focus[2]}px`;
    ring.style.height = `${focus[3]}px`;
    ring.style.opacity = String(copyOpacity * (0.78 + Math.sin(t * 4) * 0.1));

    railItems.forEach((item, index) => item.classList.toggle("active", index === current.rail));
    $("#featureRail").style.opacity = String(workbenchOpacity);

    const outroOpacity = smooth((t - 26.05) / 0.75);
    $("#outro").style.opacity = outroOpacity.toFixed(3);
    $("#outro").style.transform = `translateY(${mix(30, 0, outroOpacity)}px)`;

    const subtitle = subtitleCues.find(([start, end]) => t >= start && t < end);
    const subtitleNode = $("#subtitle span");
    subtitleNode.textContent = subtitle ? subtitle[2] : "";
    $("#subtitle").style.opacity = subtitle && t < 26.15 ? "1" : "0";
  }

  let time = 0;
  let lastTick = null;
  function tick(now) {
    if (lastTick === null) {
      lastTick = now;
      render(time);
      window.__ready = true;
      requestAnimationFrame(tick);
      return;
    }
    if (!window.__seekRender) {
      const delta = (now - lastTick) / 1000;
      time += delta;
      if (time >= DURATION) time = window.__recording ? DURATION - 0.001 : 0;
      render(time);
    }
    lastTick = now;
    requestAnimationFrame(tick);
  }

  window.__seek = (nextTime) => {
    time = clamp(Number(nextTime) || 0, 0, DURATION - 0.001);
    render(time);
  };

  Promise.all([...document.images].map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => {
    img.addEventListener("load", resolve, { once: true });
    img.addEventListener("error", resolve, { once: true });
  }))).then(() => document.fonts.ready).then(() => {
    if (previewTime !== null) time = clamp(Number(previewTime) || 0, 0, DURATION - 0.001);
    render(time);
    requestAnimationFrame(tick);
  });
})();
