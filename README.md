# CRM Modular

Aplicativo CRM estático.

## Deploy HTTPS

Este projeto está configurado para deploy automático em GitHub Pages via workflow.

1. Crie repositório GitHub e faça push.
2. Garanta branch `main`.
3. Workflow deploya para GitHub Pages automaticamente.
4. Acesse `https://<seu-usuario>.github.io/<nome-do-repositorio>`.

## Instruções locais

Você pode abrir o app no navegador sem rodar Python (recomendado):

1. Abra `index.html` diretamente no Edge/Chrome.
2. Ou use VS Code: `Run and Debug` → selecione `Open index.html in Edge`.

Se quiser servidor local (Live Server ou terminal):

```bash
# Com Live Server (extensão VSCode)
# Ou com Python (quando disponível):
python -m http.server 8000
```

### Aviso importante
Não execute `index.html` com o debugger Python (`Python Debugger: Current File`), porque HTML não é código Python. Isso causa `SyntaxError: invalid syntax` no `<!DOCTYPE html>`.

---