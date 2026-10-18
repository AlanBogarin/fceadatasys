# Datos de prueba antiguos y nuevos — 18/10/2026

Captura de PostgreSQL: 2026-10-18T11:06:32.450041-03:00. Base: `fceadatasys_client_connection_test`, puerto 55439. Consulta con rol runtime en una transacción de solo lectura.

El conjunto antiguo muestra las muestras predefinidas del simulador, reconstruidas en memoria desde el código. No es un volcado del localStorage de tu navegador: cualquier edición o registro propio guardado allí puede diferir. El conjunto nuevo es el contenido actual de la base aislada de integración; incluye fixtures acumulados de varias ejecuciones y operaciones manuales de QA. Ambos conjuntos son de demostración/pruebas.

Se presentan usuarios, nombres, estados y metadatos bibliográficos. No se incluyen hashes de contraseñas, tokens, sesiones privadas ni claves de almacenamiento.

## Comparación general

| Dato | Simulador: muestras predefinidas | API: base de integración |
| --- | --- | --- |
| Usuarios | 3 | 75 (59 activos) |
| Autores | 14 | 35 |
| Tutores | 12 | 19 |
| Otros catálogos: carreras, facultades, filiales, tipos y niveles | 19 | 77 |
| Publicaciones | 8 | 28 (10 activas) |
| Archivos | 8 PDF estáticos enlazados desde las muestras | 17 adjuntos registrados |
| Auditoría | Eventos locales según uso del navegador | 3834 eventos inmutables |
| Persistencia | localStorage/IndexedDB del navegador | PostgreSQL y almacenamiento privado del servidor |

## 1. Datos antiguos del simulador

### Cuentas iniciales

| Usuario | Nombre | Rol | Estado |
| --- | --- | --- | --- |
| admin | Administrador de demostración | ADMINISTRADOR | Activo |
| digitador | Digitador de demostración | DIGITADOR | Activo |
| publico | Lector de demostración | PUBLICO | Activo |

### Las ocho publicaciones de demostración

| Código en una instalación nueva | Título | Autores | Tutor | Carrera | Documento estático |
| --- | --- | --- | --- | --- | --- |
| INV-00001 | Educación financiera y hábitos de ahorro de estudiantes universitarios — Demostración | Lucía Benítez (demo); Mateo Acosta (demo) | Laura Martínez (demo) | Ingeniería Comercial (demo) | /demo/investigacion-01.pdf |
| INV-00002 | Digitalización de procesos en microemprendimientos comerciales — Demostración | Mateo Acosta (demo); Camila Rojas (demo) | Andrés Giménez (demo) | Licenciatura en Administración (demo) | /demo/investigacion-02.pdf |
| INV-00003 | Costos de producción y rentabilidad en pequeños negocios — Demostración | Camila Rojas (demo); Bruno Villalba (demo) | Carolina Sosa (demo) | Contaduría Pública (demo) | /demo/investigacion-03.pdf |
| INV-00004 | Inclusión financiera en comunidades rurales — Demostración | Bruno Villalba (demo); Sofía Cabrera (demo) | Gabriel Paredes (demo) | Ingeniería Comercial (demo) | /demo/investigacion-04.pdf |
| INV-00005 | Clima laboral y desempeño en organizaciones locales — Demostración | Sofía Cabrera (demo); Nicolás Vera (demo) | Daniela Aquino (demo) | Licenciatura en Administración (demo) | /demo/investigacion-05.pdf |
| INV-00006 | Comercio electrónico y preferencias de consumo juvenil — Demostración | Nicolás Vera (demo); Valentina Duarte (demo) | Sebastián Leiva (demo) | Ingeniería en Informática Empresarial (demo) | /demo/investigacion-06.pdf |
| INV-00007 | Presupuesto familiar y planificación del gasto — Demostración | Valentina Duarte (demo); Diego González (demo) | Patricia Franco (demo) | Contaduría Pública (demo) | /demo/investigacion-07.pdf |
| INV-00008 | Emprendimiento sostenible y desarrollo económico local — Demostración | Diego González (demo); Martina López (demo) | Miguel Espínola (demo) | Licenciatura en Administración (demo) | /demo/investigacion-08.pdf |

### autores

| Nombre | Estado |
| --- | --- |
| Lucía Benítez (demo) | Activo |
| Mateo Acosta (demo) | Activo |
| Camila Rojas (demo) | Activo |
| Bruno Villalba (demo) | Activo |
| Sofía Cabrera (demo) | Activo |
| Nicolás Vera (demo) | Activo |
| Valentina Duarte (demo) | Activo |
| Diego González (demo) | Activo |
| Martina López (demo) | Activo |
| Tomás Fernández (demo) | Activo |
| Emilia Gómez (demo) | Activo |
| Joaquín Ortiz (demo) | Activo |
| Paula Méndez (demo) | Activo |
| Agustín Núñez (demo) | Inactivo |

### tutores

| Nombre | Estado |
| --- | --- |
| Laura Martínez (demo) | Activo |
| Andrés Giménez (demo) | Activo |
| Carolina Sosa (demo) | Activo |
| Gabriel Paredes (demo) | Activo |
| Daniela Aquino (demo) | Activo |
| Sebastián Leiva (demo) | Activo |
| Patricia Franco (demo) | Activo |
| Miguel Espínola (demo) | Activo |
| Adriana Cáceres (demo) | Activo |
| Hugo Valdez (demo) | Activo |
| Claudia Ramírez (demo) | Activo |
| Ricardo Ayala (demo) | Inactivo |

### carreras

| Nombre | Estado |
| --- | --- |
| Licenciatura en Administración (demo) | Activo |
| Contaduría Pública (demo) | Activo |
| Ingeniería Comercial (demo) | Activo |
| Ingeniería en Informática Empresarial (demo) | Activo |

### facultades

| Nombre | Estado |
| --- | --- |
| Facultad de Ciencias Económicas y Administrativas (demo) | Activo |
| Facultad de Humanidades y Ciencias de la Educación (demo) | Activo |
| Facultad de Ciencias Agrarias (demo) | Activo |
| Facultad de Ciencias Exactas y Tecnológicas (demo) | Activo |
| Facultad de Medicina (demo) | Activo |
| Facultad de Odontología (demo) | Activo |

### filiales

| Nombre | Estado |
| --- | --- |
| Sede Concepción (demo) | Activo |
| Filial Horqueta (demo) | Activo |

### tipos

| Nombre | Estado |
| --- | --- |
| Trabajo de grado (demo) | Activo |
| Artículo científico (demo) | Activo |
| Monografía (demo) | Activo |
| Proyecto de investigación (demo) | Activo |

### niveles

| Nombre | Estado |
| --- | --- |
| Grado (demo) | Activo |
| Especialización (demo) | Activo |
| Maestría (demo) | Activo |

### Denominaciones institucionales heredadas del simulador

El código conserva además estos nombres para reconocer y corregir muestras generadas por versiones anteriores. No son el catálogo inicial actualizado anterior.

| Catálogo | Denominación heredada |
| --- | --- |
| carreras | Administración de Empresas (demo) |
| carreras | Contaduría Pública (demo) |
| carreras | Economía (demo) |
| carreras | Comercio Internacional (demo) |
| facultades | Facultad de Ciencias Económicas y Administrativas (demo) |
| facultades | Facultad de Estudios Sociales (demo) |
| filiales | Sede Central de Concepción (demo) |
| filiales | Filial Norte (demo) |
| filiales | Filial Sur (demo) |

## 2. Datos nuevos de API/PostgreSQL

### Todas las cuentas actuales

| Usuario | Nombre | Rol | Estado |
| --- | --- | --- | --- |
| integration-admin | Administrador integración cliente | ADMINISTRADOR | Activo |
| catalog-digitador-881703d2 | DIGITADOR catálogos | DIGITADOR | Activo |
| catalog-digitador-aae91fac | DIGITADOR catálogos | DIGITADOR | Activo |
| catalog-digitador-ae19e64f | DIGITADOR catálogos | DIGITADOR | Activo |
| catalog-digitador-f0898f0e | DIGITADOR catálogos | DIGITADOR | Activo |
| catalog-digitador-fc3e37e4 | DIGITADOR catálogos | DIGITADOR | Activo |
| cierre.digitador.78b5cd83 | Cierre DIGITADOR | DIGITADOR | Activo |
| cierre.digitador.c07843ab | Cierre DIGITADOR | DIGITADOR | Activo |
| digitador-1b95cc4d | Digitador actualizado | DIGITADOR | Activo |
| digitador-2ef37438 | Digitador actualizado | DIGITADOR | Activo |
| digitador-34b2a520 | Digitador actualizado | DIGITADOR | Activo |
| digitador-5c6cf0ef | Digitador actualizado | DIGITADOR | Activo |
| digitador-7e10dab6 | Digitador actualizado | DIGITADOR | Activo |
| digitador-80148882 | Digitador actualizado | DIGITADOR | Activo |
| digitador-8801995c | Digitador actualizado | DIGITADOR | Activo |
| digitador-957f12fb | Digitador actualizado | DIGITADOR | Activo |
| digitador-ac3960a3 | Digitador actualizado | DIGITADOR | Activo |
| digitador-c02a05b1 | Digitador actualizado | DIGITADOR | Activo |
| digitador-cb22bc64 | Digitador actualizado | DIGITADOR | Activo |
| mail-1b95cc4d | Recuperación correo | DIGITADOR | Activo |
| mail-34b2a520 | Recuperación correo | DIGITADOR | Activo |
| mail-5c6cf0ef | Recuperación correo | DIGITADOR | Activo |
| mail-7e10dab6 | Recuperación correo | DIGITADOR | Activo |
| mail-80148882 | Recuperación correo | DIGITADOR | Activo |
| mail-8801995c | Recuperación correo | DIGITADOR | Activo |
| mail-957f12fb | Recuperación correo | DIGITADOR | Activo |
| mail-ac3960a3 | Recuperación correo | DIGITADOR | Activo |
| mail-c02a05b1 | Recuperación correo | DIGITADOR | Activo |
| mail-cb22bc64 | Recuperación correo | DIGITADOR | Activo |
| pub.30485c6d.0 | Publicaciones DIGITADOR 30485c6d | DIGITADOR | Activo |
| pub.30485c6d.1 | Publicaciones DIGITADOR 30485c6d | DIGITADOR | Activo |
| pub.8a13ec21.0 | Publicaciones DIGITADOR 8a13ec21 | DIGITADOR | Activo |
| pub.8a13ec21.1 | Publicaciones DIGITADOR 8a13ec21 | DIGITADOR | Activo |
| pub.b3174d72.0 | Publicaciones DIGITADOR b3174d72 | DIGITADOR | Activo |
| pub.b3174d72.1 | Publicaciones DIGITADOR b3174d72 | DIGITADOR | Activo |
| pub.fccd8506.0 | Publicaciones DIGITADOR fccd8506 | DIGITADOR | Activo |
| pub.fccd8506.1 | Publicaciones DIGITADOR fccd8506 | DIGITADOR | Activo |
| catalog-publico-881703d2 | PUBLICO catálogos | PUBLICO | Activo |
| catalog-publico-aae91fac | PUBLICO catálogos | PUBLICO | Activo |
| catalog-publico-ae19e64f | PUBLICO catálogos | PUBLICO | Activo |
| catalog-publico-f0898f0e | PUBLICO catálogos | PUBLICO | Activo |
| catalog-publico-fc3e37e4 | PUBLICO catálogos | PUBLICO | Activo |
| cierre.publico.78b5cd83 | Cierre PUBLICO | PUBLICO | Activo |
| cierre.publico.c07843ab | Cierre PUBLICO | PUBLICO | Activo |
| inactive-34b2a520 | Correo inactivo | PUBLICO | Inactivo |
| inactive-7e10dab6 | Correo inactivo | PUBLICO | Inactivo |
| inactive-80148882 | Correo inactivo | PUBLICO | Inactivo |
| inactive-957f12fb | Correo inactivo | PUBLICO | Inactivo |
| inactive-c02a05b1 | Correo inactivo | PUBLICO | Inactivo |
| inactive-cb22bc64 | Correo inactivo | PUBLICO | Inactivo |
| managed-1b95cc4d | Cambio administrativo | PUBLICO | Inactivo |
| managed-34b2a520 | Cambio administrativo | PUBLICO | Inactivo |
| managed-5c6cf0ef | Cambio administrativo | PUBLICO | Inactivo |
| managed-7e10dab6 | Cambio administrativo | PUBLICO | Inactivo |
| managed-80148882 | Cambio administrativo | PUBLICO | Inactivo |
| managed-8801995c | Cambio administrativo | PUBLICO | Inactivo |
| managed-957f12fb | Cambio administrativo | PUBLICO | Inactivo |
| managed-ac3960a3 | Cambio administrativo | PUBLICO | Inactivo |
| managed-c02a05b1 | Cambio administrativo | PUBLICO | Inactivo |
| managed-cb22bc64 | Cambio administrativo | PUBLICO | Inactivo |
| pub.30485c6d.2 | Publicaciones PUBLICO 30485c6d | PUBLICO | Activo |
| pub.8a13ec21.2 | Publicaciones PUBLICO 8a13ec21 | PUBLICO | Activo |
| pub.b3174d72.2 | Publicaciones PUBLICO b3174d72 | PUBLICO | Activo |
| pub.fccd8506.2 | Publicaciones PUBLICO fccd8506 | PUBLICO | Activo |
| publico-1b95cc4d | Público integración | PUBLICO | Activo |
| publico-2ef37438 | Público integración | PUBLICO | Activo |
| publico-34b2a520 | Público integración | PUBLICO | Activo |
| publico-5c6cf0ef | Público integración | PUBLICO | Activo |
| publico-7e10dab6 | Público integración | PUBLICO | Activo |
| publico-80148882 | Público integración | PUBLICO | Activo |
| publico-8801995c | Público integración | PUBLICO | Activo |
| publico-957f12fb | Público integración | PUBLICO | Activo |
| publico-ac3960a3 | Público integración | PUBLICO | Activo |
| publico-c02a05b1 | Público integración | PUBLICO | Activo |
| publico-cb22bc64 | Público integración | PUBLICO | Activo |

### Todas las publicaciones actuales

| Código | Título | Estado | Origen | Archivo | Creador |
| --- | --- | --- | --- | --- | --- |
| INV-00001 | Investigación fixture cliente 8801995c | Activo | EXTERNA | — | integration-admin |
| INV-00002 | Investigación fixture cliente 5c6cf0ef | Inactivo | EXTERNA | — | integration-admin |
| INV-00003 | Investigación fixture cliente 1b95cc4d | Inactivo | EXTERNA | — | integration-admin |
| INV-00004 | Investigación fixture cliente ac3960a3 | Inactivo | EXTERNA | — | integration-admin |
| INV-00005 | Investigación fixture cliente 957f12fb | Inactivo | EXTERNA | — | integration-admin |
| INV-00006 | Investigación fixture cliente cb22bc64 | Inactivo | EXTERNA | — | integration-admin |
| INV-00007 | Publicación clasificaciones cliente aae91fac | Inactivo | EXTERNA | — | integration-admin |
| INV-00008 | Investigación fixture cliente 80148882 | Inactivo | EXTERNA | — | integration-admin |
| INV-00009 | Publicación clasificaciones cliente 881703d2 | Inactivo | EXTERNA | — | integration-admin |
| INV-00010 | Economía regional conexión 30485c6d 5 corregida | Inactivo | LOCAL | Investigación 30485c6d 0.pdf | pub.30485c6d.0 |
| INV-00011 | Economía regional conexión 30485c6d 6 | Activo | EXTERNA | — | integration-admin |
| INV-00012 | Economía regional conexión 30485c6d 10 | Activo | LOCAL | — | integration-admin |
| INV-00014 | Investigación fixture cliente 34b2a520 | Inactivo | EXTERNA | — | integration-admin |
| INV-00015 | Publicación clasificaciones cliente ae19e64f | Inactivo | EXTERNA | — | integration-admin |
| INV-00016 | Economía regional conexión b3174d72 6 corregida | Inactivo | LOCAL | Investigación b3174d72 0.pdf | pub.b3174d72.0 |
| INV-00017 | Economía regional conexión b3174d72 7 | Activo | EXTERNA | — | integration-admin |
| INV-00018 | Economía regional conexión b3174d72 11 | Activo | LOCAL | — | integration-admin |
| INV-00020 | Economía y ahorro: validación del cliente 16 al 20 | Activo | LOCAL | Validacion-cliente-16-20.pdf | integration-admin |
| INV-00021 | Investigación fixture cliente c02a05b1 | Inactivo | EXTERNA | — | integration-admin |
| INV-00022 | Publicación clasificaciones cliente fc3e37e4 | Inactivo | EXTERNA | — | integration-admin |
| INV-00023 | Economía regional conexión 8a13ec21 6 corregida | Inactivo | LOCAL | Investigación 8a13ec21 0.pdf | pub.8a13ec21.0 |
| INV-00024 | Economía regional conexión 8a13ec21 7 | Activo | EXTERNA | — | integration-admin |
| INV-00025 | Economía regional conexión 8a13ec21 11 | Activo | LOCAL | — | integration-admin |
| INV-00027 | Investigación fixture cliente 7e10dab6 | Inactivo | EXTERNA | — | integration-admin |
| INV-00028 | Publicación clasificaciones cliente f0898f0e | Inactivo | EXTERNA | — | integration-admin |
| INV-00029 | Economía regional conexión fccd8506 6 corregida | Inactivo | LOCAL | Investigación fccd8506 0.pdf | pub.fccd8506.0 |
| INV-00030 | Economía regional conexión fccd8506 7 | Activo | EXTERNA | — | integration-admin |
| INV-00031 | Economía regional conexión fccd8506 11 | Activo | LOCAL | — | integration-admin |

### Metadatos de las publicaciones

**INV-00001 — Investigación fixture cliente 8801995c**

- Autores: Autor vinculado 8801995c
- Tutores: Tutor vinculado 8801995c
- Clasificaciones: carreras fixture 8801995c · niveles fixture 8801995c · tipos fixture 8801995c · filiales fixture 8801995c
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/research

**INV-00002 — Investigación fixture cliente 5c6cf0ef**

- Autores: Autor vinculado 5c6cf0ef
- Tutores: Tutor vinculado 5c6cf0ef
- Clasificaciones: carreras fixture 5c6cf0ef · niveles fixture 5c6cf0ef · tipos fixture 5c6cf0ef · filiales fixture 5c6cf0ef
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/research

**INV-00003 — Investigación fixture cliente 1b95cc4d**

- Autores: Autor vinculado 1b95cc4d
- Tutores: Tutor vinculado 1b95cc4d
- Clasificaciones: carreras fixture 1b95cc4d · niveles fixture 1b95cc4d · tipos fixture 1b95cc4d · filiales fixture 1b95cc4d
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/research

**INV-00004 — Investigación fixture cliente ac3960a3**

- Autores: Autor vinculado ac3960a3
- Tutores: Tutor vinculado ac3960a3
- Clasificaciones: carreras fixture ac3960a3 · niveles fixture ac3960a3 · tipos fixture ac3960a3 · filiales fixture ac3960a3
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/research

**INV-00005 — Investigación fixture cliente 957f12fb**

- Autores: Autor vinculado 957f12fb
- Tutores: Tutor vinculado 957f12fb
- Clasificaciones: carreras fixture 957f12fb · niveles fixture 957f12fb · tipos fixture 957f12fb · filiales fixture 957f12fb
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/research

**INV-00006 — Investigación fixture cliente cb22bc64**

- Autores: Autor vinculado cb22bc64
- Tutores: Tutor vinculado cb22bc64
- Clasificaciones: carreras fixture cb22bc64 · niveles fixture cb22bc64 · tipos fixture cb22bc64 · filiales fixture cb22bc64
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/research

**INV-00007 — Publicación clasificaciones cliente aae91fac**

- Autores: Autor clasificaciones aae91fac
- Tutores: Tutor clasificaciones aae91fac
- Clasificaciones: carreras publicación aae91fac · niveles publicación aae91fac · tipos publicación aae91fac · filiales publicación aae91fac
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/classification

**INV-00008 — Investigación fixture cliente 80148882**

- Autores: Autor vinculado 80148882
- Tutores: Tutor vinculado 80148882
- Clasificaciones: carreras fixture 80148882 · niveles fixture 80148882 · tipos fixture 80148882 · filiales fixture 80148882
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/research

**INV-00009 — Publicación clasificaciones cliente 881703d2**

- Autores: Autor clasificaciones 881703d2
- Tutores: Tutor clasificaciones 881703d2
- Clasificaciones: carreras publicación 881703d2 · niveles publicación 881703d2 · tipos publicación 881703d2 · filiales publicación 881703d2
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/classification

**INV-00010 — Economía regional conexión 30485c6d 5 corregida**

- Autores: Conexión publicaciones autores 30485c6d; Coautor ordenado 30485c6d
- Tutores: Conexión publicaciones tutores 30485c6d
- Clasificaciones: Conexión publicaciones carreras 30485c6d · Conexión publicaciones niveles 30485c6d · Conexión publicaciones tipos 30485c6d · Conexión publicaciones filiales 30485c6d
- Año: 2026. Copia de Biblioteca obligatoria: sí.
- URL externa: No corresponde.

**INV-00011 — Economía regional conexión 30485c6d 6**

- Autores: Coautor ordenado 30485c6d; Conexión publicaciones autores 30485c6d
- Tutores: Conexión publicaciones tutores 30485c6d
- Clasificaciones: Conexión publicaciones carreras 30485c6d · Conexión publicaciones niveles 30485c6d · Conexión publicaciones tipos 30485c6d · Conexión publicaciones filiales 30485c6d
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/30485c6d-6

**INV-00012 — Economía regional conexión 30485c6d 10**

- Autores: Coautor ordenado 30485c6d; Conexión publicaciones autores 30485c6d
- Tutores: Conexión publicaciones tutores 30485c6d
- Clasificaciones: Conexión publicaciones carreras 30485c6d · Conexión publicaciones niveles 30485c6d · Conexión publicaciones tipos 30485c6d · Conexión publicaciones filiales 30485c6d
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: No corresponde.

**INV-00014 — Investigación fixture cliente 34b2a520**

- Autores: Autor vinculado 34b2a520
- Tutores: Tutor vinculado 34b2a520
- Clasificaciones: carreras fixture 34b2a520 · niveles fixture 34b2a520 · tipos fixture 34b2a520 · filiales fixture 34b2a520
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/research

**INV-00015 — Publicación clasificaciones cliente ae19e64f**

- Autores: Autor clasificaciones ae19e64f
- Tutores: Tutor clasificaciones ae19e64f
- Clasificaciones: carreras publicación ae19e64f · niveles publicación ae19e64f · tipos publicación ae19e64f · filiales publicación ae19e64f
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/classification

**INV-00016 — Economía regional conexión b3174d72 6 corregida**

- Autores: Conexión publicaciones autores b3174d72; Coautor ordenado b3174d72
- Tutores: Conexión publicaciones tutores b3174d72
- Clasificaciones: Conexión publicaciones carreras b3174d72 · Conexión publicaciones niveles b3174d72 · Conexión publicaciones tipos b3174d72 · Conexión publicaciones filiales b3174d72
- Año: 2026. Copia de Biblioteca obligatoria: sí.
- URL externa: No corresponde.

**INV-00017 — Economía regional conexión b3174d72 7**

- Autores: Coautor ordenado b3174d72; Conexión publicaciones autores b3174d72
- Tutores: Conexión publicaciones tutores b3174d72
- Clasificaciones: Conexión publicaciones carreras b3174d72 · Conexión publicaciones niveles b3174d72 · Conexión publicaciones tipos b3174d72 · Conexión publicaciones filiales b3174d72
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/b3174d72-7

**INV-00018 — Economía regional conexión b3174d72 11**

- Autores: Coautor ordenado b3174d72; Conexión publicaciones autores b3174d72
- Tutores: Conexión publicaciones tutores b3174d72
- Clasificaciones: Conexión publicaciones carreras b3174d72 · Conexión publicaciones niveles b3174d72 · Conexión publicaciones tipos b3174d72 · Conexión publicaciones filiales b3174d72
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: No corresponde.

**INV-00020 — Economía y ahorro: validación del cliente 16 al 20**

- Autores: Conexión publicaciones autores b3174d72
- Tutores: Conexión publicaciones tutores b3174d72
- Clasificaciones: Conexión publicaciones carreras b3174d72 · Conexión publicaciones niveles b3174d72 · Conexión publicaciones tipos b3174d72 · Conexión publicaciones filiales b3174d72
- Año: 2026. Copia de Biblioteca obligatoria: sí.
- URL externa: No corresponde.

**INV-00021 — Investigación fixture cliente c02a05b1**

- Autores: Autor vinculado c02a05b1
- Tutores: Tutor vinculado c02a05b1
- Clasificaciones: carreras fixture c02a05b1 · niveles fixture c02a05b1 · tipos fixture c02a05b1 · filiales fixture c02a05b1
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/research

**INV-00022 — Publicación clasificaciones cliente fc3e37e4**

- Autores: Autor clasificaciones fc3e37e4
- Tutores: Tutor clasificaciones fc3e37e4
- Clasificaciones: carreras publicación fc3e37e4 · niveles publicación fc3e37e4 · tipos publicación fc3e37e4 · filiales publicación fc3e37e4
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/classification

**INV-00023 — Economía regional conexión 8a13ec21 6 corregida**

- Autores: Conexión publicaciones autores 8a13ec21; Coautor ordenado 8a13ec21
- Tutores: Conexión publicaciones tutores 8a13ec21
- Clasificaciones: Conexión publicaciones carreras 8a13ec21 · Conexión publicaciones niveles 8a13ec21 · Conexión publicaciones tipos 8a13ec21 · Conexión publicaciones filiales 8a13ec21
- Año: 2026. Copia de Biblioteca obligatoria: sí.
- URL externa: No corresponde.

**INV-00024 — Economía regional conexión 8a13ec21 7**

- Autores: Coautor ordenado 8a13ec21; Conexión publicaciones autores 8a13ec21
- Tutores: Conexión publicaciones tutores 8a13ec21
- Clasificaciones: Conexión publicaciones carreras 8a13ec21 · Conexión publicaciones niveles 8a13ec21 · Conexión publicaciones tipos 8a13ec21 · Conexión publicaciones filiales 8a13ec21
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/8a13ec21-7

**INV-00025 — Economía regional conexión 8a13ec21 11**

- Autores: Coautor ordenado 8a13ec21; Conexión publicaciones autores 8a13ec21
- Tutores: Conexión publicaciones tutores 8a13ec21
- Clasificaciones: Conexión publicaciones carreras 8a13ec21 · Conexión publicaciones niveles 8a13ec21 · Conexión publicaciones tipos 8a13ec21 · Conexión publicaciones filiales 8a13ec21
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: No corresponde.

**INV-00027 — Investigación fixture cliente 7e10dab6**

- Autores: Autor vinculado 7e10dab6
- Tutores: Tutor vinculado 7e10dab6
- Clasificaciones: carreras fixture 7e10dab6 · niveles fixture 7e10dab6 · tipos fixture 7e10dab6 · filiales fixture 7e10dab6
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/research

**INV-00028 — Publicación clasificaciones cliente f0898f0e**

- Autores: Autor clasificaciones f0898f0e
- Tutores: Tutor clasificaciones f0898f0e
- Clasificaciones: carreras publicación f0898f0e · niveles publicación f0898f0e · tipos publicación f0898f0e · filiales publicación f0898f0e
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/classification

**INV-00029 — Economía regional conexión fccd8506 6 corregida**

- Autores: Conexión publicaciones autores fccd8506; Coautor ordenado fccd8506
- Tutores: Conexión publicaciones tutores fccd8506
- Clasificaciones: Conexión publicaciones carreras fccd8506 · Conexión publicaciones niveles fccd8506 · Conexión publicaciones tipos fccd8506 · Conexión publicaciones filiales fccd8506
- Año: 2026. Copia de Biblioteca obligatoria: sí.
- URL externa: No corresponde.

**INV-00030 — Economía regional conexión fccd8506 7**

- Autores: Coautor ordenado fccd8506; Conexión publicaciones autores fccd8506
- Tutores: Conexión publicaciones tutores fccd8506
- Clasificaciones: Conexión publicaciones carreras fccd8506 · Conexión publicaciones niveles fccd8506 · Conexión publicaciones tipos fccd8506 · Conexión publicaciones filiales fccd8506
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: https://example.test/fccd8506-7

**INV-00031 — Economía regional conexión fccd8506 11**

- Autores: Coautor ordenado fccd8506; Conexión publicaciones autores fccd8506
- Tutores: Conexión publicaciones tutores fccd8506
- Clasificaciones: Conexión publicaciones carreras fccd8506 · Conexión publicaciones niveles fccd8506 · Conexión publicaciones tipos fccd8506 · Conexión publicaciones filiales fccd8506
- Año: 2026. Copia de Biblioteca obligatoria: no.
- URL externa: No corresponde.

### Autores

| Nombre | Estado |
| --- | --- |
| Autor clasificaciones 881703d2 | Activo |
| Autor clasificaciones aae91fac | Activo |
| Autor clasificaciones ae19e64f | Activo |
| Autor clasificaciones f0898f0e | Activo |
| Autor clasificaciones fc3e37e4 | Activo |
| Autor prueba visual versión B | Activo |
| Autor vinculado 1b95cc4d | Inactivo |
| Autor vinculado 34b2a520 | Inactivo |
| Autor vinculado 5c6cf0ef | Inactivo |
| Autor vinculado 7e10dab6 | Inactivo |
| Autor vinculado 80148882 | Inactivo |
| Autor vinculado 8801995c | Activo |
| Autor vinculado 957f12fb | Inactivo |
| Autor vinculado ac3960a3 | Inactivo |
| Autor vinculado c02a05b1 | Inactivo |
| Autor vinculado cb22bc64 | Inactivo |
| Coautor ordenado 30485c6d | Activo |
| Coautor ordenado 8a13ec21 | Activo |
| Coautor ordenado b3174d72 | Activo |
| Coautor ordenado fccd8506 | Activo |
| Conexión publicaciones autores 30485c6d | Activo |
| Conexión publicaciones autores 8a13ec21 | Activo |
| Conexión publicaciones autores b3174d72 | Activo |
| Conexión publicaciones autores fccd8506 | Activo |
| Referencia histórica 1b95cc4d | Activo |
| Referencia histórica 2ef37438 | Activo |
| Referencia histórica 34b2a520 | Activo |
| Referencia histórica 5c6cf0ef | Activo |
| Referencia histórica 7e10dab6 | Activo |
| Referencia histórica 80148882 | Activo |
| Referencia histórica 8801995c | Activo |
| Referencia histórica 957f12fb | Activo |
| Referencia histórica ac3960a3 | Activo |
| Referencia histórica c02a05b1 | Activo |
| Referencia histórica cb22bc64 | Activo |

### Tutores

| Nombre | Estado |
| --- | --- |
| Conexión publicaciones tutores 30485c6d | Activo |
| Conexión publicaciones tutores 8a13ec21 | Activo |
| Conexión publicaciones tutores b3174d72 | Activo |
| Conexión publicaciones tutores fccd8506 | Activo |
| Tutor clasificaciones 881703d2 | Activo |
| Tutor clasificaciones aae91fac | Activo |
| Tutor clasificaciones ae19e64f | Activo |
| Tutor clasificaciones f0898f0e | Activo |
| Tutor clasificaciones fc3e37e4 | Activo |
| Tutor vinculado 1b95cc4d | Inactivo |
| Tutor vinculado 34b2a520 | Inactivo |
| Tutor vinculado 5c6cf0ef | Inactivo |
| Tutor vinculado 7e10dab6 | Inactivo |
| Tutor vinculado 80148882 | Inactivo |
| Tutor vinculado 8801995c | Activo |
| Tutor vinculado 957f12fb | Inactivo |
| Tutor vinculado ac3960a3 | Inactivo |
| Tutor vinculado c02a05b1 | Inactivo |
| Tutor vinculado cb22bc64 | Inactivo |

### Otros catálogos

| Catálogo | Nombre | Estado |
| --- | --- | --- |
| carreras | Conexión publicaciones carreras 30485c6d | Activo |
| carreras | Conexión publicaciones carreras 8a13ec21 | Activo |
| carreras | Conexión publicaciones carreras b3174d72 | Activo |
| carreras | Conexión publicaciones carreras fccd8506 | Activo |
| carreras | carreras fixture 1b95cc4d | Activo |
| carreras | carreras fixture 34b2a520 | Activo |
| carreras | carreras fixture 5c6cf0ef | Activo |
| carreras | carreras fixture 7e10dab6 | Activo |
| carreras | carreras fixture 80148882 | Activo |
| carreras | carreras fixture 8801995c | Activo |
| carreras | carreras fixture 957f12fb | Activo |
| carreras | carreras fixture ac3960a3 | Activo |
| carreras | carreras fixture c02a05b1 | Activo |
| carreras | carreras fixture cb22bc64 | Activo |
| carreras | carreras publicación 881703d2 | Inactivo |
| carreras | carreras publicación aae91fac | Inactivo |
| carreras | carreras publicación ae19e64f | Inactivo |
| carreras | carreras publicación f0898f0e | Inactivo |
| carreras | carreras publicación fc3e37e4 | Inactivo |
| facultades | Facultad de prueba conexión 11–15 | Activo |
| filiales | Conexión publicaciones filiales 30485c6d | Activo |
| filiales | Conexión publicaciones filiales 8a13ec21 | Activo |
| filiales | Conexión publicaciones filiales b3174d72 | Activo |
| filiales | Conexión publicaciones filiales fccd8506 | Activo |
| filiales | filiales fixture 1b95cc4d | Activo |
| filiales | filiales fixture 34b2a520 | Activo |
| filiales | filiales fixture 5c6cf0ef | Activo |
| filiales | filiales fixture 7e10dab6 | Activo |
| filiales | filiales fixture 80148882 | Activo |
| filiales | filiales fixture 8801995c | Activo |
| filiales | filiales fixture 957f12fb | Activo |
| filiales | filiales fixture ac3960a3 | Activo |
| filiales | filiales fixture c02a05b1 | Activo |
| filiales | filiales fixture cb22bc64 | Activo |
| filiales | filiales publicación 881703d2 | Inactivo |
| filiales | filiales publicación aae91fac | Inactivo |
| filiales | filiales publicación ae19e64f | Inactivo |
| filiales | filiales publicación f0898f0e | Inactivo |
| filiales | filiales publicación fc3e37e4 | Inactivo |
| tipos | Conexión publicaciones tipos 30485c6d | Activo |
| tipos | Conexión publicaciones tipos 8a13ec21 | Activo |
| tipos | Conexión publicaciones tipos b3174d72 | Activo |
| tipos | Conexión publicaciones tipos fccd8506 | Activo |
| tipos | tipos fixture 1b95cc4d | Activo |
| tipos | tipos fixture 34b2a520 | Activo |
| tipos | tipos fixture 5c6cf0ef | Activo |
| tipos | tipos fixture 7e10dab6 | Activo |
| tipos | tipos fixture 80148882 | Activo |
| tipos | tipos fixture 8801995c | Activo |
| tipos | tipos fixture 957f12fb | Activo |
| tipos | tipos fixture ac3960a3 | Activo |
| tipos | tipos fixture c02a05b1 | Activo |
| tipos | tipos fixture cb22bc64 | Activo |
| tipos | tipos publicación 881703d2 | Inactivo |
| tipos | tipos publicación aae91fac | Inactivo |
| tipos | tipos publicación ae19e64f | Inactivo |
| tipos | tipos publicación f0898f0e | Inactivo |
| tipos | tipos publicación fc3e37e4 | Inactivo |
| niveles | Conexión publicaciones niveles 30485c6d | Activo |
| niveles | Conexión publicaciones niveles 8a13ec21 | Activo |
| niveles | Conexión publicaciones niveles b3174d72 | Activo |
| niveles | Conexión publicaciones niveles fccd8506 | Activo |
| niveles | niveles fixture 1b95cc4d | Activo |
| niveles | niveles fixture 34b2a520 | Activo |
| niveles | niveles fixture 5c6cf0ef | Activo |
| niveles | niveles fixture 7e10dab6 | Activo |
| niveles | niveles fixture 80148882 | Activo |
| niveles | niveles fixture 8801995c | Activo |
| niveles | niveles fixture 957f12fb | Activo |
| niveles | niveles fixture ac3960a3 | Activo |
| niveles | niveles fixture c02a05b1 | Activo |
| niveles | niveles fixture cb22bc64 | Activo |
| niveles | niveles publicación 881703d2 | Inactivo |
| niveles | niveles publicación aae91fac | Inactivo |
| niveles | niveles publicación ae19e64f | Inactivo |
| niveles | niveles publicación f0898f0e | Inactivo |
| niveles | niveles publicación fc3e37e4 | Inactivo |

### Adjuntos registrados

| Nombre | Bytes | MIME | Estado | Publicación vinculada | Publicación de reserva histórica |
| --- | --- | --- | --- | --- | --- |
| Investigación 30485c6d 0.pdf | 75510 | application/pdf | VINCULADO | INV-00010 | INV-00010 |
| Investigación 30485c6d 2.pdf | 75510 | application/pdf | RECHAZADO | — | — |
| Investigación 30485c6d 3.pdf | 75510 | application/pdf | RESERVADO | — | INV-00010 |
| Investigación 8a13ec21 0.pdf | 75510 | application/pdf | VINCULADO | INV-00023 | INV-00023 |
| Investigación 8a13ec21 2.pdf | 75510 | application/pdf | RECHAZADO | — | — |
| Investigación 8a13ec21 3.pdf | 75510 | application/pdf | RESERVADO | — | INV-00023 |
| Investigación b3174d72 0.pdf | 75510 | application/pdf | VINCULADO | INV-00016 | INV-00016 |
| Investigación b3174d72 2.pdf | 75510 | application/pdf | RECHAZADO | — | — |
| Investigación b3174d72 3.pdf | 75510 | application/pdf | RESERVADO | — | INV-00016 |
| Investigación fccd8506 0.pdf | 75510 | application/pdf | VINCULADO | INV-00029 | INV-00029 |
| Investigación fccd8506 2.pdf | 75510 | application/pdf | RECHAZADO | — | — |
| Investigación fccd8506 3.pdf | 75510 | application/pdf | RESERVADO | — | INV-00029 |
| Notas 30485c6d.txt | 32 | text/plain | DISPONIBLE | — | — |
| Notas 8a13ec21.txt | 32 | text/plain | DISPONIBLE | — | — |
| Notas b3174d72.txt | 32 | text/plain | RESERVADO | — | INV-00020 |
| Notas fccd8506.txt | 32 | text/plain | DISPONIBLE | — | — |
| Validacion-cliente-16-20.pdf | 75510 | application/pdf | VINCULADO | INV-00020 | INV-00020 |

### Auditoría agrupada por operación y resultado

| Operación | Resultado | Cantidad |
| --- | --- | --- |
| ACTIVIDAD_SESION | EXITO | 59 |
| ADJUNTO_CARGADO | EXITO | 13 |
| ADJUNTO_RECHAZADO | FALLIDO | 4 |
| AUDITORIA_EXPORTADA | EXITO | 8 |
| CATALOGO_ACTIVADO | EXITO | 25 |
| CATALOGO_CREADO | EXITO | 258 |
| CATALOGO_ELIMINADO | EXITO | 127 |
| CATALOGO_INACTIVADO | EXITO | 115 |
| CATALOGO_MODIFICADO | EXITO | 49 |
| CONFIRMACION_RECHAZADA | FALLIDO | 41 |
| CONTRASENA_ADMIN_MODIFICADA | EXITO | 10 |
| CONTRASENA_PERSONAL_MODIFICADA | EXITO | 11 |
| CONTRASENA_RESTABLECIDA | EXITO | 10 |
| DESCARGAR_ADJUNTO | EXITO | 10 |
| LOGIN | EXITO | 212 |
| LOGIN | FALLIDO | 53 |
| LOGOUT | EXITO | 71 |
| OPERACION_RECHAZADA | FALLIDO | 2197 |
| PARAMETROS_PUBLICACIONES_MODIFICADOS | EXITO | 30 |
| PERFIL_MODIFICADO | EXITO | 21 |
| PUBLICACION_INACTIVADA | EXITO | 18 |
| PUBLICACION_MODIFICADA | EXITO | 24 |
| RECUPERACION_SOLICITADA | EXITO | 42 |
| RECUPERACION_SOLICITADA | FALLIDO | 36 |
| REFRESH | EXITO | 21 |
| REFRESH | FALLIDO | 10 |
| REGISTRAR_INVESTIGACION | EXITO | 28 |
| REPORTE_EXPORTADO | EXITO | 14 |
| ROL_ASIGNADO | EXITO | 10 |
| SESION_FINALIZADA | EXITO | 116 |
| SESION_RECHAZADA | FALLIDO | 63 |
| USER_BOOTSTRAP | EXITO | 1 |
| USUARIO_CREADO | EXITO | 85 |
| USUARIO_ELIMINADO | EXITO | 11 |
| USUARIO_INACTIVADO | EXITO | 10 |
| USUARIO_MODIFICADO | EXITO | 21 |

Los casos de límite de exportación añadieron lotes sintéticos de eventos inmutables a esta base de pruebas. No representan la cantidad de operaciones manuales de una institución.

## Fuentes

- Simulador: [cuentas iniciales](../client/src/model.ts), [muestras](../client/src/demoData.ts), [catálogos institucionales y nombres heredados](../client/src/institutionalDemo.ts).
- API: lectura de las tablas `usuarios`, `publicaciones`, `autores`, `tutores`, `catalogos`, `adjuntos`, `asignaciones_adjuntos` y agregados de `auditoria` en la base aislada indicada. No se modificaron registros.
- [Preparación y validación de la conexión](IMPLEMENTACION-CONEXION-PASOS-21-22-2026-10-18.md).
