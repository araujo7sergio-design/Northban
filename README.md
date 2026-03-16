# CRM Modular

Aplicativo CRM estático.

## Deploy HTTPS

Este projeto está configurado para deploy automático em GitHub Pages via workflow.

1. Crie repositório GitHub e faça push.
2. Garanta branch `main`.
3. Workflow deploya para GitHub Pages automaticamente.
4. Acesse `https://<seu-usuario>.github.io/<nome-do-repositorio>`.

## Instruções locais

```bash
python -m http.server 8000
```

---

Se quiser, posso gerar também um deploy Netlify com `netlify.toml` e comandos `netlify deploy`.