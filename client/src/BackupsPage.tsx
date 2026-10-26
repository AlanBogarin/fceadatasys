import { useEffect, useState } from "react";
import { useDataClient } from "./data/context";
import { useQuery } from "./data/useQuery";
import { Alert, errorText } from "./ui";
import { auditDate } from "./AuditPage";

export function BackupsPage() {
  const client = useDataClient();
  const [page, setPage] = useState(1);
  const query = useQuery(
    (signal) => client.backups!.list(page, signal),
    [client, page],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const running = query.data?.data.some((job) => job.status === "EN_CURSO");
  useEffect(() => {
    const timer = setInterval(query.reload, running ? 3000 : 15000);
    return () => clearInterval(timer);
  }, [query.reload, running]);
  async function run() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await client.backups!.run();
      setMessage(
        "Copia iniciada. Podés consultar su resultado en este listado.",
      );
      setPage(1);
      query.reload();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administración</p>
          <h1>Copias de seguridad</h1>
          <p>Respaldo de la base de datos en el servidor y en Google Drive.</p>
        </div>
        <button
          className="primary"
          disabled={busy || !query.data?.configured}
          onClick={run}
        >
          {busy ? "Iniciando…" : "Crear copia ahora"}
        </button>
      </div>
      <Alert text={error || (query.error ? errorText(query.error) : "")} />
      <Alert text={message} success />
      {query.data && !query.data.configured && (
        <Alert text="Las copias todavía no están configuradas. TIC debe definir la carpeta privada y autorizar Google Drive siguiendo la guía de instalación." />
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Historial de copias</h2>
            <p>
              Una copia parcial conserva el archivo local e indica que Google
              Drive no pudo verificarse.
            </p>
          </div>
          <button className="secondary" onClick={query.reload}>
            Actualizar
          </button>
        </div>
        <div className="table-scroll">
          <table className="catalog-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Origen</th>
                <th>Estado</th>
                <th>Servidor</th>
                <th>Google Drive</th>
                <th>Archivo / Detalle</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.data.map((job) => (
                <tr key={job.id}>
                  <td>{auditDate(job.createdAt)}</td>
                  <td>{job.source === "MANUAL" ? "Manual" : "Programada"}</td>
                  <td>
                    {{
                      EN_CURSO: "En curso",
                      COMPLETO: "Completo",
                      PARCIAL: "Parcial",
                      FALLIDO: "Fallido",
                    }[job.status] ?? job.status}
                  </td>
                  <td>{job.localSaved ? "Verificada" : "Sin confirmar"}</td>
                  <td>{job.cloudSaved ? "Verificada" : "Sin confirmar"}</td>
                  <td>
                    {job.filename}
                    <small>{job.detail}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {query.data?.pagination.total === 0 && (
          <p className="no-results">
            Todavía no se registraron copias de seguridad.
          </p>
        )}
        {query.loading && <p role="status">Consultando copias…</p>}
        <div className="modal-footer">
          <button
            className="secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </button>
          <span>Página {page}</span>
          <button
            className="secondary"
            disabled={!query.data || page >= query.data.pagination.totalPages}
            onClick={() => setPage(page + 1)}
          >
            Siguiente
          </button>
        </div>
      </section>
    </>
  );
}
