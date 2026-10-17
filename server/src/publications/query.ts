import { Prisma, type Role } from '@prisma/client';
import { AppError } from '../errors.js';
import { normalizeCatalog } from '../catalogs/schemas.js';
import { publicationNumber, type PublicationQuery } from './schemas.js';

export function publicationWhere(query: PublicationQuery, role: Role): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (role !== 'ADMINISTRADOR') {
    if (query.active === false) throw new AppError(403, 'FORBIDDEN', 'Solo Administrador puede consultar publicaciones inactivas.');
    conditions.push(Prisma.sql`p.activo = true`);
  } else if (query.active !== undefined) conditions.push(Prisma.sql`p.activo = ${query.active}`);
  const columns = { careerId: 'carrera_id', levelId: 'nivel_id', typeId: 'tipo_id', branchId: 'filial_id' } as const;
  for (const key of Object.keys(columns) as (keyof typeof columns)[]) if (query[key]) conditions.push(Prisma.sql`p.${Prisma.raw(columns[key])} = ${query[key]}::uuid`);
  if (query.authorId) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM public.publicacion_autores pa WHERE pa.publicacion_id = p.id AND pa.autor_id = ${query.authorId}::uuid)`);
  if (query.tutorId) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM public.publicacion_tutores pt WHERE pt.publicacion_id = p.id AND pt.tutor_id = ${query.tutorId}::uuid)`);
  for (const [term, relation, person, foreign] of [[query.author, 'publicacion_autores', 'autores', 'autor_id'], [query.tutor, 'publicacion_tutores', 'tutores', 'tutor_id']] as const) {
    if (term) { const pattern = '%' + normalizeCatalog(term).replace(/[\\%_]/g, '\\  if (query.year !== undefined)') + '%'; conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM public.${Prisma.raw(relation)} j JOIN public.${Prisma.raw(person)} person ON person.id=j.${Prisma.raw(foreign)} WHERE j.publicacion_id=p.id AND person.nombre_clave LIKE ${pattern})`); }
  }
  if (query.year !== undefined) conditions.push(Prisma.sql`p.anio = ${query.year}`);
  if (query.source) conditions.push(Prisma.sql`p.origen = ${query.source}::public.origen_publicacion`);
  if (query.code) conditions.push(Prisma.sql`p.numero = ${publicationNumber(query.code)!}`);
  // Inclusive institutional calendar dates, expressed as an indexed timestamp range.
  if (query.from) conditions.push(Prisma.sql`p.creado_en >= (${query.from}::date::timestamp AT TIME ZONE 'America/Asuncion')`);
  if (query.to) conditions.push(Prisma.sql`p.creado_en < ((${query.to}::date + 1)::timestamp AT TIME ZONE 'America/Asuncion')`);
  if (query.search) {
    const term = query.search;
    const normalizedTerm = Prisma.sql`public.publication_search_text(${term})`;
    const tsquery = Prisma.sql`(plainto_tsquery('spanish'::regconfig, ${normalizedTerm}) || plainto_tsquery('english'::regconfig, ${normalizedTerm}) || plainto_tsquery('simple'::regconfig, ${normalizedTerm}))`;
    const code = publicationNumber(term);
    // Independent indexed branches avoid a correlated OR forcing a full scan
    // of every publication document. UNION deduplicates multiple participants.
    conditions.push(Prisma.sql`p.id IN (
      SELECT d.id FROM public.publicaciones d
        WHERE public.publication_search_document(d.titulo, d.resumen, d.abstract, d.palabras_clave) @@ ${tsquery}
      UNION SELECT pa.publicacion_id FROM public.publicacion_autores pa JOIN public.autores a ON a.id = pa.autor_id
        WHERE public.publication_person_document(a.nombre_completo) @@ ${tsquery}
      UNION SELECT pt.publicacion_id FROM public.publicacion_tutores pt JOIN public.tutores t ON t.id = pt.tutor_id
        WHERE public.publication_person_document(t.nombre_completo) @@ ${tsquery}
      ${code === undefined ? Prisma.empty : Prisma.sql`UNION SELECT cp.id FROM public.publicaciones cp WHERE cp.numero = ${code}`}
    )`);
  }
  return conditions.length ? Prisma.join(conditions, ' AND ') : Prisma.sql`true`;
}
