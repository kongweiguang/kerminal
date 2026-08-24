// @author kongweiguang

export async function waitForAppReady(client) {
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="工具栏"]') !== null && document.body.innerText.includes("prod-api")`,
    120_000,
  );
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="prod-api xterm 终端"]') !== null`,
    120_000,
  );
  await delay(500);
}

/**
 * 截图不能在 IPC fixture 漂移时静默降级；浏览器异常和未建模 command 都会让画面
 * 缺失真实能力，因此除 ResizeObserver 的无害通知外一律阻断生成。
 */
export async function assertNoBlockingErrors(client) {
  const result = await evaluate(
    client,
    `(() => ({
      errors: window.__kerminalReadmeCaptureState?.errors ?? [],
      unknownInvocations:
        window.__kerminalReadmeCaptureState?.unknownInvocations ?? [],
    }))()`,
    { returnByValue: true },
  );
  const state = result.result?.value ?? {};
  const errors = state.errors ?? [];
  const blocking = errors.filter(
    (error) =>
      !String(error.message ?? "").includes("ResizeObserver loop completed") &&
      !String(error.message ?? "").includes("ResizeObserver loop limit"),
  );
  if (blocking.length > 0) {
    throw new Error(`Browser errors during capture: ${JSON.stringify(blocking)}`);
  }
  if ((state.unknownInvocations ?? []).length > 0) {
    throw new Error(
      `Unknown Tauri IPC during capture: ${JSON.stringify(state.unknownInvocations)}`,
    );
  }
}

export async function collectDiagnostics(client) {
  const result = await evaluate(
    client,
    `(() => ({
      ariaLabels: Array.from(document.querySelectorAll("[aria-label]"))
        .map((node) => node.getAttribute("aria-label"))
        .filter(Boolean)
        .slice(0, 120),
      bodyText: document.body?.innerText?.slice(0, 5000) ?? "",
      captureState: window.__kerminalReadmeCaptureState ?? null,
      html: document.querySelector("#root")?.innerHTML?.slice(0, 3000) ?? "",
      location: window.location.href,
      readyState: document.readyState,
    }))()`,
    { returnByValue: true },
  );
  return result.result?.value;
}


export async function clickSelector(client, selector) {
  await clickExpression(client, `document.querySelector(${JSON.stringify(selector)})`);
}

export async function clickTextButtonContaining(client, text) {
  await clickExpression(
    client,
    `Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes(${JSON.stringify(text)}))`,
  );
}

export async function contextClickExpression(client, expression) {
  const rectResult = await evaluate(
    client,
    `(() => {
      const element = ${expression};
      if (!element) throw new Error("Missing context clickable element");
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    })()`,
    { returnByValue: true },
  );
  const { x, y } = rectResult.result.value;
  await client.send("Input.dispatchMouseEvent", {
    button: "right",
    buttons: 2,
    clickCount: 1,
    type: "mousePressed",
    x,
    y,
  });
  await client.send("Input.dispatchMouseEvent", {
    button: "right",
    buttons: 0,
    clickCount: 1,
    type: "mouseReleased",
    x,
    y,
  });
}

export async function clickExpression(client, expression) {
  const rectResult = await evaluate(
    client,
    `(() => {
      const element = ${expression};
      if (!element) throw new Error("Missing clickable element");
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    })()`,
    { returnByValue: true },
  );
  const { x, y } = rectResult.result.value;
  await client.send("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 1,
    clickCount: 1,
    type: "mousePressed",
    x,
    y,
  });
  await client.send("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 0,
    clickCount: 1,
    type: "mouseReleased",
    x,
    y,
  });
}

export async function pressKey(client, key) {
  await client.send("Input.dispatchKeyEvent", { key, type: "keyDown" });
  await client.send("Input.dispatchKeyEvent", { key, type: "keyUp" });
}


export async function waitForBrowserExpression(client, expression, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await evaluate(client, expression, { returnByValue: true });
    if (result.result?.value === true) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for browser expression: ${expression}`);
}

export async function evaluate(client, expression, options = {}) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    ...options,
  });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    const message =
      details.exception?.description ??
      details.exception?.value ??
      details.text ??
      "Browser evaluation failed";
    throw new Error(String(message));
  }
  return result;
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
