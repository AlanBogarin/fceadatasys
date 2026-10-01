# FCEA Administrador de repositorios

## Prerequisitos

Las herramientas que se utilizara en el proyecto son:

1. **nodejs v24+**
    Instala manualmente desde un gestor de versiones node `nvm` o la web oficial de nodejs

2. **herdr**
    ```
    powershell -ExecutionPolicy Bypass -c "irm https://herdr.dev/install.ps1 | iex"
    ```

3. **opencode**
    ```
    npm install -g opencode-ai --ignore-scripts=false
    ```

4. **omniroute**
    ```
    npm install -g omniroute --ignore-scripts=false
    ```

## Medidas de Seguridad
Para usar de manera segura nodejs, se recomienda la adopcion de medidas de seguridad ante paquetes infectados con codigo malicioso, para ello se configura npm con estas reglas:
```
npm config set -g allow-git="none"
npm config set -g ignore-scripts=true
npm config set -g min-release-age=7
npm config set -g strict-ssl=true
```
