# Legal Administration Frontend — Deploy RC V0.7

Frontend React/TypeScript da Vertical Legal.

## Autenticação

- não possui tela ou store de senha própria;
- não usa OIDC/Bearer como requisito;
- usa a sessão nativa EFATÀ via cookie HttpOnly e `credentials: "include"`;
- usa token `legal_csrf` + header `X-Legal-CSRF` para writes;
- em 401 pode redirecionar para `VITE_AUTH_LOGIN_URL`;
- nenhuma role recebida do browser concede autorização Legal.

A implantação deve respeitar o contrato de host descrito no backend:
`docs/AUTH_NATIVE_SESSION.md`.

## Superfícies

- visão geral do caso;
- Judicial Hub READ-ONLY;
- sincronização EPROC;
- Case Agent / “O que mudou?”;
- documentos e evidências;
- Executive & Case Agents;
- Legal Drafting + Human Review;
- estado de integração EFATÀ.

Segredos M2M, `secret_ref`, `idConsultante` e `senhaConsultante` não pertencem ao browser.

## Gates

- Node contract tests: 6 PASS / 0 FAIL
- ausência de Bearer/login próprio: PASS
- contrato CSRF: PASS
- instalação limpa de dependências: NOT_PROVEN neste runtime
- TypeScript/Vite production build: NOT_PROVEN porque `node_modules` não pôde ser instalado
- `package-lock.json`: NOT_GENERATED

A falta do build comprovado é gate externo, não evidência de defeito funcional.


## Deploy V0.7

Recommended public paths: `VITE_BASE_PATH=/legal/` and `VITE_API_BASE_URL=/legal-api`. Production Docker build requires a committed `package-lock.json` and uses `npm ci`.
