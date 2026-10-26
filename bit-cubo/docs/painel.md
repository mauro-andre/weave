# Painel — entrar com dois fatores (TOTP)

O painel do Weave guarda o control-plane inteiro — entidades, registros, API keys — e a porta dele é o login do operador. Com o segundo fator ligado, a senha sozinha não abre mais: depois das credenciais corretas, o painel pede um código de 6 dígitos que só o seu autenticador gera naquele momento (Bitwarden, 1Password, Authy, Google Authenticator, Aegis — qualquer um que faça TOTP).

## Habilitar (Settings → Two-factor authentication)

Logado, abra **Settings** e procure o card *Two-factor authentication*:

1. **Enable** — o Weave gera um segredo só seu e mostra um QR code e o segredo em texto (para quem prefere digitar). Escaneie o QR com o seu autenticador (ou digite o texto). Nada mudou ainda: nesta fase o login continua pedindo só a senha.
2. **Digite o código** que o autenticador está mostrando agora e confirme — só a confirmação com um código válido liga o fator. A partir daqui, o seu login pede o código.
3. **Guarde os 10 códigos de recuperação** que aparecem na tela. Eles são mostrados UMA única vez; cada um vale um uso no lugar do código do autenticador, para o dia em que o celular se perde.

Religar o fator gera um segredo novo e revoga todos os códigos de recuperação anteriores — quem tinha os antigos não tem mais nada.

## Entrar com o fator ligado

Na mesma tela de login: credenciais corretas num usuário com o fator ligado fazem aparecer o campo de código, sem entrar ainda. Digite o código do autenticador (ou um código de recuperação) **junto com usuário e senha** — a verificação é das duas coisas de uma vez. Se algo estiver errado, a mensagem é a mesma de sempre e não revela o que falhou; um código de recuperação usado é consumido para sempre.

## Desligar

Em Settings, **Disable** pede um código válido (do autenticador ou um código de recuperação não usado) — a sessão aberta sozinha não desliga o fator.

## Se tudo se perder

Sem o autenticador E sem os códigos de recuperação, a única via é limpar as colunas de 2FA direto no banco — `twofa_secret`, `twofa_enabled`, `twofa_last_step` e `twofa_recovery` na tabela `weave_users` — e habilitar o fator de novo. O mesmo vale se o `SESSION_SECRET` da implantação for trocado: os segredos guardados ficam indecifráveis e todo login com o fator trava na etapa do código.
