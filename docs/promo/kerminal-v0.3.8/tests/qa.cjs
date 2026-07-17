// @author kongweiguang
const { chromium } = require("playwright");
const path = require("path");

const root = path.resolve(__dirname, "..");
const cases = [
  { file: "landscape.html", viewport: { width: 1920, height: 1080 }, times: [0.8, 5, 10, 16, 20, 24, 28] },
  { file: "portrait.html", viewport: { width: 1080, height: 1920 }, times: [0.8, 5, 10, 16, 20, 24, 28] },
];

(async () => {
  const browser = await chromium.launch();
  const failures = [];

  for (const testCase of cases) {
    const context = await browser.newContext({ viewport: testCase.viewport });
    for (const time of testCase.times) {
      const page = await context.newPage();
      const label = `${testCase.file}@${time}s`;
      page.on("pageerror", (error) => failures.push(`${label}: pageerror ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") failures.push(`${label}: console ${message.text()}`);
      });
      const url = `file:///${path.join(root, testCase.file).replace(/\\/g, "/")}?t=${time}`;
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction(() => window.__ready === true && typeof window.__seek === "function");
      const state = await page.evaluate(() => {
        const viewport = { width: innerWidth, height: innerHeight };
        const visible = [...document.querySelectorAll(".opening,.feature-copy,.workbench,.outro,.subtitle")]
          .filter((element) => Number(getComputedStyle(element).opacity) > 0.05)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return { className: element.className, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
          });
        return { viewport, visible };
      });
      for (const rect of state.visible) {
        if (rect.left < -2 || rect.top < -2 || rect.right > state.viewport.width + 2 || rect.bottom > state.viewport.height + 2) {
          failures.push(`${label}: ${rect.className} 超出画布 ${JSON.stringify(rect)}`);
        }
      }
      await page.close();
    }
    await context.close();
  }

  await browser.close();
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("QA passed: 2 formats × 7 timestamps, no page errors or visible element overflow.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
