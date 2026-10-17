# FCEA Administrador de repositorios

Revisión conjunta de cliente, servidor y documentación: [Preparación para la integración — 17/10/2026](docs/REVISION-PREPARACION-INTEGRACION-2026-10-17.md). Las diferencias detectadas se resolvieron en la [implementación de H1–H3](docs/IMPLEMENTACION-H1-H2-H3-2026-10-17.md); la conexión real continúa pendiente.

Las instrucciones de ejecución están en [cliente](client/README.md) y [servidor](server/README.md). El estado vigente de servicios/DTO del simulador se documenta en [ADAPTACIONES-CLIENTE.md](client/docs/ADAPTACIONES-CLIENTE.md), y los contratos HTTP en [API.md](server/docs/API.md) y [CLIENT-INTEGRATION.md](server/docs/CLIENT-INTEGRATION.md). Las notas de hitos conservan sus evidencias fechadas; sus listas antiguas de pendientes no sustituyen estas guías.

El [plan de conexión por ventanas de la UI](docs/PLAN-CONEXION-CLIENTE-SERVIDOR-2026-10-17.md) organiza la implementación en 22 pasos, con flujos, endpoints, dependencias y criterios de cierre.

## Prerequisitos

Las herramientas que se utilizara en el proyecto son:

1. **Node.js 24.11+ de la rama 24**
    Instala manualmente desde un gestor de versiones node `nvm` o la web oficial de nodejs

2. **Codex**
    Instalar oficial desde la pagina de OpenAI

## Medidas de Seguridad
Para usar de manera segura nodejs, se recomienda la adopcion de medidas de seguridad ante paquetes infectados con codigo malicioso, para ello se configura npm con estas reglas:
```
npm config set -g allow-git="none"
npm config set -g ignore-scripts=true
npm config set -g min-release-age=7
npm config set -g strict-ssl=true
```
