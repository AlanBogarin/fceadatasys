// Apoyo a la comprobación manual: una sesión HTTP independiente del navegador UI.
// apiFixture restringe la conexión a la base exclusiva del cliente y al rol runtime.
import { apiFixture, testAdmin, testPassword } from "./api-fixture";
import { emptyBibliographicFilters } from "../src/bibliography";

const action = process.argv[2] ?? "inspect";
if (!["inspect", "keywords"].includes(action))
  throw Error("Acción QA no admitida.");
const fixture = await apiFixture();
const tab = fixture.browser().tab();
try {
  await tab.client.auth.initializeBrowser();
  await tab.client.auth.login(testAdmin, testPassword);
  const result = await tab.client.publications.list({
    ...emptyBibliographicFilters,
    code: "INV-00020",
  });
  const record = result.data[0];
  if (
    !record ||
    record.title !== "Economía y ahorro: validación del cliente 16 al 20"
  )
    throw Error(
      "No se encontró la publicación sintética de comprobación manual.",
    );
  if (action === "keywords") {
    const current = await tab.client.publications.get(record.id);
    const saved = await tab.client.publications.update(
      record.id,
      { keywords: `economía, ahorro, savings, QA ${Date.now()}` },
      { ifMatch: current.etag },
    );
    console.log(
      JSON.stringify({
        id: saved.id,
        code: saved.code,
        keywords: saved.keywords,
      }),
    );
  } else {
    const users = await tab.client.users.list({
      search: "pub.",
      pageSize: 100,
    });
    const files = await tab.client.attachments.list({ pageSize: 100 });
    console.log(
      JSON.stringify({
        publication: {
          id: record.id,
          code: record.code,
          attachment: record.attachment,
          keywords: record.keywords,
        },
        users: users.data.map((user) => ({
          username: user.username,
          role: user.role,
        })),
        attachments: files.data.map((file) => ({
          id: file.id,
          name: file.name,
          status: file.status,
          reservedPublicationId: file.reservedPublicationId,
        })),
      }),
    );
  }
  await tab.client.auth.logout();
} finally {
  await fixture.close();
}
