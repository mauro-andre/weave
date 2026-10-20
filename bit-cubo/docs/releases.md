# Releases — publicar uma versão do Weave

Uma release do Weave toca três destinos: o pacote npm (`@mauroandre/weave-sdk`), a release no GitHub e a imagem de container no GHCR. O `scripts/publish.sh`, rodado da raiz do repo, conduz os três numa corrida só — sem input interativo e sem segredos em output (os tokens `NPM_TOKEN` e `GITHUB_TOKEN` vêm do `.env`).

## A regra de ouro

A versão do `package.json` da raiz é a única fonte: a MESMA string vira a versão do pacote npm, a tag da release GitHub e as tags da imagem (`<versão>` e `latest`). Quem quer divergência entre pacote, tag e imagem precisa trabalhar para conseguir.

## Antes de rodar

- Faça o bump da versão na raiz (`package.json`) — o script publica a versão que está lá, nunca inventa uma.
- Commite e faça push: as guardas exigem árvore limpa e HEAD idêntico ao remote. O que é publicado tem de ser o que está commitado.

## O ensaio (--dry-run)

`./scripts/publish.sh --dry-run` roda todas as guardas, builda o SDK, gera e valida o tarball, ensaia o caminho npm e imprime o plano completo dos três destinos — sem stagear, criar release ou empurrar nada. Árvore suja no ensaio é apenas um aviso (a corrida real barra); ao final, o ensaio deixa a árvore exatamente como a encontrou.

## A corrida real

`./scripts/publish.sh` executa, nesta ordem:

1. **Guardas** — tokens presentes, árvore limpa, HEAD sincronizado, versão ainda não live no registry, tokens autenticando (npm e GitHub). Qualquer falha: mensagem nomeando o problema, exit não-zero, nada publicado.
2. **npm** — aplica a versão ao pacote do workspace, builda o SDK, gera as skills de agente (prepack) e sobe a versão como *stage* (`npm stage publish` — o token é stage-only e rejeita publish direto). Nada fica live ainda.
3. **GitHub** — cria a release com tag e nome iguais à versão (crua, sem prefixo `v`), no repo derivado do remote.
4. **Imagem** — builda o Dockerfile da raiz e empurra `ghcr.io/<owner>/weave:<versão>` e `:latest` (o login no GHCR é pelo dono do token).

No fim, o resumo mostra o estado de cada destino — em sucesso ou em falha no meio do caminho, com o gesto de recuperação para o que ficou pendente.

## O passo humano (fora do script)

O stage npm aguarda aprovação com 2FA de um mantenedor:

```
npm stage list                            # acha o stage-id, se preciso
npm stage approve <stage-id> --otp <código>
```

Sem a aprovação, a versão nunca fica live no registry.

## Depois do publish

A árvore fica suja por design: a versão usada ficou gravada em `packages/sdk/package.json` — o commit é o gesto do arquiteto. Sem esse commit, a próxima corrida barra nas guardas (árvore suja e versão já em trânsito): publicar a mesma versão duas vezes é bloqueado.
