import { useEffect, useRef, useState } from "preact/hooks";
import * as css from "./Select.css.js";

export interface SelectOption {
  value: string;
  label: string;
  /** Texto auxiliar à direita (ex.: tipo/kind do campo). */
  hint?: string;
}

/**
 * Combobox pesquisável reutilizável — escolher 1 entre muitos. Escala pra
 * centenas/milhares: busca por substring, lista rolável, navegação por setas,
 * fecha no Esc/clique fora. Use em entity picker, reference picker, etc.
 */
export function Select({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchable = true,
  mono = false,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Mostra o campo de busca (default true). Desligue para listas curtas. */
  searchable?: boolean;
  /** Fonte monoespaçada no valor/opções (nomes técnicos, ids…). */
  mono?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = searchable
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      if (searchable) searchRef.current?.focus();
    }
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onSearchKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[active];
      if (opt) pick(opt.value);
    }
  };

  const monoCls = mono ? ` ${css.mono}` : "";

  return (
    <div class={css.wrap} ref={wrapRef}>
      <button
        type="button"
        class={`${open ? `${css.trigger} ${css.triggerOpen}` : css.trigger}${monoCls}`}
        onClick={() => setOpen((o) => !o)}
      >
        {selected ? <span>{selected.label}</span> : <span class={css.placeholder}>{placeholder}</span>}
        <span class={css.caret}>▾</span>
      </button>

      {open ? (
        <div class={css.panel}>
          {searchable ? (
            <input
              ref={searchRef}
              class={css.search}
              placeholder="Search…"
              value={query}
              onInput={(e) => {
                setQuery((e.currentTarget as HTMLInputElement).value);
                setActive(0);
              }}
              onKeyDown={onSearchKey}
            />
          ) : null}
          <div class={css.list}>
            {filtered.length === 0 ? (
              <p class={css.empty}>Nothing found.</p>
            ) : (
              filtered.map((opt, i) => {
                const cls = [css.option];
                if (mono) cls.push(css.mono);
                if (i === active) cls.push(css.optionActive);
                if (opt.value === value) cls.push(css.optionSelected);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    class={cls.join(" ")}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(opt.value)}
                  >
                    <span>{opt.label}</span>
                    {opt.hint ? <span class={css.optionHint}>{opt.hint}</span> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
