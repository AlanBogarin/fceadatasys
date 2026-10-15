import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, Eye, FolderOpen, ListFilter, Pencil, Plus, Search, Settings2, ShieldCheck, Trash2, X } from 'lucide-react';
import type { State, User } from './model';
import { catalogConfig, deleteCatalogRecord, filterCatalog, saveCatalogRecord, setCatalogActive, type CatalogKey, type CatalogRecord } from './catalogs';

function CatalogDialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="modal" aria-label={title} onCancel={close}>
    <div className="modal-heading"><div><p className="eyebrow">Catálogos institucionales</p><h2>{title}</h2></div><button type="button" className="icon-btn" aria-label="Cerrar formulario" onClick={close}><X/></button></div>
    {children}
  </dialog>;
}
const message = (e: unknown) => e instanceof Error ? e.message : 'No se pudo guardar el registro.';

export default function CatalogPage({ catalog, state, user, commit, notify }: { catalog: CatalogKey; state: State; user: User; commit: (s: State) => void; notify: (s: string) => void }) {
  const config = catalogConfig[catalog];
  const records = state.catalogs[catalog];
  const person = catalog === 'autores' || catalog === 'tutores';
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<CatalogRecord | 'new' | null>(null);
  const [detail, setDetail] = useState<CatalogRecord | null>(null);
  const [toggle, setToggle] = useState<CatalogRecord | null>(null);
  const [deleting, setDeleting] = useState<CatalogRecord | null>(null);
  const [error, setError] = useState('');
  const filtered = filterCatalog(records, query, status);
  const pages = Math.max(1, Math.ceil(filtered.length / 8));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * 8, current * 8);
  const resetFilters = () => { setQuery(''); setStatus(''); setPage(1); };
  return <>
    <div className="page-heading"><div><p className="eyebrow">{person ? 'Gestión bibliográfica' : 'Administración'} / Catálogos</p><h1>{config.title}</h1><p>{config.description}</p></div><button className="primary" onClick={() => setEditing('new')}><Plus size={18}/>{config.createLabel}</button></div>
    <div className="stats-grid compact">
      <div className="stat"><span className="stat-icon"><FolderOpen/></span><div><p>Total de registros</p><strong>{records.length.toString().padStart(2, '0')}</strong></div></div>
      <div className="stat"><span className="stat-icon"><Check/></span><div><p>Activos</p><strong>{records.filter(r => r.active).length.toString().padStart(2, '0')}</strong></div></div>
      <div className="stat"><span className="stat-icon lilac"><Settings2/></span><div><p>Inactivos</p><strong>{records.filter(r => !r.active).length.toString().padStart(2, '0')}</strong></div></div>
    </div>
    <section className="panel">
      <div className="panel-heading"><div><h2>Directorio de {config.title.toLocaleLowerCase('es')}</h2><p>Consultá, agregá y actualizá los registros.</p></div><span className="badge blue">{records.length} registros</span></div>
      <div className="filter-bar"><label className="search-field"><Search size={18}/><input aria-label={`Buscar en ${config.title}`} placeholder={person ? 'Buscar por nombre, CI o correo…' : 'Buscar por nombre o datos del registro…'} value={query} onChange={e => { setQuery(e.target.value); setPage(1); }}/></label><select aria-label="Filtrar por estado" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Todos los estados</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select><button className="icon-btn filter-clear" aria-label="Limpiar filtros" onClick={resetFilters}><ListFilter size={19}/></button></div>
      <div className="table-scroll"><table className="catalog-table"><thead><tr><th>{person ? 'Nombre completo' : 'Nombre'}</th>{config.fields.map(f => <th key={f.key}>{f.label}</th>)}<th>Estado</th><th className="actions-th">Acciones</th></tr></thead><tbody>
        {visible.map(record => <tr key={record.id}><td><strong className="catalog-name">{record.name}</strong></td>{config.fields.map(f => <td key={f.key}><span className="catalog-value">{record.fields[f.key] || '—'}</span></td>)}<td><span className={`status ${record.active ? 'active' : ''}`}><i/>{record.active ? 'Activo' : 'Inactivo'}</span></td><td><div className="row-actions"><button className="icon-btn" title="Ver detalle" aria-label={`Ver ${record.name}`} onClick={() => setDetail(record)}><Eye size={17}/></button><button className="icon-btn" title="Editar" aria-label={`Editar ${record.name}`} onClick={() => setEditing(record)}><Pencil size={16}/></button><button className="icon-btn" title={record.active ? 'Inactivar' : 'Activar'} aria-label={`${record.active ? 'Inactivar' : 'Activar'} ${record.name}`} onClick={() => { setError(''); setToggle(record); }}><Settings2 size={17}/></button>{user.role === 'ADMINISTRADOR' && <button type="button" className="icon-btn catalog-delete" title="Eliminar" aria-label={`Eliminar ${record.name}`} onClick={() => { setError(''); setDeleting(record); }}><Trash2 size={17}/></button>}</div></td></tr>)}
      </tbody></table></div>
      {!visible.length && <div className="no-results catalog-empty"><FolderOpen size={34}/><h3>{records.length ? 'No se encontraron coincidencias' : `Todavía no hay registros en ${config.title.toLocaleLowerCase('es')}`}</h3><p>{records.length ? 'Probá otra búsqueda o limpiá los filtros.' : 'Agregá el primer registro para comenzar a organizar este catálogo.'}</p><button className="secondary" onClick={records.length ? resetFilters : () => setEditing('new')}>{records.length ? 'Limpiar filtros' : config.createLabel}</button></div>}
      <div className="table-footer"><span>{filtered.length ? `Mostrando ${(current - 1) * 8 + 1}–${Math.min(current * 8, filtered.length)} de ${filtered.length} registros` : '0 registros'}</span><div className="pagination"><button className="icon-btn" aria-label="Página anterior" disabled={current === 1} onClick={() => setPage(current - 1)}><ChevronLeft size={18}/></button><span>{current} / {pages}</span><button className="icon-btn" aria-label="Página siguiente" disabled={current === pages} onClick={() => setPage(current + 1)}><ChevronRight size={18}/></button></div></div>
    </section>
    <div className="inline-note"><ShieldCheck size={18}/><p>La inactivación conserva la información y puede revertirse. Los nombres y los identificadores no deben repetirse dentro del catálogo.</p></div>
    {deleting && <CatalogDialog title="Eliminar registro" close={() => setDeleting(null)}>
      <div className="modal-body">
        {error && <div className="alert" role="alert">{error}</div>}
        <p>¿Querés eliminar definitivamente <strong>{deleting.name}</strong>?</p>
        <p className="muted catalog-confirm-note">Esta acción no se puede deshacer. Solo se permite si el registro no está vinculado a investigaciones.</p>
      </div>
      <div className="modal-footer">
        <button type="button" className="secondary" onClick={() => setDeleting(null)}>Cancelar</button>
        <button type="button" className="primary" onClick={() => {
          try {
            // Paso 1 y 2: el servicio exige Administrador y ausencia de referencias.
            const updatedState = deleteCatalogRecord(state, user.id, catalog, deleting.id);
            // Paso 3: confirmar el guardado antes de comunicar la eliminación.
            commit(updatedState);
            notify('Registro eliminado.');
            setDeleting(null);
          } catch (caught) {
            setError(message(caught));
          }
        }}>Eliminar definitivamente</button>
      </div>
    </CatalogDialog>}
    {editing && <CatalogForm catalog={catalog} state={state} user={user} editing={editing} commit={commit} notify={notify} close={() => setEditing(null)}/>}
    {detail && <CatalogDialog title={`Detalle de ${config.singular}`} close={() => setDetail(null)}><div className="catalog-detail-heading"><h3>{detail.name}</h3><span className={`badge ${detail.active ? 'blue' : 'neutral'}`}>{detail.active ? 'Activo' : 'Inactivo'}</span></div><dl className="details">{[...config.fields.map(f => [f.label, detail.fields[f.key] || 'Sin registrar']), ['Fecha de registro', new Date(detail.createdAt).toLocaleString('es-PY')], ['Última modificación', new Date(detail.updatedAt).toLocaleString('es-PY')]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><div className="modal-footer"><button className="secondary" onClick={() => setDetail(null)}>Cerrar</button></div></CatalogDialog>}
    {toggle && <CatalogDialog title={toggle.active ? 'Inactivar registro' : 'Activar registro'} close={() => setToggle(null)}><div className="modal-body">{error && <div className="alert" role="alert">{error}</div>}<p>¿Querés {toggle.active ? 'inactivar' : 'activar'} <strong>{toggle.name}</strong>?</p><p className="muted catalog-confirm-note">{toggle.active ? 'Sus datos seguirán disponibles para consulta y podrás volver a activarlo.' : 'El registro volverá a estar activo en este catálogo.'}</p></div><div className="modal-footer"><button className="secondary" onClick={() => setToggle(null)}>Cancelar</button><button className="primary" onClick={() => { try { commit(setCatalogActive(state, user.id, catalog, toggle.id, !toggle.active)); notify(toggle.active ? 'Registro inactivado.' : 'Registro activado.'); setToggle(null); } catch (e) { setError(message(e)); } }}>Confirmar</button></div></CatalogDialog>}
  </>;
}

function CatalogForm({ catalog, state, user, editing, commit, notify, close }: { catalog: CatalogKey; state: State; user: User; editing: CatalogRecord | 'new'; commit: (s: State) => void; notify: (s: string) => void; close: () => void }) {
  const config = catalogConfig[catalog];
  const record = editing === 'new' ? null : editing;
  const [error, setError] = useState('');
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    try {
      commit(saveCatalogRecord(state, user.id, catalog, { name: String(values.get('name') || ''), fields: Object.fromEntries(config.fields.map(f => [f.key, String(values.get(f.key) || '')])) }, record?.id));
      notify(record ? 'Registro actualizado.' : 'Registro creado.');
      close();
    } catch (e) { setError(message(e)); }
  }
  return <CatalogDialog title={record ? `Editar ${config.singular}` : config.createLabel} close={close}><form onSubmit={submit}><div className="modal-body">
    {error && <div className="alert" role="alert">{error}</div>}<p className="muted">El nombre es obligatorio. Los demás campos son opcionales.</p>
    <label className="field"><span>{catalog === 'autores' || catalog === 'tutores' ? 'Nombre completo *' : 'Nombre *'}</span><input name="name" required maxLength={150} defaultValue={record?.name} autoFocus autoComplete="off"/></label>
    {config.fields.map(field => <label key={field.key} className="field"><span>{field.label}</span>{field.key === 'descripcion' ? <textarea name={field.key} maxLength={field.maxLength} defaultValue={record?.fields[field.key]} rows={3}/> : <input name={field.key} type={field.type || 'text'} inputMode={field.key === 'ci' ? 'numeric' : undefined} maxLength={field.maxLength} placeholder={field.placeholder} defaultValue={record?.fields[field.key]} autoComplete="off"/>}</label>)}
    {record && !record.active && <p className="inline-hint">Este registro está inactivo. Editarlo conserva su estado; podés activarlo desde el listado.</p>}
  </div><div className="modal-footer"><button type="button" className="secondary" onClick={close}>Cancelar</button><button className="primary">{record ? 'Guardar cambios' : 'Crear registro'}<Check size={17}/></button></div></form></CatalogDialog>;
}

export function RolesPage() {
  const permissions = [
    ['Usuarios y catálogos administrativos', true, false, false],
    ['Autores y tutores', true, true, false],
    ['Consulta de publicaciones', true, true, true],
    ['Carga y edición de publicaciones', true, true, false],
    ['Descarga de adjuntos', true, true, false],
    ['Inactivación de publicaciones', true, false, false],
    ['Reportes y auditoría', true, false, false],
    ['Perfil, contraseña y cierre de sesión', true, true, true],
  ] as const;
  return <><div className="page-heading"><div><p className="eyebrow">Administración / Acceso</p><h1>Roles y permisos</h1><p>Consultá las responsabilidades de los tres roles del sistema.</p></div><span className="badge neutral">Solo consulta</span></div><section className="panel"><div className="panel-heading"><div><h2>Matriz de permisos</h2><p>Permisos definidos para el proyecto. Los módulos pendientes se completarán en próximas entregas.</p></div><ShieldCheck/></div><div className="table-scroll"><table className="catalog-table"><thead><tr><th>Función</th><th>Administrador</th><th>Digitador</th><th>Público</th></tr></thead><tbody>{permissions.map(([label, ...values]) => <tr key={label}><td>{label}</td>{values.map((yes, i) => <td key={i}><span className={`badge ${yes ? 'blue' : 'neutral'}`}>{yes ? 'Permitido' : 'Sin acceso'}</span></td>)}</tr>)}</tbody></table></div></section><div className="inline-note"><ShieldCheck size={18}/><p>Asigná uno de estos roles desde Usuarios. Sus permisos están definidos por los requerimientos del proyecto.</p></div></>;
}
