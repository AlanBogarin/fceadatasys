import { apiFixture } from "./api-fixture";

const fixture = await apiFixture();
await fixture.app.listen({ host: "127.0.0.1", port: 3000 });
console.log(
  "API de prueba: http://127.0.0.1:3000 (base exclusiva del cliente; SMTP local).",
);
const close = async () => {
  await fixture.close();
  process.exit(0);
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
