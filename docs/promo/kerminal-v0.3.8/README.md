<!-- @author kongweiguang -->

# Kerminal v0.3.8 宣传视频

本目录包含 30 秒产品功能展示片的横屏与竖屏动画源文件、真实界面素材、中文配音、BGM、SFX 和最终 MP4。

## 入口

- `landscape.html`：B 站 1920×1080 横屏。
- `portrait.html`：抖音 1080×1920 竖屏。
- `output/`：最终成片与关键帧检查图。
- `product-facts.md`：视频文案的仓库事实依据。
- `brand-spec.md`：品牌资产和视觉边界。

HTML 使用纯 JavaScript 时间轴，并暴露 `window.__seek(t)`，可在浏览器控制台定位任意时间点。所有产品画面均来自仓库维护的真实截图。

## 重新生成配音

```powershell
pwsh -File ./generate-voiceover.ps1
```

## 混音

```powershell
pwsh -File ./mix-audio.ps1 `
  -InputVideo ./output/kerminal-v038-bilibili-silent.mp4 `
  -OutputVideo ./output/kerminal-v038-bilibili.mp4
```

最终成片必须使用 `ffprobe` 确认同时存在视频轨与音频轨。
