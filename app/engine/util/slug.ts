// Normaliza um nome (entidade/campo) para um identificador SQL-safe:
// remove acentos, minúsculas, e troca tudo que não é [a-z0-9] por "_".
// Ex.: "Produtos Especiais" → "produtos_especiais"; "Preço" → "preco".
export function slug(s: string): string {
  const out = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos (marcas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_") // espaços/pontuação/hífens → "_"
    .replace(/^_+|_+$/g, ""); // tira "_" das pontas
  return /^[0-9]/.test(out) ? `_${out}` : out; // identificador não começa com dígito
}
