import type { CatalogInput } from "./catalogs";

// Nombres consultados en las páginas oficiales el 16/10/2026.
// El sufijo y los códigos sintéticos identifican el uso dentro de esta demo.
export const institutionalSources = {
  university: "https://www.unc.edu.py/",
  faculty: "https://fcea-unc.edu.py/",
  consultedOn: "2026-10-16",
};

export const institutionalSamples: Record<
  "carreras" | "facultades" | "filiales",
  CatalogInput[]
> = {
  carreras: [
    "Licenciatura en Administración",
    "Contaduría Pública",
    "Ingeniería Comercial",
    "Ingeniería en Informática Empresarial",
  ].map((name, index) => ({
    name: `${name} (demo)`,
    fields: {
      codigo: `DEMO-CAR-${index + 1}`,
      descripcion:
        "Carrera de la FCEA - UNC. Nombre verificado en https://fcea-unc.edu.py/ el 16/10/2026. Registro de demostración; código sintético sin valor oficial.",
    },
  })),
  facultades: [
    "Facultad de Ciencias Económicas y Administrativas",
    "Facultad de Humanidades y Ciencias de la Educación",
    "Facultad de Ciencias Agrarias",
    "Facultad de Ciencias Exactas y Tecnológicas",
    "Facultad de Medicina",
    "Facultad de Odontología",
  ].map((name, index) => ({
    name: `${name} (demo)`,
    fields: {
      sigla: `DEMO-FAC-${index + 1}`,
      descripcion:
        "Unidad académica de la Universidad Nacional de Concepción. Nombre verificado en https://www.unc.edu.py/ el 16/10/2026. Registro de demostración; identificador sintético.",
    },
  })),
  filiales: [
    {
      name: "Sede Concepción (demo)",
      fields: {
        direccion: "Ruta PY-05 «Gral. Bernardino Caballero» Km 210, Concepción",
        descripcion:
          "Sede de la FCEA - UNC. Nombre y dirección publicados en https://fcea-unc.edu.py/, consultados el 16/10/2026. Registro de demostración.",
      },
    },
    {
      name: "Filial Horqueta (demo)",
      fields: {
        direccion: "Av. Capitán Gumercindo Sosa c/ Ruta V, Horqueta",
        descripcion:
          "Filial de la FCEA - UNC. Nombre y dirección publicados en https://fcea-unc.edu.py/, consultados el 16/10/2026. Registro de demostración.",
      },
    },
  ],
};

// Solo estas denominaciones generadas por la versión anterior pueden corregirse.
// Una muestra que el usuario renombró y cualquier registro propio se conservan.
export const legacyInstitutionalNames = {
  carreras: [
    "Administración de Empresas (demo)",
    "Contaduría Pública (demo)",
    "Economía (demo)",
    "Comercio Internacional (demo)",
  ],
  facultades: [
    "Facultad de Ciencias Económicas y Administrativas (demo)",
    "Facultad de Estudios Sociales (demo)",
  ],
  filiales: [
    "Sede Central de Concepción (demo)",
    "Filial Norte (demo)",
    "Filial Sur (demo)",
  ],
};
