import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Auth } from "../AuthPage";
import { DataProvider } from "./context";
import { createApiClient } from "./apiClient";
import { ApiSession } from "./apiSession";
import { HttpTransport } from "./http";

test("Auth API: no expone cuentas, contraseñas ni canal de recuperación del simulador", () => {
  const runtime = new ApiSession(new HttpTransport("http://api.test"));
  const client = createApiClient(runtime, async () => undefined);
  const content = createElement(Auth, {
    onLogin() {},
    onExit() {},
    onResetComplete() {},
  });
  const html = renderToStaticMarkup(
    createElement(DataProvider, { client, mode: "api", children: content }),
  );
  assert.match(html, /Acceso institucional/);
  assert.doesNotMatch(
    html,
    /cuentas de prueba|Fcea2026!|demostración|demo-accounts|recovery-demo/,
  );
  assert.equal(client.demo, undefined);
});
