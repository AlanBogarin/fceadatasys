import {
  BookOpen,
  Building2,
  Clock3,
  FileText,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  LibraryBig,
  LockKeyhole,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UploadCloud,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "./model";
type Item = {
  id: string;
  label: string;
  icon: LucideIcon;
  ready?: boolean;
  roles?: Role[];
};
const admins: Role[] = ["ADMINISTRADOR"];
const editors: Role[] = ["ADMINISTRADOR", "DIGITADOR"];
export const groups: {
  label: string;
  items: Item[];
}[] = [
  {
    label: "Repositorio",
    items: [
      { id: "dashboard", label: "Inicio", icon: LayoutDashboard, ready: true },
      {
        id: "publicaciones",
        label: "Catálogo bibliográfico",
        icon: BookOpen,
        ready: true,
      },
      { id: "busqueda", label: "Búsqueda avanzada", icon: Search, ready: true },
    ],
  },
  {
    label: "Gestión bibliográfica",
    items: [
      {
        id: "gestion-publicaciones",
        ready: true,
        label: "Publicaciones",
        icon: FileText,
        roles: editors,
      },
      {
        id: "archivos",
        ready: true,
        label: "Carga de archivos",
        icon: UploadCloud,
        roles: editors,
      },
      {
        id: "autores",
        ready: true,
        label: "Autores",
        icon: Users,
        roles: editors,
      },
      {
        id: "tutores",
        ready: true,
        label: "Tutores y orientadores",
        icon: GraduationCap,
        roles: editors,
      },
    ],
  },
  {
    label: "Administración",
    items: [
      {
        id: "usuarios",
        label: "Usuarios",
        icon: ShieldCheck,
        ready: true,
        roles: admins,
      },
      {
        id: "carreras",
        ready: true,
        label: "Carreras",
        icon: GraduationCap,
        roles: admins,
      },
      {
        id: "facultades",
        ready: true,
        label: "Facultades",
        icon: Building2,
        roles: admins,
      },
      {
        id: "filiales",
        label: "Sedes y filiales",
        icon: Building2,
        ready: true,
        roles: admins,
      },
      {
        id: "tipos",
        ready: true,
        label: "Tipos de publicación",
        icon: FolderOpen,
        roles: admins,
      },
      {
        id: "niveles",
        ready: true,
        label: "Niveles académicos",
        icon: LibraryBig,
        roles: admins,
      },
      {
        id: "roles",
        ready: true,
        label: "Roles y permisos",
        icon: LockKeyhole,
        roles: admins,
      },
      {
        id: "parametros",
        ready: true,
        label: "Parámetros generales",
        icon: SlidersHorizontal,
        roles: admins,
      },
      {
        id: "reportes",
        ready: true,
        label: "Reporte de investigaciones",
        icon: FileText,
        roles: admins,
      },
      {
        id: "auditoria",
        label: "Auditoría",
        icon: Clock3,
        roles: admins,
        ready: true,
      },
    ],
  },
];
export const allItems = groups.flatMap((group) => group.items);
