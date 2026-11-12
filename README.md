# dsh-plugin-code-search — Code Search

Busca simbolos (funciones, clases, exports, constantes) en un proyecto local con archivo y linea, soportando JS/TS/Python/Go/Rust, sin indices externos.

## Herramientas

| Tool | Qué hace |
|---|---|
| `status` | Estado |
| `search` | Buscar símbolos |

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-code-search` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-code-search
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_CODE_SEARCH_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\code-search\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
