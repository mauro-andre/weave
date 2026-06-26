// Erros de domínio do SDK — o dev pega um erro em vocabulário de objeto, NUNCA um
// stack de SQL. Mapeados a partir do status HTTP que a API devolve.

export class WeaveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WeaveError";
  }
}

/** 401 — a API key falta ou é inválida. */
export class WeaveAuthError extends WeaveError {
  constructor(message: string) {
    super(message, 401);
    this.name = "WeaveAuthError";
  }
}

/** 403 — o scope nega o verbo/linha/campo. */
export class WeaveScopeError extends WeaveError {
  constructor(message: string) {
    super(message, 403);
    this.name = "WeaveScopeError";
  }
}

/** 404 — objeto inexistente (ou fora do alcance do scope). */
export class WeaveNotFoundError extends WeaveError {
  constructor(message: string) {
    super(message, 404);
    this.name = "WeaveNotFoundError";
  }
}

/** 400 — payload inválido (validação de borda). */
export class WeaveValidationError extends WeaveError {
  constructor(message: string) {
    super(message, 400);
    this.name = "WeaveValidationError";
  }
}

/** Constrói o erro tipado a partir do status HTTP. */
export function errorFor(status: number, message: string): WeaveError {
  switch (status) {
    case 401:
      return new WeaveAuthError(message);
    case 403:
      return new WeaveScopeError(message);
    case 404:
      return new WeaveNotFoundError(message);
    case 400:
      return new WeaveValidationError(message);
    default:
      return new WeaveError(message, status);
  }
}
