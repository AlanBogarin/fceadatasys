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

## Configuracion de Omniroute
Para poder usar todos los subajentes, es necesario crear varios combos en omniroute con varios modelos.

### Proveedores
Algunos proveedores gratuitos necesitan API KEY

#### Google AI Studio
**url**: https://aistudio.google.com/apikey
**modelos**:
- gemini/gemini-3.1-flash-lite
- gemini/gemini-3-flash-preview
- gemini/gemini-2.5-flash
- gemini/gemini-2.5-flash-lite

#### Openrouter
**url**: https://openrouter.ai/workspaces/default/keys
**modelos**:
- openrouter/apodex/apodex-1.1-mini:free
- openrouter/inclusionai/ling-3.0-flash-sante:free
- openrouter/qwen/qwen3.8-27b:free
- openrouter/dots-studio/dots-3-note-preview:free
- openrouter/liquid/lfm-2.5-2.6b:free
- openrouter/poolside/laguna-s-2.1:free
- openrouter/poolside/laguna-xs-2.1:free
- openrouter/cohere/north-mini-code:free
- openrouter/nvidia/nemotron-3.5-content-safety:free
- openrouter/nvidia/nemotron-3-ultra-550b-a55b:free
- openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
- openrouter/nvidia/nemotron-3-super-120b-a12b:free
- openrouter/openrouter/free

#### Nvidia NIM
**url**: https://build.nvidia.com/settings/api-keys
**modelos**:
- nvidia/google/gemma-4-31b-it
- nvidia/openai/gpt-oss-20b
- nvidia/nvidia/nemotron-3-super-120b-a12b
- nvidia/z-ai/glm-5.3
- nvidia/z-ai/glm-5.3-flash
- nvidia/moonshotai/kimi-k3
- nvidia/nvidia/nemotron-3.5-lightning-30b-a3b
- nvidia/meta/muse-glimmer-30b
- nvidia/poolside/laguna-xs-2.1
- nvidia/nvidia/nemotron-3-ultra-550b-a55b
- nvidia/nvidia/nemotron-3.5-content-safety
- nvidia/nvidia/nemotron-3-super-120b-a12b

#### Opencode Zen (free)
**url**: Inluido en omniroute
**modelos**:
- oc/space-bunny-free
- oc/big-pickle
- oc/mimo-v2.5-free
- oc/mimo-v2.6-flash-free
- oc/ling-3.0-flash-fin-free
- oc/nemotron-3-ultra-free
- oc/nemotron-3.5-lightning-free
- oc/longcat-2.5-preview-free

#### Agnes AI
**url**: Incluido en omniroute
**modelos**:
- agnes/agnes-2.5-flash

### Combos

Estrategia de enrutamiento: priority

1. **combo-orchestrator**: Planificación, coordinación y contexto amplio
    - `gemini/gemini-3-flash-preview | Google AI Studio`
    - `nvidia/z-ai/glm-5.3 | Nvidia NIM`
    - `openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free | OpenRouter`
    - `oc/nemotron-3-ultra-free | Opencode Zen (free)`
    - `agnes/agnes-2.5-flash | Agnes AI`

2. **combo-backend**: Código pesado, algoritmos y reglas de negocio
    - `penrouter/cohere/north-mini-code:free | OpenRouter`
    - `openrouter/qwen/qwen3.8-27b:free | OpenRouter`
    - `nvidia/z-ai/glm-5.3-flash | Nvidia NIM`
    - `gemini/gemini-3.1-flash-lite | Google AI Studio`
    - `oc/mimo-v2.6-flash-free | Opencode Zen (free)`

3. **combo-database**: PostgreSQL, esquemas, SQL y ORM
    - `nvidia/openai/gpt-oss-20b | Nvidia NIM`
    - `openrouter/qwen/qwen3.8-27b:free | OpenRouter`
    - `nvidia/z-ai/glm-5.3-flash | Nvidia NIM`
    - `gemini/gemini-2.5-flash | Google AI Studio`

4. **combo-frontend**: Componentes UI, Tailwind, React/Vue, maquetación
    - `gemini/gemini-3-flash-preview | Google AI Studio`
    - `nvidia/google/gemma-4-31b-it | Nvidia NIM`
    - `oc/longcat-2.5-preview-free | Opencode Zen (free)`
    - `openrouter/qwen/qwen3.8-27b:free | OpenRouter`

5. **combo-security**: Auditoría, permisos, sanitización y vulnerabilidades
    - `openrouter/nvidia/nemotron-3.5-content-safety:free | OpenRouter`
    - `nvidia/moonshotai/kimi-k3 | Nvidia NIM`
    - `nvidia/z-ai/glm-5.3 | Nvidia NIM`
    - `gemini/gemini-2.5-flash | Google AI Studio`

### Configurar Opencode

Crea un api key en omniroute, crea un archivo `opencode.json` con el siguiente contenido, y remplaza OMNIROUTE_API_TOKEN por el api key generado

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "omniroute": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OmniRoute",
      "options": {
        "baseURL": "http://localhost:20128/v1",
        "apiKey": "OMNIROUTE_API_TOKEN"
      },
      "models": {
        "combo-orchestrator": {
          "name": "combo-orchestrator",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "combo-backend": {
          "name": "combo-backend",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "combo-frontend": {
          "name": "combo-frontend",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "combo-database": {
          "name": "combo-database",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "combo-security": {
          "name": "combo-security",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        }
      }
    }
  },
  "providers": {
    "omniroute": {
      "name": "OmniRoute",
      "package": "@opencode-ai/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "http://localhost:20128/v1",
        "apiKey": "sk-5caadcb3185fcf18-e30d1a-fe943844"
      },
      "models": {
        "combo-orchestrator": {
          "name": "combo-orchestrator",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "combo-backend": {
          "name": "combo-backend",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "combo-frontend": {
          "name": "combo-frontend",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "combo-database": {
          "name": "combo-database",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "combo-security": {
          "name": "combo-security",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        }
      }
    }
  }
}
```
